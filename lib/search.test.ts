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
const { search, searchHybrid } = await import("./search.ts");
const { allNodes } = await import("./store.ts");

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

// ── 하이브리드 (searchHybrid) ──

test("하이브리드: 임베딩 미가용(테스트 환경) → search() 와 바이트 동일", async () => {
  assert.deepEqual(await searchHybrid("간극"), search("간극"));
  assert.deepEqual(await searchHybrid(""), { hits: [], neighbors: [] });
});

test("하이브리드: semantic 소스가 throw → 조용한 폴백", async () => {
  const res = await searchHybrid("간극", async () => {
    throw new Error("pyservice down");
  });
  assert.deepEqual(res, search("간극"));
});

test("하이브리드: 주입 semantic 후보 — 기존 hit 불변, 신규만 낮은 점수로 뒤에 추가", async () => {
  const base = search("간극");
  const inBase = new Set(base.hits.map((h) => h.id));
  const fresh = allNodes().find((n) => n.type !== "doc" && !inBase.has(n.id));
  assert.ok(fresh, "키워드에 안 걸린 노드가 존재해야 함");

  const res = await searchHybrid("간극", async () => [
    base.hits[0].id, // 이미 키워드 히트 → 그대로(중복 추가 없음)
    fresh!.id,       // 임베딩 전용 → 뒤에 semantic 으로 추가
    "NO_SUCH_ID",    // 미존재 id → 무시
  ]);

  assert.deepEqual(res.hits.slice(0, base.hits.length), base.hits, "기존 순위·점수 불변");
  assert.equal(res.hits.length, base.hits.length + 1);
  const tail = res.hits[res.hits.length - 1];
  assert.equal(tail.id, fresh!.id);
  assert.deepEqual(tail.matched, ["semantic"]);
  assert.ok(tail.score < base.hits[base.hits.length - 1].score, "semantic 점수는 키워드 최하위보다 낮음");
  assert.deepEqual(res.neighbors, base.neighbors, "neighbors 는 키워드 기준 그대로");
});
