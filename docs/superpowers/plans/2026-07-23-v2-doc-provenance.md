# v2 문서 규격화 + Document 노드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비정형 문서 인제스천이 표준 JSON 규격을 산출하고, Neo4j에 Document 노드(요약·분류·출처 + MENTIONS 근거)를 만든다.

**Architecture:** 기존 v2 파이프라인(`파일→원문→llmGraphExtract→extractToGraph→Neo4j`)에 얹는다. graphextract 프롬프트가 summary·doc_type을 함께 뱉고(1콜), 파이프라인이 표준 레코드를 만들어 Document 노드로 upsert + 추출 개체를 MENTIONS로 연결한다. Document 노드는 `record`(표준 JSON 문자열) 속성에 통째로 저장해 조회 API가 무손실 반환한다.

**Tech Stack:** Next.js App Router(TS) · Neo4j(pod-per-canvas, neo4j-driver) · pyservice(FastAPI, qwen3 vLLM) · 테스트 `node --test --experimental-strip-types`(TS) / pytest(py).

## Global Constraints

- 값은 반드시 Cypher `params`로만 바인딩(문자열 보간 금지) — `docs/.../2026-07-22-v2-neo4j-foundation-design.md` §4.
- 순수/IO 분리: 도메인 변환은 `lib/`의 순수 함수, Neo4j 쓰기는 `canvas-repo`/`repo.ts`.
- `EMBEDDING_DIM = 768` 불변. 엔티티 결정적 id·dedup 로직 변경 금지.
- 스키마 DDL은 멱등(`IF NOT EXISTS`), `SCHEMA_STATEMENTS`에 추가.
- TS 테스트 파일은 기존 HOOK 프리앰블(확장자 없는 상대 import 해석) 포함 — Task 1 코드 참조.
- 한 문서의 실패는 throw 하지 않고 `skipped`로 보고(기존 `ingestFileToGraph` 정책).
- 배포: pyservice 변경→**pyservice v12**, 앱 변경→**v2 앱 v5**. `scripts/deploy-v2.py` 원샷. 롤백=이미지 태그.

---

### Task 1: 표준 레코드 + Document 입력(순수 변환)

**Files:**
- Create: `lib/ingest-v2/standard-record.ts`
- Test: `lib/ingest-v2/standard-record.test.ts`

**Interfaces:**
- Consumes: `LlmExtractResult`(Task 6에서 summary?/doc_type? 추가 — 이 태스크는 옵셔널 필드를 관대하게 읽음), `DocumentInput`·`StandardDocRecord`(Task 2).
- Produces: `buildStandardRecord(id: string, source: DocSource, ex: LlmExtractResult): StandardDocRecord`, `toDocumentInput(rec: StandardDocRecord, ingestedAt: string): DocumentInput`, `EMPTY_SOURCE: DocSource`, `interface DocSource { from: string; to: string; date: string; subject: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/ingest-v2/standard-record.test.ts — 표준 레코드 변환 회귀.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const { buildStandardRecord, toDocumentInput, EMPTY_SOURCE } = await import("./standard-record.ts");

const EX = {
  summary: " 성진이 견적 요청 ",
  doc_type: "견적",
  entities: [{ type: "인물", label: "정아라" }, { type: "거래처", label: "태성켐" }],
  relations: [{ srcLabel: "정아라", rel: "소속", dstLabel: "주식회사 성진" }],
};

test("buildStandardRecord: label→name, srcLabel/rel/dstLabel→subject/predicate/object, trim", () => {
  const rec = buildStandardRecord("mail.eml", { from: "a", to: "b", date: "d", subject: "s" }, EX);
  assert.equal(rec.id, "mail.eml");
  assert.equal(rec.doc_type, "견적");
  assert.equal(rec.summary, "성진이 견적 요청");
  assert.deepEqual(rec.source, { from: "a", to: "b", date: "d", subject: "s" });
  assert.deepEqual(rec.entities, [{ name: "정아라", type: "인물" }, { name: "태성켐", type: "거래처" }]);
  assert.deepEqual(rec.relations, [{ subject: "정아라", predicate: "소속", object: "주식회사 성진" }]);
});

test("buildStandardRecord: summary/doc_type 없으면 빈 문자열", () => {
  const rec = buildStandardRecord("x", EMPTY_SOURCE, { entities: [], relations: [] });
  assert.equal(rec.summary, "");
  assert.equal(rec.doc_type, "");
  assert.deepEqual(rec.source, { from: "", to: "", date: "", subject: "" });
});

test("toDocumentInput: record 는 표준 JSON 문자열, 필드 평탄화", () => {
  const rec = buildStandardRecord("mail.eml", { from: "a", to: "b", date: "d", subject: "s" }, EX);
  const doc = toDocumentInput(rec, "2026-07-23T00:00:00.000Z");
  assert.equal(doc.id, "mail.eml");
  assert.equal(doc.docType, "견적");
  assert.equal(doc.subject, "s");
  assert.equal(doc.ingestedAt, "2026-07-23T00:00:00.000Z");
  assert.deepEqual(JSON.parse(doc.record), rec);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="buildStandardRecord|toDocumentInput"`
