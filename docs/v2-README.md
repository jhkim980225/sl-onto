# v2 — Neo4j 그래프 DB 워크벤치 (1차 개발 현황)

> 브랜치 `feat/v2-neo4j`. v1(Postgres+인메모리 그래프)에서 방향 전환. 자율 개발(사용자 지시: 물어보지 말고 병렬로).
> 설계: `docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md`.

## 방향 (확정)
- **저장:** 캔버스당 Neo4j **Community pod** +1 (라이선스 없어 multi-db 불가 → 물리 격리).
- **근거:** 소스(이메일·비정형)는 **씨앗**, 추출 후 **그래프가 진실**. provenance·인용 없음.
- **검색:** **벡터 + 그래프 탐색 하이브리드**(GraphRAG). 엔티티에 임베딩(e5-base 768).
- **편집:** 노드·관계 **DB 직접** 편집·삭제.
- **UI:** 정적 온톨로지 그래프(react-flow) — v1 물리 시뮬 폐기.

## 데이터 모델
```
(:Entity {id, name, type, embedding:vector(768), props...})
(:Entity)-[:REL {type, weight, props...}]->(:Entity)
```
제약 `entity_id UNIQUE` · 벡터 인덱스 `entity_embedding`(cosine) · 타입 인덱스.

## 구조 (구축됨)
| 계층 | 파일 | 상태 |
|---|---|---|
| 타입·계약 | `lib/neo4j/types.ts` (Entity·Relation·GraphRepo) | ✅ |
| 스키마 DDL | `lib/neo4j/schema.ts` | ✅ 2 tests |
| Cypher 빌더(순수) | `lib/neo4j/cypher.ts` | ✅ 12 tests |
| 드라이버·repo | `lib/neo4j/driver.ts` · `repo.ts` | ✅ tsc(라이브 미검증) |
| 캔버스→repo 리졸버 | `lib/neo4j/canvas-repo.ts` | ✅ |
| 프로비저닝 매니페스트 | `lib/provision/naming.ts` · `neo4j-manifest.ts` | ✅ 13 tests |
| 프로비저닝 적용(k8s) | `lib/provision/apply.ts` · `lib/canvas-v2.ts` | ✅ tsc(라이브 미검증) |
| 추출→그래프 변환 | `lib/ingest-v2/extract-to-graph.ts` | ✅ 7 tests |
| 인제스천 파이프라인 | `lib/ingest-v2/pipeline.ts` | ✅ |
| GraphRAG 검색 | `lib/graph-ask.ts` · `lib/llm-graph.ts` | ✅ 5 tests |
| 온톨로지 UI | `components/OntologyGraph.tsx` | ✅ |

## API (`/api/v2/*`)
| 라우트 | 메서드 | 역할 |
|---|---|---|
| `/api/v2/canvases` | POST/DELETE | 캔버스=Neo4j pod 프로비저닝·해체 |
| `/api/v2/ingest` | POST(multipart) | 파일→LLM추출→그래프 적재 |
| `/api/v2/graph` | GET | 전체/포커스 서브그래프 |
| `/api/v2/entity` | POST/DELETE | 엔티티 직접 편집·삭제 |
| `/api/v2/ask` | POST | GraphRAG 질문·답변 |

## 검증
- 단위 테스트 **39 pass** (라이브 Neo4j·k8s 불필요분) · `tsc` 0 · `npm run build` 성공(5 v2 라우트 ƒ).

## 재사용 (v1→v2)
✅ pyservice(임베딩·LLM추출) · `lib/embed.ts` · `lib/source-text.ts` 파서 · RAGAS 평가
❌ Graph.tsx 물리 시뮬 · Postgres/pgvector · store.ts/db.ts · 문서 RAG(doc-ask)

## 다음 (1차 이후)
1. **라이브 통합 검증** — 실 Neo4j Community pod + k8s 프로비저닝 e2e(드라이버·벡터인덱스·create-or-replace·readiness·RBAC).
2. **네임스페이스 `sl-ontoground-v2` 사전 생성** + Neo4j 비번 Secret화(현재 dev 평문).
3. **이메일 파서** 추가(현재 xlsx/pptx/docx 재사용).
4. `resourceName` 대소문자 충돌 → 해시접미 보강.
5. 코드 리뷰(브랜치 전체) 후 정리.

## 알려진 1차 한계
- 라이브(Neo4j·k8s) 통합 미검증 — 순수 로직만 테스트.
- `buildNeighbors` depth>1 은 중간 홉 노드 누락(depth=1 정상).
- GraphRAG는 top-3 hit 이웃만 컨텍스트化, citedEntityIds 매핑 미구현(답변 `[E n]` 표기만).
- 503 판정이 에러 메시지 문자열 매칭(타입드 에러 클래스 없음).
