// 온톨로지 시드 데이터 — 데모(FMEA_온톨로지_시연_v2.html)의 CORE/CORE_EDGES/DOC_RULES 를
// 타입 계약(Node/Edge)에 맞춰 결정론적으로 포팅한다. (물리/렌더 필드 제외, 랜덤·시각 미사용)
import type { Node, Edge, ObjType } from "./types";

/* ── 원본 CORE 정의 (데모의 필드명 유지: t=type, l=label, s=sub, kv=props) ──
 * FMGAP 의 kv 값에 있던 HTML(<span class="map">…</span> 등)은 가독 텍스트로 정제:
 *   "외관-B" <span class="map">→ GAP-EXT</span> <span class="conf">확신도 0.72</span>
 *   → "외관-B" → GAP-EXT (확신도 0.72)   (원본 코드·표준 매핑·확신도 모두 보존) */
interface RawNode {
  id: string;
  t: ObjType;
  l: string;
  s?: string;
  hero?: boolean;
  hidden?: boolean;
  ax?: number;
  ay?: number;
  kv: [string, string][];
}

const CORE: RawNode[] = [
  { id: "PJ16", t: "proj", ax: 520, ay: 130, l: "PJ 2016-HL03", s: "SUV A 1세대·할로겐", kv: [["차종", "중형 SUV A (1세대)"], ["광원", "할로겐"], ["이슈 이력", "수축 변형"]] },
  { id: "PJ19", t: "proj", ax: 790, ay: 95, l: "PJ 2019-HL07", s: "SUV A 2세대·LED", kv: [["차종", "중형 SUV A (2세대)"], ["광원", "LED"], ["비고", "1세대와 차명 동일하나 형상 전면 변경"]] },
  { id: "PJ21", t: "proj", ax: 1055, ay: 130, l: "PJ 2021-HL12", s: "세단 B·LED+DRL", kv: [["차종", "준중형 세단 B"], ["이슈 이력", "간극 클레임 (PTS-8812)"]] },
  { id: "PJ23", t: "proj", ax: 1240, ay: 200, l: "PJ 2023-HL15", s: "SUV C·LED", kv: [["차종", "중형 SUV C"], ["광원", "LED 분리형"]] },
  { id: "PJ26", t: "proj", ax: 790, ay: 235, l: "PJ 2026-HL21", s: "신규·검토 대상", hidden: true, kv: [["상태", "신규 설계 검토"], ["조건", "아시아향·LED·슬림·밀폐형 하우징"]] },
  { id: "SHKMC", t: "spec", ax: 1300, ay: 90, l: "HKMC ES 스펙", s: "현대·기아", kv: [["고객사", "현대·기아"], ["포함", "시험 방법·외관 기준"]] },
  { id: "SGM", t: "spec", ax: 1450, ay: 140, l: "GMW 스펙", s: "GM", kv: [["고객사", "GM"], ["포함", "북미 요구사항"]] },
  { id: "RKR", t: "reg", ax: 1430, ay: 270, l: "KMVSS", s: "한국", kv: [["국가", "한국"], ["핵심", "배광·광도"]] },
  { id: "RUS", t: "reg", ax: 1465, ay: 380, l: "FMVSS 108", s: "북미", kv: [["국가", "미국·캐나다"], ["핵심", "배광 패턴·DRL 규정"], ["비고", "유럽과 배광 기준 상이"]] },
  { id: "REU", t: "reg", ax: 1450, ay: 490, l: "ECE R149", s: "유럽", kv: [["국가", "유럽"], ["핵심", "배광·컷오프"]] },
  { id: "RCN", t: "reg", ax: 1405, ay: 595, l: "GB 25991", s: "중국", kv: [["국가", "중국"], ["핵심", "자국 인증 별도"]] },
  { id: "CTOL", t: "cause", ax: 245, ay: 265, l: "조립 공차 누적", s: "", kv: [["분류", "조립"], ["발생도 O", "5"]] },
  { id: "CSHRINK", t: "cause", ax: 205, ay: 385, l: "소재 수축 과다", s: "PP-GF", kv: [["분류", "재료"], ["발생도 O", "4"], ["상세", "슬림 형상일수록 수축 영향 증대"]] },
  { id: "CMOLD", t: "cause", ax: 195, ay: 500, l: "금형 치수 오차", s: "", kv: [["분류", "공정"], ["발생도 O", "3"]] },
  { id: "CVENT", t: "cause", ax: 245, ay: 615, l: "벤트·씰링 설계", s: "", kv: [["분류", "설계"], ["발생도 O", "4"]] },
  { id: "CTHERM", t: "cause", ax: 1010, ay: 200, l: "방열 설계 미흡", s: "LED 온도→광량", kv: [["분류", "설계"], ["상세", "LED 온도 상승 → 광량 저하 → 배광 편차"]] },
  { id: "FMGAP", t: "fm", ax: 455, ay: 300, l: "간극 벌어짐", s: "범퍼 매칭부 2mm", kv: [["심각도 S", "6"], ["발생", "PJ 2021-HL12"], ["최초 보고", "2014"], ["원본 코드(2014)", '"외관-B" → GAP-EXT (확신도 0.72)'], ["상태", "재발방지 마스터 등록"]] },
  { id: "FMSTEP", t: "fm", ax: 425, ay: 435, l: "렌즈-하우징 단차", s: "", kv: [["심각도 S", "5"], ["근거", '2D 스캔 주석 ("여기 잘못됨")']] },
  { id: "FMSHRINK", t: "fm", ax: 445, ay: 565, l: "수축 변형", s: "하우징 휨", kv: [["심각도 S", "6"], ["발생", "PJ 2016-HL03"], ["조치 이력", "저수축 소재 변경"]] },
  { id: "FMFOG", t: "fm", ax: 490, ay: 680, l: "결로·습기", s: "렌즈 내부", kv: [["심각도 S", "5"], ["특성", "필드 클레임 빈발 유형"], ["원인", "벤트·씰링"]] },
  { id: "FMBEAM", t: "fm", ax: 1165, ay: 315, l: "배광 편차", s: "법규 부적합 위험", kv: [["심각도 S", "8"], ["위험", "품질 이슈 넘어 규제 위반으로 확대"], ["발생", "PJ 2019-HL07"]] },
  { id: "FMLUM", t: "fm", ax: 1190, ay: 450, l: "휘도 불균일", s: "라이트가이드", kv: [["심각도 S", "5"], ["상세", "분리형 DRL 구성에서 이력"]] },
  { id: "IHL", t: "item", ax: 800, ay: 440, l: "헤드램프 어셈블리", s: "LED·분리형 DRL", hero: true, kv: [["구성", "LED모듈·라이트가이드·하우징·렌즈"], ["BOM", "BOM_HL07_rev4 기준"], ["주변부", "범퍼 매칭 (간극·단차 관리)"]] },
  { id: "ILED", t: "item", ax: 660, ay: 320, l: "LED 모듈", s: "", kv: [["특성", "발열 → 방열 필수"]] },
  { id: "ILG", t: "item", ax: 945, ay: 320, l: "라이트가이드", s: "DRL", kv: [["특성", "휘도 균일성 민감"]] },
  { id: "IHSG", t: "item", ax: 650, ay: 565, l: "하우징", s: "PP-GF", kv: [["소재", "PP-GF"], ["리스크", "수축·간극·단차"]] },
  { id: "ILENS", t: "item", ax: 950, ay: 565, l: "아우터 렌즈", s: "PC", kv: [["소재", "PC"], ["리스크", "단차·결로"]] },
  { id: "AMOLD", t: "action", ax: 320, ay: 720, l: "금형 치수 수정", s: "", kv: [["유형", "공정 조치"], ["사례", "PJ 2021-HL12 간극 개선"]] },
  { id: "AMAT", t: "action", ax: 530, ay: 770, l: "저수축 소재 변경", s: "", kv: [["유형", "재료 조치"], ["사례", "PJ 2016-HL03"]] },
  { id: "AVENT", t: "action", ax: 405, ay: 800, l: "벤트 경로 개선", s: "", kv: [["유형", "설계 조치"]] },
  { id: "ARIB", t: "action", ax: 1045, ay: 705, l: "방열 리브 추가", s: "", kv: [["유형", "설계 조치"], ["효과", "LED 온도 저감"]] },
  { id: "ASIM", t: "action", ax: 1245, ay: 670, l: "배광 시뮬레이션 강화", s: "", kv: [["유형", "검증 조치"], ["시점", "설계 초기"]] },
  { id: "MGAP", t: "master", ax: 650, ay: 790, l: "간극·단차 마스터", s: "", kv: [["성격", "특징별 표준 체크항목"], ["원칙", "신규 개발 시 필수 참조 — 누락 방지"]] },
  { id: "MTHERM", t: "master", ax: 840, ay: 815, l: "LED 방열 마스터", s: "", kv: [["성격", "LED 채용 시 필수"], ["항목", "방열 경로·온도 시뮬·광량"]] },
  { id: "MBEAM", t: "master", ax: 1035, ay: 790, l: "배광 법규 마스터", s: "국가별", kv: [["성격", "국가별 법규 체크"], ["항목", "배광 패턴·DRL·인증"]] },
];

