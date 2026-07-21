# tech-stack.md — 기술 스택 & 결정 기록

## 1. 결정 기록 (ADR)

### ADR-1. 앱 프레임워크 = Next.js (Python 아님)
- **결정:** Next.js(App Router, TypeScript) 단일 레포로 프론트+API를 통합.
- **맥락:** 3시간 MVP, 회사 클라우드 배포, 프론트·백·배포를 한 번에.
- **왜 Python이 아닌가:** 실 과제의 무거운 ML(Docling·SLM/VLM·로컬 임베딩)은 MVP에 **없다**.
  그리고 그것들은 프로덕션에서도 **별도 Python 마이크로서비스로 떼어 API 호출**하는 게 정석이라
  앱 프레임워크를 Python으로 강제하지 않는다. → 앱=Next.js, 무거운 ML만 Python 사이드카(폴리글랏).
- **결과:** 한 레포 한 배포. 임베딩·LLM·관계유도는 실제로 이렇게 붙었다(Python 사이드카 `/embed` `/llm` `/reason`).
  Docling 만 아직 미채택.

### ADR-2. 프론트 = 기존 vanilla SVG 데모 이식 (재작성 안 함)
- **결정:** 데모의 손수 짠 SVG 포스 그래프를 클라이언트 컴포넌트로 이식, `fetch`만 연결.
- **왜:** 이미 완성·미려하게 동작. React로 재작성하면 3시간을 "똑같이 보이는 것 다시 만들기"에 소모.
- **확장:** 노드 수천 개 되면 Cytoscape.js/react-force-graph로 이관. 프론트는 API만 바라봐서 백엔드 무영향.

### ADR-3. 저장소 = 인메모리 (1차 MVP 초기, 기동 시 인제스천으로 구축)
- **결정(1차 MVP 초기):** `lib/store.ts` 가 모듈 로드 시 `ingestAll()`(data/sources 파싱) 결과로 인덱스를 만든다.
  파싱 실패/공백 시 `lib/seed.ts` 폴백. (SQLite/better-sqlite3 는 도입하지 않음 — 규모가 작아 불필요.)
- **왜:** 무설치·무상태·컨테이너 기동 시 재구축 → 볼륨/DB 없이 어떤 클라우드든 동일 동작.
- **이후:** Postgres 로 이전 완료 — DB=원본, 인메모리=캐시(`DATABASE_URL` 없으면 지금도 인메모리 폴백), pgvector 임베딩 포함.
  상세는 [architecture.md](architecture.md).

### ADR-4. 검색 = 키워드 + 그래프 스코어링 (1차 MVP 초기, 임베딩 아님)
- **결정(1차 MVP 초기):** 신경망 임베딩 없이 텍스트 매칭 + 그래프 근접도로 스코어링.
- **왜:** 짧은 개발 기간 안에 임베딩 모델/벡터DB까지 얹는 건 범위 밖이라 미뤘다.
- **이후:** pgvector 384-dim + Python 임베딩 사이드카를 실제로 얹었다. 상세는 아래 "검색 · RAG 스택" 절.

### ADR-5. 자연어 검색 = 규칙기반 엔티티 링크 (LLM 아님, 기본값)
- **결정:** 자연어 질문은 `lib/nlsearch.ts` 의 **규칙기반**(지역→법규 매핑·유형 의도·동의어·그래프 확장)이 기본 경로.
- **맥락(측정):** 사내 자원을 실제로 시험했다. 아래 임베딩 실험은 "의도 파악 자체를 임베딩으로 대체"하는
  용도였다 — 지금 pgvector 후보확장(아래 "이후")과는 다른 용도다.
  - 사내 vLLM `qwen3-32b-finance`: 품질은 되나 **쿼리당 ~60–70s**(서버 과부하) → 실사용 불가.
  - ollama `nomic-embed-text` 임베딩으로 의도 파악 대체 실험: 한국어 개념을 **변별 못함**(유사도 붕괴).
  - 규칙기반: **<1s**, 한국어 정확, 결정론적. 좁고 통제된 온톨로지에선 링크가 임베딩보다 정확.
- **결과:** 규칙기반이 기본이고 지금도 그렇다. **LLM 경로는 코드에 있으나 OFF**(`NL_USE_LLM=1` 로 옵트인, 실패 시 규칙기반 폴백).
  env: `LLM_BASE_URL`·`LLM_MODEL`·`LLM_TIMEOUT_MS`. 서버가 빨라지면 켠다. → [features/자연어-검색.md](features/자연어-검색.md).
- **이후:** pgvector 후보확장을 규칙기반 위에 **보조로** 얹었다(`embedOne`→`semanticSearch`, 실패 시 조용히
  규칙기반만). 의도 파악 자체를 대체하지 않으므로 위 실험 결과와 배치되지 않는다.

### ADR-6. 인제스천 = 실제 파일 파싱 + 견고 휴리스틱 (Docling 은 확장)
- **결정:** SheetJS/jszip 로 실제 xlsx/pptx/docx 를 파싱. 통제 어휘 매핑 + **미지 엔티티 auto-create**(id `AUTO_*`, conf 0.66) +
  실무 문서용 **견고 파싱**(헤더 자동탐지·컬럼 동의어·병합셀 채움·자유텍스트 링크).
