# v2 — Neo4j 그래프 DB 토대 설계 (①)

> 2026-07-22 · v2 재구축의 첫 서브프로젝트. Postgres+인메모리 그래프 → **Neo4j Community 캔버스당 pod**.
> 자율 판단으로 확정(사용자 지시: 물어보지 말고 에이전트 자체 판단으로 1차 개발).

## 0. v2 전체 방향 (확정된 결정)
- **저장:** 캔버스당 Neo4j **Community** pod +1 (라이선스 없어 multi-db 불가 → 물리 격리).
- **근거:** 소스(이메일·비정형)는 **씨앗**일 뿐, 추출 후 **그래프가 진실**. provenance 연결·인용 없음.
- **검색:** **벡터 + 그래프 탐색 하이브리드**(GraphRAG). 노드에 임베딩.
- **편집:** 노드·관계를 **DB에서 직접** 편집·삭제(문서 재파싱 아님).
- **UI:** 떠다니는 물리 노드 폐기 → **정적 온톨로지 그래프**(엔티티-관계 연결). 별도 서브프로젝트 ③.
- **재사용:** pyservice(임베딩·LLM 추출) · Next 앱 골격 · RAGAS 평가. **폐기:** Graph.tsx 물리 시뮬 · Postgres/pgvector · store.ts/db.ts · 문서 RAG.

## 1. 이 서브프로젝트(①)의 범위
Neo4j 데이터 계층과 캔버스별 프로비저닝의 **토대**. **라이브 Neo4j·k8s 클러스터 없이 단위 테스트되는 순수 모듈**을 먼저 만든다(1차). 라이브 연결·적용은 ②/③에서 배선.

**포함:**
- 데이터 모델(라벨·속성·인덱스) 정의
- 순수 Cypher 쿼리 빌더(파라미터 바인딩만, 문자열 보간 금지)
- 스키마 DDL(제약·벡터 인덱스) 상수
- 캔버스별 Neo4j 프로비저닝 매니페스트 **생성기**(순수 함수 → StatefulSet+Service+PVC)
- 도메인 타입(Entity/Relation)

**비포함(다음):** 라이브 드라이버 연결·트랜잭션 실행, k8s API 적용, 인제스천 배선, UI, 검색 API.

## 2. 데이터 모델 (Neo4j, 캔버스당 1 DB)
```
(:Entity {
  id: string,          // 캔버스 내 유일(제약)
  name: string,        // 표시 이름
  type: string,        // 엔티티 종류(예: person, org, product, email, topic)
  embedding: list<float>(768),  // name+속성 임베딩(e5-base) — 벡터 인덱스 대상
  props: <flattened>   // 자유 속성은 개별 프로퍼티로 저장(Neo4j는 nested map 미지원)
})
(:Entity)-[:REL { type: string, weight: float, props... }]->(:Entity)
```
- 관계는 단일 라벨 `:REL` + `type` 속성(동적 관계 종류를 스키마 변경 없이 수용). 조회는 `type` 필터.
- **제약:** `CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE`.
- **벡터 인덱스:** `CREATE VECTOR INDEX entity_embedding IF NOT EXISTS FOR (e:Entity) ON e.embedding OPTIONS {indexConfig: {`vector.dimensions`: 768, `vector.similarity_function`: 'cosine'}}`.
- pod-per-canvas 라 `id`·인덱스는 pod 내에서만 유일(캔버스 격리는 pod 경계가 담당).

## 3. 모듈 구조 (신규 `lib/neo4j/`, `lib/provision/`)
| 파일 | 책임 | 순수? |
|---|---|---|
| `lib/neo4j/types.ts` | `Entity`·`Relation`·`GraphView` 타입 | 순수 |
| `lib/neo4j/schema.ts` | DDL 상수(제약·벡터 인덱스), `SCHEMA_STATEMENTS: string[]` | 순수 |
| `lib/neo4j/cypher.ts` | 순수 쿼리 빌더 → `{cypher, params}` (create/upsert entity·rel, delete, vector search, 1-hop 이웃) | 순수 |
| `lib/provision/neo4j-manifest.ts` | 캔버스 id → Neo4j Community StatefulSet+Service+PVC 매니페스트(객체) | 순수 |
| `lib/provision/naming.ts` | 캔버스 id → k8s 리소스 이름·bolt URI(정규화·검증) | 순수 |

**인터페이스(빌더 시그니처):**
- `buildCreateEntity(e: EntityInput): CypherQuery`
- `buildUpsertRelation(r: RelationInput): CypherQuery`
- `buildDeleteEntity(id: string): CypherQuery`
- `buildVectorSearch(embedding: number[], k: number): CypherQuery`
- `buildNeighbors(id: string, depth: 1): CypherQuery`
- `CypherQuery = { cypher: string; params: Record<string, unknown> }`
- `neo4jManifest(canvasId: string, opts?): { statefulSet; service; pvc }`
- `resourceName(canvasId): string` · `boltUri(canvasId): string`

## 4. 골든 룰 (v2)
1. **파라미터 바인딩만** — 모든 값은 `$param`. Cypher 문자열 보간 절대 금지(인젝션 방지).
2. **순수 함수 우선** — 빌더·매니페스트는 IO 없는 순수 함수 → 라이브 Neo4j 없이 테스트.
3. **캔버스 격리 = pod 경계** — 쿼리에 canvas 조건 불필요(pod가 곧 캔버스). 단 리소스 이름은 캔버스 id로 유일.
4. **임베딩 차원 768**(e5-base 재사용).

## 5. 오류 처리
- `resourceName`: 캔버스 id를 k8s 이름 규칙(소문자·`[a-z0-9-]`·63자)으로 정규화, 불가하면 예외.
- 빌더: 빈 id·차원 불일치 임베딩은 예외(호출부 조기 실패).
- 매니페스트: PVC 크기·메모리 기본값 상수, opts로 override.

## 6. 테스트 (라이브 의존 0)
- `cypher.test.ts`: 각 빌더가 파라미터 바인딩만 쓰고(문자열에 값 미보간), 예상 절 포함.
- `schema.test.ts`: DDL에 제약·768 벡터 인덱스 포함, `IF NOT EXISTS` 멱등.
- `neo4j-manifest.test.ts`: 캔버스 id → 유효 이름·bolt URI, StatefulSet에 Neo4j Community 이미지·PVC·auth env.
- 실행: `node --test --experimental-strip-types`(기존 관례).

## 7. 완료 기준(1차)
- `lib/neo4j/{types,schema,cypher}.ts` + `lib/provision/{neo4j-manifest,naming}.ts` 존재, `tsc` 0.
- 빌더·매니페스트 단위 테스트 통과(라이브 Neo4j 불필요).
- 다음 서브프로젝트(②라이브 배선·인제스천, ③UI, ④검색)가 이 인터페이스에 얹힌다.

## 8. 다음(비범위)
- 라이브 드라이버(`neo4j-driver`) + 캔버스별 커넥션 풀 + 트랜잭션 실행
- k8s API 로 매니페스트 적용(in-cluster SA + RBAC) / 로컬 docker 폴백
- 인제스천(이메일·비정형) → LLM 추출 → 그래프 적재
- 정적 온톨로지 UI(react-flow 유력)
- GraphRAG 검색 API
