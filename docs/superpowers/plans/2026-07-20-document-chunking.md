# 문서 청킹 + 원문 RAG 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문서 원문을 청크로 쪼개 벡터 검색하고, 캔버스 안에서 객체 선택 없이 자유 질문하면 원문 근거로 답하게 한다.

**Architecture:** 임베딩 모델을 `multilingual-e5-base`(512토큰·768dim)로 교체하고, `extractSourceBlocks()` 위에 형식별 청커를 얹어 `doc_chunks` 테이블에 적재한다. 검색은 질의 임베딩 코사인 top-8, 생성은 pyservice `/llm task=docask`. 기존 `/api/ask`(객체 앵커)와 검색 랭킹은 건드리지 않는다.

**Tech Stack:** Next.js 15.5 App Router · TypeScript strict · Postgres + pgvector · Python 사이드카(sentence-transformers) · `node --test --experimental-strip-types`

**설계 문서:** `docs/superpowers/specs/2026-07-20-document-chunking-design.md`

## Global Constraints

- **골든 룰 1 (근거 우선)**: 답변에 인용된 `[C n]` 의 파일명·블록·원문 구절을 응답에 함께 실어 UI가 근거를 보여준다.
- **골든 룰 4 (UI 하드코딩 금지)**: 청크·답변은 전부 `/api/*` 에서 온다.
- **`lib/` 프레임워크 비의존**: `lib/` 안에서 `next/*` 를 import 하지 않는다.
- **파라미터 바인딩만**: 모든 SQL 값은 `$n`. 문자열 보간 금지.
- **e5 접두어**: 문서는 `passage: `, 질의는 `query: `. **빠뜨려도 에러가 안 나고 품질만 떨어진다** — `lib/embed.ts` 가 유일한 진입점이고 테스트로 고정한다.
- **목표 청크 크기**: `CHUNK_CHARS = 800` (512토큰 한도에 여유를 둔 값)
- **검색 top-k**: `CHUNK_TOP_K = 8`
- **임베딩 차원**: `768` (`vector(768)`)
- **캔버스 스코핑**: 모든 청크 쿼리에 `canvas_id` 조건. 라우트는 `withCanvasRoute` 로 감싼다.
- **테스트 실행**: `npm test`. 신규 테스트 파일은 `lib/graph-memo.test.ts:6-19` 의 resolve 훅 패턴을 복사한다.
- **기준선**: 현재 `tsc` 0 · **140 tests / 133 pass / 7 skip / 0 fail** · build 성공. 전 과정에서 유지한다.

---

## File Structure

**신규**

| 파일 | 책임 |
|---|---|
| `lib/chunk.ts` | `SourceBlock[]` → `Chunk[]`. 형식별 분할 규칙만 담는다(DB·네트워크 무관, 순수 함수) |
| `lib/chunk.test.ts` | 헤더 반복·800자 상한·문단 경계·오버랩 규칙 |
| `lib/embed.test.ts` | e5 접두어 회귀 방어 |
| `lib/db/migrations/002-chunks.sql` | `nodes.embedding` 768 재생성 + `doc_chunks` 테이블 |
| `app/api/doc-ask/route.ts` | 질문 → 청크 검색 → LLM → 인용 답변 |
| `components/DocAskPanel.tsx` | 자유 질문 UI + 인용 근거 표시 |

**수정**

| 파일 | 변경 |
|---|---|
| `lib/embed.ts` | `embedQuery`/`embedPassage` 분리(e5 접두어) · 청크 백필 추가 |
| `lib/db.ts` | `doc_chunks` CRUD + `chunkSearch` · `embedText` 는 그대로 |
| `lib/db/schema.sql` | 신규 설치용 `doc_chunks` + `vector(768)` |
| `lib/source-text.ts` | `extractSourceBlocks(file, buf, opts?)` — 청킹용 무절단 옵션 |
| `lib/store.ts` | `scheduleEmbedBackfill` 안에서 청크 백필 이어 실행 |
| `pyservice/main.py` | `MODEL_NAME` e5-base · `task="docask"` 추가 |
| `k8s/pyservice.yaml` | memory limit 2Gi → 3Gi |
| `components/Workbench.tsx` | 상단바 `📖 문서 질문` 버튼 + 우측 패널 배선 |

---

## Task 1: e5 접두어 — `lib/embed.ts` 분리

모델 교체의 가장 위험한 부분이다. 접두어를 빠뜨려도 컴파일·런타임 에러가 없고 검색 품질만 조용히 떨어진다. 그래서 **제일 먼저** 하고 테스트로 고정한다.

**Files:**
- Modify: `lib/embed.ts`
- Test: `lib/embed.test.ts` (신규)

**Interfaces:**
- Consumes: `pyPost` (`lib/pyservice.ts`), `nodesMissingEmbedding`/`setEmbedding` (`lib/db.ts`)
- Produces:
  - `embedPassage(texts: string[]): Promise<number[][]>` — 문서·노드 텍스트용
  - `embedQuery(text: string): Promise<number[] | null>` — 질의용
  - `E5_PASSAGE = "passage: "` / `E5_QUERY = "query: "` (테스트가 참조)
  - 기존 `embed`/`embedOne` 은 **제거**한다(접두어 없이 부를 수 있는 문을 남기지 않는다)

- [x] **Step 1: 실패하는 테스트를 작성한다**

`lib/embed.test.ts`:

```ts
// lib/embed.test.ts — e5 접두어 회귀 방어 (`node --test --experimental-strip-types`).
// e5 계열은 query:/passage: 접두어가 없으면 에러 없이 품질만 떨어진다. 코드로 고정한다.
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

const src = await import("node:fs").then((fs) => fs.readFileSync("lib/embed.ts", "utf8"));

test("접두어 상수가 정의돼 있다", () => {
  assert.match(src, /E5_PASSAGE\s*=\s*"passage: "/);
  assert.match(src, /E5_QUERY\s*=\s*"query: "/);
});

test("embedPassage 는 passage 접두어를 붙인다", () => {
  assert.match(src, /embedPassage[\s\S]{0,400}E5_PASSAGE \+/);
});

test("embedQuery 는 query 접두어를 붙인다", () => {
  assert.match(src, /embedQuery[\s\S]{0,400}E5_QUERY \+/);
});

test("접두어 없이 부를 수 있는 embed/embedOne 은 남아 있지 않다", () => {
  assert.ok(!/export async function embed\(/.test(src), "embed() 가 남아 있으면 접두어를 빠뜨릴 수 있다");
  assert.ok(!/export async function embedOne\(/.test(src), "embedOne() 도 마찬가지");
});
```

- [x] **Step 2: 실패를 확인한다**

Run: `node --test --experimental-strip-types lib/embed.test.ts`
Expected: FAIL — `E5_PASSAGE` 없음, `embed(` 존재

- [x] **Step 3: `lib/embed.ts` 를 교체한다**

