// scripts/gen-sources.ts — 온톨로지 seed(권위 데이터)를 사람이 작성한 듯한 실제 원천 파일로 내보낸다.
// 실행: node --experimental-strip-types scripts/gen-sources.ts
//
// 결정적(no Math.random / no Date): 같은 seed → 같은 바이트에 가까운 파일. 파일명·행 순서 고정.
// 생성물: data/sources/  (FMEA xlsx ×4, 재발방지 pptx ×2, 품질리포트 docx ×2, 참조 마스터 xlsx ×4)
//
// FMEA/pptx/docx 는 라벨 기반(자연스러움) — normalize.ts 가 id 로 매핑.
// 참조 마스터 xlsx 는 id 컬럼을 명시 — 라운드트립 충실도 보장.
import { NODES, EDGES } from "../lib/seed.ts";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const PptxGen = require("pptxgenjs");
const docx = require("docx");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "sources");
fs.mkdirSync(OUT, { recursive: true });

/* ── seed 조회 헬퍼 ── */
type SNode = (typeof NODES)[number];
const N = new Map(NODES.map((n) => [n.id, n]));
const node = (id: string): SNode => {
  const n = N.get(id);
  if (!n) throw new Error("missing seed node " + id);
  return n;
};
const label = (id: string) => node(id).label;
const outByRel = (id: string, rel: string) => EDGES.filter((e) => e.src === id && e.rel === rel).map((e) => e.dst);
const inByRel = (id: string, rel: string) => EDGES.filter((e) => e.dst === id && e.rel === rel).map((e) => e.src);
const prop = (id: string, key: string) => node(id).props?.find(([k]) => k === key)?.[1] ?? "";
const hl = (projId: string) => (label(projId).match(/HL\d+/)?.[0] ?? projId);

const writeXlsx = (file: string, sheets: { name: string; rows: Record<string, unknown>[] }[]) => {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, path.join(OUT, file));
  console.log("  xlsx", file, "·", sheets.reduce((a, s) => a + s.rows.length, 0), "rows");
};

/* ══════════ 1. FMEA 검토시트 (xlsx) — 프로젝트별 워크북 ══════════ */
// 각 워크북이 다루는 고장모드(그 프로젝트가 겪었거나 관련된). 행 = seed 엣지를 걸어 유도.
const WB: Record<string, string[]> = {
  PJ16: ["FMSHRINK"],
  PJ19: ["FMBEAM", "FMSTEP", "FMFOG"],
  PJ21: ["FMGAP"],
  PJ23: ["FMLUM"],
};

// ponytail: 예전에는 이 for 루프가 모듈 로드시 즉시 실행됐다(항상 전체 재생성만 하던 스크립트라
// 문제없었음). --bom 전용 실행 경로를 추가하며 함수로 감싸 main()에서만 호출하도록 분리.
function buildBackboneFmea() {
  for (const [projId, fmIds] of Object.entries(WB)) {
    const rows: Record<string, unknown>[] = [];
    for (const fmId of fmIds) {
      const items = inByRel(fmId, "HAS_FAILURE"); // item -> fm
      const causes = outByRel(fmId, "CAUSED_BY"); // fm -> cause
      const actions = outByRel(fmId, "MITIGATED_BY"); // fm -> action
      const occurred = inByRel(fmId, "OCCURRED_IN"); // proj -> fm
      const S = prop(fmId, "심각도 S");
      const 조치 = actions[0] ? label(actions[0]) : "";
      const 발생프로젝트 = occurred.includes(projId) ? label(projId) : "";
      for (const itemId of items) {
        for (const causeId of causes) {
          rows.push({
            부품: label(itemId),
            기능: node(itemId).sub || "기능 유지",
            고장모드: label(fmId),
            원인: label(causeId),
            영향: node(fmId).sub || "품질 저하",
            심각도S: S,
            발생도O: prop(causeId, "발생도 O"),
            현행조치: 조치,
            // 원본코드: 2014년 최초 보고 시의 비표준 코드(외관-B) → 매핑 시연용 (간극 행에만)
            원본코드: fmId === "FMGAP" ? "외관-B" : "",
            발생프로젝트: 발생프로젝트,
          });
        }
      }
    }
    writeXlsx(`FMEA_${hl(projId)}_검토시트.xlsx`, [{ name: "FMEA", rows }]);
  }
}

/* ══════════ 1b. 현실적 대량 FMEA (자동차 램프 도메인 풀) ══════════
 * 백본(위)은 seed 에서 유도 — 그대로 유지. 여기에 실제 램프 FMEA 처럼 보이는 대량 행을
 * 도메인 풀에서 결정론적으로 합성해 얹는다(반복 허용 → 노드 다양성은 풀 크기로 유계).
 * 통제 어휘에 있는 라벨은 기존 id 로, 나머지는 normalize 의 auto-create 로 편입된다. */

// 부품(item) — 앞 5개는 통제 어휘(IHL/ILED/ILG/IHSG/ILENS)와 일치, 나머지는 신규.
const ITEM_POOL = [
  "헤드램프 어셈블리", "LED 모듈", "라이트가이드", "하우징", "아우터 렌즈",
  "리플렉터", "베젤", "히트싱크", "방열판", "커넥터", "방수벤트", "실링 개스킷",
  "DRL 모듈", "턴시그널 모듈", "포지션 램프", "리어 콤비램프", "스톱램프", "안개등",
  "PCB 기판", "브라켓", "에이밍 스크류", "확산시트", "커버렌즈", "이너렌즈",
  "광학 렌즈", "쉴드", "LED 드라이버", "하네스", "방열 그리스", "데코레이션 링",
  "실링 러버", "벤트 캡", "마운팅 브라켓", "광원 홀더", "프로젝션 렌즈", "리플렉터 베이스",
];
// 고장모드(fm) — 앞 6개 통제 어휘(FMGAP/FMSTEP/FMBEAM/…/FMLUM) 라벨 포함.
const FM_POOL = [
  "간극 벌어짐", "렌즈-하우징 단차", "배광 편차", "결로·습기", "수축 변형", "휘도 불균일",
  "광도 부족", "색편차", "렌즈 크랙", "코팅 박리", "도금 부식", "융착 불량",
  "LED 조기 사멸", "플리커", "광축 틀어짐", "씰링 파단", "내부 이물", "백화",
  "황변", "소음·진동", "커넥터 접촉불량", "열변형", "광량 저하", "배광 얼룩",
  "렌즈 변색", "하우징 크랙", "접착 박리", "표면 스크래치", "통전 불량", "방수 불량",
  "광원 점멸", "배선 단선",
];
// 원인(cause) — 앞 5개 통제 어휘(CSHRINK/CMOLD/CTOL/CTHERM/CVENT) 라벨 포함.
const CAUSE_POOL = [
  "소재 수축 과다", "금형 치수 오차", "조립 공차 누적", "방열 설계 미흡", "벤트·씰링 설계",
  "접착 조건 불량", "융착 조건 부적정", "도금 두께 편차", "전원 리플", "열충격",
  "UV 노화", "광학 설계 오류", "진동 내구 부족", "사출 조건 편차", "재료 물성 편차",
  "냉각 불균일", "공정 관리 미흡", "설계 검증 부족", "씰 압축력 부족", "커넥터 단자 산화",
  "방수 경로 설계 미흡", "광원 배치 오류", "히트싱크 접촉 불량", "코팅 두께 부족", "게이트 위치 부적정",
];
// 조치(action) — 앞 5개 통제 어휘(AMOLD/AMAT/ARIB/AVENT/ASIM) 라벨 포함.
const ACTION_POOL = [
  "금형 치수 수정", "저수축 소재 변경", "방열 리브 추가", "벤트 경로 개선", "배광 시뮬레이션 강화",
  "접착 조건 변경", "실링 이중화", "광학 재설계", "융착 조건 최적화", "도금 공정 관리 강화",
  "히트싱크 용량 증대", "커넥터 방청 처리", "게이트 위치 변경", "냉각 회로 개선", "공차 재배분",
  "UV 안정제 첨가", "진동 시험 강화", "방수 구조 보강", "광원 배치 수정", "사출 조건 표준화",
];
const FN_POOL = ["배광 형성", "광원 발광", "광 가이드", "구조 지지", "방수·방진", "방열", "체결", "색상 구현", "광 확산", "전원 공급", "신호 전달", "외관 품질 유지"];
const EFFECT_POOL = ["법규 부적합 위험", "필드 클레임 발생", "외관 품질 저하", "광 성능 저하", "조기 고장", "감성 품질 저하", "안전 기능 상실 위험", "재작업 비용 증가", "고객 불만", "리콜 리스크"];
const PREVENT_POOL = ["설계 FMEA 반영", "DFM 검토", "금형 초도 검증", "소재 승인 시험", "방열 시뮬레이션", "공차 분석", "표준 준수 점검", "신뢰성 시험 계획"];
const DETECT_POOL = ["전수 외관 검사", "치수 측정 SPC", "광학 성능 검사", "방수 시험", "열충격 시험", "진동 내구 시험", "통전 검사", "샘플 파괴 검사"];
// 프로젝트 — 앞부분은 백본(PJ16/19/21/23) 라벨과 일치, 나머지는 신규 플랫폼(auto-create).
const PROJ_POOL = [
  "PJ 2016-HL03", "PJ 2017-HL05", "PJ 2018-HL06", "PJ 2019-HL07", "PJ 2020-HL09",
  "PJ 2021-HL12", "PJ 2022-HL13", "PJ 2023-HL15", "PJ 2024-HL17", "PJ 2025-HL19",
];
const STATUS_POOL = ["진행", "완료", "보류"];

