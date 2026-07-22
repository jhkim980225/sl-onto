# v2 개발 자율 진행 리포트

> 자율 루프 · 의사결정=에이전트 · 사용자=md 보고. 브랜치 `feat/v2-neo4j`.
> 최종 갱신: 코드리뷰 5건 수정 완료. 라이브 통합 준비됨.

## 지금까지 (완료)
| 단계 | 결과 |
|---|---|
| 방향 확정(자율) | 캔버스당 Neo4j Community pod · 소스=씨앗/그래프=진실 · GraphRAG · 정적 온톨로지 UI |
| 토대 5모듈(병렬) | Cypher빌더·드라이버/repo·프로비저닝·추출변환·GraphRAG·UI |
| 배선 5모듈(병렬) | 캔버스·그래프·엔티티·ask·인제스천 라우트 + `/v2` 워크벤치 페이지 |
| 검증 | 39 단위테스트 · tsc 0 · build 성공(5 v2 라우트 + `/v2` 페이지) |
| **전체 코드리뷰** | 교차버그 5건 발견(병렬 빌드가 못 잡는 것) |

## 코드리뷰 결과 (opus 리뷰어)
| # | 심각도 | 버그 | 수정 |
|---|---|---|---|
| C1 | **Critical** | pod 비번 ≠ 드라이버 비번 → **모든 라이브 연결 auth 실패** | 비번 단일 소스(`lib/neo4j/auth.ts`) |
| I1 | Important | 벡터검색 `k`가 Float → `/ask` 매번 throw | `neo4j.int(k)` |
| I2 | Important | `apply.ts` 409 replace 깨짐(불변필드) → 재프로비저닝 500 | 409=멱등 성공 처리 |
| M1 | Minor | readinessProbe 없어 `waitForNeo4j`가 bolt 준비 전 반환 → ensureSchema 레이스 | TCP 7687 readinessProbe |
| M2 | Minor | 768 아닌 임베딩이 "Neo4j 연결 실패"로 오표기 | 차원 가드(드롭+warn) |

**리뷰가 확인한 정상:** 라우트↔페이지↔repo↔파이프라인 계약 일치 · pyservice 봉투 · 파라미터 바인딩 Cypher · 레코드 매핑·관계 방향 · 매니페스트 라벨/셀렉터.

→ **5건 전부 수정 완료** (커밋 d962d3e). 재검증: 39/39 tests · tsc 0 · build 성공.

## 다음 (자율 예정)
1. 수정 검증 → 이 리포트 갱신
2. **라이브 통합** — `sl-ontoground-v2` 네임스페이스 + RBAC + 실 Neo4j pod 프로비저닝 e2e (드라이버·벡터인덱스·readiness 실측)
3. 이메일 파서 추가

## 상세
- 설계: `docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md`
- 구조: `docs/v2-README.md`
- 리뷰 전문: `.superpowers/sdd/v2-review.md`

---

## 라이브 통합 e2e (실 Neo4j Community pod, FEDA)
`sl-ontoground-v2` 네임스페이스에 실 Neo4j 5 Community 띄워 데이터모델 검증.

**검증 성공 ✅ (실 Neo4j 5):**
- 스키마 DDL 적용 — `entity_id`(UNIQUE)·`entity_embedding`(**VECTOR**)·`entity_type` 인덱스 생성 확인
- 엔티티 3개 + 768차원 임베딩 저장
- **벡터 검색** `db.index.vector.queryNodes('entity_embedding', k, q)` 정상 동작(top-k+score)
- 관계 생성 + 이웃 탐색(`홍길동 -WORKS_AT-> 아크메`)

**e2e가 잡은 실버그 2건:**
| 버그 | 원인 | 처리 |
|---|---|---|
| **매니페스트 CrashLoop** | k8s Service 주입 env(`NEO4J_<SVC>_PORT`)를 Neo4j가 config로 오인 → strict validation 크래시 | `enableServiceLinks:false` 추가 (커밋 d242305, 회귀테스트) |
| PVC Pending | longhorn 기본 SC 바인딩 안 됨 | e2e는 emptyDir로 우회. 실사용 시 스토리지 SC 별도 확인 필요 |

→ **데이터모델·벡터인덱스·프로비저닝 핵심 = 실 Neo4j에서 검증됨.** 테스트 리소스 정리 완료.

## 남은 것 (실사용 전)
1. **PVC 스토리지** — longhorn 바인딩 이슈 해결 or nfs-client SC 사용(매니페스트 storageClassName 지정)
2. Neo4j 비번 **Secret**화(현재 매니페스트 평문)
3. 앱 배포 + in-cluster RBAC(ServiceAccount가 StatefulSet/Service 생성 권한)
4. 이메일 파서
