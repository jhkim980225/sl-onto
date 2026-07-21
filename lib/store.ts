// 온톨로지 저장소. 읽기 = 인메모리 인덱스(캐시), 원본 = Postgres(DATABASE_URL 있을 때).
// write-through: 쓰기는 DB 커밋 성공 후에만 메모리 반영(캐시/DB 정합). docs/features/온톨로지-저장소.md
//
// 모드:
//   - DATABASE_URL 없음: 기존 인메모리 전용(모듈 로드 시 ingest→인덱스 구축). 테스트·로컬 개발 무변경.
//   - DATABASE_URL 있음: 모듈 로드는 비움, ready() 가 스키마·시드 후 DB 적재 or 최초 ingest 를 DB 로 승격.
import type { Node, Edge, ObjectDetail, Rel, Doc } from "./types";
import { NODES as SEED_NODES, EDGES as SEED_EDGES } from "./seed";
import { ingestAll } from "./ingest/index";
import type { SourceInfo } from "./ingest/index";
import * as db from "./db";
import { backfillEmbeddings, backfillChunks } from "./embed";
import { OBJECT_TYPES, RELATION_TYPES, OBJECT_SUBTYPES, PROPERTY_DEFS } from "./db/seed-metamodel";
import type { Metamodel } from "./db/seed-metamodel";
import { classifyMissing } from "./schema/classify";
import { currentCanvas, withCanvas, DEFAULT_CANVAS } from "./canvas-context";

const HAS_DB = db.dbEnabled();

/** 임베딩 백필을 백그라운드로(부팅·병합 비차단, 실패 무해 — backfillEmbeddings 자체가 멱등·no-throw).
 * 동시 실행 1개로 제한 — 실행 중 재요청은 완료 후 1회 재실행(그 사이 추가된 노드 커버).
 * canvasId 를 받아 withCanvas 로 다시 깐다 — 백그라운드 태스크는 요청 ALS 컨텍스트 밖에서 돈다. */
let backfillRunning = false;
// 대기 중인 캔버스 id 집합. 불린 하나였을 때는 "누가 대기 중인지"를 잃어서, A 백필이 도는 중
// B 가 요청하면 재실행이 A 로 걸리고 B 의 노드가 영원히 embedding IS NULL 로 남았다
// (시맨틱 검색·중복 감사에서 조용히 누락).
const backfillPending = new Set<string>();
function scheduleEmbedBackfill(canvasId: string) {
  if (!HAS_DB) return;
  if (backfillRunning) {
    backfillPending.add(canvasId);
    return;
  }
  backfillRunning = true;
  void withCanvas(canvasId, async () => {
    const nodes = await backfillEmbeddings();
    const chunks = await backfillChunks(); // 노드 다음 — 둘 다 멱등이라 순서는 성능 문제일 뿐
    return { nodes, chunks };
  })
    .then((r) => {
      if (!r.nodes.skipped && r.nodes.embedded > 0)
        console.log(`[embed] auto-backfill: 노드 ${r.nodes.embedded}개 임베딩 생성`);
      if (!r.chunks.skipped && (r.chunks.chunked > 0 || r.chunks.embedded > 0))
        console.log(`[embed] auto-backfill: 청크 ${r.chunks.chunked}개 생성 / ${r.chunks.embedded}개 임베딩`);
    })
    .catch(() => {})
    .finally(() => {
      backfillRunning = false;
      const next = backfillPending.values().next();
      if (!next.done) {
        backfillPending.delete(next.value);
        scheduleEmbedBackfill(next.value);
      }
    });
}

// ── 캔버스별 인메모리 인덱스 ──
// 기존에는 모듈 레벨 1벌이었다. 다중 캔버스에서는 캔버스마다 1벌이며,
// 공개 함수는 시그니처를 유지한 채 cache() 로 현재 캔버스 것을 집는다(호출부 276곳 무변경).
interface CanvasCache {
  nodes: Node[];
  edges: Edge[];
  byId: Map<string, Node>;
  outMap: Map<string, Edge[]>;
  inMap: Map<string, Edge[]>;
  degree: Map<string, number>;
  edgeKeySet: Set<string>; // `${src}|${rel}|${dst}` — 증분 병합 idempotency 판정용
  // 런타임(업로드) 인제스천 출처 — /api/sources 가 정적 data/sources 목록에 병합해 노출한다.
  sources: SourceInfo[];
  // "이 도면/이 커넥터"의 지시 대상 — 마지막으로 분석·추가된 도면 프로젝트 id (대화 컨텍스트).
  activeDrawing: string | null;
  // 메타모델 — 기본은 시드, DB 모드는 hydrate 시 DB 값으로 교체(자동 등록 관계 포함).
  metamodel: Metamodel;
  lastSyncAt: number;
  readyPromise?: Promise<void>;
  syncInFlight?: Promise<void>;
}