const pick = <T>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length];
const pad2 = (n: number) => String(n).padStart(2, "0");

// 대량 FMEA 워크북(플랫폼별). 파일명은 "FMEA"로 시작해야 파서의 FMEA 분기를 탄다.
const BULK_WB: { file: string; count: number }[] = [
  { file: "FMEA_HL05_전장품_검토시트.xlsx", count: 94 },
  { file: "FMEA_HL06_헤드램프_검토시트.xlsx", count: 88 },
  { file: "FMEA_HL09_리어콤비_검토시트.xlsx", count: 84 },
  { file: "FMEA_HL13_DRL모듈_검토시트.xlsx", count: 80 },
  { file: "FMEA_HL17_안개등_검토시트.xlsx", count: 78 },
  { file: "FMEA_HL19_통합신뢰성_검토시트.xlsx", count: 72 },
];

function buildBulkFmea() {
  BULK_WB.forEach((wb, wi) => {
    const rows: Record<string, unknown>[] = [];
    for (let j = 0; j < wb.count; j++) {
      const k = wi * 131 + j; // 워크북별로 어긋나게 — 결정론적 전역 인덱스
      const S = 3 + (k % 8); // 3..10
      const O = 2 + ((k * 3) % 7); // 2..8
      const D = 2 + ((k * 5) % 8); // 2..9
      const item = pick(ITEM_POOL, k * 7 + wi);
      const fm = pick(FM_POOL, k * 3 + 1);
      const cause = pick(CAUSE_POOL, k * 5 + 2);
      const action = pick(ACTION_POOL, k * 11 + wi);
      const proj = pick(PROJ_POOL, k * 13 + wi);
      const y = 2016 + (k % 9);
      const mo = (k % 12) + 1;
      const da = ((k * 7) % 28) + 1;
      rows.push({
        부품: item,
        기능: pick(FN_POOL, k),
        고장모드: fm,
        원인: cause,
        영향: pick(EFFECT_POOL, k * 2 + 1),
        심각도S: S,
        발생도O: O,
        검출도D: D,
        RPN: S * O * D,
        예방관리: pick(PREVENT_POOL, k),
        검출관리: pick(DETECT_POOL, k + 1),
        현행조치: action,
        원본코드: "",
        발생프로젝트: proj,
        PTS번호: `PTS-${1000 + ((k * 37) % 9000)}`,
        발생일자: `${y}-${pad2(mo)}-${pad2(da)}`,
        상태: pick(STATUS_POOL, k),
      });
    }
    writeXlsx(wb.file, [{ name: "FMEA", rows }]);
  });
}

/* ══════════ 1c. 결로·습기 지역별 시연용 FMEA 블록 ══════════
 * 앵커: 아우터 렌즈(ILENS)·하우징(IHSG) × 결로·습기(FMFOG),
 * 원인 ∈ {벤트·씰링 설계(CVENT)/저온 응결/급냉 응결/방진필터 막힘},
 * 조치 ∈ {벤트 경로 개선(AVENT)/렌즈 히팅 와이어/소수성 멤브레인 브리더/발수 코팅}.
 * FMFOG·ILENS·CVENT·AVENT 에 실제 근거를 얹어 /api/condensation 증거를 늘린다. */
const FOG_ITEMS = ["아우터 렌즈", "하우징"];
const FOG_CAUSES = ["벤트·씰링 설계", "저온 응결", "급냉 응결", "방진필터 막힘"];
const FOG_ACTIONS = ["벤트 경로 개선", "렌즈 히팅 와이어", "소수성 멤브레인 브리더", "발수 코팅"];
const FOG_PROJ = ["PJ 2019-HL07", "PJ 2021-HL12", "PJ 2023-HL15", "PJ 2025-HL19"];

function buildCondensationFmea() {
  const rows: Record<string, unknown>[] = [];
  const N = 40;
  for (let k = 0; k < N; k++) {
    const S = 5 + (k % 4); // 5..8 (결로는 심각도 중상)
    const O = 3 + (k % 5); // 3..7
    const D = 3 + ((k * 3) % 5); // 3..7
    const y = 2018 + (k % 8);
    rows.push({
      부품: pick(FOG_ITEMS, k),
      기능: "방수·방진",
      고장모드: "결로·습기",
      원인: pick(FOG_CAUSES, k + (k >> 2)),
      영향: "필드 클레임 발생",
      심각도S: S,
      발생도O: O,
      검출도D: D,
      RPN: S * O * D,
      예방관리: "방열 시뮬레이션",
      검출관리: "방수 시험",
      현행조치: pick(FOG_ACTIONS, k * 3 + (k >> 1)),
      원본코드: "",
      발생프로젝트: pick(FOG_PROJ, k),
      PTS번호: `PTS-${8300 + ((k * 17) % 700)}`,
      발생일자: `${y}-${pad2((k % 12) + 1)}-${pad2(((k * 7) % 28) + 1)}`,
      상태: pick(STATUS_POOL, k),
    });
  }
  writeXlsx("FMEA_결로_지역별_검토시트.xlsx", [{ name: "FMEA", rows }]);
}

/* ══════════ 2. 재발방지 대책서 / 8D 리포트 (pptx) — 실무형 복합 덱 ══════════
 * 표지 · 목차 · 현상(클레임 현황 표) · 발생 경위(타임라인 표) · 5-Why 분석 표 · 원인분석 ·
 * 원인 검증 표 · 대책(개선 전/후 비교표) · 검증 · 수평 전개 표 · 근거 — 10+ 슬라이드,
 * 표(addTable)·서식·산문이 섞인 실제 품질 문서 형태.
 *
 * 파서 앵커(lib/ingest/index.ts ingestPptx)는 그대로 유지한다:
 *  - "프로젝트:" / "이슈:" / "부품:" 로 시작하는 텍스트 라인
 *  - lines[0]==="원인분석" 슬라이드 본문 = 원인 라벨만 (표·산문 금지 — 전부 cause 로 해석됨)
 *  - lines[0]==="대책" 슬라이드의 첫 본문 라인 = 조치 라벨
 * 표·타임라인·5-Why 산문은 파서가 무시하는 슬라이드/위치에만 배치한다. */
const C_NAVY = "1A2B49";
const C_CYAN = "00A2E5";
const C_SUB = "5B6B81";
const C_LINE = "D8DEE9";
const C_BG = "F3F7FB";

interface DeckSpec {
  file: string;
  kind: "재발방지 대책서" | "8D 리포트";
  idx: number; // 결정론적 파생값 시드
  proj: string;
  item: string;
  fm: string;
  causes: string[]; // 원인분석 슬라이드 = 이 라벨들만
  action: string;
  actionNote: string;
  phenom: string;
  tests: string[];
  pts: string;
  region?: { name: string; countries: string; reg: string; claims: number; climate: string; humidity: string; design: string[] };
}

