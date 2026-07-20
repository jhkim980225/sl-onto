# 문서 전면 재구성 — 제품 정체성 전환 (FMEA → RAG·Vector·Graph 검색/질의응답)

- 작성일: 2026-07-21
- 범위: `docs/**/*.md` + `CLAUDE.md`. **코드 변경 없음.**
- 관련: [multi-canvas](2026-07-20-multi-canvas-design.md) · [canvas-document-crud](2026-07-20-canvas-document-crud-design.md) · [document-chunking](2026-07-20-document-chunking-design.md)

## 1. 왜

코드와 문서가 갈라졌다. 코드는 다중 캔버스·스키마 편집·문서 CRUD·pgvector 임베딩을 거치며
**도메인 무관 검색/질의응답 플랫폼**이 됐는데, 문서는 전부 "FMEA 지식 온톨로지 워크벤치"로 쓰여 있다.
게다가 FMEA 과제 자체가 더 이상 목표가 아니다.

증상:
- 배포 버전이 문서마다 다름 — `architecture.md` v2 · `requirements.md` v7 · `CLAUDE.md` v76(21줄)과 v8(84줄) 자기모순
- `requirements.md` 가 이미 구현된 것을 "구현 안 함"으로 기재 — 신경망 임베딩·벡터DB, 객체 편집/쓰기
- 캔버스 개념이 `README`·`requirements`·`architecture` 어디에도 없음 (라우트 26개가 이미 캔버스 스코핑)
- `docs/README.md` features 인덱스 9개 vs 실제 17개
- 코드 약 1,100줄이 features 문서 0 (Ask·reason·뷰3종·스키마검증·2D설계도 등)

## 2. 새 정체성

> **SL OntoGround** — 비정형 사내 문서를 **벡터 RAG + 그래프 온톨로지**로 적재해 **검색·질의응답**하는 워크벤치.
> 캔버스 = 도메인별 완전 격리 워크스페이스. 모든 답변에 **근거 문서 + 확신도**.

골든룰 4개(근거우선·확신도 노출·원본 보존·UI 하드코딩 금지)는 **유지**. RAG 인용에도 그대로 유효하며,
FMEA 특정 표현만 도메인 중립으로 다듬는다.

FMEA 는 1차 MVP 를 검증한 **레거시 도메인**이다. 코드는 손대지 않는다(동작 중이고 삭제는 비가역).
문서에서만 강등한다.

## 3. 목표 문서 구조

```
docs/
  README.md          인덱스 + 정체성
  requirements.md    ★재작성 — 목적·범위·추적표 전면 교체
  architecture.md    ★재작성 — 인제스천 / 검색·질의응답 / 온톨로지 3계층
  data-model.md      ★재작성 — FMEA 9종 고정 → 캔버스별 메타모델 중심
  tech-stack.md      정정 + Vector/RAG 축 보강(e5-base·pgvector·Python 사이드카)
  design.md          유지 (UI, 도메인 무관)
  deployment.md      버전 정정
  dev-summary.md · skills.md · review-notes.md   소폭

  features/          제품 기능 (도메인 무관)
    저장·적재  온톨로지-저장소 · 인제스천 · 증분-인제스천 · 문서-관리
    캔버스     다중-캔버스 · 스키마-편집 · 기능-가용성 · [신규]스키마-검증
    검색·QA    키워드-검색 · 자연어-검색 · [신규]벡터-임베딩 · [신규]질의응답
               [신규]관계-유도 · [신규]원문-RAG(계획됨 표기)
    UI·운영    워크벤치-UI · 그래프-인터랙션 · 품질-스캔 · [신규]뷰-3종
               [신규]원문-보기 · [신규]큐레이션

  features/legacy-fmea/   동작하지만 신규 투자 없음 — 상단 배너 필수
    그래프-추론 · FMEA-초안생성 · BOM-정합성 · 모순-검사 · 결로-시나리오
    [신규]2D-설계도 · [신규]검토의견·오케스트레이터

  legacy/            과제 문맥 아카이브
    과제요구-구현현황.md · 시연-시나리오.md
```

### 3.1 core / legacy 판정 근거

코드가 도메인 타입(FMEA 객체타입·`DesignInput`·`InferResponse`)에 의존하면 legacy, 아니면 core.