/* ── 원본 CORE_EDGES: [a, b, rel, strong?, scen?] — strong 은 무시, scen(5번째)만 반영 ── */
type RawEdge = [string, string, string, number?, number?];
const CORE_EDGES: RawEdge[] = [
  ["IHL", "ILED", "CONSISTS_OF"], ["IHL", "ILG", "CONSISTS_OF"], ["IHL", "IHSG", "CONSISTS_OF"], ["IHL", "ILENS", "CONSISTS_OF"],
  ["IHSG", "FMGAP", "HAS_FAILURE"], ["IHSG", "FMSTEP", "HAS_FAILURE"], ["IHSG", "FMSHRINK", "HAS_FAILURE"],
  ["ILENS", "FMSTEP", "HAS_FAILURE"], ["ILENS", "FMFOG", "HAS_FAILURE"], ["IHL", "FMBEAM", "HAS_FAILURE"], ["ILG", "FMLUM", "HAS_FAILURE"],
  ["FMGAP", "CSHRINK", "CAUSED_BY"], ["FMGAP", "CMOLD", "CAUSED_BY"], ["FMGAP", "CTOL", "CAUSED_BY"],
  ["FMSTEP", "CTOL", "CAUSED_BY"], ["FMSTEP", "CMOLD", "CAUSED_BY"], ["FMSHRINK", "CSHRINK", "CAUSED_BY"],
  ["FMFOG", "CVENT", "CAUSED_BY"], ["FMBEAM", "CTHERM", "CAUSED_BY"], ["FMLUM", "CSHRINK", "CAUSED_BY"], ["ILED", "CTHERM", "THERMAL_RISK"],
  ["FMGAP", "AMOLD", "MITIGATED_BY"], ["FMSHRINK", "AMAT", "MITIGATED_BY"], ["FMFOG", "AVENT", "MITIGATED_BY"],
  ["CTHERM", "ARIB", "MITIGATED_BY"], ["FMBEAM", "ASIM", "MITIGATED_BY"],
  ["FMGAP", "MGAP", "REF_MASTER"], ["CTHERM", "MTHERM", "REF_MASTER"], ["FMBEAM", "MBEAM", "REF_MASTER"],
  ["FMBEAM", "RUS", "UNDER_REG"], ["FMBEAM", "REU", "UNDER_REG"], ["FMBEAM", "RCN", "UNDER_REG"], ["FMBEAM", "RKR", "UNDER_REG"], ["ILG", "RUS", "DRL_REG"],
  ["PJ21", "FMGAP", "OCCURRED_IN"], ["PJ16", "FMSHRINK", "OCCURRED_IN"], ["PJ19", "FMBEAM", "OCCURRED_IN"], ["PJ23", "FMLUM", "OCCURRED_IN"],
  ["PJ19", "SHKMC", "SPEC_OF"], ["PJ21", "SGM", "SPEC_OF"], ["PJ23", "SHKMC", "SPEC_OF"],
  ["PJ16", "PJ19", "SIMILAR 0.31", 1], ["PJ19", "PJ21", "SIMILAR 0.82", 1], ["PJ21", "PJ23", "SIMILAR 0.77", 1],
  // 시나리오 전용
  ["PJ26", "PJ21", "SIMILAR 0.87", 1, 1], ["PJ26", "PJ19", "SIMILAR 0.74", 1, 1], ["PJ26", "PJ23", "SIMILAR 0.66", 1, 1],
  ["PJ26", "RUS", "TARGET_MARKET", 0, 1], ["PJ26", "IHL", "NEW_DESIGN_OF", 0, 1],
];