```ts
// Python 사이드카(/embed) 태스크 래퍼 — 상태 없음. 질의·문서 텍스트 → 768dim 벡터.
// 골든 룰: pyservice 가 죽어도 검색·부팅은 막지 않는다 — 어떤 오류도 삼켜서 안전한 빈값 반환(throw 금지).
//
// ⚠ e5 접두어: multilingual-e5-base 는 문서에 "passage: ", 질의에 "query: " 를 요구한다.
// 빠뜨려도 에러가 안 나고 검색 품질만 조용히 떨어진다. 그래서 접두어 없이 부를 수 있는
// 함수(embed/embedOne)를 아예 두지 않는다. lib/embed.test.ts 가 이걸 고정한다.
import { dbEnabled, nodesMissingEmbedding, setEmbedding } from "./db";
import { pyEnabled, pyPost } from "./pyservice";

const EMBED_TIMEOUT_MS = 10000;
const BATCH = 64;

export const E5_PASSAGE = "passage: ";
export const E5_QUERY = "query: ";

export function embedEnabled(): boolean {
  return pyEnabled();
}

/** 내부 전용 — 접두어가 이미 붙은 텍스트만 받는다. */
async function embedRaw(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const data = await pyPost<{ vectors?: number[][] }>("/embed", { texts }, EMBED_TIMEOUT_MS, "embed");
  return Array.isArray(data?.vectors) ? data.vectors : [];
}

/** 문서·노드 텍스트 임베딩(passage). 미가용이면 []. */
export async function embedPassage(texts: string[]): Promise<number[][]> {
  return embedRaw(texts.map((t) => E5_PASSAGE + t));
}

/** 질의 임베딩(query). 미가용이면 null. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const [v] = await embedRaw([E5_QUERY + text]);
  return v ?? null;
}

/** embedding IS NULL 노드를 배치로 채운다. 멱등(NULL 만 채움). DB·pyservice 미가용이면 skip. */
export async function backfillEmbeddings(): Promise<{ embedded: number; skipped: boolean }> {
  if (!dbEnabled() || !embedEnabled()) return { embedded: 0, skipped: true };
  const rows = await nodesMissingEmbedding();
  let embedded = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vecs = await embedPassage(batch.map((r) => r.text));
    if (vecs.length !== batch.length) break; // pyservice 중단 — 나머지는 다음 호출에 위임(멱등)
    for (let j = 0; j < batch.length; j++) {
      await setEmbedding(batch[j].id, vecs[j]);
      embedded++;
    }
  }
  return { embedded, skipped: false };
}
```

- [x] **Step 4: 호출부를 고친다**

`embed`/`embedOne` 을 쓰던 곳을 찾아 바꾼다:

```bash
grep -rn "embedOne\|from \"@/lib/embed\"\|from \"./embed\"" lib/ app/
```

`lib/nlsearch.ts` 의 `embedOne(q)` → `embedQuery(q)`. 다른 호출부가 나오면 용도에 맞게
`embedPassage`(문서·노드) 또는 `embedQuery`(질의)로 바꾼다.

- [x] **Step 5: 통과 확인**

Run: `node --test --experimental-strip-types lib/embed.test.ts && npx tsc --noEmit`
Expected: 4 tests pass · tsc 에러 0

- [x] **Step 6: 커밋**

```bash
git add lib/embed.ts lib/embed.test.ts lib/nlsearch.ts
git commit -m "refactor(embed): e5 접두어 분리 — embedQuery/embedPassage"
```

---

## Task 2: 청커 `lib/chunk.ts`

순수 함수다. DB·네트워크를 모른다. 그래서 테스트가 쉽고 규칙을 정확히 고정할 수 있다.

**Files:**
- Create: `lib/chunk.ts`
- Test: `lib/chunk.test.ts`
- Modify: `lib/source-text.ts` (무절단 옵션)

**Interfaces:**
- Consumes: `SourceBlock` (`lib/source-text.ts`)
- Produces:
  - `interface Chunk { seq: number; block: string; text: string }`
  - `chunkBlocks(blocks: SourceBlock[]): Chunk[]`
  - `CHUNK_CHARS = 800`

- [x] **Step 1: `extractSourceBlocks` 에 무절단 옵션을 넣는다**

`lib/source-text.ts` 는 `capLines(MAX_LINES=2000)` 으로 잘라낸다. 뷰어에는 맞지만 청킹에는
문서 뒷부분이 통째로 사라진다. 옵션을 추가한다.

`lib/source-text.ts` 의 시그니처와 각 `return` 을 바꾼다:

```ts
/** 확장자별 전체 원문 블록 추출. pdf/dxf/미지원은 빈 blocks(라우트가 상태코드 처리).
 * opts.cap=false 면 라인 상한을 적용하지 않는다 — 청킹은 문서 전체가 필요하다(뷰어만 자른다). */
export function extractSourceBlocks(
  fileName: string,
  buf: Buffer,
  opts: { cap?: boolean } = {}
): SourceText {
  const cap = opts.cap !== false;
  const limit = (blocks: SourceBlock[]) => (cap ? capLines(blocks) : blocks);
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".xlsx") {
    const { sheets } = withTempFile(fileName, buf, (tmp) => readWorkbookGrids(tmp));
    const blocks = sheets.map((s) => {
      const grid = s.grid.filter((row) => row.some((c) => c.trim() !== ""));
      return { label: s.name, rows: grid, lines: grid.map((row) => row.join(" │ ")) };
    });
    return { format: "xlsx", blocks: limit(blocks) };
  }
  if (ext === ".pptx") {
    const { slides } = withTempFile(fileName, buf, (tmp) => readDeck(tmp));
    const blocks = slides.map((s) => ({ label: `슬라이드 ${s.index}`, lines: s.lines }));
    return { format: "pptx", blocks: limit(blocks) };
  }
  if (ext === ".docx") {
    const { paragraphs } = withTempFile(fileName, buf, (tmp) => readDoc(tmp));
    return { format: "docx", blocks: limit([{ label: "본문", lines: paragraphs }]) };
  }
  if (ext === ".dxf") return { format: "dxf", blocks: [] };
  return { format: ext.replace(/^\./, "") || "unknown", blocks: [] };
}
```

- [x] **Step 2: 실패하는 테스트를 작성한다**

`lib/chunk.test.ts`:

```ts
// lib/chunk.test.ts — 형식별 청킹 규칙 (`node --test --experimental-strip-types`).
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

const { chunkBlocks, CHUNK_CHARS } = await import("./chunk.ts");
type SourceBlock = import("./source-text").SourceBlock;

/** 표 블록 — 헤더 1행 + 데이터 n행. 각 행은 약 60자. */
const tableBlock = (n: number): SourceBlock => {
  const header = ["접수번호", "제품", "증상 현상", "추정 원인"];
  const rows = [header];
  for (let i = 0; i < n; i++) {
    rows.push([`CL-${1000 + i}`, "CP-101 하이드라 수분크림 50ml", "상분리", "유화제 함량 부족"]);
  }
  return { label: "클레임", rows, lines: rows.map((r) => r.join(" │ ")) };
};

test("표: 모든 청크에 헤더가 포함된다", () => {
  const chunks = chunkBlocks([tableBlock(60)]);
  assert.ok(chunks.length > 1, `분할돼야 한다 (실제 ${chunks.length})`);
  for (const c of chunks) {
    assert.ok(c.text.includes("증상 현상"), `헤더 누락: ${c.text.slice(0, 60)}`);
  }
});

test("표: 청크가 상한을 넘지 않는다", () => {
  for (const c of chunkBlocks([tableBlock(60)])) {
    assert.ok(c.text.length <= CHUNK_CHARS * 1.3, `너무 길다: ${c.text.length}`);
  }
});

test("표: 같은 데이터 행이 두 청크에 중복되지 않는다 (오버랩 없음)", () => {
  const chunks = chunkBlocks([tableBlock(60)]);
  const seen = new Set<string>();
  for (const c of chunks) {
    for (const line of c.text.split("\n")) {
      if (!line.startsWith("CL-")) continue; // 헤더는 반복이 정상
      assert.ok(!seen.has(line), `데이터 행 중복: ${line}`);
      seen.add(line);
    }
  }
  assert.equal(seen.size, 60, "데이터 행이 전부 한 번씩 나와야 한다");
});

test("산문: 문단 경계에서만 자른다", () => {
  const paras = Array.from({ length: 30 }, (_, i) => `문단${i} ` + "가".repeat(100));
  const chunks = chunkBlocks([{ label: "본문", lines: paras }]);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    for (const line of c.text.split("\n")) {
      if (!line.trim()) continue;
      assert.ok(paras.includes(line), `문단이 잘렸다: ${line.slice(0, 40)}`);
    }
  }
});

test("산문: 인접 청크가 1문단 겹친다", () => {
  const paras = Array.from({ length: 30 }, (_, i) => `문단${i} ` + "가".repeat(100));
  const chunks = chunkBlocks([{ label: "본문", lines: paras }]);
  const first = chunks[0].text.split("\n").filter(Boolean);
  const second = chunks[1].text.split("\n").filter(Boolean);
  assert.equal(second[0], first[first.length - 1], "다음 청크가 직전 문단으로 시작해야 한다");
});

test("블록 label 이 청크에 보존된다", () => {
  const chunks = chunkBlocks([{ label: "슬라이드 3", lines: ["8D 리포트", "이슈: 상분리"] }]);
  assert.equal(chunks[0].block, "슬라이드 3");
});

test("빈 블록·공백 줄은 청크를 만들지 않는다", () => {
  assert.equal(chunkBlocks([]).length, 0);
  assert.equal(chunkBlocks([{ label: "본문", lines: [] }]).length, 0);
  assert.equal(chunkBlocks([{ label: "본문", lines: ["   ", ""] }]).length, 0);
});

test("seq 는 문서 전체에서 0부터 연속이다", () => {
  const chunks = chunkBlocks([tableBlock(40), { label: "메모", lines: ["끝"] }]);
  assert.deepEqual(chunks.map((c) => c.seq), chunks.map((_, i) => i));
});
```

- [x] **Step 3: 실패를 확인한다**

Run: `node --test --experimental-strip-types lib/chunk.test.ts`
Expected: FAIL — `Cannot find module ... chunk.ts`

- [x] **Step 4: `lib/chunk.ts` 구현**

```ts
// lib/chunk.ts — 원문 블록 → 임베딩·검색용 청크. 순수 함수(DB·네트워크 무관).
// 설계: docs/superpowers/specs/2026-07-20-document-chunking-design.md §4
//
// 왜 형식별로 다른가:
//   표(rows 있음)  — 헤더를 매 청크에 반복한다. 안 하면 각 셀이 무슨 컬럼인지 알 수 없어
//                    "상분리 클레임의 원인" 같은 질의에 안 걸린다. 오버랩은 넣지 않는다
//                    (헤더 반복이 그 역할을 하고, 넣으면 같은 행이 두 청크에 중복된다).
//   산문(lines만)  — 문단 경계에서만 자르고 1문단 겹친다(경계에 걸친 맥락 보존).
import type { SourceBlock } from "./source-text";

/** 목표 청크 크기. e5-base 512토큰 한도(한국어 약 1,000~1,300자)에 여유를 둔 값. */
export const CHUNK_CHARS = 800;

export interface Chunk {
  seq: number;
  block: string;
  text: string;
}

const clean = (lines: string[]) => lines.map((l) => l.trim()).filter((l) => l !== "");

/** 표 블록: 헤더 + 데이터 행 묶음. 헤더는 매 청크에 반복, 데이터 행은 중복 없음. */
function chunkTable(label: string, rows: string[][]): string[] {
  const [head, ...body] = rows;
  if (!head) return [];
  const headText = head.join(" │ ");
  const dataLines = clean(body.map((r) => r.join(" │ ")));
  if (!dataLines.length) return headText.trim() ? [headText] : [];

  const out: string[] = [];
  let cur: string[] = [];
  let len = headText.length;
  for (const line of dataLines) {
    // 헤더만으로 이미 상한을 넘는 극단적 표는 행 1개씩이라도 담는다(무한 루프 방지).
    if (cur.length > 0 && len + line.length + 1 > CHUNK_CHARS) {
      out.push([headText, ...cur].join("\n"));
      cur = [];
      len = headText.length;
    }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) out.push([headText, ...cur].join("\n"));
  return out;
}

/** 산문 블록: 문단 경계에서만 자르고 인접 청크가 1문단 겹친다. */
function chunkProse(lines: string[]): string[] {
  const paras = clean(lines);
  if (!paras.length) return [];

  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const p of paras) {
    if (cur.length > 0 && len + p.length + 1 > CHUNK_CHARS) {
      out.push(cur.join("\n"));
      const overlap = cur[cur.length - 1]; // 1문단 오버랩
      cur = [overlap];
      len = overlap.length;
    }
    cur.push(p);
    len += p.length + 1;
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

/** 블록 배열 → 문서 전체 청크. seq 는 0부터 연속. */
export function chunkBlocks(blocks: SourceBlock[]): Chunk[] {
  const out: Chunk[] = [];
  for (const b of blocks) {
    const texts = b.rows && b.rows.length > 0 ? chunkTable(b.label, b.rows) : chunkProse(b.lines);
    for (const text of texts) out.push({ seq: out.length, block: b.label, text });
  }
  return out;
}
```

- [x] **Step 5: 통과 확인**

Run: `node --test --experimental-strip-types lib/chunk.test.ts`
Expected: 8 tests pass

- [x] **Step 6: 실제 문서로 확인한다**

임시 스크립트로 화장품 문서를 청킹해 눈으로 본다(커밋하지 않는다):

```bash
cat > /tmp/ck.ts <<'EOF'
import { register } from "node:module";
const HOOK=`export async function resolve(s,c,next){try{return await next(s,c)}catch(e){const r=s.startsWith("./")||s.startsWith("../")||s.startsWith("/");if(r&&!/\.[cm]?[jt]s$/.test(s))return next(s+".ts",c);throw e}}`;
register("data:text/javascript,"+encodeURIComponent(HOOK), import.meta.url);
const { extractSourceBlocks } = await import("/feda/sl-onto/lib/source-text.ts");
const { chunkBlocks } = await import("/feda/sl-onto/lib/chunk.ts");
const fs = await import("node:fs");
const D = "docs/화장품";
let tot = 0;
for (const f of fs.readdirSync(D).filter(x=>/\.(xlsx|pptx|docx)$/i.test(x)).sort()) {
  const st = extractSourceBlocks(f, fs.readFileSync(`${D}/${f}`), { cap: false });
  const cs = chunkBlocks(st.blocks);
  tot += cs.length;
  const avg = cs.length ? Math.round(cs.reduce((n,c)=>n+c.text.length,0)/cs.length) : 0;
  const max = cs.reduce((n,c)=>Math.max(n,c.text.length),0);
  console.log(`${String(cs.length).padStart(3)}청크 평균${String(avg).padStart(4)}자 최대${String(max).padStart(4)}자  ${f}`);
}
console.log("총 청크", tot);
EOF
node --experimental-strip-types /tmp/ck.ts 2>&1 | grep -vE "Warning|Reparsing|type.*module"
rm -f /tmp/ck.ts
```