const EMPTY_METAMODEL: Metamodel = { objectTypes: [], relationTypes: [], subtypes: [], propertyDefs: [] };

function newCache(canvasId: string): CanvasCache {
  return {
    nodes: [],
    edges: [],
    byId: new Map(),
    outMap: new Map(),
    inMap: new Map(),
    degree: new Map(),
    edgeKeySet: new Set(),
    sources: [],
    activeDrawing: null,
    // 부트스트랩 캔버스는 FMEA 시드가 기본값(기존 동작 유지). 사용자 캔버스는 빈 스키마.
    metamodel:
      canvasId === DEFAULT_CANVAS
        ? { objectTypes: OBJECT_TYPES, relationTypes: RELATION_TYPES, subtypes: OBJECT_SUBTYPES, propertyDefs: PROPERTY_DEFS }
        : EMPTY_METAMODEL,
    lastSyncAt: 0,
  };
}

const CACHES = new Map<string, CanvasCache>();

function cache(): CanvasCache {
  const id = currentCanvas();
  let c = CACHES.get(id);
  if (!c) {
    c = newCache(id);
    CACHES.set(id, c);
  }
  return c;
}

/** 캔버스 캐시 폐기 — 캔버스 삭제·스키마 변경 후 다음 요청이 DB 에서 다시 읽게 한다. */
export function dropCanvasCache(canvasId: string): void {
  CACHES.delete(canvasId);
}

// ponytail: 캔버스 캐시 전량 상주. 캔버스가 수백 개 되거나 캔버스당 노드가 수만 되면 LRU 축출로 교체.

export function getMetamodel(): Metamodel {
  return cache().metamodel;
}

/** 스키마 편집 후 메타모델 캐시 갱신 — 다음 요청이 새 타입을 즉시 본다.
 * c.metamodel 은 hydrate() 에서만 채워지고 TTL 재동기화(syncFromDb)는 노드·엣지·소스만 다시 읽는다.
 * 따라서 스키마 편집 뒤에는 이 함수를 명시적으로 불러야 한다.
 * dropCanvasCache 로 캐시를 통째로 버리면 readyPromise 까지 날아가 다음 요청이 full hydrate
 * (loadAll + 재인덱스 + 서브타입 백필 + 임베딩 백필)를 탄다 — 메타모델 1필드 갱신에는 과하다. */
export async function reloadMetamodel(): Promise<void> {
  if (!HAS_DB) return;
  cache().metamodel = await db.loadMetamodel();
}

function push(map: Map<string, Edge[]>, k: string, e: Edge) {
  const arr = map.get(k);
  if (arr) arr.push(e);
  else map.set(k, [e]);
}

/** 노드/엣지 배열로 인덱스 전체 재구축(리셋 후 채움). DB 적재·모듈로드 공용. */
function rebuildIndex(c: CanvasCache, nodes: Node[], edges: Edge[]) {
  c.nodes = [...nodes];
  c.edges = [];
  c.byId.clear();
  c.outMap.clear();
  c.inMap.clear();
  c.degree.clear();
  c.edgeKeySet.clear();
  for (const n of c.nodes) c.byId.set(n.id, n);
  for (const e of edges) {
    const key = `${e.src}|${e.rel}|${e.dst}`;
    if (c.edgeKeySet.has(key)) continue;
    c.edgeKeySet.add(key);
    if (!c.byId.has(e.src) || !c.byId.has(e.dst)) continue; // 양끝 존재 링크만(무결성)
    c.edges.push(e);
    push(c.outMap, e.src, e);
    push(c.inMap, e.dst, e);
    c.degree.set(e.src, (c.degree.get(e.src) ?? 0) + 1);
    c.degree.set(e.dst, (c.degree.get(e.dst) ?? 0) + 1);
  }
}

