// lib/db.test.ts — Postgres 영속화 계층 검증 (`node --test --experimental-strip-types`).
// DATABASE_URL 이 없거나 접속 불가면 전체 스킵(실패 아님). 로컬 Postgres(pgvector) 있을 때만 실행.
// 실행 예: DATABASE_URL=postgres://user:pw@localhost:5432/slonto npm test lib/db.test.ts
//
// infer.test.ts 와 동일한 하네스: 확장자 없는 상대 import 를 ".ts" 로 보정하는 resolve 훅 후 동적 import.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const db = await import("./db.ts");

// DB 접속 가능 여부 판정(불가 → 전체 스킵).
let reachable = false;
if (db.dbEnabled()) {
  try {
    await db.getPool().query("SELECT 1");
    reachable = true;
  } catch {
    reachable = false;
  }
}
const opts = { skip: reachable ? false : "DATABASE_URL 미설정/접속 불가 — Postgres 검증 스킵" };

// 테스트 전용 id 접두어(실 데이터와 충돌 방지 + 정리 용이).
const P = "test:db:";
const N = (id: string) => `${P}${id}`;

async function cleanup() {
  const pool = db.getPool();
  await pool.query("DELETE FROM nodes WHERE id LIKE $1", [`${P}%`]); // 엣지 CASCADE
  await pool.query("DELETE FROM sources WHERE file LIKE $1", [`${P}%`]);
}

test("스키마 적용은 멱등하다 (ready 두 번)", opts, async () => {
  await db.ready();
  await db.ready(); // 두 번째 호출도 안전(같은 Promise, 재적용해도 IF NOT EXISTS)
  const n = await db.nodeCount();
  assert.equal(typeof n, "number");
});

test("메타모델이 시드된다 (object_types/relation_types)", opts, async () => {
  await db.ready();
  const pool = db.getPool();
  const o = await pool.query("SELECT type_id FROM object_types WHERE type_id = 'item'");
  assert.equal(o.rows.length, 1, "object_types 에 'item' 없음");
  const r = await pool.query("SELECT rel_id, directed FROM relation_types WHERE rel_id = 'CAUSED_BY'");
  assert.equal(r.rows.length, 1, "relation_types 에 'CAUSED_BY' 없음");
  const sim = await pool.query("SELECT directed FROM relation_types WHERE rel_id = 'SIMILAR'");
  assert.equal(sim.rows[0].directed, false, "SIMILAR 은 대칭(directed=false)이어야 함");
});

test("bulkInsertGraph → loadAll 이 노드/엣지를 라운드트립한다", opts, async () => {
  await db.ready();
  await cleanup();
  const nodes = [
    { id: N("item1"), type: "item" as const, label: "테스트 부품", sub: "서브", hero: true, props: [["소재", "PC"]] as [string, string][] },
    { id: N("fm1"), type: "fm" as const, label: "테스트 고장", props: [["RPN", "120"]] as [string, string][] },
  ];
  const edges = [{ src: N("item1"), rel: "HAS_FAILURE", dst: N("fm1"), weight: 0.9 }];
  const sources = [{ file: N("src.xlsx"), type: "XLSX", sizeBytes: 42, extracted: { objects: 2, relations: 1 }, preview: [] }];
  await db.bulkInsertGraph(nodes, edges, sources);

  const all = await db.loadAll();
  const item = all.nodes.find((n) => n.id === N("item1"));
  assert.ok(item, "item1 로드 실패");
  assert.equal(item!.label, "테스트 부품");
  assert.equal(item!.sub, "서브");
  assert.equal(item!.hero, true);
  assert.deepEqual(item!.props, [["소재", "PC"]]);
  const edge = all.edges.find((e) => e.src === N("item1") && e.dst === N("fm1"));
  assert.ok(edge, "엣지 로드 실패");
  assert.equal(edge!.weight, 0.9);
  const src = all.sources.find((s) => s.file === N("src.xlsx"));
  assert.ok(src, "source 로드 실패");
  assert.equal(src!.type, "XLSX");
  assert.equal(src!.extracted.objects, 2);

  await cleanup();
});