Expected: 40개 파일 전부 청크 1개 이상, 최대 길이가 1,100자를 넘지 않음. 총 청크는 수백 개 규모.
넘거나 0청크 파일이 있으면 `chunkBlocks` 를 고친다.

- [x] **Step 7: 커밋**

```bash
git add lib/chunk.ts lib/chunk.test.ts lib/source-text.ts
git commit -m "feat(chunk): 형식별 문서 청커 — 표는 헤더 반복, 산문은 문단 오버랩"
```

---

## Task 3: DB — 마이그레이션 + `doc_chunks` CRUD

**Files:**
- Create: `lib/db/migrations/002-chunks.sql`
- Modify: `lib/db/schema.sql`, `lib/db.ts`

**Interfaces:**
- Consumes: `currentCanvas` (`lib/canvas-context.ts`)
- Produces:
  - `replaceChunks(file: string, chunks: {seq:number; block:string; text:string}[]): Promise<void>`
  - `chunksMissingEmbedding(): Promise<{file:string; seq:number; text:string}[]>`
  - `setChunkEmbedding(file: string, seq: number, vector: number[]): Promise<void>`
  - `chunkSearch(vector: number[], k: number): Promise<{file:string; block:string; text:string; dist:number}[]>`
  - `chunkCount(): Promise<number>` — 캔버스 전체 청크 수
  - `chunkCountOf(file: string): Promise<number>` — 문서 1건의 청크 수(백필이 "이미 청킹됐나" 판정에 쓴다)

- [x] **Step 1: 마이그레이션 SQL**

`lib/db/migrations/002-chunks.sql`:

```sql
-- 002-chunks.sql — 임베딩 모델 교체(384→768) + 문서 청크 테이블. 단방향.
-- 호출자(lib/db.ts doReady)가 doc_chunks 부재를 확인한 뒤 단일 트랜잭션으로 실행한다.
-- 설계: docs/superpowers/specs/2026-07-20-document-chunking-design.md §7

-- 모델을 multilingual-e5-base(768dim)로 바꾸므로 기존 384dim 값은 의미가 없다.
-- vector 간 자동 캐스팅이 없어 ALTER TYPE ... USING 은 거부된다 — DROP/ADD 가 확실하다.
-- 부팅 후 backfillEmbeddings 가 다시 채운다(수백 개, 수 초).
ALTER TABLE nodes DROP COLUMN embedding;
ALTER TABLE nodes ADD COLUMN embedding vector(768);

CREATE TABLE doc_chunks (
  canvas_id  TEXT NOT NULL,
  file       TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  block      TEXT NOT NULL,
  text       TEXT NOT NULL,
  embedding  vector(768),
  PRIMARY KEY (canvas_id, file, seq),
  FOREIGN KEY (canvas_id, file) REFERENCES sources(canvas_id, file) ON DELETE CASCADE
);
```

- [x] **Step 2: `schema.sql` 에 신규 설치 경로 반영**

`lib/db/schema.sql` 에서 `nodes.embedding` 을 `vector(768)` 로 바꾸고, `sources` 정의 **뒤에**
같은 `doc_chunks` 정의를 `CREATE TABLE IF NOT EXISTS` 형태로 추가한다. 마이그레이션 결과와
최종 형태가 **완전히 같아야 한다** — 다르면 신규 배포와 기존 배포가 갈린다.

- [x] **Step 3: `doReady()` 에 002 분기 추가**

`lib/db.ts` 의 `doReady()` 에서 001 마이그레이션 처리 **다음**에 넣는다:

```ts
  // 002 — 임베딩 768 전환 + 청크 테이블. doc_chunks 부재로 감지(001 과 같은 방식).
  const needChunks = await p.query<{ need: boolean }>(
    `SELECT to_regclass('public.nodes') IS NOT NULL AND to_regclass('public.doc_chunks') IS NULL AS need`
  );
  if (needChunks.rows[0]?.need) {
    const sql = fs.readFileSync(path.join(dbDir, "migrations", "002-chunks.sql"), "utf8");
    await tx(async (c) => { await c.query(sql); });
    console.log("[db] 002-chunks 마이그레이션 적용 — 임베딩 768 전환 + doc_chunks 생성");
  }
```

- [x] **Step 4: `lib/db.ts` 에 청크 CRUD 추가**

파일 끝에 추가:

```ts
/* ────────────────────────── 문서 청크 (원문 RAG) ────────────────────────── */

/** 문서의 청크를 통째로 교체한다. 재청킹·문서 교체가 같은 경로를 쓴다(멱등). */
export async function replaceChunks(
  file: string,
  chunks: { seq: number; block: string; text: string }[]
): Promise<void> {
  const cv = currentCanvas();
  await tx(async (c) => {
    await c.query("DELETE FROM doc_chunks WHERE canvas_id = $1 AND file = $2", [cv, file]);
    for (const ch of chunks) {
      await c.query(
        `INSERT INTO doc_chunks (canvas_id, file, seq, block, text) VALUES ($1,$2,$3,$4,$5)`,
        [cv, file, ch.seq, ch.block, ch.text]
      );
    }
  });
}

export async function chunksMissingEmbedding(): Promise<{ file: string; seq: number; text: string }[]> {
  const { rows } = await getPool().query<{ file: string; seq: number; text: string }>(
    "SELECT file, seq, text FROM doc_chunks WHERE canvas_id = $1 AND embedding IS NULL",
    [currentCanvas()]
  );
  return rows;
}

export async function setChunkEmbedding(file: string, seq: number, vector: number[]): Promise<void> {
  await getPool().query(
    "UPDATE doc_chunks SET embedding = $4::vector WHERE canvas_id = $1 AND file = $2 AND seq = $3",
    [currentCanvas(), file, seq, toVectorLiteral(vector)]
  );
}

/** 질의 벡터에 가까운 청크 top-k. 거리도 함께 돌려준다(노드 검색과 달리 UI 가 근거로 쓴다). */
export async function chunkSearch(
  vector: number[],
  k: number
): Promise<{ file: string; block: string; text: string; dist: number }[]> {
  const { rows } = await getPool().query<{ file: string; block: string; text: string; dist: number }>(
    `SELECT file, block, text, (embedding <=> $1::vector)::float8 AS dist
       FROM doc_chunks
      WHERE canvas_id = $3 AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $2`,
    [toVectorLiteral(vector), k, currentCanvas()]
  );
  return rows.map((r) => ({ ...r, dist: Number(r.dist) }));
}

export async function chunkCount(): Promise<number> {
  const r = await getPool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM doc_chunks WHERE canvas_id = $1",
    [currentCanvas()]
  );
  return Number(r.rows[0].n);
}

/** 문서 1건의 청크 수 — 백필이 "이미 청킹된 문서인가" 를 판정한다. */
export async function chunkCountOf(file: string): Promise<number> {
  const r = await getPool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM doc_chunks WHERE canvas_id = $1 AND file = $2",
    [currentCanvas(), file]
  );
  return Number(r.rows[0].n);
}
```