/** data/sources 인제스천(실패·공백 시 seed 폴백). 모듈로드/최초 DB 적재 공용. */
function ingestOrSeed(metamodel: Metamodel): { nodes: Node[]; edges: Edge[]; sources: SourceInfo[] } {
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
  for (const a of classifyMissing(got.nodes, metamodel.subtypes)) {
    const n = got.nodes.find((x) => x.id === a.id);
    if (n) n.st = a.st;
  }
  return got;
}

// DATABASE_URL 없으면 지금 즉시 인메모리 구축(기존 동작 — sync 테스트가 ready() 없이 읽는다).
// 다중 캔버스에서도 이 결과는 기본 캔버스 캐시에만 들어간다.
if (!HAS_DB) {
  const boot = newCache(DEFAULT_CANVAS);
  const seed = ingestOrSeed(boot.metamodel);
  rebuildIndex(boot, seed.nodes, seed.edges);
  boot.sources = [...seed.sources];
  CACHES.set(DEFAULT_CANVAS, boot);
}

/* ────────────────────────── 부팅(ready) — DB 모드 하이드레이션 + 요청별 재동기화 ──────────────────────────
 * 모든 API Route Handler 는 첫 줄에서 await ready().
 * DB 직독 1단계(스펙 2026-07-09-db-first-reads): 첫 요청 = 하이드레이션(스키마·시드·백필 포함),
 * 이후 요청 = 매번 loadAll() 재동기화 — 인덱스는 "요청 시점 DB 스냅샷". psql 등 외부 변경도 즉시 반영.
 * 동시 요청은 진행 중 동기화 프로미스를 공유(중복 SELECT 방지). 실패는 캐시하지 않는다. */
// readyPromise · syncInFlight · lastSyncAt 은 캔버스 캐시 안에 있다(캔버스별 독립 부팅).
// 재동기화 TTL — 이 창 안의 연속 요청은 직전 스냅샷 재사용(요청당 4쿼리+O(V+E) 재인덱스 절감).
// psql 직접 변경 반영이 최대 2초 지연되지만 브라우저 새로고침 한 번보다 짧다 — DB 직독 체감 불변.
const SYNC_TTL_MS = 2000;

async function syncFromDb(c: CanvasCache): Promise<void> {
  const { nodes, edges, sources, activeDrawing } = await db.loadAll();
  rebuildIndex(c, nodes, edges);
  c.sources = [...sources];
  c.activeDrawing = activeDrawing;
  c.lastSyncAt = Date.now();
}

export function ready(): Promise<void> {
  if (!HAS_DB) return Promise.resolve(); // 인메모리는 모듈로드에서 이미 구축됨(테스트·로컬 전용)
  const canvasId = currentCanvas();
  const c = cache();
  if (!c.readyPromise) {
    c.readyPromise = hydrate(c, canvasId).catch((e) => {
      c.readyPromise = undefined; // 실패 캐시 안 함 — 다음 요청이 재시도
      throw e;
    });
    return c.readyPromise;
  }
  if (Date.now() - c.lastSyncAt < SYNC_TTL_MS) return c.readyPromise; // TTL 내 — 스냅샷 재사용
  // 부팅 이후: TTL 지난 요청은 DB 재동기화(동시 요청은 공유)
  // .then() 안은 새 마이크로태스크라 ALS 컨텍스트를 이미 벗어났다 — withCanvas 로 다시 깐다.
  c.syncInFlight ??= c.readyPromise
    .then(() => withCanvas(canvasId, () => syncFromDb(c)))
    .finally(() => {
      c.syncInFlight = undefined;
    });
  return c.syncInFlight;
}

