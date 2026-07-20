// lib/db.ts — Postgres 영속화 계층 (node-postgres).
// DB = 유일한 원본, 인메모리 = 읽기 캐시(write-through). store.ts 가 이 함수들로 부팅·쓰기를 오케스트레이션한다.
// DATABASE_URL 없으면 DB 모드 아님(store 가 기존 인메모리 경로 사용) — dbEnabled() 로 분기.
// 모든 값은 파라미터 바인딩($n)으로만 전달(문자열 보간 금지 — 보안). JSONB 는 JSON.stringify 후 바인딩.
// 설계: docs/superpowers/specs/2026-07-07-postgres-python-1차-design.md
import * as fs from "node:fs";
import * as path from "node:path";
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import type { Node, Edge } from "./types";
import type { SourceInfo } from "./ingest/index";
import { OBJECT_TYPES, RELATION_TYPES, OBJECT_SUBTYPES, PROPERTY_DEFS } from "./db/seed-metamodel";
import type { Metamodel, ObjectTypeSeed, RelationTypeSeed, SubtypeSeed, PropertyDefSeed } from "./db/seed-metamodel";
// 모든 읽기·쓰기는 "현재 캔버스" 로 스코핑된다. 컨텍스트 밖이면 DEFAULT_CANVAS 폴백(모듈로드·테스트 경로).
import { DEFAULT_CANVAS, currentCanvas } from "./canvas-context";

const { Pool: PgPool } = pg;

export function dbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

// ── Pool 싱글턴 ──
let pool: Pool | undefined;
export function getPool(): Pool {
  if (!pool) pool = new PgPool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

// ── ready(): 스키마 적용 + 메타모델 시드. 동시 호출 안전(모듈 레벨 Promise 가드), 실패 시 재시도 허용. ──
let readyPromise: Promise<void> | undefined;
export function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = doReady().catch((e) => {
      readyPromise = undefined; // 실패한 부팅은 캐시하지 않는다 → 다음 요청에서 재시도(파드 재시작에 위임)
      throw e;
    });
  }
  return readyPromise;
}

async function doReady(): Promise<void> {
  const p = getPool();
  // cwd 기준 경로 — Next standalone(cwd=/app, Dockerfile 이 lib/db 복사)·테스트(cwd=repo root) 양쪽 안전.
  // import.meta.url/new URL 방식은 Next 번들에서 깨진다("path must be string/URL" TypeError).
  const dbDir = path.join(process.cwd(), "lib", "db");

  // 기존 DB(캔버스 이전 버전)면 마이그레이션 먼저 — schema.sql 은 복합 PK 를 전제하므로 순서가 중요.
  const legacy = await p.query<{ exists: boolean }>(
    `SELECT to_regclass('public.nodes') IS NOT NULL AND to_regclass('public.canvases') IS NULL AS exists`
  );
  if (legacy.rows[0]?.exists) {
    const sql = fs.readFileSync(path.join(dbDir, "migrations", "001-canvas.sql"), "utf8");
    await tx(async (c) => { await c.query(sql); }); // 단일 트랜잭션 — 실패 시 부분 적용 없음
    console.log("[db] 001-canvas 마이그레이션 적용 — 기존 데이터를 'default' 캔버스로 귀속");
  }

  await p.query(fs.readFileSync(path.join(dbDir, "schema.sql"), "utf8"));

  // 부트스트랩: 캔버스가 하나도 없는 완전 신규 DB 에만 default 캔버스 + FMEA 메타모델 시드.
  // 사용자가 만드는 캔버스는 빈 스키마로 시작한다(설계 §3.4).
  const cnt = await p.query<{ n: string }>("SELECT count(*)::text AS n FROM canvases");
  if (cnt.rows[0].n === "0") {
    await p.query(
      `INSERT INTO canvases (id, name, description) VALUES ($1, $2, $3)`,
      [DEFAULT_CANVAS, "램프", "SL 자동차 램프 FMEA — 기본 캔버스"]
    );
    await seedMetamodel(p, DEFAULT_CANVAS);
  }
}

