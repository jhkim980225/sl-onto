// lib/ingest-v2/extract-to-graph.test.ts — 추출 결과 → 그래프 변환 회귀.
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

const { extractToGraph, entityId } = await import("./extract-to-graph.ts");

test("entityId: 결정적(같은 입력 → 같은 id)", () => {
  assert.equal(entityId("part", "볼트"), entityId("part", "볼트"));
  assert.equal(entityId("doc", "spec.docx"), entityId("doc", "spec.docx"));
});

test("entityId: 한글 라벨도 ascii-safe·비어있지 않은 id", () => {
  const id = entityId("person", "홍길동");
  assert.ok(id.length > 0);
  assert.ok(/^[a-z0-9-]+$/.test(id), `ascii-safe 아님: ${id}`);
});

test("extractToGraph: 중복 라벨 엔티티는 하나로 합쳐진다", () => {
  const { entities } = extractToGraph({
    entities: [
      { type: "part", label: "볼트" },
      { type: "part", label: "볼트" },
    ],
    relations: [],
  });
  assert.equal(entities.length, 1);
});

test("extractToGraph: 관계는 라벨→id 매핑으로 해소된다", () => {
  const { entities, relations } = extractToGraph({
    entities: [
      { type: "part", label: "볼트" },
      { type: "part", label: "너트" },
    ],
    relations: [{ srcLabel: "볼트", rel: "connects_to", dstLabel: "너트" }],
  });
  const boltId = entities.find((e) => e.name === "볼트")!.id;
  const nutId = entities.find((e) => e.name === "너트")!.id;
  assert.equal(relations.length, 1);
  assert.equal(relations[0].src, boltId);
  assert.equal(relations[0].dst, nutId);
  assert.equal(relations[0].type, "connects_to");
});

test("extractToGraph: 미존재 라벨을 참조하는 관계는 드롭된다", () => {
  const { relations } = extractToGraph({
    entities: [{ type: "part", label: "볼트" }],
    relations: [{ srcLabel: "볼트", rel: "connects_to", dstLabel: "없는라벨" }],
  });
  assert.equal(relations.length, 0);
});

test("extractToGraph: self-loop 관계는 드롭된다", () => {
  const { relations } = extractToGraph({
    entities: [{ type: "part", label: "볼트" }],
    relations: [{ srcLabel: "볼트", rel: "self_ref", dstLabel: "볼트" }],
  });
  assert.equal(relations.length, 0);
});

test("extractToGraph: 제공된 id는 그대로 사용된다", () => {
  const { entities } = extractToGraph({
    entities: [{ type: "part", label: "볼트", id: "custom-id" }],
    relations: [],
  });
  assert.equal(entities[0].id, "custom-id");
});
