// 온톨로지 저장소. 읽기 = 인메모리 인덱스(캐시), 원본 = Postgres(DATABASE_URL 있을 때).
// write-through: 쓰기는 DB 커밋 성공 후에만 메모리 반영(캐시/DB 정합). docs/features/ontology-store.md
//
// 모드:
//   - DATABASE_URL 없음: 기존 인메모리 전용(모듈 로드 시 ingest→인덱스 구축). 테스트·로컬 개발 무변경.
//   - DATABASE_URL 있음: 모듈 로드는 비움, ready() 가 스키마·시드 후 DB 적재 or 최초 ingest 를 DB 로 승격.
import type { Node, Edge, ObjectDetail, Rel, Doc } from "./types";
import { NODES as SEED_NODES, EDGES as SEED_EDGES } from "./seed";
import { ingestAll } from "./ingest/index";
import type { SourceInfo } from "./ingest/index";
import * as db from "./db";
import { backfillEmbeddings } from "./embed";
import { OBJECT_TYPES, RELATION_TYPES, OBJECT_SUBTYPES, PROPERTY_DEFS } from "./db/seed-metamodel";
import type { Metamodel } from "./db/seed-metamodel";
import { classifyMissing } from "./schema/classify";

const HAS_DB = db.dbEnabled();

// ── 메타모델 캐시 — 기본은 시드, DB 모드는 hydrate 시 DB 값으로 교체(자동 등록 관계 포함). ──
let METAMODEL: Metamodel = {
  objectTypes: OBJECT_TYPES,
  relationTypes: RELATION_TYPES,
  subtypes: OBJECT_SUBTYPES,
  propertyDefs: PROPERTY_DEFS,
};
export function getMetamodel(): Metamodel {
  return METAMODEL;
}

/** 임베딩 백필을 백그라운드로(부팅·병합 비차단, 실패 무해 — backfillEmbeddings 자체가 멱등·no-throw).
 * 동시 실행 1개로 제한 — 실행 중 재요청은 완료 후 1회 재실행(그 사이 추가된 노드 커버). */
let backfillRunning = false;
let backfillAgain = false;
function scheduleEmbedBackfill() {
  if (!HAS_DB) return;
  if (backfillRunning) {
    backfillAgain = true;
    return;
  }
  backfillRunning = true;
  void backfillEmbeddings()
    .then((r) => {
      if (!r.skipped && r.embedded > 0) console.log(`[embed] auto-backfill: ${r.embedded}개 임베딩 생성`);
    })
    .catch(() => {})
    .finally(() => {
      backfillRunning = false;
      if (backfillAgain) {
        backfillAgain = false;
        scheduleEmbedBackfill();
      }
    });
}

// ── 인메모리 인덱스 ──
let NODES: Node[] = [];
let EDGES: Edge[] = [];
const byId = new Map<string, Node>();
const outMap = new Map<string, Edge[]>();
const inMap = new Map<string, Edge[]>();
const degree = new Map<string, number>();
const edgeKeySet = new Set<string>(); // `${src}|${rel}|${dst}` — 증분 병합 idempotency 판정용

// 런타임(업로드) 인제스천 출처 — /api/sources 가 정적 data/sources 목록에 병합해 노출한다.
const RUNTIME_SOURCES: SourceInfo[] = [];
// "이 도면/이 커넥터"의 지시 대상 — 마지막으로 분석·추가된 도면 프로젝트 id (대화 컨텍스트).
let ACTIVE_DRAWING: string | null = null;

function push(map: Map<string, Edge[]>, k: string, e: Edge) {
  const arr = map.get(k);
  if (arr) arr.push(e);
  else map.set(k, [e]);
}

