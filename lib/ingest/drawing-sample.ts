// lib/ingest/drawing-sample.ts — 도면 추가 시연용 샘플 DXF (서버 인메모리 생성, 결정적).
// data/sources 의 도면과 달리 부팅 시 인제스천되지 않으므로, 추가하면 실제 델타가 생긴다:
// 신규 프로젝트(PJ 2028-HL23) + 신규 부품(테일 렌즈·리플렉스 리플렉터, auto-create) +
// 기존 부품 연결(씰링 개스킷·방수벤트) + 형상 유사 SIMILAR 엣지 — 그래프에 빨간 강조로 합류.
const rows: (string | number)[] = [];
const push = (...v: (string | number)[]) => rows.push(...v);

function text(x: number, y: number, h: number, t: string) {
  push(0, "TEXT", 8, "T", 10, x, 20, y, 40, h, 1, t);
}
function line(x1: number, y1: number, x2: number, y2: number) {
  push(0, "LINE", 8, "L", 10, x1, 20, y1, 11, x2, 21, y2);
}
function rect(x: number, y: number, w: number, h: number) {
  line(x, y, x + w, y); line(x + w, y, x + w, y + h); line(x + w, y + h, x, y + h); line(x, y + h, x, y);
}

export const SAMPLE_DRAWING_NAME = "도면_신규_리어콤비_HL23.dxf";

export function buildSampleDrawingDxf(): string {
  rows.length = 0;
  push(0, "SECTION", 2, "ENTITIES");
  rect(0, 0, 297, 210);
  text(90, 198, 6, "신규 리어 콤비램프 조립도");
  // 간단 외형
  rect(110, 80, 90, 70);
  line(110, 80, 200, 150);
  // NOTE — 형상 특징
  text(12, 185, 4.5, "NOTE:");
  text(12, 178, 4, "1. 하우징: 밀폐형");
  text(12, 171, 4, "2. 벤트 홀: 1 (하부)");
  text(12, 164, 4, "3. 실링: 단일 개스킷");
  text(12, 157, 4, "4. 개스킷 소재: 실리콘");
  text(12, 150, 4, "5. 커넥터: IP66");
  text(12, 143, 4, "6. 렌즈: 평면");
  // BOM
  const bomY = 60;
  text(210, bomY + 5 * 8 + 12, 5, "BOM");
  rect(210, bomY, 82, 5 * 8 + 8);
  const header = ["품번", "품명", "수량", "재질"];
  const items = [
    ["1", "테일 렌즈", "1", "PMMA"],
    ["2", "리플렉스 리플렉터", "2", "PMMA"],
    ["3", "씰링 개스킷", "1", "실리콘"],
    ["4", "방수벤트", "1", "PTFE 멤브레인"],
    ["5", "PCB 기판", "1", "FR-4"],
  ];
  const colX = [212, 222, 262, 272];
  [header, ...items].forEach((r, i) => {
    const y = bomY + (items.length - i) * 8 + 2;
    r.forEach((c, ci) => text(colX[ci], y, 3, c));
  });
  // 제목블록
  const tb: [string, string][] = [
    ["도번", "DWG-HL23-R01"],
    ["부품명", "리어 콤비램프"],
    ["프로젝트", "PJ 2028-HL23"],
    ["차종", "준중형 세단 C (신규)"],
    ["시장", "중동·동남아"],
    ["소재", "PMMA / PC+ABS"],
  ];
  rect(150, 8, 142, tb.length * 9);
  tb.forEach(([k, v], i) => {
    const y = 8 + 9 * (tb.length - 1 - i) + 2.5;
    text(153, y, 3.6, `${k}: ${v}`);
  });
  push(0, "ENDSEC", 0, "EOF");
  return rows.join("\n") + "\n";
}
