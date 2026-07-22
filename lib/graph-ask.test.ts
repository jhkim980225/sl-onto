// lib/graph-ask.test.ts — graphAsk 오케스트레이션 회귀(모의 의존성, 라이브 Neo4j/LLM 불필요).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const { graphAsk } = await import("./graph-ask.ts");

const A = { id: "a", name: "Alice", type: "person", props: { role: "eng" } };
const B = { id: "b", name: "Bob", type: "person", props: {} };
const C = { id: "c", name: "Carol", type: "person", props: {} };

const REL_AB = { src: "a", dst: "b", type: "KNOWS" };
const REL_BC = { src: "b", dst: "c", type: "WORKS_AT" };

function baseDeps(overrides: Partial<Parameters<typeof graphAsk>[1]> = {}) {
  return {
    embedQuery: async () => [0.1, 0.2, 0.3],
    repo: {
      vectorSearch: async () => [
        { entity: A, score: 0.9 },
        { entity: B, score: 0.8 },
      ],
      neighbors: async (id: string) => {
        if (id === "a") return { entities: [A, B], relations: [REL_AB] };
        if (id === "b") return { entities: [B, C], relations: [REL_BC, REL_AB] }; // REL_AB 중복
        return { entities: [], relations: [] };
      },
    },
    llmAnswer: async () => ({ answer: "답변", citedEntityIds: ["a", "c"] }),
    ...overrides,
  };
}

test("정상 경로: 벡터 진입점 + 이웃 병합(중복 제거) + LLM 답변", async () => {
  const deps = baseDeps();
  const result = await graphAsk("질문", deps);
  assert.ok(!("error" in result), `에러 없어야 함: ${JSON.stringify(result)}`);
  if ("error" in result) return;

  // 엔티티 중복 제거: a, b, c 세 개만
  assert.deepEqual(
    result.entities.map((e) => e.id).sort(),
    ["a", "b", "c"]
  );
  // 관계 중복 제거: a-KNOWS-b, b-WORKS_AT-c 두 개만
  assert.equal(result.relations.length, 2);
  assert.ok(result.relations.some((r) => r.src === "a" && r.type === "KNOWS" && r.dst === "b"));
  assert.ok(result.relations.some((r) => r.src === "b" && r.type === "WORKS_AT" && r.dst === "c"));

  assert.equal(result.answer, "답변");
  assert.deepEqual(result.citedEntityIds, ["a", "c"]);
});

test("LLM 컨텍스트: 번호 붙은 엔티티 + 속성 + 화살표 관계 텍스트 포함", async () => {
  let capturedContext = "";
  const deps = baseDeps({
    llmAnswer: async (context: string) => {
      capturedContext = context;
      return { answer: "답변", citedEntityIds: [] };
    },
  });
  await graphAsk("질문", deps);
  assert.match(capturedContext, /\[E1\] Alice \(person\): role=eng/);
  assert.match(capturedContext, /Alice --KNOWS--> Bob/);
});

test("embedQuery가 null이면 503", async () => {
  const deps = baseDeps({ embedQuery: async () => null });
  const result = await graphAsk("질문", deps);
  assert.deepEqual(result, { error: "질의 임베딩 실패", status: 503 });
});

test("vectorSearch가 빈 배열이면 404", async () => {
  const deps = baseDeps({ repo: { vectorSearch: async () => [], neighbors: async () => ({ entities: [], relations: [] }) } });
  const result = await graphAsk("질문", deps);
  assert.deepEqual(result, { error: "관련 엔티티 없음", status: 404 });
});

test("llmAnswer가 null이면 503", async () => {
  const deps = baseDeps({ llmAnswer: async () => null });
  const result = await graphAsk("질문", deps);
  assert.deepEqual(result, { error: "LLM 응답 실패", status: 503 });
});
