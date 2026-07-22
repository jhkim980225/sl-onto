// lib/neo4j/cypher.test.ts — Cypher 빌더 회귀(라이브 Neo4j 불필요). 파라미터 바인딩만 쓰는지 검증.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const {
  buildCreateEntity,
  buildUpsertRelation,
  buildDeleteEntity,
  buildVectorSearch,
  buildNeighbors,
} = await import("./cypher.ts");
const { EMBEDDING_DIM } = await import("./types.ts");

const EVIL_ID = "x'; DROP";
const okEmbedding = () => new Array(EMBEDDING_DIM).fill(0.1);

test("buildCreateEntity: id/props 값이 cypher 문자열에 보간되지 않는다", () => {
  const q = buildCreateEntity({
    id: EVIL_ID,
    name: "n",
    type: "person",
    props: { note: "'; DROP TABLE" },
  });
  assert.ok(!q.cypher.includes(EVIL_ID));
  assert.ok(!q.cypher.includes("DROP TABLE"));
  assert.equal(q.params.id, EVIL_ID);
  assert.deepEqual(q.params.props, { note: "'; DROP TABLE" });
  assert.match(q.cypher, /MERGE \(e:Entity \{id: \$id\}\)/);
  assert.match(q.cypher, /SET e \+= \$props/);
});

test("buildCreateEntity: embedding 있으면 params.embedding + SET e.embedding", () => {
  const q = buildCreateEntity({ id: "a", name: "n", type: "t", embedding: okEmbedding() });
  assert.ok(q.cypher.includes("e.embedding = $embedding"));
  assert.deepEqual(q.params.embedding, okEmbedding());
});

test("buildCreateEntity: 빈 id 는 예외", () => {
  assert.throws(() => buildCreateEntity({ id: "", name: "n", type: "t" }));
});

test("buildCreateEntity: 차원 불일치 embedding 은 예외", () => {
  assert.throws(() => buildCreateEntity({ id: "a", name: "n", type: "t", embedding: [1, 2, 3] }));
});

test("buildUpsertRelation: src/dst 값이 보간되지 않고 params 에 실린다", () => {
  const q = buildUpsertRelation({ src: EVIL_ID, dst: "b", type: "knows", weight: 0.5 });
  assert.ok(!q.cypher.includes(EVIL_ID));
  assert.equal(q.params.src, EVIL_ID);
  assert.equal(q.params.dst, "b");
  assert.equal(q.params.weight, 0.5);
  assert.match(q.cypher, /MATCH \(a:Entity \{id: \$src\}\), \(b:Entity \{id: \$dst\}\)/);
  assert.match(q.cypher, /MERGE \(a\)-\[r:REL \{type: \$type\}\]->\(b\)/);
});

test("buildUpsertRelation: 빈 src/dst 는 예외", () => {
  assert.throws(() => buildUpsertRelation({ src: "", dst: "b", type: "knows" }));
  assert.throws(() => buildUpsertRelation({ src: "a", dst: "", type: "knows" }));
});

test("buildDeleteEntity: id 는 params 뿐, DETACH DELETE 포함", () => {
  const q = buildDeleteEntity(EVIL_ID);
  assert.ok(!q.cypher.includes(EVIL_ID));
  assert.equal(q.params.id, EVIL_ID);
  assert.match(q.cypher, /DETACH DELETE e/);
});

test("buildDeleteEntity: 빈 id 는 예외", () => {
  assert.throws(() => buildDeleteEntity(""));
});

test("buildVectorSearch: embedding/k 는 params, 인덱스 이름은 정적 리터럴", () => {
  const emb = okEmbedding();
  const q = buildVectorSearch(emb, 5);
  assert.ok(q.cypher.includes("db.index.vector.queryNodes('entity_embedding', $k, $embedding)"));
  assert.deepEqual(q.params.embedding, emb);
  assert.equal(q.params.k, 5);
});

test("buildVectorSearch: 차원 불일치는 예외", () => {
  assert.throws(() => buildVectorSearch([1, 2, 3], 5));
});

test("buildNeighbors: id 는 params 뿐, 1-hop REL 패턴 포함", () => {
  const q = buildNeighbors(EVIL_ID);
  assert.ok(!q.cypher.includes(EVIL_ID));
  assert.equal(q.params.id, EVIL_ID);
  assert.match(q.cypher, /MATCH \(e:Entity \{id: \$id\}\)-\[r:REL\]-\(n:Entity\) RETURN e, r, n/);
});

test("buildNeighbors: depth>1 은 가변 길이 패턴, depth<1 은 예외", () => {
  const q = buildNeighbors("a", 2);
  assert.ok(q.cypher.includes("[r:REL*1..2]"));
  assert.throws(() => buildNeighbors("a", 0));
});