function buildRichDeck(d: DeckSpec) {
  const pptx = new PptxGen();
  pptx.defineLayout({ name: "WIDE", width: 10, height: 5.63 });
  pptx.layout = "WIDE";

  const docNo = `QA-${d.kind === "8D 리포트" ? "8D" : "CA"}-${2016 + (d.idx % 9)}-${pad2(((d.idx * 7) % 99) + 1)}`;
  const yr = 2016 + (d.idx % 9);
  const mo = (d.idx % 12) + 1;

  // 공통 헤더 밴드 + 제목. 제목을 첫 add → 파서의 lines[0] 이 슬라이드 제목이 된다.
  // meta:false = 앵커 슬라이드(원인분석/대책)용 — 우상단 메타 텍스트가 본문 라인으로
  // 파싱되어 가짜 cause/action 이 되는 것을 막는다(도형은 텍스트가 없어 무해).
  const section = (title: string, opts: { meta?: boolean } = {}) => {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addText(title, { x: 0.45, y: 0.28, w: 9.1, h: 0.55, fontSize: 22, bold: true, color: C_NAVY });
    s.addShape("rect", { x: 0.45, y: 0.86, w: 1.1, h: 0.045, fill: { color: C_CYAN }, line: { type: "none" } });
    if (opts.meta !== false) {
      s.addText(`${d.kind} · ${docNo}`, { x: 6.2, y: 0.34, w: 3.35, h: 0.4, fontSize: 10, color: C_SUB, align: "right" });
    }
    return s;
  };
  const body = (s: any, lines: string[], y = 1.1, fontSize = 14) =>
    s.addText(
      lines.map((t: string, i: number) => ({ text: t, options: { breakLine: true, fontSize, color: i === 0 ? C_NAVY : C_SUB } })),
      { x: 0.5, y, w: 9, h: 0.42 * lines.length + 0.2, valign: "top" }
    );
  const table = (s: any, rows: string[][], y: number, colW: number[], header = true) =>
    s.addTable(
      rows.map((r, ri) =>
        r.map((c) => ({
          text: c,
          options:
            header && ri === 0
              ? { bold: true, color: "FFFFFF", fill: { color: C_NAVY }, fontSize: 11 }
              : { color: C_NAVY, fill: { color: ri % 2 === 0 ? C_BG : "FFFFFF" }, fontSize: 11 },
        }))
      ),
      { x: 0.5, y, w: 9, colW, border: { pt: 0.5, color: C_LINE }, rowH: 0.32 }
    );

  /* 1. 표지 — 앵커(프로젝트:/이슈:) 포함 */
  {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape("rect", { x: 0, y: 0, w: 10, h: 0.14, fill: { color: C_CYAN }, line: { type: "none" } });
    s.addText(d.kind, { x: 0.6, y: 1.0, w: 8.8, h: 0.9, fontSize: 34, bold: true, color: C_NAVY });
    const cover = [
      `프로젝트: ${d.proj}`,
      `이슈: ${d.fm}`,
      ...(d.region ? [`지역: ${d.region.name} (${d.region.countries})`, `적용 법규: ${d.region.reg}`] : []),
      `문서번호: ${docNo}`,
      `작성: 품질보증팀 · 검토: 신뢰성시험팀 · 승인: 설계개발팀`,
    ];
    s.addText(
      cover.map((t) => ({ text: t, options: { breakLine: true, fontSize: 15, color: C_SUB } })),
      { x: 0.62, y: 2.0, w: 8.8, h: 2.4, valign: "top" }
    );
    s.addText(`SL Corporation · Quality Assurance · ${yr}.${pad2(mo)}`, { x: 0.62, y: 4.9, w: 8.8, h: 0.4, fontSize: 11, color: C_SUB });
  }

  /* 2. 목차 */
  {
    const s = section("목차");
    const toc = ["1. 현상 및 클레임 현황", "2. 발생 경위", "3. 5-Why 분석", "4. 원인분석", "5. 원인 검증", "6. 대책", "7. 검증 결과", "8. 수평 전개 및 표준화"];
    body(s, toc, 1.15, 15);
  }

  /* 3. 현상 — 앵커("부품:") + 클레임 현황 표 */
  {
    const s = section("현상");
    body(s, [`부품: ${d.item}`, d.phenom, `${d.item} 부위에서 ${d.fm} 현상이 반복 확인되어 감성·기능 품질에 영향.`], 1.05, 13);
    const base = d.region?.claims ?? 7 + ((d.idx * 5) % 20);
    const rows = [
      ["접수 시기", "접수 경로", "건수", "비고"],
      [`${yr}.${pad2(mo)}`, "필드 클레임(PTS)", String(Math.max(1, Math.round(base * 0.45))), "최초 접수"],
      [`${yr}.${pad2((mo % 12) + 1)}`, "고객 라인 검출", String(Math.max(1, Math.round(base * 0.3))), "유사 증상"],
      [`${yr + 1}.${pad2(((mo + 1) % 12) + 1)}`, "사내 신뢰성 시험", String(Math.max(1, base - Math.round(base * 0.45) - Math.round(base * 0.3))), "재현 확인"],
    ];
    table(s, rows, 2.6, [1.8, 3.2, 1.2, 2.8]);
  }

  /* 4. 발생 경위 — 타임라인 표 */
  {
    const s = section("발생 경위");
    const rows = [
      ["일자", "단계", "내용"],
      [`${yr}-${pad2(mo)}-${pad2(((d.idx * 3) % 27) + 1)}`, "이슈 접수", `${d.pts} 필드 클레임 접수 · 초기 물량 격리`],
      [`${yr}-${pad2(mo)}-${pad2(((d.idx * 3) % 25) + 3)}`, "긴급 대응", "출하 검사 강화 및 재고 전수 선별"],
      [`${yr}-${pad2((mo % 12) + 1)}-${pad2(((d.idx * 5) % 27) + 1)}`, "원인 조사", "설계·공정·재료 인자 교차 분석, 재현 시험 착수"],
      [`${yr}-${pad2(((mo + 1) % 12) + 1)}-${pad2(((d.idx * 7) % 27) + 1)}`, "대책 수립", `${d.action} 적용안 확정 · DV 시험 계획 승인`],
      [`${yr}-${pad2(((mo + 2) % 12) + 1)}-${pad2(((d.idx * 11) % 27) + 1)}`, "검증 완료", "개선 로트 신뢰성 시험 합격 · 표준 반영"],
    ];
    table(s, rows, 1.1, [1.6, 1.6, 5.8]);
  }

  /* 5. 5-Why 분석 — 산문 표 (파서 미사용 슬라이드) */
  {
    const s = section("5-Why 분석");
    const rows = [
      ["단계", "질문", "답"],
      ["Why 1", `왜 ${d.fm} 현상이 발생했는가?`, `${d.item} 주변에서 현상이 반복 관찰됨`],
      ["Why 2", "왜 해당 부위에 집중되는가?", `${d.causes[0]} 관련 설계 여유가 부족함`],
      ["Why 3", "왜 설계 여유가 부족했는가?", `${d.causes[1] ?? d.causes[0]} 이(가) 초기 검토에서 누락됨`],
      ["Why 4", "왜 초기 검토에서 누락되었는가?", "유사 플랫폼 이력이 체크리스트로 연결되지 않음"],
      ["Why 5", "왜 이력이 연결되지 않았는가?", "과거 문서가 비정형으로 분산되어 검색·재사용이 어려움"],
    ];
    table(s, rows, 1.1, [1.0, 3.6, 4.4]);
  }

  /* 6. 원인분석 — 앵커 슬라이드: 원인 라벨만 (표·산문·메타 금지) */
  {
    const s = section("원인분석", { meta: false });
    body(s, [...d.causes], 1.15, 16);
  }

  /* 7. 원인 검증 표 */
  {
    const s = section("원인 검증");
    const rows = [
      ["후보 원인", "검증 방법", "판정"],
      ...d.causes.map((c, i) => [
        c,
        pick(DETECT_POOL, d.idx + i),
        i === 0 ? "재현됨 → 근본 원인" : i === 1 ? "부분 기여 → 병행 관리" : "기각",
      ]),
    ];
    table(s, rows, 1.1, [3.4, 3.4, 2.2]);
  }

  /* 8. 대책 — 앵커 슬라이드: 첫 본문 라인 = 조치 라벨, 이후 산문·표는 파서가 무시 */
  {
    const s = section("대책", { meta: false });
    body(s, [d.action, d.actionNote], 1.05, 14);
    const rows = [
      ["구분", "개선 전", "개선 후"],
      ["설계", `${d.causes[0]} 여유 부족`, d.action],
      ["관리", "이력 미참조 · 개별 대응", "표준 체크리스트 반영 · 초도 검증 필수화"],
      ["결과", `클레임 ${d.region?.claims ?? 7 + ((d.idx * 5) % 20)}건`, "개선 로트 재발 0건"],
    ];
    table(s, rows, 2.75, [1.4, 3.8, 3.8]);
  }

  /* 9. 검증 결과 */
  {
    const s = section("검증 결과");
    body(s, [...d.tests, "개선 후 3로트 전수 검사 및 필드 모니터링에서 재발 없음 확인."], 1.15, 14);
  }

  /* 9b. (지역형) 발생조건 · 설계변경 */
  if (d.region) {
    const s = section("발생조건");
    body(s, [`기후: ${d.region.climate}`, `온습도 프로파일: ${d.region.humidity}`, "특정 계절/시간대(급냉·우기·결빙)에 집중 발생하는 지역 편중 특성."], 1.15, 14);
    const s2 = section("설계변경");
    body(s2, [...d.region.design], 1.15, 15);
  }

  /* 10. 수평 전개 */
  {
    const s = section("수평 전개 및 표준화");
    const rows = [
      ["적용 대상", "적용 항목", "일정"],
      [pick(PROJ_POOL, d.idx + 2), d.action, `${yr + 1}.Q${(d.idx % 4) + 1}`],
      [pick(PROJ_POOL, d.idx + 5), "설계 체크리스트 반영", `${yr + 1}.Q${((d.idx + 1) % 4) + 1}`],
      ["신규 개발 全 차종", "표준 마스터 등록 · 초도 검증 필수화", "상시"],
    ];
    table(s, rows, 1.1, [2.6, 4.2, 2.2]);
  }

  /* 11. 근거 */
  {
    const s = section("근거");
    body(s, [`PTS: ${d.pts}`, `관련 프로젝트: ${d.proj}`, `문서번호: ${docNo}`, "첨부: 재현 시험 성적서 · 치수 측정 데이터 · 필드 사진 대지"], 1.15, 14);
  }

  return pptx.writeFile({ fileName: path.join(OUT, d.file) }).then(() => console.log("  pptx", d.file));
}