// 매 부팅 멱등 실행(ON CONFLICT DO NOTHING) — 기존 DB 도 새 시드(서브타입·속성정의)를 얻는다.
// domain/range 는 기존 행이 빈 배열(구버전 시드)일 때만 UPDATE — 스키마 편집 UI 없으므로 안전.
async function seedMetamodel(p: Pool, canvasId: string): Promise<void> {
  for (const t of OBJECT_TYPES) {
    await p.query(
      `INSERT INTO object_types (canvas_id, type_id, label_ko, color, icon, description)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (canvas_id, type_id) DO NOTHING`,
      [canvasId, t.type_id, t.label_ko, t.color, t.icon, t.description]
    );
  }
  for (const r of RELATION_TYPES) {
    await p.query(
      `INSERT INTO relation_types (canvas_id, rel_id, label_ko, description, src_types, dst_types, directed)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (canvas_id, rel_id) DO NOTHING`,
      [canvasId, r.rel_id, r.label_ko, r.description, r.src_types, r.dst_types, r.directed]
    );
    if (r.src_types.length || r.dst_types.length) {
      await p.query(
        `UPDATE relation_types SET src_types = $2, dst_types = $3
         WHERE rel_id = $1 AND canvas_id = $4 AND src_types = '{}' AND dst_types = '{}'`,
        [r.rel_id, r.src_types, r.dst_types, canvasId]
      );
    }
  }
  for (const s of OBJECT_SUBTYPES) {
    await p.query(
      `INSERT INTO object_subtypes (canvas_id, type_id, st_id, label_ko, keywords, description)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (canvas_id, type_id, st_id) DO UPDATE SET keywords = EXCLUDED.keywords`, // keywords 만 갱신(라벨·설명 보존) — 기존 DB 도 확장 키워드로 백필되게
      [canvasId, s.type_id, s.st_id, s.label_ko, s.keywords, s.description ?? null]
    );
  }
  for (const d of PROPERTY_DEFS) {
    await p.query(
      `INSERT INTO property_defs (canvas_id, type_id, key, label_ko, datatype, options, required)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (canvas_id, type_id, key) DO NOTHING`,
      [canvasId, d.type_id, d.key, d.label_ko, d.datatype, d.options ?? [], d.required ?? false]
    );
  }
}

/** 메타모델 로드 — store 인메모리 캐시용(자동 등록된 관계 타입 포함). */
export async function loadMetamodel(): Promise<Metamodel> {
  const p = getPool();
  const cv = currentCanvas();
  const [ot, rt, st, pd] = await Promise.all([
    p.query<ObjectTypeSeed>("SELECT type_id, label_ko, color, icon, description FROM object_types WHERE canvas_id = $1", [cv]),
    p.query<RelationTypeSeed>("SELECT rel_id, label_ko, description, src_types, dst_types, directed FROM relation_types WHERE canvas_id = $1", [cv]),
    p.query<SubtypeSeed>("SELECT type_id, st_id, label_ko, keywords, description FROM object_subtypes WHERE canvas_id = $1", [cv]),
    p.query<PropertyDefSeed & { options: string[] }>("SELECT type_id, key, label_ko, datatype, options, required FROM property_defs WHERE canvas_id = $1", [cv]),
  ]);
  return { objectTypes: ot.rows, relationTypes: rt.rows, subtypes: st.rows, propertyDefs: pd.rows };
}

export async function nodeCount(): Promise<number> {
  const { rows } = await getPool().query<{ c: number }>(
    "SELECT count(*)::int AS c FROM nodes WHERE canvas_id = $1",
    [currentCanvas()]
  );
  return rows[0].c;
}

/** 업로드 원본 바이트 조회 — content NULL/행 없음이면 null (베이스라인은 디스크에서 읽음). */
export async function getSourceContent(file: string): Promise<Buffer | null> {
  if (!dbEnabled()) return null; // DB 모드 아니면 업로드 원본 없음(인메모리 폴백)
  const { rows } = await getPool().query<{ content: Buffer | null }>(
    "SELECT content FROM sources WHERE canvas_id = $1 AND file = $2",
    [currentCanvas(), file]
  );
  return rows[0]?.content ?? null;
}

/* ────────────────────────── Row ↔ 도메인 어댑터 (무손실 라운드트립) ────────────────────────── */

// Node 의 컬럼 외 필드는 전부 nodes.props JSONB 로 담는다(sub/hero/hidden/ax/ay/parent/ext/props).
function nodePropsJson(n: Node): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (n.sub !== undefined) p.sub = n.sub;
  if (n.st !== undefined) p.st = n.st;
  if (n.hero !== undefined) p.hero = n.hero;
  if (n.hidden !== undefined) p.hidden = n.hidden;
  if (n.ax !== undefined) p.ax = n.ax;
  if (n.ay !== undefined) p.ay = n.ay;
  if (n.parent !== undefined) p.parent = n.parent;
  if (n.ext !== undefined) p.ext = n.ext;
  if (n.props !== undefined) p.props = n.props;
  return p;
}