/* ── 근거 문서 위성 생성 규칙: [부모, 개수, 확장자 풀] ── */
const DOC_RULES: [string, number, string[]][] = [
  ["FMGAP", 26, ["PTS", "PPTX", "XLSX"]], ["FMSTEP", 14, ["TIF", "PTS", "XLSX"]],
  ["FMSHRINK", 18, ["XLSX", "PPTX", "PTS"]], ["FMFOG", 20, ["PTS", "PPTX"]],
  ["FMBEAM", 22, ["XLSX", "PPTX", "PTS", "SPEC"]], ["FMLUM", 12, ["XLSX", "TIF"]],
  ["PJ16", 16, ["XLSX", "BOM", "TIF"]], ["PJ19", 22, ["XLSX", "BOM", "PPTX"]],
  ["PJ21", 20, ["XLSX", "BOM", "PTS"]], ["PJ23", 14, ["XLSX", "BOM"]],
  ["MGAP", 8, ["PPTX", "XLSX"]], ["MTHERM", 8, ["XLSX"]], ["MBEAM", 10, ["SPEC", "XLSX"]],
  ["RUS", 6, ["SPEC"]], ["REU", 5, ["SPEC"]], ["SHKMC", 7, ["SPEC"]], ["SGM", 5, ["SPEC"]],
  ["IHL", 10, ["BOM", "TIF"]], ["CSHRINK", 6, ["XLSX"]], ["CTHERM", 7, ["XLSX", "PPTX"]],
];

