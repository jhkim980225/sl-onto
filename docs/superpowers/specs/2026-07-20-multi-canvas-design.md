# 다중 캔버스(도메인별 워크스페이스) — 설계

> 작성일: 2026-07-20 · 상태: 설계 승인 대기
> 범위: **서브프로젝트 1 — 캔버스 골격.** 문서 CRUD(서브프로젝트 2)는 별도 스펙.

## 1. 배경과 목표

지금 워크벤치는 온톨로지가 하나뿐이다. 램프(에스엘 자동차 램프) FMEA 문서 37개가
전역 그래프 하나(179 노드 / 2,198 엣지)에 적재되어 있고, 검색·추론·모순검사가 전부
이 단일 그래프를 본다.

**요구**: 도메인(관련 부서/제품군)이 바뀌면 새 캔버스를 만들고, 그 캔버스에서 자기
문서로 자기 온톨로지를 처음부터 구축할 수 있어야 한다.

**격리 수준: 완전 격리.** 새 캔버스는 데이터도 스키마도 0에서 시작한다. 램프 지식은
한 건도 새어 들어가지 않고, 새 캔버스 문서가 램프 쪽을 오염시키지도 않는다.

**FMEA 배제.** 새 캔버스는 FMEA가 아닐 수 있다. 객체타입·관계타입조차 물려주지 않는다.

## 2. 결정 기록

| 결정 | 선택 | 이유 |
|---|---|---|
| 격리 수준 | 완전 격리 (빈 캔버스) | 부서가 다르면 과거 사례 비교가 무의미. 오염 방지가 더 중요 |
| 캔버스 컨텍스트 전달 | 요청별 `?canvas=` 파라미터 | 서버 전역 활성 캔버스로 하면 두 부서가 동시에 못 씀 |
| 컨텍스트 전파 구현 | `AsyncLocalStorage` | 명시적 인자는 store 호출 **276곳**(39파일) 수정. ALS 는 라우트 23곳 + store 내부 |
| 메타모델 범위 | 캔버스별 | 서브타입이 램프 전용(`thermal-mgmt`·`optics`·`housing`). 전역이면 타 부서 분류가 오염됨 |
| 새 캔버스 스키마 | 완전히 빈 스키마 | FMEA 골격도 물려주지 않음. 스키마 편집 UI 가 같은 범위에 포함되는 대가. **부트스트랩 `default` 캔버스는 예외** — §3.4 |
| 캔버스 삭제 | 소프트 삭제(휴지통) | 사내 지식이 실수로 소실되는 것을 막음 |
| UI 배치 | 좌측 레일 아이콘 + 드로어 | 상단바는 이미 버튼 9개로 포화 |
| 기능 가용성 | 스키마에서 유도(파생값) | 설정값이면 스키마 변경과 어긋남 |

### 기각안

- **오버레이(베이스 공유 + 캔버스 델타)**: 추론이 과거 사례를 계속 볼 수 있어 매력적이나,
  "부서가 다르면 무관"이라는 요구와 충돌. 기각.
- **생성 시 베이스 스냅샷 복사**: 캔버스마다 DB 용량 배수, 베이스 갱신이 기존 캔버스에
  반영 안 됨. 기각.
- **캔버스별 Postgres 스키마 분리**: 격리는 완벽하나 마이그레이션·임베딩 백필이 N배 복잡. 기각.
- **서버 전역 활성 캔버스(`meta` 테이블)**: diff 는 작지만 replicas=1 이 영구 제약이 되고
  두 사람이 다른 캔버스를 보면 화면이 튐. 기각.

## 3. 데이터 모델

### 3.1 신규 테이블

```sql
CREATE TABLE canvases (
  id          TEXT PRIMARY KEY,           -- slug: 'default', 'electronics'
  name        TEXT NOT NULL,              -- 표시명: '램프', '전장'
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ                 -- 소프트 삭제(휴지통). NULL = 활성
);
```

### 3.2 기존 테이블 스코핑

완전 격리이므로 **캔버스 A와 B가 같은 노드 id 를 가질 수 있다**(둘 다 `ILENS` 를 만들 수
있음). 현재 `nodes` PK 는 `id` 단독, `edges` PK 는 `(src,rel,dst)`(`lib/db/schema.sql:50,62`)
라 그대로 두면 캔버스 간 충돌한다. **복합 PK 승격이 불가피하다.**

