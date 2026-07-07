// lib/orchestrator.test.ts — 파이프라인 래퍼가 infer 결과를 바꾸지 않는지(회귀 가드) + 스텝 실측 검증.
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

const { runPipeline } = await import("./orchestrator.ts");
const { infer } = await import("./infer.ts");
type DesignInput = import("./types.ts").DesignInput;

const FOG: DesignInput = { market: "아시아", lightSource: "LED", shape: ["슬림 하우징", "밀폐형"], components: ["아우터 렌즈"] };

test("runPipeline 체크리스트 == infer 결과 (회귀 없음)", () => {
  const p = runPipeline(FOG);
  const direct = infer(FOG);
  assert.deepEqual(p.checklist, direct.checklist);
  assert.deepEqual(p.traversed, direct.traversed);
});

test("파이프라인 스텝 — 기본 3단계, counts 실측", () => {
  const p = runPipeline(FOG);
  assert.equal(p.pipeline.length, 3); // 조건분석·그래프 탐색·마스터 대조 (앵커 없음 → BOM 생략)
  const explore = p.pipeline[1];
  assert.equal(explore.counts?.객체, p.traversed.objects);
  assert.equal(explore.counts?.체크항목, p.checklist.length);
});

test("부품 앵커 모드 — BOM 정합성 스텝 추가", () => {
  const p = runPipeline({ market: "아시아", lightSource: "LED", shape: ["밀폐형"], anchorItem: "헤드램프 어셈블리" });
  assert.equal(p.pipeline.length, 4);
  assert.equal(p.pipeline[3].name, "BOM 정합성");
  assert.ok((p.pipeline[3].counts?.이슈 ?? 0) >= 1, "HL 어셈블리는 CTE 이슈가 있어야 함");
});