Expected: FAIL — `Cannot find module './standard-record.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/ingest-v2/standard-record.ts — 추출 결과 → 표준 JSON 레코드 + Document 입력(순수, IO 없음).
// 설계: docs/superpowers/specs/2026-07-23-v2-doc-provenance-standard-extraction-design.md §3, §6
import type { LlmExtractResult } from "../llm";
import type { DocumentInput, StandardDocRecord } from "../neo4j/types";

export interface DocSource {
  from: string;
  to: string;
  date: string;
  subject: string;
}

export const EMPTY_SOURCE: DocSource = { from: "", to: "", date: "", subject: "" };

/** 추출 결과(내부 label/srcLabel 형태) → 표준 규격(name/subject·predicate·object). */
export function buildStandardRecord(id: string, source: DocSource, ex: LlmExtractResult): StandardDocRecord {
  return {
    id,
    doc_type: (ex.doc_type ?? "").trim(),
    summary: (ex.summary ?? "").trim(),
    source,
    entities: ex.entities.map((e) => ({ name: e.label, type: e.type })),
    relations: ex.relations.map((r) => ({ subject: r.srcLabel, predicate: r.rel, object: r.dstLabel })),
  };
}

/** 표준 레코드 → Neo4j Document 노드 입력. record 에 표준 JSON 통째 보관(무손실 조회용). */
export function toDocumentInput(rec: StandardDocRecord, ingestedAt: string): DocumentInput {
  return {
    id: rec.id,
    docType: rec.doc_type,
    summary: rec.summary,
    from: rec.source.from,
    to: rec.source.to,
    date: rec.source.date,
    subject: rec.source.subject,
    ingestedAt,
    record: JSON.stringify(rec),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="buildStandardRecord|toDocumentInput"`
Expected: PASS (3 tests). Task 2가 아직이면 타입 import 에러가 날 수 있으니 Task 2와 함께 실행해도 된다.

- [ ] **Step 5: Commit**

```bash
git add lib/ingest-v2/standard-record.ts lib/ingest-v2/standard-record.test.ts
git commit -m "feat(v2): 표준 레코드 변환(순수) + 테스트"
```

---

### Task 2: 도메인 타입 + 스키마 제약

**Files:**
- Modify: `lib/neo4j/types.ts` (끝에 추가 + `GraphRepo` 인터페이스 확장)
- Modify: `lib/neo4j/schema.ts`

**Interfaces:**
- Produces: `DocumentInput`, `StandardDocRecord`, `GraphRepo.upsertDocument/linkMentions/getDocument`, `DOCUMENT_ID_CONSTRAINT`.

- [ ] **Step 1: 타입 추가 (`lib/neo4j/types.ts` 끝에)**

```ts
/** Neo4j Document 노드 입력 — 문서 단위 근거(요약·분류·출처) + 표준 레코드 통째 보관. */
export interface DocumentInput {
  id: string;
  docType: string;
  summary: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  ingestedAt: string;
  record: string; // JSON.stringify(StandardDocRecord)
}

/** 문서당 표준 교환 규격(interchange). GET /api/v2/document/[id] 가 반환. */
export interface StandardDocRecord {
  id: string;
  doc_type: string;
  summary: string;
  source: { from: string; to: string; date: string; subject: string };
  entities: { name: string; type: string }[];
  relations: { subject: string; predicate: string; object: string }[];
}
```

- [ ] **Step 2: `GraphRepo` 인터페이스에 메서드 추가 (`lib/neo4j/types.ts`, `fullGraph()` 선언 아래)**