/** 노드/엣지 배열로 인덱스 전체 재구축(리셋 후 채움). DB 적재·모듈로드 공용. */
function rebuildIndex(nodes: Node[], edges: Edge[]) {
  NODES = [...nodes];
  EDGES = [];
  byId.clear();
  outMap.clear();
  inMap.clear();
  degree.clear();
  edgeKeySet.clear();
  for (const n of NODES) byId.set(n.id, n);
  for (const e of edges) {
    const key = `${e.src}|${e.rel}|${e.dst}`;
    if (edgeKeySet.has(key)) continue;
    edgeKeySet.add(key);
    if (!byId.has(e.src) || !byId.has(e.dst)) continue; // 양끝 존재 링크만(무결성)
    EDGES.push(e);
    push(outMap, e.src, e);
    push(inMap, e.dst, e);
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
  }
}

/** data/sources 인제스천(실패·공백 시 seed 폴백). 모듈로드/최초 DB 적재 공용. */
function ingestOrSeed(): { nodes: Node[]; edges: Edge[]; sources: SourceInfo[] } {
  const got = (() => {
    try {
      const ing = ingestAll();
      if (ing.nodes.length > 0) return { nodes: ing.nodes, edges: ing.edges, sources: ing.sources };
    } catch {
      /* fall through */
    }
    return { nodes: [...SEED_NODES], edges: [...SEED_EDGES], sources: [] as SourceInfo[] };
  })();
  // 서브타입 자동 분류 — 신규 적재분은 DB 삽입 전에 st 를 채워 한 번에 들어간다.
  for (const a of classifyMissing(got.nodes, METAMODEL.subtypes)) {
    const n = got.nodes.find((x) => x.id === a.id);
    if (n) n.st = a.st;
  }
  return got;
}

// DATABASE_URL 없으면 지금 즉시 인메모리 구축(기존 동작 — sync 테스트가 ready() 없이 읽는다).
if (!HAS_DB) {
  const seed = ingestOrSeed();
  rebuildIndex(seed.nodes, seed.edges);
  for (const s of seed.sources) RUNTIME_SOURCES.push(s);
}

/* ────────────────────────── 부팅(ready) — DB 모드 하이드레이션 + 요청별 재동기화 ──────────────────────────
 * 모든 API Route Handler 는 첫 줄에서 await ready().
 * DB 직독 1단계(스펙 2026-07-09-db-first-reads): 첫 요청 = 하이드레이션(스키마·시드·백필 포함),
 * 이후 요청 = 매번 loadAll() 재동기화 — 인덱스는 "요청 시점 DB 스냅샷". psql 등 외부 변경도 즉시 반영.
 * 동시 요청은 진행 중 동기화 프로미스를 공유(중복 SELECT 방지). 실패는 캐시하지 않는다. */
let readyPromise: Promise<void> | undefined;
let syncInFlight: Promise<void> | undefined;
let lastSyncAt = 0;
// 재동기화 TTL — 이 창 안의 연속 요청은 직전 스냅샷 재사용(요청당 4쿼리+O(V+E) 재인덱스 절감).
// psql 직접 변경 반영이 최대 2초 지연되지만 브라우저 새로고침 한 번보다 짧다 — DB 직독 체감 불변.
const SYNC_TTL_MS = 2000;

async function syncFromDb(): Promise<void> {
  const { nodes, edges, sources, activeDrawing } = await db.loadAll();
  rebuildIndex(nodes, edges);
  RUNTIME_SOURCES.length = 0;
  for (const s of sources) RUNTIME_SOURCES.push(s);
  ACTIVE_DRAWING = activeDrawing;
  lastSyncAt = Date.now();
}

export function ready(): Promise<void> {
  if (!HAS_DB) return Promise.resolve(); // 인메모리는 모듈로드에서 이미 구축됨(테스트·로컬 전용)
  if (!readyPromise) {
    readyPromise = hydrate().catch((e) => {
      readyPromise = undefined; // 실패 캐시 안 함 — 다음 요청이 재시도
      throw e;
    });
    return readyPromise;
  }
  if (Date.now() - lastSyncAt < SYNC_TTL_MS) return readyPromise; // TTL 내 — 스냅샷 재사용
  // 부팅 이후: TTL 지난 요청은 DB 재동기화(동시 요청은 공유)
  syncInFlight ??= readyPromise
    .then(() => syncFromDb())
    .finally(() => {
      syncInFlight = undefined;
    });
  return syncInFlight;
}

