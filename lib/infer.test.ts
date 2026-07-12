// lib/infer.test.ts — Node 내장 테스트 러너 (`node --test --experimental-strip-types`).
// 데모 시나리오(북미·LED·분리형 DRL·슬림)로 추론 엔진의 골든 룰을 검증한다.
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
const { infer } = await import("./infer.ts");
const { allEdges, getNode } = await import("./store.ts");
type DesignInput = import("./types.ts").DesignInput;

const DEMO: DesignInput = {
  market: "북미",
  lightSource: "LED",
  shape: ["분리형 DRL", "슬림 하우징"],
  components: ["헤드램프 어셈블리"],
};

// store 의 실제 엣지 키 집합 (trace 검증용)
const EDGE_KEYS = new Set(allEdges().map((e) => `${e.src}|${e.rel}|${e.dst}`));

test("체크리스트가 데모 수준(>=5개)으로 생성된다", () => {
  const r = infer(DEMO);
  assert.ok(
    r.checklist.length >= 5,
    `checklist 항목이 ${r.checklist.length}개 (기대: >=5) — 조건 부스트(북미/슬림/LED) 누락 의심`
  );
});

test("북미 → FMVSS 108 규제 승격 항목이 존재한다 (제목/근거에 'FMVSS 108')", () => {
  const r = infer(DEMO);
  const it = r.checklist.find(
    (x) =>
      /FMVSS\s*108/.test(x.title) ||
      x.evidence.some((e) => /FMVSS\s*108/.test(e)) ||
      x.trace.some((t) => /(^|→)RUS(→|$)/.test(t))
  );
  assert.ok(it, "북미 배광 법규(FMVSS 108/RUS) 항목이 없음 — 시장 부스트 미작동");
  // 규제 승격 항목은 UNDER_REG 홉을 trace 에 포함해야 한다
  assert.ok(
    it!.trace.some((t) => /UNDER_REG→RUS$/.test(t)) || it!.evidence.some((e) => /FMVSS\s*108/.test(e)),
    "FMVSS 108 항목이지만 fm→UNDER_REG→RUS 홉/근거가 없음"
  );
});

test("슬림 → 수축(CSHRINK) 항목이 저수축 소재 조치와 함께 등장한다", () => {
  const r = infer(DEMO);
  // 수축 concern 은 제목 자체가 수축 원인을 가리킨다(간극 항목의 '원인 경로: …수축…' 오탐 방지).
  const it = r.checklist.find((x) => /수축/.test(x.title));
  assert.ok(it, "슬림 형상에 대한 수축 검토 항목이 없음 — 슬림 부스트 미작동");
  assert.ok(
    it!.evidence.some((e) => /저수축\s*소재/.test(e)),
    "수축 항목 근거에 '저수축 소재 변경' 조치가 없음"
  );
});

// 결로·습기 기본 데모 조건 (아우터 렌즈 · 아시아 고온다습 · 밀폐형 하우징)
const FOG_DEMO: DesignInput = {
  market: "아시아",
  lightSource: "LED",
  shape: ["슬림 하우징", "밀폐형"],
  components: ["아우터 렌즈"],
};

test("밀폐형+아우터 렌즈 → 결로·습기 항목이 최상위로 온다 (결로 데모 기본 조건)", () => {
  const r = infer(FOG_DEMO);
  assert.ok(r.checklist.length > 0, "체크리스트가 비어있음");
  assert.ok(
    /결로|습기/.test(r.checklist[0].title),
    `1위 항목이 결로가 아님: "${r.checklist[0].title}" — 밀폐(결로) 부스트 미작동`
  );
  // 대표 조치는 근거 문서를 공유하는 벤트 경로 개선(AVENT)이어야 한다 (공동언급 노이즈 배제)
  assert.ok(
    /벤트/.test(r.checklist[0].title) || r.checklist[0].evidence.some((e) => /벤트 경로 개선/.test(e)),
    `결로 항목의 대표 조치가 벤트 계열이 아님: "${r.checklist[0].title}"`
  );
});

test("밀폐형 → 벤트·씰링 원인 검토 항목이 등장한다", () => {
  const r = infer(FOG_DEMO);
  const it = r.checklist.find((x) => /벤트|씰링/.test(x.title));
  assert.ok(it, "밀폐형 조건에 대한 벤트·씰링 검토 항목이 없음 — 결로 원인 부스트 미작동");
});

test("결로 기본 조건(아시아·LED·슬림·밀폐) → masterAudit에 결로 마스터 존재 + 누락 항목 있음", () => {
  const r = infer(FOG_DEMO);
  assert.ok(r.masterAudit && r.masterAudit.length > 0, "masterAudit이 비어있음(마스터 대조 미작동)");
  const fog = r.masterAudit!.find((m) => /결로/.test(m.master.label));
  assert.ok(fog, "결로 마스터(MFOG) audit이 없음 — FMFOG→REF_MASTER→MFOG 경로 미도달");
  assert.ok(fog!.required.length > 0, "결로 마스터 필수 항목(항목1..N)이 비어있음");
  assert.ok(
    fog!.missing.length >= 1,
    "결로 마스터에 누락 항목이 없음 — 온톨로지에 없는 항목(예: 하부 드레인)도 커버로 오탐한 것으로 의심"
  );
  assert.ok(fog!.evidence.length > 0, "결로 마스터 audit의 evidence가 비어있음(근거 우선 골든 룰)");
});

test("북미 조건(DEMO) → masterAudit에 MBEAM(배광 법규 마스터) audit이 존재한다", () => {
  const r = infer(DEMO);
  assert.ok(r.masterAudit && r.masterAudit.length > 0, "masterAudit이 비어있음(마스터 대조 미작동)");
  const beam = r.masterAudit!.find((m) => m.master.id === "MBEAM");
  assert.ok(beam, "MBEAM(배광 법규 마스터) audit이 없음 — FMBEAM→REF_MASTER→MBEAM 경로 미도달");
});

