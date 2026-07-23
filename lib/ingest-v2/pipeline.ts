// lib/ingest-v2/pipeline.ts — v2 인제스천: 파일 → 원문 텍스트 → LLM 추출 → 그래프 적재.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md
// 소스는 씨앗, 그래프가 진실 — provenance 연결 없음(v1과 달리 doc 노드를 만들지 않는다).
import { extractSourceBlocks } from "../source-text";
import { parseEml, emailToText } from "./email";
import { llmGraphExtract } from "../llm";
import { extractToGraph } from "./extract-to-graph";
import { embedPassage } from "../embed";
import { repoFor } from "../neo4j/canvas-repo";
import { buildStandardRecord, toDocumentInput, EMPTY_SOURCE, type DocSource } from "./standard-record";
import type { StandardDocRecord } from "../neo4j/types";

const LLM_TEXT_CAP = 12000; // LLM 입력 상한(문자 수)

export interface IngestResult {
  entities: number;
  relations: number;
  skipped?: string;
  document?: StandardDocRecord;
}

/** 파일 버퍼 → 그래프 적재. 한 파일의 실패는 throw 하지 않고 skipped 로 보고한다. */
export async function ingestFileToGraph(canvasId: string, fileName: string, buf: Buffer): Promise<IngestResult> {
  try {
    const isEml = fileName.toLowerCase().endsWith(".eml");
    const parsed = isEml ? parseEml(buf) : null;
    const rawText = parsed
      ? emailToText(parsed)
      : extractSourceBlocks(fileName, buf, { cap: false }).blocks.flatMap((b) => b.lines).join("\n");
    const text = rawText.slice(0, LLM_TEXT_CAP);
    if (!text.trim()) return { entities: 0, relations: 0, skipped: "추출된 텍스트 없음" };

    const extracted = await llmGraphExtract(text); // v2 범용 추출(FMEA 아님)
    if (!extracted) return { entities: 0, relations: 0, skipped: "LLM 추출 실패" };

    const { entities, relations } = extractToGraph(extracted);
    if (!entities.length) return { entities: 0, relations: 0, skipped: "추출된 엔티티 없음" };

    let vecs: number[][] = [];
    try {
      vecs = await embedPassage(entities.map((e) => [e.name, ...Object.values(e.props ?? {})].join(" ")));
    } catch {
      vecs = []; // 임베딩 미가용 — 임베딩 없이 적재
    }
    if (vecs.length === entities.length) {
      entities.forEach((e, i) => {
        if (vecs[i]?.length) e.embedding = vecs[i];
      });
    }

    const repo = repoFor(canvasId);
    await repo.ensureSchema();
    for (const e of entities) await repo.upsertEntity(e);
    for (const r of relations) await repo.upsertRelation(r);

    const source: DocSource = parsed
      ? { from: parsed.from, to: parsed.to, date: parsed.date, subject: parsed.subject }
      : EMPTY_SOURCE;
    const record = buildStandardRecord(fileName, source, extracted);
    await repo.upsertDocument(toDocumentInput(record, new Date().toISOString()));
    await repo.linkMentions(record.id, entities.map((e) => e.id));

    return { entities: entities.length, relations: relations.length, document: record };
  } catch (err) {
    return { entities: 0, relations: 0, skipped: `인제스천 실패: ${err instanceof Error ? err.message : String(err)}` };
  }
}
