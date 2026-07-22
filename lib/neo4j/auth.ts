// lib/neo4j/auth.ts — 개발 기본 Neo4j 비밀번호 단일 소스. driver.ts(접속)와
// provision/neo4j-manifest.ts(pod 생성)가 반드시 이 값을 같이 참조해야 인증이 맞는다.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md

// ponytail: dev-only fallback password, real deploys must set NEO4J_PASSWORD / opts.password.
export const DEV_NEO4J_PASSWORD = "sl-onto-dev-neo4j";