async function hydrate(c: CanvasCache, canvasId: string): Promise<void> {
  await db.ready(); // 스키마 적용 + 메타모델 시드(멱등)
  // await 뒤는 ALS 컨텍스트가 유실될 수 있다 — 이후 DB 호출 전체를 캔버스 컨텍스트로 다시 감싼다.
  await withCanvas(canvasId, async () => {
    c.metamodel = await db.loadMetamodel(); // 자동 등록된 관계 타입 포함 — 검증·내보내기의 기준
    // 최초 부팅 판정에 change_log 를 함께 본다. 노드 수 0 만 보면 "한 번도 안 채웠다" 와
    // "채웠다가 문서를 전부 지웠다" 를 구분하지 못해, 사용자가 정리한 뒤 파드가 재시작하면
    // data/sources 40건이 조용히 되살아난다. 쓰기 이력이 있으면 이미 채운 적이 있는 캔버스다.
    if ((await db.nodeCount()) === 0 && canvasId === DEFAULT_CANVAS && (await db.changeLogCount()) === 0) {
      // 부트스트랩 캔버스 최초 부팅에만 data/sources 인제스천을 DB 로 승격.
      // 사용자가 만든 빈 캔버스는 비어 있는 것이 정상이다(설계 §3.4).
      const seed = ingestOrSeed(c.metamodel);
      rebuildIndex(c, seed.nodes, seed.edges);
      c.sources = [...seed.sources];
      await db.bulkInsertGraph(c.nodes, c.edges, seed.sources);
    } else {
      // 재부팅: DB 가 원본 — 그대로 적재
      const { nodes, edges, sources, activeDrawing } = await db.loadAll();
      rebuildIndex(c, nodes, edges);
      c.sources = [...sources];
      c.activeDrawing = activeDrawing;
      // 구버전 적재분 서브타입 백필 — DB 커밋 성공 후 메모리 반영(write-through 관례)
      const assigns = classifyMissing(c.nodes, c.metamodel.subtypes);
      if (assigns.length > 0) {
        await db.persistSubtypeAssignments(assigns);
        for (const a of assigns) {
          const n = c.byId.get(a.id);
          if (n) n.st = a.st;
        }
        console.log(`[schema] 서브타입 백필: ${assigns.length}건 분류`);
      }
    }
    c.lastSyncAt = Date.now();
    scheduleEmbedBackfill(canvasId); // 부팅 후 누락 임베딩 자동 채움(비차단)
  });
}

/* ────────────────────────── 증분 병합 (인제스천·도면 추가) ──────────────────────────
 * write-through: HAS_DB 이면 DB 에 먼저 upsert(ON CONFLICT DO NOTHING) 후 메모리 병합. */

/** 노드/엣지 델타를 병합. idempotent. @returns 실제 새로 들어간 것 + 새 엣지를 얻은 기존 노드 id. */
export async function mergeDelta(
  nodes: Node[],
  edges: Edge[],
  op: string = "ingest"
): Promise<{ addedNodes: Node[]; addedEdges: Edge[]; touched: string[] }> {
  const canvasId = currentCanvas();
  const c = cache();
  // 신규 노드 서브타입 분류 — DB 삽입 전에 st 포함(기존 노드는 ON CONFLICT 로 불변)
  for (const a of classifyMissing(nodes, c.metamodel.subtypes)) {
    const n = nodes.find((x) => x.id === a.id);
    if (n) n.st = a.st;
  }
  if (HAS_DB) await db.persistUpsertGraph(nodes, edges, op); // DB 먼저(정합 실패 시 여기서 throw → 메모리 미변경)
  const addedNodes: Node[] = [];
  const addedIds = new Set<string>();
  for (const n of nodes) {
    if (c.byId.has(n.id)) continue; // 기존 노드 우선(원본 보존)
    c.byId.set(n.id, n);
    c.nodes.push(n);
    addedNodes.push(n);
    addedIds.add(n.id);
  }
  const addedEdges: Edge[] = [];
  const touchedSet = new Set<string>();
  for (const e of edges) {
    if (!c.byId.has(e.src) || !c.byId.has(e.dst)) continue;
    const key = `${e.src}|${e.rel}|${e.dst}`;
    if (c.edgeKeySet.has(key)) continue;
    c.edgeKeySet.add(key);
    c.edges.push(e);
    push(c.outMap, e.src, e);
    push(c.inMap, e.dst, e);
    c.degree.set(e.src, (c.degree.get(e.src) ?? 0) + 1);
    c.degree.set(e.dst, (c.degree.get(e.dst) ?? 0) + 1);
    addedEdges.push(e);
    if (!addedIds.has(e.src)) touchedSet.add(e.src);
    if (!addedIds.has(e.dst)) touchedSet.add(e.dst);
  }
  if (addedNodes.length > 0) scheduleEmbedBackfill(canvasId); // 새 노드는 벡터 검색에도 보이게(비차단)
  return { addedNodes, addedEdges, touched: [...touchedSet] };
}