// 백본 대책서(seed 유도) — 간극/배광. seed 엣지에서 앵커 라벨을 뽑아 복합 덱으로.
function buildDeck(file: string, projId: string, fmId: string, pts: string, idx: number) {
  const items = inByRel(fmId, "HAS_FAILURE");
  const causes = outByRel(fmId, "CAUSED_BY");
  const actions = outByRel(fmId, "MITIGATED_BY");
  return buildRichDeck({
    file,
    kind: "재발방지 대책서",
    idx,
    proj: label(projId),
    item: items[0] ? label(items[0]) : "-",
    fm: label(fmId),
    causes: causes.map((c) => label(c)),
    action: actions[0] ? label(actions[0]) : "-",
    actionNote: `${actions[0] ? label(actions[0]) : "개선안"} 적용으로 근본 원인(${causes[0] ? label(causes[0]) : "-"})을 제거하고 유사 형상 전개 시 표준으로 반영.`,
    phenom: `${label(fmId)}${node(fmId).sub ? " — " + node(fmId).sub : ""}`,
    tests: [pick(VERIFY_POOL, idx), pick(VERIFY_POOL, idx + 2)],
    pts,
  });
}

/* ══════════ 3. 품질 리포트 (docx) ══════════ */
// 문단: 프로젝트/부품/고장모드/원인/조치/비고 ("키: 값"). LED방열은 고장모드 없이 원인(CTHERM)→조치(ARIB).
function buildReport(file: string, title: string, fields: [string, string][]) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docx;
  const children = [
    new Paragraph({ text: `품질 리포트 — ${title}`, heading: HeadingLevel.HEADING_1 }),
    ...fields.map(([k, v]) => new Paragraph({ children: [new TextRun(`${k}: ${v || "-"}`)] })),
  ];
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc).then((buf: Buffer) => {
    fs.writeFileSync(path.join(OUT, file), buf);
    console.log("  docx", file);
  });
}

/* ══════════ 2b·3b. 대량 재발방지 대책서(pptx) / 품질 리포트(docx) — 도메인 풀 합성 ══════════
 * 파서 앵커(프로젝트:/이슈:/부품:/원인분석/대책)는 깨끗한 엔티티 라벨로 유지하고,
 * 서술형 본문은 파서가 무시하는 위치(현상/검증/근거 및 프로즈 문단)에 넣어 풍부함을 확보. */
const PHENOM_POOL = ["양산 초기 필드에서 다수 접수", "정기 품질 감사에서 검출", "신뢰성 시험 중 발생", "고객 조립 라인에서 발견", "초도 양산 검증 단계에서 확인"];
const VERIFY_POOL = ["개선 후 3로트 전수 검사에서 재발 없음 확인", "열충격 200사이클 및 진동 내구 시험 통과", "광학 성능 및 배광 패턴 규격 만족", "방수 IPX4 재시험 합격", "필드 6개월 모니터링 결과 클레임 미발생"];

// 대량 대책서: [파일, 프로젝트idx, item idx, fm idx, cause idx들, action idx, pts]
const BULK_DECKS: { file: string; p: number; it: number; fm: number; cs: number[]; ac: number; pts: string }[] = [
  { file: "재발방지_결로클레임_HL07.pptx", p: 3, it: 4, fm: 3, cs: [4, 20], ac: 3, pts: "PTS-8421" },
  { file: "8D_LED조기사멸_HL13.pptx", p: 6, it: 1, fm: 12, cs: [3, 9], ac: 10, pts: "PTS-8677" },
  { file: "재발방지_도금부식_HL09.pptx", p: 2, it: 5, fm: 10, cs: [7, 19], ac: 9, pts: "PTS-8903" },
  { file: "8D_융착불량_HL06.pptx", p: 1, it: 3, fm: 11, cs: [6, 24], ac: 8, pts: "PTS-9044" },
  { file: "재발방지_색편차_HL17.pptx", p: 8, it: 12, fm: 7, cs: [11, 23], ac: 14, pts: "PTS-9210" },
  { file: "8D_커넥터접촉불량_HL05.pptx", p: 1, it: 9, fm: 20, cs: [19, 22], ac: 11, pts: "PTS-9388" },
];

function buildDeckRaw(d: (typeof BULK_DECKS)[number], idx: number) {
  const causes = d.cs.map((c) => pick(CAUSE_POOL, c));
  const action = pick(ACTION_POOL, d.ac);
  const fm = pick(FM_POOL, d.fm);
  const item = pick(ITEM_POOL, d.it);
  return buildRichDeck({
    file: d.file,
    kind: d.file.startsWith("8D") ? "8D 리포트" : "재발방지 대책서",
    idx: idx + 2,
    proj: pick(PROJ_POOL, d.p),
    item,
    fm,
    causes,
    action,
    actionNote: `${action} 적용으로 근본 원인(${causes[0]})을 제거하고 유사 형상 전개 시 표준으로 반영.`,
    phenom: `${fm} — ${pick(PHENOM_POOL, idx)}`,
    tests: [pick(VERIFY_POOL, idx), pick(VERIFY_POOL, idx + 2)],
    pts: d.pts,
  });
}

// 대량 품질 리포트: 실제 산문 문단 + 구조화 필드.
const BULK_REPORTS: { file: string; title: string; p: number; it: number; fm: number; cs: number; ac: number; note: string }[] = [
  { file: "품질리포트_배광법규_HL07.docx", title: "배광 법규 적합성", p: 3, it: 0, fm: 2, cs: 3, ac: 4, note: "북미 FMVSS 108 및 유럽 ECE 배광 기준 상이 · 시뮬레이션 조건 분리 관리" },
  { file: "품질리포트_수축변형_HL03.docx", title: "하우징 수축 변형", p: 0, it: 3, fm: 4, cs: 0, ac: 1, note: "슬림 형상일수록 수축 영향 증대 · 저수축 소재 및 게이트 위치 재검토" },
  { file: "품질리포트_융착불량_HL06.docx", title: "렌즈 융착 불량", p: 1, it: 4, fm: 11, cs: 6, ac: 8, note: "융착 조건(온도·압력·시간) 표준화 및 초도 단면 검증 강화" },
  { file: "품질리포트_커넥터_HL05.docx", title: "커넥터 접촉 불량", p: 4, it: 9, fm: 20, cs: 19, ac: 11, note: "단자 산화 및 삽입력 관리 · 방청 처리와 통전 전수 검사 도입" },
];

function buildReportRaw(r: (typeof BULK_REPORTS)[number], idx: number) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docx;
  const proj = pick(PROJ_POOL, r.p);
  const item = pick(ITEM_POOL, r.it);
  const fm = pick(FM_POOL, r.fm);
  const cause = pick(CAUSE_POOL, r.cs);
  const action = pick(ACTION_POOL, r.ac);
  const para = (t: string) => new Paragraph({ children: [new TextRun(t)] });
  const children = [
    new Paragraph({ text: `품질 리포트 — ${r.title}`, heading: HeadingLevel.HEADING_1 }),
    para(`프로젝트: ${proj}`),
    para(`부품: ${item}`),
    para(`고장모드: ${fm}`),
    para(`원인: ${cause}`),
    para(`조치: ${action}`),
    new Paragraph({ text: "개요", heading: HeadingLevel.HEADING_2 }),
    para(`본 리포트는 ${proj} 개발 과정에서 ${item} 에 발생한 ${fm} 이슈를 분석하고 재발방지 대책을 정리한 것이다. 해당 현상은 양산 및 필드 단계에서 품질 리스크로 작용하여 조기 대응이 필요하였다.`),
    new Paragraph({ text: "원인 분석", heading: HeadingLevel.HEADING_2 }),
    para(`다각적 분석 결과 근본 원인은 ${cause} 로 확인되었다. 설계·공정·재료 인자를 교차 검토하였으며, 유사 플랫폼 이력과 대조하여 발생 메커니즘을 규명하였다.`),
    new Paragraph({ text: "조치 및 재발방지", heading: HeadingLevel.HEADING_2 }),
    para(`대책으로 ${action} 를 적용하였다. 개선 효과는 신뢰성 시험과 초도 양산 검증을 통해 확인하였으며, 표준 체크리스트에 반영하여 신규 개발 시 누락을 방지하도록 하였다.`),
    para(`재발방지: ${action} 표준화`),
    para(`비고: ${r.note}`),
  ];
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc).then((buf: Buffer) => {
    fs.writeFileSync(path.join(OUT, r.file), buf);
    console.log("  docx", r.file);
  });
}

