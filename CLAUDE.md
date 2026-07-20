# CLAUDE.md — SL OntoGround

Claude Code가 이 레포에서 작업할 때 따르는 지침. 상세 문서는 `docs/` 참조.

## 이게 뭔가
FMEA 지식 **온톨로지 워크벤치**. 흩어진 FMEA 문서를 객체·관계 온톨로지로 적재하고,
신규 설계 조건으로 유사 사례를 그래프 탐색해 **근거·확신도가 붙은 설계 검토 체크리스트**를 생성한다.
팔란티어 온톨로지 스타일. SL(에스엘㈜) 자동차 램프 부품 대상. **스택 = Next.js.**

## 골든 룰 (도메인 — 어기지 말 것)
1. **근거 우선(provenance):** 모든 객체·추론 결과는 원본 문서(`doc`)에 연결된다. 근거 없는 결론 금지.
2. **확신도 항상 노출:** 추론 산출물은 "검토용 초안". confidence %를 반드시 함께 보여준다. 최종 판단은 엔지니어.
3. **원본 보존:** 원본 코드값을 덮어쓰지 않는다. `original_code` + `mapped_code` + `confidence`를 함께 저장.
4. **UI에 데이터 하드코딩 금지:** 온톨로지·추론 결과는 전부 `/api/*`에서 온다. (데모의 하드코딩 배열은 시드/저장소로 이관)

## 스택 (요약, 상세는 `docs/tech-stack.md`)
Next.js(App Router, TS) · Route Handlers API · **Postgres 영속 온톨로지**(DB=원본, 인메모리=읽기 캐시,
pgvector 384-dim + Python 임베딩 사이드카 pyservice) · 규칙기반 그래프 추론 ·
자연어 검색(규칙기반 + 임베딩 후보확장, LLM 옵트인) · 인제스천(xlsx/pptx/docx/dxf) ·
**라이트 SL 브랜드 테마**(흰 배경·네이비 텍스트·시안 액센트 `#00a2e5`).
- **배포됨(v76, 2026-07-20):** FEDA K8s ns `sl-ontoground`, NodePort **30494** → `http://192.168.0.100:30494/` (상세 `docs/deployment.md`).
  다음 버전 번호는 마스터의 `docker images` + `kubectl get rs`로 확인(로컬 스크립트 파일명 믿지 말 것).

## 레포 구조
```
app/            Next.js App Router (페이지 + api/ Route Handlers)
  api/          /ontology /ontology/export /object/[id] /search /nlsearch /infer /fmea-draft
                /sources · /sources/[file](DELETE·PUT=문서 삭제·교체) /ingest /condensation
                /drawing-input /bom-check /contradictions /curate /quality
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
data/sources/       데모 원천 파일 (약 34개, 런타임 인제스천 대상)
data/real-samples/  실무형 지저분한 문서(견고 파싱 검증 전용, 데모 미포함)
docs/           설계 문서
```
저장소는 **Postgres**(DB=원본 · 최초 부팅 시 DB 비면 `ingestAll()` 적재 ≈174 노드/2171 엣지 ·
`DATABASE_URL` 없으면 인메모리 폴백). 임베딩 백필은 부팅·병합 후 자동(재트리거 `POST /api/admin/embed-backfill`).

**캔버스 = 도메인(부서/제품군)별 완전 격리 워크스페이스.** 데이터도 스키마도 0에서 시작하고,
기존 램프 데이터는 `default` 캔버스(179 노드/2,198 엣지/40 문서)에 귀속된다. 데이터 라우트 26개는
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
- 각 MVP 구성요소는 확장 대상으로 "갈아끼우기" 가능하게(시드→Docling, SQLite→Postgres, 키워드→임베딩).

## 작업 방식
- 서브에이전트 위임 규칙: `AGENTS.md`
- 사용할 Claude 스킬: `docs/skills.md`
- 큰 작업 착수 전: brainstorming → writing-plans 순서(이미 요구사항 확정: `docs/requirements.md`)

## 문서 맵
| 문서 | 내용 |
|---|---|
| `docs/requirements.md` | 배경·요구사항·MVP 범위·추적표·완료기준 |
| `docs/과제요구-구현현황.md` | 과제 원문 요구 항목별 됨/부분/안 됨 구분(발표·보고용) |
| `docs/시연-시나리오.md` | 검색(대화) 시연 대본 — 질문·실제 답변·모순 서사·근거 증명 동선 |
| `docs/tech-stack.md` | 스택 결정기록·버전·대안 |
| `docs/architecture.md` | 시스템 구조·데이터흐름·API·배포 |
| `docs/data-model.md` | 온톨로지 스키마·저장 schema·JSON 형태 |
| `docs/design.md` | UI 디자인 시스템(라이트 SL 브랜드 · 그래프 존/방사형 레이아웃) |
| `docs/deployment.md` | Docker standalone → FEDA K8s 배포(v8 · 레지스트리 :5000 · NodePort 30494) |
| `docs/skills.md` | 빌드용 스킬 |
| `docs/features/*` | 기능별 상세(인제스천·저장소·검색·nlsearch·추론·graph-interaction·결로시나리오·UI) |