| 테이블 | 변경 후 PK | FK |
|---|---|---|
| `nodes` | `(canvas_id, id)` | `canvas_id` → `canvases` ON DELETE CASCADE |
| `edges` | `(canvas_id, src, rel, dst)` | `(canvas_id, src)` / `(canvas_id, dst)` → `nodes` ON DELETE CASCADE |
| `sources` | `(canvas_id, file)` | `canvas_id` → `canvases` ON DELETE CASCADE |
| `object_types` | `(canvas_id, type_id)` | `canvas_id` → `canvases` ON DELETE CASCADE |
| `relation_types` | `(canvas_id, rel_id)` | 〃 |
| `object_subtypes` | `(canvas_id, type_id, st_id)` | `(canvas_id, type_id)` → `object_types` |
| `property_defs` | `(canvas_id, type_id, key)` | 〃 |
| `meta` | `(canvas_id, key)` | `active_drawing` 이 캔버스별이어야 함 |
| `change_log` | `+ canvas_id` 컬럼 | |
| `ai_opinions` | `+ canvas_id` 컬럼 | 다른 캔버스 LLM 답변이 캐시로 새면 안 됨 |

`nodes.embedding`(pgvector 384-dim)은 컬럼 변경 없음. 단 유사도 검색 쿼리
(`nearestSameTypePairs`·`semanticSearch`, `lib/db.ts:372,392`)에 `canvas_id` 조건이 붙는다.

### 3.3 마이그레이션

`lib/db/schema.sql` 은 멱등 `CREATE TABLE IF NOT EXISTS` 방식이라 PK 변경을 실을 수 없다.
별도 파일을 둔다.

- `lib/db/migrations/001-canvas.sql` — 신규
- `doReady()`(`lib/db.ts:40`)가 `canvases` 테이블 부재를 감지하면 1회 실행

동작:

1. `canvases` 생성, `('default', '램프')` 삽입 (기존 데이터가 램프 FMEA 이므로)
2. 각 테이블에 `canvas_id TEXT` 추가 → 기존 행 전부 `'default'` 로 채움 → `NOT NULL` 승격
3. 기존 PK/FK 드롭 → 복합 PK/FK 재생성
4. 기존 179 노드 / 2,198 엣지 / 37 문서 / 메타모델 1벌이 `default` 캔버스에 그대로 귀속

**전체를 단일 트랜잭션으로 묶는다.** 실패 시 abort — 부분 적용 상태를 남기지 않는다.
마이그레이션은 단방향이며 되돌리기 스크립트는 제공하지 않는다(운영 DB 백업이 회수 경로).

**멱등성**: 재실행 시 `canvases` 가 이미 있으면 즉시 반환.

### 3.4 `seedMetamodel` 의 역할 변경

현재 `seedMetamodel()`(`lib/db.ts:51-88`)은 부팅마다 전역 1벌을 시드한다. 앞으로는
**대상 캔버스를 인자로 받는다**: `seedMetamodel(pool, canvasId)`.

호출 시점이 셋으로 갈린다.

| 시점 | 동작 |
|---|---|
| **기존 DB 마이그레이션** | 기존 메타모델 행을 `default` 캔버스로 귀속(재시드 없음) |
| **신규 배포(빈 DB) 부트스트랩** | `default` 캔버스 생성 → **FMEA 메타모델 시드** → `ingestAll()` 로 `data/sources` 적재 |
| **사용자가 새 캔버스 생성** | **아무것도 시드하지 않는다**(빈 스키마) |

**중요**: "빈 스키마"는 **사용자가 만드는 캔버스에만** 적용된다. 부트스트랩 `default`
캔버스는 램프 FMEA 베이스라인이므로 기존과 동일하게 시드된다 — 그렇지 않으면 부팅
인제스천(`ingestOrSeed()`, `lib/store.ts:99-115`)이 배정할 타입을 못 찾아 빈 앱으로 뜬다.

즉 `default` 캔버스만 특별 취급하며, 그 특별함은 **부트스트랩 시점 한 번**에 그친다.
이후 `default` 도 다른 캔버스와 동일한 규칙으로 다뤄진다(삭제만 예외 — §8 마지막 캔버스 규칙).

