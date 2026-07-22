// lib/neo4j/schema.test.ts — DDL 상수 회귀(라이브 Neo4j 불필요).
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

const { SCHEMA_STATEMENTS, ENTITY_VECTOR_INDEX, ENTITY_ID_CONSTRAINT } = await import("./schema.ts");

test("스키마: id 유일 제약 + 768 코사인 벡터 인덱스 포함", () => {
  assert.ok(ENTITY_ID_CONSTRAINT.includes("REQUIRE e.id IS UNIQUE"));
  assert.ok(ENTITY_VECTOR_INDEX.includes("768"), "임베딩 차원 768");
  assert.ok(ENTITY_VECTOR_INDEX.includes("cosine"), "코사인 유사도");
});

test("스키마: 모든 문장이 멱등(IF NOT EXISTS)", () => {
  assert.ok(SCHEMA_STATEMENTS.length >= 3);
  for (const s of SCHEMA_STATEMENTS) {
    assert.ok(/IF NOT EXISTS/.test(s), `멱등 아님: ${s}`);
  }
});
