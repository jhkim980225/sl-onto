// lib/ingest/llm-assist.ts — LLM 추출 결과(task=extract) → 온톨로지 델타 변환. 순수 함수(프레임워크·store 비의존).
// 규약은 resolveOrCreate 와 동일선상: vocab id 가 오면 기존 노드 재사용, label 만 오면 통제 어휘 정규화를
// 먼저 시도하고 실패 시 AUTO_* 생성(확신도 0.60 — 규칙 auto-create 0.66 보다 낮게, props 에 ["추출","LLM"] 표기).
// 관계는 라벨 fold 매칭(lib/fold.ts foldKey)만 — 이번 델타·기존 온톨로지 어느 쪽에도 없는 라벨의 관계는
// 버린다(창작 방지). 새 노드는 EVIDENCED_BY 로 doc 노드에 연결(근거 우선 골든 룰).
import type { Node, Edge, ObjType } from "../types";
import type { LlmExtractResult } from "../llm";
import { normalize, resolveOrCreate } from "./normalize";
import { foldKey } from "../fold";

const LLM_CONF = "0.60"; // LLM 추출 확신도 — 규칙 auto-create(0.66)보다 낮게 노출(골든 룰 #2)

const ALLOWED_TYPES = new Set<ObjType>(["item", "fm", "cause", "action", "proj"]);
const ALLOWED_RELS = new Set(["HAS_FAILURE", "CAUSED_BY", "MITIGATED_BY", "OCCURRED_IN"]);

export interface LlmDelta {
  nodes: Node[];
  edges: Edge[];
}

/** LLM 추출 결과를 mergeDelta 에 넣을 수 있는 노드/엣지 델타로 변환.
 * @param existing 기존 온톨로지 노드(관계 라벨 fold 매칭 + "이미 있는 노드" 판정용 — 보통 allNodes()) */
export function llmExtractToDelta(res: LlmExtractResult, docId: string, existing: Node[]): LlmDelta {
  const existingIds = new Set(existing.map((n) => n.id));
  const existingById = new Map(existing.map((n) => [n.id, n]));
  // fold 라벨 → id. 기존 온톨로지를 먼저 깔고(선점 우선), 이번 델타 개체가 뒤에 추가된다.
  const labelToId = new Map<string, string>();
  const mapLabel = (label: string, id: string) => {
    const k = foldKey(label);
    if (k && !labelToId.has(k)) labelToId.set(k, id);
  };
  for (const n of existing) if (n.type !== "doc") mapLabel(n.label, n.id);

  const nodes = new Map<string, Node>();
  for (const e of res.entities ?? []) {
    const type = e.type as ObjType;
    if (!ALLOWED_TYPES.has(type)) continue;
    const rawLabel = (e.label ?? "").normalize("NFC").trim();

    let id: string | null = null;
    let label = rawLabel;
    // 1) vocab/기존 id — 실재하는 id 만 재사용(창작 id 폐기). 라벨은 그 노드의 권위 라벨.
    if (e.id) {
      const known = existingById.get(e.id);
      if (known) {
        id = known.id;
        label = known.label;
      } else {
        // 기존 온톨로지에 아직 없는 vocab id 도 허용 — normalize(무 side effect)로 실재만 확인.
        const r = normalize(e.id);
        if (r.id) {
          id = r.id;
          label = r.label ?? label;
        }
      }
    }
    // 2) label — 통제 어휘 정규화(동의어 포함) 재사용, 실패 시 AUTO_*(결정론적 해시 → 규칙 경로와 dedupe)
    let isAuto = false;
    if (!id) {
      if (!rawLabel) continue;
      const r = resolveOrCreate(rawLabel, type);
      if (!r.id) continue;
      id = r.id;
      label = r.label ?? rawLabel;
      isAuto = id.startsWith("AUTO_");
    }

    if (!nodes.has(id)) {
      const node: Node = { id, type: existingById.get(id)?.type ?? type, label };
      if (isAuto && !existingIds.has(id)) node.props = [["추출", "LLM"], ["확신도", LLM_CONF]];
      nodes.set(id, node);
    }
    mapLabel(label, id);
    if (rawLabel) mapLabel(rawLabel, id); // 원문 라벨로도 관계가 매칭되게(정규화로 라벨이 바뀐 경우)
  }

  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();
  for (const r of res.relations ?? []) {
    if (!ALLOWED_RELS.has(r.rel)) continue;
    const src = labelToId.get(foldKey(r.srcLabel ?? ""));
    const dst = labelToId.get(foldKey(r.dstLabel ?? ""));
    if (!src || !dst || src === dst) continue; // 매칭 실패 관계는 버림(창작 방지)
    const key = `${src}|${r.rel}|${dst}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ src, rel: r.rel, dst });
  }

  // 새로 들어온 노드는 이 문서를 근거로 연결(기존 노드의 근거는 건드리지 않는다 — 원본 보존).
  for (const id of nodes.keys()) {
    if (!existingIds.has(id)) edges.push({ src: id, rel: "EVIDENCED_BY", dst: docId });
  }
  return { nodes: [...nodes.values()], edges };
}
