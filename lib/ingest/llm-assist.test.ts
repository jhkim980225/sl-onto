// lib/ingest/llm-assist.test.ts — LLM 추출 결과 → 온톨로지 델타 변환 (`node --test --experimental-strip-types`).
// LLM 응답은 픽스처로 주입(네트워크·store 무관 — llmExtractToDelta 는 순수 함수).
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

const { llmExtractToDelta } = await import("./llm-assist.ts");

import type { Node } from "../types";

const DOC = "doc:재발방지대책서.pdf";
const EXISTING: Node[] = [
  { id: "FMFOG", type: "fm", label: "결로·습기" },
  { id: "AUTO_item_deadbeef", type: "item", label: "벤트 어셈블리 개선형" },
  { id: "doc:이전문서.xlsx", type: "doc", label: "이전문서.xlsx" },
];

test("vocab id 가 오면 기존 노드를 재사용한다(라벨은 권위 라벨, EVIDENCED_BY 없음)", () => {
  const d = llmExtractToDelta(
    { entities: [{ type: "fm", id: "FMFOG", label: "결로 습기 현상" }], relations: [] },
    DOC,
    EXISTING
  );
  assert.equal(d.nodes.length, 1);
  assert.deepEqual(
    { id: d.nodes[0].id, label: d.nodes[0].label, props: d.nodes[0].props },
    { id: "FMFOG", label: "결로·습기", props: undefined }
  );
  // 기존 노드 — 근거를 새로 붙이지 않는다(원본 보존)
  assert.equal(d.edges.length, 0);
});

test("label 만 와도 통제 어휘(동의어)로 정규화되면 기존 id 재사용, 미해결이면 AUTO 0.60 + LLM 표기", () => {
  const d = llmExtractToDelta(
    {
      entities: [
        { type: "item", label: "헤드램프" }, // 동의어 → IHL (AUTO 아님)
        { type: "cause", label: "습기 유입 경로 미확인" }, // 미등록 → AUTO
      ],
      relations: [],
    },
    DOC,
    []
  );
  const item = d.nodes.find((n) => n.type === "item")!;
  assert.equal(item.id, "IHL");
  assert.equal(item.props, undefined); // 통제 어휘 재사용에는 LLM 표기 없음
  const cause = d.nodes.find((n) => n.type === "cause")!;
  assert.ok(cause.id.startsWith("AUTO_cause_"), `AUTO id 아님: ${cause.id}`);
  assert.deepEqual(cause.props, [["추출", "LLM"], ["확신도", "0.60"]]);
  // 새 노드 2개 모두 doc 근거 연결(골든 룰 #1)
  const ev = d.edges.filter((e) => e.rel === "EVIDENCED_BY" && e.dst === DOC).map((e) => e.src).sort();
  assert.deepEqual(ev, [cause.id, "IHL"].sort());
});

test("관계는 fold 매칭 — 델타·기존 온톨로지 라벨 모두에 대해 공백·기호 접기로 붙는다", () => {
  const d = llmExtractToDelta(
    {
      entities: [{ type: "cause", label: "습기 유입 경로 미확인" }],
      relations: [
        // dst "결로습기" → 기존 FMFOG("결로·습기") fold 일치 / src 는 이번 델타의 AUTO 원인(공백 변형)
        { srcLabel: "습기유입경로 미확인", rel: "CAUSED_BY", dstLabel: "결로습기" },
        // src "벤트어셈블리 개선형" → 기존 AUTO 노드 fold 일치
        { srcLabel: "벤트어셈블리 개선형", rel: "HAS_FAILURE", dstLabel: "결로·습기" },
      ],
    },
    DOC,
    EXISTING
  );
  const cause = d.nodes.find((n) => n.type === "cause")!;
  const rels = d.edges.filter((e) => e.rel !== "EVIDENCED_BY");
  assert.deepEqual(rels, [
    { src: cause.id, rel: "CAUSED_BY", dst: "FMFOG" },
    { src: "AUTO_item_deadbeef", rel: "HAS_FAILURE", dst: "FMFOG" },
  ]);
});

test("매칭 실패 관계·허용 밖 rel·허용 밖 type 은 버린다(창작 방지)", () => {
  const d = llmExtractToDelta(
    {
      entities: [
        { type: "fm", id: "FMFOG", label: "결로·습기" },
        { type: "reg", label: "FMVSS 108" }, // 추출 대상 타입 아님 → 폐기
      ],
      relations: [
        { srcLabel: "존재하지 않는 부품", rel: "HAS_FAILURE", dstLabel: "결로·습기" }, // src 미매칭
        { srcLabel: "결로·습기", rel: "SIMILAR", dstLabel: "결로·습기" }, // 허용 밖 rel
      ],
    },
    DOC,
    EXISTING
  );
  assert.deepEqual(d.nodes.map((n) => n.id), ["FMFOG"]);
  assert.equal(d.edges.length, 0);
});

test("LLM 이 창작한 가짜 id 는 무시하고 label 경로로 처리한다", () => {
  const d = llmExtractToDelta(
    { entities: [{ type: "action", id: "FAKE_ID_99", label: "가스켓 이중 실링 적용" }], relations: [] },
    DOC,
    []
  );
  assert.equal(d.nodes.length, 1);
  assert.ok(d.nodes[0].id.startsWith("AUTO_action_"), `가짜 id 가 살아남음: ${d.nodes[0].id}`);
  assert.deepEqual(d.nodes[0].props, [["추출", "LLM"], ["확신도", "0.60"]]);
});