/* ══════════ 2c. 결로 지역별 8D 대책서 (pptx) ══════════
 * 파서 앵커(이슈=결로·습기→FMFOG, 부품=아우터 렌즈→ILENS, 원인분석에 벤트·씰링 설계→CVENT)를
 * 유지하고, 지역 기후/시험/설계변경은 파서가 무시하는 슬라이드에 서술형으로 담는다. */
interface FogRegion {
  file: string; region: string; countries: string; proj: string; reg: string;
  claims: number; climate: string; humidity: string;
  causes: string[]; // 원인분석 슬라이드(첫 줄 벤트·씰링 설계 + 지역별)
  action: string; actionNote: string; // 대책[0] = 지역 주 대책(auto), 이하 서술
  test: string[]; design: string[]; pts: string;
}
const FOG_REGIONS: FogRegion[] = [
  {
    file: "재발방지_결로_아시아.pptx", region: "아시아", countries: "한국·동남아", proj: "PJ 2019-HL07", reg: "KMVSS",
    claims: 37, climate: "고온다습 · 우기 집중호우 · 큰 일교차", humidity: "RH 80–95%(우기) · 온도 -10~40°C",
    causes: ["벤트·씰링 설계", "급냉 응결", "씰링 열화"],
    action: "벤트 용량 확대", actionNote: "벤트 2개소 확대 + 하부 드레인 신설 + 렌즈 내면 발수 코팅으로 응결 유동화",
    test: ["온습도 사이클 -10↔40°C RH90% 20cyc", "침수 IPX7 방수 재시험"],
    design: ["벤트 용량 확대 ×2 (상·하부)", "하부 드레인 경로 신설", "렌즈 내면 발수(소수성) 코팅"], pts: "PTS-8321",
  },
  {
    file: "재발방지_결로_유럽.pptx", region: "유럽", countries: "EU", proj: "PJ 2023-HL15", reg: "ECE R149",
    claims: 21, climate: "저온·습윤 · 결빙 · 서리", humidity: "RH 70–90% · 온도 -25~35°C",
    causes: ["벤트·씰링 설계", "저온 응결", "히팅 부재"],
    action: "렌즈 히팅 와이어", actionNote: "렌즈 하부 발열 코일로 결빙·서리 방지 + 이중 개스킷으로 저온 침습 차단",
    test: ["저온 결빙 사이클 -25↔35°C", "방수 IPX9K 고압 분사"],
    design: ["렌즈 하부 히팅 코일", "이중 개스킷(저온 대응)", "씰링 재질 저온 경화 개선"], pts: "PTS-8407",
  },
  {
    file: "재발방지_결로_북미.pptx", region: "북미", countries: "미국·캐나다", proj: "PJ 2021-HL12", reg: "FMVSS 108",
    claims: 18, climate: "큰 온도 스윙 · 건습 반복", humidity: "RH 40–85% · 온도 -30~45°C",
    causes: ["벤트·씰링 설계", "급냉 응결", "브리더 응답 지연"],
    action: "소수성 멤브레인 브리더", actionNote: "습기 배출·수분 차단 동시(GORE형 멤브레인) + 상·하 벤트 배치로 대류 순환 확보",
    test: ["열충격 -30↔45°C 100cyc", "습도 사이클 RH85%"],
    design: ["멤브레인 브리더 적용", "상·하 벤트 대류 배치", "브리더 응답성 사양화"], pts: "PTS-8512",
  },
  {
    file: "재발방지_결로_중국.pptx", region: "중국", countries: "중국", proj: "PJ 2025-HL19", reg: "GB 25991",
    claims: 29, climate: "고습 · 미세먼지 · 지역 편차 큼", humidity: "RH 75–95% · 분진 다량",
    causes: ["벤트·씰링 설계", "방진필터 막힘", "고습 침투"],
    action: "방진·방습 멤브레인", actionNote: "분진 차단 멤브레인으로 막힘 방지 + 고습 내구 실리콘 개스킷으로 재질 상향",
    test: ["방진+방습 복합 시험", "침수 IPX7 방수"],
    design: ["방진·방습 겸용 벤트", "고습 내구 실리콘 개스킷", "하부 드레인 경로"], pts: "PTS-8619",
  },
];

function buildFogDeck(r: FogRegion, idx: number) {
  return buildRichDeck({
    file: r.file,
    kind: "재발방지 대책서",
    idx: idx + 9,
    proj: r.proj,
    item: "아우터 렌즈",
    fm: "결로·습기",
    causes: r.causes,
    action: r.action,
    actionNote: r.actionNote,
    phenom: `아우터렌즈 내부 결로 — ${r.region} 필드 클레임 ${r.claims}건 · 주간 점등 후 소등 시 내부 렌즈면에 응결·물방울 관찰.`,
    tests: r.test,
    pts: r.pts,
    region: {
      name: r.region,
      countries: r.countries,
      reg: r.reg,
      claims: r.claims,
      climate: r.climate,
      humidity: r.humidity,
      design: r.design,
    },
  });
}

/* ══════════ 2d. 2D 도면 (DXF) — 형상 유사 탐색 시연용 합성 도면 ══════════
 * DXF R12 ASCII (그룹코드/값 줄 쌍). 파서(lib/ingest/dxf.ts)가 읽는 규칙:
 *  - 제목블록/NOTE 는 "키: 값" TEXT 라벨 (부품명:/도번:/프로젝트:/차종:/소재:, 벤트 홀: 등)
 *  - BOM 표는 "BOM" 헤더 아래 같은 y 좌표 = 같은 행인 TEXT 그리드
 * 형상 특징(NOTE)은 세단 B(PJ 2021-HL12) 프로젝트와 최고 유사(≈0.82)가 되도록 설계 —
 * "차명이 아니라 형상 유사도" 시연 포인트(신규 도면은 SUV A 차종). CAD 뷰어에서 열리도록
 * 외곽 프레임·헤드램프 단면(하우징/렌즈/벤트/LED)도 LINE/CIRCLE/ARC 로 그린다. */

interface DxfEnt { toRows(): (string | number)[] }
const dxfText = (layer: string, x: number, y: number, h: number, t: string): DxfEnt => ({
  toRows: () => [0, "TEXT", 8, layer, 10, x, 20, y, 40, h, 1, t],
});
const dxfLine = (layer: string, x1: number, y1: number, x2: number, y2: number): DxfEnt => ({
  toRows: () => [0, "LINE", 8, layer, 10, x1, 20, y1, 11, x2, 21, y2],
});
const dxfCircle = (layer: string, cx: number, cy: number, r: number): DxfEnt => ({
  toRows: () => [0, "CIRCLE", 8, layer, 10, cx, 20, cy, 40, r],
});
const dxfArc = (layer: string, cx: number, cy: number, r: number, a1: number, a2: number): DxfEnt => ({
  toRows: () => [0, "ARC", 8, layer, 10, cx, 20, cy, 40, r, 50, a1, 51, a2],
});
const dxfRect = (layer: string, x: number, y: number, w: number, h: number): DxfEnt[] => [
  dxfLine(layer, x, y, x + w, y),
  dxfLine(layer, x + w, y, x + w, y + h),
  dxfLine(layer, x + w, y + h, x, y + h),
  dxfLine(layer, x, y + h, x, y),
];

function writeDxf(file: string, ents: DxfEnt[]) {
  const rows: (string | number)[] = [0, "SECTION", 2, "ENTITIES"];
  for (const e of ents) rows.push(...e.toRows());
  rows.push(0, "ENDSEC", 0, "EOF");
  fs.writeFileSync(path.join(OUT, file), rows.join("\n") + "\n", "utf8");
  console.log("  dxf ", file);
}