const FN_WORD: Record<string, string[]> = {
  PTS: ["클레임", "외관", "배광", "결로", "간극"],
  PPTX: ["재발방지", "대책서", "품질회의", "개선보고"],
  XLSX: ["FMEA", "검토시트", "시험결과", "치수측정"],
  TIF: ["도면스캔", "단면주석", "조립도"],
  BOM: ["BOM", "부품표"],
  SPEC: ["스펙", "시험방법", "요구사항"],
};

function docName(ext: string, i: number): string {
  const words = FN_WORD[ext];
  const w = words[i % words.length];
  const yr = 2010 + ((i * 7) % 16);
  if (ext === "PTS") return `PTS-${7000 + i * 13}_${w}`;
  const x = ext === "BOM" ? "xlsx" : ext.toLowerCase();
  return `${w}_HL${String(3 + (i % 19)).padStart(2, "0")}_${yr}.${x}`;
}

/* ══════════ 빌드: CORE → Node, CORE_EDGES → Edge, DOC_RULES → doc Node + EVIDENCED_BY Edge ══════════ */

const nodes: Node[] = CORE.map((r) => {
  const n: Node = { id: r.id, type: r.t, label: r.l, props: r.kv };
  if (r.s !== undefined) n.sub = r.s;
  if (r.hero) n.hero = true;
  if (r.hidden) n.hidden = true;
  if (r.ax !== undefined) n.ax = r.ax;
  if (r.ay !== undefined) n.ay = r.ay;
  return n;
});

const edges: Edge[] = CORE_EDGES.map(([a, b, rel, , scen]) => {
  const e: Edge = { src: a, rel, dst: b, scen: !!scen };
  if (rel.startsWith("SIMILAR ")) {
    const w = parseFloat(rel.slice("SIMILAR ".length));
    e.rel = "SIMILAR";
    e.weight = w;
  }
  return e;
});

// 근거 문서 위성 — 데모의 nextDoc 카운터/네이밍을 결정론적으로 재현
let nextDoc = 0;
for (const [pid, cnt, exts] of DOC_RULES) {
  for (let i = 0; i < cnt; i++) {
    const ext = exts[i % exts.length];
    const id = "D" + nextDoc++;
    nodes.push({
      id,
      type: "doc",
      label: docName(ext, nextDoc),
      sub: ext,
      ext,
      parent: pid,
      props: [["형식", ext], ["정형화", "Docling 추출 완료"]],
    });
    edges.push({ src: pid, rel: "EVIDENCED_BY", dst: id });
  }
}

export const NODES: Node[] = nodes;
export const EDGES: Edge[] = edges;
