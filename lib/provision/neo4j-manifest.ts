// lib/provision/neo4j-manifest.ts — 캔버스 id → Neo4j Community k8s 매니페스트(순수 함수, IO 없음).
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md §3, §5
//
// 매니페스트를 클러스터에 적용하는 것은 이 모듈의 책임이 아니다(라이브 배선은 후속 서브프로젝트).

import { resourceName, DEFAULT_NAMESPACE } from "./naming.ts";
import { DEV_NEO4J_PASSWORD } from "../neo4j/auth.ts";

const DEFAULT_MEMORY = "2Gi";
const DEFAULT_STORAGE = "5Gi";
/** ponytail: 개발 기본 비밀번호(driver.ts와 동일 소스) — 라이브 배선 시 Secret으로 교체. */
const DEFAULT_PASSWORD = DEV_NEO4J_PASSWORD;

export interface Neo4jManifestOptions {
  namespace?: string;
  memory?: string;
  storage?: string;
  password?: string;
}

export interface Neo4jManifest {
  statefulSet: Record<string, unknown>;
  service: Record<string, unknown>;
  pvc: Record<string, unknown>;
}

/** 캔버스별 Neo4j Community StatefulSet+Service+PVC(volumeClaimTemplate) 매니페스트를 생성한다. */
export function neo4jManifest(canvasId: string, opts: Neo4jManifestOptions = {}): Neo4jManifest {
  const name = resourceName(canvasId);
  const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
  const memory = opts.memory ?? DEFAULT_MEMORY;
  const storage = opts.storage ?? DEFAULT_STORAGE;
  const password = opts.password ?? DEFAULT_PASSWORD;

  const labels = { app: "neo4j", canvas: name };

  const statefulSet = {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: { name, namespace, labels },
    spec: {
      serviceName: name,
      replicas: 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          // ⚠ 필수: k8s Service 가 주입하는 NEO4J_<SVC>_PORT 같은 env 를 Neo4j 가 config 로
          // 오인해 strict validation 으로 크래시한다(라이브 e2e 에서 확인). 링크 주입을 끈다.
          enableServiceLinks: false,
          containers: [
            {
              name: "neo4j",
              image: "neo4j:5-community",
              ports: [
                { name: "bolt", containerPort: 7687 },
                { name: "http", containerPort: 7474 },
              ],
              env: [{ name: "NEO4J_AUTH", value: `neo4j/${password}` }],
              resources: { limits: { memory } },
              volumeMounts: [{ name: "data", mountPath: "/data" }],
              readinessProbe: {
                tcpSocket: { port: 7687 },
                initialDelaySeconds: 10,
                periodSeconds: 5,
                failureThreshold: 30,
              },
            },
          ],
        },
      },
      volumeClaimTemplates: [
        {
          metadata: { name: "data", labels },
          spec: {
            accessModes: ["ReadWriteOnce"],
            resources: { requests: { storage } },
          },
        },
      ],
    },
  };

  const service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, namespace, labels },
    spec: {
      type: "ClusterIP",
      selector: labels,
      ports: [
        { name: "bolt", port: 7687, targetPort: 7687 },
        { name: "http", port: 7474, targetPort: 7474 },
      ],
    },
  };

  // volumeClaimTemplate 안에 기술되므로 별도 PVC 오브젝트는 그 템플릿을 그대로 노출(참조용).
  const pvc = statefulSet.spec.volumeClaimTemplates[0];

  return { statefulSet, service, pvc };
}