- [x] **Step 5: 타입체크 + 전체 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 에러 0 · `fail 0` (DB 없는 인메모리 경로라 기존 테스트 영향 없음)

- [x] **Step 6: 커밋**

```bash
git add lib/db/migrations/002-chunks.sql lib/db/schema.sql lib/db.ts
git commit -m "feat(db): doc_chunks 테이블 + 임베딩 768 마이그레이션"
```

---

## Task 4: pyservice v8 — e5-base + docask

**Files:**
- Modify: `pyservice/main.py`, `k8s/pyservice.yaml`

**Interfaces:**
- Produces: `POST /llm {task:"docask", context, question}` → `{ok, result:{answer, citedChunks:number[]}}`

- [x] **Step 1: 모델 교체**

`pyservice/main.py:15`:

```python
MODEL_NAME = "intfloat/multilingual-e5-base"  # 768-dim, 512 tokens, Korean-strong
# ⚠ e5 계열은 "query: " / "passage: " 접두어를 요구한다. 접두어는 호출자(lib/embed.ts)가 붙인다 —
# 여기서 붙이면 이미 붙은 텍스트에 이중으로 들어간다.
```

- [x] **Step 2: `DOCASK_SYSTEM` 추가**

`ASK_SYSTEM` 정의 바로 아래에:

```python
DOCASK_SYSTEM = (
    '너는 사내 문서 질의응답 어시스턴트다. 아래 "문서 청크" 만 근거로 사용자 질문에 한국어 3~6문장으로 답하라. '
    '근거로 삼은 청크 번호를 본문에 [C n] 형식으로 인용하라. 수치·날짜는 청크에 적힌 값을 그대로 옮기고 '
    '계산하거나 추정하지 마라. 청크에 없는 사실은 창작하지 말고, 청크로 답할 수 없으면 그렇게 말하라. '
    'JSON만 출력: {"answer":"...","citedChunks":[n,...]} /no_think'
)
```

- [x] **Step 3: `LLMRequest` 에 필드 추가**

`class LLMRequest(BaseModel)` 에 `context`·`question` 이 이미 있으면(ask 태스크용) 재사용한다.
없으면 추가한다. 확인:

```bash
grep -n "class LLMRequest" -A 12 pyservice/main.py
```

- [x] **Step 4: `_messages` 에 분기 추가**

`if req.task == "ask":` 블록 **다음**에:

```python
    if req.task == "docask":
        return [
            {"role": "system", "content": DOCASK_SYSTEM},
            {"role": "user", "content": f"/no_think 문서 청크:\n{req.context}\n\n질문: {req.question}"},
        ]
```

- [x] **Step 5: 응답 정제에 분기 추가**

`if req.task == "ask":` 정제 블록 **다음**에:

```python
    if req.task == "docask":
        answer = str(out.get("answer") or "").strip()
        if not answer:
            return {"ok": False, "error": "empty answer"}
        return {"ok": True, "result": {"answer": answer, "citedChunks": _to_int_list(out.get("citedChunks"))}}
```

- [x] **Step 6: 메모리 limit 상향**

`k8s/pyservice.yaml` 의 `limits.memory` 를 `2Gi` → `3Gi`. e5-base 실측 피크 RSS 1,687MB.

- [ ] **Step 7: 빌드·배포·검증** — ⏸ 보류: 운영 클러스터 변경이라 Task 8 배포 때 한 번에 수행(코드·매니페스트는 준비 완료)

```bash
# 마스터에서
docker build -t 192.168.0.100:5000/sl-ontoground-pyservice:v8 ./pyservice
docker push 192.168.0.100:5000/sl-ontoground-pyservice:v8
kubectl -n sl-ontoground set image deploy/pyservice pyservice=192.168.0.100:5000/sl-ontoground-pyservice:v8
kubectl -n sl-ontoground patch deploy pyservice --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"3Gi"}]'
kubectl -n sl-ontoground rollout status deploy/pyservice --timeout=600s
```

검증 — 차원이 768인지 직접 확인한다:

```bash
kubectl -n sl-ontoground exec deploy/pyservice -- \
  python -c "import json,urllib.request;
r=urllib.request.urlopen(urllib.request.Request('http://localhost:8000/embed',
  data=json.dumps({'texts':['passage: 테스트']}).encode(),
  headers={'content-type':'application/json'}));
v=json.load(r)['vectors'][0]; print('dim', len(v))"
```

Expected: `dim 768`

- [x] **Step 8: 커밋**

```bash
git add pyservice/main.py k8s/pyservice.yaml
git commit -m "feat(pyservice): e5-base 768dim + docask 태스크 (v8, limit 3Gi)"
```

---

## Task 5: 청크 백필 — `lib/store.ts` 연동

**Files:**
- Modify: `lib/embed.ts`, `lib/store.ts`

**Interfaces:**
- Consumes: `chunkBlocks` (Task 2), `replaceChunks`/`chunksMissingEmbedding`/`setChunkEmbedding` (Task 3), `embedPassage` (Task 1)
- Produces: `backfillChunks(): Promise<{ chunked: number; embedded: number; skipped: boolean }>`

- [x] **Step 1: `lib/embed.ts` 에 청크 백필 추가**

`backfillEmbeddings` 아래에:

```ts
/** 청크가 없는 문서를 청킹하고, embedding IS NULL 청크를 채운다. 멱등.
 * 문서 원본 바이트는 sources.content(업로드) 또는 data/sources(베이스라인)에서 온다 —
 * lib/source-bytes.ts 가 캔버스 소유권까지 확인한 뒤 돌려준다. */
export async function backfillChunks(): Promise<{ chunked: number; embedded: number; skipped: boolean }> {
  if (!dbEnabled() || !embedEnabled()) return { chunked: 0, embedded: 0, skipped: true };

  // ① 아직 청크가 없는 문서를 청킹한다.
  let chunked = 0;
  for (const s of getRuntimeSources()) {
    if (/\.dxf$/i.test(s.file)) continue; // 도면은 원문 텍스트가 없다
    if ((await chunkCountOf(s.file)) > 0) continue;
    const buf = await canvasSourceBytes(s.file);
    if (!buf) continue;
    let blocks;
    try {
      blocks = extractSourceBlocks(s.file, buf, { cap: false }).blocks;
    } catch {
      continue; // 손상 문서 — 그 문서만 청크 0개. 인제스천은 이미 성공했다
    }
    const chunks = chunkBlocks(blocks);
    if (!chunks.length) continue;
    await replaceChunks(s.file, chunks);
    chunked += chunks.length;
  }

  // ② 임베딩이 빈 청크를 배치로 채운다.
  const rows = await chunksMissingEmbedding();
  let embedded = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vecs = await embedPassage(batch.map((r) => r.text));
    if (vecs.length !== batch.length) break; // pyservice 중단 — 다음 호출에 위임(멱등)
    for (let j = 0; j < batch.length; j++) {
      await setChunkEmbedding(batch[j].file, batch[j].seq, vecs[j]);
      embedded++;
    }
  }
  return { chunked, embedded, skipped: false };
}
```

import 를 보강한다:

```ts
import {
  dbEnabled, nodesMissingEmbedding, setEmbedding,
  replaceChunks, chunksMissingEmbedding, setChunkEmbedding,
} from "./db";
import { getRuntimeSources } from "./store";
import { canvasSourceBytes } from "./source-bytes";
import { extractSourceBlocks } from "./source-text";
import { chunkBlocks } from "./chunk";
```

