// lib/provision/naming.test.ts — k8s 리소스 이름·bolt URI 정규화 회귀(라이브 의존 0).
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

const { resourceName, boltUri } = await import("./naming.ts");

const K8S_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

test("resourceName: 한글 캔버스 id → 유효한 k8s 이름", () => {
  const name = resourceName("품질관리 캔버스");
  assert.match(name, K8S_NAME);
  assert.ok(name.length <= 63);
  assert.ok(name.startsWith("neo4j-"));
});

test("resourceName: 공백·대문자 섞인 id → 유효한 k8s 이름", () => {
  const name = resourceName("My Canvas ID");
  assert.match(name, K8S_NAME);
  assert.ok(name.length <= 63);
});

test("resourceName: 결정적(같은 입력 → 같은 출력)", () => {
  assert.equal(resourceName("품질관리 캔버스"), resourceName("품질관리 캔버스"));
  assert.equal(resourceName("default"), resourceName("default"));
});

test("resourceName: 서로 다른 입력 → 서로 다른 이름(단순 충돌 없음)", () => {
  const a = resourceName("캔버스 A");
  const b = resourceName("캔버스 B");
  const c = resourceName("default");
  const d = resourceName("other");
  assert.notEqual(a, b);
  assert.notEqual(c, d);
});

test("resourceName: 빈 문자열 → 예외", () => {
  assert.throws(() => resourceName(""));
});

test("boltUri: resourceName + 7687 포트 포함", () => {
  const uri = boltUri("default");
  assert.ok(uri.includes(resourceName("default")));
  assert.ok(uri.includes(":7687"));
  assert.ok(uri.startsWith("bolt://"));
});

test("boltUri: namespace override 반영", () => {
  const uri = boltUri("default", "custom-ns");
  assert.ok(uri.includes("custom-ns"));
});