test("모든 항목은 비어있지 않은 evidence 를 가진다 (근거 우선 골든 룰)", () => {
  const r = infer(DEMO);
  for (const it of r.checklist) {
    assert.ok(Array.isArray(it.evidence) && it.evidence.length > 0, `항목 "${it.title}" 의 evidence 가 비어있음`);
  }
});

test("모든 항목은 confidence(%) 를 가진다", () => {
  const r = infer(DEMO);
  for (const it of r.checklist) {
    assert.equal(typeof it.confidence, "number");
    assert.ok(it.confidence >= 0 && it.confidence <= 100, `confidence 범위 오류: ${it.confidence}`);
  }
});

test("모든 trace hop 은 store 에 실제 존재하는 엣지다 (하드코딩 아님 보장)", () => {
  const r = infer(DEMO);
  let hops = 0;
  for (const it of r.checklist) {
    assert.ok(it.trace.length > 0, `항목 "${it.title}" 의 trace 가 비어있음`);
    for (const hop of it.trace) {
      const parts = hop.split("→");
      assert.equal(parts.length, 3, `trace hop 형식 오류: ${hop}`);
      const [a, rel, b] = parts;
      assert.ok(EDGE_KEYS.has(`${a}|${rel}|${b}`), `존재하지 않는 엣지 경로: ${hop}`);
      assert.ok(getNode(a) && getNode(b), `경로 노드 누락: ${hop}`);
      hops++;
    }
  }
  assert.ok(hops > 0, "검증할 trace hop 이 없음");
});

test("traversed 카운트가 채워진다", () => {
  const r = infer(DEMO);
  assert.ok(r.traversed.objects > 0, "traversed.objects 가 0");
  assert.ok(r.traversed.edges > 0, "traversed.edges 가 0");
});

test("anchorItem 지정 시 그 부품의 고장 이력으로 스코프된다 (부품 중심 모드)", () => {
  // store 에서 실제 부품(HAS_FAILURE src)을 하나 골라 앵커로 사용 — 하드코딩 라벨 회피.
  const hasFailure = allEdges().find((e) => e.rel === "HAS_FAILURE");
  assert.ok(hasFailure, "HAS_FAILURE 엣지가 없음");
  const item = getNode(hasFailure!.src);
  assert.ok(item && item.type === "item", "HAS_FAILURE src 가 부품이 아님");
  const r = infer({ ...DEMO, anchorItem: item!.label });
  assert.ok(r.checklist.length > 0, "부품 앵커 체크리스트가 비어있음");
  // 부품 중심: "유사 프로젝트" 근거는 없고(프로젝트 루프 스킵), "선택 부품" 프레이즈가 등장한다.
  // (규제 항목 desc 는 시장 문구로 덮이므로 all 이 아닌 some 으로 검증)
  assert.ok(!r.checklist.some((c) => /유사 프로젝트/.test(c.desc)), "부품 중심인데 유사 프로젝트 근거가 섞임");
  assert.ok(r.checklist.some((c) => /선택 부품/.test(c.desc)), "선택 부품 프레이즈가 없음");
  // trace 에 부품→HAS_FAILURE→고장모드 홉이 존재 (실제 엣지 경로)
  assert.ok(
    r.checklist.some((c) => c.trace.some((t) => t.includes("HAS_FAILURE"))),
    "trace 에 부품→HAS_FAILURE 홉이 없음"
  );
  // 부품 검토도 "과거 어느 프로젝트에서 발생했나"(proj→OCCURRED_IN→fm)를 붙여야 한다.
  // 데이터의 OCCURRED_IN 은 proj→fm 방향(fm 기준 in-edge)이라, 이 홉이 없으면 부품 검토가
  // 과거 사례 근거를 통째로 잃는다(회귀 방지 — 실제 발생 이력 있는 고장모드가 최소 1건 존재).
  assert.ok(
    r.checklist.some((c) => c.trace.some((t) => /OCCURRED_IN/.test(t))),
    "부품 앵커 trace 에 proj→OCCURRED_IN→fm 발생 이력 홉이 없음 (과거 사례 근거 유실)"
  );
});

test("anchorItem 없으면 유사 프로젝트 기반 유지 (기존 동작 회귀 방지)", () => {
  const r = infer(DEMO);
  assert.ok(r.checklist.some((c) => /유사 프로젝트/.test(c.desc)), "기본 모드인데 유사 프로젝트 근거가 없음");
});

test("확신도 breakdown — 항 합계가 confidence 와 일치, 각 항 ≥ 0 (블랙박스 아님 검증)", () => {
  for (const input of [DEMO, FOG_DEMO]) {
    const r = infer(input);
    assert.ok(r.checklist.length > 0, "체크리스트가 비어있음");
    for (const it of r.checklist) {
      assert.ok(it.breakdown, `항목 "${it.title}" 에 breakdown 이 없음`);
      const { sim, evid, sev, master, boost } = it.breakdown!;
      for (const [k, v] of Object.entries({ sim, evid, sev, master, boost })) {
        assert.ok(v >= 0, `항목 "${it.title}" 의 breakdown.${k} 가 음수: ${v}`);
      }
      const sum = sim + evid + sev + master + boost;
      assert.ok(
        Math.abs(sum - it.confidence / 100) <= 0.01,
        `항목 "${it.title}" breakdown 합계(${sum.toFixed(4)}) != confidence/100(${(it.confidence / 100).toFixed(4)})`
      );
    }
  }
});
