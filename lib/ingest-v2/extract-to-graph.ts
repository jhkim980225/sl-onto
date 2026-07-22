// lib/ingest-v2/extract-to-graph.ts — LLM 추출 결과 → 그래프 엔티티·관계 순수 변환.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md §0(소스=씨앗·그래프=진실) §2
// LLM 호출 없음 — lib/llm.ts llmExtract() 의 출력({entities,relations})을 EntityInput/RelationInput 으로 옮긴다.

import { createHash } from "node:crypto";
import type { EntityInput, RelationInput } from "../neo4j/types.ts";

export type ExtractedEntity = { type: string; label: string; id?: string };
export type ExtractedRelation = { srcLabel: string; rel: string; dstLabel: string };
export type Extracted = { entities: ExtractedEntity[]; relations: ExtractedRelation[] };

/** ascii-safe 슬러그. 한글 등 비-ascii 는 제거되므로 sha1 접미사로 안정적 유일성을 보강한다. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\x00-\x7f]/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** type+label 로부터 결정적 id 생성. 같은 입력 → 같은 id(캔버스 내 문서 간 중복 제거용). */
export function entityId(type: string, label: string): string {
  const key = `${type}|${label}`;
  const base = slugify(key);
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 8);
  return base ? `${base}-${hash}` : hash;
}

export function extractToGraph(ex: Extracted): { entities: EntityInput[]; relations: RelationInput[] } {
  const entities: EntityInput[] = [];
  const idsSeen = new Set<string>();
  const labelToId = new Map<string, string>();

  for (const e of ex.entities) {
    const id = e.id ?? entityId(e.type, e.label);
    if (!labelToId.has(e.label)) labelToId.set(e.label, id);
    if (idsSeen.has(id)) continue; // dedup: 첫 등장의 name/type 유지
    idsSeen.add(id);
    entities.push({ id, name: e.label, type: e.type, props: {} });
  }

  const relations: RelationInput[] = [];
  for (const r of ex.relations) {
    const src = labelToId.get(r.srcLabel);
    const dst = labelToId.get(r.dstLabel);
    if (!src || !dst) continue; // 미해결 라벨 → 드롭
    if (src === dst) continue; // self-loop → 드롭
    relations.push({ src, dst, type: r.rel });
  }

  return { entities, relations };
}
