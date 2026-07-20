// lib/store.test.ts — 캔버스 간 격리 (`node --test --experimental-strip-types`).
// DATABASE_URL 없는 인메모리 모드 전제 — DB 모드 격리는 수동 검증(계획 §Task 3 Step 6).
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

const { withCanvas } = await import("./canvas-context.ts");
const store = await import("./store.ts");
type Node = import("./types").Node;

const N = (id: string, label: string): Node => ({ id, type: "item", label, props: [] });

test("캔버스 A 에 넣은 노드는 B 에서 보이지 않는다", async () => {
  await withCanvas("cv-a", () => store.mergeDelta([N("X1", "A의 노드")], []));
  assert.ok(withCanvas("cv-a", () => store.getNode("X1")), "A 에서는 보임");
  assert.equal(withCanvas("cv-b", () => store.getNode("X1")), undefined, "B 에서는 안 보임");
});

test("같은 id 노드가 두 캔버스에 서로 다른 내용으로 공존한다", async () => {
  await withCanvas("cv-c", () => store.mergeDelta([N("ILENS", "아우터 렌즈")], []));
  await withCanvas("cv-d", () => store.mergeDelta([N("ILENS", "전장 커넥터")], []));
  assert.equal(withCanvas("cv-c", () => store.getNode("ILENS")!.label), "아우터 렌즈");
  assert.equal(withCanvas("cv-d", () => store.getNode("ILENS")!.label), "전장 커넥터");
});

test("엣지도 캔버스별로 격리된다", async () => {
  await withCanvas("cv-e", () =>
    store.mergeDelta([N("P", "부품"), N("Q", "고장")], [{ src: "P", rel: "HAS_FAILURE", dst: "Q" }])
  );
  assert.equal(withCanvas("cv-e", () => store.outEdges("P").length), 1);
  assert.equal(withCanvas("cv-f", () => store.outEdges("P").length), 0);
});

test("삭제도 해당 캔버스에만 적용된다", async () => {
  await withCanvas("cv-g", () => store.mergeDelta([N("Z", "지울 것")], []));
  await withCanvas("cv-h", () => store.mergeDelta([N("Z", "남을 것")], []));
  await withCanvas("cv-g", () => store.removeNode("Z"));
  assert.equal(withCanvas("cv-g", () => store.getNode("Z")), undefined);
  assert.equal(withCanvas("cv-h", () => store.getNode("Z")!.label), "남을 것");
});

test("dropCanvasCache 후 그 캔버스는 비어 있다", async () => {
  await withCanvas("cv-i", () => store.mergeDelta([N("T", "임시")], []));
  assert.ok(withCanvas("cv-i", () => store.getNode("T")));
  store.dropCanvasCache("cv-i");
  assert.equal(withCanvas("cv-i", () => store.getNode("T")), undefined);
});