/** 제목블록(우하단): 외곽 그리드 + "키: 값" TEXT 라벨. */
function titleBlock(rows: [string, string][], x: number, y: number): DxfEnt[] {
  const W = 150;
  const RH = 9;
  const ents: DxfEnt[] = [...dxfRect("TITLE", x, y, W, RH * rows.length)];
  rows.forEach(([k, v], i) => {
    const ry = y + RH * (rows.length - 1 - i);
    if (i > 0) ents.push(dxfLine("TITLE", x, ry, x + W, ry));
    ents.push(dxfText("TITLE", x + 3, ry + 2.5, 4, `${k}: ${v}`));
    void v;
  });
  return ents;
}

/** BOM 표: "BOM" 헤더 + 컬럼 헤더 행 + 데이터 행(같은 y = 같은 행). */
function bomTable(items: [string, string, string, string][], x: number, y: number): DxfEnt[] {
  const cols = [0, 14, 74, 92]; // 품번/품명/수량/재질 컬럼 x 오프셋
  const W = 130;
  const RH = 8;
  const ents: DxfEnt[] = [dxfText("BOM", x, y + RH * (items.length + 1) + 4, 5, "BOM")];
  ents.push(...dxfRect("BOM", x, y, W, RH * (items.length + 1)));
  const header: [string, string, string, string] = ["품번", "품명", "수량", "재질"];
  [header, ...items].forEach((row, i) => {
    const ry = y + RH * (items.length - i) + 2;
    row.forEach((cell, c) => ents.push(dxfText("BOM", x + cols[c] + 2, ry, 3.6, cell)));
  });
  return ents;
}

/** 헤드램프 단면 스케치(시각용): 하우징 폴리곤 + 렌즈 아크 + 벤트 2개 + LED/히트싱크. */
function lampSection(x: number, y: number): DxfEnt[] {
  const L = "OUTLINE";
  return [
    // 하우징 (뒤판·상하판)
    dxfLine(L, x, y, x, y + 90),
    dxfLine(L, x, y + 90, x + 95, y + 100),
    dxfLine(L, x, y, x + 95, y - 10),
    // 아우터 렌즈 (곡면 아크)
    dxfArc(L, x + 60, y + 45, 75, -48, 48),
    // 씰링 개스킷(렌즈-하우징 접합 2점)
    dxfCircle(L, x + 97, y + 98, 3),
    dxfCircle(L, x + 97, y - 8, 3),
    // 방수 벤트 2개 (상·하)
    dxfCircle(L, x + 30, y + 96, 4),
    dxfText(L, x + 38, y + 94, 3.6, "VENT-1 (상부)"),
    dxfCircle(L, x + 30, y - 6, 4),
    dxfText(L, x + 38, y - 10, 3.6, "VENT-2 (하부)"),
    // LED 모듈 + 히트싱크 핀
    ...dxfRect(L, x + 25, y + 35, 30, 20),
    dxfText(L, x + 27, y + 42, 3.6, "LED"),
    dxfLine(L, x + 25, y + 40, x + 12, y + 40),
    dxfLine(L, x + 25, y + 50, x + 12, y + 50),
    // 커넥터
    ...dxfRect(L, x - 14, y + 30, 14, 16),
    dxfText(L, x - 13, y + 20, 3.6, "CONN IP67"),
  ];
}

function buildDrawings() {
  // 도면 1: 신규 헤드램프 조립도 — 차종은 SUV A, 형상 특징은 세단 B(PJ21) 계열과 일치하게.
  const asm: DxfEnt[] = [
    ...dxfRect("FRAME", 0, 0, 420, 297), // A3 외곽
    dxfText("FRAME", 150, 285, 7, "신규 헤드램프 어셈블리 조립도"),
    ...lampSection(150, 120),
    // NOTE (좌상단) — 형상 특징 키:값 (파서가 ShapeFeatures 로 해석)
    dxfText("NOTE", 12, 262, 4.5, "NOTE:"),
    dxfText("NOTE", 12, 254, 4, "1. 하우징: 밀폐형 슬림"),
    dxfText("NOTE", 12, 247, 4, "2. 벤트 홀: 2 (상·하)"),
    dxfText("NOTE", 12, 240, 4, "3. 실링: 이중 개스킷"),
    dxfText("NOTE", 12, 233, 4, "4. 개스킷 소재: EPDM"),
    dxfText("NOTE", 12, 226, 4, "5. 커넥터: IP67"),
    dxfText("NOTE", 12, 219, 4, "6. 렌즈: 곡면"),
    dxfText("NOTE", 12, 212, 4, "7. 결로 방지: 벤트 경로 설계 검토 요"),
    // BOM (우상단)
    ...bomTable(
      [
        ["1", "아우터 렌즈", "1", "PC"],
        ["2", "하우징", "1", "PC+ABS"],
        ["3", "LED 모듈", "2", "-"],
        ["4", "실링 개스킷", "1", "EPDM"],
        ["5", "방수벤트", "2", "PTFE 멤브레인"],
      ],
      278, 200
    ),
    // 제목블록 (우하단)
    ...titleBlock(
      [
        ["도번", "DWG-HL22-A01"],
        ["부품명", "헤드램프 어셈블리"],
        ["프로젝트", "PJ 2027-HL22"],
        ["차종", "중형 SUV A (3세대)"],
        ["시장", "아시아 (동남아 포함)"],
        ["소재", "PC+ABS / PC(렌즈)"],
        ["작성", "설계1팀 · 2026-07-06 · Rev.A"],
      ],
      262, 8
    ),
  ];
  writeDxf("도면_신규_헤드램프_HL22.dxf", asm);

  // 도면 2: 아우터 렌즈 단품도 — 인제스천 탭 시연용(간단).
  const part: DxfEnt[] = [
    ...dxfRect("FRAME", 0, 0, 297, 210),
    dxfText("FRAME", 100, 198, 6, "아우터 렌즈 단품도"),
    dxfArc("OUTLINE", 120, 100, 70, -55, 55),
    dxfArc("OUTLINE", 120, 100, 62, -52, 52),
    dxfLine("OUTLINE", 158, 42, 158, 158),
    dxfText("NOTE", 12, 185, 4.5, "NOTE:"),
    dxfText("NOTE", 12, 178, 4, "1. 렌즈: 곡면"),
    dxfText("NOTE", 12, 171, 4, "2. 내면 발수 코팅 검토 요"),
    dxfText("NOTE", 12, 164, 4, "3. 융착 리브 폭 2.5 유지"),
    ...titleBlock(
      [
        ["도번", "DWG-HL22-P03"],
        ["부품명", "아우터 렌즈"],
        ["프로젝트", "PJ 2027-HL22"],
        ["소재", "PC"],
        ["작성", "설계1팀 · 2026-07-06 · Rev.A"],
      ],
      140, 8
    ),
  ];
  writeDxf("도면_아우터렌즈_단품.dxf", part);
}

/* ══════════ 2e. BOM(xlsx) — 부품표 인제스천 시연용 ══════════
 * 파서(lib/ingest/index.ts ingestXlsxBom): 상위부품 컬럼(동의어: 상위부품/모듈/assembly) →
 * 부품명 컬럼(동의어: 부품명/품명/part) 으로 CONSISTS_OF. 통제 어휘 부품(LED 모듈·아우터 렌즈·
 * 하우징·라이트가이드 등)은 기존 id 로 병합되고, 신규 부품(방열판·벤트 멤브레인 등)은
 * auto-create(0.66) 로 편입된다. 두 워크북은 컬럼명을 표준/동의어로 달리해 컬럼 동의어
 * 매칭까지 시연한다. */
