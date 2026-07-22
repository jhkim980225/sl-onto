// lib/neo4j/driver.ts — 캔버스(pod)별 Neo4j 커넥션 관리. 유일하게 IO 를 갖는 저수준 레이어.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md
import neo4j, { type Driver } from "neo4j-driver";
import type { CypherQuery } from "./types";

// ponytail: dev-only fallback password, real deploys must set NEO4J_PASSWORD.
const DEV_PASSWORD = "sl-onto-dev";

const drivers = new Map<string, Driver>();

/** bolt URI 당 드라이버 1개(메모이즈). 캔버스 = pod = URI. */
export function getDriver(boltUri: string, password?: string): Driver {
  const cached = drivers.get(boltUri);
  if (cached) return cached;

  const pw = password ?? process.env.NEO4J_PASSWORD ?? DEV_PASSWORD;
  const driver = neo4j.driver(boltUri, neo4j.auth.basic("neo4j", pw), {
    disableLosslessIntegers: true,
  });
  drivers.set(boltUri, driver);
  return driver;
}

/** 캐시된 드라이버 전부 종료(테스트 정리·프로세스 종료 훅용). */
export async function closeAll(): Promise<void> {
  await Promise.all([...drivers.values()].map((d) => d.close()));
  drivers.clear();
}

/** 세션 열고 쿼리 실행, 레코드를 평범한 객체로 매핑, 세션 닫기. */
export async function runQuery(
  driver: Driver,
  query: CypherQuery
): Promise<Record<string, unknown>[]> {
  const session = driver.session();
  try {
    const result = await session.run(query.cypher, query.params);
    return result.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
}
