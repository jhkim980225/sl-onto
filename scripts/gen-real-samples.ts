// scripts/gen-real-samples.ts — 실무에서 실제로 마주치는 "지저분한" 비정형 FMEA 문서를 생성한다.
// 실행: node --experimental-strip-types scripts/gen-real-samples.ts
// 출력: data/real-samples/ (데모용 data/sources/ 와 분리 — 데모를 오염시키지 않음)
//
// 결정적(no Math.random / no Date). gen-sources.ts 가 만드는 "깨끗한" 포맷과 달리,
// 타이틀 블록·2행 병합헤더·세로 병합 부품셀·비고행·대체 컬럼명·산문형 본문을 담는다.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const PptxGen = require("pptxgenjs");
const docx = require("docx");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "real-samples");
fs.mkdirSync(OUT, { recursive: true });

/* ══════════ 1. 실무 설계FMEA (xlsx) — 타이틀블록 + 2행 병합헤더 + 세로병합 부품셀 ══════════ */
function buildFmeaXlsx() {
  const B = "";
  // 시트1: 정식 DFMEA 워크시트(AIAG-VDA 풍). 11개 컬럼.
  // 0 항목/기능 · 1 고장모드 · 2 영향 · 3 S · 4 원인 · 5 O · 6 예방 · 7 검출 · 8 D · 9 RPN · 10 조치
  const g1: string[][] = [
    ["설계 FMEA (Design FMEA) 검토서", B, B, B, B, B, B, B, B, B, B], // row0 타이틀(병합)
    ["문서번호: DFMEA-HL-2024-017", B, B, "차종: PJ 2019-HL07", B, B, "작성자: 홍길동", B, B, B, B], // row1
    ["작성일: 2024-05-10", B, B, "개정: Rev.3", B, B, "승인: 김철수", B, B, B, B], // row2
    [B, B, B, B, B, B, B, B, B, B, B], // row3 공백
    // row4 헤더 상단(세로 병합될 셀 + 가로 병합 '현행 설계관리')
    ["항목/기능", "잠재적 고장모드", "잠재적 고장의 영향", "심각도(S)", "잠재적 고장원인/메커니즘", "발생도(O)", "현행 설계관리", B, "검출도(D)", "RPN", "권고 조치사항"],
    // row5 헤더 하단(현행 설계관리 하위: 예방/검출)
    [B, B, B, B, B, B, "예방", "검출", B, B, B],
    // row6~8: 헤드램프 어셈블리(부품셀 세로병합 3행)
    ["헤드램프 어셈블리", "결로·습기", "감성 품질 저하", "7", "벤트·씰링 설계", "5", "방열 시뮬레이션", "방수 시험", "4", "140", "벤트 경로 개선"],
    [B, "간극 벌어짐", "외관 품질 저하", "6", "조립 공차 누적", "4", "공차 분석", "치수 측정 SPC", "5", "120", "금형 치수 수정"],
    [B, "배광 편차", "법규 부적합 위험", "8", "광학 설계 오류", "3", "배광 시뮬레이션", "광학 성능 검사", "6", "144", "배광 시뮬레이션 강화"],
    // row9: 비고 구분행(고장모드 없음 → 스킵되어야 함)
    ["비고: 2024년 상반기 정기 검토 반영분", B, B, B, B, B, B, B, B, B, B],
    // row10~11: 아우터 렌즈(부품셀 세로병합 2행, 대부분 미등록 어휘)
    ["아우터 렌즈", "렌즈 크랙", "외관 품질 저하", "6", "열충격", "4", "열충격 시험", "전수 외관 검사", "5", "120", "접착 조건 변경"],
    [B, "황변", "감성 품질 저하", "5", "UV 노화", "5", "UV 안정제 첨가", "광학 성능 검사", "4", "100", "UV 안정제 첨가"],
    [B, B, B, B, B, B, B, B, B, B, B], // row12 공백
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(g1);
  const R = (sr: number, sc: number, er: number, ec: number) => ({ s: { r: sr, c: sc }, e: { r: er, c: ec } });
  ws1["!merges"] = [
    R(0, 0, 0, 10), // 타이틀
    R(1, 0, 1, 2), R(1, 3, 1, 5), R(1, 6, 1, 10), // 문서정보 라인
    R(2, 0, 2, 2), R(2, 3, 2, 5), R(2, 6, 2, 10),
    // 헤더 세로 병합(row4-5) — 현행 설계관리(6,7) 제외
    R(4, 0, 5, 0), R(4, 1, 5, 1), R(4, 2, 5, 2), R(4, 3, 5, 3), R(4, 4, 5, 4), R(4, 5, 5, 5),
    R(4, 8, 5, 8), R(4, 9, 5, 9), R(4, 10, 5, 10),
    R(4, 6, 4, 7), // '현행 설계관리' 가로 병합
    // 데이터 부품셀 세로 병합
    R(6, 0, 8, 0), // 헤드램프 어셈블리 ×3
    R(10, 0, 11, 0), // 아우터 렌즈 ×2
  ];

  // 시트2: 대체 컬럼명(동의어 강건성 테스트) — 헤더 단일행, 병합 없음.
  const g2: string[][] = [
    ["품명", "Failure Mode(EN)", "발생원인", "개선대책", "심각도"],
    ["리플렉터", "도금 부식", "도금 두께 편차", "도금 공정 관리 강화", "6"],
    ["LED 모듈", "LED 조기 사멸", "방열 설계 미흡", "방열 리브 추가", "8"],
    ["커넥터", "접촉 불량", "커넥터 단자 산화", "커넥터 방청 처리", "7"],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(g2);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "DFMEA");
  XLSX.utils.book_append_sheet(wb, ws2, "불량이력");
  XLSX.writeFile(wb, path.join(OUT, "설계FMEA_헤드램프_실무.xlsx"));
  console.log("  xlsx 설계FMEA_헤드램프_실무.xlsx (2 sheets)");
}

/* ══════════ 2. 실무 재발방지 대책서 (pptx) — 산문형 8D ══════════ */
// 깨끗한 "부품:"/"이슈:" 필드가 아니라 문장 속에 부품·고장모드·원인·대책이 녹아있다.
function buildPptx() {
  const pptx = new PptxGen();
  const slide = (lines: string[]) => {
    const s = pptx.addSlide();
    s.addText(
      lines.map((t, i) => ({ text: t, options: { breakLine: true, fontSize: i === 0 ? 22 : 14 } })),
      { x: 0.5, y: 0.4, w: 9, h: 5.4 }
    );
  };
  slide([
    "8D 재발방지 대책서",
    "문서번호: QA-8D-2024-118 / PTS-9910",
    "차종: PJ 2019-HL07",
    "작성: 품질보증팀   승인: 설계개발팀",
  ]);
  slide([
    "D2. 현상 (Problem Description)",
    "양산 초기 필드에서 헤드램프 어셈블리의 아우터 렌즈 내부에 결로·습기 현상이 반복 접수되었다.",
    "주간 점등 후 소등 시 렌즈 내면에 물방울이 맺혀 감성 품질과 광 성능이 저하된다는 고객 클레임이 다수 발생하였다.",
  ]);
  slide([
    "D4. 근본원인 분석 (Root Cause Analysis)",
    "설계·공정·재료 인자를 교차 분석한 결과, 근본 원인은 벤트·씰링 설계 미흡으로 확인되었다.",
    "램프 내부 공기의 수분이 급격한 온도 변화 시 배출되지 못하고 렌즈 내면에 응결되는 메커니즘이다.",
  ]);
  slide([
    "D5/D6. 시정조치 (Corrective Action)",
    "대책으로 벤트 경로 개선을 적용하여 내부 습기의 배출 유로를 확보하였다.",
    "상·하 벤트를 재배치하고 하부 드레인을 신설하였으며, 유사 형상 전개 시 표준으로 반영하기로 하였다.",
  ]);
  slide([
    "D7. 효과 검증 (Verification)",
    "개선 후 3개 로트 전수 검사 및 온습도 사이클 시험(-10~40°C, RH90%, 20cyc)에서 재발이 없음을 확인하였다.",
    "필드 6개월 모니터링 결과에서도 결로 클레임은 접수되지 않았다.",
  ]);
  return pptx.writeFile({ fileName: path.join(OUT, "재발방지_대책서_실무.pptx") }).then(() =>
    console.log("  pptx 재발방지_대책서_실무.pptx")
  );
}

/* ══════════ 3. 실무 품질이슈 보고서 (docx) — 산문 다문단 + 내장 표 ══════════ */
function buildDocx() {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType } = docx;
  const para = (t: string) => new Paragraph({ children: [new TextRun(t)] });
  const cell = (t: string) =>
    new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [para(t)] });
  const row = (k: string, v: string) => new TableRow({ children: [cell(k), cell(v)] });

  const children = [
    new Paragraph({ text: "품질 이슈 보고서 — 하우징 수축 변형", heading: HeadingLevel.HEADING_1 }),
    para("문서번호: QR-2024-HL03-041   작성부서: 품질보증팀"),
    new Paragraph({ text: "1. 개요", heading: HeadingLevel.HEADING_2 }),
    para(
      "PJ 2016-HL03 개발 과정에서 하우징 부품에 수축 변형 현상이 발생하여 렌즈 조립부 간극이 규격을 벗어나는 문제가 확인되었다. " +
      "본 보고서는 발생 경위와 근본 원인, 그리고 재발방지 대책을 정리한 것이다."
    ),
    new Paragraph({ text: "2. 원인 분석", heading: HeadingLevel.HEADING_2 }),
    para(
      "사출 조건과 소재 물성을 교차 검토한 결과, 근본 원인은 소재 수축 과다로 판단되었다. " +
      "슬림한 하우징 형상일수록 두께 편차에 따른 수축 영향이 커지는 경향이 관찰되었다."
    ),
    new Paragraph({ text: "3. 시정 및 재발방지", heading: HeadingLevel.HEADING_2 }),
    para(
      "대책으로 저수축 소재 변경을 적용하고 게이트 위치를 재검토하였다. " +
      "개선 효과는 초도 양산 치수 측정으로 검증하였으며, 결과를 설계 표준 체크리스트에 반영하였다."
    ),
    new Paragraph({ text: "4. 요약 (내장 표)", heading: HeadingLevel.HEADING_2 }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        row("구분", "내용"),
        row("부품", "하우징"),
        row("고장모드", "수축 변형"),
        row("원인", "소재 수축 과다"),
        row("조치", "저수축 소재 변경"),
        row("프로젝트", "PJ 2016-HL03"),
      ],
    }),
  ];
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc).then((buf: Buffer) => {
    fs.writeFileSync(path.join(OUT, "품질이슈_보고서_실무.docx"), buf);
    console.log("  docx 품질이슈_보고서_실무.docx (내장 표 포함)");
  });
}

async function main() {
  console.log("gen-real-samples → data/real-samples");
  buildFmeaXlsx();
  await buildPptx();
  await buildDocx();
  const files = fs.readdirSync(OUT);
  console.log("완료:", files.length, "files ·", files.join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
