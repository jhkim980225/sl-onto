// lib/chunk.test.ts — 형식별 청킹 규칙 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/graph-memo.test.ts 상단과 동일.
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

const { chunkBlocks, CHUNK_CHARS } = await import("./chunk.ts");
type SourceBlock = import("./source-text").SourceBlock;

/** 표 블록 — 헤더 1행 + 데이터 n행. 각 행은 약 60자. */
const tableBlock = (n: number): SourceBlock => {
  const header = ["접수번호", "제품", "증상 현상", "추정 원인"];
  const rows = [header];
  for (let i = 0; i < n; i++) {
    rows.push([`CL-${1000 + i}`, "CP-101 하이드라 수분크림 50ml", "상분리", "유화제 함량 부족"]);
  }
  return { label: "클레임", rows, lines: rows.map((r) => r.join(" │ ")) };
};

test("표: 모든 청크에 헤더가 포함된다", () => {
  const chunks = chunkBlocks([tableBlock(60)]);
  assert.ok(chunks.length > 1, `분할돼야 한다 (실제 ${chunks.length})`);
  for (const c of chunks) {
    assert.ok(c.text.includes("증상 현상"), `헤더 누락: ${c.text.slice(0, 60)}`);
  }
});

test("표: 청크가 상한을 넘지 않는다", () => {
  for (const c of chunkBlocks([tableBlock(60)])) {
    assert.ok(c.text.length <= CHUNK_CHARS * 1.3, `너무 길다: ${c.text.length}`);
  }
});

test("표: 같은 데이터 행이 두 청크에 중복되지 않는다 (오버랩 없음)", () => {
  const chunks = chunkBlocks([tableBlock(60)]);
  const seen = new Set<string>();
  for (const c of chunks) {
    for (const line of c.text.split("\n")) {
      if (!line.startsWith("CL-")) continue; // 헤더는 반복이 정상
      assert.ok(!seen.has(line), `데이터 행 중복: ${line}`);
      seen.add(line);
    }
  }
  assert.equal(seen.size, 60, "데이터 행이 전부 한 번씩 나와야 한다");
});

test("산문: 문단 경계에서만 자른다", () => {
  const paras = Array.from({ length: 30 }, (_, i) => `문단${i} ` + "가".repeat(100));
  const chunks = chunkBlocks([{ label: "본문", lines: paras }]);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    for (const line of c.text.split("\n")) {
      if (!line.trim()) continue;
      assert.ok(paras.includes(line), `문단이 잘렸다: ${line.slice(0, 40)}`);
    }
  }
});

test("산문: 인접 청크가 1문단 겹친다", () => {
  const paras = Array.from({ length: 30 }, (_, i) => `문단${i} ` + "가".repeat(100));
  const chunks = chunkBlocks([{ label: "본문", lines: paras }]);
  const first = chunks[0].text.split("\n").filter(Boolean);
  const second = chunks[1].text.split("\n").filter(Boolean);
  assert.equal(second[0], first[first.length - 1], "다음 청크가 직전 문단으로 시작해야 한다");
});

test("블록 label 이 청크에 보존된다", () => {
  const chunks = chunkBlocks([{ label: "슬라이드 3", lines: ["8D 리포트", "이슈: 상분리"] }]);
  assert.equal(chunks[0].block, "슬라이드 3");
});

test("빈 블록·공백 줄은 청크를 만들지 않는다", () => {
  assert.equal(chunkBlocks([]).length, 0);
  assert.equal(chunkBlocks([{ label: "본문", lines: [] }]).length, 0);
  assert.equal(chunkBlocks([{ label: "본문", lines: ["   ", ""] }]).length, 0);
});

test("seq 는 문서 전체에서 0부터 연속이다", () => {
  const chunks = chunkBlocks([tableBlock(40), { label: "메모", lines: ["끝"] }]);
  assert.deepEqual(
    chunks.map((c) => c.seq),
    chunks.map((_, i) => i)
  );
});