async function hydrate(): Promise<void> {
  await db.ready(); // 스키마 적용 + 메타모델 시드(멱등)
  METAMODEL = await db.loadMetamodel(); // 자동 등록된 관계 타입 포함 — 검증·내보내기의 기준
  if ((await db.nodeCount()) === 0) {
    // 최초 부팅: 인제스천 결과를 DB 로 승격
    const seed = ingestOrSeed();
    rebuildIndex(seed.nodes, seed.edges);
    RUNTIME_SOURCES.length = 0;
    for (const s of seed.sources) RUNTIME_SOURCES.push(s);
    await db.bulkInsertGraph(NODES, EDGES, seed.sources);
  } else {
    // 재부팅: DB 가 원본 — 그대로 적재
    const { nodes, edges, sources, activeDrawing } = await db.loadAll();
    rebuildIndex(nodes, edges);
    RUNTIME_SOURCES.length = 0;
    for (const s of sources) RUNTIME_SOURCES.push(s);
    ACTIVE_DRAWING = activeDrawing;
    // 구버전 적재분 서브타입 백필 — DB 커밋 성공 후 메모리 반영(write-through 관례)
    const assigns = classifyMissing(NODES, METAMODEL.subtypes);
    if (assigns.length > 0) {
      await db.persistSubtypeAssignments(assigns);
      for (const a of assigns) {
        const n = byId.get(a.id);
        if (n) n.st = a.st;
      }
      console.log(`[schema] 서브타입 백필: ${assigns.length}건 분류`);
    }
  }
  scheduleEmbedBackfill(); // 부팅 후 누락 임베딩 자동 채움(비차단)
}

/* ────────────────────────── 증분 병합 (인제스천·도면 추가) ──────────────────────────
 * write-through: HAS_DB 이면 DB 에 먼저 upsert(ON CONFLICT DO NOTHING) 후 메모리 병합. */

/** 노드/엣지 델타를 병합. idempotent. @returns 실제 새로 들어간 것 + 새 엣지를 얻은 기존 노드 id. */
export async function mergeDelta(
  nodes: Node[],
  edges: Edge[],
  op: string = "ingest"
): Promise<{ addedNodes: Node[]; addedEdges: Edge[]; touched: string[] }> {
  // 신규 노드 서브타입 분류 — DB 삽입 전에 st 포함(기존 노드는 ON CONFLICT 로 불변)
  for (const a of classifyMissing(nodes, METAMODEL.subtypes)) {
    const n = nodes.find((x) => x.id === a.id);
    if (n) n.st = a.st;
  }
  if (HAS_DB) await db.persistUpsertGraph(nodes, edges, op); // DB 먼저(정합 실패 시 여기서 throw → 메모리 미변경)
  const addedNodes: Node[] = [];
  const addedIds = new Set<string>();
  for (const n of nodes) {
    if (byId.has(n.id)) continue; // 기존 노드 우선(원본 보존)
    byId.set(n.id, n);
    NODES.push(n);
    addedNodes.push(n);
    addedIds.add(n.id);
  }
  const addedEdges: Edge[] = [];
  const touchedSet = new Set<string>();
  for (const e of edges) {
    if (!byId.has(e.src) || !byId.has(e.dst)) continue;
    const key = `${e.src}|${e.rel}|${e.dst}`;
    if (edgeKeySet.has(key)) continue;
    edgeKeySet.add(key);
    EDGES.push(e);
    push(outMap, e.src, e);
    push(inMap, e.dst, e);
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
    addedEdges.push(e);
    if (!addedIds.has(e.src)) touchedSet.add(e.src);
    if (!addedIds.has(e.dst)) touchedSet.add(e.dst);
  }
  if (addedNodes.length > 0) scheduleEmbedBackfill(); // 새 노드는 벡터 검색에도 보이게(비차단)
  return { addedNodes, addedEdges, touched: [...touchedSet] };
}

