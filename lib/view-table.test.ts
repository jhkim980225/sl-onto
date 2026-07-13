// lib/view-table.test.ts — 결과 프레임 Table 파생 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/ask.test.ts 와 동일(확장자 없는 상대 import 보정).
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

const { buildNodeRows, buildRelRows } = await import("./view-table.ts");
import type { View } from "./view-table.ts";

const view: View = {
  nodes: [
    { id: "A", type: "item", label: "헤드램프", st: "front",
      props: [["재질", "PC"], ["색", "블랙"], ["등급", "A"], ["여분", "무시됨"]] },
    { id: "F", type: "fm", label: "크랙", props: [] },
    { id: "C", type: "cause", label: "열충격" }, // props 없음
  ],
  edges: [
    { src: "A", rel: "HAS_FM", dst: "F" },
    { src: "F", rel: "CAUSED_BY", dst: "C" },
    { src: "A", rel: "EVIDENCED_BY", dst: "D1" },
    { src: "A", rel: "EVIDENCED_BY", dst: "D2" },
    { src: "F", rel: "EVIDENCED_BY", dst: "D3" },
    { src: "C", rel: "RELATED_TO", dst: "Z" }, // dst 뷰에 없음 → id 그대로
  ],
};

test("buildNodeRows — propsSummary 최대 3개 · evidenceCount 정확", () => {
  const rows = buildNodeRows(view);
  assert.equal(rows.length, 3);

  const a = rows[0];
  assert.equal(a.id, "A");
  assert.equal(a.type, "item");
  assert.equal(a.st, "front");
  assert.equal(a.propsSummary, "재질:PC · 색:블랙 · 등급:A"); // 4번째 제외
  assert.equal(a.evidenceCount, 2);

  assert.equal(rows[1].evidenceCount, 1); // F
  assert.equal(rows[1].propsSummary, ""); // 빈 배열
  assert.equal(rows[2].evidenceCount, 0); // C
  assert.equal(rows[2].propsSummary, ""); // props undefined
  assert.equal(rows[2].st, undefined);
});

test("buildRelRows — EVIDENCED_BY 제외 · 라벨 조회 · 미존재 id 그대로", () => {
  const rows = buildRelRows(view);
  assert.equal(rows.length, 3); // EVIDENCED_BY 3개 제외

  assert.deepEqual(rows[0], { src: "A", srcLabel: "헤드램프", rel: "HAS_FM", dst: "F", dstLabel: "크랙" });
  assert.deepEqual(rows[1], { src: "F", srcLabel: "크랙", rel: "CAUSED_BY", dst: "C", dstLabel: "열충격" });
  // Z 는 뷰에 없음 → dstLabel = id
  assert.equal(rows[2].dst, "Z");
  assert.equal(rows[2].dstLabel, "Z");
  assert.ok(rows.every((r) => r.rel !== "EVIDENCED_BY"));
});

test("빈 뷰 → 빈 배열", () => {
  const empty: View = { nodes: [], edges: [] };
  assert.deepEqual(buildNodeRows(empty), []);
  assert.deepEqual(buildRelRows(empty), []);
});
