// 인메모리 온톨로지 저장소 (MVP). 무상태 — 모듈 로드 시 seed로 인덱스 구축.
// 확장: 이 파일 구현만 Postgres 등으로 교체(시그니처 유지). docs/features/ontology-store.md
import type { Node, Edge, ObjectDetail, Rel, Doc } from "./types";
import { NODES as SEED_NODES, EDGES as SEED_EDGES } from "./seed";
import { ingestAll } from "./ingest/index";
import type { SourceInfo } from "./ingest/index";

// 온톨로지 출처: 실제 원천 파일(data/sources) 인제스천 우선, 실패/공백 시 seed 폴백.
// docs/features/ingestion.md
// (복사본으로 보관 — 증분 병합(mergeDelta)이 배열을 mutate 하므로 원본 seed/인제스천 결과를 오염시키지 않는다)
let NODES: Node[];
let EDGES: Edge[];
try {
  const ing = ingestAll();
  if (ing.nodes.length > 0) {
    NODES = [...ing.nodes];
    EDGES = [...ing.edges];
  } else {
    NODES = [...SEED_NODES];
    EDGES = [...SEED_EDGES];
  }
} catch {
  NODES = [...SEED_NODES];
  EDGES = [...SEED_EDGES];
}

const byId = new Map<string, Node>();
const outMap = new Map<string, Edge[]>();
const inMap = new Map<string, Edge[]>();
const degree = new Map<string, number>();
const edgeKeySet = new Set<string>(); // `${src}|${rel}|${dst}` — 증분 병합의 idempotency 판정용

function push(map: Map<string, Edge[]>, k: string, e: Edge) {
  const arr = map.get(k);
  if (arr) arr.push(e);
  else map.set(k, [e]);
}

for (const n of NODES) byId.set(n.id, n);
for (const e of EDGES) {
  edgeKeySet.add(`${e.src}|${e.rel}|${e.dst}`);
  // 양끝 객체가 존재하는 링크만 채택(무결성)
  if (!byId.has(e.src) || !byId.has(e.dst)) continue;
  push(outMap, e.src, e);
  push(inMap, e.dst, e);
  degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
  degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
}

/* ────────────────────────── 증분 병합 (incremental ingestion) ──────────────────────────
 * 주의(멀티 레플리카): 이 병합은 "현재 프로세스"의 인메모리 상태만 바꾼다. dev/데모용으로 충분하지만
 * K8s 등에서 여러 레플리카로 띄우면 업로드가 한 파드에만 반영되므로, 클러스터 데모는
 * replicas=1 또는 sticky session 으로 운영할 것. (영속화 시 Postgres 교체 지점) */

/** 노드/엣지 델타를 인덱스에 증분 병합. idempotent — 같은 파일 재병합 시 빈 델타.
 * @returns addedNodes/addedEdges = 실제 새로 들어간 것만, touched = 새 엣지를 얻은 "기존" 노드 id */
