# 다중 캔버스(캔버스 골격) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도메인(부서)별로 격리된 캔버스를 만들어, 각 캔버스가 자기 문서·자기 스키마로 독립된 온톨로지를 갖게 한다.

**Architecture:** `canvases` 테이블을 추가하고 `nodes`/`edges`/`sources`/메타모델 4테이블을 복합 PK로 승격해 캔버스별로 격리한다. 캔버스 컨텍스트는 Node 표준 라이브러리 `AsyncLocalStorage` 로 요청 단위 전파하여, store 공개 시그니처(호출부 276곳)를 건드리지 않는다. UI는 좌측 레일에 캔버스·스키마 드로어를 추가한다.

**Tech Stack:** Next.js 15.5 App Router · TypeScript strict · Postgres(pg) + pgvector · `node --test --experimental-strip-types`

**설계 문서:** `docs/superpowers/specs/2026-07-20-multi-canvas-design.md`

## Global Constraints

- **골든 룰 3 (원본 보존)**: 기존 노드·엣지·문서를 덮어쓰지 않는다. 마이그레이션은 기존 데이터를 `default` 캔버스로 **귀속만** 한다.
- **골든 룰 4 (UI 하드코딩 금지)**: 캔버스 목록·스키마·기능 가용성은 전부 `/api/*` 에서 온다.
- **`lib/` 프레임워크 비의존**: `lib/` 안에서 `next/*` 를 import 하지 않는다. `node:async_hooks` 는 표준 라이브러리이므로 허용.
- **파라미터 바인딩만**: 모든 SQL 값은 `$n` 바인딩. 문자열 보간 금지.
- **기본 캔버스 id**: `"default"` (표시명 `"램프"`). 상수는 `lib/canvas-context.ts` 의 `DEFAULT_CANVAS`.
- **테스트 실행**: `npm test` (= `node --test --experimental-strip-types "lib/**/*.test.ts"`)
- **신규 테스트 파일은 resolve 훅 필수** — 확장자 없는 상대 import 보정. `lib/graph-memo.test.ts:6-19` 패턴을 그대로 복사한다.
- **기존 117개 테스트(110 pass / 7 skip)는 전 과정에서 계속 통과해야 한다.** 이것이 1차 회귀 방어선이다.

---

## File Structure

**신규 파일**

| 파일 | 책임 |
|---|---|
| `lib/canvas-context.ts` | AsyncLocalStorage 기반 현재 캔버스 컨텍스트. `withCanvas` / `currentCanvas` / `DEFAULT_CANVAS` |
| `lib/canvas-context.test.ts` | 컨텍스트 전파·중첩·폴백 검증 |
| `lib/canvases.ts` | 캔버스 CRUD 도메인 로직(목록·생성·이름변경·소프트삭제·복구·영구삭제) + 존재 캐시 |
| `lib/canvases.test.ts` | slug 생성·마지막 캔버스 삭제 금지 규칙 |
| `lib/db/migrations/001-canvas.sql` | 복합 PK 승격 + 기존 데이터 `default` 귀속 |
| `lib/capabilities.ts` | 메타모델 → 기능 가용성 파생 |
| `lib/capabilities.test.ts` | 타입 유무별 가용성 |
| `lib/store.test.ts` | 캔버스 간 격리(같은 id 공존, 누수 없음) |
| `app/api/canvases/route.ts` | `GET`(목록) · `POST`(생성) |
| `app/api/canvases/[id]/route.ts` | `PATCH`(이름변경) · `DELETE`(소프트/영구) |
| `app/api/canvases/[id]/restore/route.ts` | `POST`(휴지통 복구) |
| `lib/canvas-route.ts` | `withCanvasRoute` 라우트 래퍼 |
| `lib/api-client.ts` | 클라이언트 fetch 헬퍼 — 모든 요청에 `?canvas=` 부착 |
| `components/CanvasPanel.tsx` | 좌측 드로어 — 캔버스 목록·전환·생성·이름변경·삭제·휴지통 |
| `components/SchemaPanel.tsx` | 좌측 드로어 — 객체타입·관계타입·서브타입·속성정의 CRUD |
| `app/api/schema/object-types/route.ts` | 객체타입 `POST`/`PATCH`/`DELETE` |
| `app/api/schema/relation-types/route.ts` | 관계타입 `POST`/`PATCH`/`DELETE` |

**수정 파일**

| 파일 | 변경 |
|---|---|
| `lib/db.ts` | 전 쿼리에 `canvas_id` 조건. `seedMetamodel(p, canvasId)`. 마이그레이션 실행 |
| `lib/store.ts` | 모듈 레벨 상태 → `Map<canvasId, CanvasCache>`. 공개 시그니처 불변 |
| `app/api/**/route.ts` (23개) | `withCanvasRoute` 래핑 |
| `components/LeftRail.tsx` | `children` → 아이콘별 콘텐츠 맵 |
| `components/Workbench.tsx` | 캔버스 상태 · `key={canvasId}` 리마운트 · capabilities 로 버튼 렌더 |
| `components/WorkbenchLoader.tsx` | 캔버스 선택 · localStorage |
| `app/api/schema/route.ts` | 응답에 `capabilities` 추가 |

---

## Task 1: 캔버스 컨텍스트 (AsyncLocalStorage)

가장 아래 계층이고 의존이 없다. 여기서 정한 이름을 이후 모든 태스크가 쓴다.

**Files:**
- Create: `lib/canvas-context.ts`
- Test: `lib/canvas-context.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `DEFAULT_CANVAS: "default"`
  - `withCanvas<T>(id: string, fn: () => T): T`
  - `currentCanvas(): string`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`lib/canvas-context.test.ts`:

```ts
// lib/canvas-context.test.ts — 요청별 캔버스 컨텍스트 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/graph-memo.test.ts 상단과 동일(확장자 없는 상대 import 보정).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const { withCanvas, currentCanvas, DEFAULT_CANVAS } = await import("./canvas-context.ts");

test("컨텍스트 밖에서는 기본 캔버스", () => {
  assert.equal(currentCanvas(), DEFAULT_CANVAS);
});

test("withCanvas 안에서는 지정 캔버스", () => {
  withCanvas("electronics", () => {
    assert.equal(currentCanvas(), "electronics");
  });
  assert.equal(currentCanvas(), DEFAULT_CANVAS, "블록을 벗어나면 원복");
});

test("중첩 시 안쪽이 이긴다", () => {
  withCanvas("a", () => {
    withCanvas("b", () => assert.equal(currentCanvas(), "b"));
    assert.equal(currentCanvas(), "a", "안쪽 블록 종료 후 바깥 복귀");
  });
});

test("await 경계를 넘어도 컨텍스트가 유지된다", async () => {
  await withCanvas("electronics", async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(currentCanvas(), "electronics");
    await Promise.all([
      (async () => {
        await new Promise((r) => setTimeout(r, 1));
        assert.equal(currentCanvas(), "electronics", "병렬 분기에서도 유지");
      })(),
    ]);
  });
});