interface NodeRow { id: string; type: string; label: string; props: Record<string, unknown> | null }
function rowToNode(row: NodeRow): Node {
  const p = row.props ?? {};
  const n: Node = { id: row.id, type: row.type as Node["type"], label: row.label };
  if (p.sub !== undefined) n.sub = p.sub as string;
  if (p.st !== undefined) n.st = p.st as string;
  if (p.hero !== undefined) n.hero = p.hero as boolean;
  if (p.hidden !== undefined) n.hidden = p.hidden as boolean;
  if (p.ax !== undefined) n.ax = p.ax as number;
  if (p.ay !== undefined) n.ay = p.ay as number;
  if (p.parent !== undefined) n.parent = p.parent as string;
  if (p.ext !== undefined) n.ext = p.ext as string;
  if (p.props !== undefined) n.props = p.props as [string, string][];
  return n;
}

function edgePropsJson(e: Edge): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (e.weight !== undefined) p.weight = e.weight;
  if (e.scen !== undefined) p.scen = e.scen;
  return p;
}

interface EdgeRow { src: string; rel: string; dst: string; props: Record<string, unknown> | null }
function rowToEdge(row: EdgeRow): Edge {
  const p = row.props ?? {};
  const e: Edge = { src: row.src, rel: row.rel, dst: row.dst };
  if (p.weight !== undefined) e.weight = p.weight as number;
  if (p.scen !== undefined) e.scen = p.scen as boolean;
  return e;
}

// SourceInfo → sources 행: file/kind 컬럼 + 나머지는 meta JSONB.
interface SourceRow { file: string; kind: string | null; meta: Record<string, unknown> | null }
function rowToSource(row: SourceRow): SourceInfo {
  const m = (row.meta ?? {}) as Partial<SourceInfo>;
  return {
    file: row.file,
    type: row.kind ?? "",
    sizeBytes: m.sizeBytes ?? 0,
    extracted: m.extracted ?? { objects: 0, relations: 0 },
    preview: m.preview ?? [],
  };
}

// 임베딩 대상 텍스트 = label + 개행 + props 값 결합(작은 헬퍼).
function embedText(label: string, propsJson: Record<string, unknown> | null): string {
  const arr = (propsJson?.props ?? []) as [string, string][];
  const vals = Array.isArray(arr) ? arr.map(([, v]) => v).join(" ") : "";
  return vals ? `${label}\n${vals}` : label;
}

// pgvector 리터럴: '[0.1,0.2,...]' 형식(pgvector 가 텍스트 리터럴로 수용). 쿼리에서 $n::vector 로 캐스팅.
function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/* ────────────────────────── 트랜잭션 헬퍼 ────────────────────────── */

async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

type Queryable = Pool | PoolClient;

// 아래 프리미티브들은 캔버스 id 를 마지막 인자로 받는다. 기본값은 현재 캔버스 컨텍스트지만,
// tx 콜백 안에서는 호출자가 미리 잡아둔 cv 를 명시적으로 넘긴다(컨텍스트 유실 방지).
async function insertNode(c: Queryable, n: Node, canvasId = currentCanvas()): Promise<void> {
  await c.query(
    `INSERT INTO nodes (canvas_id, id, type, label, props) VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (canvas_id, id) DO NOTHING`,
    [canvasId, n.id, n.type, n.label, JSON.stringify(nodePropsJson(n))]
  );
}

async function insertEdge(c: Queryable, e: Edge, canvasId = currentCanvas()): Promise<void> {
  await c.query(
    `INSERT INTO edges (canvas_id, src, rel, dst, props) VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (canvas_id, src, rel, dst) DO NOTHING`,
    [canvasId, e.src, e.rel, e.dst, JSON.stringify(edgePropsJson(e))]
  );
}

