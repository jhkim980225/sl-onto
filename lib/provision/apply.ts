// lib/provision/apply.ts — Neo4j 프로비저닝 매니페스트(neo4j-manifest.ts)를 실제 k8s 클러스터에 적용/철거한다.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md §0(pod-per-canvas), §8(다음 범위)
//
// 매니페스트 생성(순수)은 neo4j-manifest.ts 책임. 이 모듈은 그 결과를 클러스터에 배선하는 IO 계층.
// 라이브 클러스터 미보유 환경에서 import 만으로 실패하지 않도록, k8s 클라이언트 생성은 호출 시점에만 수행한다.

import { AppsV1Api, ApiException, CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import type { V1StatefulSet, V1Service, V1Secret } from "@kubernetes/client-node";
import { neo4jManifest, type Neo4jManifestOptions } from "./neo4j-manifest.ts";
import { resourceName, boltUri, DEFAULT_NAMESPACE } from "./naming.ts";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 280_000;

/** StatefulSet 의 volumeClaimTemplate("data")이 단일 replica(ordinal 0)로 실제 만드는 PVC 이름. */
function pvcName(statefulSetName: string): string {
  return `data-${statefulSetName}-0`;
}

function getClients(): { apps: AppsV1Api; core: CoreV1Api } {
  try {
    const kc = new KubeConfig();
    kc.loadFromDefault();
    return { apps: kc.makeApiClient(AppsV1Api), core: kc.makeApiClient(CoreV1Api) };
  } catch (err) {
    throw wrapError("k8s 클러스터 설정을 불러올 수 없습니다(kubeconfig 확인 필요)", err);
  }
}

function isConflict(err: unknown): boolean {
  return err instanceof ApiException && err.code === 409;
}

function isNotFound(err: unknown): boolean {
  return err instanceof ApiException && err.code === 404;
}

function wrapError(prefix: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`${prefix}: ${message}`, { cause: err });
}

/** 존재하지 않으면(404) 조용히 통과, 그 외 실패는 명확한 메시지로 다시 던진다. */
async function deleteIgnoringNotFound(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (!isNotFound(err)) throw wrapError(`Neo4j ${label} 삭제 실패`, err);
  }
}

/**
 * 캔버스의 Neo4j StatefulSet+Service 를 클러스터에 적용한다.
 * 이미 존재하면(409) 멱등 성공으로 취급한다(create-or-noop) — StatefulSet/Service 의
 * 불변 필드·resourceVersion 요구 때문에 replace 는 별도 조회 없이는 안전하지 않다.
 * 재프로비저닝은 no-op 이어야 하며 기존 리소스를 덮어쓰지 않는다.
 * PVC 는 StatefulSet 의 volumeClaimTemplate 이 자동 생성하므로 별도 적용 대상이 아니다.
 */
export async function provisionNeo4j(
  canvasId: string,
  opts: Neo4jManifestOptions = {},
): Promise<{ boltUri: string }> {
  const { statefulSet, service, secret } = neo4jManifest(canvasId, opts);
  const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
  const { apps, core } = getClients();

  try {
    await core.createNamespacedSecret({ namespace, body: secret as unknown as V1Secret });
  } catch (err) {
    if (!isConflict(err)) throw wrapError("Neo4j Secret 적용 실패", err);
    console.log(`Neo4j Secret 이미 존재(캔버스=${canvasId}) — 멱등 통과`);
  }

  try {
    await apps.createNamespacedStatefulSet({ namespace, body: statefulSet as unknown as V1StatefulSet });
  } catch (err) {
    if (!isConflict(err)) throw wrapError("Neo4j StatefulSet 적용 실패", err);
    console.log(`Neo4j StatefulSet 이미 존재(캔버스=${canvasId}) — 멱등 통과`);
  }

  try {
    await core.createNamespacedService({ namespace, body: service as unknown as V1Service });
  } catch (err) {
    if (!isConflict(err)) throw wrapError("Neo4j Service 적용 실패", err);
    console.log(`Neo4j Service 이미 존재(캔버스=${canvasId}) — 멱등 통과`);
  }

  return { boltUri: boltUri(canvasId, namespace) };
}

/** 캔버스의 Neo4j StatefulSet·Service·PVC 를 삭제한다(존재하지 않는 리소스는 조용히 통과). */
export async function teardownNeo4j(canvasId: string, namespace: string = DEFAULT_NAMESPACE): Promise<void> {
  const name = resourceName(canvasId);
  const { apps, core } = getClients();

  await deleteIgnoringNotFound(() => apps.deleteNamespacedStatefulSet({ name, namespace }), "StatefulSet");
  await deleteIgnoringNotFound(() => core.deleteNamespacedService({ name, namespace }), "Service");
  await deleteIgnoringNotFound(
    () => core.deleteNamespacedPersistentVolumeClaim({ name: pvcName(name), namespace }),
    "PVC",
  );
  await deleteIgnoringNotFound(
    () => core.deleteNamespacedSecret({ name: `${name}-auth`, namespace }),
    "Secret",
  );
}

/** 네임스페이스의 캔버스(Neo4j StatefulSet) 목록. 원본 canvasId 는 어노테이션에서 복원하고,
 *  (구버전 리소스 등) 어노테이션이 없으면 이름의 `neo4j-` 접두어를 떼어 폴백한다. */
export async function listCanvases(namespace: string = DEFAULT_NAMESPACE): Promise<string[]> {
  const { apps } = getClients();
  const res = await apps.listNamespacedStatefulSet({ namespace, labelSelector: "app=neo4j" });
  return (res.items ?? [])
    .map((sts) => sts.metadata?.annotations?.["sl-onto/canvas-id"] ?? sts.metadata?.name?.replace(/^neo4j-/, "") ?? null)
    .filter((id): id is string => !!id)
    .sort((a, b) => a.localeCompare(b));
}

/** StatefulSet 의 readyReplicas>=1 이 될 때까지 폴링한다. timeoutMs 내 준비 안 되면 false. */
export async function waitForNeo4j(
  canvasId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  namespace: string = DEFAULT_NAMESPACE,
): Promise<boolean> {
  const name = resourceName(canvasId);
  const { apps } = getClients();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const sts = await apps.readNamespacedStatefulSet({ name, namespace });
      if ((sts.status?.readyReplicas ?? 0) >= 1) return true;
    } catch (err) {
      if (!isNotFound(err)) throw wrapError("Neo4j StatefulSet 상태 조회 실패", err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