export function mergeDelta(nodes: Node[], edges: Edge[]): { addedNodes: Node[]; addedEdges: Edge[]; touched: string[] } {
  const addedNodes: Node[] = [];
  const addedIds = new Set<string>();
  for (const n of nodes) {
    if (byId.has(n.id)) continue; // 기존 노드 우선(원본 보존) — 새 파일이 기존 객체를 덮어쓰지 않는다
    byId.set(n.id, n);
    NODES.push(n);
    addedNodes.push(n);
    addedIds.add(n.id);
  }
  const addedEdges: Edge[] = [];
  const touchedSet = new Set<string>();
  for (const e of edges) {
    if (!byId.has(e.src) || !byId.has(e.dst)) continue; // 무결성 — 양끝 존재 시에만 채택
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
  return { addedNodes, addedEdges, touched: [...touchedSet] };
}

// 런타임(업로드) 인제스천 출처 — /api/sources 가 정적 data/sources 목록에 병합해 노출한다.
const RUNTIME_SOURCES: SourceInfo[] = [];

/** 업로드로 들어온 원천 파일을 출처 목록에 등록(같은 파일명 재업로드 시 최신으로 교체). */
export function registerSource(s: SourceInfo): void {
  const i = RUNTIME_SOURCES.findIndex((x) => x.file === s.file);
  if (i >= 0) RUNTIME_SOURCES[i] = s;
  else RUNTIME_SOURCES.push(s);
}

/** 런타임 등록 출처 목록(복사본). */
export function getRuntimeSources(): SourceInfo[] {
  return [...RUNTIME_SOURCES];
}

/* ────────────────── 큐레이션: 삭제·병합 (인메모리 — 재시작 시 원복) ────────────────── */

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
export function removeEdge(src: string, rel: string, dst: string): boolean {
  const e = (outMap.get(src) ?? []).find((x) => x.rel === rel && x.dst === dst);
  if (!e) return false;
  dropEdge(e);
  return true;
}

/** 노드 + 부속 엣지 삭제. @returns 지운 엣지 수(없는 노드면 -1). */
export function removeNode(id: string): number {
  if (!byId.has(id)) return -1;
  const touching = [...(outMap.get(id) ?? []), ...(inMap.get(id) ?? [])];
  for (const e of touching) dropEdge(e);
  outMap.delete(id);
  inMap.delete(id);
  byId.delete(id);
  const i = NODES.findIndex((n) => n.id === id);
  if (i >= 0) NODES.splice(i, 1);
  return touching.length;
}

/** from 노드를 into 노드에 병합 — from 의 관계를 into 로 이관(중복·자기루프 제거),
 * from 라벨은 into 의 "병합됨" 속성으로 보존(원본 보존 골든 룰), from 삭제.
 * @returns 이관된 엣지 목록(실패 시 null). */
export function mergeNodes(fromId: string, intoId: string): Edge[] | null {
  const from = byId.get(fromId);
  const into = byId.get(intoId);
  if (!from || !into || fromId === intoId) return null;
  const moved: Edge[] = [];
  const touching = [...(outMap.get(fromId) ?? []), ...(inMap.get(fromId) ?? [])];
  for (const e of touching) {
    const src = e.src === fromId ? intoId : e.src;
    const dst = e.dst === fromId ? intoId : e.dst;
    dropEdge(e);
    if (src === dst) continue; // 자기 루프 제거
    const key = `${src}|${e.rel}|${dst}`;
    if (edgeKeySet.has(key)) continue; // into 에 이미 있는 관계면 중복 제거
    const ne: Edge = { ...e, src, dst };
    edgeKeySet.add(key);
    EDGES.push(ne);
    push(outMap, src, ne);
    push(inMap, dst, ne);
    degree.set(src, (degree.get(src) ?? 0) + 1);
    degree.set(dst, (degree.get(dst) ?? 0) + 1);
    moved.push(ne);
  }
  into.props ??= [];
  into.props.push(["병합됨", `${from.label} (${from.id})`]); // 원본 보존
  byId.delete(fromId);
  const i = NODES.findIndex((n) => n.id === fromId);
  if (i >= 0) NODES.splice(i, 1);
  return moved;
}

// "이 도면/이 커넥터"의 지시 대상 — 마지막으로 분석·추가된 도면 프로젝트 id (대화 컨텍스트).
let ACTIVE_DRAWING: string | null = null;
export function setActiveDrawing(projId: string): void { ACTIVE_DRAWING = projId; }
export function getActiveDrawing(): string | null { return ACTIVE_DRAWING; }

// ── 원시 접근자 (search/infer 공용) ──
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

/** 관계 경로 탐색: relPath를 순서대로 따라간 끝 노드들 */
export function traverse(startId: string, relPath: string[]): Node[] {
  let frontier = new Set<string>([startId]);
  for (const rel of relPath) {
    const next = new Set<string>();
    for (const id of frontier) for (const n of neighbors(id, { rel })) next.add(n.id);
    frontier = next;
  }
  return [...frontier].map((id) => byId.get(id)!).filter(Boolean);
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