// edges.rel 은 relation_types(rel_id) FK. 시드에 없는 관계(스프레드시트 '관계' 컬럼 등)로 인한
// FK 위반을 막기 위해, 엣지 삽입 전에 미등록 관계를 rel_id=label 로 자동 등록한다(확장 가능 원칙).
// ponytail: 타입 편집 UI 생기면 여기서 자동생성 대신 검증으로 전환.
async function ensureRelTypes(c: Queryable, edges: Edge[], canvasId = currentCanvas()): Promise<void> {
  const rels = [...new Set(edges.map((e) => e.rel))];
  for (const rel of rels) {
    await c.query(
      `INSERT INTO relation_types (canvas_id, rel_id, label_ko) VALUES ($1,$2,$2)
       ON CONFLICT (canvas_id, rel_id) DO NOTHING`,
      [canvasId, rel]
    );
  }
}

async function logChangeOn(c: Queryable, op: string, payload: unknown, canvasId = currentCanvas()): Promise<void> {
  await c.query(
    `INSERT INTO change_log (canvas_id, op, payload) VALUES ($1, $2, $3::jsonb)`,
    [canvasId, op, JSON.stringify(payload)]
  );
}

/* ────────────────────────── 하이드레이션 (부팅 시 store 가 읽음) ────────────────────────── */

export async function loadAll(): Promise<{ nodes: Node[]; edges: Edge[]; sources: SourceInfo[]; activeDrawing: string | null }> {
  const p = getPool();
  const cv = currentCanvas();
  const [nodesR, edgesR, sourcesR, metaR] = await Promise.all([
    p.query<NodeRow>("SELECT id, type, label, props FROM nodes WHERE canvas_id = $1", [cv]),
    p.query<EdgeRow>("SELECT src, rel, dst, props FROM edges WHERE canvas_id = $1", [cv]),
    p.query<SourceRow>("SELECT file, kind, meta FROM sources WHERE canvas_id = $1", [cv]),
    p.query<{ value: unknown }>("SELECT value FROM meta WHERE canvas_id = $1 AND key = 'active_drawing'", [cv]),
  ]);
  const activeDrawing = metaR.rows.length ? (metaR.rows[0].value as string) : null;
  return {
    nodes: nodesR.rows.map(rowToNode),
    edges: edgesR.rows.map(rowToEdge),
    sources: sourcesR.rows.map(rowToSource),
    activeDrawing,
  };
}

// 최초 부팅 적재: ingestAll() 결과를 한 트랜잭션으로 벌크 삽입 + change_log('ingest').
export async function bulkInsertGraph(nodes: Node[], edges: Edge[], sources: SourceInfo[]): Promise<void> {
  const cv = currentCanvas();
  await tx(async (c) => {
    for (const n of nodes) await insertNode(c, n, cv);
    await ensureRelTypes(c, edges, cv);
    for (const e of edges) await insertEdge(c, e, cv);
    for (const s of sources) await upsertSourceOn(c, s, undefined, cv);
    await logChangeOn(c, "ingest", { ids: nodes.map((n) => n.id), summary: `초기 적재 ${nodes.length}노드/${edges.length}엣지/${sources.length}원천` }, cv);
  });
}

/* ────────────────────────── write-through 프리미티브 (각자 자기 트랜잭션 + change_log) ────────────────────────── */

// mergeDelta / drawing.add: 신규 노드·엣지만 추가(기존 보존 — ON CONFLICT DO NOTHING). op = 'ingest' | 'drawing.add'.
export async function persistUpsertGraph(nodes: Node[], edges: Edge[], op: string): Promise<void> {
  const cv = currentCanvas();
  await tx(async (c) => {
    for (const n of nodes) await insertNode(c, n, cv);
    await ensureRelTypes(c, edges, cv);
    for (const e of edges) await insertEdge(c, e, cv);
    await logChangeOn(c, op, { ids: nodes.map((n) => n.id), summary: `${op}: +${nodes.length}노드/+${edges.length}엣지` }, cv);
  });
}

export async function persistDeleteNode(id: string): Promise<void> {
  const cv = currentCanvas();
  await tx(async (c) => {
    await c.query("DELETE FROM nodes WHERE canvas_id = $1 AND id = $2", [cv, id]); // 엣지 CASCADE
    await logChangeOn(c, "curate.delete", { ids: [id], summary: `노드 삭제 ${id}` }, cv);
  });
}

export async function persistDeleteEdge(src: string, rel: string, dst: string): Promise<void> {
  const cv = currentCanvas();
  await tx(async (c) => {
    await c.query("DELETE FROM edges WHERE canvas_id = $1 AND src = $2 AND rel = $3 AND dst = $4", [cv, src, rel, dst]);
    await logChangeOn(c, "curate.delete", { ids: [src, dst], summary: `관계 삭제 ${src}|${rel}|${dst}` }, cv);
  });
}