## 4. 캔버스 컨텍스트 전파

### 4.1 문제

store 함수(`ready`·`allNodes`·`getGraph` 등) 호출이 **39개 파일 276곳**이다. 전부에
`canvasId` 인자를 추가하면 기계적이지만 리뷰 불가능한 크기가 되고 실수가 섞인다.

### 4.2 해법 — `AsyncLocalStorage` (Node 표준 라이브러리)

```ts
// lib/canvas-context.ts (신규, ~20줄)
import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_CANVAS = "default";
const ALS = new AsyncLocalStorage<string>();

export const withCanvas = <T>(id: string, fn: () => T): T => ALS.run(id, fn);

export function currentCanvas(): string {
  const id = ALS.getStore();
  if (id) return id;
  if (process.env.NODE_ENV !== "production") {
    console.warn("[canvas] 컨텍스트 밖에서 store 접근 — 기본 캔버스로 폴백\n" + new Error().stack);
  }
  return DEFAULT_CANVAS;
}
```

`lib/` 는 CLAUDE.md 컨벤션대로 프레임워크 비의존을 유지한다(`node:async_hooks` 는 표준 라이브러리).

### 4.3 store 변경

```ts
// lib/store.ts — 공개 시그니처 불변, 내부만 캔버스별 캐시 조회
interface CanvasCache {
  nodes: Node[]; edges: Edge[]; sources: SourceInfo[];
  index: Index; metamodel: Metamodel; syncedAt: number;
}
const CACHES = new Map<string, CanvasCache>();
const cache = () => CACHES.get(currentCanvas()) ?? EMPTY;

export function allNodes() { return cache().nodes; }   // ← 호출부 276곳 그대로
```

`ready()` 는 현재 캔버스 캐시만 하이드레이트/재동기화한다. 2초 TTL(`store.ts:134`)은
캔버스별로 독립 관리한다.

**메모리**: 캔버스당 수백 노드 규모면 수십 개 전량 상주해도 무시할 만하다.
`// ponytail: 전량 상주. 캔버스가 수백 개 되거나 캔버스당 노드가 수만 되면 LRU 로 교체.`

### 4.4 라우트 래퍼

```ts
// lib/canvas-route.ts (신규)
export async function withCanvasRoute(
  req: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  const id = new URL(req.url).searchParams.get("canvas");
  if (!id) return json({ error: "canvas 파라미터가 필요합니다" }, 400);
  if (!(await canvasExists(id))) return json({ error: "존재하지 않는 캔버스" }, 404);
  return withCanvas(id, handler);
}
```

`canvasExists()` 는 요청마다 DB 를 때리지 않는다. 캔버스 목록은 작고 거의 안 변하므로
인메모리 `Set` 으로 캐시하고 캔버스 CRUD 시 무효화한다.
`// ponytail: 단일 파드 전제. 멀티 레플리카가 되면 짧은 TTL 로 바꾼다.`

23개 라우트가 전부 같은 모양이 된다. 누락 라우트는 `grep -L withCanvasRoute app/api/**/route.ts`
한 번으로 찾힌다.

**클라이언트 측**: `lib/api-client.ts` 단일 헬퍼가 모든 fetch 에 `?canvas=` 를 붙인다.
컴포넌트가 직접 `fetch` 를 부르지 않게 한다.

### 4.5 신규 API

| 엔드포인트 | 역할 |
|---|---|
| `GET /api/canvases` | 활성 캔버스 목록(+ 각 노드·문서 수). 휴지통은 `?trash=1` |
| `POST /api/canvases` | 생성 `{name, description?}` → slug 자동 생성. 빈 스키마 |
| `PATCH /api/canvases/[id]` | 이름·설명 변경 |
| `DELETE /api/canvases/[id]` | 소프트 삭제(`deleted_at`). 마지막 캔버스면 409 |
| `POST /api/canvases/[id]/restore` | 휴지통에서 복구 |
| `DELETE /api/canvases/[id]?purge=1` | 영구 삭제(CASCADE) |

이 6개는 캔버스 자체를 다루므로 `withCanvasRoute` 를 쓰지 않는다.