**순환 import 주의**: `lib/store.ts` 가 `lib/embed.ts` 를 import 하고, 이제 `embed.ts` 가
`store.ts` 를 import 한다. Node ESM 은 순환을 허용하지만 초기화 순서에 따라 `undefined` 가
될 수 있다. `getRuntimeSources` 는 **함수 호출 시점**에만 쓰이므로(모듈 최상위에서 부르지
않음) 안전하다. 이 사실을 주석으로 남긴다.

`chunkCountOf` 는 Task 3 에서 이미 `lib/db.ts` 에 만들었다 — import 만 추가한다.

- [x] **Step 2: `scheduleEmbedBackfill` 에서 이어 실행**

`lib/store.ts` 의 백필 호출을 바꾼다:

```ts
  void withCanvas(canvasId, async () => {
    const nodes = await backfillEmbeddings();
    const chunks = await backfillChunks();
    return { nodes, chunks };
  })
    .then((r) => {
      if (!r.nodes.skipped && r.nodes.embedded > 0) console.log(`[embed] 노드 ${r.nodes.embedded}개 임베딩`);
      if (!r.chunks.skipped && (r.chunks.chunked > 0 || r.chunks.embedded > 0))
        console.log(`[embed] 청크 ${r.chunks.chunked}개 생성 / ${r.chunks.embedded}개 임베딩`);
    })
    .catch(() => {})
    .finally(() => { /* 기존 backfillPending 처리 그대로 */ });
```

기존 `backfillRunning`/`backfillPending` 대기열 로직은 **그대로 둔다**. import 에
`backfillChunks` 를 추가한다.

- [x] **Step 3: 타입체크 + 전체 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 에러 0 · `fail 0`

- [x] **Step 4: 커밋**

```bash
git add lib/embed.ts lib/store.ts lib/db.ts
git commit -m "feat(chunk): 청크 백필을 임베딩 백필 대기열에 연결"
```

---

## Task 6: `/api/doc-ask` 라우트

**Files:**
- Create: `app/api/doc-ask/route.ts`
- Modify: `lib/llm.ts`

**Interfaces:**
- Consumes: `embedQuery` (Task 1), `chunkSearch`/`chunkCount` (Task 3)
- Produces:
  - `llmDocAsk(context: string, question: string): Promise<{answer:string; citedChunks:number[]} | null>` (`lib/llm.ts`)
  - `POST /api/doc-ask?canvas=<id>` — §설계 §6 계약

- [x] **Step 1: `lib/llm.ts` 에 docask 래퍼 추가**

`llmAsk` 옆에 같은 모양으로:

```ts
/** 문서 청크 컨텍스트 기반 Q&A. 실패·미가용이면 null(라우트가 503). */
export async function llmDocAsk(
  context: string,
  question: string
): Promise<{ answer: string; citedChunks: number[] } | null> {
  return callLlm<{ answer: string; citedChunks: number[] }>(
    { task: "docask", context, question },
    REVIEW_TIMEOUT_MS,
    "docask"
  );
}
```

`REVIEW_TIMEOUT_MS`(130000)를 쓰는 이유는 `llmAsk` 와 같다 — pyservice 하드 상한(120s)보다
크게 잡아 앱이 먼저 끊지 않게 한다.

- [x] **Step 2: 라우트 작성**

`app/api/doc-ask/route.ts`:

```ts
// POST /api/doc-ask — 캔버스 문서 원문 Q&A(RAG). 객체 선택 없이 자유 질문.
// 질문 → embedQuery → doc_chunks 코사인 top-8 → LLM → [C n] 인용 답변.
// 골든 룰: 인용된 청크의 파일명·블록·원문을 함께 돌려줘 UI 가 근거를 보여준다.
// 객체 앵커 Q&A(/api/ask)와는 별개다 — 성격이 다르므로 통합하지 않는다.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ready } from "@/lib/store";
import { chunkSearch, chunkCount, dbEnabled, getAiOpinion, saveAiOpinion } from "@/lib/db";
import { embedQuery, embedEnabled } from "@/lib/embed";
import { llmDocAsk } from "@/lib/llm";
import { withCanvasRoute } from "@/lib/canvas-route";
import { parseJsonBody } from "@/lib/schemas";
import { fnv1a } from "@/lib/fold";

export const runtime = "nodejs";
// 사내 vLLM 첫 생성 60~90초 — /api/ask 와 동일 여유.
export const maxDuration = 180;

const TOP_K = 8;
const InputSchema = z.object({ question: z.string().trim().min(2).max(500) });

export async function POST(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    const parsed = await parseJsonBody(req, InputSchema);
    if (!parsed.ok) return parsed.response;
    const { question } = parsed.data;
    const t0 = Date.now();

    if (!dbEnabled() || !embedEnabled()) {
      return NextResponse.json(
        { ok: false, error: "문서 질문은 DB 와 pyservice(/embed)가 필요합니다" },
        { status: 503 }
      );
    }
    if ((await chunkCount()) === 0) {
      return NextResponse.json(
        { ok: false, error: "이 캔버스에 청크가 없습니다 — 문서를 먼저 등록하세요", needsDocs: true },
        { status: 409 }
      );
    }

    const key = `docask_${fnv1a(question.trim())}`;
    const cached = await getAiOpinion(key);
    if (cached) {
      return NextResponse.json({
        ok: true, answer: cached.opinion, citedChunks: cached.citedChecks ?? [],
        chunks: [], cached: true, ms: Date.now() - t0,
      });
    }

    const vec = await embedQuery(question);
    if (!vec) {
      return NextResponse.json({ ok: false, error: "질의 임베딩 실패 — pyservice(/embed) 미가용" }, { status: 503 });
    }
    const hits = await chunkSearch(vec, TOP_K);
    const chunks = hits.map((h, i) => ({ n: i + 1, file: h.file, block: h.block, text: h.text }));
    const context = chunks
      .map((c) => `[C${c.n}] ${c.file} · ${c.block}\n${c.text}`)
      .join("\n\n");

    const result = await llmDocAsk(context, question);
    if (!result) {
      return NextResponse.json({ ok: false, error: "LLM 응답 실패 — pyservice(/llm) 미가용이거나 지연" }, { status: 503 });
    }

    await saveAiOpinion(key, { question }, result.answer, result.citedChunks);
    return NextResponse.json({
      ok: true, answer: result.answer, citedChunks: result.citedChunks,
      chunks, cached: false, ms: Date.now() - t0,
    });
  });
}
```

`fnv1a` 의 실제 export 위치를 확인한다(`grep -n "export function fnv1a" lib/fold.ts`).
`getAiOpinion`/`saveAiOpinion` 의 실제 시그니처도 `lib/db.ts` 에서 확인해 맞춘다 —
`/api/ask` 가 `citedRels` 를 `cited_checks` 컬럼에 재사용하는 것과 같은 방식으로
`citedChunks` 를 담는다.

- [x] **Step 3: 타입체크 + 빌드**

Run: `npx tsc --noEmit && npm run build`
Expected: 에러 0 · `/api/doc-ask` 가 동적(ƒ) 라우트로 등록

- [x] **Step 4: 커밋**