/** 업로드 원천 파일 등록(같은 파일명 재업로드 시 최신 교체). content = DB 보존용 원본 바이트(선택). */
export async function registerSource(s: SourceInfo, content?: Buffer): Promise<void> {
  if (HAS_DB) await db.persistSource(s, content);
  const c = cache();
  const i = c.sources.findIndex((x) => x.file === s.file);
  if (i >= 0) c.sources[i] = s;
  else c.sources.push(s);
}

/** 원천 등록 해제 — DB 행(+원본 바이트) 삭제 후 캐시 목록에서 제거(write-through).
 * 캐시 목록에서 빼야 /api/sources 가 삭제를 반영한다. */
export async function removeSource(file: string): Promise<void> {
  if (HAS_DB) await db.deleteSource(file);
  const c = cache();
  const i = c.sources.findIndex((x) => x.file === file);
  if (i >= 0) c.sources.splice(i, 1);
}

/** 런타임 등록 출처 목록(복사본). */
export function getRuntimeSources(): SourceInfo[] {
  return [...cache().sources];
}

/* ────────────────── 큐레이션: 삭제·병합 (write-through) ────────────────── */

function dropEdge(c: CanvasCache, e: Edge): void {
  const key = `${e.src}|${e.rel}|${e.dst}`;
  c.edgeKeySet.delete(key);
  const i = c.edges.indexOf(e);
  if (i >= 0) c.edges.splice(i, 1);
  const om = c.outMap.get(e.src);
  if (om) { const j = om.indexOf(e); if (j >= 0) om.splice(j, 1); }
  const im = c.inMap.get(e.dst);
  if (im) { const j = im.indexOf(e); if (j >= 0) im.splice(j, 1); }
  c.degree.set(e.src, Math.max(0, (c.degree.get(e.src) ?? 1) - 1));
  c.degree.set(e.dst, Math.max(0, (c.degree.get(e.dst) ?? 1) - 1));
}

/** 관계 1개 삭제. 존재했으면 true. */
export async function removeEdge(src: string, rel: string, dst: string): Promise<boolean> {
  const c = cache();
  const e = (c.outMap.get(src) ?? []).find((x) => x.rel === rel && x.dst === dst);
  if (!e) return false;
  if (HAS_DB) await db.persistDeleteEdge(src, rel, dst);
  dropEdge(c, e);
  return true;
}

/** 노드 + 부속 엣지 삭제. @returns 지운 엣지 수(없는 노드면 -1). */
export async function removeNode(id: string): Promise<number> {
  const c = cache();
  if (!c.byId.has(id)) return -1;
  const touching = [...(c.outMap.get(id) ?? []), ...(c.inMap.get(id) ?? [])];
  if (HAS_DB) await db.persistDeleteNode(id); // DB 는 엣지 CASCADE
  for (const e of touching) dropEdge(c, e);
  c.outMap.delete(id);
  c.inMap.delete(id);
  c.byId.delete(id);
  const i = c.nodes.findIndex((n) => n.id === id);
  if (i >= 0) c.nodes.splice(i, 1);
  return touching.length;
}

/** from 노드를 into 에 병합 — 관계 이관(중복·자기루프 제거), from 라벨은 into "병합됨" 속성으로 보존, from 삭제.
 * @returns 이관된 엣지 목록(실패 시 null). */
