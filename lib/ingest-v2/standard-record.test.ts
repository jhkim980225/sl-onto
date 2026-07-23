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
