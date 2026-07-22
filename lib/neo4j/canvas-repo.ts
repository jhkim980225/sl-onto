// lib/neo4j/canvas-repo.ts — 캔버스 id → 그 캔버스의 Neo4j pod GraphRepo.
// 라우트·인제스천·검색이 캔버스별 저장소를 얻는 단일 진입점.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md
import { boltUri } from "../provision/naming";
import { Neo4jGraphRepo } from "./repo";
import type { GraphRepo } from "./types";

// 캔버스별 repo 캐시 — 커넥션(드라이버) 재사용은 driver.ts 가 boltUri 로 메모이즈하므로
// 여기선 repo 인스턴스만 가볍게 캐시한다.
const repos = new Map<string, GraphRepo>();

/** 캔버스 id → GraphRepo. 캔버스=Neo4j pod 이라 boltUri 로 라우팅. */
export function repoFor(canvasId: string): GraphRepo {
  const uri = boltUri(canvasId);
  let r = repos.get(uri);
  if (!r) {
    r = new Neo4jGraphRepo(uri);
    repos.set(uri, r);
  }
  return r;
}
