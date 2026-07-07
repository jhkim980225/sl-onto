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
import { OBJECT_TYPES, RELATION_TYPES } from "./db/seed-metamodel";

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
  const schemaPath = path.join(process.cwd(), "lib", "db", "schema.sql");
  await p.query(fs.readFileSync(schemaPath, "utf8"));
  const { rows } = await p.query<{ c: number }>("SELECT count(*)::int AS c FROM object_types");
  if (rows[0].c === 0) await seedMetamodel(p);
}

async function seedMetamodel(p: Pool): Promise<void> {
  for (const t of OBJECT_TYPES) {
    await p.query(
      `INSERT INTO object_types (type_id, label_ko, color, icon, description)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (type_id) DO NOTHING`,
      [t.type_id, t.label_ko, t.color, t.icon, t.description]
    );
  }
  for (const r of RELATION_TYPES) {
    await p.query(
      `INSERT INTO relation_types (rel_id, label_ko, description, src_types, dst_types, directed)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (rel_id) DO NOTHING`,
      [r.rel_id, r.label_ko, r.description, r.src_types, r.dst_types, r.directed]
    );
  }
}

export async function nodeCount(): Promise<number> {
  const { rows } = await getPool().query<{ c: number }>("SELECT count(*)::int AS c FROM nodes");
  return rows[0].c;
}

/* ────────────────────────── Row ↔ 도메인 어댑터 (무손실 라운드트립) ────────────────────────── */

// Node 의 컬럼 외 필드는 전부 nodes.props JSONB 로 담는다(sub/hero/hidden/ax/ay/parent/ext/props).
function nodePropsJson(n: Node): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (n.sub !== undefined) p.sub = n.sub;
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