```bash
git add app/api/doc-ask lib/llm.ts
git commit -m "feat(api): /api/doc-ask — 문서 원문 RAG"
```

---

## Task 7: UI — 문서 질문 패널

**Files:**
- Create: `components/DocAskPanel.tsx`
- Modify: `components/Workbench.tsx`, `app/globals.css`

**Interfaces:**
- Consumes: `apiFetch` (`lib/api-client.ts`), `reasonOf` (`components/apiError.ts`), `POST /api/doc-ask` (Task 6)

- [x] **Step 1: 패널 작성**

`components/DocAskPanel.tsx`:

```tsx
"use client";

// 우측 패널 — 캔버스 문서 원문에 자유 질문(RAG). 객체 선택이 필요 없다.
// 답변의 [C n] 인용에 대응하는 청크(파일명·블록·원문)를 아래에 그대로 노출한다(골든 룰 1).
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { reasonOf } from "./apiError";

interface ChunkHit { n: number; file: string; block: string; text: string }

interface Props {
  onOpenDoc?: (file: string) => void;
}

export default function DocAskPanel({ onOpenDoc }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [cited, setCited] = useState<number[]>([]);
  const [chunks, setChunks] = useState<ChunkHit[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    const question = q.trim();
    if (question.length < 2 || loading) return;
    setLoading(true); setErr(null); setAnswer(null); setChunks([]);
    try {
      const r = await apiFetch("/api/doc-ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!r.ok) { setErr(await reasonOf(r, "문서 질문 실패")); return; }
      const d = await r.json();
      setAnswer(d.answer ?? "");
      setCited(d.citedChunks ?? []);
      setChunks(d.chunks ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="da-panel">
      <p className="da-hint">문서 원문에 직접 묻습니다. 객체를 고르지 않아도 됩니다.</p>
      <div className="da-input">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
          placeholder="예: 안정성시험 45도 3개월 pH 값은?"
          maxLength={500}
          disabled={loading}
        />
        <button onClick={() => void ask()} disabled={loading || q.trim().length < 2}>
          {loading ? "찾는 중…" : "질문"}
        </button>
      </div>

      {err && <p className="da-err">{err}</p>}

      {answer && (
        <>
          <div className="da-answer">{answer}</div>
          <h4 className="da-h">근거 청크 ({chunks.length})</h4>
          <ul className="da-chunks">
            {chunks.map((c) => (
              <li key={c.n} className={"da-chunk" + (cited.includes(c.n) ? " cited" : "")}>
                <button className="da-src" onClick={() => onOpenDoc?.(c.file)} title="원문 열기">
                  [C{c.n}] {c.file} · {c.block}
                </button>
                <pre className="da-text">{c.text}</pre>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [x] **Step 2: `Workbench.tsx` 배선**

상단바에 버튼을 추가한다(`🤖 질문` 버튼 옆). **capability 게이팅은 하지 않는다** — 문서 질문은
FMEA 타입과 무관하다.

```tsx
<button className="tb-btn" onClick={() => setRightPanelMode("docask")}>
  📖 문서 질문
