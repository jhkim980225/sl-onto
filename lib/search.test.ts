// lib/search.test.ts — Node 내장 테스트 러너 (`node --test --experimental-strip-types`).
// docs/features/search.md 테스트 케이스 검증.
//
// 참고: 이 프로젝트의 lib/*.ts 는 Next.js 관례상 확장자 없는 상대 import 를 쓰는데
// (`import ... from "./store"`), Node 의 --experimental-strip-types 런타임은 ESM 규칙상
// 명시적 확장자를 요구한다. 아래 resolve 훅이 확장자 없는 상대 지정자에 ".ts" 를 붙여
// 이 테스트 파일이 별도 설정 없이 독립적으로 실행되도록 한다. (store/seed/types 는 수정하지 않음)
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// 확장자 없는 상대 import 를 ".ts" 로 보정하는 resolve 훅 (data: URL 모듈).
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

// 훅 등록 후 동적 import (정적 import 는 훅보다 먼저 해석되므로 사용 불가).
const { search } = await import("./search.ts");

// FMGAP=간극 벌어짐, RUS=FMVSS 108, MGAP=간극·단차 마스터, AMOLD=금형 치수 수정

test('"간극" → FMGAP 최상위, MGAP·AMOLD 이웃 포함', () => {
  const res = search("간극");
  assert.ok(res.hits.length > 0, "hits 가 있어야 함");
  assert.equal(res.hits[0].id, "FMGAP", "최상위 hit 는 FMGAP");
  assert.ok(res.hits[0].matched.includes("label"), "label 매칭 포함");

  const neighborSet = new Set(res.neighbors);
  assert.ok(neighborSet.has("MGAP"), "이웃에 MGAP 포함");
  assert.ok(neighborSet.has("AMOLD"), "이웃에 AMOLD 포함");
});

test('"FMVSS" → RUS hit', () => {
  const res = search("FMVSS");
  const ids = res.hits.map((h) => h.id);
  assert.ok(ids.includes("RUS"), "hits 에 RUS 포함");
});

test("빈 질의 → hits 0", () => {
  assert.deepEqual(search(""), { hits: [], neighbors: [] });
  assert.deepEqual(search("   "), { hits: [], neighbors: [] });
});

test("랭킹 결정적: 점수 내림차순", () => {
  const res = search("간극");
  for (let i = 1; i < res.hits.length; i++) {
    assert.ok(res.hits[i - 1].score >= res.hits[i].score, "점수 비오름차순");
  }
});