```ts
  /** 문서 노드 upsert(근거 복원). */
  upsertDocument(d: DocumentInput): Promise<void>;
  /** 문서 → 개체 MENTIONS 연결. entityIds 가 비면 no-op. */
  linkMentions(docId: string, entityIds: string[]): Promise<void>;
  /** 문서 id → 저장된 표준 레코드(없으면 null). */
  getDocument(id: string): Promise<StandardDocRecord | null>;
```

`GraphRepo`가 `DocumentInput`·`StandardDocRecord`를 참조하므로 두 타입은 인터페이스보다 위에 선언한다(같은 파일이라 호이스팅 무관하나 가독성 위해 위쪽 배치 권장).

- [ ] **Step 3: 스키마 제약 추가 (`lib/neo4j/schema.ts`)**

`ENTITY_TYPE_INDEX` 선언 아래에:

```ts
/** Document.id 유일 제약 — 문서 upsert(MERGE) 앵커. */
export const DOCUMENT_ID_CONSTRAINT =
  "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE";
```

`SCHEMA_STATEMENTS` 배열에 `DOCUMENT_ID_CONSTRAINT` 추가:

```ts
export const SCHEMA_STATEMENTS: string[] = [
  ENTITY_ID_CONSTRAINT,
  ENTITY_VECTOR_INDEX,
  ENTITY_TYPE_INDEX,
  DOCUMENT_ID_CONSTRAINT,
];
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: `repo.ts`가 `GraphRepo` 신규 메서드 미구현으로 에러(Task 4에서 구현) — **이 태스크 단독 커밋 금지**, Task 3·4와 묶어 커밋한다. 신규 타입/상수 자체에 에러 없으면 통과.

- [ ] **Step 5: (커밋은 Task 4와 함께)**

---

### Task 3: Cypher 빌더 + 테스트

**Files:**
- Modify: `lib/neo4j/cypher.ts`
- Test: `lib/neo4j/cypher.test.ts` (신규)

**Interfaces:**
- Consumes: `DocumentInput`(Task 2), `CypherQuery`.
- Produces: `buildUpsertDocument`, `buildLinkMentions`, `buildGetDocument`, `buildFullGraphDocuments`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/neo4j/cypher.test.ts — Document/MENTIONS Cypher 빌더 회귀(값은 params 로만).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

const HOOK = `
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const { buildUpsertDocument, buildLinkMentions, buildGetDocument } = await import("./cypher.ts");

test("buildUpsertDocument: MERGE(id) + 모든 값 params 바인딩", () => {
  const q = buildUpsertDocument({
    id: "m.eml", docType: "견적", summary: "s", from: "a", to: "b",
    date: "d", subject: "sub", ingestedAt: "t", record: "{}",
  });
  assert.match(q.cypher, /MERGE \(d:Document \{id: \$id\}\)/);
  assert.equal(q.params.id, "m.eml");
  assert.equal(q.params.record, "{}");
  assert.ok(!/"m\.eml"/.test(q.cypher), "id 가 cypher 문자열에 보간되면 안 됨");
});

test("buildLinkMentions: UNWIND ids MERGE MENTIONS", () => {
  const q = buildLinkMentions("m.eml", ["e1", "e2"]);
  assert.match(q.cypher, /UNWIND \$ids AS eid/);
  assert.match(q.cypher, /MERGE \(d\)-\[:MENTIONS\]->\(e\)/);
  assert.deepEqual(q.params.ids, ["e1", "e2"]);
});