function buildBom() {
  writeXlsx("BOM_신규_헤드램프_HL22.xlsx", [
    {
      name: "BOM",
      rows: [
        { 레벨: 0, "상위 부품": "", 부품명: "헤드램프 어셈블리", 품번: "HL22-00-000", 수량: 1, 재질: "-" },
        { 레벨: 1, "상위 부품": "헤드램프 어셈블리", 부품명: "LED 모듈", 품번: "HL22-01-100", 수량: 2, 재질: "-" },
        { 레벨: 1, "상위 부품": "헤드램프 어셈블리", 부품명: "아우터 렌즈", 품번: "HL22-01-200", 수량: 1, 재질: "PC" },
        { 레벨: 1, "상위 부품": "헤드램프 어셈블리", 부품명: "하우징", 품번: "HL22-01-300", 수량: 1, 재질: "PC" },
        { 레벨: 1, "상위 부품": "헤드램프 어셈블리", 부품명: "라이트가이드", 품번: "HL22-01-400", 수량: 1, 재질: "PMMA" },
        { 레벨: 1, "상위 부품": "헤드램프 어셈블리", 부품명: "히트싱크", 품번: "HL22-01-500", 수량: 1, 재질: "Al" },
        { 레벨: 2, "상위 부품": "히트싱크", 부품명: "방열판", 품번: "HL22-02-510", 수량: 1, 재질: "Al 6061" },
        { 레벨: 1, "상위 부품": "헤드램프 어셈블리", 부품명: "방수벤트", 품번: "HL22-01-600", 수량: 2, 재질: "PTFE 멤브레인" },
        { 레벨: 2, "상위 부품": "방수벤트", 부품명: "벤트 멤브레인", 품번: "HL22-02-610", 수량: 2, 재질: "PTFE" },
        { 레벨: 1, "상위 부품": "헤드램프 어셈블리", 부품명: "실링 개스킷", 품번: "HL22-01-700", 수량: 1, 재질: "실리콘" },
      ],
    },
  ]);

  // 동의어 컬럼명(모듈/품명/소재) 워크북 — 컬럼 동의어 매칭 검증.
  writeXlsx("BOM_통합모듈_HL19.xlsx", [
    {
      name: "BOM",
      rows: [
        { 레벨: 0, 모듈: "", 품명: "DRL 모듈", 품번: "HL19-00-000", 수량: 1, 소재: "-" },
        { 레벨: 1, 모듈: "DRL 모듈", 품명: "LED 모듈", 품번: "HL19-01-100", 수량: 1, 소재: "-" },
        { 레벨: 1, 모듈: "DRL 모듈", 품명: "PCB 기판", 품번: "HL19-01-200", 수량: 1, 소재: "FR-4" },
        { 레벨: 1, 모듈: "DRL 모듈", 품명: "커넥터", 품번: "HL19-01-300", 수량: 1, 소재: "-" },
        { 레벨: 1, 모듈: "DRL 모듈", 품명: "LED 드라이버", 품번: "HL19-01-400", 수량: 1, 소재: "-" },
        { 레벨: 1, 모듈: "DRL 모듈", 품명: "방열 그리스", 품번: "HL19-01-500", 수량: 1, 소재: "실리콘" },
      ],
    },
  ]);
}

/* ══════════ 3c. 결로 지역별 품질 리포트 (docx) ══════════ */
function buildFogReport() {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docx;
  const para = (t: string) => new Paragraph({ children: [new TextRun(t)] });
  const h2 = (t: string) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2 });
  const children = [
    new Paragraph({ text: "품질 리포트 — 아우터렌즈 결로 지역별 분석", heading: HeadingLevel.HEADING_1 }),
    para("프로젝트: PJ 2023-HL15"),
    para("부품: 아우터 렌즈"),
    para("고장모드: 결로·습기"),
    para("원인: 벤트·씰링 설계"),
    para("조치: 벤트 경로 개선"),
    h2("개요"),
    para("아우터 렌즈(PC) 내부 결로는 램프 내부 공기의 수분이 급격한 온도 변화로 렌즈 내면에 응결하는 현상으로, 전 지역에서 필드 클레임 상위를 차지한다. 본 리포트는 아시아·유럽·북미·중국 4개 권역의 기후·규제·근본원인·시험·대책을 비교 분석한다."),
    h2("아시아 (KMVSS)"),
    para("고온다습과 우기 집중호우, 큰 일교차가 특징이다. 급냉 응결과 벤트 용량 부족, 씰링 열화가 주 원인으로, 벤트 용량 확대와 하부 드레인, 렌즈 내면 발수 코팅을 적용한다. 검증은 온습도 사이클(-10~40°C, RH90%)과 침수 IPX7로 수행한다."),
    h2("유럽 (ECE R149)"),
    para("저온·습윤과 결빙·서리 환경에서 저온 응결과 히팅 부재가 지배적이다. 렌즈 하부 히팅 와이어와 이중 개스킷으로 저온 침습을 차단하며, 저온 결빙 사이클과 방수 IPX9K로 검증한다."),
    h2("북미 (FMVSS 108)"),
    para("건습이 반복되는 큰 온도 스윙 환경으로, 급격한 온도 변화 결로와 브리더 응답 지연이 원인이다. 소수성 멤브레인 브리더와 상·하 벤트 대류 배치로 대응하고, 열충격(-30~45°C)과 습도 사이클로 검증한다. 배광 관련 규제는 유럽과 상이하므로 시험 조건을 분리 관리한다."),
    h2("중국 (GB 25991)"),
    para("고습과 미세먼지가 동시에 작용하여 방진필터 막힘에 따른 내압 상승·결로가 발생한다. 방진·방습 겸용 멤브레인 벤트와 고습 내구 실리콘 개스킷으로 방진과 방습을 동시에 확보하며, 방진+방습 복합 시험과 침수 IPX7로 검증한다."),
    h2("설계 방향"),
    para("공통적으로 벤트 경로 개선을 기본 대책으로 두고, 지역 기후에 따라 히팅·멤브레인·드레인·개스킷 사양을 선택적으로 조합한다. 신규 개발 시 간극·단차 마스터와 함께 결로 표준 체크리스트를 필수 참조하여 누락을 방지한다."),
    para("재발방지: 결로 표준 체크리스트 및 지역별 벤트/씰링 사양 표준화"),
    para("비고: KMVSS·ECE R149·FMVSS 108·GB 25991 규제별 방수 등급 및 배광 조건 상이 — 지역 축 분리 관리"),
  ];
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc).then((buf: Buffer) => {
    fs.writeFileSync(path.join(OUT, "품질리포트_결로_지역별.docx"), buf);
    console.log("  docx 품질리포트_결로_지역별.docx");
  });
}

/* ══════════ 4. 참조 마스터데이터 (xlsx, id 명시) ══════════ */
function buildReference() {
  // 법규기준.xlsx — reg 노드 + 법규적용(UNDER_REG / DRL_REG)
  const regRows = ["RKR", "RUS", "REU", "RCN"].map((id) => ({
    id,
    label: label(id),
    국가: prop(id, "국가"),
    핵심: prop(id, "핵심"),
    비고: prop(id, "비고"),
  }));
  const regApply: Record<string, unknown>[] = [];
  for (const dst of outByRel("FMBEAM", "UNDER_REG")) regApply.push({ 대상id: "FMBEAM", reg_id: dst, 관계: "UNDER_REG" });
  for (const dst of outByRel("ILG", "DRL_REG")) regApply.push({ 대상id: "ILG", reg_id: dst, 관계: "DRL_REG" });
  writeXlsx("법규기준.xlsx", [
    { name: "법규", rows: regRows },
    { name: "법규적용", rows: regApply },
  ]);

  // 설계표준_마스터.xlsx — master 노드 + REF_MASTER(참조원 → master)
  const masterRows = ["MGAP", "MTHERM", "MBEAM"].map((id) => {
    const src = inByRel(id, "REF_MASTER")[0] ?? "";
    return {
      id,
      label: label(id),
      sub: node(id).sub ?? "",
      성격: prop(id, "성격"),
      항목: prop(id, "항목") || prop(id, "원칙"),
      참조원id: src,
      관계: "REF_MASTER",
    };
  });
  writeXlsx("설계표준_마스터.xlsx", [{ name: "마스터", rows: masterRows }]);

  // 고객사_스펙.xlsx — spec 노드 + SPEC_OF(proj → spec)
  const specRows = ["SHKMC", "SGM"].map((id) => ({
    id,
    label: label(id),
    sub: node(id).sub ?? "",
    고객사: prop(id, "고객사"),
    포함: prop(id, "포함"),
    적용프로젝트: inByRel(id, "SPEC_OF").join(","),
  }));
  writeXlsx("고객사_스펙.xlsx", [{ name: "스펙", rows: specRows }]);

  // 유사도매트릭스.xlsx — proj / 부품(item) / 구성(CONSISTS_OF·THERMAL_RISK) / 유사도(SIMILAR) / 시나리오
  const projRows = ["PJ16", "PJ19", "PJ21", "PJ23", "PJ26"].map((id) => ({
    id,
    label: label(id),
    요약: node(id).sub ?? "",
    차종: prop(id, "차종"),
    광원: prop(id, "광원"),
    이슈이력: prop(id, "이슈 이력"),
    비고: prop(id, "비고"),
    상태: prop(id, "상태"),
    조건: prop(id, "조건"),
    hidden: node(id).hidden ? "Y" : "",
  }));
  const itemRows = ["IHL", "ILED", "ILG", "IHSG", "ILENS"].map((id) => ({
    id,
    label: label(id),
    요약: node(id).sub ?? "",
    구성: prop(id, "구성"),
    특성: prop(id, "특성"),
    소재: prop(id, "소재"),
    리스크: prop(id, "리스크"),
    hero: node(id).hero ? "Y" : "",
  }));
  const structRows: Record<string, unknown>[] = [];
  for (const dst of outByRel("IHL", "CONSISTS_OF")) structRows.push({ 상위id: "IHL", 하위id: dst, 하위label: label(dst), 관계: "CONSISTS_OF" });
  for (const dst of outByRel("ILED", "THERMAL_RISK")) structRows.push({ 상위id: "ILED", 하위id: dst, 하위label: label(dst), 관계: "THERMAL_RISK" });
  const simRows: Record<string, unknown>[] = [];
  for (const e of EDGES) {
    if (e.rel === "SIMILAR") simRows.push({ from_id: e.src, to_id: e.dst, weight: e.weight ?? "", scenario: e.scen ? "Y" : "" });
  }
  const scenRows: Record<string, unknown>[] = [];
  for (const e of EDGES) {
    if (e.rel === "TARGET_MARKET" || e.rel === "NEW_DESIGN_OF") scenRows.push({ from_id: e.src, to_id: e.dst, 관계: e.rel });
  }
  // 형상특징 — 과거 프로젝트의 형상 특징 벡터(도면 형상 유사 탐색의 비교 기준).
  // 신규 도면(밀폐형 슬림·벤트 2 상·하·이중 개스킷·EPDM·IP67·곡면)과 PJ21(세단 B)이
  // 최고 유사(≈0.82)가 되도록 설계 — "차명이 아니라 형상" 시연 포인트.
  const shapeRows: Record<string, unknown>[] = [
    { id: "PJ16", 시장: "한국", 하우징: "개방형", 벤트홀: "1 (하부)", 실링: "단일 개스킷", 개스킷소재: "고무", 커넥터: "IP54", 렌즈: "평면" },
    { id: "PJ19", 시장: "아시아 (동남아 포함)", 하우징: "밀폐형", 벤트홀: "2 (상·하)", 실링: "단일 개스킷", 개스킷소재: "EPDM", 커넥터: "IP66", 렌즈: "곡면" },
    { id: "PJ21", 시장: "동남아·중동", 하우징: "밀폐형 슬림", 벤트홀: "2 (상·하)", 실링: "이중 개스킷", 개스킷소재: "실리콘", 커넥터: "IP66", 렌즈: "곡면" },
    { id: "PJ23", 시장: "유럽", 하우징: "슬림", 벤트홀: "1 (상부)", 실링: "이중 개스킷", 개스킷소재: "실리콘", 커넥터: "IP67", 렌즈: "곡면" },
  ];
  writeXlsx("유사도매트릭스.xlsx", [
    { name: "프로젝트", rows: projRows },
    { name: "부품", rows: itemRows },
    { name: "구성", rows: structRows },
    { name: "유사도", rows: simRows },
    { name: "시나리오", rows: scenRows },
    { name: "형상특징", rows: shapeRows },
  ]);
}