/** 업로드 원천 파일 등록(같은 파일명 재업로드 시 최신 교체). content = DB 보존용 원본 바이트(선택). */
export async function registerSource(s: SourceInfo, content?: Buffer): Promise<void> {
  if (HAS_DB) await db.persistSource(s, content);
  const i = RUNTIME_SOURCES.findIndex((x) => x.file === s.file);
  if (i >= 0) RUNTIME_SOURCES[i] = s;
  else RUNTIME_SOURCES.push(s);
}

/** 런타임 등록 출처 목록(복사본). */
export function getRuntimeSources(): SourceInfo[] {
  return [...RUNTIME_SOURCES];
}

/* ────────────────── 큐레이션: 삭제·병합 (write-through) ────────────────── */

function dropEdge(e: Edge): void {
  const key = `${e.src}|${e.rel}|${e.dst}`;
  edgeKeySet.delete(key);
  const i = EDGES.indexOf(e);
  if (i >= 0) EDGES.splice(i, 1);
  const om = outMap.get(e.src);
  if (om) { const j = om.indexOf(e); if (j >= 0) om.splice(j, 1); }
  const im = inMap.get(e.dst);
  if (im) { const j = im.indexOf(e); if (j >= 0) im.splice(j, 1); }
  degree.set(e.src, Math.max(0, (degree.get(e.src) ?? 1) - 1));
  degree.set(e.dst, Math.max(0, (degree.get(e.dst) ?? 1) - 1));
}

/** 관계 1개 삭제. 존재했으면 true. */
export async function removeEdge(src: string, rel: string, dst: string): Promise<boolean> {
  const e = (outMap.get(src) ?? []).find((x) => x.rel === rel && x.dst === dst);
  if (!e) return false;
  if (HAS_DB) await db.persistDeleteEdge(src, rel, dst);
  dropEdge(e);
  return true;
}

/** 노드 + 부속 엣지 삭제. @returns 지운 엣지 수(없는 노드면 -1). */
export async function removeNode(id: string): Promise<number> {
  if (!byId.has(id)) return -1;
  const touching = [...(outMap.get(id) ?? []), ...(inMap.get(id) ?? [])];
  if (HAS_DB) await db.persistDeleteNode(id); // DB 는 엣지 CASCADE
  for (const e of touching) dropEdge(e);
  outMap.delete(id);
  inMap.delete(id);
  byId.delete(id);
  const i = NODES.findIndex((n) => n.id === id);
  if (i >= 0) NODES.splice(i, 1);
  return touching.length;
}

/** from 노드를 into 에 병합 — 관계 이관(중복·자기루프 제거), from 라벨은 into "병합됨" 속성으로 보존, from 삭제.
 * @returns 이관된 엣지 목록(실패 시 null). */
export async function mergeNodes(fromId: string, intoId: string): Promise<Edge[] | null> {
  const from = byId.get(fromId);
  const into = byId.get(intoId);
  if (!from || !into || fromId === intoId) return null;

  // 계획(read-only) — 재지정 엣지 + into 새 props 를 먼저 계산(DB-first 를 위해)
  const touching = [...(outMap.get(fromId) ?? []), ...(inMap.get(fromId) ?? [])];
  const moved: Edge[] = [];
  const seenKeys = new Set<string>();
  for (const e of touching) {
    const src = e.src === fromId ? intoId : e.src;
    const dst = e.dst === fromId ? intoId : e.dst;
    if (src === dst) continue; // 자기 루프 제거
    const key = `${src}|${e.rel}|${dst}`;
    if (edgeKeySet.has(key) || seenKeys.has(key)) continue; // into 기존/배치 내 중복 제거
    seenKeys.add(key);
    moved.push({ ...e, src, dst });
  }
  const intoProps: [string, string][] = [
    ...(into.props ?? []),
    ["병합됨", `${from.label} (${from.id})`], // 원본 보존 골든 룰
  ];

  if (HAS_DB) await db.persistMergeNodes(fromId, intoId, moved, intoProps);

  // 메모리 적용
  for (const e of touching) dropEdge(e);
  for (const ne of moved) {
    const key = `${ne.src}|${ne.rel}|${ne.dst}`;
    edgeKeySet.add(key);
    EDGES.push(ne);
    push(outMap, ne.src, ne);
    push(inMap, ne.dst, ne);
    degree.set(ne.src, (degree.get(ne.src) ?? 0) + 1);
    degree.set(ne.dst, (degree.get(ne.dst) ?? 0) + 1);
  }
  into.props = intoProps;
  byId.delete(fromId);
  const i = NODES.findIndex((n) => n.id === fromId);
  if (i >= 0) NODES.splice(i, 1);
  return moved;
}