test("buildGetDocument: record 반환", () => {
  const q = buildGetDocument("m.eml");
  assert.match(q.cypher, /RETURN d\.record/);
  assert.equal(q.params.id, "m.eml");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="buildUpsertDocument|buildLinkMentions|buildGetDocument"`
Expected: FAIL — 빌더 미정의.

- [ ] **Step 3: Write implementation (`lib/neo4j/cypher.ts` 끝에)**

```ts
import type { DocumentInput } from "./types"; // 파일 상단 기존 import 에 DocumentInput 추가

/** MERGE(id) 로 Document upsert — 모든 값 params. */
export function buildUpsertDocument(d: DocumentInput): CypherQuery {
  requireId(d.id, "buildUpsertDocument");
  return {
    cypher:
      "MERGE (d:Document {id: $id}) " +
      "SET d.doc_type = $docType, d.summary = $summary, d.from = $from, d.to = $to, " +
      "d.date = $date, d.subject = $subject, d.ingested_at = $ingestedAt, d.record = $record " +
      "RETURN d",
    params: {
      id: d.id, docType: d.docType, summary: d.summary, from: d.from, to: d.to,
      date: d.date, subject: d.subject, ingestedAt: d.ingestedAt, record: d.record,
    },
  };
}

/** Document → 여러 Entity 를 MENTIONS 로 연결(멱등). */
export function buildLinkMentions(docId: string, entityIds: string[]): CypherQuery {
  requireId(docId, "buildLinkMentions");
  return {
    cypher:
      "MATCH (d:Document {id: $docId}) " +
      "UNWIND $ids AS eid " +
      "MATCH (e:Entity {id: eid}) " +
      "MERGE (d)-[:MENTIONS]->(e)",
    params: { docId, ids: entityIds },
  };
}

/** id 로 저장된 표준 레코드(record 문자열) 조회. */
export function buildGetDocument(id: string): CypherQuery {
  requireId(id, "buildGetDocument");
  return { cypher: "MATCH (d:Document {id: $id}) RETURN d.record AS record", params: { id } };
}

/** 전체 Document + MENTIONS(그래프 렌더에 문서 허브 포함). */
export function buildFullGraphDocuments(): CypherQuery {
  return { cypher: "MATCH (d:Document) OPTIONAL MATCH (d)-[m:MENTIONS]->(e:Entity) RETURN d, e", params: {} };
}
```

`cypher.ts` 상단 import 를 `import type { CypherQuery, DocumentInput, EntityInput, RelationInput } from "./types";` 로 확장.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="buildUpsertDocument|buildLinkMentions|buildGetDocument"`
Expected: PASS (3 tests).

- [ ] **Step 5: (커밋은 Task 4와 함께)**

---

### Task 4: Repo 구현 (Document/MENTIONS + fullGraph 확장)

**Files:**
- Modify: `lib/neo4j/repo.ts`

**Interfaces:**
- Consumes: Task 3 빌더, `DocumentInput`/`StandardDocRecord`(Task 2).
- Produces: `Neo4jGraphRepo.upsertDocument/linkMentions/getDocument` + `fullGraph()` 가 Document 노드(type "문서")·MENTIONS 관계 포함.

- [ ] **Step 1: import 확장 (`lib/neo4j/repo.ts` 상단)**

`./cypher` import 에 `buildUpsertDocument, buildLinkMentions, buildGetDocument, buildFullGraphDocuments` 추가.
`./types` import 에 `DocumentInput, StandardDocRecord` 추가.

- [ ] **Step 2: Document 노드 → Entity 형상 매퍼 추가 (`toEntity` 아래)**

```ts
/** Document 노드 → 그래프 렌더용 Entity 형상(type "문서", props.kind="document"). */
function docNodeToEntity(node: Node): Entity {
  const raw = node.properties as Record<string, unknown>;
  const id = String(raw.id);
  return {
    id,
    name: String(raw.subject || id),
    type: "문서",
    props: {
      kind: "document",
      doc_type: String(raw.doc_type ?? ""),
      summary: String(raw.summary ?? ""),
    },
  };
}
```

- [ ] **Step 3: 메서드 구현 (`Neo4jGraphRepo` 클래스에, `fullGraph` 위)**

```ts
  async upsertDocument(d: DocumentInput): Promise<void> {
    await runQuery(this.driver, buildUpsertDocument(d));
  }

  async linkMentions(docId: string, entityIds: string[]): Promise<void> {
    if (entityIds.length === 0) return;
    await runQuery(this.driver, buildLinkMentions(docId, entityIds));
  }

  async getDocument(id: string): Promise<StandardDocRecord | null> {
    const rows = await runQuery(this.driver, buildGetDocument(id));
    const rec = rows[0]?.record;
    if (typeof rec !== "string" || !rec) return null;
    try {
      return JSON.parse(rec) as StandardDocRecord;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4: `fullGraph()` 확장 — 문서 노드·MENTIONS 병합 (return 직전에 추가)**

`fullGraph()`의 기존 `return { entities: [...entities.values()], relations };` **직전에** 삽입:

```ts
    // 문서 노드(type "문서")와 MENTIONS 를 그래프에 합류 — 문서가 개체를 묶는 허브.
    const docRows = await runQuery(this.driver, buildFullGraphDocuments());
    for (const row of docRows) {
      const d = row.d;
      const e = row.e;
      if (isNode(d)) entities.set(String(d.properties.id), docNodeToEntity(d));
      if (isNode(d) && isNode(e)) {
        relations.push({ src: String(d.properties.id), dst: String(e.properties.id), type: "MENTIONS" });
      }
    }
```

- [ ] **Step 5: 타입체크 + 기존 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 통과(GraphRepo 구현 완성) + 기존 TS 테스트 전부 PASS(Task 1·3 포함). fullGraph 의 Neo4j 동작은 e2e(Task 9)에서 검증 — 여기선 빌드·타입까지.

- [ ] **Step 6: Commit (Task 2·3·4 묶음)**

```bash
git add lib/neo4j/types.ts lib/neo4j/schema.ts lib/neo4j/cypher.ts lib/neo4j/cypher.test.ts lib/neo4j/repo.ts
git commit -m "feat(v2): Document 노드·MENTIONS repo/cypher/스키마 + fullGraph 문서 합류"
```

---

### Task 5: pyservice — graphextract 프롬프트 + summary/doc_type 정규화

**Files:**
- Modify: `pyservice/main.py` (`GRAPHEXTRACT_SYSTEM`, `_norm_extract`)
- Test: `pyservice/test_llm.py` (테스트 추가)

**Interfaces:**
- Produces: graphextract 결과 dict 에 `summary`·`doc_type` 문자열 포함(없으면 "").

- [ ] **Step 1: Write the failing test (`pyservice/test_llm.py` 에 추가)**

```python
def test_norm_extract_passes_summary_and_doc_type():
    from main import _norm_extract
    out = _norm_extract({
        "summary": " 성진 견적 요청 ",
        "doc_type": "견적",
        "entities": [{"type": "인물", "label": "정아라"}],
        "relations": [{"srcLabel": "정아라", "rel": "소속", "dstLabel": "성진"}],
    })
    assert out["summary"] == "성진 견적 요청"
    assert out["doc_type"] == "견적"
    assert out["entities"] == [{"type": "인물", "label": "정아라"}]

def test_norm_extract_defaults_missing_summary_doc_type_to_empty():
    from main import _norm_extract
    out = _norm_extract({"entities": [], "relations": []})
    assert out["summary"] == ""
    assert out["doc_type"] == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd pyservice && python -m pytest test_llm.py -k norm_extract -q`
Expected: FAIL — 반환 dict 에 `summary` 키 없음(KeyError).

- [ ] **Step 3: `_norm_extract` return 수정 (`pyservice/main.py`)**

기존 `return {"entities": entities, "relations": relations}` 를:

```python
    return {
        "summary": str(out.get("summary") or "").strip(),
        "doc_type": str(out.get("doc_type") or "").strip(),
        "entities": entities,
        "relations": relations,
    }
```

- [ ] **Step 4: `GRAPHEXTRACT_SYSTEM` 프롬프트 수정 (`pyservice/main.py`)**

```python
GRAPHEXTRACT_SYSTEM = (
    '너는 비정형 업무 문서에서 지식그래프를 추출한다. 도메인 무관 개체(사람·조직·제품·원료·문서 등)와 '
    '그 관계를 뽑아라. label 은 원문 표기 그대로. 관계는 srcLabel(출발 label)·rel(짧은 동사구)·dstLabel(도착 label). '
    '추가로 문서 전체를 요약한 summary(1~2문장 한국어)와 문서 분류 doc_type(짧은 라벨, 예: 견적·자료요청·원료소개)도 반환하라. '
    'JSON만 출력: {"summary":"...","doc_type":"견적",'
    '"entities":[{"type":"person","label":"김철수"},{"type":"org","label":"아크메"}],'
    '"relations":[{"srcLabel":"김철수","rel":"소속","dstLabel":"아크메"}]} /no_think'
)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd pyservice && python -m pytest test_llm.py -k norm_extract -q`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add pyservice/main.py pyservice/test_llm.py
git commit -m "feat(pyservice): graphextract summary·doc_type 추출 + 정규화"
```

---

### Task 6: llm.ts 결과 타입 확장

**Files:**
- Modify: `lib/llm.ts` (`LlmExtractResult`)

**Interfaces:**
- Produces: `LlmExtractResult` 에 `summary?: string`·`doc_type?: string`.

- [ ] **Step 1: 타입 확장**

`LlmExtractResult` 를:

```ts
export interface LlmExtractResult {
  entities: LlmExtractEntity[];
  relations: LlmExtractRelation[];
  summary?: string;   // graphextract 만 채움(extract 는 미포함 → undefined)
  doc_type?: string;
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/llm.ts
git commit -m "feat(v2): LlmExtractResult 에 summary·doc_type 옵셔널 추가"
```

---

### Task 7: 파이프라인 배선 (Document upsert + MENTIONS + 표준 레코드 반환)

**Files:**
- Modify: `lib/ingest-v2/pipeline.ts`

**Interfaces:**
- Consumes: `buildStandardRecord`·`toDocumentInput`·`EMPTY_SOURCE`(Task 1), `parseEml`·`emailToText`(기존), repo 신규 메서드(Task 4).
- Produces: `IngestResult` 에 `document?: StandardDocRecord`.

- [ ] **Step 1: import + IngestResult 확장**

상단 import 수정/추가:

```ts
import { parseEml, emailToText } from "./email";
import { buildStandardRecord, toDocumentInput, EMPTY_SOURCE, type DocSource } from "./standard-record";
import type { StandardDocRecord } from "../neo4j/types";
```

`IngestResult` 확장:

```ts
export interface IngestResult {
  entities: number;
  relations: number;
  skipped?: string;
  document?: StandardDocRecord;
}
```

- [ ] **Step 2: 본문 수정 — 원문 추출 시 이메일 메타 확보**

`ingestFileToGraph` 안, 기존 rawText 추출부를:

```ts
    const isEml = fileName.toLowerCase().endsWith(".eml");
    const parsed = isEml ? parseEml(buf) : null;
    const rawText = parsed
      ? emailToText(parsed)
      : extractSourceBlocks(fileName, buf, { cap: false }).blocks.flatMap((b) => b.lines).join("\n");
```

- [ ] **Step 3: 표준 레코드 생성 + Document/MENTIONS upsert**

`extractToGraph` 호출 이후, 엔티티/관계 upsert 이후에 삽입. 최종 반환도 교체:

```ts
    const source: DocSource = parsed
      ? { from: parsed.from, to: parsed.to, date: parsed.date, subject: parsed.subject }
      : EMPTY_SOURCE;
    const record = buildStandardRecord(fileName, source, extracted);

    // ... (기존: repo.ensureSchema, upsertEntity 루프, upsertRelation 루프) ...

    await repo.upsertDocument(toDocumentInput(record, new Date().toISOString()));
    await repo.linkMentions(record.id, entities.map((e) => e.id));

    return { entities: entities.length, relations: relations.length, document: record };
```

참고: `extractToGraph` 가 개체 0을 반환하면 기존대로 `skipped`로 조기 반환된다. 그 경우 Document 도 만들지 않는다(개체 없는 문서는 이번 범위에서 스킵 — 설계 §8의 "summary만 있는 문서" 보존은 후속). 조기 반환 위치는 변경하지 않는다.

- [ ] **Step 4: 타입체크 + 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: PASS(전체). 파이프라인의 Neo4j 동작은 e2e(Task 9).

- [ ] **Step 5: Commit**

```bash
git add lib/ingest-v2/pipeline.ts
git commit -m "feat(v2): 인제스천에 Document 노드·MENTIONS·표준 레코드 배선"
```

---

### Task 8: 문서 조회 API

**Files:**
- Create: `app/api/v2/document/[id]/route.ts`

**Interfaces:**
- Consumes: `repoFor`(기존), `getDocument`(Task 4).
- Produces: `GET /api/v2/document/[id]?canvas=` → `{ ok, document: StandardDocRecord }` | 404 | 400 | 503.

- [ ] **Step 1: 라우트 작성**

```ts
// GET /api/v2/document/[id]?canvas=<id> — 저장된 표준 레코드(§3) 반환.
// 설계: docs/superpowers/specs/2026-07-23-v2-doc-provenance-standard-extraction-design.md §7
import { NextResponse } from "next/server";
import { repoFor } from "@/lib/neo4j/canvas-repo";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const canvas = new URL(req.url).searchParams.get("canvas");
  if (!canvas) return NextResponse.json({ ok: false, error: "canvas 파라미터가 필요합니다" }, { status: 400 });

  const { id } = await params;
  try {
    const document = await repoFor(canvas).getDocument(decodeURIComponent(id));
    if (!document) return NextResponse.json({ ok: false, error: "문서를 찾을 수 없습니다" }, { status: 404 });
    return NextResponse.json({ ok: true, document });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Neo4j 연결 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 503 }
    );
  }
}
```

- [ ] **Step 2: 빌드 검증**

Run: `npm run build`
Expected: 라우트 목록에 `/api/v2/document/[id]` 등장, 에러 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/v2/document
git commit -m "feat(v2): GET /api/v2/document/[id] 표준 레코드 조회"
```

---

### Task 9: 배포 + e2e 스모크

**Files:** 없음(배포·검증만). 배포 스크립트 `scripts/deploy-v2.py`(기존).

- [ ] **Step 1: 전체 테스트·빌드 확인**

Run: `npm test && npx tsc --noEmit && npm run build && (cd pyservice && python -m pytest -q)`
Expected: 전부 PASS / 에러 0.

- [ ] **Step 2: 배포 (앱 v5 + pyservice v12)**

Run: `FEDA_PW='<ssh 비번>' python scripts/deploy-v2.py`
Expected: `=== DEPLOY OK ===`, 두 deploy 1/1, 마지막 스모크에서 `/api/v2/canvases` 응답.

- [ ] **Step 3: e2e — 이메일 1건 업로드 → 표준 레코드 + 그래프 문서 노드**

```bash
# NodePort 확인
PORT=30495   # 배포 로그의 v2= URL 에서 확인
CANVAS=demo
# 이메일 업로드
curl -s -F "file=@docs/source/email/20260720_12469_[RE][성진] PEAR FREESIA E-161 향료 노트 문의의 건.eml" \
  "http://192.168.0.100:$PORT/api/v2/ingest?canvas=$CANVAS" | python -m json.tool
# → 응답에 "document": {id, doc_type, summary, source, entities, relations}
DOCID='20260720_12469_[RE][성진] PEAR FREESIA E-161 향료 노트 문의의 건.eml'
curl -s "http://192.168.0.100:$PORT/api/v2/document/$(python -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$DOCID")?canvas=$CANVAS" | python -m json.tool
# → 표준 레코드 반환
curl -s "http://192.168.0.100:$PORT/api/v2/graph?canvas=$CANVAS" | python -c "import sys,json;g=json.load(sys.stdin);print('문서노드', sum(1 for e in g['entities'] if e['type']=='문서'), '/ MENTIONS', sum(1 for r in g['relations'] if r['type']=='MENTIONS'))"
# → 문서노드 ≥1 / MENTIONS ≥1
```

Expected: 인제스천 응답에 표준 `document` 레코드, `GET /api/v2/document/[id]`가 §3 규격 반환, 그래프에 `type:"문서"` 노드 + `MENTIONS` 관계 등장.

- [ ] **Step 4: 배포 기록 갱신 + 커밋·푸시**

`docs/deployment.md` v2 런북의 "현재 배포" 줄을 **v2 앱 v5 · pyservice v12**로 갱신.

```bash
git add docs/deployment.md
git commit -m "docs(v2): 배포 v5/pyservice v12 — 문서 규격화·Document 노드"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- §3 표준 규격 → Task 1(변환)·Task 2(타입)·Task 8(노출). ✓
- §4 Document 노드·MENTIONS·제약 → Task 2(제약)·3·4. ✓
- §5 추출 변경(프롬프트·정규화·llm 타입) → Task 5·6. ✓
- §6 파이프라인 → Task 7. ✓
- §7 API + 그래프 렌더(문서 노드 type "문서", MENTIONS) → Task 4(fullGraph)·8. ✓
  (그래프 토글은 프론트가 `type==="문서"`로 필터 가능 — 별도 프론트 태스크 불필요, 렌더러가 타입 노드 이미 그림.)
- §8 에러 처리 → Task 5(빈 문자열 폴백)·Task 7(개체 0 조기반환 주석). ✓
- §9 테스트 → Task 1·3·5 단위 + Task 9 e2e. ✓
- §10 배포 → Task 9. ✓

**Placeholder scan:** 코드 스텝 전부 실제 코드. TODO/TBD 없음.

**Type consistency:** `DocumentInput`(docType/from/to/date/subject/ingestedAt/record)·`StandardDocRecord`(doc_type/source/entities[name,type]/relations[subject,predicate,object])·`GraphRepo.upsertDocument/linkMentions/getDocument`·빌더명(`buildUpsertDocument`/`buildLinkMentions`/`buildGetDocument`/`buildFullGraphDocuments`)·문서노드 type 리터럴 `"문서"`·MENTIONS 관계 type `"MENTIONS"` — 태스크 간 일치.