**스키마 편집 API**: `POST/PATCH/DELETE /api/schema/object-types`,
`/api/schema/relation-types`, `/api/schema/subtypes`, `/api/schema/property-defs`.
기존 `GET /api/schema`(읽기 전용, `app/api/schema/route.ts`)를 확장한다.

## 5. 기능 가용성

`lib/` 의 여러 기능이 FMEA 타입을 하드 가정한다. FMEA 아닌 캔버스에서 호출하면
빈 결과이거나 에러다.

| 기능 | 가정 타입 |
|---|---|
| `/api/infer` | `fm` · `cause` · `item` |
| `/api/fmea-draft` | `fm` · `action` |
| `/api/contradictions` | `fm` · `reg` |
| `/api/bom-check` | `item` (+ `CONSISTS_OF`) |
| `/api/condensation` | 노드 id `ILENS`·`FMFOG` 하드코딩 |

**기능 가용성을 스키마에서 유도한다.**

```ts
// lib/capabilities.ts (신규, ~30줄)
const REQUIRES: Record<string, string[]> = {
  infer: ["fm", "cause", "item"],
  fmeaDraft: ["fm", "action"],
  contradictions: ["fm", "reg"],
  bomCheck: ["item"],
};
export function capabilities(m: Metamodel): Record<string, boolean> { /* 타입 유무 대조 */ }
```

`GET /api/schema` 응답에 `capabilities` 를 실어 보내고, 상단바가 그걸로 버튼을 렌더한다.
**설정값이 아니라 파생값**이라 스키마를 고치면 자동으로 따라온다.

해당 라우트는 서버에서도 방어한다 — 요구 타입이 없으면 409 + 사유.

**항상 동작(타입 무관)**: 그래프·계층·Table·RAW 뷰, 키워드/자연어 검색, 인스펙터,
문서 인제스천, 정리(curate), 품질 지표, 유도 관계, Turtle 내보내기, 객체 Q&A.

**`condensation` 은 `default`(램프) 캔버스 전용으로 고정한다.** 노드 id 하드코딩이라
일반화는 이번 범위 밖. 다른 캔버스에서는 버튼을 감춘다.

## 6. UI

### 6.1 좌측 레일

`LeftRail.tsx` 는 드로어 내용을 `children` 하나로 받는다(`LeftRail.tsx:24,52`).
드로어가 3종이 되므로 **아이콘별 콘텐츠 맵**으로 바꾼다.

| 아이콘 | 드로어 | 상태 |
|---|---|---|
| `▤` 캔버스 | 목록·전환·생성·이름변경·삭제·휴지통 | 신규 |
| `▣` 객체 타입 | `SourcePanel`(타입 탐색기) | 유지 |
| `◈` 스키마 | 객체타입·관계타입·서브타입·속성정의 CRUD | 신규 |
| `🕐` 히스토리 | 준비중 | 유지 |

신규 컴포넌트: `components/CanvasPanel.tsx`, `components/SchemaPanel.tsx`.

### 6.2 캔버스 전환 = 소프트 리셋

그래프·인스펙터·검색결과·추론결과가 전부 다른 캔버스 것이 되므로 부분 갱신은 위험하다.
이미 있는 리마운트 리셋(`WorkbenchLoader.tsx:13-15` 의 `resetKey`)을 재사용해
`key={canvasId}` 로 전환한다. 신규 코드가 거의 없다.

**선택 캔버스 보존**: `localStorage`. 없거나 삭제된 캔버스를 가리키면 첫 캔버스로 폴백.

### 6.3 삭제 흐름

목록의 `✕` → 확인 다이얼로그(문서 N개·노드 N개 명시) → `deleted_at` 기록 → 목록에서 사라짐.
드로어 하단 `🗑 휴지통 (N)` 에서 복구 또는 영구삭제(영구삭제는 이름 타이핑 확인).

**마지막 활성 캔버스는 삭제 불가** — 앱이 빈 상태가 되면 복구 경로가 없다.

### 6.4 빈 캔버스 안내

노드 0개 + 타입 0개인 캔버스를 열면 캔버스 영역에 다음 순서를 안내한다.

```
1. 스키마 정의   ◈ 드로어에서 객체타입·관계타입 만들기
2. 문서 인제스천  📥 문서를 부어 온톨로지 구축
```

## 7. 데이터 흐름

