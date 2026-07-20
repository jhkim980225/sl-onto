# 문서 전면 재구성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문서의 제품 정체성을 "FMEA 지식 워크벤치"에서 "벡터 RAG + 그래프 온톨로지 검색·질의응답 워크벤치"로 바꾸고, 코드와 어긋난 사실을 전부 정정한다.

**Architecture:** 코드는 한 줄도 건드리지 않는다. `docs/**/*.md` + `CLAUDE.md` 만 수정한다. FMEA 자산은 삭제하지 않고 `docs/features/legacy-fmea/` 로 `git mv` + 상단 배너로 강등한다. 과제 문맥 문서는 `docs/legacy/` 로 아카이브한다.

**Tech Stack:** Markdown. 검증은 `grep`/`rg` 와 링크 존재 확인 스크립트.

**Spec:** [2026-07-21-docs-restructure-design.md](../specs/2026-07-21-docs-restructure-design.md)

## Global Constraints

- **코드 변경 0.** `lib/` `app/` `components/` `scripts/` 파일을 수정하면 이 계획 위반이다. 문서가 코드와 다르면 문서를 고친다.
- **"발표용" · "보고용" · "데모용" 표현 금지.** 전부 **"1차 MVP"** 로 쓴다.
- **현재 배포 버전은 `v79` 하나로 통일.** (2026-07-21 사용자 확인. 배포일 미상 — 날짜를 지어내지 말 것)
  단, **"v76 에 무엇이 나갔다"는 이력 서술은 그대로 둔다** — 001-canvas 마이그레이션은 실제로 v76(2026-07-20)에 배포됐다.
  바꾸는 것은 "현재 배포본"을 가리키는 표기뿐이다. (`docs/deployment.md:130`, `dev-summary.md` 릴리스 표의 v76 행 등은 유지)
- **램프 캔버스 규모는 `180 노드 / 2,199 엣지 / 문서 41` 로 통일.** (커밋 079c9e4 실측값)
- **미구현을 구현으로 쓰지 않는다.** 문서 청킹 RAG 는 `docs/superpowers/specs/2026-07-20-document-chunking-design.md` 설계만 존재 → 반드시 "계획됨"으로 표기. 구현된 RAG 는 `lib/ask.ts` 의 그래프 컨텍스트 RAG 뿐.
- **legacy 문서는 지우지 않는다.** `git mv` 로 이동해 `git log --follow` 히스토리를 보존한다.
- **골든룰 4개(근거우선·확신도 노출·원본 보존·UI 하드코딩 금지)는 유지.** FMEA 특정 표현만 도메인 중립으로 바꾼다.
- 각 태스크 끝에 커밋한다. 커밋 메시지는 `docs:` 접두어 + 한국어 본문.

## 파일 구조 (완료 후)

```
CLAUDE.md                  정체성 · 문서맵 · 골든룰
docs/
  README.md                인덱스 + 정체성
  requirements.md          ★재작성
  architecture.md          표적 수정 (§1 §3 §4 §5 §6 §7)
  data-model.md            표적 수정 (§1·§2 프레이밍 · §4 삭제 · §5 갱신)
  tech-stack.md            Vector/RAG 축 보강 + 버전 정정
  design.md                무변경
  deployment.md            버전 정정만
  dev-summary.md · skills.md · review-notes.md   무변경
  features/                core 21개 (기존 12 + 신규 8 + 워크벤치-UI)
  features/legacy-fmea/    7개 (기존 5 + 신규 2)
  legacy/                  과제요구-구현현황.md
```

---

### Task 1: 사실오류 일괄 정정 — 배포 버전 + 금지 표현

가장 기계적이고 다른 태스크와 충돌하지 않는다. 먼저 끝낸다.

**Files:**
- Modify: `docs/architecture.md:112`
- Modify: `docs/requirements.md:39,57,75`
- Modify: `CLAUDE.md:78,84`
- Modify: `docs/과제요구-구현현황.md:185`

**Interfaces:**
- Produces: 전 문서에서 현재 배포 버전 문자열이 `v79` 단일값. 이후 모든 태스크는 이 값을 그대로 쓴다.

- [ ] **Step 1: 현재 위반 건수 측정 (기준선)**

```bash
rg -n 'v2\)|\(v7\)|v7 |v8 ' docs/ CLAUDE.md
rg -n '발표용|보고용|데모용' docs/ CLAUDE.md
```

Expected: 배포 버전 4건(architecture:112, requirements:39/57/75, CLAUDE:84), 금지 표현 3건(과제요구:185, CLAUDE:78, features/인제스천:48)

- [ ] **Step 2: 현재 배포 버전을 v79 로 통일**

`docs/architecture.md:112`:
```markdown
- **배포됨(v79):** FEDA K8s, ns `sl-ontoground`, 레지스트리 `192.168.0.100:5000`, NodePort 30494. → [deployment.md](deployment.md).
```

`docs/requirements.md` 의 `v7` 3곳을 `v79` 로 바꾼다(39·57·75줄).

`CLAUDE.md:84` 문서맵 행:
```markdown
| `docs/deployment.md` | Docker standalone → FEDA K8s 배포(v79 · 레지스트리 :5000 · NodePort 30494) |
```

- [ ] **Step 3: 금지 표현 제거**

`CLAUDE.md:78`:
```markdown
| `docs/legacy/과제요구-구현현황.md` | (레거시) FMEA 과제 원문 요구 항목별 됨/부분/안 됨 — 1차 MVP 기록 |
```
> 경로가 `docs/legacy/` 인 것은 Task 2 에서 실제로 이동하기 때문이다. Task 2 와 순서가 바뀌면 링크가 잠시 깨진다 — Task 1 → Task 2 순서를 지킨다.

`docs/과제요구-구현현황.md:185` 의 `## 발표용 요약 문장` → `## 1차 MVP 요약 문장`

`docs/features/인제스천.md:48` 의 "데모용 `data/sources/`" → "샘플 `data/sources/`"

- [ ] **Step 4: 검증 — 위반 0건**

```bash
rg -n '발표용|보고용|데모용' docs/ CLAUDE.md; echo "exit=$?"
```
Expected: 출력 없음, `exit=1` (rg 는 매치 없으면 1)

```bash
rg -no 'v\d+' docs/architecture.md docs/requirements.md CLAUDE.md docs/deployment.md | grep -o 'v[0-9]*$' | sort -u
```
Expected: `v79` 만 (v76 이 남으면 이력 서술인지 확인. 그 외 값이 나오면 그 줄을 확인 — 무관한 버전 표기일 수 있으니 문맥 확인 후 판단)

- [ ] **Step 5: 커밋**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: 현재 배포 버전 v79 통일 + 발표용 표현 제거

