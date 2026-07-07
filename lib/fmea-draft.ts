// FMEA 초안 생성 — 신규 설계 조건 + 온톨로지 탐색으로 DFMEA 워크시트(xlsx)를 채운다.
// 산출물: 부품/기능·잠재적 고장모드·영향·S·원인·O·설계관리·D·RPN·우선순위·권고조치·근거.
// docs/features/fmea-draft.md
import * as XLSX from "xlsx";
import type { DesignInput, Node } from "./types";
import { getNode, allNodes, neighbors, evidenceOf } from "./store";

const propOf = (n: Node | undefined, sub: string): string | undefined =>
  n?.props?.find(([k]) => k.replace(/\s+/g, "").includes(sub))?.[1];
const numOf = (n: Node | undefined, sub: string, def: number): number => {
  const m = propOf(n, sub)?.match(/\d+/);
  return m ? parseInt(m[0], 10) : def;
};

export interface FmeaRow {
  item: string; func: string; fm: string; effect: string; S: number;
  cause: string; O: number; ctrlPrev: string; ctrlDet: string; D: number;
  rpn: number; priority: string; action: string; evidence: string;
}

const priorityOf = (rpn: number) => (rpn >= 125 ? "높음" : rpn >= 60 ? "중" : "낮음");

/** 대상 부품 노드 해소: 입력 부품(라벨 포함) + 그 구성(CONSISTS_OF). 없으면 헤드램프 어셈블리 기본. */
function targetItems(input: DesignInput): Node[] {
  const items = new Map<string, Node>();
  const add = (n?: Node) => { if (n && n.type === "item") items.set(n.id, n); };
  const names = input.components ?? [];
  for (const nm of names) {
    const hit = allNodes().find((n) => n.type === "item" && (n.label.includes(nm) || nm.includes(n.label)));
    add(hit);
    if (hit) for (const c of neighbors(hit.id, { rel: "CONSISTS_OF", dir: "out" })) add(c);
  }
  if (items.size === 0) {
    const ihl = getNode("IHL") ?? allNodes().find((n) => n.type === "item" && n.hero);
    add(ihl);
    if (ihl) for (const c of neighbors(ihl.id, { rel: "CONSISTS_OF", dir: "out" })) add(c);
  }
  return [...items.values()];
}

/** 조건 관련 부스트 — 신규 설계 조건에 맞는 고장모드/원인을 우선순위에 반영(발생도 가중). */
function conditionBoostO(input: DesignInput, fm: Node, cause: Node | undefined): number {
  let boost = 0;
  const shape = input.shape.join(" ");
  const txt = `${fm.label} ${cause?.label ?? ""}`;
  if (/슬림/.test(shape) && /수축|변형/.test(txt)) boost += 1; // 슬림 → 수축 발생도↑
  if (/LED/i.test(input.lightSource) && /방열|발열|열|배광/.test(txt)) boost += 1;
  return boost;
}

const MAX_ROWS = 40;         // DFMEA 초안 상한(가독)
const MAX_CAUSES_PER_FM = 3; // fm 당 원인 상한
const MAX_ACTIONS = 3;       // 행당 권고조치 상한

// FMEA 초안은 큐레이션된 백본(사람이 검증한 인과)만 사용한다.
// auto-create 된 벌크 엔티티는 조합 링크 노이즈가 있어 초안 문서엔 부적합.
const isAuto = (n: Node) => n.id.startsWith("AUTO_");
/** 큐레이션 우선, 있으면 큐레이션만. 없으면(부득이) 원본 유지. */
const preferCurated = <T extends Node>(arr: T[]): T[] => {
  const cur = arr.filter((n) => !isAuto(n));
  return cur.length ? cur : arr;
};

