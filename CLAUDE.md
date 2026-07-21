# CLAUDE.md — SL OntoGround

Claude Code가 이 레포에서 작업할 때 따르는 지침. 상세 문서는 `docs/` 참조.

## 이게 뭔가
비정형 사내 문서를 **벡터 RAG + 그래프 온톨로지**로 적재해 **검색·질의응답**하는 워크벤치.
캔버스(부서·제품군별 완전 격리 워크스페이스)에 문서를 부으면 객체·관계로 구조화되고,
검색·질의응답 결과에 **근거 문서와 확신도**가 붙는다. 팔란티어 온톨로지 스타일. **스택 = Next.js.**

FMEA(SL 자동차 램프)는 1차 MVP 를 검증한 **레거시 도메인**이다 — 코드는 동작하지만 신규 투자 대상이
아니고 `default` 캔버스 전용이다. 상세 `docs/features/legacy-fmea/`.

## 골든 룰 (어기지 말 것)
1. **근거 우선(provenance):** 모든 객체·추론·답변은 원본 문서(`doc`)에 연결된다. 근거 없는 결론 금지.
2. **확신도 항상 노출:** 자동 생성물은 "검토용 초안". confidence %를 반드시 함께 보여준다. 최종 판단은 사람.
3. **원본 보존:** 원본 값을 덮어쓰지 않는다. `original_code` + `mapped_code` + `confidence` 를 함께 저장.
   유도된 관계는 store 에 병합하지 않고 overlay 로 둔다.
4. **UI에 데이터 하드코딩 금지:** 온톨로지·검색·답변은 전부 `/api/*`에서 온다.

## 스택 (요약, 상세는 `docs/tech-stack.md`)
Next.js(App Router, TS) · Route Handlers API · **Postgres 영속 온톨로지**(DB=원본, 인메모리=읽기 캐시,
pgvector 384-dim + Python 임베딩 사이드카 pyservice) · 그래프 RAG(`/api/ask`, 선택 객체 컨텍스트 질의응답) ·
자연어 검색(규칙기반 + 임베딩 후보확장, LLM 옵트인) · 인제스천(xlsx/pptx/docx/dxf) ·
규칙기반 그래프 추론(`/api/infer`, **레거시·FMEA 전용**) ·
**라이트 SL 브랜드 테마**(흰 배경·네이비 텍스트·시안 액센트 `#00a2e5`).
- **배포됨(v79):** FEDA K8s ns `sl-ontoground`, NodePort **30494** → `http://192.168.0.100:30494/` (상세 `docs/deployment.md`).
  다음 버전 번호는 마스터의 `docker images` + `kubectl get rs`로 확인(로컬 스크립트 파일명 믿지 말 것).

## 레포 구조
```
app/            Next.js App Router (페이지 + api/ Route Handlers)
  api/          /ontology /ontology/export /object/[id] /search /nlsearch /ask /reason /source-text
                /infer /fmea-draft /design-options /review-opinion /drawing-input /drawing-svg
                /sources · /sources/[file](DELETE·PUT=문서 삭제·교체) /ingest /condensation
                /bom-check /contradictions /curate /quality
                /schema · /schema/object-types · /schema/relation-types
                /canvases · /canvases/[id] · /canvases/[id]/restore   /admin/embed-backfill
components/     클라이언트 컴포넌트 (Graph·Inspector·Checklist·SourcePanel·NLSearchPanel·
                LeftRail + Canvas·Document·Schema Panel·Condensation{Panel,Drawing}·typeStyles 등)
lib/            도메인 로직 (store, search, nlsearch, infer, seed, types) — 프레임워크 비의존
                canvas-context.ts(AsyncLocalStorage 현재 캔버스) · canvas-route.ts(withCanvasRoute) ·
                canvases.ts(캔버스 CRUD) · documents.ts(문서 삭제) · capabilities.ts(기능 가용성) ·
                api-client.ts(클라이언트 fetch 에 ?canvas= 부착)
  db/migrations/ 001-canvas.sql (단일 온톨로지 → 다중 캔버스, 단방향)
  ingest/       원천 파일 파서 + 정규화 (xlsx/pptx/docx → 온톨로지, auto-create·견고 파싱)
  scenario/     condensation.ts (결로 지역별 시나리오 = 온톨로지 + 지역 축 + 설계도 스펙)
scripts/        gen-sources.ts(데모 원천 생성) · gen-real-samples.ts(지저분한 실무 샘플) ·
                check-before.ts / check-real-samples.ts (견고 파싱 BEFORE/AFTER 측정)
data/sources/       데모 원천 파일 (40개, 런타임 인제스천 대상)
data/real-samples/  실무형 지저분한 문서(견고 파싱 검증 전용, 데모 미포함)
docs/           설계 문서
```
저장소는 **Postgres**(DB=원본 · 최초 부팅 시 DB 비면 `ingestAll()` 적재 180 노드/2,199 엣지 ·
`DATABASE_URL` 없으면 인메모리 폴백). 임베딩 백필은 부팅·병합 후 자동(재트리거 `POST /api/admin/embed-backfill`).