// mergeNodes: from 의 엣지를 into 로 재지정(store 가 계산한 movedEdges) + into.props 갱신 + from 삭제 — 한 트랜잭션.
// intoProps = into 노드의 새 표시 props 배열([key,val][]) — nodes.props JSONB 의 'props' 필드만 교체.
export async function persistMergeNodes(fromId: string, intoId: string, movedEdges: Edge[], intoProps: [string, string][]): Promise<void> {
  const cv = currentCanvas();
  await tx(async (c) => {
    await c.query("DELETE FROM edges WHERE canvas_id = $1 AND (src = $2 OR dst = $2)", [cv, fromId]);
    await ensureRelTypes(c, movedEdges, cv);
    for (const e of movedEdges) await insertEdge(c, e, cv);
    await c.query(
      `UPDATE nodes SET props = jsonb_set(props, '{props}', $3::jsonb, true), updated_at = now()
        WHERE canvas_id = $1 AND id = $2`,
      [cv, intoId, JSON.stringify(intoProps)]
    );
    await c.query("DELETE FROM nodes WHERE canvas_id = $1 AND id = $2", [cv, fromId]);
    await logChangeOn(c, "curate.merge", { ids: [fromId, intoId], summary: `${fromId} → ${intoId} 병합(엣지 ${movedEdges.length}개 이관)` }, cv);
  });
}

async function upsertSourceOn(c: Queryable, s: SourceInfo, content?: Buffer, canvasId = currentCanvas()): Promise<void> {
  const meta = { sizeBytes: s.sizeBytes, extracted: s.extracted, preview: s.preview };
  // content 미제공 시 기존 바이트 보존(COALESCE) — 베이스라인 재적재가 업로드 원본을 지우지 않는다.
  await c.query(
    `INSERT INTO sources (canvas_id, file, kind, meta, content) VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (canvas_id, file) DO UPDATE
       SET kind = EXCLUDED.kind, meta = EXCLUDED.meta,
           content = COALESCE(EXCLUDED.content, sources.content), uploaded_at = now()`,
    [canvasId, s.file, s.type, JSON.stringify(meta), content ?? null]
  );
}

export async function persistSource(s: SourceInfo, content?: Buffer): Promise<void> {
  await upsertSourceOn(getPool(), s, content);
}

