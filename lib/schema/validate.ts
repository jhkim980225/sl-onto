// lib/schema/validate.ts — 형식 온톨로지 스키마 검증(순수 함수, 프레임워크 비의존).
// 메타모델(relation_types domain/range · object_subtypes · property_defs) 대비 실데이터 위반을
// QualityIssue 로 보고만 한다(차단 없음 — 스펙 2026-07-09 §B). 실행(삭제·관계삭제)은 /api/curate 몫.
// 인자 기본값 = store 인메모리 스냅샷 — 테스트는 합성 (nodes, edges, metamodel) 주입.
import type { Node, Edge } from "../types";
import type { QualityIssue } from "../quality";
import type { Metamodel } from "../db/seed-metamodel";
import { allNodes, allEdges, getMetamodel, evidenceOf } from "../store";

// lib/quality.ts 와 동일 관례 — 규칙당 상한(건수 폭주 방지).
const MAX_PER_RULE = 8;

/** 근거 문서 파일명 최대 2개 — 합성 주입 노드는 store 에 없어 자연히 빈 배열. */
function ev(nodeId: string): string[] {
  return evidenceOf(nodeId).slice(0, 2).map((d) => d.filename);
}

const fmt = (types: string[]) => (types.length === 0 ? "*" : types.join("/"));

export function scanSchemaViolations(
  nodes: Node[] = allNodes(),
  edges: Edge[] = allEdges(),
  metamodel: Metamodel = getMetamodel()
): QualityIssue[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const relById = new Map(metamodel.relationTypes.map((r) => [r.rel_id, r]));
  const stKeys = new Set(metamodel.subtypes.map((s) => `${s.type_id}:${s.st_id}`));
  const objNodes = nodes.filter((n) => n.type !== "doc"); // doc 은 노드 규칙 제외

  /* ── rel-domain (85): 엣지 src/dst 타입이 relation_types 제약 밖.
   * 빈 배열 = 제약 없음(스킵) — 미등록·자동 등록 관계(제약 빈 배열)도 자연히 스킵. ── */
  const relDomain: QualityIssue[] = [];
  for (const e of edges) {
    const rt = relById.get(e.rel);
    if (!rt) continue;
    const src = byId.get(e.src);
    const dst = byId.get(e.dst);
    if (!src || !dst) continue;
    const srcOk = rt.src_types.length === 0 || rt.src_types.includes(src.type);
    const dstOk = rt.dst_types.length === 0 || rt.dst_types.includes(dst.type);
    if (srcOk && dstOk) continue;
    relDomain.push({
      kind: "rel-domain",
      title: `${src.label} —${e.rel}→ ${dst.label} — 관계 타입 제약 위반`,
      detail: `${e.rel}은(는) ${fmt(rt.src_types)}→${fmt(rt.dst_types)} 관계인데 ${src.type}→${dst.type}에 사용됨`,
      nodeId: e.src,
      edge: { src: e.src, rel: e.rel, dst: e.dst },
      evidence: ev(e.src),
      confidence: 85,
    });
  }

  /* ── bad-subtype (80): st 값이 object_subtypes 에 (type_id, st_id) 로 없음. ── */
  const badSubtype: QualityIssue[] = [];
  for (const n of objNodes) {
    if (!n.st || stKeys.has(`${n.type}:${n.st}`)) continue;
    badSubtype.push({
      kind: "bad-subtype",
      title: `${n.label} — 정의되지 않은 서브타입 "${n.st}"`,
      detail: `${n.type} 타입에는 서브타입 "${n.st}"이(가) 정의돼 있지 않습니다 — 분류 체계 확인이 필요합니다.`,
      nodeId: n.id,
      evidence: ev(n.id),
      confidence: 80,
    });
  }

  /* ── missing-prop (60): required 속성 누락. 현 시드는 전부 required=false → 실데이터 0건. ── */
  const missingProp: QualityIssue[] = [];
  const requiredDefs = metamodel.propertyDefs.filter((d) => d.required);
  for (const n of objNodes) {
    const keys = new Set((n.props ?? []).map(([k]) => k));
    for (const d of requiredDefs) {
      if (d.type_id !== n.type || keys.has(d.key)) continue;
      missingProp.push({
        kind: "missing-prop",
        title: `${n.label} — 필수 속성 "${d.label_ko}" 누락`,
        detail: `${n.type} 타입의 필수 속성 "${d.key}"이(가) 없습니다.`,
        nodeId: n.id,
        evidence: ev(n.id),
        confidence: 60,
      });
    }
  }

  /* ── bad-datatype (70): 정의된 key 값이 datatype 불일치.
   * number: parseFloat 실패 기준("3 EA" 처럼 선행 숫자는 통과) · enum: options 밖 · text: 항상 통과. ── */
  const badDatatype: QualityIssue[] = [];
  const defByKey = new Map(metamodel.propertyDefs.map((d) => [`${d.type_id}:${d.key}`, d]));
  for (const n of objNodes) {
    for (const [k, v] of n.props ?? []) {
      const d = defByKey.get(`${n.type}:${k}`);
      if (!d || d.datatype === "text") continue;
      const val = (v ?? "").trim();
      const bad =
        d.datatype === "number"
          ? Number.isNaN(parseFloat(val))
          : !(d.options ?? []).includes(val); // enum
      if (!bad) continue;
      badDatatype.push({
        kind: "bad-datatype",
        title: `${n.label} — 속성 "${d.label_ko}" 값 형식 위반`,
        detail:
          d.datatype === "number"
            ? `"${k}"은(는) 숫자(number) 속성인데 값 "${v}"을(를) 숫자로 해석할 수 없습니다.`
            : `"${k}"은(는) 선택형(enum: ${(d.options ?? []).join("/")}) 속성인데 값 "${v}"이(가) 목록에 없습니다.`,
        nodeId: n.id,
        evidence: ev(n.id),
        confidence: 70,
      });
    }
  }

  return [
    ...relDomain.slice(0, MAX_PER_RULE),
    ...badSubtype.slice(0, MAX_PER_RULE),
    ...missingProp.slice(0, MAX_PER_RULE),
    ...badDatatype.slice(0, MAX_PER_RULE),
  ];
}