export async function mergeNodes(fromId: string, intoId: string): Promise<Edge[] | null> {
  const c = cache();
  const from = c.byId.get(fromId);
  const into = c.byId.get(intoId);
  if (!from || !into || fromId === intoId) return null;

  // 계획(read-only) — 재지정 엣지 + into 새 props 를 먼저 계산(DB-first 를 위해)
  const touching = [...(c.outMap.get(fromId) ?? []), ...(c.inMap.get(fromId) ?? [])];
  const moved: Edge[] = [];
  const seenKeys = new Set<string>();
  for (const e of touching) {
    const src = e.src === fromId ? intoId : e.src;
    const dst = e.dst === fromId ? intoId : e.dst;
    if (src === dst) continue; // 자기 루프 제거
    const key = `${src}|${e.rel}|${dst}`;
    if (c.edgeKeySet.has(key) || seenKeys.has(key)) continue; // into 기존/배치 내 중복 제거
    seenKeys.add(key);
    moved.push({ ...e, src, dst });
  }
  const intoProps: [string, string][] = [
    ...(into.props ?? []),
    ["병합됨", `${from.label} (${from.id})`], // 원본 보존 골든 룰
  ];

  if (HAS_DB) await db.persistMergeNodes(fromId, intoId, moved, intoProps);

  // 메모리 적용
  for (const e of touching) dropEdge(c, e);
  for (const ne of moved) {
    const key = `${ne.src}|${ne.rel}|${ne.dst}`;
    c.edgeKeySet.add(key);
    c.edges.push(ne);
    push(c.outMap, ne.src, ne);
    push(c.inMap, ne.dst, ne);
    c.degree.set(ne.src, (c.degree.get(ne.src) ?? 0) + 1);
    c.degree.set(ne.dst, (c.degree.get(ne.dst) ?? 0) + 1);
  }
  into.props = intoProps;
  c.byId.delete(fromId);
  const i = c.nodes.findIndex((n) => n.id === fromId);
  if (i >= 0) c.nodes.splice(i, 1);
  return moved;
}

export async function setActiveDrawing(projId: string): Promise<void> {
  if (HAS_DB) await db.persistMeta("active_drawing", projId);
  cache().activeDrawing = projId;
}
export function getActiveDrawing(): string | null { return cache().activeDrawing; }

// ── 원시 접근자 (search/infer 공용 — 전부 인메모리 캐시에서 sync 읽기) ──
export function getNode(id: string): Node | undefined { return cache().byId.get(id); }
export function allNodes(): Node[] { return [...cache().byId.values()]; }
export function allEdges(): Edge[] {
  const c = cache();
  return c.edges.filter((e) => c.byId.has(e.src) && c.byId.has(e.dst));
}
export function outEdges(id: string): Edge[] { return cache().outMap.get(id) ?? []; }
export function inEdges(id: string): Edge[] { return cache().inMap.get(id) ?? []; }
export function deg(id: string): number { return cache().degree.get(id) ?? 0; }

/** 이웃 노드 (rel 필터·방향 옵션) */
export function neighbors(
  id: string,
  opts: { rel?: string | string[]; dir?: "in" | "out" | "both" } = {}
): Node[] {
  const { rel, dir = "both" } = opts;
  const c = cache();
  const rels = rel == null ? null : Array.isArray(rel) ? rel : [rel];
  const relOk = (r: string) => rels == null || rels.includes(r);
  const out: Node[] = [];
  const seen = new Set<string>();
  const collect = (edges: Edge[], key: "src" | "dst") => {
    for (const e of edges) {
      if (!relOk(e.rel)) continue;
      const otherId = e[key];
      if (seen.has(otherId)) continue;
      const nn = c.byId.get(otherId);
      if (nn) { seen.add(otherId); out.push(nn); }
    }
  };
  if (dir === "out" || dir === "both") collect(outEdges(id), "dst");
  if (dir === "in" || dir === "both") collect(inEdges(id), "src");
  return out;
}

/** 근거 문서: id 에서 EVIDENCED_BY 로 연결된 doc 들 */
export function evidenceOf(id: string): Doc[] {
  const c = cache();
  return outEdges(id)
    .filter((e) => e.rel === "EVIDENCED_BY")
    .map((e) => c.byId.get(e.dst))
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
  const c = cache();
  const n = c.byId.get(id);
  if (!n) return null;
  const relations: Rel[] = [];
  for (const e of outEdges(id)) {
    const o = c.byId.get(e.dst);
    if (o) relations.push({ rel: e.rel, dir: "out", other: o.id, otherLabel: o.label });
  }
  for (const e of inEdges(id)) {
    const o = c.byId.get(e.src);
    if (o) relations.push({ rel: e.rel, dir: "in", other: o.id, otherLabel: o.label });
  }
  return { ...n, relations, evidence: evidenceOf(id) };
}
