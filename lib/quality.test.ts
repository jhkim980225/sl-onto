// lib/quality.test.ts — 온톨로지 품질 스캔 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/contradictions.test.ts 상단과 동일(확장자 없는 상대 import 보정).
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

const { scanQuality } = await import("./quality.ts");
const { allNodes } = await import("./store.ts");

// 규칙당 상한(lib/quality.ts MAX_PER_RULE) — 여기서 하드코딩된 값과 어긋나면 lib 쪽 상수도 확인할 것.
const MAX_PER_RULE = 8;

test("모든 항목의 confidence 는 0..100, nodeId 는 실존 노드를 가리킨다", () => {
  const items = scanQuality();
  const byId = new Set(allNodes().map((n) => n.id));
  for (const it of items) {
    assert.ok(it.confidence >= 0 && it.confidence <= 100, `confidence 범위 밖: ${it.confidence} (${it.title})`);
    assert.ok(byId.has(it.nodeId), `nodeId 가 실존 노드가 아님: ${it.nodeId} (${it.title})`);
    if (it.mergeInto) assert.ok(byId.has(it.mergeInto), `mergeInto 가 실존 노드가 아님: ${it.mergeInto} (${it.title})`);
  }
});

test("규칙당 상한을 지킨다 (건수 폭주 방지)", () => {
  const items = scanQuality();
  const byKind = new Map<string, number>();
  for (const it of items) byKind.set(it.kind, (byKind.get(it.kind) ?? 0) + 1);
  for (const [kind, count] of byKind) {
    assert.ok(count <= MAX_PER_RULE, `${kind} 규칙이 상한(${MAX_PER_RULE})을 초과: ${count}건`);
  }
});

test("오탐 가드: dup-candidate 는 항상 AUTO_* 노드만 병합 대상으로 제안한다(정상 노드 병합 제안 금지)", () => {
  const items = scanQuality();
  for (const it of items) {
    if (it.kind !== "dup-candidate") continue;
    assert.ok(it.nodeId.startsWith("AUTO_"), `dup-candidate 가 정식 노드를 지목함: ${it.nodeId} (${it.title})`);
    assert.ok(it.mergeInto && !it.mergeInto.startsWith("AUTO_"), `병합 대상이 정식 노드가 아님: ${it.mergeInto}`);
  }
});

test("오탐 가드: 근거·관계가 모두 있는 정상 노드(헤드램프 어셈블리 IHL)는 어떤 규칙에도 걸리지 않는다", () => {
  const items = scanQuality();
  assert.ok(
    !items.some((it) => it.nodeId === "IHL"),
    `정상 노드 IHL 이 품질 이슈로 오탐됨: ${items.find((it) => it.nodeId === "IHL")?.title}`
  );
});

test("실 데이터: 도면 프로젝트(PJ 2027-HL22)가 고립 노드(orphan)로 검출된다 — 근거는 있으나 관계가 없는 실제 케이스", () => {
  const items = scanQuality();
  const orphan = items.find((it) => it.kind === "orphan" && /2027-HL22/.test(it.title));
  assert.ok(
    orphan,
    `PJ 2027-HL22 orphan 항목 없음: ${items.map((it) => `${it.kind}:${it.title}`).join(" | ")}`
  );
  assert.ok(orphan!.evidence.length > 0, "orphan 항목인데 evidence 가 비어있음(근거 있는 고립만 orphan 이어야 함)");
});

test("no-evidence 규칙만 evidence 가 의도적으로 빈 배열일 수 있다(그 외 규칙은 근거를 동반)", () => {
  const items = scanQuality();
  for (const it of items) {
    if (it.kind === "no-evidence") continue;
    assert.ok(it.evidence.length > 0, `${it.kind} 항목인데 evidence 가 비어있음: ${it.title}`);
  }
});