test("동시에 다른 캔버스가 서로 섞이지 않는다", async () => {
  const seen: string[] = [];
  await Promise.all([
    withCanvas("a", async () => {
      await new Promise((r) => setTimeout(r, 10));
      seen.push(currentCanvas());
    }),
    withCanvas("b", async () => {
      await new Promise((r) => setTimeout(r, 1));
      seen.push(currentCanvas());
    }),
  ]);
  assert.deepEqual(seen.sort(), ["a", "b"]);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test --experimental-strip-types lib/canvas-context.test.ts`
Expected: FAIL — `Cannot find module ... canvas-context.ts`

- [ ] **Step 3: 최소 구현**

`lib/canvas-context.ts`:

```ts
// lib/canvas-context.ts — 요청별 "현재 캔버스" 컨텍스트.
// store 공개 시그니처를 바꾸지 않고 캔버스를 전파하기 위한 장치(호출부 276곳 무변경).
// 라우트 진입점에서 withCanvas() 로 한 번 깔면 그 아래 모든 동기·비동기 호출이 같은 캔버스를 본다.
// 설계: docs/superpowers/specs/2026-07-20-multi-canvas-design.md §4
import { AsyncLocalStorage } from "node:async_hooks";

/** 부트스트랩 캔버스 id. 기존(램프 FMEA) 데이터가 귀속되는 곳. */
export const DEFAULT_CANVAS = "default";

const ALS = new AsyncLocalStorage<string>();

/** fn 실행 동안 현재 캔버스를 id 로 고정한다. 중첩 가능(안쪽이 이김). */
export function withCanvas<T>(id: string, fn: () => T): T {
  return ALS.run(id, fn);
}

/** 현재 캔버스 id. 컨텍스트 밖이면 기본 캔버스로 폴백한다.
 * 폴백은 테스트·모듈로드 경로를 위한 것이며, 라우트에서 일어나면 버그다 — 개발 모드에서 경고한다. */
export function currentCanvas(): string {
  const id = ALS.getStore();
  if (id) return id;
  if (process.env.NODE_ENV === "development") {
    console.warn("[canvas] 컨텍스트 밖에서 캔버스 조회 — 기본 캔버스로 폴백\n" + new Error().stack);
  }
  return DEFAULT_CANVAS;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test --experimental-strip-types lib/canvas-context.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: 전체 테스트로 회귀 확인**

Run: `npm test`
Expected: `tests 122 / pass 115 / fail 0` (기존 117 + 신규 5)

- [ ] **Step 6: 커밋**

```bash
git add lib/canvas-context.ts lib/canvas-context.test.ts
git commit -m "feat(canvas): 요청별 캔버스 컨텍스트 — AsyncLocalStorage"
```

---

## Task 2: DB 마이그레이션 + `lib/db.ts` 캔버스 인지

**Files:**
- Create: `lib/db/migrations/001-canvas.sql`
- Modify: `lib/db/schema.sql` (신규 설치용 `canvases` 테이블 + `canvas_id` 컬럼)
- Modify: `lib/db.ts:40-47` (`doReady`), `:51-88` (`seedMetamodel`), `:91-100` (`loadMetamodel`), `:245-260` (`loadAll`), `:263-337` (write-through 프리미티브)

**Interfaces:**
- Consumes: `DEFAULT_CANVAS` (Task 1)
- Produces:
  - `seedMetamodel(p: Pool, canvasId: string): Promise<void>`
  - `loadAll()` / `loadMetamodel()` / `nodeCount()` — 시그니처 불변, 내부에서 `currentCanvas()` 사용
  - `canvasRows(includeDeleted: boolean): Promise<CanvasRow[]>`
  - `insertCanvas(id, name, description)` / `updateCanvas(id, patch)` / `softDeleteCanvas(id)` / `restoreCanvas(id)` / `purgeCanvas(id)`
  - `type CanvasRow = { id: string; name: string; description: string | null; created_at: Date; deleted_at: Date | null }`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`lib/db/migrations/001-canvas.sql`:

```sql
-- 001-canvas.sql — 단일 온톨로지 → 다중 캔버스. 단방향(되돌리기 스크립트 없음, 회수는 DB 백업).
-- 호출자(lib/db.ts doReady)가 canvases 테이블 부재를 확인한 뒤 단일 트랜잭션으로 실행한다.
-- 기존 데이터는 전부 'default'(램프) 캔버스로 귀속만 한다 — 값 변경·삭제 없음(골든 룰 3).

CREATE TABLE canvases (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

INSERT INTO canvases (id, name, description)
VALUES ('default', '램프', 'SL 자동차 램프 FMEA — 기존 베이스라인');

-- ── 컬럼 추가 → 기존 행 귀속 → NOT NULL 승격 ──
ALTER TABLE nodes           ADD COLUMN canvas_id TEXT;
ALTER TABLE edges           ADD COLUMN canvas_id TEXT;
ALTER TABLE sources         ADD COLUMN canvas_id TEXT;
ALTER TABLE object_types    ADD COLUMN canvas_id TEXT;
ALTER TABLE relation_types  ADD COLUMN canvas_id TEXT;
ALTER TABLE object_subtypes ADD COLUMN canvas_id TEXT;
ALTER TABLE property_defs   ADD COLUMN canvas_id TEXT;
ALTER TABLE meta            ADD COLUMN canvas_id TEXT;
ALTER TABLE change_log      ADD COLUMN canvas_id TEXT;
ALTER TABLE ai_opinions     ADD COLUMN canvas_id TEXT;

UPDATE nodes           SET canvas_id = 'default';
UPDATE edges           SET canvas_id = 'default';
UPDATE sources         SET canvas_id = 'default';
UPDATE object_types    SET canvas_id = 'default';
UPDATE relation_types  SET canvas_id = 'default';
UPDATE object_subtypes SET canvas_id = 'default';
UPDATE property_defs   SET canvas_id = 'default';
UPDATE meta            SET canvas_id = 'default';
UPDATE change_log      SET canvas_id = 'default';
UPDATE ai_opinions     SET canvas_id = 'default';

ALTER TABLE nodes           ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE edges           ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE sources         ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE object_types    ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE relation_types  ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE object_subtypes ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE property_defs   ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE meta            ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE change_log      ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE ai_opinions     ALTER COLUMN canvas_id SET NOT NULL;

-- ── 기존 PK/FK 드롭 (의존 순서: 자식 먼저) ──
ALTER TABLE property_defs   DROP CONSTRAINT property_defs_pkey;
ALTER TABLE property_defs   DROP CONSTRAINT property_defs_type_id_fkey;
ALTER TABLE object_subtypes DROP CONSTRAINT object_subtypes_pkey;
ALTER TABLE object_subtypes DROP CONSTRAINT object_subtypes_type_id_fkey;
ALTER TABLE edges           DROP CONSTRAINT edges_pkey;
ALTER TABLE edges           DROP CONSTRAINT edges_src_fkey;
ALTER TABLE edges           DROP CONSTRAINT edges_dst_fkey;
ALTER TABLE nodes           DROP CONSTRAINT nodes_pkey;
ALTER TABLE sources         DROP CONSTRAINT sources_pkey;
ALTER TABLE object_types    DROP CONSTRAINT object_types_pkey;
ALTER TABLE relation_types  DROP CONSTRAINT relation_types_pkey;
ALTER TABLE meta            DROP CONSTRAINT meta_pkey;

-- ── 복합 PK 재생성 ──
ALTER TABLE nodes           ADD PRIMARY KEY (canvas_id, id);
ALTER TABLE edges           ADD PRIMARY KEY (canvas_id, src, rel, dst);
ALTER TABLE sources         ADD PRIMARY KEY (canvas_id, file);
ALTER TABLE object_types    ADD PRIMARY KEY (canvas_id, type_id);
ALTER TABLE relation_types  ADD PRIMARY KEY (canvas_id, rel_id);
ALTER TABLE object_subtypes ADD PRIMARY KEY (canvas_id, type_id, st_id);
ALTER TABLE property_defs   ADD PRIMARY KEY (canvas_id, type_id, key);
ALTER TABLE meta            ADD PRIMARY KEY (canvas_id, key);

-- ── FK 재생성 ──
ALTER TABLE nodes           ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE sources         ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE object_types    ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE relation_types  ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE meta            ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE change_log      ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;
ALTER TABLE ai_opinions     ADD FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE;

ALTER TABLE edges           ADD FOREIGN KEY (canvas_id, src) REFERENCES nodes(canvas_id, id) ON DELETE CASCADE;
ALTER TABLE edges           ADD FOREIGN KEY (canvas_id, dst) REFERENCES nodes(canvas_id, id) ON DELETE CASCADE;
ALTER TABLE object_subtypes ADD FOREIGN KEY (canvas_id, type_id) REFERENCES object_types(canvas_id, type_id) ON DELETE CASCADE;
ALTER TABLE property_defs   ADD FOREIGN KEY (canvas_id, type_id) REFERENCES object_types(canvas_id, type_id) ON DELETE CASCADE;
```

> **주의**: 제약 이름(`nodes_pkey` 등)은 Postgres 기본 명명 규칙을 따른 것이다. 적용 전
> `\d nodes` 로 실제 이름을 확인한다. 다르면 SQL 의 이름을 실제 값으로 바꾼다.

- [ ] **Step 2: `schema.sql` 에 신규 설치 경로 반영**

`lib/db/schema.sql` — 기존 `CREATE TABLE IF NOT EXISTS` 정의를 캔버스 인지 형태로 바꾼다.
`canvases` 를 맨 앞에 추가하고, 각 테이블에 `canvas_id TEXT NOT NULL` 컬럼과 복합 PK/FK 를
위 마이그레이션과 **동일한 형태**로 넣는다. (신규 DB 는 마이그레이션을 타지 않고 이 파일만으로
최종 형태가 되어야 한다.)

`canvases` 정의를 `CREATE EXTENSION` 바로 다음에 넣는다:

```sql
-- ⓪ 캔버스 — 도메인(부서/제품군)별 격리 단위. 모든 데이터·스키마가 여기에 귀속된다.
CREATE TABLE IF NOT EXISTS canvases (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
```

- [ ] **Step 3: `doReady()` 에 마이그레이션 + 부트스트랩 분기**

`lib/db.ts:40-47` 을 교체:

```ts
async function doReady(): Promise<void> {
  const p = getPool();
  // cwd 기준 경로 — Next standalone(cwd=/app, Dockerfile 이 lib/db 복사)·테스트(cwd=repo root) 양쪽 안전.
  const dbDir = path.join(process.cwd(), "lib", "db");

  // 기존 DB(캔버스 이전 버전)면 마이그레이션 먼저 — schema.sql 은 복합 PK 를 전제하므로 순서가 중요.
  const legacy = await p.query<{ exists: boolean }>(
    `SELECT to_regclass('public.nodes') IS NOT NULL AND to_regclass('public.canvases') IS NULL AS exists`
  );
  if (legacy.rows[0]?.exists) {
    const sql = fs.readFileSync(path.join(dbDir, "migrations", "001-canvas.sql"), "utf8");
    await tx(async (c) => { await c.query(sql); }); // 단일 트랜잭션 — 실패 시 부분 적용 없음
    console.log("[db] 001-canvas 마이그레이션 적용 — 기존 데이터를 'default' 캔버스로 귀속");
  }

  await p.query(fs.readFileSync(path.join(dbDir, "schema.sql"), "utf8"));

  // 부트스트랩: 캔버스가 하나도 없는 완전 신규 DB 에만 default 캔버스 + FMEA 메타모델 시드.
  // 사용자가 만드는 캔버스는 빈 스키마로 시작한다(설계 §3.4).
  const cnt = await p.query<{ n: string }>("SELECT count(*)::text AS n FROM canvases");
  if (cnt.rows[0].n === "0") {
    await p.query(
      `INSERT INTO canvases (id, name, description) VALUES ($1, $2, $3)`,
      [DEFAULT_CANVAS, "램프", "SL 자동차 램프 FMEA — 기본 캔버스"]
    );
    await seedMetamodel(p, DEFAULT_CANVAS);
  }
}
```

`lib/db.ts` 상단 import 에 추가:

```ts
import { DEFAULT_CANVAS, currentCanvas } from "./canvas-context";
```

- [ ] **Step 4: `seedMetamodel` 에 canvasId 인자 추가**

`lib/db.ts:51` 의 시그니처를 `async function seedMetamodel(p: Pool, canvasId: string)` 로 바꾸고,
4개 INSERT 전부에 `canvas_id` 를 첫 컬럼으로 추가한다. 예(`object_types`):

```ts
await p.query(
  `INSERT INTO object_types (canvas_id, type_id, label_ko, color, icon, description)
   VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (canvas_id, type_id) DO NOTHING`,
  [canvasId, t.type_id, t.label_ko, t.color, t.icon, t.description]
);
```

나머지 3개(`relation_types` · `object_subtypes` · `property_defs`)도 같은 방식으로 바꾼다.
`ON CONFLICT` 절의 키에도 `canvas_id` 를 포함한다. `relation_types` 의 domain/range UPDATE 문에도
`AND canvas_id = $4` 를 추가한다.

- [ ] **Step 5: 읽기 쿼리에 canvas_id 조건 추가**

`loadAll()`(`lib/db.ts:245`), `loadMetamodel()`(`:91`), `nodeCount()`(`:102`),
`getSourceContent()`(`:108`), `nodesMissingEmbedding()`(`:359`), `nearestSameTypePairs()`(`:372`),
`semanticSearch()`(`:392`), `getAiOpinion()`(`:420`) 전부에 `WHERE canvas_id = $n` 을 추가한다.
값은 `currentCanvas()` 에서 얻는다. `loadAll()` 예:

```ts
export async function loadAll(): Promise<{ nodes: Node[]; edges: Edge[]; sources: SourceInfo[]; activeDrawing: string | null }> {
  const p = getPool();
  const cv = currentCanvas();
  const [nodesR, edgesR, sourcesR, metaR] = await Promise.all([
    p.query<NodeRow>("SELECT id, type, label, props FROM nodes WHERE canvas_id = $1", [cv]),
    p.query<EdgeRow>("SELECT src, rel, dst, props FROM edges WHERE canvas_id = $1", [cv]),
    p.query<SourceRow>("SELECT file, kind, meta FROM sources WHERE canvas_id = $1", [cv]),
    p.query<{ value: unknown }>("SELECT value FROM meta WHERE canvas_id = $1 AND key = 'active_drawing'", [cv]),
  ]);
  const activeDrawing = metaR.rows.length ? (metaR.rows[0].value as string) : null;
  return {
    nodes: nodesR.rows.map(rowToNode),
    edges: edgesR.rows.map(rowToEdge),
    sources: sourcesR.rows.map(rowToSource),
    activeDrawing,
  };
}
```

- [ ] **Step 6: 쓰기 쿼리에 canvas_id 추가**

`insertNode` · `insertEdge` · `upsertSourceOn` · `persistDeleteNode` · `persistDeleteEdge` ·
`persistMergeNodes` · `persistMeta` · `persistSubtypeAssignments` · `setEmbedding` ·
`saveAiOpinion` · `logChangeOn` 전부. 예(`persistDeleteNode`):

```ts
export async function persistDeleteNode(id: string): Promise<void> {
  const cv = currentCanvas();
  await tx(async (c) => {
    await c.query("DELETE FROM nodes WHERE canvas_id = $1 AND id = $2", [cv, id]); // 엣지 CASCADE
    await logChangeOn(c, "curate.delete", { ids: [id], summary: `노드 삭제 ${id}` }, cv);
  });
}
```

`logChangeOn` 은 `canvasId` 를 마지막 인자로 받도록 시그니처를 넓힌다:

```ts
async function logChangeOn(c: Queryable, op: string, payload: unknown, canvasId = currentCanvas()): Promise<void> {
  await c.query(
    `INSERT INTO change_log (canvas_id, op, payload) VALUES ($1, $2, $3::jsonb)`,
    [canvasId, op, JSON.stringify(payload)]
  );
}
```

- [ ] **Step 7: 캔버스 행 CRUD 헬퍼 추가**

`lib/db.ts` 끝에 추가:

```ts
/* ────────────────────────── 캔버스 행 CRUD ────────────────────────── */

export interface CanvasRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

/** 캔버스 목록 + 각 캔버스의 노드·문서 수. includeDeleted=true 면 휴지통만. */
export async function canvasRows(includeDeleted = false): Promise<(CanvasRow & { nodeCount: number; docCount: number })[]> {
  const r = await getPool().query<CanvasRow & { node_count: string; doc_count: string }>(
    `SELECT c.id, c.name, c.description, c.created_at, c.deleted_at,
            (SELECT count(*) FROM nodes   n WHERE n.canvas_id = c.id)::text AS node_count,
            (SELECT count(*) FROM sources s WHERE s.canvas_id = c.id)::text AS doc_count
       FROM canvases c
      WHERE c.deleted_at IS ${includeDeleted ? "NOT" : ""} NULL
      ORDER BY c.created_at`
  );
  return r.rows.map((x) => ({
    id: x.id, name: x.name, description: x.description,
    created_at: x.created_at, deleted_at: x.deleted_at,
    nodeCount: Number(x.node_count), docCount: Number(x.doc_count),
  }));
}

export async function insertCanvas(id: string, name: string, description: string | null): Promise<void> {
  await getPool().query(
    `INSERT INTO canvases (id, name, description) VALUES ($1,$2,$3)`,
    [id, name, description]
  );
}

export async function updateCanvas(id: string, name: string, description: string | null): Promise<void> {
  await getPool().query(`UPDATE canvases SET name = $2, description = $3 WHERE id = $1`, [id, name, description]);
}

export async function softDeleteCanvas(id: string): Promise<void> {
  await getPool().query(`UPDATE canvases SET deleted_at = now() WHERE id = $1`, [id]);
}

export async function restoreCanvas(id: string): Promise<void> {
  await getPool().query(`UPDATE canvases SET deleted_at = NULL WHERE id = $1`, [id]);
}

/** 영구 삭제 — 노드·엣지·문서·스키마가 CASCADE 로 함께 사라진다. */
export async function purgeCanvas(id: string): Promise<void> {
  await getPool().query(`DELETE FROM canvases WHERE id = $1`, [id]);
}
```

- [ ] **Step 8: 타입체크 + 전체 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 에러 0 · `fail 0` (DB 없는 환경이라 기존 테스트는 인메모리 경로로 통과)

- [ ] **Step 9: 커밋**

```bash
git add lib/db/migrations/001-canvas.sql lib/db/schema.sql lib/db.ts
git commit -m "feat(db): 캔버스 스코핑 — 복합 PK 승격 + 001-canvas 마이그레이션"
```

---

## Task 3: `lib/store.ts` 캔버스별 캐시

공개 시그니처는 하나도 바뀌지 않는다. 모듈 레벨 변수를 `CanvasCache` 로 묶고 `cache()` 가
현재 캔버스 것을 돌려주게만 바꾼다. **호출부 276곳은 무변경이다.**

**Files:**
- Modify: `lib/store.ts` (전면)
- Test: `lib/store.test.ts` (신규)

**Interfaces:**
- Consumes: `currentCanvas` / `DEFAULT_CANVAS` (Task 1), `lib/db.ts` 캔버스 인지 함수 (Task 2)
- Produces: 기존 공개 API 전부 시그니처 불변 — `ready` · `getMetamodel` · `mergeDelta` · `registerSource` · `getRuntimeSources` · `removeEdge` · `removeNode` · `mergeNodes` · `setActiveDrawing` · `getActiveDrawing` · `getNode` · `allNodes` · `allEdges` · `outEdges` · `inEdges` · `deg` · `neighbors` · `evidenceOf` · `getGraph` · `getObject`
- 신규: `dropCanvasCache(canvasId: string): void` — 캔버스 삭제·스키마 변경 시 캐시 무효화

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`lib/store.test.ts`:

```ts
// lib/store.test.ts — 캔버스 간 격리 (`node --test --experimental-strip-types`).
// DATABASE_URL 없는 인메모리 모드 전제 — DB 모드 격리는 수동 검증(계획 §Task 3 Step 6).
// resolve 훅 패턴은 lib/graph-memo.test.ts 상단과 동일.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const { withCanvas } = await import("./canvas-context.ts");
const store = await import("./store.ts");
type Node = import("./types").Node;

const N = (id: string, label: string): Node => ({ id, type: "item", label, props: [] });

test("캔버스 A 에 넣은 노드는 B 에서 보이지 않는다", async () => {
  await withCanvas("cv-a", () => store.mergeDelta([N("X1", "A의 노드")], []));
  assert.ok(withCanvas("cv-a", () => store.getNode("X1")), "A 에서는 보임");
  assert.equal(withCanvas("cv-b", () => store.getNode("X1")), undefined, "B 에서는 안 보임");
});

test("같은 id 노드가 두 캔버스에 서로 다른 내용으로 공존한다", async () => {
  await withCanvas("cv-c", () => store.mergeDelta([N("ILENS", "아우터 렌즈")], []));
  await withCanvas("cv-d", () => store.mergeDelta([N("ILENS", "전장 커넥터")], []));
  assert.equal(withCanvas("cv-c", () => store.getNode("ILENS")!.label), "아우터 렌즈");
  assert.equal(withCanvas("cv-d", () => store.getNode("ILENS")!.label), "전장 커넥터");
});

test("엣지도 캔버스별로 격리된다", async () => {
  await withCanvas("cv-e", () =>
    store.mergeDelta([N("P", "부품"), N("Q", "고장")], [{ src: "P", rel: "HAS_FAILURE", dst: "Q" }])
  );
  assert.equal(withCanvas("cv-e", () => store.outEdges("P").length), 1);
  assert.equal(withCanvas("cv-f", () => store.outEdges("P").length), 0);
});

test("삭제도 해당 캔버스에만 적용된다", async () => {
  await withCanvas("cv-g", () => store.mergeDelta([N("Z", "지울 것")], []));
  await withCanvas("cv-h", () => store.mergeDelta([N("Z", "남을 것")], []));
  await withCanvas("cv-g", () => store.removeNode("Z"));
  assert.equal(withCanvas("cv-g", () => store.getNode("Z")), undefined);
  assert.equal(withCanvas("cv-h", () => store.getNode("Z")!.label), "남을 것");
});

test("dropCanvasCache 후 그 캔버스는 비어 있다", async () => {
  await withCanvas("cv-i", () => store.mergeDelta([N("T", "임시")], []));
  assert.ok(withCanvas("cv-i", () => store.getNode("T")));
  store.dropCanvasCache("cv-i");
  assert.equal(withCanvas("cv-i", () => store.getNode("T")), undefined);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test --experimental-strip-types lib/store.test.ts`
Expected: FAIL — 첫 테스트에서 `getNode("X1")` 가 B 에서도 보임(현재는 전역 1벌)

- [ ] **Step 3: 모듈 레벨 상태를 `CanvasCache` 로 묶는다**

`lib/store.ts:55-67` 의 인메모리 인덱스 블록을 교체:

```ts
// ── 캔버스별 인메모리 인덱스 ──
// 기존에는 모듈 레벨 1벌이었다. 다중 캔버스에서는 캔버스마다 1벌이며,
// 공개 함수는 시그니처를 유지한 채 cache() 로 현재 캔버스 것을 집는다(호출부 276곳 무변경).
interface CanvasCache {
  nodes: Node[];
  edges: Edge[];
  byId: Map<string, Node>;
  outMap: Map<string, Edge[]>;
  inMap: Map<string, Edge[]>;
  degree: Map<string, number>;
  edgeKeySet: Set<string>;
  sources: SourceInfo[];
  activeDrawing: string | null;
  metamodel: Metamodel;
  lastSyncAt: number;
  readyPromise?: Promise<void>;
  syncInFlight?: Promise<void>;
}

const EMPTY_METAMODEL: Metamodel = { objectTypes: [], relationTypes: [], subtypes: [], propertyDefs: [] };

function newCache(canvasId: string): CanvasCache {
  return {
    nodes: [], edges: [],
    byId: new Map(), outMap: new Map(), inMap: new Map(), degree: new Map(),
    edgeKeySet: new Set(),
    sources: [], activeDrawing: null,
    // 부트스트랩 캔버스는 FMEA 시드가 기본값(기존 동작 유지). 사용자 캔버스는 빈 스키마.
    metamodel: canvasId === DEFAULT_CANVAS
      ? { objectTypes: OBJECT_TYPES, relationTypes: RELATION_TYPES, subtypes: OBJECT_SUBTYPES, propertyDefs: PROPERTY_DEFS }
      : EMPTY_METAMODEL,
    lastSyncAt: 0,
  };
}

const CACHES = new Map<string, CanvasCache>();

function cache(): CanvasCache {
  const id = currentCanvas();
  let c = CACHES.get(id);
  if (!c) { c = newCache(id); CACHES.set(id, c); }
  return c;
}

/** 캔버스 캐시 폐기 — 캔버스 삭제·스키마 변경 후 다음 요청이 DB 에서 다시 읽게 한다. */
export function dropCanvasCache(canvasId: string): void {
  CACHES.delete(canvasId);
}

// ponytail: 캔버스 캐시 전량 상주. 캔버스가 수백 개 되거나 캔버스당 노드가 수만 되면 LRU 축출로 교체.
```

`lib/store.ts` 상단 import 에 추가:

```ts
import { currentCanvas, DEFAULT_CANVAS } from "./canvas-context";
```

- [ ] **Step 4: 나머지 함수를 `cache()` 경유로 바꾼다**

모듈 레벨 변수를 직접 쓰던 곳을 전부 `const c = cache();` 로 시작해 `c.byId` · `c.nodes` 형태로
바꾼다. 대상: `push`(인자로 map 을 받으므로 무변경) · `rebuildIndex` · `syncFromDb` · `ready` ·
`hydrate` · `mergeDelta` · `registerSource` · `getRuntimeSources` · `dropEdge` · `removeEdge` ·
`removeNode` · `mergeNodes` · `setActiveDrawing` · `getActiveDrawing` · `getNode` · `allNodes` ·
`allEdges` · `outEdges` · `inEdges` · `deg` · `neighbors` · `evidenceOf` · `getGraph` · `getObject` ·
`getMetamodel`.

`rebuildIndex` 는 대상 캐시를 인자로 받게 바꾼다:

```ts
function rebuildIndex(c: CanvasCache, nodes: Node[], edges: Edge[]) {
  c.nodes = [...nodes];
  c.edges = [];
  c.byId.clear(); c.outMap.clear(); c.inMap.clear(); c.degree.clear(); c.edgeKeySet.clear();
  for (const n of c.nodes) c.byId.set(n.id, n);
  for (const e of edges) {
    const key = `${e.src}|${e.rel}|${e.dst}`;
    if (c.edgeKeySet.has(key)) continue;
    c.edgeKeySet.add(key);
    if (!c.byId.has(e.src) || !c.byId.has(e.dst)) continue; // 양끝 존재 링크만(무결성)
    c.edges.push(e);
    push(c.outMap, e.src, e);
    push(c.inMap, e.dst, e);
    c.degree.set(e.src, (c.degree.get(e.src) ?? 0) + 1);
    c.degree.set(e.dst, (c.degree.get(e.dst) ?? 0) + 1);
  }
}
```

접근자 예:

```ts
export function getNode(id: string): Node | undefined { return cache().byId.get(id); }
export function allNodes(): Node[] { return [...cache().byId.values()]; }
export function allEdges(): Edge[] {
  const c = cache();
  return c.edges.filter((e) => c.byId.has(e.src) && c.byId.has(e.dst));
}
export function outEdges(id: string): Edge[] { return cache().outMap.get(id) ?? []; }
export function inEdges(id: string): Edge[] { return cache().inMap.get(id) ?? []; }
export function deg(id: string): number { return cache().degree.get(id) ?? 0; }
export function getMetamodel(): Metamodel { return cache().metamodel; }
export function getRuntimeSources(): SourceInfo[] { return [...cache().sources]; }
export function getActiveDrawing(): string | null { return cache().activeDrawing; }
```

- [ ] **Step 5: `ready`/`hydrate` 를 캔버스별로 바꾼다**

`readyPromise` · `syncInFlight` · `lastSyncAt` 은 캐시 안으로 들어갔다.

```ts
export function ready(): Promise<void> {
  const c = cache();
  if (!HAS_DB) {
    // 인메모리 모드: 기본 캔버스는 모듈로드에서 구축됨. 다른 캔버스는 빈 캐시로 시작(테스트 전용).
    return Promise.resolve();
  }
  const canvasId = currentCanvas();
  if (!c.readyPromise) {
    c.readyPromise = hydrate(c, canvasId).catch((e) => {
      c.readyPromise = undefined; // 실패 캐시 안 함 — 다음 요청이 재시도
      throw e;
    });
    return c.readyPromise;
  }
  if (Date.now() - c.lastSyncAt < SYNC_TTL_MS) return c.readyPromise; // TTL 내 — 스냅샷 재사용
  c.syncInFlight ??= c.readyPromise
    .then(() => withCanvas(canvasId, () => syncFromDb(c)))
    .finally(() => { c.syncInFlight = undefined; });
  return c.syncInFlight;
}
```

> **중요**: `.then()` 안은 새 마이크로태스크라 ALS 컨텍스트가 이미 벗어났을 수 있다.
> `withCanvas(canvasId, ...)` 로 명시적으로 다시 깐다. `hydrate` 내부의 `await` 뒤 DB 호출도
> 같은 이유로 `hydrate(c, canvasId)` 가 받은 id 로 `withCanvas` 를 감싼다.

`hydrate` 는 **부트스트랩 캔버스에서만** `ingestOrSeed()` 를 돌린다:

```ts
async function hydrate(c: CanvasCache, canvasId: string): Promise<void> {
  await db.ready(); // 스키마 + 마이그레이션 + 부트스트랩 시드(멱등)
  await withCanvas(canvasId, async () => {
    c.metamodel = await db.loadMetamodel();
    if ((await db.nodeCount()) === 0 && canvasId === DEFAULT_CANVAS) {
      // 부트스트랩 캔버스 최초 부팅에만 data/sources 인제스천을 DB 로 승격.
      // 사용자가 만든 빈 캔버스는 비어 있는 것이 정상이다(설계 §3.4).
      const seed = ingestOrSeed(c.metamodel);
      rebuildIndex(c, seed.nodes, seed.edges);
      c.sources = [...seed.sources];
      await db.bulkInsertGraph(c.nodes, c.edges, seed.sources);
    } else {
      const { nodes, edges, sources, activeDrawing } = await db.loadAll();
      rebuildIndex(c, nodes, edges);
      c.sources = [...sources];
      c.activeDrawing = activeDrawing;
      const assigns = classifyMissing(c.nodes, c.metamodel.subtypes);
      if (assigns.length > 0) {
        await db.persistSubtypeAssignments(assigns);
        for (const a of assigns) { const n = c.byId.get(a.id); if (n) n.st = a.st; }
        console.log(`[schema] 서브타입 백필: ${assigns.length}건 분류`);
      }
    }
    c.lastSyncAt = Date.now();
    scheduleEmbedBackfill(canvasId);
  });
}
```

`ingestOrSeed()` 는 `METAMODEL` 전역을 쓰던 것을 인자로 받게 바꾼다:
`function ingestOrSeed(metamodel: Metamodel)`. 내부 `classifyMissing(got.nodes, METAMODEL.subtypes)`
→ `classifyMissing(got.nodes, metamodel.subtypes)`.

`scheduleEmbedBackfill` 도 canvasId 를 받아 `withCanvas` 로 감싼다:

```ts
function scheduleEmbedBackfill(canvasId: string) {
  if (!HAS_DB) return;
  if (backfillRunning) { backfillAgain = true; return; }
  backfillRunning = true;
  void withCanvas(canvasId, () => backfillEmbeddings())
    .then((r) => { if (!r.skipped && r.embedded > 0) console.log(`[embed] auto-backfill: ${r.embedded}개 임베딩 생성`); })
    .catch(() => {})
    .finally(() => {
      backfillRunning = false;
      if (backfillAgain) { backfillAgain = false; scheduleEmbedBackfill(canvasId); }
    });
}
```

- [ ] **Step 6: 인메모리 모듈로드 경로를 기본 캔버스에 넣는다**

`lib/store.ts:117-122` 교체:

```ts
// DATABASE_URL 없으면 지금 즉시 인메모리 구축(기존 동작 — sync 테스트가 ready() 없이 읽는다).
// 다중 캔버스에서도 이 결과는 기본 캔버스 캐시에만 들어간다.
if (!HAS_DB) {
  const boot = newCache(DEFAULT_CANVAS);
  const seed = ingestOrSeed(boot.metamodel);
  rebuildIndex(boot, seed.nodes, seed.edges);
  boot.sources = [...seed.sources];
  CACHES.set(DEFAULT_CANVAS, boot);
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `node --test --experimental-strip-types lib/store.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 8: 전체 회귀 — 이게 핵심 관문**

Run: `npm test`
Expected: `fail 0`. 기존 117개가 전부 그대로 통과해야 한다. `currentCanvas()` 가 컨텍스트 밖에서
`DEFAULT_CANVAS` 를 돌려주므로 기존 테스트는 부트스트랩 캐시를 그대로 본다.

하나라도 실패하면 **넘어가지 말고** 원인을 고친다. 가장 흔한 원인은 캐시 경유로 바꾸다 빠뜨린
모듈 레벨 변수 참조다. `grep -nE "\b(NODES|EDGES|byId|outMap|inMap|degree|edgeKeySet|RUNTIME_SOURCES|ACTIVE_DRAWING|METAMODEL)\b" lib/store.ts`
로 잔존 참조를 찾는다.

- [ ] **Step 9: 타입체크 + 커밋**

```bash
npx tsc --noEmit
git add lib/store.ts lib/store.test.ts
git commit -m "feat(store): 캔버스별 인메모리 캐시 — 공개 시그니처 불변"
```

---

## Task 4: 라우트 래퍼 + 23개 라우트 적용

**Files:**
- Create: `lib/canvas-route.ts`
- Create: `lib/canvases.ts`
- Test: `lib/canvases.test.ts`
- Modify: `app/api/**/route.ts` 23개

**Interfaces:**
- Consumes: `withCanvas` (Task 1), `canvasRows` (Task 2)
- Produces:
  - `withCanvasRoute(req: Request, handler: () => Promise<Response>): Promise<Response>`
  - `listCanvases(includeDeleted?: boolean)` / `createCanvas(name, description)` / `renameCanvas(id, name, description)` / `deleteCanvas(id)` / `restoreCanvas(id)` / `purgeCanvas(id)`
  - `canvasExists(id: string): Promise<boolean>` / `invalidateCanvasList(): void`
  - `slugify(name: string): string`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`lib/canvases.test.ts` (DB 없이 검증 가능한 순수 규칙만):

```ts
// lib/canvases.test.ts — 캔버스 slug 생성 규칙 (`node --test --experimental-strip-types`).
// DB 를 타는 CRUD 는 수동 검증(계획 Task 4 Step 8). 여기서는 순수 함수만 다룬다.
// resolve 훅 패턴은 lib/graph-memo.test.ts 상단과 동일.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const { slugify } = await import("./canvases.ts");

test("영문·숫자는 소문자 slug 로", () => {
  assert.equal(slugify("Electronics 2"), "electronics-2");
});

test("한글은 음절을 잃지 않고 유지된다", () => {
  assert.equal(slugify("전장 부서"), "전장-부서");
});

test("연속 구분자는 하나로, 양끝 구분자는 제거", () => {
  assert.equal(slugify("  a // b  "), "a-b");
});

test("빈 결과면 canvas 로 폴백", () => {
  assert.equal(slugify("///"), "canvas");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test --experimental-strip-types lib/canvases.test.ts`
Expected: FAIL — `Cannot find module ... canvases.ts`

- [ ] **Step 3: `lib/canvases.ts` 구현**

```ts
// lib/canvases.ts — 캔버스 CRUD 도메인 로직. 라우트는 이 함수들을 부르기만 한다.
// 존재 여부는 인메모리 Set 캐시 — withCanvasRoute 가 요청마다 검사하므로 DB 왕복을 없앤다.
// ponytail: 단일 파드 전제. 멀티 레플리카가 되면 짧은 TTL 로 바꾼다.
import * as db from "./db";
import { dropCanvasCache } from "./store";
import { DEFAULT_CANVAS } from "./canvas-context";

export interface CanvasSummary {
  id: string; name: string; description: string | null;
  nodeCount: number; docCount: number; deletedAt: string | null;
}

/** 표시명 → id slug. 한글은 유지(음절 손실 없음), 그 외 비문자는 '-' 로. */
export function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return s || "canvas";
}

let existsCache: Set<string> | undefined;

export function invalidateCanvasList(): void {
  existsCache = undefined;
}

/** 활성(미삭제) 캔버스인지. 삭제된 캔버스는 false. */
export async function canvasExists(id: string): Promise<boolean> {
  if (!db.dbEnabled()) return true; // 인메모리 모드(테스트·로컬)는 캔버스 검증 없음
  if (!existsCache) existsCache = new Set((await db.canvasRows(false)).map((c) => c.id));
  return existsCache.has(id);
}

const toSummary = (r: Awaited<ReturnType<typeof db.canvasRows>>[number]): CanvasSummary => ({
  id: r.id, name: r.name, description: r.description,
  nodeCount: r.nodeCount, docCount: r.docCount,
  deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
});

export async function listCanvases(includeDeleted = false): Promise<CanvasSummary[]> {
  if (!db.dbEnabled()) {
    return [{ id: DEFAULT_CANVAS, name: "램프", description: null, nodeCount: 0, docCount: 0, deletedAt: null }];
  }
  return (await db.canvasRows(includeDeleted)).map(toSummary);
}

/** 새 캔버스 생성 — 빈 스키마. 메타모델을 시드하지 않는다(설계 §3.4). */
export async function createCanvas(name: string, description: string | null): Promise<CanvasSummary> {
  const base = slugify(name);
  const taken = new Set((await db.canvasRows(false)).concat(await db.canvasRows(true)).map((c) => c.id));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`; // id 충돌 시 접미사
  await db.insertCanvas(id, name.trim(), description);
  invalidateCanvasList();
  return { id, name: name.trim(), description, nodeCount: 0, docCount: 0, deletedAt: null };
}

export async function renameCanvas(id: string, name: string, description: string | null): Promise<void> {
  await db.updateCanvas(id, name.trim(), description);
  invalidateCanvasList();
}

/** 소프트 삭제(휴지통). 마지막 활성 캔버스는 지울 수 없다 — 앱이 빈 상태가 되면 복구 경로가 없다. */
export async function deleteCanvas(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const active = await db.canvasRows(false);
  if (active.length <= 1) return { ok: false, reason: "마지막 캔버스는 삭제할 수 없습니다" };
  if (!active.some((c) => c.id === id)) return { ok: false, reason: "존재하지 않는 캔버스입니다" };
  await db.softDeleteCanvas(id);
  invalidateCanvasList();
  dropCanvasCache(id);
  return { ok: true };
}

export async function restoreCanvas(id: string): Promise<void> {
  await db.restoreCanvas(id);
  invalidateCanvasList();
}

/** 영구 삭제 — 노드·엣지·문서·스키마가 CASCADE 로 사라진다. 되돌릴 수 없다. */
export async function purgeCanvas(id: string): Promise<void> {
  await db.purgeCanvas(id);
  invalidateCanvasList();
  dropCanvasCache(id);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test --experimental-strip-types lib/canvases.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: 라우트 래퍼 구현**

`lib/canvas-route.ts`:

```ts
// lib/canvas-route.ts — 모든 데이터 라우트의 공통 진입점.
// ?canvas 를 파싱·검증하고 그 아래 전부를 캔버스 컨텍스트 안에서 실행한다.
// 누락 라우트는 grep -L withCanvasRoute app/api/**/route.ts 로 찾는다.
import { withCanvas } from "./canvas-context";
import { canvasExists } from "./canvases";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function withCanvasRoute(
  req: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  const id = new URL(req.url).searchParams.get("canvas");
  // 기본 캔버스로 조용히 폴백하지 않는다 — 다른 부서 데이터를 잘못 보여줄 수 있다(설계 §8).
  if (!id) return json({ error: "canvas 파라미터가 필요합니다" }, 400);
  if (!(await canvasExists(id))) return json({ error: "존재하지 않는 캔버스입니다", canvas: id }, 404);
  return withCanvas(id, handler);
}
```

- [ ] **Step 6: 23개 라우트에 래퍼 적용**

각 `app/api/**/route.ts` 의 export 된 핸들러 본문을 `withCanvasRoute` 로 감싼다.
`app/api/ontology/route.ts` 예:

```ts
import { withCanvasRoute } from "@/lib/canvas-route";

export async function GET(req: Request) {
  return withCanvasRoute(req, async () => {
    // ── 기존 본문 그대로 ──
    await ready();
    // ...
  });
}
```

`req` 인자를 받지 않던 핸들러(`export async function GET()`)는 `(req: Request)` 를 추가한다.

**대상 23개** (`app/api/` 하위):
`ask` · `bom-check` · `condensation` · `contradictions` · `curate` · `design-options` ·
`drawing-input` · `drawing-svg` · `fmea-draft` · `infer` · `ingest` · `nlsearch` ·
`object/[id]` · `ontology` · `ontology/export` · `quality` · `reason` · `review-opinion` ·
`schema` · `search` · `source-text` · `sources` · `admin/embed-backfill`

- [ ] **Step 7: 누락 라우트 확인**

Run:

```bash
grep -L "withCanvasRoute" $(find app/api -name route.ts) 2>/dev/null
```

Expected: `app/api/canvases/...` 를 제외하고 아무것도 출력되지 않음 (Task 5 에서 생기는 캔버스
관리 라우트는 래퍼를 쓰지 않는다). 이 시점에는 `canvases` 라우트가 아직 없으므로 **빈 출력**이어야 한다.

- [ ] **Step 8: 클라이언트 fetch 헬퍼 + 컴포넌트 배선**

`lib/api-client.ts`:

```ts
// lib/api-client.ts — 클라이언트 전용. 모든 API 호출에 현재 캔버스를 붙인다.
// 컴포넌트가 fetch 를 직접 부르면 캔버스가 빠져 400 이 난다 — 반드시 이 헬퍼를 쓴다.
let CURRENT = "default";

export function setApiCanvas(id: string): void { CURRENT = id; }
export function getApiCanvas(): string { return CURRENT; }

/** 캔버스 파라미터가 붙은 URL. 이미 canvas 가 있으면 유지한다. */
export function withCanvasUrl(path: string): string {
  const u = new URL(path, typeof window === "undefined" ? "http://localhost" : window.location.origin);
  if (!u.searchParams.has("canvas")) u.searchParams.set("canvas", CURRENT);
  return u.pathname + u.search;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(withCanvasUrl(path), init);
}
```

`components/` 안의 `fetch("/api/...")` 호출을 전부 `apiFetch("/api/...")` 로 바꾼다.
대상 확인:

```bash
grep -rn 'fetch("/api/' components/ | grep -v apiFetch
```

`<a href="/api/ontology/export">` 같은 링크·폼 액션은 `withCanvasUrl()` 로 감싼다.

- [ ] **Step 9: 빌드 + 전체 테스트**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: 타입 에러 0 · `fail 0` · 빌드 성공

- [ ] **Step 10: 커밋**

```bash
git add lib/canvas-route.ts lib/canvases.ts lib/canvases.test.ts lib/api-client.ts app/api components
git commit -m "feat(canvas): 라우트 래퍼 + 23개 라우트 캔버스 스코핑"
```

---

## Task 5: 캔버스 관리 API

**Files:**
- Create: `app/api/canvases/route.ts`
- Create: `app/api/canvases/[id]/route.ts`
- Create: `app/api/canvases/[id]/restore/route.ts`

**Interfaces:**
- Consumes: `listCanvases` · `createCanvas` · `renameCanvas` · `deleteCanvas` · `restoreCanvas` · `purgeCanvas` (Task 4)
- Produces: HTTP 계약
  - `GET /api/canvases` → `{ canvases: CanvasSummary[] }`, `?trash=1` 이면 휴지통
  - `POST /api/canvases` `{name, description?}` → `{ canvas: CanvasSummary }` (201)
  - `PATCH /api/canvases/[id]` `{name, description?}` → `{ ok: true }`
  - `DELETE /api/canvases/[id]` → `{ ok: true }` · 마지막이면 409
  - `DELETE /api/canvases/[id]?purge=1` → `{ ok: true }`
  - `POST /api/canvases/[id]/restore` → `{ ok: true }`

**이 라우트들은 `withCanvasRoute` 를 쓰지 않는다** — 캔버스 자체를 다루므로 캔버스 컨텍스트가 없다.

- [ ] **Step 1: 목록·생성 라우트**

`app/api/canvases/route.ts`:

```ts
// GET  /api/canvases        — 활성 캔버스 목록(+ 노드·문서 수). ?trash=1 이면 휴지통.
// POST /api/canvases        — 생성 { name, description? }. 빈 스키마로 시작(설계 §3.4).
// 캔버스 자체를 다루므로 withCanvasRoute 를 쓰지 않는다.
import { NextResponse } from "next/server";
import { z } from "zod";
import * as db from "@/lib/db";
import { listCanvases, createCanvas } from "@/lib/canvases";

export const runtime = "nodejs";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional(),
});

export async function GET(req: Request) {
  await db.ready();
  const trash = new URL(req.url).searchParams.get("trash") === "1";
  return NextResponse.json({ canvases: await listCanvases(trash) });
}

export async function POST(req: Request) {
  await db.ready();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const canvas = await createCanvas(parsed.data.name, parsed.data.description ?? null);
  return NextResponse.json({ canvas }, { status: 201 });
}
```

- [ ] **Step 2: 이름변경·삭제 라우트**

`app/api/canvases/[id]/route.ts`:

```ts
// PATCH  /api/canvases/[id]           — 표시명·설명 변경
// DELETE /api/canvases/[id]           — 소프트 삭제(휴지통). 마지막 활성 캔버스면 409.
// DELETE /api/canvases/[id]?purge=1   — 영구 삭제(노드·엣지·문서·스키마 CASCADE).
import { NextResponse } from "next/server";
import { z } from "zod";
import * as db from "@/lib/db";
import { renameCanvas, deleteCanvas, purgeCanvas } from "@/lib/canvases";

export const runtime = "nodejs";

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await db.ready();
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }
  await renameCanvas(id, parsed.data.name, parsed.data.description ?? null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await db.ready();
  const { id } = await ctx.params;
  if (new URL(req.url).searchParams.get("purge") === "1") {
    await purgeCanvas(id);
    return NextResponse.json({ ok: true });
  }
  const r = await deleteCanvas(id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 복구 라우트**

`app/api/canvases/[id]/restore/route.ts`:

```ts
// POST /api/canvases/[id]/restore — 휴지통에서 복구(deleted_at = NULL).
import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { restoreCanvas } from "@/lib/canvases";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await db.ready();
  const { id } = await ctx.params;
  await restoreCanvas(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: 빌드 + 수동 검증**

Run: `npm run build && npm run dev`

별도 터미널에서:

```bash
curl -s localhost:3000/api/canvases | head -c 300
curl -s -X POST localhost:3000/api/canvases -H 'content-type: application/json' -d '{"name":"전장"}'
curl -s localhost:3000/api/canvases | head -c 400
curl -s -X DELETE localhost:3000/api/canvases/전장 -w '\n%{http_code}\n'
```

Expected: 목록에 `default`(램프) → 생성 후 `전장` 추가(201) → 삭제 200. `default` 하나만 남은
상태에서 `DELETE /api/canvases/default` 는 **409**.

- [ ] **Step 5: 커밋**

```bash
git add app/api/canvases
git commit -m "feat(canvas): 캔버스 관리 API — 목록·생성·이름변경·소프트삭제·복구·영구삭제"
```

---

## Task 6: 기능 가용성 파생

**Files:**
- Create: `lib/capabilities.ts`
- Test: `lib/capabilities.test.ts`
- Modify: `app/api/schema/route.ts`
- Modify: `app/api/infer/route.ts` · `fmea-draft` · `contradictions` · `bom-check` · `condensation` (서버 방어)

**Interfaces:**
- Consumes: `getMetamodel()` (Task 3)
- Produces:
  - `type Capability = "infer" | "fmeaDraft" | "contradictions" | "bomCheck" | "condensation"`
  - `capabilities(m: Metamodel, canvasId: string): Record<Capability, boolean>`
  - `requireCapability(cap: Capability): Response | null`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`lib/capabilities.test.ts`:

```ts
// lib/capabilities.test.ts — 스키마에서 유도한 기능 가용성 (`node --test --experimental-strip-types`).
// resolve 훅 패턴은 lib/graph-memo.test.ts 상단과 동일.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const { capabilities } = await import("./capabilities.ts");
type Metamodel = import("./db/seed-metamodel").Metamodel;

const mm = (typeIds: string[]): Metamodel => ({
  objectTypes: typeIds.map((t) => ({ type_id: t, label_ko: t, color: null, icon: null, description: null })),
  relationTypes: [],
  subtypes: [],
  propertyDefs: [],
});

test("타입이 하나도 없으면 전부 false", () => {
  const c = capabilities(mm([]), "electronics");
  assert.equal(c.infer, false);
  assert.equal(c.fmeaDraft, false);
  assert.equal(c.contradictions, false);
  assert.equal(c.bomCheck, false);
});

test("FMEA 전체 타입이 있으면 전부 true", () => {
  const c = capabilities(mm(["fm", "cause", "item", "action", "reg"]), "default");
  assert.equal(c.infer, true);
  assert.equal(c.fmeaDraft, true);
  assert.equal(c.contradictions, true);
  assert.equal(c.bomCheck, true);
});

test("일부만 있으면 해당 기능만 true", () => {
  const c = capabilities(mm(["item"]), "electronics");
  assert.equal(c.bomCheck, true, "item 만 있으면 BOM 검사는 가능");
  assert.equal(c.infer, false, "fm·cause 가 없으므로 추론 불가");
});

test("condensation 은 기본 캔버스 전용", () => {
  const full = ["fm", "cause", "item", "action", "reg"];
  assert.equal(capabilities(mm(full), "default").condensation, true);
  assert.equal(capabilities(mm(full), "electronics").condensation, false, "노드 id 하드코딩이라 타 캔버스 불가");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test --experimental-strip-types lib/capabilities.test.ts`
Expected: FAIL — `Cannot find module ... capabilities.ts`

- [ ] **Step 3: 구현**

`lib/capabilities.ts`:

```ts
// lib/capabilities.ts — "이 캔버스에서 이 기능이 의미가 있는가"를 스키마에서 유도한다.
// 설정값이 아니라 파생값이다 — 스키마를 고치면 가용성이 자동으로 따라온다(설계 §5).
import type { Metamodel } from "./db/seed-metamodel";
import { DEFAULT_CANVAS } from "./canvas-context";

export type Capability = "infer" | "fmeaDraft" | "contradictions" | "bomCheck" | "condensation";

/** 각 기능이 동작하려면 반드시 있어야 하는 객체타입. */
const REQUIRES: Record<Exclude<Capability, "condensation">, string[]> = {
  infer: ["fm", "cause", "item"],
  fmeaDraft: ["fm", "action"],
  contradictions: ["fm", "reg"],
  bomCheck: ["item"],
};

export function capabilities(m: Metamodel, canvasId: string): Record<Capability, boolean> {
  const have = new Set(m.objectTypes.map((t) => t.type_id));
  const ok = (need: string[]) => need.every((t) => have.has(t));
  return {
    infer: ok(REQUIRES.infer),
    fmeaDraft: ok(REQUIRES.fmeaDraft),
    contradictions: ok(REQUIRES.contradictions),
    bomCheck: ok(REQUIRES.bomCheck),
    // 결로 시나리오는 노드 id(ILENS·FMFOG)를 하드코딩한다 — 일반화 전까지 기본 캔버스 전용.
    condensation: canvasId === DEFAULT_CANVAS,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test --experimental-strip-types lib/capabilities.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: `/api/schema` 응답에 capabilities 추가**

`app/api/schema/route.ts` 의 응답 객체에 추가:

```ts
import { capabilities } from "@/lib/capabilities";
import { currentCanvas } from "@/lib/canvas-context";

// ... 핸들러 안, withCanvasRoute 래퍼 내부
const m = getMetamodel();
return NextResponse.json({
  ...m,                                    // 기존 응답 필드 유지
  capabilities: capabilities(m, currentCanvas()),
});
```

- [ ] **Step 6: 서버 방어 추가**

`lib/capabilities.ts` 에 헬퍼 추가:

```ts
import { getMetamodel } from "./store";
import { currentCanvas } from "./canvas-context";

/** 현재 캔버스가 이 기능을 못 쓰면 409 Response, 쓸 수 있으면 null. */
export function requireCapability(cap: Capability): Response | null {
  const caps = capabilities(getMetamodel(), currentCanvas());
  if (caps[cap]) return null;
  return new Response(
    JSON.stringify({ error: `이 캔버스에는 ${cap} 에 필요한 객체타입이 없습니다`, capability: cap }),
    { status: 409, headers: { "content-type": "application/json" } }
  );
}
```

> `lib/capabilities.ts` 가 `lib/store.ts` 를 import 하면 순환이 생기는지 확인한다.
> `store.ts` 는 `capabilities.ts` 를 import 하지 않으므로 단방향이다.

각 라우트의 `withCanvasRoute` 콜백 첫 줄에 넣는다. `app/api/infer/route.ts` 예:

```ts
export async function POST(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    const blocked = requireCapability("infer");
    if (blocked) return blocked;
    // ── 기존 본문 ──
  });
}
```

대상: `infer`(infer) · `fmea-draft`(fmeaDraft) · `contradictions`(contradictions) ·
`bom-check`(bomCheck) · `condensation`(condensation).

- [ ] **Step 7: 전체 테스트 + 빌드**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: `fail 0` · 빌드 성공

- [ ] **Step 8: 커밋**

```bash
git add lib/capabilities.ts lib/capabilities.test.ts app/api
git commit -m "feat(canvas): 기능 가용성을 스키마에서 유도 + 서버 방어"
```

---

## Task 7: 캔버스 UI (좌측 드로어 + 전환)

**Files:**
- Create: `components/CanvasPanel.tsx`
- Modify: `components/LeftRail.tsx`
- Modify: `components/WorkbenchLoader.tsx`
- Modify: `components/Workbench.tsx`

**Interfaces:**
- Consumes: `/api/canvases` (Task 5), `apiFetch`/`setApiCanvas` (Task 4), `/api/schema` 의 `capabilities` (Task 6)
- Produces: `CanvasPanel` props — `{ current: string; onSwitch: (id: string) => void }`

- [ ] **Step 1: `LeftRail` 을 아이콘별 콘텐츠 맵으로**

`components/LeftRail.tsx` 교체:

```tsx
"use client";

// 좌측 아이콘 레일(48px) + 활성 시 드로어(252px). Neo4j Browser 식.
// 기본 접힘 — 아이콘 클릭으로 드로어 펼침. 드로어 내용은 panels[활성 아이콘 id].
import type { ReactNode } from "react";

interface RailIcon {
  id: string;
  glyph: string;
  label: string;
  ready: boolean; // false = 준비중(disabled)
}

const ICONS: RailIcon[] = [
  { id: "canvases", glyph: "▤", label: "캔버스", ready: true },
  { id: "types", glyph: "▣", label: "객체 타입", ready: true },
  { id: "schema", glyph: "◈", label: "스키마", ready: true },
  { id: "history", glyph: "🕐", label: "히스토리", ready: false },
];

interface LeftRailProps {
  active: string | null;
  onSelect: (id: string | null) => void;
  panels: Record<string, ReactNode>;
}

export default function LeftRail({ active, onSelect, panels }: LeftRailProps) {
  const activeLabel = ICONS.find((i) => i.id === active)?.label ?? "";
  return (
    <div className="lr">
      <nav className="lr-rail">
        {ICONS.map((ic) => (
          <button
            key={ic.id}
            className={"lr-ico" + (active === ic.id ? " active" : "")}
            disabled={!ic.ready}
            title={ic.ready ? ic.label : `${ic.label} · 준비중`}
            onClick={() => onSelect(active === ic.id ? null : ic.id)}
          >
            {ic.glyph}
          </button>
        ))}
      </nav>
      {active !== null && (
        <div className="lr-drawer">
          <div className="lr-head">
            <span>{activeLabel}</span>
            <button className="lr-close" title="접기" onClick={() => onSelect(null)}>
              ✕
            </button>
          </div>
          <div className="lr-body">{panels[active] ?? null}</div>
        </div>
      )}
    </div>
  );
}
```

`components/Workbench.tsx:1122-1139` 의 `<LeftRail>` 사용부를 `panels={{ ... }}` 형태로 바꾼다.
기존 `<SourcePanel>` 은 `types` 키에 그대로 넣는다.

- [ ] **Step 2: `CanvasPanel` 구현**

`components/CanvasPanel.tsx`:

```tsx
"use client";

// 좌측 드로어 — 캔버스 목록·전환·생성·이름변경·소프트삭제·휴지통 복구.
// 데이터는 전부 /api/canvases 에서 온다(골든 룰 4 — UI 하드코딩 금지).
import { useCallback, useEffect, useState } from "react";

export interface CanvasSummary {
  id: string;
  name: string;
  description: string | null;
  nodeCount: number;
  docCount: number;
  deletedAt: string | null;
}

interface Props {
  current: string;
  onSwitch: (id: string) => void;
}

export default function CanvasPanel({ current, onSwitch }: Props) {
  const [items, setItems] = useState<CanvasSummary[]>([]);
  const [trash, setTrash] = useState<CanvasSummary[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // 캔버스 목록 자체는 캔버스에 종속되지 않으므로 apiFetch 가 아니라 fetch 를 쓴다.
  const load = useCallback(async () => {
    const [a, t] = await Promise.all([
      fetch("/api/canvases").then((r) => r.json()),
      fetch("/api/canvases?trash=1").then((r) => r.json()),
    ]);
    setItems(a.canvases ?? []);
    setTrash(t.canvases ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setErr(null);
    const r = await fetch("/api/canvases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) { setErr((await r.json()).error ?? "생성 실패"); return; }
    const { canvas } = await r.json();
    setNewName("");
    await load();
    onSwitch(canvas.id); // 만든 캔버스로 바로 이동
  }

  async function rename(c: CanvasSummary) {
    const name = window.prompt("새 표시명", c.name);
    if (!name || name === c.name) return;
    await fetch(`/api/canvases/${encodeURIComponent(c.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await load();
  }

  async function remove(c: CanvasSummary) {
    const ok = window.confirm(
      `"${c.name}" 캔버스를 휴지통으로 보냅니다.\n\n문서 ${c.docCount}개 · 노드 ${c.nodeCount}개가 함께 숨겨집니다.\n휴지통에서 복구할 수 있습니다.`
    );
    if (!ok) return;
    setErr(null);
    const r = await fetch(`/api/canvases/${encodeURIComponent(c.id)}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json()).error ?? "삭제 실패"); return; }
    await load();
    if (c.id === current) {
      const rest = (await fetch("/api/canvases").then((x) => x.json())).canvases as CanvasSummary[];
      if (rest[0]) onSwitch(rest[0].id);
    }
  }

  async function restore(c: CanvasSummary) {
    await fetch(`/api/canvases/${encodeURIComponent(c.id)}/restore`, { method: "POST" });
    await load();
  }

  async function purge(c: CanvasSummary) {
    const typed = window.prompt(`영구 삭제하려면 캔버스 이름 "${c.name}" 을 그대로 입력하세요.\n되돌릴 수 없습니다.`);
    if (typed !== c.name) return;
    await fetch(`/api/canvases/${encodeURIComponent(c.id)}?purge=1`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="cv-panel">
      {err && <p className="cv-err">{err}</p>}

      <ul className="cv-list">
        {items.map((c) => (
          <li key={c.id} className={"cv-item" + (c.id === current ? " active" : "")}>
            <button className="cv-pick" onClick={() => onSwitch(c.id)} title={c.description ?? c.name}>
              <span className="cv-mark">{c.id === current ? "✓" : ""}</span>
              <span className="cv-name">{c.name}</span>
              <span className="cv-meta">문서 {c.docCount} · 노드 {c.nodeCount}</span>
            </button>
            <button className="cv-act" title="이름 변경" onClick={() => rename(c)}>✎</button>
            <button className="cv-act" title="휴지통으로" onClick={() => remove(c)} disabled={items.length <= 1}>✕</button>
          </li>
        ))}
      </ul>

      <div className="cv-new">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          placeholder="새 캔버스 이름"
          maxLength={60}
        />
        <button onClick={() => void create()} disabled={!newName.trim()}>+ 만들기</button>
      </div>

      <button className="cv-trash-toggle" onClick={() => setShowTrash((v) => !v)}>
        🗑 휴지통 ({trash.length})
      </button>
      {showTrash && (
        <ul className="cv-list cv-trash">
          {trash.length === 0 && <li className="cv-empty">비어 있습니다</li>}
          {trash.map((c) => (
            <li key={c.id} className="cv-item">
              <span className="cv-name">{c.name}</span>
              <button className="cv-act" title="복구" onClick={() => restore(c)}>↩</button>
              <button className="cv-act" title="영구 삭제" onClick={() => purge(c)}>🗑</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 캔버스 선택 상태 + 리마운트 전환**

`components/WorkbenchLoader.tsx` 를 캔버스 인지로 바꾼다:

```tsx
"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { setApiCanvas } from "@/lib/api-client";

const Workbench = dynamic(() => import("./Workbench"), { ssr: false });

const LS_KEY = "sl-onto:canvas";

export default function WorkbenchLoader() {
  const [resetKey, setResetKey] = useState(0);
  const [canvas, setCanvas] = useState<string | null>(null);

  // 선택 캔버스 복원 — 없거나 삭제됐으면 첫 캔버스로 폴백.
  useEffect(() => {
    void (async () => {
      const saved = window.localStorage.getItem(LS_KEY);
      const list = (await fetch("/api/canvases").then((r) => r.json())).canvases as { id: string }[];
      const pick = list.find((c) => c.id === saved)?.id ?? list[0]?.id ?? "default";
      setApiCanvas(pick);
      setCanvas(pick);
    })();
  }, []);

  function switchCanvas(id: string) {
    window.localStorage.setItem(LS_KEY, id);
    setApiCanvas(id);
    setCanvas(id); // key 변경 → Workbench 리마운트 = 소프트 리셋
  }

  if (!canvas) return null; // 캔버스 확정 전에는 렌더하지 않는다(잘못된 캔버스로 fetch 방지)

  return (
    <Workbench
      key={`${canvas}:${resetKey}`}
      canvas={canvas}
      onSwitchCanvas={switchCanvas}
      onReset={() => setResetKey((k) => k + 1)}
    />
  );
}
```

- [ ] **Step 4: `Workbench` 에 캔버스 props + 패널 배선**

`components/Workbench.tsx` 의 props 를 넓힌다:

```tsx
interface WorkbenchProps {
  canvas: string;
  onSwitchCanvas: (id: string) => void;
  onReset: () => void;
}
export default function Workbench({ canvas, onSwitchCanvas, onReset }: WorkbenchProps) {
```

`<LeftRail>` 사용부(`:1122-1139`)를 바꾼다:

```tsx
<LeftRail
  active={leftPanel}
  onSelect={setLeftPanel}
  panels={{
    canvases: <CanvasPanel current={canvas} onSwitch={onSwitchCanvas} />,
    types: (
      <SourcePanel
        /* ── 기존 props 그대로 ── */
      />
    ),
    schema: <SchemaPanel />,
  }}
/>
```

- [ ] **Step 5: capabilities 로 상단바 버튼 렌더**

`Workbench.tsx` 에 상태 추가:

```tsx
const [caps, setCaps] = useState<Record<string, boolean>>({});

useEffect(() => {
  void apiFetch("/api/schema").then((r) => r.json()).then((j) => setCaps(j.capabilities ?? {}));
}, []);
```

FMEA 종속 버튼을 감싼다 — `⚠ 모순`(`:1043`), `▶ 신규 설계 추론`(`:1104`) 등:

```tsx
{caps.contradictions && (
  <button /* ── 기존 모순 버튼 그대로 ── */ />
)}
{caps.infer && (
  <button /* ── 기존 추론 버튼 그대로 ── */ />
)}
```

- [ ] **Step 6: 빈 캔버스 안내**

`Workbench.tsx` 의 canvas-wrap(`:1142`) 안에 추가:

```tsx
{fullTotals.nodes === 0 && (
  <div className="cv-empty-guide">
    <h3>빈 캔버스입니다</h3>
    <ol>
      <li><b>◈ 스키마</b> 드로어에서 객체타입·관계타입을 정의하세요.</li>
      <li><b>📥 문서 인제스천</b>으로 문서를 부어 온톨로지를 구축하세요.</li>
    </ol>
    <p className="cv-empty-note">타입이 없으면 문서를 넣어도 적재되지 않습니다.</p>
  </div>
)}
```

- [ ] **Step 7: CSS 추가**

`app/globals.css`(또는 프로젝트의 전역 스타일 파일)에 `.cv-panel` · `.cv-list` · `.cv-item` ·
`.cv-pick` · `.cv-act` · `.cv-new` · `.cv-trash-toggle` · `.cv-err` · `.cv-empty-guide` 스타일을
기존 `.lr-*` 및 SL 브랜드 토큰(흰 배경 · 네이비 텍스트 · 시안 `#00a2e5`)에 맞춰 추가한다.
활성 캔버스는 시안 좌측 보더로 표시한다.

- [ ] **Step 8: 빌드 + 수동 검증**

Run: `npm run build && npm run dev`

브라우저에서 확인:

1. 좌측 레일 `▤` → 캔버스 목록에 `램프`(문서 37 · 노드 179)
2. `새 캔버스 이름` 에 `전장` 입력 → `+ 만들기` → 자동 전환, 캔버스 0/0 + 빈 캔버스 안내
3. 상단바에 `⚠ 모순` · `▶ 신규 설계 추론` 버튼이 **없음**(capabilities false)
4. `▤` → `램프` 클릭 → 179 노드 그래프 복귀, 버튼 다시 나타남
5. `전장` `✕` → 확인 → 목록에서 사라짐 → `🗑 휴지통 (1)` 에서 `↩` 복구
6. `램프` 하나만 남긴 상태에서 `✕` 버튼이 비활성

- [ ] **Step 9: 커밋**

```bash
git add components app/globals.css
git commit -m "feat(ui): 캔버스 드로어 + 전환 리마운트 + 기능 가용성 기반 버튼"
```

---

## Task 8: 스키마 편집 UI

빈 캔버스를 쓸 수 있게 만드는 마지막 조각이다. 이게 없으면 새 캔버스는 영원히 비어 있다.

**Files:**
- Create: `app/api/schema/object-types/route.ts`
- Create: `app/api/schema/relation-types/route.ts`
- Create: `components/SchemaPanel.tsx`
- Modify: `lib/db.ts` (스키마 편집 헬퍼)
- Modify: `lib/store.ts` (편집 후 메타모델 재적재)

**Interfaces:**
- Consumes: `withCanvasRoute` (Task 4), `currentCanvas` (Task 1)
- Produces:
  - `db.upsertObjectType(t)` / `db.deleteObjectType(typeId)` / `db.upsertRelationType(r)` / `db.deleteRelationType(relId)`
  - `store.reloadMetamodel(): Promise<void>` — 편집 후 캐시 갱신
  - `POST/PATCH /api/schema/object-types` `{type_id, label_ko, color?, icon?, description?}` → `{ ok: true }`
  - `DELETE /api/schema/object-types?type_id=` → `{ ok: true }` · 그 타입 노드가 있으면 409
  - `POST/PATCH /api/schema/relation-types` `{rel_id, label_ko, src_types, dst_types, description?}` → `{ ok: true }`
  - `DELETE /api/schema/relation-types?rel_id=` → `{ ok: true }` · 그 관계 엣지가 있으면 409

- [ ] **Step 1: DB 헬퍼 추가**

`lib/db.ts` 에 추가:

```ts
/* ────────────────────────── 스키마 편집 (캔버스별 메타모델) ────────────────────────── */

export async function upsertObjectType(t: {
  type_id: string; label_ko: string; color: string | null; icon: string | null; description: string | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO object_types (canvas_id, type_id, label_ko, color, icon, description)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (canvas_id, type_id) DO UPDATE
       SET label_ko = EXCLUDED.label_ko, color = EXCLUDED.color,
           icon = EXCLUDED.icon, description = EXCLUDED.description`,
    [currentCanvas(), t.type_id, t.label_ko, t.color, t.icon, t.description]
  );
}

/** 그 타입의 노드가 남아 있으면 삭제하지 않는다(고아 노드 방지). @returns 남은 노드 수 */
export async function objectTypeUsage(typeId: string): Promise<number> {
  const r = await getPool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM nodes WHERE canvas_id = $1 AND type = $2",
    [currentCanvas(), typeId]
  );
  return Number(r.rows[0].n);
}

export async function deleteObjectType(typeId: string): Promise<void> {
  // 서브타입·속성정의는 FK CASCADE 로 함께 사라진다.
  await getPool().query("DELETE FROM object_types WHERE canvas_id = $1 AND type_id = $2", [currentCanvas(), typeId]);
}

export async function upsertRelationType(r: {
  rel_id: string; label_ko: string; description: string | null; src_types: string[]; dst_types: string[];
}): Promise<void> {
  await getPool().query(
    `INSERT INTO relation_types (canvas_id, rel_id, label_ko, description, src_types, dst_types, directed)
     VALUES ($1,$2,$3,$4,$5,$6,true)
     ON CONFLICT (canvas_id, rel_id) DO UPDATE
       SET label_ko = EXCLUDED.label_ko, description = EXCLUDED.description,
           src_types = EXCLUDED.src_types, dst_types = EXCLUDED.dst_types`,
    [currentCanvas(), r.rel_id, r.label_ko, r.description, r.src_types, r.dst_types]
  );
}

export async function relationTypeUsage(relId: string): Promise<number> {
  const r = await getPool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM edges WHERE canvas_id = $1 AND rel = $2",
    [currentCanvas(), relId]
  );
  return Number(r.rows[0].n);
}

export async function deleteRelationType(relId: string): Promise<void> {
  await getPool().query("DELETE FROM relation_types WHERE canvas_id = $1 AND rel_id = $2", [currentCanvas(), relId]);
}
```

- [ ] **Step 2: store 에 메타모델 재적재 추가**

`lib/store.ts` 에 추가:

```ts
/** 스키마 편집 후 메타모델 캐시 갱신 — 다음 요청이 새 타입을 즉시 본다. */
export async function reloadMetamodel(): Promise<void> {
  if (!HAS_DB) return;
  cache().metamodel = await db.loadMetamodel();
}
```

- [ ] **Step 3: 객체타입 라우트**

`app/api/schema/object-types/route.ts`:

```ts
// POST/PATCH /api/schema/object-types  — 객체타입 생성·수정
// DELETE     /api/schema/object-types?type_id=  — 삭제(그 타입 노드가 남아 있으면 409)
// 캔버스별 메타모델을 편집한다 — 빈 캔버스를 쓸 수 있게 하는 진입점.
import { NextResponse } from "next/server";
import { z } from "zod";
import * as db from "@/lib/db";
import { ready, reloadMetamodel } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

export const runtime = "nodejs";

const Schema = z.object({
  type_id: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,30}$/, "소문자로 시작하는 영숫자·_·- 만"),
  label_ko: z.string().trim().min(1).max(40),
  color: z.string().trim().max(20).nullable().optional(),
  icon: z.string().trim().max(8).nullable().optional(),
  description: z.string().trim().max(200).nullable().optional(),
});

async function upsert(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.flatten() }, { status: 400 });
    }
    const d = parsed.data;
    await db.upsertObjectType({
      type_id: d.type_id, label_ko: d.label_ko,
      color: d.color ?? null, icon: d.icon ?? null, description: d.description ?? null,
    });
    await reloadMetamodel();
    return NextResponse.json({ ok: true });
  });
}

export const POST = upsert;
export const PATCH = upsert;

export async function DELETE(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    const typeId = new URL(req.url).searchParams.get("type_id");
    if (!typeId) return NextResponse.json({ error: "type_id 가 필요합니다" }, { status: 400 });
    const used = await db.objectTypeUsage(typeId);
    if (used > 0) {
      return NextResponse.json(
        { error: `이 타입의 노드가 ${used}개 남아 있어 삭제할 수 없습니다`, nodeCount: used },
        { status: 409 }
      );
    }
    await db.deleteObjectType(typeId);
    await reloadMetamodel();
    return NextResponse.json({ ok: true });
  });
}
```

- [ ] **Step 4: 관계타입 라우트**

`app/api/schema/relation-types/route.ts`:

```ts
// POST/PATCH /api/schema/relation-types — 관계타입 생성·수정
// DELETE     /api/schema/relation-types?rel_id=  — 삭제(그 관계 엣지가 남아 있으면 409)
import { NextResponse } from "next/server";
import { z } from "zod";
import * as db from "@/lib/db";
import { ready, reloadMetamodel } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