test("persistDeleteNode 는 부속 엣지를 CASCADE 삭제한다", opts, async () => {
  await db.ready();
  await cleanup();
  await db.bulkInsertGraph(
    [
      { id: N("a"), type: "item" as const, label: "A" },
      { id: N("b"), type: "fm" as const, label: "B" },
    ],
    [{ src: N("a"), rel: "HAS_FAILURE", dst: N("b") }],
    []
  );
  await db.persistDeleteNode(N("a"));
  const pool = db.getPool();
  const nodeLeft = await pool.query("SELECT id FROM nodes WHERE id = $1", [N("a")]);
  assert.equal(nodeLeft.rows.length, 0, "노드가 삭제되지 않음");
  const edgeLeft = await pool.query("SELECT src FROM edges WHERE src = $1 OR dst = $1", [N("a")]);
  assert.equal(edgeLeft.rows.length, 0, "부속 엣지가 CASCADE 삭제되지 않음");
  await cleanup();
});

test("persistMergeNodes 는 엣지를 재지정하고 from 라벨을 into props 에 보존한다", opts, async () => {
  await db.ready();
  await cleanup();
  await db.bulkInsertGraph(
    [
      { id: N("from"), type: "cause" as const, label: "원인 프롬" },
      { id: N("into"), type: "cause" as const, label: "원인 인투", props: [["기존", "값"]] as [string, string][] },
      { id: N("other"), type: "fm" as const, label: "고장 아더" },
    ],
    [{ src: N("other"), rel: "CAUSED_BY", dst: N("from") }],
    []
  );
  // store.mergeNodes 가 계산해 넘길 값: 재지정된 엣지 + into 의 새 props(병합됨 포함).
  const movedEdges = [{ src: N("other"), rel: "CAUSED_BY", dst: N("into") }];
  const intoProps: [string, string][] = [["기존", "값"], ["병합됨", `원인 프롬 (${N("from")})`]];
  await db.persistMergeNodes(N("from"), N("into"), movedEdges, intoProps);

  const all = await db.loadAll();
  assert.ok(!all.nodes.find((n) => n.id === N("from")), "from 노드가 삭제되지 않음");
  const into = all.nodes.find((n) => n.id === N("into"));
  assert.ok(into, "into 노드 소실");
  assert.ok(into!.props?.some(([k, v]) => k === "병합됨" && v.includes("원인 프롬")), "into props 에 from 라벨 보존 안 됨");
  const repointed = all.edges.find((e) => e.src === N("other") && e.dst === N("into"));
  assert.ok(repointed, "엣지가 into 로 재지정되지 않음");
  assert.ok(!all.edges.find((e) => e.dst === N("from")), "from 으로 향하는 엣지가 남아있음");
  await cleanup();
});

test("쓰기 함수는 change_log 행을 남긴다", opts, async () => {
  await db.ready();
  await cleanup();
  const pool = db.getPool();
  const before = await pool.query("SELECT count(*)::int AS c FROM change_log");
  await db.bulkInsertGraph([{ id: N("cl"), type: "item" as const, label: "CL" }], [], []);
  await db.persistDeleteNode(N("cl"));
  const after = await pool.query("SELECT count(*)::int AS c FROM change_log");
  assert.ok(after.rows[0].c >= before.rows[0].c + 2, "change_log 에 ingest/curate.delete 행이 기록되지 않음");
  await cleanup();
});

test("setEmbedding 후 semanticSearch 가 해당 노드 id 를 반환한다", opts, async () => {
  await db.ready();
  await cleanup();
  await db.bulkInsertGraph([{ id: N("emb"), type: "item" as const, label: "임베딩 노드" }], [], []);
  const vec = new Array(384).fill(0);
  vec[0] = 1;
  await db.setEmbedding(N("emb"), vec);
  const ids = await db.semanticSearch(vec, 50);
  assert.ok(ids.includes(N("emb")), "동일 벡터 검색 결과에 시드 노드가 없음");
  await cleanup();
});
