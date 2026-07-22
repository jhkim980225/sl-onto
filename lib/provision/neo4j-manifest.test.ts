// lib/provision/neo4j-manifest.test.ts — Neo4j Community 매니페스트 생성기 회귀(라이브 의존 0).
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

const { neo4jManifest } = await import("./neo4j-manifest.ts");
const { resourceName } = await import("./naming.ts");

test("statefulSet: Neo4j Community 이미지·bolt+http 포트·NEO4J_AUTH secretKeyRef·데이터 마운트", () => {
  const { statefulSet } = neo4jManifest("default");
  const name = resourceName("default");
  const container = (statefulSet as any).spec.template.spec.containers[0];
  assert.equal(container.image, "neo4j:5-community");
  const ports = container.ports.map((p: any) => p.containerPort);
  assert.ok(ports.includes(7687));
  assert.ok(ports.includes(7474));
  const auth = container.env.find((e: any) => e.name === "NEO4J_AUTH");
  assert.ok(auth);
  assert.equal(auth.value, undefined);
  assert.equal(auth.valueFrom.secretKeyRef.name, `${name}-auth`);
  assert.equal(auth.valueFrom.secretKeyRef.key, "NEO4J_AUTH");
  const mount = container.volumeMounts.find((m: any) => m.mountPath === "/data");
  assert.ok(mount);
});

test("secret: kind Secret·이름 <resourceName>-auth·stringData.NEO4J_AUTH", () => {
  const { secret } = neo4jManifest("default");
  const name = resourceName("default");
  assert.equal((secret as any).kind, "Secret");
  assert.equal((secret as any).metadata.name, `${name}-auth`);
  assert.equal((secret as any).type, "Opaque");
  assert.match((secret as any).stringData.NEO4J_AUTH, /^neo4j\//);
});

test("PVC/volumeClaimTemplate: 기본 스토리지 5Gi, /data 볼륨", () => {
  const { statefulSet, pvc } = neo4jManifest("default");
  const vct = (statefulSet as any).spec.volumeClaimTemplates[0];
  assert.equal(vct.spec.resources.requests.storage, "5Gi");
  assert.deepEqual(pvc, vct);
});

test("service: selector가 statefulSet pod 라벨과 일치", () => {
  const { statefulSet, service } = neo4jManifest("default");
  const podLabels = (statefulSet as any).spec.template.metadata.labels;
  assert.deepEqual((service as any).spec.selector, podLabels);
  const ports = (service as any).spec.ports.map((p: any) => p.port);
  assert.ok(ports.includes(7687));
  assert.ok(ports.includes(7474));
  assert.equal((service as any).spec.type, "ClusterIP");
});

test("이름 일관성: statefulSet·service·pvc·secret 라벨이 resourceName 기준 동일", () => {
  const canvasId = "품질 캔버스";
  const name = resourceName(canvasId);
  const { statefulSet, service, secret } = neo4jManifest(canvasId);
  assert.equal((statefulSet as any).metadata.name, name);
  assert.equal((service as any).metadata.name, name);
  assert.equal((statefulSet as any).metadata.labels.canvas, name);
  assert.equal((service as any).metadata.labels.canvas, name);
  assert.equal((secret as any).metadata.name, `${name}-auth`);
  assert.equal((secret as any).metadata.labels.canvas, name);
});

test("opts override: memory·storage·namespace·password 반영", () => {
  const { statefulSet, service, secret } = neo4jManifest("default", {
    namespace: "custom-ns",
    memory: "4Gi",
    storage: "20Gi",
    password: "sekret",
  });
  const ss = statefulSet as any;
  assert.equal(ss.metadata.namespace, "custom-ns");
  assert.equal((service as any).metadata.namespace, "custom-ns");
  assert.equal((secret as any).metadata.namespace, "custom-ns");
  assert.equal(ss.spec.template.spec.containers[0].resources.limits.memory, "4Gi");
  assert.equal(ss.spec.volumeClaimTemplates[0].spec.resources.requests.storage, "20Gi");
  const auth = ss.spec.template.spec.containers[0].env.find((e: any) => e.name === "NEO4J_AUTH");
  assert.equal(auth.valueFrom.secretKeyRef.name, resourceName("default") + "-auth");
  assert.equal((secret as any).stringData.NEO4J_AUTH, "neo4j/sekret");
});

test("deterministic: 같은 입력 → 동일 매니페스트(구조적으로)", () => {
  const a = neo4jManifest("default");
  const b = neo4jManifest("default");
  assert.deepEqual(a, b);
});

test("statefulSet: enableServiceLinks false (Neo4j 가 k8s Service env 를 config 로 오인·크래시 방지)", () => {
  const { statefulSet } = neo4jManifest("c1");
  const spec = (statefulSet as any).spec.template.spec;
  assert.equal(spec.enableServiceLinks, false);
});

test("PVC: storageClass 지정 시 storageClassName 반영, 미지정이면 없음(클러스터 기본)", () => {
  const withSC = neo4jManifest("c1", { storageClass: "nfs-client" });
  const sc = ((withSC.statefulSet as any).spec.volumeClaimTemplates[0].spec.storageClassName);
  assert.equal(sc, "nfs-client");
  const without = neo4jManifest("c1");
  assert.equal(((without.statefulSet as any).spec.volumeClaimTemplates[0].spec.storageClassName), undefined);
});
