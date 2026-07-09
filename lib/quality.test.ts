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

const { scanQuality, scanDupSemantic } = await import("./quality.ts");
const { allNodes, mergeDelta } = await import("./store.ts");

// 규칙당 상한(lib/quality.ts MAX_PER_RULE) — 여기서 하드코딩된 값과 어긋나면 lib 쪽 상수도 확인할 것.
const MAX_PER_RULE = 8;

// ── 합성 노드 주입(인메모리 mergeDelta) — 정식↔정식 fold 일치 + 의미 유사 시나리오 재료 ──
// A ↔ B 는 fold 완전 일치(공백·대소문자 차이 — 88 규칙 대상), C 는 fold 이 달라 렉시컬로는 못 잡는
// 동의 개체(semantic 규칙 대상). 라벨은 실데이터와 충돌하지 않게 "품질검사용 …" 고유 문자열 사용.
// A 에 근거 2개를 줘 degree 를 높인다(mergeInto 방향 고정).
await mergeDelta(
  [
    { id: "TESTQ_LENS_A", type: "item", label: "품질검사용 렌즈 XQ" },
    { id: "TESTQ_LENS_B", type: "item", label: "품질검사용렌즈xq" },
    { id: "TESTQ_LENS_C", type: "item", label: "품질검사용 외측렌즈 XQ" },
    { id: "TESTQ_DOC1", type: "doc", label: "testq-근거1.xlsx", ext: "XLSX" },
    { id: "TESTQ_DOC2", type: "doc", label: "testq-근거2.xlsx", ext: "XLSX" },
  ],
  [
    { src: "TESTQ_LENS_A", rel: "EVIDENCED_BY", dst: "TESTQ_DOC1" },
    { src: "TESTQ_LENS_A", rel: "EVIDENCED_BY", dst: "TESTQ_DOC2" },
    { src: "TESTQ_LENS_B", rel: "EVIDENCED_BY", dst: "TESTQ_DOC1" },
    { src: "TESTQ_LENS_C", rel: "EVIDENCED_BY", dst: "TESTQ_DOC1" },
  ],
  "test"
);

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

test("오탐 가드: dup-candidate 의 mergeInto 는 항상 정식 노드, 정식↔정식 쌍은 confidence 88", () => {
  const items = scanQuality();
  for (const it of items) {
    if (it.kind !== "dup-candidate") continue;
    assert.ok(it.mergeInto && !it.mergeInto.startsWith("AUTO_"), `병합 대상이 정식 노드가 아님: ${it.mergeInto} (${it.title})`);
    assert.notEqual(it.nodeId, it.mergeInto, `자기 자신으로 병합 제안: ${it.nodeId}`);
    if (!it.nodeId.startsWith("AUTO_")) {
      // 정식↔정식 fold 일치 규칙 — 고정 확신도 88 (AUTO exact 92 / token 45 와 구분)
      assert.equal(it.confidence, 88, `정식↔정식 dup-candidate 인데 confidence 가 88 이 아님: ${it.confidence} (${it.title})`);
    }
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

test("정식↔정식 fold 일치: 주입한 표기 변형 노드가 degree 높은 쪽으로 병합 제안된다(확신도 88)", () => {
  const items = scanQuality();
  const dup = items.find((it) => it.kind === "dup-candidate" && it.nodeId === "TESTQ_LENS_B");
  assert.ok(dup, `정식↔정식 dup-candidate 없음: ${items.filter((i) => i.kind === "dup-candidate").map((i) => i.title).join(" | ")}`);
  assert.equal(dup!.mergeInto, "TESTQ_LENS_A", "mergeInto 는 degree 높은 쪽이어야 함");
  assert.equal(dup!.confidence, 88);
  assert.ok(dup!.evidence.length > 0, "정식↔정식 dup 인데 evidence 가 비어있음");
});

test("scanDupSemantic: 주입 fetcher 로 유닛 검증 — 임계 미만 쌍만, fold 일치 쌍은 스킵, 방향은 degree 규칙", async () => {
  const items = await scanDupSemantic(async () => [
    { id: "TESTQ_LENS_C", other: "TESTQ_LENS_A", dist: 0.09 }, // 동의 개체 — 보고 대상
    { id: "TESTQ_LENS_A", other: "TESTQ_LENS_B", dist: 0.01 }, // fold 일치 — 렉시컬 규칙 몫(스킵)
    { id: "TESTQ_LENS_C", other: "TESTQ_LENS_B", dist: 0.2 },  // 임계(0.15) 이상 — 스킵
  ]);
  assert.equal(items.length, 1, `기대 1건, 실제 ${items.length}건: ${items.map((i) => i.title).join(" | ")}`);
  const it = items[0];
  assert.equal(it.kind, "dup-candidate");
  assert.equal(it.nodeId, "TESTQ_LENS_C", "degree 낮은 쪽이 병합되는(nodeId) 쪽이어야 함");
  assert.equal(it.mergeInto, "TESTQ_LENS_A");
  assert.equal(it.confidence, 50);
  assert.ok(it.evidence.length > 0, "semantic dup 인데 evidence 가 비어있음");
});

test("scanDupSemantic: fetcher 오류·DB 미가용이면 조용히 빈 배열(스캔 자체를 막지 않음)", async () => {
  assert.deepEqual(await scanDupSemantic(async () => { throw new Error("boom"); }), []);
  if (!process.env.DATABASE_URL) assert.deepEqual(await scanDupSemantic(), []);
});

test("no-evidence 규칙만 evidence 가 의도적으로 빈 배열일 수 있다(그 외 규칙은 근거를 동반)", () => {
  const items = scanQuality();
  for (const it of items) {
    if (it.kind === "no-evidence") continue;
    assert.ok(it.evidence.length > 0, `${it.kind} 항목인데 evidence 가 비어있음: ${it.title}`);
  }
});