export async function setActiveDrawing(projId: string): Promise<void> {
  if (HAS_DB) await db.persistMeta("active_drawing", projId);
  ACTIVE_DRAWING = projId;
}
export function getActiveDrawing(): string | null { return ACTIVE_DRAWING; }

// ── 원시 접근자 (search/infer 공용 — 전부 인메모리 캐시에서 sync 읽기) ──
export function getNode(id: string): Node | undefined { return byId.get(id); }
export function allNodes(): Node[] { return [...byId.values()]; }
export function allEdges(): Edge[] { return EDGES.filter((e) => byId.has(e.src) && byId.has(e.dst)); }
export function outEdges(id: string): Edge[] { return outMap.get(id) ?? []; }
export function inEdges(id: string): Edge[] { return inMap.get(id) ?? []; }
export function deg(id: string): number { return degree.get(id) ?? 0; }

/** 이웃 노드 (rel 필터·방향 옵션) */
export function neighbors(
  id: string,
  opts: { rel?: string | string[]; dir?: "in" | "out" | "both" } = {}
): Node[] {
  const { rel, dir = "both" } = opts;
  const rels = rel == null ? null : Array.isArray(rel) ? rel : [rel];
  const relOk = (r: string) => rels == null || rels.includes(r);
  const out: Node[] = [];
  const seen = new Set<string>();
  const collect = (edges: Edge[], key: "src" | "dst") => {
    for (const e of edges) {
      if (!relOk(e.rel)) continue;
      const otherId = e[key];
      if (seen.has(otherId)) continue;
      const nn = byId.get(otherId);
      if (nn) { seen.add(otherId); out.push(nn); }
    }
  };
  if (dir === "out" || dir === "both") collect(outEdges(id), "dst");
  if (dir === "in" || dir === "both") collect(inEdges(id), "src");
  return out;
}

/** 근거 문서: id 에서 EVIDENCED_BY 로 연결된 doc 들 */
export function evidenceOf(id: string): Doc[] {
  return outEdges(id)
    .filter((e) => e.rel === "EVIDENCED_BY")
    .map((e) => byId.get(e.dst))
    .filter((n): n is Node => !!n && n.type === "doc")
    .map((n) => ({ id: n.id, ext: n.ext ?? "DOC", filename: n.label, props: n.props }));
}

/** 그래프 조회. stage: 'core'=문서 제외, 'all'=전체 */
export function getGraph(opts: { stage?: "core" | "all" } = {}): { nodes: Node[]; edges: Edge[] } {
  const { stage = "all" } = opts;
  const nodes = stage === "core" ? allNodes().filter((n) => n.type !== "doc") : allNodes();
  const ids = new Set(nodes.map((n) => n.id));
  const edges = allEdges().filter((e) => ids.has(e.src) && ids.has(e.dst));
  return { nodes, edges };
}

/** 인스펙터용 상세 */
export function getObject(id: string): ObjectDetail | null {
  const n = byId.get(id);
  if (!n) return null;
  const relations: Rel[] = [];
  for (const e of outEdges(id)) {
    const o = byId.get(e.dst);
    if (o) relations.push({ rel: e.rel, dir: "out", other: o.id, otherLabel: o.label });
  }
  for (const e of inEdges(id)) {
    const o = byId.get(e.src);
    if (o) relations.push({ rel: e.rel, dir: "in", other: o.id, otherLabel: o.label });
  }
  return { ...n, relations, evidence: evidenceOf(id) };
}
