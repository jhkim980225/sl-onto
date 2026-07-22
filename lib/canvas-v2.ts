// lib/canvas-v2.ts — v2 캔버스 라이프사이클 오케스트레이션(프레임워크 비의존).
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md §0(pod-per-canvas)
//
// 얇게 유지: 프로비저닝(apply.ts) 호출만 담당한다. 스키마 초기화(ensureSchema)는
// lib/neo4j/repo.ts(GraphRepo)의 책임이며 여기서는 그 계층을 import하지 않는다.

import { provisionNeo4j, teardownNeo4j, waitForNeo4j, listCanvases as listProvisioned } from "./provision/apply.ts";

const READY_TIMEOUT_MS = 280_000; // 최초 neo4j 이미지 풀(~75s)+부팅 여유. 이미지 캐시된 노드는 빠름

/** 캔버스용 Neo4j pod 를 프로비저닝하고 준비될 때까지 대기한다. */
export async function createCanvas(canvasId: string): Promise<{ boltUri: string }> {
  const { boltUri } = await provisionNeo4j(canvasId);
  const ready = await waitForNeo4j(canvasId, READY_TIMEOUT_MS);
  if (!ready) {
    throw new Error(`캔버스 "${canvasId}"의 Neo4j pod 가 ${READY_TIMEOUT_MS}ms 내에 준비되지 않았습니다`);
  }
  return { boltUri };
}

/** 캔버스의 Neo4j pod 를 철거한다. */
export async function deleteCanvas(canvasId: string): Promise<void> {
  await teardownNeo4j(canvasId);
}

/** 프로비저닝된 캔버스 id 목록(전환 드롭다운용). */
export async function listCanvases(): Promise<string[]> {
  return listProvisioned();
}