export const runtime = "nodejs";

const Schema = z.object({
  rel_id: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,30}$/, "대문자·숫자·_ 만 (예: HAS_FAILURE)"),
  label_ko: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).nullable().optional(),
  src_types: z.array(z.string()).default([]),
  dst_types: z.array(z.string()).default([]),
});

async function upsert(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid input", issues: parsed.error.flatten() }, { status: 400 });
    }
    const d = parsed.data;
    await db.upsertRelationType({
      rel_id: d.rel_id, label_ko: d.label_ko,
      description: d.description ?? null, src_types: d.src_types, dst_types: d.dst_types,
    });
    await reloadMetamodel();
    return NextResponse.json({ ok: true });
  });
}

export const POST = upsert;
export const PATCH = upsert;

export async function DELETE(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    const relId = new URL(req.url).searchParams.get("rel_id");
    if (!relId) return NextResponse.json({ error: "rel_id 가 필요합니다" }, { status: 400 });
    const used = await db.relationTypeUsage(relId);
    if (used > 0) {
      return NextResponse.json(
        { error: `이 관계의 엣지가 ${used}개 남아 있어 삭제할 수 없습니다`, edgeCount: used },
        { status: 409 }
      );
    }
    await db.deleteRelationType(relId);
    await reloadMetamodel();
    return NextResponse.json({ ok: true });
  });
}
```

- [ ] **Step 5: `SchemaPanel` 구현**

`components/SchemaPanel.tsx`:

```tsx
"use client";