export async function persistMeta(key: string, value: unknown): Promise<void> {
  await getPool().query(
    `INSERT INTO meta (canvas_id, key, value) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (canvas_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [currentCanvas(), key, JSON.stringify(value)]
  );
}

export async function logChange(op: string, payload: unknown): Promise<void> {
  await logChangeOn(getPool(), op, payload);
}

/** 서브타입 자동 분류 결과 영속 — nodes.props JSONB 의 'st' 필드만 갱신(한 트랜잭션). */
export async function persistSubtypeAssignments(assigns: { id: string; st: string }[]): Promise<void> {
  if (assigns.length === 0) return;
  const cv = currentCanvas();
  await tx(async (c) => {
    for (const a of assigns) {
      await c.query(
        `UPDATE nodes SET props = jsonb_set(props, '{st}', to_jsonb($3::text), true), updated_at = now()
          WHERE canvas_id = $1 AND id = $2`,
        [cv, a.id, a.st]
      );
    }
    await logChangeOn(c, "classify.subtype", { ids: assigns.map((a) => a.id), summary: `서브타입 자동 분류 ${assigns.length}건` }, cv);
  });
}

/* ────────────────────────── 임베딩 (wave-2 백필·검색) ────────────────────────── */

export async function nodesMissingEmbedding(): Promise<{ id: string; text: string }[]> {
  const { rows } = await getPool().query<NodeRow>(
    "SELECT id, type, label, props FROM nodes WHERE canvas_id = $1 AND embedding IS NULL",
    [currentCanvas()]
  );
  return rows.map((r) => ({ id: r.id, text: embedText(r.label, r.props) }));
}

export async function setEmbedding(id: string, vector: number[]): Promise<void> {
  await getPool().query(
    "UPDATE nodes SET embedding = $3::vector, updated_at = now() WHERE canvas_id = $1 AND id = $2",
    [currentCanvas(), id, toVectorLiteral(vector)]
  );
}

// 같은 타입(doc 제외) 노드 쌍 중 임베딩 코사인 거리가 maxDist 미만인 최근접 쌍(품질 스캔 dup-semantic 용).
// LATERAL 로 노드별 최근접 동타입 이웃 1개만 뽑고, id > a.id 조건으로 (a,b)/(b,a) 중복을 제거한다.
// ponytail: O(n × index-scan) — 노드 수백 개 규모엔 충분, 수만 개면 HNSW 인덱스 + 배치로 전환.
export interface NearPairRow { id: string; other: string; dist: number }
export async function nearestSameTypePairs(maxDist: number, limit: number): Promise<NearPairRow[]> {
  const { rows } = await getPool().query<{ id: string; other: string; dist: number }>(
    `SELECT a.id, b.id AS other, (a.embedding <=> b.embedding)::float8 AS dist
       FROM nodes a
       JOIN LATERAL (
         SELECT n.id, n.embedding FROM nodes n
          WHERE n.canvas_id = $3 AND n.type = a.type AND n.id > a.id AND n.embedding IS NOT NULL
          ORDER BY n.embedding <=> a.embedding
          LIMIT 1
       ) b ON true
      WHERE a.canvas_id = $3 AND a.embedding IS NOT NULL AND a.type <> 'doc'
        AND (a.embedding <=> b.embedding) < $1
      ORDER BY dist
      LIMIT $2`,
    [maxDist, limit, currentCanvas()]
  );
  return rows.map((r) => ({ id: r.id, other: r.other, dist: Number(r.dist) }));
}

// 코사인 거리(embedding <=> $1) 오름차순 상위 k 노드 id. 후보 확장용(최종 랭킹은 기존 규칙 스코어러).
export async function semanticSearch(vector: number[], k: number): Promise<string[]> {
  const { rows } = await getPool().query<{ id: string }>(
    "SELECT id FROM nodes WHERE canvas_id = $3 AND embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $2",
    [toVectorLiteral(vector), k, currentCanvas()]
  );
  return rows.map((r) => r.id);
}

/* ────────────────────────── AI 검토 소견 캐시 (review-opinion) ────────────────────────── */

export interface AiOpinionRow {
  key: string;
  condition: unknown;
  opinion: string;
  citedChecks: number[];
  model: string | null;
  createdAt: string;
}

interface AiOpinionDbRow {
  key: string;
  condition: unknown;
  opinion: string;
  cited_checks: number[];
  model: string | null;
  created_at: string;
}

export async function getAiOpinion(key: string): Promise<AiOpinionRow | null> {
  const { rows } = await getPool().query<AiOpinionDbRow>(
    "SELECT key, condition, opinion, cited_checks, model, created_at FROM ai_opinions WHERE canvas_id = $1 AND key = $2",
    [currentCanvas(), key]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { key: r.key, condition: r.condition, opinion: r.opinion, citedChecks: r.cited_checks, model: r.model, createdAt: r.created_at };
}

export async function saveAiOpinion(
  key: string,
  condition: unknown,
  opinion: string,
  citedChecks: number[],
  model?: string
): Promise<void> {
  await getPool().query(
    `INSERT INTO ai_opinions (canvas_id, key, condition, opinion, cited_checks, model) VALUES ($1,$2,$3::jsonb,$4,$5,$6)
     ON CONFLICT (canvas_id, key) DO UPDATE
       SET condition = EXCLUDED.condition, opinion = EXCLUDED.opinion,
           cited_checks = EXCLUDED.cited_checks, model = EXCLUDED.model, created_at = now()`,
    [currentCanvas(), key, JSON.stringify(condition), opinion, citedChecks, model ?? null]
  );
}

/* ────────────────────────── 캔버스 행 CRUD ────────────────────────── */
// 캔버스 자체를 다루므로 currentCanvas() 스코핑 대상이 아니다 — id 를 직접 받는다.

export interface CanvasRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

/** 캔버스 목록 + 각 캔버스의 노드·문서 수. includeDeleted=true 면 휴지통만. */
export async function canvasRows(includeDeleted = false): Promise<(CanvasRow & { nodeCount: number; docCount: number })[]> {
  const r = await getPool().query<CanvasRow & { node_count: string; doc_count: string }>(
    `SELECT c.id, c.name, c.description, c.created_at, c.deleted_at,
            (SELECT count(*) FROM nodes   n WHERE n.canvas_id = c.id)::text AS node_count,
            (SELECT count(*) FROM sources s WHERE s.canvas_id = c.id)::text AS doc_count
       FROM canvases c
      WHERE c.deleted_at IS ${includeDeleted ? "NOT" : ""} NULL
      ORDER BY c.created_at`
  );
  return r.rows.map((x) => ({
    id: x.id, name: x.name, description: x.description,
    created_at: x.created_at, deleted_at: x.deleted_at,
    nodeCount: Number(x.node_count), docCount: Number(x.doc_count),
  }));
}

export async function insertCanvas(id: string, name: string, description: string | null): Promise<void> {
  await getPool().query(
    `INSERT INTO canvases (id, name, description) VALUES ($1,$2,$3)`,
    [id, name, description]
  );
}

export async function updateCanvas(id: string, name: string, description: string | null): Promise<void> {
  await getPool().query(`UPDATE canvases SET name = $2, description = $3 WHERE id = $1`, [id, name, description]);
}

export async function softDeleteCanvas(id: string): Promise<void> {
  await getPool().query(`UPDATE canvases SET deleted_at = now() WHERE id = $1`, [id]);
}

export async function restoreCanvas(id: string): Promise<void> {
  await getPool().query(`UPDATE canvases SET deleted_at = NULL WHERE id = $1`, [id]);
}

/** 영구 삭제 — 노드·엣지·문서·스키마가 CASCADE 로 함께 사라진다. */
export async function purgeCanvas(id: string): Promise<void> {
  await getPool().query(`DELETE FROM canvases WHERE id = $1`, [id]);
}

/* ────────────────────────── 스키마 편집 (캔버스별 메타모델) ──────────────────────────
 * 캔버스 스코핑 대상 — 전부 currentCanvas() 로 자기 캔버스의 메타모델만 건드린다. */

export async function upsertObjectType(t: {
  type_id: string; label_ko: string; color: string | null; icon: string | null; description: string | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO object_types (canvas_id, type_id, label_ko, color, icon, description)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (canvas_id, type_id) DO UPDATE
       SET label_ko = EXCLUDED.label_ko, color = EXCLUDED.color,
           icon = EXCLUDED.icon, description = EXCLUDED.description`,
    [currentCanvas(), t.type_id, t.label_ko, t.color, t.icon, t.description]
  );
}

