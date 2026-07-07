// scripts/gen-test-drawings.ts — 업로드 테스트용 신규 도면(DXF) 생성.
// data/test-drawings/ 에 저장 — data/sources 가 아니므로 부팅 시 인제스천되지 않는다.
// 즉 웹의 "📐 도면 분석 → 도면 파일 선택"으로 올리면 실제 델타(신규 객체·관계)가 생긴다.
// 실행: node --experimental-strip-types scripts/gen-test-drawings.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "test-drawings");
fs.mkdirSync(OUT, { recursive: true });

function makeDxf(spec: {
  file: string; title: string; notes: string[]; bom: string[][]; tb: [string, string][];
}) {
  const rows: (string | number)[] = [0, "SECTION", 2, "ENTITIES"];
  const text = (x: number, y: number, h: number, t: string) => rows.push(0, "TEXT", 8, "T", 10, x, 20, y, 40, h, 1, t);
  const line = (x1: number, y1: number, x2: number, y2: number) => rows.push(0, "LINE", 8, "L", 10, x1, 20, y1, 11, x2, 21, y2);
  const rect = (x: number, y: number, w: number, h: number) => { line(x, y, x + w, y); line(x + w, y, x + w, y + h); line(x + w, y + h, x, y + h); line(x, y + h, x, y); };
  rect(0, 0, 297, 210);
  text(90, 198, 6, spec.title);
  rect(115, 85, 80, 60); // 간단 외형
  text(12, 185, 4.5, "NOTE:");
  spec.notes.forEach((n, i) => text(12, 178 - i * 7, 4, `${i + 1}. ${n}`));
  const bomY = 60;
  text(205, bomY + spec.bom.length * 8 + 12, 5, "BOM");
  rect(205, bomY, 88, spec.bom.length * 8 + 8);
  const colX = [207, 217, 260, 270];
  [["품번", "품명", "수량", "재질"], ...spec.bom].forEach((r, i) =>
    r.forEach((c, ci) => text(colX[ci], bomY + (spec.bom.length - i) * 8 + 2, 3, c))
  );
  rect(150, 8, 142, spec.tb.length * 9);
  spec.tb.forEach(([k, v], i) => text(153, 8 + 9 * (spec.tb.length - 1 - i) + 2.5, 3.6, `${k}: ${v}`));
  rows.push(0, "ENDSEC", 0, "EOF");
  fs.writeFileSync(path.join(OUT, spec.file), rows.join("\n") + "\n", "utf8");
  console.log("  dxf", spec.file);
}

// 테스트 도면 1 — 안개등: 헤드램프 도면과 형상이 꽤 닮음(밀폐·벤트 2·EPDM) → 높은 유사도 기대
makeDxf({
  file: "도면_신규_안개등_HL24.dxf",
  title: "신규 안개등 어셈블리 조립도",
  notes: ["하우징: 밀폐형", "벤트 홀: 2 (상·하)", "실링: 이중 개스킷", "개스킷 소재: EPDM", "커넥터: IP67", "렌즈: 곡면", "저부 장착 — 침수 IPX7 검토 요"],
  bom: [
    ["1", "안개등 렌즈", "1", "PC"],
    ["2", "안개등 하우징", "1", "PC+ABS"],
    ["3", "LED 모듈", "1", "-"],
    ["4", "실링 개스킷", "1", "EPDM"],
    ["5", "방수벤트", "2", "PTFE 멤브레인"],
  ],
  tb: [
    ["도번", "DWG-HL24-F01"], ["부품명", "안개등"], ["프로젝트", "PJ 2028-HL24"],
    ["차종", "소형 SUV D (신규)"], ["시장", "동남아"], ["소재", "PC / PC+ABS"],
  ],
});

// 테스트 도면 2 — DRL 모듈: 개방형·벤트 없음 → 낮은 유사도(대비용)
makeDxf({
  file: "도면_신규_DRL모듈_HL25.dxf",
  title: "신규 DRL 모듈 조립도",
  notes: ["하우징: 개방형 슬림", "벤트 홀: 1 (하부)", "실링: 단일 개스킷", "개스킷 소재: 고무", "커넥터: IP54", "렌즈: 평면"],
  bom: [
    ["1", "DRL 라이트가이드", "1", "PMMA"],
    ["2", "DRL 브라켓", "1", "PA6"],
    ["3", "LED 드라이버", "1", "-"],
  ],
  tb: [
    ["도번", "DWG-HL25-D01"], ["부품명", "DRL 모듈"], ["프로젝트", "PJ 2029-HL25"],
    ["차종", "준중형 세단 E (신규)"], ["시장", "유럽"], ["소재", "PMMA / PA6"],
  ],
});
// 테스트 도면 3 — 턴시그널: 낮은 IP 등급 + 밀폐형인데 벤트 1개 → 취약점 검사 "높음" 데모용
makeDxf({
  file: "도면_신규_턴시그널_HL27.dxf",
  title: "신규 턴시그널 모듈 조립도",
  notes: ["하우징: 밀폐형", "벤트 홀: 1 (하부)", "실링: 단일 개스킷", "개스킷 소재: 실리콘", "커넥터: IP54", "렌즈: 평면"],
  bom: [
    ["1", "턴시그널 렌즈", "1", "PMMA"],
    ["2", "턴시그널 하우징", "1", "PC+ABS"],
    ["3", "LED 모듈", "1", "-"],
    ["4", "실링 개스킷", "1", "실리콘"],
  ],
  tb: [
    ["도번", "DWG-HL27-T01"], ["부품명", "턴시그널 모듈"], ["프로젝트", "PJ 2029-HL27"],
    ["차종", "소형 해치백 F (신규)"], ["시장", "동남아"], ["소재", "PC+ABS / PMMA"],
  ],
});

// 테스트 도면 4 — 헤드램프 개선판: 취약점 적은 대조군(벤트 2·EPDM·IP69K·드레인 명시)
makeDxf({
  file: "도면_신규_헤드램프개선_HL28.dxf",
  title: "신규 헤드램프 어셈블리 개선 조립도",
  notes: ["하우징: 밀폐형 슬림", "벤트 홀: 2 (상·하)", "실링: 이중 개스킷", "개스킷 소재: EPDM", "커넥터: IP69K", "렌즈: 곡면", "드레인: 하부 신설"],
  bom: [
    ["1", "아우터 렌즈", "1", "PC"],
    ["2", "하우징", "1", "PC+ABS"],
    ["3", "LED 모듈", "2", "-"],
    ["4", "실링 개스킷", "1", "EPDM"],
    ["5", "방수벤트", "2", "PTFE 멤브레인"],
    ["6", "드레인 캡", "1", "실리콘"],
  ],
  tb: [
    ["도번", "DWG-HL28-A02"], ["부품명", "헤드램프 어셈블리"], ["프로젝트", "PJ 2029-HL28"],
    ["차종", "중형 SUV A (3세대)"], ["시장", "아시아 (동남아 포함)"], ["소재", "PC+ABS / PC(렌즈)"],
  ],
});
console.log("→", OUT);
