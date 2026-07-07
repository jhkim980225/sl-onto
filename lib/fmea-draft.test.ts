// lib/fmea-draft.test.ts — anchorItem 스코핑 검증 (`node --test --experimental-strip-types`).
// resolve 훅 사유는 lib/infer.test.ts 상단 주석 참조.
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

const { buildFmeaRows } = await import("./fmea-draft.ts");
const { allNodes, allEdges, neighbors } = await import("./store.ts");
type DesignInput = import("./types.ts").DesignInput;

const BASE: DesignInput = { market: "북미", lightSource: "LED", shape: ["슬림 하우징"] };

test("anchorItem 지정 시 FMEA 행이 그 부품(+구성)으로 스코프된다", () => {
  // 고장 이력이 있는 실제 부품 하나 선택 (라벨 하드코딩 없이)
  const withFm = allEdges().find((e) => e.rel === "HAS_FAILURE");
  assert.ok(withFm, "HAS_FAILURE 엣지가 시드에 존재해야 함");
  const item = allNodes().find((n) => n.id === withFm!.src);
  assert.ok(item);

  const rows = buildFmeaRows({ ...BASE, anchorItem: item!.label });
  assert.ok(rows.length > 0, "앵커 부품 기준 행이 나와야 함");

  const allowed = new Set([item!.label, ...neighbors(item!.id, { rel: "CONSISTS_OF", dir: "out" }).map((n) => n.label)]);
  for (const r of rows) assert.ok(allowed.has(r.item), `행 부품 ${r.item} 이 앵커 범위 밖`);
});

test("anchorItem 없으면 기본(헤드램프 어셈블리) 대상 유지", () => {
  const rows = buildFmeaRows(BASE);
  assert.ok(rows.length > 0);
});