export function buildFmeaRows(input: DesignInput): FmeaRow[] {
  const rows: FmeaRow[] = [];
  for (const item of targetItems(input)) {
    const func = propOf(item, "기능") || item.sub || "-";
    const fms = preferCurated(
      neighbors(item.id, { rel: "HAS_FAILURE", dir: "out" }).filter((n) => n.type === "fm")
    );
    for (const fm of fms) {
      const S = numOf(fm, "심각도", 5);
      const effect = propOf(fm, "영향") || fm.sub || "성능·품질 저하";
      const masters = neighbors(fm.id, { rel: "REF_MASTER", dir: "out" }).map((m) => m.label);
      const fmActionNodes = preferCurated(neighbors(fm.id, { rel: "MITIGATED_BY", dir: "out" }));
      const ev = evidenceOf(fm.id).slice(0, 2).map((d) => d.filename);
      const causes = preferCurated(
        neighbors(fm.id, { rel: "CAUSED_BY", dir: "out" }).filter((n) => n.type === "cause")
      ).slice(0, MAX_CAUSES_PER_FM);
      const causeList: (Node | undefined)[] = causes.length ? causes : [undefined];
      for (const cause of causeList) {
        const O = Math.min(10, numOf(cause, "발생도", 4) + conditionBoostO(input, fm, cause));
        const D = numOf(cause, "검출도", 5);
        const rpn = S * O * D;
        const causeActionNodes = cause ? preferCurated(neighbors(cause.id, { rel: "MITIGATED_BY", dir: "out" })) : [];
        // 조치: fm·원인 대책(큐레이션)을 합쳐 상위 3개만
        const actionMap = new Map<string, Node>();
        for (const a of [...fmActionNodes, ...causeActionNodes]) if (!actionMap.has(a.id)) actionMap.set(a.id, a);
        const actions = [...actionMap.values()].slice(0, MAX_ACTIONS).map((a) => a.label);
        rows.push({
          item: item.label, func, fm: fm.label, effect, S,
          cause: cause?.label ?? "원인 조사 필요", O,
          ctrlPrev: masters[0] ? `${masters[0]} 참조` : "설계 표준 검토",
          ctrlDet: "설계 검토·시뮬레이션 검증", D,
          rpn, priority: priorityOf(rpn),
          action: actions.join(", ") || "대책 수립 필요",
          evidence: ev.join(", "),
        });
      }
    }
  }
  // 같은 (고장모드,원인)은 부품 간 중복 제거 — RPN 높은 것 유지
  rows.sort((a, b) => b.rpn - a.rpn || b.S - a.S);
  const dedup: FmeaRow[] = [];
  const seenFmCause = new Set<string>();
  for (const r of rows) {
    const k = `${r.fm}|${r.cause}`;
    if (seenFmCause.has(k)) continue;
    seenFmCause.add(k);
    dedup.push(r);
  }
  return dedup.slice(0, MAX_ROWS);
}

const HEADER = [
  "No", "부품/기능", "잠재적 고장모드", "잠재적 고장의 영향", "심각도(S)",
  "잠재적 고장원인", "발생도(O)", "현행 설계관리(예방)", "현행 설계관리(검출)",
  "검출도(D)", "RPN", "우선순위", "권고 조치사항", "근거",
];

/** DFMEA 초안 워크북(xlsx) 버퍼 생성. */
export function buildFmeaWorkbook(input: DesignInput, meta: { date: string }): Buffer {
  const rows = buildFmeaRows(input);
  const cond = `${input.market} · ${input.lightSource} · ${input.shape.join(", ")}`;
  const aoa: (string | number)[][] = [
    ["설계 FMEA (DFMEA) 초안 — SL OntoGround 자동 생성"],
    ["대상", (input.components ?? ["헤드램프 어셈블리"]).join(", "), "설계조건", cond, "작성일", meta.date],
    [`총 ${rows.length}개 고장모드-원인 라인 · RPN = S×O×D · 확신도 검토용 초안(최종 판단은 설계 엔지니어)`],
    [],
    HEADER,
    ...rows.map((r, i) => [
      i + 1, `${r.item}${r.func && r.func !== "-" ? ` / ${r.func}` : ""}`, r.fm, r.effect, r.S,
      r.cause, r.O, r.ctrlPrev, r.ctrlDet, r.D, r.rpn, r.priority, r.action, r.evidence,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 4 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 7 }, { wch: 16 }, { wch: 7 },
    { wch: 18 }, { wch: 18 }, { wch: 7 }, { wch: 6 }, { wch: 7 }, { wch: 28 }, { wch: 28 },
  ];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 13 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 13 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "DFMEA초안");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