async function insertNode(c: Queryable, n: Node): Promise<void> {
  await c.query(
    `INSERT INTO nodes (id, type, label, props) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [n.id, n.type, n.label, JSON.stringify(nodePropsJson(n))]
  );
}

async function insertEdge(c: Queryable, e: Edge): Promise<void> {
  await c.query(
    `INSERT INTO edges (src, rel, dst, props) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (src, rel, dst) DO NOTHING`,
    [e.src, e.rel, e.dst, JSON.stringify(edgePropsJson(e))]
  );
}

// edges.rel 은 relation_types(rel_id) FK. 시드에 없는 관계(스프레드시트 '관계' 컬럼 등)로 인한
// FK 위반을 막기 위해, 엣지 삽입 전에 미등록 관계를 rel_id=label 로 자동 등록한다(확장 가능 원칙).
// ponytail: 타입 편집 UI 생기면 여기서 자동생성 대신 검증으로 전환.
async function ensureRelTypes(c: Queryable, edges: Edge[]): Promise<void> {
  const rels = [...new Set(edges.map((e) => e.rel))];
  for (const rel of rels) {
    await c.query(
      `INSERT INTO relation_types (rel_id, label_ko) VALUES ($1,$1) ON CONFLICT (rel_id) DO NOTHING`,
      [rel]
    );
  }
}

async function logChangeOn(c: Queryable, op: string, payload: unknown): Promise<void> {
  await c.query(`INSERT INTO change_log (op, payload) VALUES ($1, $2::jsonb)`, [op, JSON.stringify(payload)]);
}

/* ────────────────────────── 하이드레이션 (부팅 시 store 가 읽음) ────────────────────────── */

export async function loadAll(): Promise<{ nodes: Node[]; edges: Edge[]; sources: SourceInfo[]; activeDrawing: string | null }> {
  const p = getPool();
  const [nodesR, edgesR, sourcesR, metaR] = await Promise.all([
    p.query<NodeRow>("SELECT id, type, label, props FROM nodes"),
    p.query<EdgeRow>("SELECT src, rel, dst, props FROM edges"),
    p.query<SourceRow>("SELECT file, kind, meta FROM sources"),
    p.query<{ value: unknown }>("SELECT value FROM meta WHERE key = 'active_drawing'"),
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
  await tx(async (c) => {
    for (const n of nodes) await insertNode(c, n);
    await ensureRelTypes(c, edges);
    for (const e of edges) await insertEdge(c, e);
    for (const s of sources) await upsertSourceOn(c, s);
    await logChangeOn(c, "ingest", { ids: nodes.map((n) => n.id), summary: `초기 적재 ${nodes.length}노드/${edges.length}엣지/${sources.length}원천` });
  });
}

/* ────────────────────────── write-through 프리미티브 (각자 자기 트랜잭션 + change_log) ────────────────────────── */

// mergeDelta / drawing.add: 신규 노드·엣지만 추가(기존 보존 — ON CONFLICT DO NOTHING). op = 'ingest' | 'drawing.add'.
export async function persistUpsertGraph(nodes: Node[], edges: Edge[], op: string): Promise<void> {
  await tx(async (c) => {
    for (const n of nodes) await insertNode(c, n);
    await ensureRelTypes(c, edges);
    for (const e of edges) await insertEdge(c, e);
    await logChangeOn(c, op, { ids: nodes.map((n) => n.id), summary: `${op}: +${nodes.length}노드/+${edges.length}엣지` });
  });
}

export async function persistDeleteNode(id: string): Promise<void> {
  await tx(async (c) => {
    await c.query("DELETE FROM nodes WHERE id = $1", [id]); // 엣지 CASCADE
    await logChangeOn(c, "curate.delete", { ids: [id], summary: `노드 삭제 ${id}` });
  });
}

export async function persistDeleteEdge(src: string, rel: string, dst: string): Promise<void> {
  await tx(async (c) => {
    await c.query("DELETE FROM edges WHERE src = $1 AND rel = $2 AND dst = $3", [src, rel, dst]);
    await logChangeOn(c, "curate.delete", { ids: [src, dst], summary: `관계 삭제 ${src}|${rel}|${dst}` });
  });
}

// mergeNodes: from 의 엣지를 into 로 재지정(store 가 계산한 movedEdges) + into.props 갱신 + from 삭제 — 한 트랜잭션.
// intoProps = into 노드의 새 표시 props 배열([key,val][]) — nodes.props JSONB 의 'props' 필드만 교체.
export async function persistMergeNodes(fromId: string, intoId: string, movedEdges: Edge[], intoProps: [string, string][]): Promise<void> {
  await tx(async (c) => {
    await c.query("DELETE FROM edges WHERE src = $1 OR dst = $1", [fromId]);
    await ensureRelTypes(c, movedEdges);
    for (const e of movedEdges) await insertEdge(c, e);
    await c.query(
      `UPDATE nodes SET props = jsonb_set(props, '{props}', $2::jsonb, true), updated_at = now() WHERE id = $1`,
      [intoId, JSON.stringify(intoProps)]
    );
    await c.query("DELETE FROM nodes WHERE id = $1", [fromId]);
    await logChangeOn(c, "curate.merge", { ids: [fromId, intoId], summary: `${fromId} → ${intoId} 병합(엣지 ${movedEdges.length}개 이관)` });
  });
}

async function upsertSourceOn(c: Queryable, s: SourceInfo, content?: Buffer): Promise<void> {
  const meta = { sizeBytes: s.sizeBytes, extracted: s.extracted, preview: s.preview };
  // content 미제공 시 기존 바이트 보존(COALESCE) — 베이스라인 재적재가 업로드 원본을 지우지 않는다.
  await c.query(
    `INSERT INTO sources (file, kind, meta, content) VALUES ($1,$2,$3::jsonb,$4)
     ON CONFLICT (file) DO UPDATE
       SET kind = EXCLUDED.kind, meta = EXCLUDED.meta,
           content = COALESCE(EXCLUDED.content, sources.content), uploaded_at = now()`,
    [s.file, s.type, JSON.stringify(meta), content ?? null]
  );
}

export async function persistSource(s: SourceInfo, content?: Buffer): Promise<void> {
  await upsertSourceOn(getPool(), s, content);
}

export async function persistMeta(key: string, value: unknown): Promise<void> {
  await getPool().query(
    `INSERT INTO meta (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

export async function logChange(op: string, payload: unknown): Promise<void> {
  await logChangeOn(getPool(), op, payload);
}

/* ────────────────────────── 임베딩 (wave-2 백필·검색) ────────────────────────── */

export async function nodesMissingEmbedding(): Promise<{ id: string; text: string }[]> {
  const { rows } = await getPool().query<NodeRow>("SELECT id, type, label, props FROM nodes WHERE embedding IS NULL");
  return rows.map((r) => ({ id: r.id, text: embedText(r.label, r.props) }));
}

export async function setEmbedding(id: string, vector: number[]): Promise<void> {
  await getPool().query("UPDATE nodes SET embedding = $2::vector, updated_at = now() WHERE id = $1", [id, toVectorLiteral(vector)]);
}

// 코사인 거리(embedding <=> $1) 오름차순 상위 k 노드 id. 후보 확장용(최종 랭킹은 기존 규칙 스코어러).
export async function semanticSearch(vector: number[], k: number): Promise<string[]> {
  const { rows } = await getPool().query<{ id: string }>(
    "SELECT id FROM nodes WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $2",
    [toVectorLiteral(vector), k]
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
    "SELECT key, condition, opinion, cited_checks, model, created_at FROM ai_opinions WHERE key = $1",
    [key]
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
    `INSERT INTO ai_opinions (key, condition, opinion, cited_checks, model) VALUES ($1,$2::jsonb,$3,$4,$5)
     ON CONFLICT (key) DO UPDATE
       SET condition = EXCLUDED.condition, opinion = EXCLUDED.opinion,
           cited_checks = EXCLUDED.cited_checks, model = EXCLUDED.model, created_at = now()`,
    [key, JSON.stringify(condition), opinion, citedChecks, model ?? null]
  );
}
