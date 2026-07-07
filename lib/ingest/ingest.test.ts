// lib/ingest/ingest.test.ts — Node 내장 테스트 러너 (`node --test --experimental-strip-types`).
// 이제 원천 파일은 백본(seed 유도) + 도메인 풀 대량 데이터로 구성되므로 "== seed" 라운드트립은
// 성립하지 않는다. 대신: (1) 시나리오 핵심 백본 id 존재, (2) 총 노드 수 정상 대역,
// (3) 모든 노드의 타입·라벨 유효, (4) 모든 doc 에 부모 존재, (5) 원본코드(외관-B) 보존,
// (6) 데모 infer 시나리오가 여전히 FMVSS 108·수축 항목을 낸다 — 를 검증한다.
//
// infer.test.ts 와 동일한 resolve 훅으로 확장자 없는 상대 import 를 ".ts" 로 보정한다.
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

const { ingestAll } = await import("./index.ts");
type Node = import("../types.ts").Node;

const result = ingestAll();

const VALID_TYPES = new Set(["item", "fm", "cause", "action", "reg", "proj", "master", "spec", "doc"]);
// 추론 시나리오가 의존하는 백본 엔티티 id (seed.ts / infer.ts 근거).
const BACKBONE = [
  "PJ16", "PJ19", "PJ21", "PJ23", "PJ26",
  "RUS", "REU", "RKR", "RCN",
  "CSHRINK", "CTHERM",
  "FMGAP", "FMBEAM", "FMSHRINK", "FMLUM",
  "MGAP", "MTHERM", "MBEAM",
];

test("시나리오 핵심 백본 id 가 모두 재구성 결과에 존재한다", () => {
  const got = new Set(result.nodes.map((n) => n.id));
  const missing = BACKBONE.filter((id) => !got.has(id));
  assert.deepEqual(missing, [], `누락된 백본 노드: ${missing.join(", ")}`);
});

test("총 노드 수가 정상 대역(100~600)이다", () => {
  const n = result.nodes.length;
  assert.ok(n >= 100 && n <= 600, `노드 수 ${n} — 100~600 범위를 벗어남`);
});

test("모든 노드가 유효한 타입과 비어있지 않은 라벨을 가진다", () => {
  for (const n of result.nodes as Node[]) {
    assert.ok(VALID_TYPES.has(n.type), `노드 ${n.id} 의 타입이 유효하지 않음: ${n.type}`);
    assert.ok(typeof n.label === "string" && n.label.length > 0, `노드 ${n.id} 의 라벨이 비어있음`);
  }
});

test("모든 doc 노드가 부모(EVIDENCED_BY 대상)를 가진다", () => {
  const evidenced = new Map<string, string>(); // docId → src
  for (const e of result.edges) if (e.rel === "EVIDENCED_BY") evidenced.set(e.dst, e.src);
  for (const n of result.nodes as Node[]) {
    if (n.type !== "doc") continue;
    assert.ok(n.parent || evidenced.has(n.id), `doc ${n.id} 에 부모가 없음`);
  }
});

test("원천 파일이 8개 이상이며 각 파일이 최소 1개 객체를 추출한다", () => {
  assert.ok(result.sources.length >= 8, `sources.length = ${result.sources.length} (>=8 필요)`);
  for (const s of result.sources) {
    assert.ok(s.extracted.objects > 0, `${s.file} 추출 객체 0`);
  }
});

test("정규화 미리보기가 원문·확신도를 보존하고 외관-B → FMGAP(0.72) 매핑이 남아있다", () => {
  const withPreview = result.sources.filter((s) => s.preview.length > 0);
  assert.ok(withPreview.length > 0, "미리보기 샘플이 있어야 함");
  for (const s of withPreview) {
    for (const p of s.preview) {
      assert.ok(typeof p.raw === "string" && p.raw.length > 0, "원문 보존");
      assert.ok(p.confidence > 0 && p.confidence <= 1, `확신도 범위: ${p.confidence}`);
    }
  }
  const rawcode = result.sources.flatMap((s) => s.preview).find((p) => p.raw === "외관-B");
  assert.ok(rawcode && rawcode.id === "FMGAP", '"외관-B" → FMGAP 매핑 존재');
  assert.equal(rawcode!.confidence, 0.72, "외관-B 확신도 0.72");
});

test("데모 infer 시나리오가 여전히 FMVSS 108 · 수축 항목을 낸다", async () => {
  const { infer } = await import("../infer.ts");
  const r = infer({
    market: "북미",
    lightSource: "LED",
    shape: ["분리형 DRL", "슬림 하우징"],
    components: ["헤드램프 어셈블리"],
  });
  assert.ok(r.checklist.length >= 5, `checklist ${r.checklist.length}개 (>=5 필요)`);
  const fmvss = r.checklist.find(
    (x) => /FMVSS\s*108/.test(x.title) || x.evidence.some((e) => /FMVSS\s*108/.test(e)) || x.trace.some((t) => /RUS/.test(t))
  );
  assert.ok(fmvss, "북미 FMVSS 108 항목이 없음");
  const shrink = r.checklist.find((x) => /수축/.test(x.title));
  assert.ok(shrink, "슬림 → 수축 항목이 없음");
});