/* ══════════ 4b. 결로 마스터(설계표준) — --master 전용 경로 ══════════
 * 신규 마스터(MFOG, seed 미포함 — normalize.ts VOCAB 에 별도 등록). 필수 항목 5개를 항목1..5
 * 컬럼에 실어 REF_MASTER(FMFOG→MFOG)로 연결한다("설계표준" 접두어 → 기존 마스터 파싱 분기 재사용,
 * 항목1..N 컬럼은 그 분기의 확장분이 처리). "하부 드레인 홀"은 온톨로지의 원인/조치 어디에도
 * 실리지 않는 항목 — masterAudit 누락(missing) 시연의 고정점. */
function buildMaster() {
  writeXlsx("설계표준_결로체크리스트.xlsx", [
    {
      name: "마스터",
      rows: [
        {
          id: "MFOG",
          label: "결로 방지 설계 마스터",
          sub: "",
          성격: "결로·습기 방지 필수 체크",
          항목1: "벤트 2개소 이상",
          항목2: "하부 드레인 홀",
          항목3: "발수 코팅",
          항목4: "개스킷 내습 등급",
          항목5: "기밀 시험 조건",
          참조원id: "FMFOG",
          관계: "REF_MASTER",
        },
      ],
    },
  ]);
}

/* ══════════ 5. 소비자 반응 (커뮤니티·카페 크롤링 대체 합성 데이터) ══════════
 * 4단계 "소비자 반응 교차" 시연용. PJ 2020-HL09 는 FMEA 에 결로 이력이 없는데 커뮤니티 언급이
 * 있는 케이스 — "내부 기록과 실사용 간 괴리(모순)"를 만드는 데이터. 실 크롤러는 확장 슬롯. */
function buildConsumerFeedback() {
  writeXlsx("소비자반응_커뮤니티.xlsx", [
    {
      name: "언급",
      rows: [
        { 프로젝트: "PJ 2021-HL12", 지역: "동남아", 계절: "여름 우기", 증상: "김서림", 언급수: 7, 출처: "자동차 커뮤니티 A", URL: "cafe-a.example.com/posts/hl12-fog" },
        { 프로젝트: "PJ 2020-HL09", 지역: "동남아", 계절: "여름", 증상: "김서림", 언급수: 4, 출처: "차주 카페 B", URL: "cafe-b.example.com/board/9284" },
        { 프로젝트: "PJ 2019-HL07", 지역: "아시아", 계절: "우기", 증상: "습기 맺힘", 언급수: 5, 출처: "오너 포럼 C", URL: "forum-c.example.com/t/1177" },
        { 프로젝트: "PJ 2023-HL15", 지역: "유럽", 계절: "겨울", 증상: "서리", 언급수: 2, 출처: "수출차 포럼 D", URL: "forum-d.example.com/t/882" },
      ],
    },
  ]);
}

/* ══════════ 실행 ══════════ */
async function main() {
  console.log("gen-sources → data/sources");
  // 파일이 외부(PowerPoint/에디터)에서 열려 잠긴 경우(EBUSY)는 기존 유효 파일을 유지하고 계속한다.
  const guard = async (p: () => Promise<unknown>, name: string) => {
    try {
      await p();
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code === "EBUSY" || err?.code === "EPERM") console.warn("  · skip(locked):", name);
      else throw e;
    }
  };
  buildBackboneFmea();
  buildReference();
  buildBulkFmea();
  buildCondensationFmea();
  buildDrawings();
  buildConsumerFeedback();
  await guard(() => buildDeck("재발방지_간극클레임.pptx", "PJ21", "FMGAP", "PTS-8812", 0), "재발방지_간극클레임.pptx");
  await guard(() => buildDeck("재발방지_배광이슈.pptx", "PJ19", "FMBEAM", "PTS-9137", 1), "재발방지_배광이슈.pptx");
  for (let i = 0; i < BULK_DECKS.length; i++) await guard(() => buildDeckRaw(BULK_DECKS[i], i), BULK_DECKS[i].file);
  for (let i = 0; i < FOG_REGIONS.length; i++) await guard(() => buildFogDeck(FOG_REGIONS[i], i), FOG_REGIONS[i].file);
  for (let i = 0; i < BULK_REPORTS.length; i++) await guard(() => buildReportRaw(BULK_REPORTS[i], i), BULK_REPORTS[i].file);
  await guard(() => buildFogReport(), "품질리포트_결로_지역별.docx");
  await buildReport("품질리포트_결로.docx", "결로", [
    ["프로젝트", label("PJ19")],
    ["부품", label("ILENS")],
    ["고장모드", label("FMFOG")],
    ["원인", label(outByRel("FMFOG", "CAUSED_BY")[0])],
    ["조치", label(outByRel("FMFOG", "MITIGATED_BY")[0])],
    ["비고", "필드 클레임 빈발 유형 · 벤트 경로 재설계"],
  ]);
  await buildReport("품질리포트_LED방열.docx", "LED 방열", [
    ["프로젝트", label("PJ19")],
    ["부품", label("ILED")],
    ["고장모드", ""], // fm 없음 → 원인(CTHERM)에 직접 조치(ARIB)
    ["원인", label("CTHERM")],
    ["조치", label(outByRel("CTHERM", "MITIGATED_BY")[0])],
    ["비고", "LED 온도 상승 → 광량 저하 · 방열 리브로 온도 저감"],
  ]);
  const files = fs.readdirSync(OUT);
  console.log("완료:", files.length, "files ·", files.join(", "));
}

// --bom: BOM 파일만 추가로 쓴다(전체 재생성으로 기존 파일을 건드리지 않기 위한 별도 실행 경로).
// --master: 결로 마스터(설계표준_결로체크리스트.xlsx) 파일만 추가로 쓴다(동일 패턴).
if (process.argv.includes("--bom")) {
  buildBom();
  console.log("완료(BOM only)");
} else if (process.argv.includes("--master")) {
  buildMaster();
  console.log("완료(MASTER only)");
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