architecture v2 / requirements v7 / CLAUDE v8 로 갈라져 있던 배포 버전을
실제 배포본 v79 하나로 맞췄다. '발표용/데모용' 표현은 1차 MVP 로 교체."
```

---

### Task 2: FMEA 자산 강등 — legacy 폴더 이동 + 배너

**Files:**
- Move: `docs/features/{그래프-추론,FMEA-초안생성,BOM-정합성,모순-검사,결로-시나리오}.md` → `docs/features/legacy-fmea/`
- Move: `docs/과제요구-구현현황.md` → `docs/legacy/`
- Modify: 이동한 6개 파일 상단(배너 삽입) + 내부 상대경로 링크

**Interfaces:**
- Consumes: Task 1 의 `CLAUDE.md:78` 이 이미 `docs/legacy/과제요구-구현현황.md` 를 가리킨다.
- Produces: 확정된 legacy 경로. Task 10 의 README 인덱스가 이 경로를 참조한다.

- [ ] **Step 1: `git mv` 로 이동 (히스토리 보존)**

```bash
mkdir -p docs/features/legacy-fmea docs/legacy
git mv docs/features/그래프-추론.md      docs/features/legacy-fmea/
git mv docs/features/FMEA-초안생성.md    docs/features/legacy-fmea/
git mv docs/features/BOM-정합성.md       docs/features/legacy-fmea/
git mv docs/features/모순-검사.md        docs/features/legacy-fmea/
git mv docs/features/결로-시나리오.md    docs/features/legacy-fmea/
git mv docs/과제요구-구현현황.md          docs/legacy/
```

- [ ] **Step 2: 이동 확인 — rename 으로 잡혔는지**

```bash
git status --porcelain | grep '^R' | wc -l
```
Expected: `6`
> `R` 이 아니라 `D`+`??` 로 잡히면 `git mv` 가 아니라 파일 복사가 일어난 것이다. 되돌리고 다시 한다.

- [ ] **Step 3: legacy-fmea 5개 파일 상단에 배너 삽입**

각 파일의 `# feature: ...` 제목 **바로 다음 줄**에 빈 줄 + 아래 블록을 넣는다.

```markdown
> **레거시 — FMEA 전용.** 이 기능은 동작하지만 신규 투자 대상이 아니다.
> FMEA 객체타입(`fm`·`cause`·`item` 등)을 하드 가정하므로 `default`(램프) 캔버스에서만 쓸 수 있고,
> 다른 캔버스에서는 `lib/capabilities.ts` 가 409 로 막는다.
> 제품의 현재 방향은 [../../README.md](../../README.md) 참조.
```

`docs/legacy/과제요구-구현현황.md` 는 제목 다음 줄에 아래를 넣는다.

```markdown
> **아카이브.** SL 램프 FMEA 과제 대응 기록(1차 MVP). 과제 자체가 2026-07-21 목표에서 빠졌다.
> 현행 제품 문서는 [../README.md](../README.md) 참조.
```

- [ ] **Step 4: 이동으로 깨진 상대경로 링크 수정**

한 단계 깊어졌으므로 `legacy-fmea/` 안의 `../` 참조는 `../../` 가 되어야 한다.

```bash
rg -n '\]\(\.\./' docs/features/legacy-fmea/ docs/legacy/
```

각 매치를 확인해 고친다:
- `legacy-fmea/*.md` 안에서 `](../design.md)` → `](../../design.md)`, `](../superpowers/` → `](../../superpowers/`
- `legacy-fmea/*.md` 안에서 같은 폴더로 옮겨진 문서끼리의 링크(예: 그래프-추론 → 모순-검사)는 **그대로 둔다**(같은 디렉터리)
- `legacy-fmea/*.md` 에서 core 로 남은 문서(예: `온톨로지-저장소.md`)를 가리키면 `](../온톨로지-저장소.md)`
- `docs/legacy/과제요구-구현현황.md` 의 `](features/...)` → `](../features/...)`, `](data-model.md)` → `](../data-model.md)`

- [ ] **Step 5: 다른 문서에서 이동한 파일을 가리키는 링크 수정**

```bash
rg -n '그래프-추론|FMEA-초안생성|BOM-정합성|모순-검사|결로-시나리오|과제요구-구현현황' docs/ CLAUDE.md --glob '!docs/features/legacy-fmea/**' --glob '!docs/legacy/**'
```

매치되는 곳(주로 `docs/architecture.md`, `docs/requirements.md`, `docs/README.md`, `CLAUDE.md`)의 경로 앞에 `legacy-fmea/` 또는 `legacy/` 를 붙인다.
> `docs/README.md` 와 `CLAUDE.md` 는 Task 10 에서 어차피 전면 재작성한다. 여기서는 **깨진 링크만 없애는 최소 수정**으로 끝낸다.

- [ ] **Step 6: 링크 검증 — 깨진 링크 0건**

```bash
# md 파일 안의 상대 링크가 실제 파일을 가리키는지 확인
for f in $(find docs -name '*.md') CLAUDE.md; do
  d=$(dirname "$f")
  grep -o '](\.\?\.\?/\?[^)#]*\.md' "$f" 2>/dev/null | sed 's/^](//' | while read -r l; do
    [ -f "$d/$l" ] || echo "BROKEN  $f  ->  $l"
  done
done
```
Expected: 출력 없음

- [ ] **Step 7: 커밋**

```bash
git add -A docs/ CLAUDE.md
git commit -m "docs: FMEA 문서를 legacy-fmea/ 로 강등, 과제 문서는 legacy/ 로 아카이브

FMEA 는 1차 MVP 를 검증한 도메인이고 더 이상 목표가 아니다. 코드는 동작하므로
건드리지 않고 문서만 강등한다. git mv 로 히스토리 보존, 상단 배너로 위치 명시.
이동으로 깨진 상대경로 링크 전부 수정."
```

---

### Task 3: requirements.md 재작성

가장 낡은 문서. FMEA 과제 전제로 쓰여 있고 구현된 것을 "구현 안 함"으로 적고 있다.

**Files:**
- Modify: `docs/requirements.md` (전면)

**Interfaces:**
- Consumes: Task 1 의 `v79`, Task 2 의 `legacy/` 경로.
- Produces: §4 범위 정의. Task 4(architecture §7 Non-goals)와 Task 10(README 정체성)이 이 절과 모순되면 안 된다.

- [ ] **Step 1: 새 본문 작성**

`docs/requirements.md` 를 아래로 교체한다.

```markdown
# requirements.md — 배경·요구사항·범위

> 온톨로지 모델/스키마는 [data-model.md](data-model.md), 스택은 [tech-stack.md](tech-stack.md) 참조.
> 이 문서는 **왜 만들고, 무엇을 어디까지 하는가**만 다룬다.

- 최초 작성 2026-07-03 · 방향 전환 2026-07-21 · 스택: Next.js
- 전제: 텍스트 우선 · 로그인 없음

## 1. 한 줄 요약
> 비정형 사내 문서를 캔버스에 부으면 **그래프 온톨로지 + 벡터 임베딩**으로 적재되고,
> **검색·질의응답**에 **근거 문서와 확신도**가 붙어 나온다.

## 2. 푸는 문제
| 문제 | 해결 방식 |
|---|---|
| 문서가 비정형·분산이라 핵심정보 추출이 어렵다 | 인제스천으로 객체·관계 구조화 적재 |
| 키워드 검색으로는 문맥이 안 잡힌다 | 벡터 임베딩 후보확장 + 그래프 1-hop 확장 |
| 답변의 출처를 믿을 수 없다 | 모든 결과에 `EVIDENCED_BY` 근거 문서 + 확신도 |
| 부서마다 지식 체계가 다르다 | 캔버스 = 데이터·스키마 완전 격리 워크스페이스 |

## 3. 핵심 루프
```
문서 업로드 → 인제스천(파싱·정규화·auto-create) → 온톨로지 + 임베딩
   → 검색(키워드 · 자연어 · 벡터) → 질의응답(RAG, 근거 인용) → 원문 확인