- **왜:** "시드 대체"를 넘어 실제 비정형에서 추출하는 것을 보였다. real-samples BEFORE 0/0 → AFTER 42객체/36관계.
- **한계:** 스캔/이미지 PDF·표 사진·복잡 중첩표는 여전히 **Docling(Python 사이드카)** 필요. → [features/인제스천.md](features/인제스천.md).

## 검색 · RAG 스택

| 계층 | 채택 | 상태 |
|---|---|---|
| 키워드 | 필드 매칭 + 그래프 1-hop 확장 + 랭킹 (`lib/search.ts`) | 구현 |
| 자연어 해석 | 규칙기반 엔티티 링크·의도 파악 (`lib/nlsearch.ts`). 사내 LLM(qwen3)은 `NL_USE_LLM=1` 옵트인 — 응답 수십 초라 기본 비활성 | 구현 |
| 벡터 | pgvector **384-dim**, Python 사이드카 `/embed`. 노드 라벨·속성 텍스트 단위. 백필은 부팅·병합 후 자동 | 구현 |
| 그래프 RAG | `lib/ask.ts` — 선택 객체의 속성·관계(≤30)·근거 문서(≤8)만 컨텍스트로. LLM 은 그 밖을 지어내지 못한다 | 구현 |
| 문서 원문 RAG | 문서를 청크로 쪼개 임베딩 → 본문 인용 | **계획됨** — [document-chunking](superpowers/specs/2026-07-20-document-chunking-design.md) |
| 임베딩 모델 | e5-base 로 상향 | **계획됨** — 위 설계에 포함 |

> 왜 384-dim 인가: 현재 임베딩 대상이 짧은 라벨 위주라 128 토큰 한계가 아직 병목이 아니다.
> 문서 청킹이 들어가면 이 근거가 깨지므로 모델 교체가 같은 설계에 묶여 있다.

## 2. 스택 표

| 레이어 | MVP | 확장 |
|---|---|---|
| 앱 | Next.js (App Router, TypeScript) | 동일 |
| API | Route Handlers (`app/api/*`) — 29개 엔드포인트(26개 캔버스 스코프) | 동일 |
| 저장소 | Postgres(DB=원본, 인메모리=캐시, `DATABASE_URL` 없으면 인메모리 폴백) | 동일 |
| 검색 | 키워드 + 그래프 1-hop 확장 + pgvector 후보확장 | 위 "검색 · RAG 스택" 절 참고 |
| 자연어 검색 | 규칙기반 엔티티 링크(`lib/nlsearch.ts`) + pgvector 후보확장. 사내 LLM 은 `NL_USE_LLM=1` 옵트인 | 동일 |
| 인제스천 | 실제 xlsx/pptx/docx 파싱 + auto-create + 견고 휴리스틱 | Python Docling 서비스(API) |
| 추론 | 규칙기반 그래프 탐색(TS, `lib/infer.ts`, 상위 8) | + LLM/SLM RAG |
| 프론트 viz | vanilla SVG → 클라이언트 컴포넌트(포커스·타입 존·방사형) | 필요 시 그래프 라이브러리 |
| 테마 | 라이트 SL 브랜드(시안 `#00a2e5`) | 동일 |
| 배포 | `output:'standalone'` + Docker → **FEDA K8s(v79, 배포됨)** | HPA |
| 인증 | 없음 | OIDC/SSO |

## 3. 의존성 (실제)
- 런타임: `next` 15 · `react`/`react-dom` 19 · `zod`(입력 검증) · `xlsx`(SheetJS) · `jszip` · `fast-xml-parser`(pptx/docx 파싱)
- 개발: `typescript` · `@types/*` · `pptxgenjs`·`docx`(원천/샘플 생성 스크립트용)
- 테스트: `node --test --experimental-strip-types`(무프레임워크) — 36 pass
- 폰트: IBM Plex Sans KR / IBM Plex Mono (디자인 토큰은 [design.md](design.md))

## 4. 배포 구성
- `next.config`에 `output: 'standalone'` → 최소 이미지. `data/sources/**` 를 `outputFileTracingIncludes` 로 포함.
- 컨테이너는 `$PORT`(클라우드 주입) 사용, 없으면 8000. `HOSTNAME=0.0.0.0`.
- 무상태 폴백: `DATABASE_URL` 없으면 인메모리 온톨로지를 기동 시 `data/sources` 인제스천으로 재구축 → 볼륨/DB 불필요.
  실제 배포는 Postgres(+pgvector)를 원본으로 쓴다.
- **실제 배포(v79):** FEDA K8s(Rocky 9.7, v1.30.14, containerd). 레지스트리 **`192.168.0.100:5000`**
  (클러스터 전역 신뢰; `:5001`은 일부 워커만 신뢰 → `ImagePullBackOff` 회피). ns `sl-ontoground`,
  Deployment 2 replica, Service NodePort **30494**. 상세·재배포 절차 → [deployment.md](deployment.md).

## 5. 검토했으나 뺀 것
- **Vercel 전용 배포:** 회사 클라우드 요구와 안 맞음 → Docker로 이식성 확보.
- **Neo4j 등 그래프DB:** MVP 규모엔 과함. 관계는 `links` 테이블로 충분.
- **순수 정적 HTML:** 배포는 쉬우나 "시스템/저장소"가 안 됨 → 확장성 약함.
