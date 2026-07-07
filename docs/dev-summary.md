# dev-summary.md — 개발 완료 내역 정리

> 작성일: 2026-07-06. 상세는 각 링크 문서 참조. 남은 항목은 [§8](#8-남은-항목) 참조.

## 1. 한 줄 요약

흩어진 FMEA 문서(xlsx/pptx/docx)를 **온톨로지로 적재**하고, 신규 설계 조건을 입력하면 그래프 탐색으로
**근거·확신도가 붙은 설계 검토 체크리스트 + FMEA 초안(xlsx)** 을 생성하는 워크벤치.
**MVP 완료 기준 15개 전부 충족, FEDA K8s 배포 v6 운영 중** (`http://192.168.0.100:30494/`).

## 2. 배포 버전 히스토리

| 버전 | 내용 |
|---|---|
| v1 | 최초 배포 (3단계 워크벤치 + API) |
| v2 | 자연어 검색 · 그래프 인터랙션 · 라이트 SL 브랜드 테마 · 견고 파싱 |
| v3 | FMEA 초안 다운로드 (xlsx) |
| v4 | 백본 우선 초기화면 · 전체 보기 토글 · 라벨 LOD |
| v5 | 인스펙터 뒤로가기 · 이동 경로 |
| **v6 (현재)** | **증분 인제스천 탭** (replicas 2→1 전환: 인메모리 병합 일관성) |

## 3. 구현된 기능

### 3.1 인제스천 — 비정형 문서 → 온톨로지 ([features/ingestion.md](features/ingestion.md))
- 실제 원천 파일 **약 34개**(xlsx FMEA 시트 · pptx 재발방지/8D · docx 품질리포트 · xlsx 참조 마스터)를
  기동 시 파싱해 온톨로지 구축: **≈170 노드 / 2,156 엣지** (실패 시 seed 폴백 ≈275 노드).
- 정규화 + 확신도 티어(정확 id 1.00 / 라벨 0.95 / 동의어 0.82 / 비표준 0.72), 원본값 보존(골든 룰).
- **auto-create**: 통제 어휘 밖 원문도 `AUTO_*` id(확신도 0.66)로 자동 편입, (타입,라벨) dedupe.
- **견고 파싱**: 병합헤더·세로 병합·동의어 컬럼·산문형 실무 문서 대응 —
  real-samples 측정 **BEFORE 0객체/0관계 → AFTER 42객체/36관계**.

### 3.2 온톨로지 저장소 ([features/ontology-store.md](features/ontology-store.md))
- 인메모리 store(`lib/store.ts`), 객체 9종 · 관계 12종 · 속성/근거/확신도 모델.
- 무상태 컨테이너: 기동 시 `data/sources` 인제스천으로 재구축 → 볼륨/DB 불필요.

### 3.3 검색 — 키워드 + 자연어 ([features/search.md](features/search.md) · [features/nlsearch.md](features/nlsearch.md))
- 키워드 검색: 라벨/동의어 매칭 + 그래프 스코어링, 입력 중 드롭다운.
- **자연어 검색**(Enter): 규칙기반 파이프라인(<1s, 한국어) — 지역→법규 매핑 · 유형 의도 · 도메인 동의어 ·
  엔티티 링크 · 1-hop 그래프 확장 · 지역 필터 · 랭킹 + 해석/답변 템플릿.
- LLM 경로는 옵트인(`NL_USE_LLM=1`, 사내 vLLM, 실패 시 규칙 폴백) — 서버 지연(~60s)으로 기본 OFF.

### 3.4 그래프 추론 → 체크리스트 ([features/inference.md](features/inference.md))
- `POST /api/infer`: 신규 설계 조건 → 그래프 탐색 → **계산된** 체크리스트 상위 8
  (제목 · 인과 설명 · 근거칩 · 확신도% · 실존 엣지 trace).
- 조건 반응: 북미→FMVSS 108 승격, 슬림→수축 항목 부스트 등.

### 3.5 FMEA 초안 생성 ([features/fmea-draft.md](features/fmea-draft.md))
- `POST /api/fmea-draft` → **채워진 DFMEA 워크시트(xlsx) 다운로드** (13컬럼: S·O·D·RPN·우선순위·권고조치·근거).
- RPN = S×O×D, 조건 부스트(슬림→수축 O+1 등), 큐레이션 백본만 사용(AUTO 노이즈 제외) → ~13행 초안.

### 3.6 증분 인제스천 ([features/incremental-ingest.md](features/incremental-ingest.md))
- "📥 문서 인제스천" 탭: 파일 드롭(≤10MB) 또는 샘플 시연 → **델타만 파싱·병합**, 그래프 실시간 스폰.
- `mergeDelta` 멱등(재병합 → 빈 델타), 기존 노드 미덮어쓰기(원본 보존), 원천 목록 런타임 갱신.
- 검증(2026-07-05): 새 객체 8·관계 9·기존 연결 3, 카운터 170→179.

### 3.7 결로·습기 지역별 시나리오 ([features/condensation-scenario.md](features/condensation-scenario.md))
- 아우터 렌즈(ILENS)×결로(FMFOG) 축으로 지역(아시아·유럽·북미·중국) 탭 →
  기후·위험도·규제·시험·대책 상세 + **헤드램프 단면 설계도 SVG**(지역별 주석 토글).
- 앵커 전부 실제 온톨로지 노드, 근거는 실파일 `EVIDENCED_BY`.

### 3.8 워크벤치 UI · 그래프 인터랙션 ([features/workbench-ui.md](features/workbench-ui.md) · [features/graph-interaction.md](features/graph-interaction.md))
- 3단계 흐름(흩어진 원천 → 온톨로지 구축 → 신규 설계 추론), 데모 SVG 포스 그래프 이식 + API 배선
  (하드코딩 데이터 0 — 골든 룰).
- 인터랙션: 클릭 포커스/디밍(sticky) · 대분류 타입 존 8개 · **방사형 관련도 링**(핵심 190/주변 320/근거 450).
- 백본 우선 초기화면 + 전체 보기 토글 + 라벨 LOD, 인스펙터 히스토리(뒤로가기).
- 라이트 SL 브랜드 테마(흰 배경 · 네이비 텍스트 · 시안 `#00a2e5`), `prefers-reduced-motion` 존중.

## 4. API (7 + 2)

| 엔드포인트 | 역할 |
|---|---|
| `GET /api/ontology` | 전체 노드·엣지 |
| `GET /api/object/[id]` | 객체 속성·관계·근거 |
| `GET /api/search?q=` | 키워드 검색 |
| `POST /api/nlsearch` | 자연어 검색 |
| `POST /api/infer` | 설계 조건 → 체크리스트 |
| `GET /api/sources` | 원천 파일 목록·추출 미리보기 |
| `GET /api/condensation` | 결로 지역 목록/상세 |
| `POST /api/fmea-draft` | DFMEA xlsx 다운로드 (v3) |
| `POST /api/ingest` | 증분 인제스천 — multipart/샘플 (v6) |

## 5. 품질

- **테스트: 24개 전부 통과** (`node --test`, 2026-07-06 확인) — infer 7 · ingest 7 · robust 파싱 6 · search 4.
- 에이전트 전수 코드 리뷰 완료([review-notes.md](review-notes.md)): HIGH 1건 포함 4건 수정,
  LOW 1건 보류(타이머 cleanup), 골든 룰 준수 확인.
- `next build` standalone 검증(data/sources 트레이싱 + API 동작 확인).

## 6. 배포 ([deployment.md](deployment.md))

- Next.js `output:'standalone'` → Docker 단일 이미지($PORT 대응) → 레지스트리 `192.168.0.100:5000`(클러스터 전역 신뢰)
  → FEDA K8s ns `sl-ontoground`, NodePort **30494**.
- replicas=1(v6~, 인메모리 일관성), 데모 리셋 = `rollout restart`.

## 7. 골든 룰 이행 상태

| 룰 | 이행 |
|---|---|
| 근거 우선 | 모든 체크항목·객체가 원본 doc 연결, 근거 없으면 필터 |
| 확신도 노출 | 체크리스트 %, 매핑 티어(1.00~0.66), UI 상시 표시 |
| 원본 보존 | original→mapped+confidence 저장, 증분 병합도 미덮어쓰기 |
| UI 하드코딩 금지 | 데모의 CORE/CHECKLIST 배열 제거, 전부 `/api/*` |

## 8. 남은 항목

- **보류 1건 (LOW)**: `Graph.tsx`/`Workbench.tsx` 언마운트 시 setTimeout 미정리 ([review-notes.md](review-notes.md) #4).
- **문서 최신화**: `CLAUDE.md`·`requirements.md`의 "배포 v2" 표기 → 실제 v6, "npm test 36 pass" → 현재 24.
- **확장 백로그** (의도적 범위 밖, 이음새 확보됨): Postgres 영속화(`lib/store.ts` 교체 — 증분 업로드 영속 + 멀티 레플리카),
  임베딩 검색(`search()` 내부), LLM 자연어(env 주입만) · LLM RAG 추론, Docling 사이드카(스캔 PDF·중첩표),
  FMEA 초안 서식/DOCX, 실 도면(CAD/PDF) 뷰어, 외부 데이터 연계, 로그인·편집, HPA.