| 모듈 | 판정 | 근거 |
|---|---|---|
| `lib/ask.ts` + `AskPanel` | core | 선택 객체 Q&A RAG. 타입 무관 |
| `lib/reason.ts` + `ReasonPanel` | core | 사이드카 관계 유도, overlay 전용 |
| `lib/taxonomy.ts` `view-overview` `view-table` `fold` | core | 트리·표 뷰 빌더, 순수 함수 |
| `lib/schema/classify.ts` `validate.ts` | core | 메타모델 대비 위반 보고 |
| `lib/embed.ts` `pyservice.ts` | core | 384dim 임베딩 래퍼 |
| `lib/source-text.ts` + `SourceModal` | core | 원문 열람 |
| `/api/curate` | core | 병합·삭제 실행 |
| `lib/infer.ts` `fmea-draft.ts` `bom-consistency.ts` `contradictions.ts` | legacy | FMEA 객체타입 하드 가정 (`lib/capabilities.ts` 가 이미 409 게이팅) |
| `lib/review-opinion.ts` `orchestrator.ts` | legacy | `DesignInput`·`InferResponse`·`MasterAudit` 의존 |
| `lib/shape-sim.ts` `drawing-input.ts` `drawing-risk.ts` `/api/design-options` | legacy | 램프 도면 형상·설계조건 종속 |
| `lib/scenario/condensation.ts` | legacy | 램프 결로 시나리오 |

## 4. 정정할 사실오류

| 위치 | 현재 | 실제 |
|---|---|---|
| `architecture.md:112` | 배포 v2 | v76 (마스터의 `docker images` + `kubectl get rs` 로 확인) |
| `requirements.md:39,57,75` | v7 | 〃 |
| `CLAUDE.md:84` | v8 | 〃 (21줄은 v76 — 자기모순) |
| `requirements.md:43` | "신경망 임베딩·벡터DB 미채택" | pgvector 384dim + e5 사이드카 채택 |
| `requirements.md:45` | "객체 편집/쓰기 없음" | 스키마 편집·문서 CRUD 구현됨 |
| `requirements.md` 전반 | 캔버스 개념 없음 | 26 라우트 캔버스 스코핑 |
| `docs/README.md:11-20` | features 9개 | 전체 재작성 |
| 여러 문서 | 노드/엣지 170/2156 · 174/2171 · 179/2198 | 실측 1회 후 전 문서 통일 |
| `requirements.md:71` | "26 pass" | 실측 (`npm test`, 테스트 파일 28개) |
| `CLAUDE.md:78` | "발표·보고용" | **1차 MVP** — "발표용" 표현 전면 금지 |
| 전 문서 | RAG 를 완성으로 서술할 위험 | 문서 청킹 RAG = **미구현(계획됨)** 명시. 구현된 RAG 는 `ask.ts` 그래프 컨텍스트 RAG 뿐 |

## 5. 원칙

- **코드 변경 0.** 이 작업은 문서만 만진다. 코드와 어긋나면 문서를 고친다, 반대 아님.
- **미구현을 구현으로 쓰지 않는다.** 계획 단계면 "계획됨"으로 표기하고 spec 을 링크한다.
- **숫자는 실측.** 노드·엣지·테스트 수는 한 번 재서 전 문서에 같은 값을 쓴다.
- **legacy 문서는 지우지 않는다.** 이동 + 상단 배너. `git mv` 로 히스토리 보존.
- **"발표용/보고용/데모용" 금지.** 1차 MVP.

## 6. 선행 조건

작업 트리에 미커밋 문서 변경(한글 파일명 rename 13건 + 신규 features 4건 + 본문 수정)이 있다.
**재구성 시작 전에 먼저 커밋**한다 — rename 위에 rename 을 얹으면 git 히스토리 추적이 깨진다.

## 7. 완료 기준

- [ ] `docs/` 어디에도 배포 버전이 두 개 이상 등장하지 않는다
- [ ] `docs/` 와 `CLAUDE.md` 에 "발표용/보고용/데모용" 0건 (`grep`)
- [ ] `docs/README.md` 인덱스의 모든 링크가 실재하는 파일을 가리킨다 (깨진 링크 0)
- [ ] `features/` 의 모든 문서가 실재하는 코드 모듈을 가리키고, core/legacy 분류가 §3.1 과 일치
- [ ] core 기능 중 features 문서가 없는 것 0건
- [ ] `requirements.md` 에 "구현 안 함"으로 적힌 항목 중 실제 구현된 것 0건
- [ ] legacy 문서 전부 상단 배너 보유
- [ ] `git log --follow` 로 이동된 문서의 히스토리가 추적된다
