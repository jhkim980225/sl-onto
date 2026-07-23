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