```

## 4. 범위

### ✅ 구현됨
- **캔버스** — 도메인별 완전 격리. 데이터·스키마 0에서 시작. 데이터 라우트 26개 `?canvas=` 스코핑
- **스키마 편집** — 캔버스별 객체타입·관계타입 CRUD. 객체타입 정의가 인제스천의 선행 조건
- **인제스천** — xlsx/pptx/docx/dxf/pdf 파싱 + auto-create + 견고 파싱(병합헤더·동의어 컬럼·산문)
- **문서 관리** — 등록·교체(PUT)·삭제(DELETE). 근거가 0이 된 객체만 함께 제거
- **저장소** — Postgres 원본 + 캔버스별 인메모리 읽기 캐시(write-through). `DATABASE_URL` 없으면 인메모리 폴백
- **검색** — 키워드 + 그래프 스코어링 · 자연어 규칙기반 · **벡터 후보확장**(pgvector 384-dim)
- **질의응답** — 선택 객체 RAG(`lib/ask.ts`). 속성·관계·근거 문서만 컨텍스트로 주고 `[R n]` 관계 인용
- **관계 유도** — Python 사이드카가 유도한 관계를 overlay 로 조회(store 병합 안 함, 원본 보존)
- **품질·정리** — 중복·고립·근거없음 스캔 + 형식 온톨로지 위반 검증 → 사람 승인 후 병합·삭제
- **UI** — 그래프·계층·표·RAW 4뷰 + 인스펙터 + 원문 열람. 라이트 SL 브랜드 테마
- **배포** — Docker standalone → FEDA K8s v79, NodePort 30494

### 🔜 계획됨 (설계만 있고 코드 없음)
- **문서 청킹 + 원문 RAG** — 노드 라벨이 아니라 문서 본문 청크를 임베딩해 검색·인용
  → [document-chunking](superpowers/specs/2026-07-20-document-chunking-design.md)
- **임베딩 모델 e5-base 교체** — 현재 384-dim 모델에서 상향. 위 설계에 포함

### ❌ 구현 안 함 (YAGNI)
- Docling(스캔/이미지 PDF·표 사진), 도면/이미지 이해(VLM), 멀티모달 임베딩
- 외부 데이터(논문·특허·소비자 반응) 연계
- 로그인·멀티유저·권한
- 대규모 스케일(HPA·150TB)

### 🗄 레거시 (동작하지만 신규 투자 없음)
FMEA 추론·초안생성·모순검사·BOM 정합·결로 시나리오·2D 설계도.
`default`(램프) 캔버스 전용이며 `lib/capabilities.ts` 가 다른 캔버스에서 409 로 막는다.
→ [features/legacy-fmea/](features/legacy-fmea/) · 과제 기록 [legacy/과제요구-구현현황.md](legacy/과제요구-구현현황.md)

## 5. 완료 기준 (Definition of Done)
- [x] 빈 캔버스 생성 → 객체타입 정의 → 문서 업로드 → 그래프에 반영되는 루프가 끊김 없이 동작
- [x] 캔버스 간 데이터·스키마가 새지 않는다(램프 179노드가 신규 캔버스에 0건 유출)
- [x] 데이터 라우트 26개가 `?canvas=` 누락 시 400, 없는 캔버스 404
- [x] 노드 클릭 → `/api/object/[id]` 실제 속성·관계·근거 표시
- [x] 키워드·자연어 검색 → 결과 클릭 → 노드 포커스 + 인스펙터
- [x] 임베딩 백필이 부팅·병합 후 자동 동작(`POST /api/admin/embed-backfill` 로 재트리거)
- [x] 질의응답 답변이 컨텍스트 밖 내용을 지어내지 않고 `[R n]` 으로 관계를 인용
- [x] 문서 삭제 시 다른 문서가 받치는 객체는 남는다(`keptEdges` 로 보고)
- [x] 인제스천 결과 램프 캔버스 **180 노드 / 2,199 엣지 / 문서 41**
- [x] `npm test` green
- [x] FEDA K8s 배포 — ns `sl-ontoground`, v79, NodePort 30494 → `http://192.168.0.100:30494/`
```

- [ ] **Step 2: 검증 — 금지 사항 없는지**

```bash
rg -n 'FMEA 지식|과제①|정리할거|v7[^6]' docs/requirements.md; echo "exit=$?"
```
Expected: 출력 없음

```bash
rg -n '미채택|편집/쓰기' docs/requirements.md; echo "exit=$?"
```
Expected: 출력 없음 (구현된 것을 미구현으로 적은 문장이 사라졌다)

- [ ] **Step 3: 링크 검증**

Task 2 Step 6 의 링크 체크 루프를 다시 돌린다.
Expected: 출력 없음

- [ ] **Step 4: 커밋**

```bash
git add docs/requirements.md
git commit -m "docs(requirements): 재작성 — RAG·Vector·Graph 검색/질의응답

FMEA 과제 전제를 걷어내고 범위를 현행 코드에 맞췄다.
- 구현됨/계획됨/구현안함/레거시 4구간으로 재분류
- '신경망 임베딩 미채택'·'객체 편집 쓰기 없음' 오기 삭제 (둘 다 구현됨)
- 캔버스·스키마 편집·문서 관리·질의응답 항목 신규
- 문서 청킹 RAG 는 '계획됨'으로 명시 — 설계만 있고 코드 없음"
```

---

### Task 4: architecture.md 표적 수정

§2.1(캔버스 요청 경로)은 이미 정확하다. 건드리지 않는다.

**Files:**
- Modify: `docs/architecture.md` §1 다이어그램 · §3 데이터흐름 · §4 API 표 · §6 확장 이음새 · §7 Non-goals

**Interfaces:**
- Consumes: Task 3 의 requirements §4 범위 구분.
- Produces: §4 API 표가 라우트의 단일 진실 소스. Task 7~9 의 features 문서는 이 표와 엔드포인트 이름이 일치해야 한다.

- [ ] **Step 1: §1 컴포넌트 다이어그램 교체 (4~29줄)**

```
┌─────────────────────────────────────────────────────────┐
│  브라우저 (클라이언트 컴포넌트)                            │
│  LeftRail · Canvas/Schema/Document Panel                 │
│  Graph · Hierarchy · Table · RAW 4뷰 · Inspector         │
│  Search · NLSearch · Ask · Reason · Quality              │
└───────────────┬─────────────────────────────────────────┘
                │  fetch  (?canvas=<id> 자동 부착 · api-client.ts)