**캔버스 = 도메인(부서/제품군)별 완전 격리 워크스페이스.** 데이터도 스키마도 0에서 시작하고,
기존 램프 데이터는 `default` 캔버스(180 노드/2,199 엣지/41 문서)에 귀속된다. 데이터 라우트 26개는
`withCanvasRoute` 로 감싸 `?canvas=<id>` 를 받고(누락 400·미존재 404), store 캐시는 캔버스별이다.
FMEA 타입이 없는 캔버스에서는 추론·초안·모순·BOM 이 409(`lib/capabilities.ts`).
설계: `docs/superpowers/specs/2026-07-20-multi-canvas-design.md` ·
`docs/superpowers/specs/2026-07-20-canvas-document-crud-design.md`.

## 개발 명령어 (스캐폴딩 후)
- `npm run dev` — 개발 서버
- `npm run build` / `npm start` — 프로덕션
- `npm run lint` — 린트
- Docker: `output: 'standalone'` 빌드 → 단일 이미지, `$PORT` 주입 대응

## 컨벤션
- TypeScript strict. 도메인 로직은 `lib/`에 두고 프레임워크(Next) 비의존으로 유지 → 테스트·재사용 용이.
- API 응답 형태는 `docs/data-model.md`의 JSON 스키마를 따른다.
- 기존 데모의 SVG 포스 그래프는 **재작성하지 말고** 클라이언트 컴포넌트로 이식, `fetch`만 연결.
- 각 MVP 구성요소는 확장 대상으로 "갈아끼우기" 가능하게(시드→Docling, 인메모리→Postgres, 키워드→벡터 — 뒤 둘은 완료. 다음 갈아끼우기: 문서 원문 청킹 RAG).

## 작업 방식
- 서브에이전트 위임 규칙: `AGENTS.md`
- 사용할 Claude 스킬: `docs/skills.md`
- 큰 작업 착수 전: brainstorming → writing-plans 순서(이미 요구사항 확정: `docs/requirements.md`)

## 문서 맵
| 문서 | 내용 |
|---|---|
| `docs/requirements.md` | 문제·범위(구현됨/계획됨/구현안함/레거시)·완료기준 |
| `docs/tech-stack.md` | 스택 결정기록·검색/RAG 계층·버전 |
| `docs/architecture.md` | 시스템 구조·데이터흐름·API·캔버스 스코핑·배포 |
| `docs/data-model.md` | 메타모델·캔버스 스키마·JSON 형태 |
| `docs/design.md` | UI 디자인 시스템(라이트 SL 브랜드 · 그래프 존/방사형 레이아웃) |
| `docs/deployment.md` | Docker standalone → FEDA K8s(v79 · 레지스트리 :5000 · NodePort 30494) |
| `docs/features/*` | 기능별 상세 |
| `docs/features/legacy-fmea/*` | FMEA 전용 레거시 기능 |
| `docs/legacy/과제요구-구현현황.md` | (아카이브) FMEA 과제 대응 기록 — 1차 MVP |
| `docs/legacy/dev-summary.md` | (아카이브) 개발 완료 내역 스냅샷 — 1차 MVP, FMEA 중심 서술 |
