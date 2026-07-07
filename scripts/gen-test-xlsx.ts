// scripts/gen-test-xlsx.ts — 문서 인제스천 업로드 테스트용 신규 FMEA xlsx 생성.
// data/test-files/ 에 저장(부팅 인제스천 대상 아님) → 웹 "📥 문서 인제스천"으로 올리면 실제 델타 발생.
// 신규 엔티티(auto-create 66%)와 기존 엔티티(아우터 렌즈·방수벤트 등, 95% 매핑)를 섞어 두 능력을 함께 시연.
// 실행: node --experimental-strip-types scripts/gen-test-xlsx.ts
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "test-files");
fs.mkdirSync(OUT, { recursive: true });

const rows = [
  { 부품: "포지션 램프", 기능: "위치 표시", 고장모드: "렌즈 들뜸", 원인: "클립 체결력 부족", 영향: "외관 품질 저하", 심각도S: 6, 발생도O: 4, 검출도D: 5, RPN: 120, 현행조치: "체결 클립 보강", 발생프로젝트: "PJ 2029-HL26" },
  { 부품: "포지션 램프", 기능: "위치 표시", 고장모드: "씰링 파단", 원인: "씰 압축력 부족", 영향: "필드 클레임 발생", 심각도S: 7, 발생도O: 3, 검출도D: 4, RPN: 84, 현행조치: "실링 이중화", 발생프로젝트: "PJ 2029-HL26" },
  { 부품: "아우터 렌즈", 기능: "방수·방진", 고장모드: "결로·습기", 원인: "벤트·씰링 설계", 영향: "감성 품질 저하", 심각도S: 6, 발생도O: 4, 검출도D: 4, RPN: 96, 현행조치: "벤트 경로 개선", 발생프로젝트: "PJ 2029-HL26" },
  { 부품: "방수벤트", 기능: "습기 배출", 고장모드: "벤트 막힘", 원인: "분진 침투", 영향: "조기 고장", 심각도S: 5, 발생도O: 5, 검출도D: 6, RPN: 150, 현행조치: "방진 멤브레인 적용", 발생프로젝트: "PJ 2029-HL26" },
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "FMEA");
const file = path.join(OUT, "FMEA_신규_포지션램프_검토시트.xlsx");
XLSX.writeFile(wb, file);
console.log("생성:", file, "· rows", rows.length);