// 좌측 드로어 — 캔버스 스키마(객체타입·관계타입) 편집.
// 빈 캔버스에서 여기로 타입을 정의해야 문서 인제스천이 노드를 만들 수 있다.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface ObjectType { type_id: string; label_ko: string; description: string | null }
interface RelationType { rel_id: string; label_ko: string; src_types: string[]; dst_types: string[] }

export default function SchemaPanel() {
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [rels, setRels] = useState<RelationType[]>([]);
  const [tId, setTId] = useState("");
  const [tLabel, setTLabel] = useState("");
  const [rId, setRId] = useState("");
  const [rLabel, setRLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await apiFetch("/api/schema").then((r) => r.json());
    setTypes(j.objectTypes ?? []);
    setRels(j.relationTypes ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addType() {
    setErr(null);
    const r = await apiFetch("/api/schema/object-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type_id: tId.trim(), label_ko: tLabel.trim() }),
    });
    if (!r.ok) { setErr((await r.json()).error ?? "추가 실패"); return; }
    setTId(""); setTLabel(""); await load();
  }

  async function delType(id: string) {
    setErr(null);
    const r = await apiFetch(`/api/schema/object-types?type_id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json()).error ?? "삭제 실패"); return; }
    await load();
  }

  async function addRel() {
    setErr(null);
    const r = await apiFetch("/api/schema/relation-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rel_id: rId.trim().toUpperCase(), label_ko: rLabel.trim(), src_types: [], dst_types: [] }),
    });
    if (!r.ok) { setErr((await r.json()).error ?? "추가 실패"); return; }
    setRId(""); setRLabel(""); await load();
  }

  async function delRel(id: string) {
    setErr(null);
    const r = await apiFetch(`/api/schema/relation-types?rel_id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json()).error ?? "삭제 실패"); return; }
    await load();
  }

  return (
    <div className="sc-panel">
      {err && <p className="sc-err">{err}</p>}

      <h4 className="sc-h">객체 타입 ({types.length})</h4>
      <ul className="sc-list">
        {types.length === 0 && <li className="sc-empty">타입이 없습니다 — 먼저 정의하세요</li>}
        {types.map((t) => (
          <li key={t.type_id} className="sc-item">
            <code>{t.type_id}</code>
            <span>{t.label_ko}</span>
            <button className="sc-act" title="삭제" onClick={() => delType(t.type_id)}>✕</button>
          </li>
        ))}
      </ul>
      <div className="sc-new">
        <input value={tId} onChange={(e) => setTId(e.target.value)} placeholder="id (예: item)" maxLength={31} />
        <input value={tLabel} onChange={(e) => setTLabel(e.target.value)} placeholder="표시명 (예: 부품)" maxLength={40} />
        <button onClick={() => void addType()} disabled={!tId.trim() || !tLabel.trim()}>+ 추가</button>
      </div>

      <h4 className="sc-h">관계 타입 ({rels.length})</h4>
      <ul className="sc-list">
        {rels.length === 0 && <li className="sc-empty">관계가 없습니다</li>}
        {rels.map((r) => (
          <li key={r.rel_id} className="sc-item">
            <code>{r.rel_id}</code>
            <span>{r.label_ko}</span>
            <button className="sc-act" title="삭제" onClick={() => delRel(r.rel_id)}>✕</button>
          </li>
        ))}
      </ul>
      <div className="sc-new">
        <input value={rId} onChange={(e) => setRId(e.target.value)} placeholder="id (예: HAS_FAILURE)" maxLength={31} />
        <input value={rLabel} onChange={(e) => setRLabel(e.target.value)} placeholder="표시명 (예: 고장모드 보유)" maxLength={40} />
        <button onClick={() => void addRel()} disabled={!rId.trim() || !rLabel.trim()}>+ 추가</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: CSS 추가**

`app/globals.css` 에 `.sc-panel` · `.sc-h` · `.sc-list` · `.sc-item` · `.sc-new` · `.sc-act` ·
`.sc-err` · `.sc-empty` 를 `.cv-*` 와 같은 톤으로 추가한다.

- [ ] **Step 7: 빌드 + 수동 검증(전체 흐름)**

Run: `npm run build && npm run dev`

전체 시나리오를 끝까지 밟는다:

1. `▤` → `+ 새 캔버스` `전장` 생성 → 빈 캔버스 안내 표시
2. `◈` 스키마 → 객체타입 `item`/`부품`, `fm`/`고장모드`, `doc`/`근거문서` 추가
3. 관계타입 `HAS_FAILURE`/`고장모드 보유`, `EVIDENCED_BY`/`근거` 추가
4. `📥 문서 인제스천` → 샘플 문서 → **노드가 생성되는지** 확인
5. `▤` → `램프` 전환 → 179 노드 그대로 · 전장 노드 안 보임
6. `▤` → `전장` 전환 → 방금 만든 노드만 보임
7. `◈` 에서 `item` 삭제 시도 → **409** "이 타입의 노드가 N개 남아 있어..."

- [ ] **Step 8: 전체 테스트 + 커밋**

```bash
npx tsc --noEmit && npm test && npm run build
git add app/api/schema components/SchemaPanel.tsx lib/db.ts lib/store.ts app/globals.css
git commit -m "feat(schema): 캔버스별 스키마 편집 — 객체타입·관계타입 CRUD"
```

---

## 최종 검증 (전체 태스크 완료 후)

- [ ] **회귀**: `npm test` → `fail 0`, 기존 117개 포함
- [ ] **타입**: `npx tsc --noEmit` → 에러 0
- [ ] **빌드**: `npm run build` → 성공
- [ ] **누락 라우트**: `grep -L withCanvasRoute $(find app/api -name route.ts | grep -v canvases)` → 빈 출력
- [ ] **컴포넌트 직접 fetch 잔존**: `grep -rn 'fetch("/api/' components/ | grep -v apiFetch | grep -v '/api/canvases'` → 빈 출력
- [ ] **기존 DB 마이그레이션**: 운영 DB 사본에 적용 → 램프 캔버스가 179 노드 / 2,198 엣지 / 37 문서 그대로
- [ ] **신규 DB 부트스트랩**: 빈 DB 로 부팅 → `default` 캔버스 자동 생성 + FMEA 시드 + `ingestAll()` → 기존과 동일한 노드 수
- [ ] **마이그레이션 멱등**: 두 번 부팅해도 오류 없음
- [ ] **문서 갱신**: `docs/data-model.md`(캔버스 스키마) · `docs/architecture.md`(요청 경로) · `CLAUDE.md`(레포 구조에 `lib/canvases.ts` 등)

---

## 배포 노트

Task 1~4 가 끝나면 **기능 변화 없이 구조만 교체된 상태**로 배포할 수 있다(캔버스는 `default`
하나, UI 무변경). Task 5 이후가 사용자에게 보이는 변화다.

배포 시 마이그레이션은 파드 기동 중 자동 실행된다. **운영 DB 백업을 먼저 확보한다** —
`001-canvas.sql` 은 단방향이고 되돌리기 스크립트가 없다.