```
클라이언트
selectedCanvas (localStorage)
   ├─ lib/api-client.ts 가 모든 fetch 에 ?canvas=<id> 부착
   ▼
Route Handler
   └─ withCanvasRoute(req, handler)          ← 23개 라우트 공통 래퍼
        ├─ ?canvas 파싱 · 존재/미삭제 검증
        ├─ 없으면 400 · 없는 캔버스면 404
        └─ withCanvas(id, handler)           ← AsyncLocalStorage
             ▼
           lib/store.ts   cache() → CACHES.get(currentCanvas())
             ▼
           lib/db.ts      모든 쿼리에 canvas_id 조건
```

## 8. 에러 처리

| 상황 | 처리 |
|---|---|
| `?canvas` 누락 | **400**. 기본 캔버스로 조용히 폴백하면 다른 부서 데이터를 잘못 보여줄 수 있음 |
| 없는/삭제된 캔버스 | 404. 클라이언트는 첫 캔버스로 폴백 후 재시도 |
| 마이그레이션 실패 | 단일 트랜잭션 abort. 부팅 실패로 표면화(조용한 성공 금지) |
| 마지막 캔버스 삭제 | 409 + UI 버튼 비활성 |
| 캔버스 이름 중복 | 허용(id 는 별도 slug) |
| 빈 스키마에서 인제스천 | 200 + `warning: "정의된 객체타입이 없어 적재된 항목이 없습니다"`. 실패 아님 |
| 요구 타입 없는 기능 호출 | 409 + 사유. UI 는 애초에 버튼을 감춤 |
| ALS 컨텍스트 밖 store 호출 | 개발 모드 `console.warn` + 스택. 프로덕션은 기본 캔버스 |

## 9. 테스트

기존 117개는 전역 store 전제로 돈다. `currentCanvas()` 가 기본값을 돌려주므로
**그대로 통과해야 한다** — 이것이 1차 회귀 방어선이다.

| 파일 | 검증 |
|---|---|
| `lib/canvas-context.test.ts` (신규) | `withCanvas` 중첩 · `await` 경계 넘어 컨텍스트 유지 · 밖에서는 기본값 |
| `lib/store.test.ts` (신규) | 캔버스 A 노드가 B 에서 안 보임 · 같은 id 가 A·B 에 공존 · 캐시 TTL 독립 |
| `lib/capabilities.test.ts` (신규) | 타입 없으면 false, 있으면 true |
| 마이그레이션 검증 | 적용 후 179/2,198 이 `default` 에 그대로 · 재실행 멱등 |

수동 검증(구현 후):

- **빈 DB 로 부팅** → `default` 캔버스 생성 + FMEA 시드 + `ingestAll()` → 기존과 동일한 노드/엣지 수
- 기존 배포 DB 로 부팅 → 램프 캔버스가 이전과 동일하게 보이는지
- 새 캔버스 생성 → 0/0 · 타입 0종 · FMEA 버튼 숨김 확인
- 스키마 정의 → 문서 인제스천 → 노드 생성 확인
- 캔버스 전환 왕복 시 데이터 누수 없음 확인

## 10. 범위 밖

- **문서 CRUD(등록·교체·삭제)** — 서브프로젝트 2. 이번엔 기존 인제스천의 캔버스 스코핑만.
- 문서에서 객체타입 자동 유추
- 캔버스 간 문서·노드 이동
- 캔버스 권한·소유자(로그인 없음)
- `condensation` 일반화 — `default` 캔버스 고정
- 캔버스별 LRU 캐시 축출

## 11. 구현 순서 제안

1. 마이그레이션 + `canvases` 테이블 + `lib/db.ts` 캔버스 조건
2. `lib/canvas-context.ts` + `lib/store.ts` 캔버스별 캐시
3. `withCanvasRoute` + 23개 라우트 적용
4. `/api/canvases` CRUD
5. `lib/capabilities.ts` + `/api/schema` 확장 + 서버 방어
6. `components/CanvasPanel.tsx` + `LeftRail` 다중 드로어 + 전환 리마운트
7. 스키마 편집 API + `components/SchemaPanel.tsx`

1~3 이 끝나면 단일 캔버스 상태로 배포 가능하다(기능 변화 없음, 구조만 교체).