/** 그 타입의 노드가 남아 있으면 삭제하지 않는다(FK 위반·고아 노드 방지). @returns 남은 노드 수 */
export async function objectTypeUsage(typeId: string): Promise<number> {
  const r = await getPool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM nodes WHERE canvas_id = $1 AND type = $2",
    [currentCanvas(), typeId]
  );
  return Number(r.rows[0].n);
}

export async function deleteObjectType(typeId: string): Promise<void> {
  // 서브타입·속성정의는 FK CASCADE 로 함께 사라진다.
  await getPool().query("DELETE FROM object_types WHERE canvas_id = $1 AND type_id = $2", [currentCanvas(), typeId]);
}

export async function upsertRelationType(r: {
  rel_id: string; label_ko: string; description: string | null; src_types: string[]; dst_types: string[];
}): Promise<void> {
  await getPool().query(
    `INSERT INTO relation_types (canvas_id, rel_id, label_ko, description, src_types, dst_types, directed)
     VALUES ($1,$2,$3,$4,$5,$6,true)
     ON CONFLICT (canvas_id, rel_id) DO UPDATE
       SET label_ko = EXCLUDED.label_ko, description = EXCLUDED.description,
           src_types = EXCLUDED.src_types, dst_types = EXCLUDED.dst_types`,
    [currentCanvas(), r.rel_id, r.label_ko, r.description, r.src_types, r.dst_types]
  );
}

/** 그 관계의 엣지가 남아 있으면 삭제하지 않는다(edges.rel 은 relation_types FK). @returns 남은 엣지 수 */
export async function relationTypeUsage(relId: string): Promise<number> {
  const r = await getPool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM edges WHERE canvas_id = $1 AND rel = $2",
    [currentCanvas(), relId]
  );
  return Number(r.rows[0].n);
}

export async function deleteRelationType(relId: string): Promise<void> {
  await getPool().query("DELETE FROM relation_types WHERE canvas_id = $1 AND rel_id = $2", [currentCanvas(), relId]);
}