┌───────────────▼─────────────────────────────────────────┐
│  Next.js Route Handlers  (app/api/*)                     │
│  캔버스·스키마 · 인제스천·문서 · 검색·질의응답 · 품질     │
│  데이터 라우트 26개 = withCanvasRoute 래퍼 (§2.1)         │
└───────────────┬─────────────────────────────────────────┘
                │  함수 호출
┌───────────────▼─────────────────────────────────────────┐
│  도메인 로직  (lib/)  — 프레임워크 비의존                 │
│  store · search · nlsearch · ask · embed · quality       │
│  ingest/(파서·normalize) · schema/(classify·validate)     │
│  canvases · documents · capabilities · taxonomy · view-* │
└───────┬───────────────────────────────┬─────────────────┘
        │                               │  HTTP
┌───────▼─────────────────────┐ ┌───────▼─────────────────┐
│ 저장소                       │ │ Python 사이드카          │
│ Postgres(원본) + pgvector    │ │ /embed  384-dim 임베딩   │
│ 캔버스별 인메모리 읽기 캐시   │ │ /reason 관계 유도(overlay)│
│ (DB 없으면 인메모리 폴백)     │ │ /parse  · /llm           │
└─────────────────────────────┘ └─────────────────────────┘
```

- [ ] **Step 2: §3 데이터 흐름 교체 (70~76줄)**

기존 "STAGE 1/2/3" 서사는 FMEA 추론 데모 흐름이다. 아래로 바꾼다.

```markdown
## 3. 데이터 흐름

**적재:** 캔버스 선택 → 객체타입 정의(`/api/schema/object-types`) → 문서 업로드(`POST /api/ingest`)
→ 파서 → `normalize.resolveOrCreate` → 노드·엣지 upsert → DB 커밋 성공 시에만 캐시 병합
→ 새 노드 임베딩 백필 비차단 예약(`scheduleEmbedBackfill`).

**조회:** `GET /api/ontology` → 그래프/계층/표/RAW 4뷰 렌더. 노드 클릭 → `GET /api/object/[id]` 인스펙터.

**검색:** 입력 중 = 키워드 드롭다운(`GET /api/search`). Enter = 자연어(`POST /api/nlsearch`,
규칙기반 엔티티 링크 + 벡터 후보확장 + 그래프 1-hop). 근거 칩 클릭 → `GET /api/source-text` 원문.

**질의응답:** 객체 선택 → `POST /api/ask` → `lib/ask.ts` 가 속성·관계(최대 30)·근거 문서(최대 8)로
컨텍스트를 조립 → LLM 이 그 안에서만 답하고 `[R n]` 으로 관계 인용.

> STAGE 1/2/3 3단계 연출은 1차 MVP 의 램프 캔버스 전용 서사다 →
> [features/legacy-fmea/](features/legacy-fmea/)
```

- [ ] **Step 3: §4 API 표에 누락 라우트 추가 (78~96줄)**

기존 행은 유지하고 아래를 표에 추가한다. 레거시 라우트는 비고에 표시한다.

```markdown
| `/api/ask` | POST | `{id, question}` | `{answer, rels[], docs[]}` — 선택 객체 RAG 질의응답 |
| `/api/reason` | GET | — | 사이드카 유도 관계 overlay(조회 전용, store 미병합) |
| `/api/source-text` | GET | `?file=` | 원본 문서 텍스트 |
| `/api/quality` | GET | — | 품질 스캔(중복·고립·근거없음 + 형식 온톨로지 위반) |
| `/api/curate` | POST | `{action, ...}` | 병합·삭제 실행(사람 승인 후) |
| `/api/ingest` | POST | multipart `file` | `{added, merged}` · 빈 스키마면 409 `{needsSchema}` · 중복 파일명 409 `{duplicate}` |
| `/api/admin/embed-backfill` | POST | — | `{embedded, skipped}` — 임베딩 백필 재트리거 |
| `/api/infer` | POST | 설계 조건 | 체크리스트 — **레거시(FMEA 전용, 타 캔버스 409)** |
| `/api/fmea-draft` | POST | 설계 조건 | DFMEA xlsx — **레거시** |
| `/api/contradictions` | GET | — | 모순 스캔 — **레거시** |
| `/api/bom-check` | POST | — | BOM 정합 — **레거시** |
| `/api/condensation` | GET | `?region?` | 결로 시나리오 — **레거시(`default` 캔버스 전용)** |
| `/api/drawing-input` · `/api/drawing-svg` | POST/GET | 도면 | 2D 설계도 — **레거시** |
| `/api/design-options` | GET | — | 설계 조건 드롭다운 — **레거시** |
| `/api/review-opinion` | POST | 추론 결과 | AI 종합 소견 — **레거시** |
```

- [ ] **Step 4: §6 확장 이음새 표 정정 (114~122줄)**

"임베딩·벡터DB" 가 교체 대상으로 적혀 있으나 이미 구현됐다. 아래로 교체한다.

```markdown
## 6. 확장 이음새 (seam)
| 지금 | 교체 대상 | 바뀌는 파일 |
|---|---|---|
| `lib/ingest/*` 파싱 | Docling(스캔/이미지 PDF) 서비스 | `lib/ingest/*`만 |
| 노드 라벨 임베딩(384-dim) | 문서 청크 임베딩 + e5-base | `lib/embed.ts` · pyservice — [계획됨](superpowers/specs/2026-07-20-document-chunking-design.md) |
| `lib/nlsearch.ts` 규칙기반 해석 | 사내 LLM(`NL_USE_LLM=1`) | `lib/nlsearch.ts`만 |
| `lib/ask.ts` 그래프 컨텍스트 RAG | + 문서 원문 청크 컨텍스트 | `lib/ask.ts`만 — [계획됨](superpowers/specs/2026-07-20-document-chunking-design.md) |
프론트/Route Handler 계약이 고정이라 위 교체는 UI에 무영향.
```

- [ ] **Step 5: §7 Non-goals 교체 (124~125줄)**

```markdown
## 7. Non-goals
멀티유저·권한·대규모 성능(HPA)·멀티모달(VLM)·외부데이터 연계 — 범위 밖([requirements.md](requirements.md) §4).
```

- [ ] **Step 6: 검증**

```bash
# 문서의 API 표에 없는 라우트가 코드에 있는지 (레거시 포함 전수 대조)
find app/api -name route.ts | sed 's|app/api/||; s|/route.ts||' | sort > /tmp/routes.txt
cat /tmp/routes.txt
```
Expected: 출력된 경로가 전부 §4 표에 등장한다. 하나씩 눈으로 대조하고 빠진 것이 있으면 추가한다.

```bash
rg -n 'STAGE 1|STAGE 2|STAGE 3' docs/architecture.md; echo "exit=$?"
```
Expected: §3 의 레거시 안내 문장 1건만 남는다

- [ ] **Step 7: 커밋**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): 다이어그램·데이터흐름·API 표를 현행 코드에 맞춤

- 컴포넌트 다이어그램에 4뷰·Ask·Reason·Python 사이드카·pgvector 반영
- 데이터 흐름을 FMEA STAGE 3단계 서사에서 적재/조회/검색/질의응답으로 교체
- API 표에 누락 라우트 15개 추가, 레거시 라우트 표시
- 확장 이음새에서 '임베딩 교체 예정' 삭제 — 이미 구현됨. 청킹만 계획됨으로 표기"
```

---

### Task 5: data-model.md 표적 수정

§3.1(캔버스)은 이미 정확하다. 건드리지 않는다.

**Files:**
- Modify: `docs/data-model.md` §1·§2 도입부 · §4 삭제 · §5 갱신

- [ ] **Step 1: §1 앞에 프레이밍 문장 삽입 (3줄 교체)**

기존 3줄 `출처: 데모 ...` 를 아래로 바꾼다.

```markdown
> **이 문서의 §1·§2 는 `default`(램프) 캔버스의 시드 메타모델이다.** 제품 전체의 고정 스키마가 아니다.
> 새 캔버스는 **빈 스키마**로 시작하고 사용자가 `/api/schema/*` 로 직접 객체타입·관계타입을 정의한다(§3.1).
> 아래 9종/12종은 "이 정도 밀도의 도메인 모델이 실제로 돌아간다"는 레퍼런스로 읽으면 된다.
```

- [ ] **Step 2: §4 저장 스키마(SQLite 초안) 절 삭제 (88~120줄)**

현행이 아니다. Postgres 실 스키마는 `lib/db/schema.sql` 이고 §3.1 이 이미 캔버스 복합 PK 를 설명한다.
88~120줄을 통째로 지우고 아래 한 줄로 대체한다.

```markdown
## 4. 저장 스키마
현행 영속 스키마는 Postgres — `lib/db/schema.sql`. 캔버스 복합 PK 는 §3.1 표 참조.
마이그레이션은 `lib/db/migrations/001-canvas.sql`(단방향).
```

- [ ] **Step 3: §5 시드 데이터 규모 갱신 (122~124줄)**

```markdown
## 5. 데이터 규모
- `default`(램프) 캔버스 — 인제스천 실측 **180 노드 / 2,199 엣지 / 문서 41** (auto-create 포함)
- `DATABASE_URL` 없는 인메모리 폴백 — `lib/seed.ts` 코어 ≈35 객체 / ≈40 관계 + 근거 위성 ≈240
- 새 캔버스 — 0 노드 / 0 스키마에서 시작
```

- [ ] **Step 4: §3.1 의 낡은 수치 정정 (50줄)**

`(179 노드 / 2,198 엣지 / 40 문서)` → `(180 노드 / 2,199 엣지 / 41 문서)`

- [ ] **Step 5: 검증**

```bash
rg -n '179|2,198|SQLite|275' docs/data-model.md; echo "exit=$?"
```
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add docs/data-model.md
git commit -m "docs(data-model): 9종/12종을 default 캔버스 시드로 재프레이밍

제품 고정 스키마처럼 읽히던 것을 레퍼런스 메타모델로 명시했다.
현행이 아닌 SQLite 초안 절 삭제(실 스키마는 lib/db/schema.sql).
데이터 규모를 실측값 180/2,199/41 로 통일."
```

---

### Task 6: tech-stack.md — Vector/RAG 축 보강

**Files:**
- Modify: `docs/tech-stack.md`

- [ ] **Step 1: 현재 내용 확인**

```bash
cat docs/tech-stack.md
```
임베딩·pgvector·사이드카가 어떻게 적혀 있는지 확인한다. "미채택"·"슬롯만 비움" 류 표현이 있으면 전부 정정 대상이다.

- [ ] **Step 2: 검색·RAG 스택 절 추가/교체**

아래 절을 넣는다(이미 유사 절이 있으면 교체).

```markdown
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
```

- [ ] **Step 3: 검증**

```bash
rg -n '미채택|슬롯만|한국어 변별 실패' docs/tech-stack.md; echo "exit=$?"
```
Expected: 출력 없음

- [ ] **Step 4: 커밋**

```bash
git add docs/tech-stack.md
git commit -m "docs(tech-stack): 검색·RAG 스택 절 추가

pgvector 384-dim·사이드카·그래프 RAG 를 '구현', 문서 청킹·e5-base 를
'계획됨'으로 구분해 적었다. '임베딩 미채택' 류 낡은 표현 제거."
```

---

### Task 7: 신규 core features — 검색·질의응답 4건

**Files:**
- Create: `docs/features/벡터-임베딩.md`
- Create: `docs/features/질의응답.md`
- Create: `docs/features/관계-유도.md`
- Create: `docs/features/원문-RAG.md`

**Interfaces:**
- Consumes: Task 4 §4 API 표의 엔드포인트 이름.
- Produces: `docs/README.md`(Task 10) 인덱스가 이 4개 파일명을 링크한다.

기존 features 문서의 형식을 따른다: `# feature: <이름>` → 캔버스 범위 배너(해당 시) → `## 책임` → 동작 → 계약 → 골든룰 준수 → 확장 이음새.

- [ ] **Step 1: `벡터-임베딩.md` 작성**

다뤄야 할 내용 — 코드에서 확인하며 쓴다(`lib/embed.ts` 43줄, `lib/pyservice.ts` 36줄):
- 책임: 질의·노드 텍스트 → 384-dim 벡터. 상태 없음. Python 사이드카 `/embed` 래퍼
- `embedEnabled()` — 사이드카 미가용이면 전 기능이 조용히 skip 되고 검색은 규칙기반으로 계속 동작
- `backfillEmbeddings()` — `embedding IS NULL` 인 노드만 배치로 채운다. **멱등**. DB·사이드카 없으면 skip
- 트리거: 부팅 시 자동 · 문서 병합 후 비차단 예약(`scheduleEmbedBackfill`) · 수동 `POST /api/admin/embed-backfill`
- 캔버스: `nodes.embedding` 은 컬럼 변경 없이 유사도 쿼리에 `canvas_id` 조건만 붙는다
- 확장 이음새: 청킹 + e5-base 교체 시 이 파일 시그니처 유지 → [document-chunking](../superpowers/specs/2026-07-20-document-chunking-design.md)

- [ ] **Step 2: `질의응답.md` 작성**

`lib/ask.ts`(76줄) · `app/api/ask/route.ts` · `components/AskPanel.tsx` 를 읽고 쓴다:
- 책임: 선택 객체 Q&A 의 RAG 컨텍스트 조립(순수 로직)
- 골든룰: LLM 은 조립된 컨텍스트(속성·관계·근거 문서)만 근거로 답한다. 임의 생성 금지
- 관계에 `R1..Rn` 번호를 붙여 LLM 이 `[R n]` 으로 인용 → UI 가 번호로 관계 칩 하이라이트
- 상한: 관계 `MAX_RELS = 30`, 문서 `MAX_DOCS = 8` — 컨텍스트 폭주 방지
- 캐시 키는 `fnv1a` 해시. `ai_opinions` 테이블이 캔버스별이라 다른 캔버스 답변이 새지 않는다
- 확장 이음새: 문서 원문 청크를 컨텍스트에 추가 → [원문-RAG.md](원문-RAG.md)

- [ ] **Step 3: `관계-유도.md` 작성**

`lib/reason.ts`(28줄) · `components/ReasonPanel.tsx` · `components/useReason.ts`:
- 책임: 온톨로지 전체를 사이드카 `/reason` 에 보내 "스스로 유도한 관계"를 받는다
- **골든룰 원본 보존**: 유도 엣지는 store 에 병합하지 않는다. 조회 전용 overlay
- 장애 격리: 어떤 네트워크 오류도 삼켜서 빈 배열을 준다(throw 금지). 사이드카가 죽어도 조회를 막지 않는다
- 확신도: 유도 관계는 확정 관계와 시각적으로 구분해 표시한다

- [ ] **Step 4: `원문-RAG.md` 작성 — 계획됨 문서**

상단에 반드시 넣는다:

```markdown
> **계획됨 — 코드에 없다.** 설계만 존재한다:
> [document-chunking](../superpowers/specs/2026-07-20-document-chunking-design.md) ·
> 구현 계획 [2026-07-20-document-chunking.md](../superpowers/plans/2026-07-20-document-chunking.md) (8 태스크)
> 현재 구현된 RAG 는 노드 컨텍스트 기반뿐이다 → [질의응답.md](질의응답.md)
```

이어서 설계 요약(청킹 단위·임베딩 모델 e5-base 교체·인용 방식)을 스펙에서 가져와 적는다.

- [ ] **Step 5: 검증 — 문서가 가리키는 코드가 실재하는지**

```bash
for m in lib/embed.ts lib/pyservice.ts lib/ask.ts lib/reason.ts app/api/ask/route.ts app/api/reason/route.ts components/AskPanel.tsx components/ReasonPanel.tsx; do
  test -f "$m" || echo "MISSING $m"
done
```
Expected: 출력 없음

```bash
rg -n '계획됨' docs/features/원문-RAG.md | head -1
```
Expected: 1건 이상 매치

- [ ] **Step 6: 커밋**

```bash
git add docs/features/
git commit -m "docs(features): 검색·질의응답 4건 신규 — 벡터 임베딩·질의응답·관계 유도·원문 RAG

코드 약 220줄이 features 문서 없이 있었다.
원문-RAG 는 미구현이므로 상단에 '계획됨' 배너와 설계 링크를 박았다."
```

---

### Task 8: 신규 core features — UI·운영 4건

**Files:**
- Create: `docs/features/뷰-3종.md`
- Create: `docs/features/원문-보기.md`
- Create: `docs/features/큐레이션.md`
- Create: `docs/features/스키마-검증.md`

- [ ] **Step 1: `뷰-3종.md` 작성**

`lib/taxonomy.ts`(79줄) · `lib/view-overview.ts`(27) · `lib/view-table.ts`(69) · `lib/fold.ts`(17) 와
`components/{HierarchyView,TableView,RawView,OverviewPanel,ViewToggle}.tsx`:
- 책임: 같은 온톨로지를 그래프 말고 다른 각도로 보여준다 — 계층(택소노미) · 표 · RAW
- `taxonomy.ts`: 타입 → 서브타입 → 개체 3레벨 트리. 라벨 한글화·색은 컴포넌트(`typeStyles`/metamodel) 몫, 여기선 구조·카운트·raw id 만
- 전부 순수 함수, 프레임워크 비의존 → 테스트 용이(`lib/taxonomy.test.ts` 등)
- 캔버스: 입력이 `allNodes()`/`allEdges()` 라 현재 캔버스만 본다

- [ ] **Step 2: `원문-보기.md` 작성**

`lib/source-text.ts`(67줄) · `app/api/source-text/route.ts` · `components/SourceModal.tsx`:
- 책임: 근거 칩 → 원본 문서 텍스트 열람. 골든룰 1(근거 우선)의 **마지막 확인 단계**
- 업로드 원본 바이트는 `sources.content` 에 보관되므로 재파싱 없이 원문을 돌려준다

- [ ] **Step 3: `큐레이션.md` 작성**

`app/api/curate/route.ts`(43줄) + `docs/features/품질-스캔.md` 의 호출 관계:
- 책임: 품질 스캔이 찾은 것을 **사람 승인 후** 실행 — 병합·삭제
- 골든룰: 스캔은 아무것도 실행하지 않는다. 실행은 반드시 사용자 클릭 경유
- 품질-스캔 문서와 상호 링크

- [ ] **Step 4: `스키마-검증.md` 작성**

`lib/schema/validate.ts`(119줄) · `lib/schema/classify.ts`(38줄):
- 책임: 메타모델(`relation_types` domain/range · `object_subtypes` · `property_defs`) 대비 실데이터 위반을 `QualityIssue` 로 **보고만** 한다
- **차단 없음** — 근거: 스펙 [2026-07-09-formal-ontology-schema-design.md](../superpowers/specs/2026-07-09-formal-ontology-schema-design.md) §B
- 실행(삭제·관계삭제)은 `/api/curate` 몫 → [큐레이션.md](큐레이션.md)
- 인자 기본값이 store 인메모리 스냅샷이라 테스트는 합성 `(nodes, edges, metamodel)` 주입으로 한다

- [ ] **Step 5: 검증**

```bash
for m in lib/taxonomy.ts lib/view-overview.ts lib/view-table.ts lib/fold.ts lib/source-text.ts lib/schema/validate.ts lib/schema/classify.ts app/api/curate/route.ts; do
  test -f "$m" || echo "MISSING $m"
done
```
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add docs/features/
git commit -m "docs(features): UI·운영 4건 신규 — 뷰 3종·원문 보기·큐레이션·스키마 검증

코드 약 460줄이 features 문서 없이 있었다. 스키마 검증은 '보고만 하고
차단하지 않는다'는 설계 근거(2026-07-09 스펙 §B)를 함께 적었다."
```

---

### Task 9: 신규 legacy features 2건

**Files:**
- Create: `docs/features/legacy-fmea/2D-설계도.md`
- Create: `docs/features/legacy-fmea/검토의견-오케스트레이터.md`

- [ ] **Step 1: 두 파일 모두 상단에 레거시 배너 삽입**

Task 2 Step 3 과 **동일한 배너 문구**를 쓴다(문구가 갈라지지 않게 그대로 복사).

- [ ] **Step 2: `2D-설계도.md` 작성**

`lib/shape-sim.ts`(129줄) · `lib/drawing-input.ts`(85) · `lib/drawing-risk.ts`(92) ·
`components/DrawingPanel.tsx` · `app/api/{drawing-input,drawing-svg,design-options}/route.ts`:
- 책임: "차명이 아니라 형상 유사도" — 프로젝트/도면의 형상 특징 벡터(벤트·실링·개스킷·커넥터·하우징·렌즈)를 가중 일치율로 비교하고 일치/불일치 근거를 함께 반환
- 결정론적·설명 가능. 확장 이음새: `shapeSimilarity()` 내부를 지오메트리 임베딩 코사인으로 교체(시그니처 유지)
- 설계: [2026-07-06-2d-drawing-design.md](../../superpowers/specs/2026-07-06-2d-drawing-design.md)
- 왜 레거시인가: 램프 도면 형상 특징에 종속. `/api/design-options` 는 `proj` 노드 props 에서 시장·광원·형상을 뽑는 FMEA 설계조건 전용

- [ ] **Step 3: `검토의견-오케스트레이터.md` 작성**

`lib/review-opinion.ts`(60줄) · `lib/orchestrator.ts`(79줄):
- `review-opinion`: AI 종합 소견 RAG — 캐시 키 해시 + LLM 컨텍스트 요약 조립. `DesignInput`·`InferResponse`·`MasterAudit`·`Contradiction` 에 의존
- `orchestrator`: 추론 파이프라인 v0. `infer` · `checkBom` 을 호출하고 단계별 실측 요약(counts·ms) 기록. **새 판정 로직 0**
- 골든룰: counts 는 전부 실측. 연출용 숫자 금지
- 왜 레거시인가: 두 모듈 다 FMEA 전용 타입에 직접 의존

- [ ] **Step 4: 검증 — 배너 문구 일관성**

```bash
rg -c '레거시 — FMEA 전용' docs/features/legacy-fmea/*.md
```
Expected: 7개 파일 전부 `1`

```bash
# legacy-fmea 안의 상대경로가 두 단계인지
rg -n '\]\(\.\./[^.]' docs/features/legacy-fmea/2D-설계도.md
```
Expected: `../` 단일 단계는 같은 `features/` 를 가리킬 때만 나온다. `superpowers/` `design.md` 등 `docs/` 직속은 `../../`

- [ ] **Step 5: 링크 검증**

Task 2 Step 6 루프 재실행. Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add docs/features/legacy-fmea/
git commit -m "docs(features): 레거시 2건 신규 — 2D 설계도·검토의견/오케스트레이터

코드 약 445줄이 문서 없이 있었다. 둘 다 FMEA 전용 타입에 의존하므로
legacy-fmea/ 에 두고 동일 배너를 붙였다."
```

---

### Task 10: README.md + CLAUDE.md — 정체성·인덱스 확정

모든 파일이 제자리에 있어야 인덱스를 쓸 수 있다. 마지막에서 두 번째.

**Files:**
- Modify: `docs/README.md` (전면)
- Modify: `CLAUDE.md` (정체성 문단 · 골든룰 · 레포 구조 · 문서맵)

**Interfaces:**
- Consumes: Task 2~9 로 확정된 전체 파일 경로.

- [ ] **Step 1: 실제 파일 목록 확보 (인덱스를 손으로 짐작하지 않는다)**

```bash
ls docs/features/*.md | sort
ls docs/features/legacy-fmea/*.md | sort
ls docs/legacy/*.md
```

- [ ] **Step 2: `docs/README.md` 교체**

```markdown
# SL OntoGround — 문서 인덱스

비정형 사내 문서를 **벡터 RAG + 그래프 온톨로지**로 적재해 **검색·질의응답**하는 워크벤치.
캔버스 = 도메인별 완전 격리 워크스페이스. 모든 답변에 **근거 문서 + 확신도**.

## 읽는 순서
1. [requirements.md](requirements.md) — **왜/무엇** — 문제·범위·완료기준
2. [tech-stack.md](tech-stack.md) — **무엇으로** — 스택 결정기록·검색/RAG 계층
3. [architecture.md](architecture.md) — **어떻게 (전체)** — 구조·데이터흐름·API·캔버스 스코핑
4. [data-model.md](data-model.md) — **데이터** — 메타모델·캔버스 스키마·JSON 형태
5. [design.md](design.md) — **보이는 것** — UI 디자인 시스템
6. [features/](features/) — **기능별 상세** (아래)
7. [deployment.md](deployment.md) — Docker standalone → FEDA K8s
8. [skills.md](skills.md) · [review-notes.md](review-notes.md)

## 기능 문서

**저장·적재**
[온톨로지-저장소](features/온톨로지-저장소.md) ·
[인제스천](features/인제스천.md) ·
[증분-인제스천](features/증분-인제스천.md) ·
[문서-관리](features/문서-관리.md)

**캔버스·스키마**
[다중-캔버스](features/다중-캔버스.md) ·
[스키마-편집](features/스키마-편집.md) ·
[스키마-검증](features/스키마-검증.md) ·
[기능-가용성](features/기능-가용성.md)

**검색·질의응답**
[키워드-검색](features/키워드-검색.md) ·
[자연어-검색](features/자연어-검색.md) ·
[벡터-임베딩](features/벡터-임베딩.md) ·
[질의응답](features/질의응답.md) ·
[관계-유도](features/관계-유도.md) ·
[원문-RAG](features/원문-RAG.md) *(계획됨)*

**UI·운영**
[워크벤치-UI](features/워크벤치-UI.md) ·
[그래프-인터랙션](features/그래프-인터랙션.md) ·
[뷰-3종](features/뷰-3종.md) ·
[원문-보기](features/원문-보기.md) ·
[품질-스캔](features/품질-스캔.md) ·
[큐레이션](features/큐레이션.md)

**레거시 — FMEA 전용** (동작하지만 신규 투자 없음)
[그래프-추론](features/legacy-fmea/그래프-추론.md) ·
[FMEA-초안생성](features/legacy-fmea/FMEA-초안생성.md) ·
[BOM-정합성](features/legacy-fmea/BOM-정합성.md) ·
[모순-검사](features/legacy-fmea/모순-검사.md) ·
[결로-시나리오](features/legacy-fmea/결로-시나리오.md) ·
[2D-설계도](features/legacy-fmea/2D-설계도.md) ·
[검토의견-오케스트레이터](features/legacy-fmea/검토의견-오케스트레이터.md)

과제 대응 기록(아카이브): [legacy/과제요구-구현현황.md](legacy/과제요구-구현현황.md)

## 상위 지침
- [../CLAUDE.md](../CLAUDE.md) — 작업 지침·골든룰
- [../AGENTS.md](../AGENTS.md) — 서브에이전트 위임 규칙

## 한 줄 원칙
> 문서를 부으면 그래프가 자란다. 모든 답에 **근거 + 확신도**. 각 칸은 **갈아끼우기** 가능.
```

- [ ] **Step 3: `CLAUDE.md` 정체성 문단 교체**

`## 이게 뭔가` 절 본문을 아래로 바꾼다.

```markdown
## 이게 뭔가
비정형 사내 문서를 **벡터 RAG + 그래프 온톨로지**로 적재해 **검색·질의응답**하는 워크벤치.
캔버스(부서·제품군별 완전 격리 워크스페이스)에 문서를 부으면 객체·관계로 구조화되고,
검색·질의응답 결과에 **근거 문서와 확신도**가 붙는다. 팔란티어 온톨로지 스타일. **스택 = Next.js.**

FMEA(SL 자동차 램프)는 1차 MVP 를 검증한 **레거시 도메인**이다 — 코드는 동작하지만 신규 투자 대상이
아니고 `default` 캔버스 전용이다. 상세 `docs/features/legacy-fmea/`.
```

- [ ] **Step 4: `CLAUDE.md` 골든룰 도메인 중립화**

4개 규칙의 뜻은 유지하고 FMEA 특정 표현만 뺀다.

```markdown
## 골든 룰 (어기지 말 것)
1. **근거 우선(provenance):** 모든 객체·추론·답변은 원본 문서(`doc`)에 연결된다. 근거 없는 결론 금지.
2. **확신도 항상 노출:** 자동 생성물은 "검토용 초안". confidence %를 반드시 함께 보여준다. 최종 판단은 사람.
3. **원본 보존:** 원본 값을 덮어쓰지 않는다. `original_code` + `mapped_code` + `confidence` 를 함께 저장.
   유도된 관계는 store 에 병합하지 않고 overlay 로 둔다.
4. **UI에 데이터 하드코딩 금지:** 온톨로지·검색·답변은 전부 `/api/*`에서 온다.
```

- [ ] **Step 5: `CLAUDE.md` 문서맵 표 교체**

```markdown
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
```

- [ ] **Step 6: `CLAUDE.md` 레포 구조 절의 api 목록 갱신**

`app/api/` 나열에 누락된 것을 추가한다: `/ask` `/reason` `/source-text` `/design-options` `/review-opinion` `/drawing-svg`.

- [ ] **Step 7: 검증**

```bash
# 링크 전수 확인
for f in $(find docs -name '*.md') CLAUDE.md; do
  d=$(dirname "$f")
  grep -o '](\.\?\.\?/\?[^)#]*\.md' "$f" 2>/dev/null | sed 's/^](//' | while read -r l; do
    [ -f "$d/$l" ] || echo "BROKEN  $f  ->  $l"
  done
done
```
Expected: 출력 없음

```bash
# features 파일 중 README 가 링크하지 않은 것
for f in docs/features/*.md docs/features/legacy-fmea/*.md; do
  b=$(basename "$f")
  grep -q "$b" docs/README.md || echo "NOT INDEXED  $f"
done
```
Expected: 출력 없음

- [ ] **Step 8: 커밋**

```bash
git add docs/README.md CLAUDE.md
git commit -m "docs: 정체성 확정 — RAG·Vector·Graph 검색/질의응답 워크벤치

README 인덱스를 features 21개 + legacy 7개 전수로 재작성하고 카테고리를
저장/캔버스/검색·QA/UI·운영/레거시로 나눴다. CLAUDE.md 정체성 문단·골든룰·
문서맵을 도메인 중립으로 교체. 골든룰 4개의 뜻은 그대로 유지."
```

---

### Task 11: 최종 검증 — 스펙 완료 기준 전수

**Files:** 없음 (검증만). 위반이 나오면 해당 태스크로 돌아가 고친다.

- [ ] **Step 1: 배포 버전 단일값**

```bash
rg -n 'v[0-9]+' docs/ CLAUDE.md | rg -v 'v79|v76' | rg 'K8s|배포|deploy|NodePort'
# v76 매치가 나오면 이력 서술인지 확인 — 이력이면 정상, '현재 배포'를 뜻하면 v79 로 고친다
```
Expected: 출력 없음

- [ ] **Step 2: 금지 표현 0건**

```bash
rg -n '발표용|보고용|데모용' docs/ CLAUDE.md; echo "exit=$?"
```
Expected: 출력 없음, `exit=1`

- [ ] **Step 3: 깨진 링크 0건**

```bash
for f in $(find docs -name '*.md') CLAUDE.md; do
  d=$(dirname "$f")
  grep -o '](\.\?\.\?/\?[^)#]*\.md' "$f" 2>/dev/null | sed 's/^](//' | while read -r l; do
    [ -f "$d/$l" ] || echo "BROKEN  $f  ->  $l"
  done
done
```
Expected: 출력 없음

- [ ] **Step 4: core 기능 중 features 문서 없는 것 0건**

스펙 §3.1 표의 core 판정 모듈이 전부 어느 features 문서엔가 등장하는지 확인한다.

```bash
for m in store search nlsearch ask embed reason taxonomy source-text quality canvases documents capabilities; do
  rg -l "lib/$m" docs/features/*.md >/dev/null 2>&1 || echo "UNDOCUMENTED  lib/$m"
done
```
Expected: 출력 없음

- [ ] **Step 5: legacy 배너 전수**

```bash
rg -L -c '레거시 — FMEA 전용' docs/features/legacy-fmea/*.md
```
Expected: 배너 없는 파일이 출력되지 않는다 (7개 전부 배너 보유)

- [ ] **Step 6: 낡은 수치 잔존 0건**

```bash
rg -n '179 노드|2,198|170 노드|2,156|174 노드|2,171|34개' docs/ CLAUDE.md; echo "exit=$?"
```
Expected: 출력 없음

- [ ] **Step 7: 미구현을 구현으로 쓴 곳 없는지 — 수동 확인**

```bash
rg -n '청킹|chunk' docs/ | rg -v '계획됨|design.md|plans/'
```
Expected: 매치가 나오면 각각 열어서 "계획됨" 문맥인지 확인한다. 완료형으로 쓰였으면 고친다.

- [ ] **Step 8: 코드 변경 0 확인**

```bash
git diff --stat 24582ef..HEAD -- lib/ app/ components/ scripts/
```
Expected: 출력 없음
> 079c9e4 의 lib 주석 경로 갱신은 이 계획 착수 **전** 커밋이므로 범위 밖이다. 기준 커밋을 `fbfdb80` 로 잡아도 된다.

- [ ] **Step 9: 최종 커밋 (검증에서 고친 것이 있을 때만)**

```bash
git add -A docs/ CLAUDE.md
git commit -m "docs: 재구성 최종 검증 — 잔여 위반 수정"
```

---

## Self-Review

**스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| §2 새 정체성 | Task 10 (README·CLAUDE.md) |
| §3 목표 문서 구조 | Task 2(이동) · 7·8·9(신규) · 10(인덱스) |
| §3.1 core/legacy 판정 | Task 2(이동) · 7·8(core 문서) · 9(legacy 문서) · 11 Step 4(검증) |
| §4 사실오류 — 배포 버전 | Task 1 · 11 Step 1 |
| §4 사실오류 — 임베딩 미채택 | Task 3(requirements) · Task 6(tech-stack) |
| §4 사실오류 — 객체 편집/쓰기 | Task 3 |
| §4 사실오류 — 캔버스 부재 | Task 3(requirements) · Task 4(architecture §1·§3) |
| §4 사실오류 — features 인덱스 9개 | Task 10 |
| §4 사실오류 — 노드/엣지 수 | Task 5 · 11 Step 6 |
| §4 사실오류 — 테스트 수 | Task 3(완료기준에서 숫자를 빼고 `npm test` green 으로 대체) |
| §4 사실오류 — 발표용 표현 | Task 1 · 11 Step 2 |
| §4 사실오류 — RAG 과장 | Task 3·4·6·7 Step 4 · 11 Step 7 |
| §5 원칙 코드 변경 0 | Global Constraints · 11 Step 8 |
| §6 선행 조건 | 완료됨 (079c9e4) |
| §7 완료 기준 8개 | Task 11 Step 1~8 |

빠진 항목 없음.

**타입/이름 일관성**
- 레거시 배너 문구는 Task 2 Step 3 에서 1회 정의하고 Task 9 Step 1 이 "동일 문구 복사"로 참조 — 갈라지지 않는다
- 링크 체크 루프는 Task 2 Step 6 에서 1회 정의하고 Task 3·9·10·11 이 재사용
- 파일명은 Task 10 README 인덱스와 Task 7·8·9 의 Create 경로가 일치(벡터-임베딩·질의응답·관계-유도·원문-RAG·뷰-3종·원문-보기·큐레이션·스키마-검증·2D-설계도·검토의견-오케스트레이터)
- 수치 `180 / 2,199 / 41` 은 Global Constraints 에서 1회 정의하고 Task 3·5 가 사용

**주의**
- Task 1 → Task 2 순서 의존(Task 1 이 `docs/legacy/` 경로를 미리 쓴다). 순서를 바꾸면 링크가 잠시 깨진다.
- Task 7·8·9 는 서로 독립이라 병렬 가능. Task 10 은 7·8·9 완료 후에만 시작한다.