</button>
```

`rightPanelMode` 유니온 타입에 `"docask"` 를 추가하고, 우측 패널 분기에 넣는다:

```tsx
) : rightPanelMode === "docask" ? (
  <DocAskPanel onOpenDoc={(f) => handleOpenEvidenceFile(f)} />
) : (
```

`handleOpenEvidenceFile` 는 이미 있는 근거 문서 모달 열기 함수다 — 재사용한다.

- [x] **Step 3: CSS**

`app/globals.css` 끝에 추가한다. 새 색을 도입하지 않고 기존 변수만 쓴다.
인용된 청크는 `.lr-ico.active` 와 같은 어휘(시안 좌측 보더)로 강조한다.

```css
/* 문서 질문 패널 — 자유 질문 RAG. 인용 청크는 시안 좌측 보더로 강조(.lr-ico.active 와 같은 어휘). */
.da-panel{display:flex;flex-direction:column;gap:10px;padding:12px}
.da-hint{margin:0;font-size:11.5px;color:var(--ink-dim)}
.da-input{display:flex;gap:6px}
.da-input input{flex:1;min-width:0;padding:7px 9px;border:1px solid var(--line);border-radius:6px;font-size:12.5px;color:var(--ink);background:#fff}
.da-input input:focus{outline:none;border-color:var(--amber)}
.da-input button{padding:7px 12px;border:none;border-radius:6px;background:var(--amber);color:#fff;font-size:12.5px;cursor:pointer;white-space:nowrap}
.da-input button:disabled{opacity:.4;cursor:default}
.da-err{margin:0;padding:8px 10px;border:1px solid #f3ccd6;border-radius:6px;background:#fdf0f3;color:#c2415a;font-size:12px}
.da-answer{padding:10px 12px;border:1px solid var(--line-soft);border-radius:8px;background:var(--bg-raise);font-size:13px;line-height:1.65;color:var(--ink);white-space:pre-wrap}
.da-h{margin:6px 0 0;font-size:11.5px;font-weight:600;color:var(--ink-dim)}
.da-chunks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.da-chunk{border:1px solid var(--line-soft);border-left:3px solid transparent;border-radius:6px;padding:8px 10px;background:#fff}
.da-chunk.cited{border-left-color:var(--amber);background:rgba(0,162,229,.06)}
.da-src{display:block;width:100%;text-align:left;border:none;background:none;padding:0 0 4px;font-size:11.5px;font-weight:600;color:var(--amber);cursor:pointer}
.da-src:hover{text-decoration:underline}
.da-text{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.55;color:var(--ink-dim);white-space:pre-wrap;overflow-x:auto;max-height:180px;overflow-y:auto}
```

`.da-text` 의 `overflow-x:auto` 가 중요하다 — 표 청크는 `A │ B │ C` 형태라 가로로 길다.
없으면 우측 패널이 밀려 레이아웃이 깨진다.

- [x] **Step 4: 타입체크·테스트·빌드**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: 에러 0 · `fail 0` · 빌드 성공

- [x] **Step 5: 커밋**

```bash
git add components/DocAskPanel.tsx components/Workbench.tsx app/globals.css
git commit -m "feat(ui): 문서 질문 패널 — 답변 + 인용 청크 원문 노출"
```

---

## Task 8: 배포·검증

**Files:** 없음(운영 작업)

- [ ] **Step 1: 운영 DB 백업**

**마이그레이션 002 는 단방향이고 기존 임베딩을 폐기한다.** 먼저 백업한다.

```bash
TS=$(date +%Y%m%d-%H%M%S)
kubectl -n sl-ontoground exec sts/postgres -- \
  env PGPASSWORD=slontoDb7Pq2Xr9mK4n pg_dump -U slonto -d slonto --clean --if-exists \
  > ~/slonto-backups/slonto-$TS.sql
gzip -f ~/slonto-backups/slonto-$TS.sql && ls -lh ~/slonto-backups/
```

- [ ] **Step 2: pyservice v8 이 먼저 떠 있는지 확인**

Task 4 Step 7 에서 배포했다. 앱보다 **먼저** 768dim 이어야 한다 — 앱이 먼저 뜨면 384dim
벡터를 768 컬럼에 넣으려다 실패한다.

```bash
kubectl -n sl-ontoground get deploy pyservice -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

Expected: `...pyservice:v8`

- [ ] **Step 3: 앱 배포**

다음 v번호는 클러스터 기준으로 확인한다(로컬 파일명 믿지 말 것 — `CLAUDE.md`).

```bash
kubectl -n sl-ontoground get rs --sort-by=.metadata.creationTimestamp \
  -o custom-columns=IMAGE:.spec.template.spec.containers[0].image | tail -3
# vN = 위 최대값 + 1
docker build -t 192.168.0.100:5000/sl-ontoground:vN .
docker push 192.168.0.100:5000/sl-ontoground:vN
kubectl -n sl-ontoground set image deploy/sl-ontoground web=192.168.0.100:5000/sl-ontoground:vN
kubectl -n sl-ontoground rollout status deploy/sl-ontoground --timeout=300s
```

- [ ] **Step 4: 마이그레이션·백필 확인**

```bash
curl -s -o /dev/null "http://192.168.0.100:30494/api/ontology?canvas=default"
sleep 30   # 노드 245 + 청크 백필
kubectl -n sl-ontoground logs deploy/sl-ontoground --tail=40 | grep -iE "002-chunks|embed|error"
kubectl -n sl-ontoground exec sts/postgres -- env PGPASSWORD=slontoDb7Pq2Xr9mK4n \
  psql -U slonto -d slonto -t -c \
  "SELECT (SELECT count(*) FROM nodes WHERE embedding IS NOT NULL) nodes_emb,
          (SELECT count(*) FROM doc_chunks) chunks,
          (SELECT count(*) FROM doc_chunks WHERE embedding IS NOT NULL) chunks_emb;"
```

Expected: `[db] 002-chunks 마이그레이션 적용` 로그 · `nodes_emb` 245 · `chunks` 수백 · `chunks_emb == chunks`

- [ ] **Step 5: 실제 질문 — 원문에만 있는 값이 나오는지**

설계 §1 의 질문들이 핵심이다. 노드에는 없고 **원문에만** 있는 수치를 물어본다.

```bash
curl -s -X POST "http://192.168.0.100:30494/api/doc-ask?canvas=default" \
  -H 'content-type: application/json' \
  --data-binary @<(node -e 'console.log(JSON.stringify({question:"결로 관련 문서에서 벤트 경로에 대해 뭐라고 하나?"}))')
```

응답의 `answer` 에 원문 문장이 반영되고, `chunks` 에 실제 근거 구절이 담겼는지 사람이 대조한다.

- [ ] **Step 6: 캔버스 격리 확인**

```bash
CV=$(node -e "console.log(encodeURIComponent('화장품'))")
# 화장품 캔버스에서 램프 전용 질문 → 램프 청크가 안 나와야 한다
curl -s -X POST "http://192.168.0.100:30494/api/doc-ask?canvas=$CV" \
  -H 'content-type: application/json' -d '{"question":"헤드램프 결로 대책"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log((j.chunks||[]).map(c=>c.file).join(', ')||j.error)})"
```

Expected: 화장품 문서만 나오거나, 청크가 없으면 409 `needsDocs`. **램프 파일명이 하나라도
나오면 격리 위반이다.**

- [ ] **Step 7: 문서 삭제 시 청크 CASCADE 확인**

```bash
# 임시 캔버스에서 검증 후 purge (운영 캔버스 건드리지 않는다)
```

운영 캔버스를 건드리지 않도록 임시 캔버스에서 검증하고 지운다.

```bash
B=http://192.168.0.100:30494
PSQL="kubectl -n sl-ontoground exec sts/postgres -- env PGPASSWORD=slontoDb7Pq2Xr9mK4n psql -U slonto -d slonto -t -c"

ID=$(curl -s -X POST $B/api/canvases -H 'content-type: application/json'   -d '{"name":"청크시험"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).canvas.id")
CV="?canvas=$(node -pe "encodeURIComponent(process.argv[1])" "$ID")"

for T in proj item fm cause action doc; do
  curl -s -o /dev/null -X POST "$B/api/schema/object-types$CV" -H 'content-type: application/json'     -d "{\"type_id\":\"$T\",\"label_ko\":\"$T\"}"
done

curl -s -o /dev/null -X POST "$B/api/ingest$CV"   -F "file=@docs/화장품/클레임집계_2025_전제품.xlsx"
sleep 20   # 청킹·임베딩 백필

echo "삭제 전 청크 수:"
$PSQL "SELECT count(*) FROM doc_chunks WHERE canvas_id = '$ID';"

curl -s -o /dev/null -X DELETE   "$B/api/sources/$(node -pe "encodeURIComponent('클레임집계_2025_전제품.xlsx')")$CV"

echo "삭제 후 청크 수 (0 이어야 CASCADE 정상):"
$PSQL "SELECT count(*) FROM doc_chunks WHERE canvas_id = '$ID';"

curl -s -o /dev/null -X DELETE "$B/api/canvases/$(node -pe "encodeURIComponent(process.argv[1])" "$ID")"
curl -s -o /dev/null -X DELETE "$B/api/canvases/$(node -pe "encodeURIComponent(process.argv[1])" "$ID")?purge=1"
```

Expected: 삭제 전 청크 수가 20 이상, 삭제 후 **0**. 0이 아니면 FK CASCADE 가 안 걸린 것이다.

- [ ] **Step 8: 문서 갱신**

`docs/architecture.md`(요청 경로에 doc-ask 추가) · `docs/data-model.md`(`doc_chunks` 스키마) ·
`docs/dev-summary.md`(API 표·테스트 수) · `docs/deployment.md`(002 마이그레이션 주의 — 단방향,
pyservice v8 이 먼저) · `CLAUDE.md`(레포 구조에 `lib/chunk.ts` 등).

- [ ] **Step 9: 커밋**

```bash
git add docs CLAUDE.md
git commit -m "docs: 문서 청킹 반영 + vN 배포 기록"
```

---

## 최종 검증 (전체 태스크 완료 후)

- [ ] `npm test` → `fail 0` (기준선 140 + 신규 12 = 약 152)
- [ ] `npx tsc --noEmit` → 에러 0
- [ ] `npm run build` → 성공
- [ ] `grep -rn "embedOne\|embed(" lib/ app/ --include=*.ts | grep -v embedQuery | grep -v embedPassage | grep -v embedRaw | grep -v embedEnabled` → 접두어 없는 임베딩 호출 0건
- [ ] 운영: `nodes.embedding` 245개 · `doc_chunks` 전량 임베딩 완료
- [ ] 운영: 원문에만 있는 수치를 묻는 질문에 근거와 함께 답변
- [ ] 운영: 캔버스 격리 — 타 캔버스 청크가 안 섞임
- [ ] 운영: 문서 삭제 시 `doc_chunks` CASCADE 동작

---

## 배포 순서 주의

**pyservice v8 이 앱보다 먼저 떠야 한다.** 앱이 먼저 뜨면 002 마이그레이션이 `embedding` 을
`vector(768)` 로 만든 뒤, 아직 384dim 을 주는 구버전 pyservice 로 백필을 시도해 전부 실패한다
(에러는 안 나고 청크·노드가 임베딩 없이 남는다 — 조용한 실패다).

롤백: 앱 이미지는 되돌릴 수 있지만 **DB 스키마는 안 된다.** Step 1 의 백업이 유일한 회수 경로다.
