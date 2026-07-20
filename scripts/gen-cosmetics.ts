// scripts/gen-cosmetics.ts — 가상 화장품 회사(코스메디아㈜) 비정형 문서 세트 생성.
// 실행: node --experimental-strip-types scripts/gen-cosmetics.ts
// 출력: docs/화장품/  (xlsx 20 · docx 10 · pptx 10 · pdf 6)   ※ png 4 는 gen-cosmetics-assets.py
//
// 결정적(no Math.random / no new Date). gen-sources.ts 와 같은 방식(xlsx/pptxgenjs/docx).
// 파서 계약(lib/ingest/index.ts):
//   · xlsx "BOM" 접두어 → ingestXlsxBom (상위부품/부품명·품명 동의어 컬럼)
//   · 그 외 xlsx        → ingestXlsxHeuristic (헤더 자동탐지: item+fm 컬럼 필수)
//   · pptx              → 표지 "프로젝트:/이슈:/부품:" + 슬라이드 "원인분석"/"대책"
//   · docx              → "제품명:/현상:/추정 원인:/시정조치:" (linkFreeText 폴백 경로)
// 화장품 캔버스는 빈 스키마 — 통제 어휘에 의존하지 않고 auto-create 로 노드가 만들어진다.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const PptxGen = require("pptxgenjs");
const docx = require("docx");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "docs", "화장품");
fs.mkdirSync(path.join(OUT, "이미지"), { recursive: true });

const pick = <T>(a: T[], i: number): T => a[((i % a.length) + a.length) % a.length];
const pad2 = (n: number) => String(n).padStart(2, "0");
const CO = "코스메디아㈜";

const writeXlsx = (file: string, sheets: { name: string; rows: Record<string, unknown>[] }[]) => {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name);
  XLSX.writeFile(wb, path.join(OUT, file));
  console.log("  xlsx", file, "·", sheets.reduce((a, s) => a + s.rows.length, 0), "rows");
};

/* ══════════ 정본 엔티티 ══════════ */

interface Product { code: string; name: string; full: string; proj: string; form: string; lots: string[]; regs: string[]; pkg: string }
const PRODUCTS: Product[] = [
  { code: "CP-101", name: "하이드라 수분크림", full: "CP-101 하이드라 수분크림 50ml", proj: "PJ 2025-CP101", form: "O/W 크림", lots: ["CP101-2501A", "CP101-2504B", "CP101-2508C"], regs: ["화장품법(한국)", "화장품 안전기준 등에 관한 규정", "EU 화장품규정 1223/2009", "CPNP 등록", "ISO 22716(GMP)"], pkg: "자사 단지형 용기 50ml" },
  { code: "CP-102", name: "비타C 브라이트닝 앰플", full: "CP-102 비타C 브라이트닝 앰플 30ml", proj: "PJ 2025-CP102", form: "가용화 앰플", lots: ["CP102-2502A", "CP102-2505B", "CP102-2509C"], regs: ["화장품법(한국)", "기능성화장품 심사 규정", "화장품 안전기준 등에 관한 규정", "ISO 22716(GMP)"], pkg: "차광 드로퍼 용기 30ml" },
  { code: "CP-203", name: "시카 진정 토너", full: "CP-203 시카 진정 토너 200ml", proj: "PJ 2025-CP203", form: "가용화 토너", lots: ["CP203-2503A", "CP203-2506B", "CP203-2510C"], regs: ["화장품법(한국)", "중국 NMPA 등록", "화장품 안전기준 등에 관한 규정", "ISO 22716(GMP)"], pkg: "PET 원통 용기 200ml" },
  { code: "CP-204", name: "콜라겐 리프팅 아이크림", full: "CP-204 콜라겐 리프팅 아이크림 20ml", proj: "PJ 2025-CP204", form: "W/O 아이크림", lots: ["CP204-2501A", "CP204-2505B", "CP204-2511C"], regs: ["화장품법(한국)", "EU 화장품규정 1223/2009", "CPNP 등록", "ISO 22716(GMP)"], pkg: "알루미늄 튜브 20ml" },
  { code: "CP-305", name: "UV 선크림 SPF50+", full: "CP-305 UV 선크림 SPF50+ 50ml", proj: "PJ 2025-CP305", form: "혼합자차 선크림", lots: ["CP305-2502A", "CP305-2507B", "CP305-2510C"], regs: ["화장품법(한국)", "기능성화장품 심사 규정", "MoCRA(미국)", "ISO 22716(GMP)"], pkg: "펌프 용기 50ml" },
  { code: "CP-306", name: "매트 쿠션 파운데이션", full: "CP-306 매트 쿠션 파운데이션 15g", proj: "PJ 2025-CP306", form: "쿠션 파운데이션", lots: ["CP306-2504A", "CP306-2508B", "CP306-2512C"], regs: ["화장품법(한국)", "MoCRA(미국)", "중국 NMPA 등록", "ISO 22716(GMP)"], pkg: "쿠션 콤팩트 15g" },
];
const P = (code: string) => PRODUCTS.find((p) => p.code === code)!;

const SUPPLIERS = ["한울정밀화학", "노바인그리디언츠", "신정소재", "대화케미칼", "세림향료", "우진팩"];

// 원료 32종: [한글명, INCI, 카테고리, 규격/성상, 공급사idx]
const ING: [string, string, string, string, number][] = [
  ["정제수", "Water", "용제", "정제수 USP · 전도도 1.0uS/cm 이하", 2],
  ["글리세린", "Glycerin", "보습제", "순도 99.5% 이상 · 식물성", 0],
  ["부틸렌글라이콜", "Butylene Glycol", "보습제", "순도 99.0% 이상", 0],
  ["나이아신아마이드", "Niacinamide", "미백 활성", "순도 99.0% 이상 · 백색 결정", 1],
  ["아데노신", "Adenosine", "주름개선 활성", "순도 99.0% 이상 · 백색 분말", 1],
  ["소듐하이알루로네이트", "Sodium Hyaluronate", "보습제", "분자량 100만~150만 Da", 1],
  ["세라마이드NP", "Ceramide NP", "장벽 활성", "순도 96.0% 이상 · 백색 분말", 1],
  ["판테놀", "Panthenol", "진정 활성", "순도 98.0% 이상", 0],
  ["알란토인", "Allantoin", "진정 활성", "순도 98.5% 이상", 0],
  ["마데카소사이드", "Madecassoside", "진정 활성", "순도 95.0% 이상 · 병풀 추출", 1],
  ["아스코빌글루코사이드", "Ascorbyl Glucoside", "미백 활성", "순도 98.0% 이상 · 차광 보관", 1],
  ["토코페롤", "Tocopherol", "산화방지제", "순도 96.0% 이상 · 질소 봉입", 3],
  ["스쿠알란", "Squalane", "유분·에몰리언트", "요오드가 4 이하 · 사탕수수 유래", 3],
  ["시어버터", "Butyrospermum Parkii (Shea) Butter", "유분·에몰리언트", "융점 32~40도", 3],
  ["카프릴릭/카프릭트라이글리세라이드", "Caprylic/Capric Triglyceride", "유분·에몰리언트", "산가 0.1 이하", 3],
  ["다이메티콘", "Dimethicone", "실리콘 오일", "점도 350 cSt", 3],
  ["사이클로펜타실록세인", "Cyclopentasiloxane", "실리콘 오일", "순도 99.0% 이상", 3],
  ["카보머", "Carbomer", "점증제", "1% 수용액 점도 45,000~65,000 cP", 0],
  ["잔탄검", "Xanthan Gum", "점증제", "1% 수용액 점도 1,200~1,600 cP", 0],
  ["폴리소르베이트60", "Polysorbate 60", "유화제", "HLB 14.9", 0],
  ["세테아릴알코올", "Cetearyl Alcohol", "유화 보조제", "융점 49~56도", 0],
  ["글리세릴스테아레이트", "Glyceryl Stearate", "유화제", "HLB 3.8", 0],
  ["페녹시에탄올", "Phenoxyethanol", "보존제", "순도 99.0% 이상 · 배합한도 1.0%", 3],
  ["에틸헥실글리세린", "Ethylhexylglycerin", "보존 보조제", "순도 98.0% 이상", 3],
  ["1,2-헥산다이올", "1,2-Hexanediol", "보존 보조제", "순도 99.0% 이상", 3],
  ["다이소듐이디티에이", "Disodium EDTA", "킬레이트제", "순도 99.0% 이상", 2],
  ["시트릭애씨드", "Citric Acid", "pH 조절제", "순도 99.5% 이상 · 무수", 2],
  ["티타늄디옥사이드", "Titanium Dioxide", "자외선차단 성분", "입도 D50 0.25um · 표면처리", 2],
  ["징크옥사이드", "Zinc Oxide", "자외선차단 성분", "입도 D50 0.30um · 표면처리", 2],
  ["에틸헥실메톡시신나메이트", "Ethylhexyl Methoxycinnamate", "자외선차단 성분", "순도 98.0% 이상", 2],
  ["향료", "Fragrance (Parfum)", "향료", "알레르기 유발성분 표시 대상 관리", 4],
  ["황색5호", "CI 15985", "색소", "식약처 고시 색소 · 순도 시험 적합", 4],
];
const INCI = new Map(ING.map((i) => [i[0], i[1]]));
const ICAT = new Map(ING.map((i) => [i[0], i[2]]));
const ISPEC = new Map(ING.map((i) => [i[0], i[3]]));
const ISUP = new Map(ING.map((i) => [i[0], SUPPLIERS[i[4]]]));

// 정본 이슈 18건 — 모든 문서(QC·클레임·docx·pptx)가 이 표를 공유해 그래프가 붙는다.
interface Issue { id: string; prod: string; fm: string; cause: string; action: string; lot: string; date: string; sev: number; qty: number }
const ISSUES: Issue[] = [
  { id: "Q-2501", prod: "CP-101", fm: "상분리", cause: "유화제 함량 부족", action: "유화 공정 온도 프로파일 개정", lot: "CP101-2501A", date: "2025-01-17", sev: 8, qty: 42 },
  { id: "Q-2502", prod: "CP-204", fm: "향 변취", cause: "자외선 노출", action: "차광 용기 변경", lot: "CP204-2501A", date: "2025-01-28", sev: 5, qty: 18 },
  { id: "Q-2503", prod: "CP-102", fm: "변색(황변)", cause: "자외선 노출", action: "차광 용기 변경", lot: "CP102-2502A", date: "2025-02-11", sev: 7, qty: 61 },
  { id: "Q-2504", prod: "CP-305", fm: "뭉침(알갱이)", cause: "점증제 수화 불충분", action: "교반 RPM 표준화", lot: "CP305-2502A", date: "2025-02-24", sev: 6, qty: 27 },
  { id: "Q-2505", prod: "CP-203", fm: "미생물 한도 초과", cause: "보존제 함량 미달", action: "보존제 재설계(challenge test 재실시)", lot: "CP203-2503A", date: "2025-03-14", sev: 9, qty: 15 },
  { id: "Q-2506", prod: "CP-101", fm: "점도 저하", cause: "교반 속도 편차", action: "교반 RPM 표준화", lot: "CP101-2504B", date: "2025-04-09", sev: 6, qty: 33 },
  { id: "Q-2507", prod: "CP-306", fm: "충전량 부족", cause: "충전 온도 이탈", action: "충전 노즐 세정 주기 단축", lot: "CP306-2504A", date: "2025-04-22", sev: 7, qty: 55 },
  { id: "Q-2508", prod: "CP-204", fm: "내용물 누액", cause: "실링 압력 부족", action: "실링 조건 밸리데이션", lot: "CP204-2505B", date: "2025-05-13", sev: 8, qty: 24 },
  { id: "Q-2509", prod: "CP-102", fm: "피부 자극", cause: "pH 이탈", action: "pH 완충 시스템 도입", lot: "CP102-2505B", date: "2025-05-27", sev: 9, qty: 12 },
  { id: "Q-2510", prod: "CP-203", fm: "이취(산패취)", cause: "원료 로트 편차", action: "원료 입고검사 강화", lot: "CP203-2506B", date: "2025-06-18", sev: 6, qty: 29 },
  { id: "Q-2511", prod: "CP-305", fm: "펌프 토출 불량", cause: "용기 상용성 불량", action: "용기 상용성 재평가", lot: "CP305-2507B", date: "2025-07-15", sev: 5, qty: 47 },
  { id: "Q-2512", prod: "CP-101", fm: "총호기성생균수 초과", cause: "작업환경 미생물 오염", action: "보존제 재설계(challenge test 재실시)", lot: "CP101-2508C", date: "2025-08-06", sev: 9, qty: 9 },
  { id: "Q-2513", prod: "CP-306", fm: "캡 크랙", cause: "용기 상용성 불량", action: "용기 상용성 재평가", lot: "CP306-2508B", date: "2025-08-25", sev: 4, qty: 38 },
  { id: "Q-2514", prod: "CP-102", fm: "침전", cause: "HLB 불일치", action: "유화 공정 온도 프로파일 개정", lot: "CP102-2509C", date: "2025-09-11", sev: 6, qty: 21 },
  { id: "Q-2515", prod: "CP-203", fm: "라벨 박리", cause: "용기 상용성 불량", action: "용기 상용성 재평가", lot: "CP203-2510C", date: "2025-10-08", sev: 3, qty: 44 },
  { id: "Q-2516", prod: "CP-305", fm: "점도 상승", cause: "원료 로트 편차", action: "원료 입고검사 강화", lot: "CP305-2510C", date: "2025-10-27", sev: 5, qty: 17 },
  { id: "Q-2517", prod: "CP-204", fm: "결정 석출", cause: "냉각 속도 과다", action: "유화 공정 온도 프로파일 개정", lot: "CP204-2511C", date: "2025-11-19", sev: 7, qty: 26 },
  { id: "Q-2518", prod: "CP-306", fm: "발림성 불량", cause: "원료 로트 편차", action: "원료 입고검사 강화", lot: "CP306-2512C", date: "2025-12-09", sev: 5, qty: 31 },
];
const I = (id: string) => ISSUES.find((x) => x.id === id)!;

// 제품별 처방(원료 + 배합비). 합계 100% 가 되도록 정제수로 잔량 조정.
const FORMULA: Record<string, [string, number][]> = {
  "CP-101": [["글리세린", 6.0], ["부틸렌글라이콜", 4.0], ["소듐하이알루로네이트", 0.15], ["나이아신아마이드", 2.0], ["판테놀", 1.0], ["알란토인", 0.2], ["세라마이드NP", 0.5], ["스쿠알란", 5.0], ["시어버터", 3.0], ["카프릴릭/카프릭트라이글리세라이드", 4.0], ["다이메티콘", 1.5], ["세테아릴알코올", 2.0], ["글리세릴스테아레이트", 2.5], ["폴리소르베이트60", 1.2], ["카보머", 0.25], ["잔탄검", 0.15], ["다이소듐이디티에이", 0.05], ["시트릭애씨드", 0.05], ["페녹시에탄올", 0.4], ["에틸헥실글리세린", 0.1], ["1,2-헥산다이올", 1.5], ["토코페롤", 0.1], ["향료", 0.1]],
  "CP-102": [["부틸렌글라이콜", 8.0], ["글리세린", 5.0], ["아스코빌글루코사이드", 2.0], ["나이아신아마이드", 2.0], ["아데노신", 0.04], ["소듐하이알루로네이트", 0.2], ["판테놀", 1.0], ["폴리소르베이트60", 0.8], ["잔탄검", 0.2], ["다이소듐이디티에이", 0.05], ["시트릭애씨드", 0.08], ["1,2-헥산다이올", 2.0], ["페녹시에탄올", 0.3], ["에틸헥실글리세린", 0.1], ["토코페롤", 0.05], ["향료", 0.05]],
  "CP-203": [["부틸렌글라이콜", 5.0], ["글리세린", 3.0], ["마데카소사이드", 0.3], ["알란토인", 0.2], ["판테놀", 1.5], ["소듐하이알루로네이트", 0.1], ["폴리소르베이트60", 0.6], ["잔탄검", 0.1], ["다이소듐이디티에이", 0.05], ["시트릭애씨드", 0.06], ["1,2-헥산다이올", 2.0], ["페녹시에탄올", 0.35], ["에틸헥실글리세린", 0.1], ["향료", 0.05]],
  "CP-204": [["글리세린", 5.0], ["부틸렌글라이콜", 3.0], ["아데노신", 0.04], ["세라마이드NP", 0.8], ["소듐하이알루로네이트", 0.1], ["스쿠알란", 8.0], ["시어버터", 6.0], ["카프릴릭/카프릭트라이글리세라이드", 6.0], ["다이메티콘", 3.0], ["사이클로펜타실록세인", 4.0], ["세테아릴알코올", 3.0], ["글리세릴스테아레이트", 3.5], ["카보머", 0.2], ["잔탄검", 0.1], ["다이소듐이디티에이", 0.05], ["시트릭애씨드", 0.04], ["페녹시에탄올", 0.4], ["에틸헥실글리세린", 0.1], ["1,2-헥산다이올", 1.5], ["토코페롤", 0.2], ["향료", 0.08]],
  "CP-305": [["티타늄디옥사이드", 6.0], ["징크옥사이드", 10.0], ["에틸헥실메톡시신나메이트", 7.5], ["사이클로펜타실록세인", 8.0], ["다이메티콘", 4.0], ["카프릴릭/카프릭트라이글리세라이드", 5.0], ["스쿠알란", 3.0], ["글리세린", 4.0], ["부틸렌글라이콜", 3.0], ["글리세릴스테아레이트", 2.0], ["세테아릴알코올", 1.5], ["폴리소르베이트60", 1.0], ["카보머", 0.2], ["잔탄검", 0.15], ["다이소듐이디티에이", 0.05], ["시트릭애씨드", 0.05], ["페녹시에탄올", 0.4], ["에틸헥실글리세린", 0.1], ["1,2-헥산다이올", 1.5], ["토코페롤", 0.1]],
  "CP-306": [["티타늄디옥사이드", 9.0], ["징크옥사이드", 4.0], ["황색5호", 0.02], ["사이클로펜타실록세인", 12.0], ["다이메티콘", 6.0], ["카프릴릭/카프릭트라이글리세라이드", 4.0], ["스쿠알란", 2.0], ["글리세린", 4.0], ["부틸렌글라이콜", 3.0], ["글리세릴스테아레이트", 1.5], ["세테아릴알코올", 1.0], ["폴리소르베이트60", 0.8], ["잔탄검", 0.15], ["다이소듐이디티에이", 0.05], ["시트릭애씨드", 0.05], ["페녹시에탄올", 0.4], ["에틸헥실글리세린", 0.1], ["1,2-헥산다이올", 1.5], ["토코페롤", 0.1], ["향료", 0.05]],
};
const FN_OF = (ing: string) => ICAT.get(ing) ?? "기타";

/* ══════════ xlsx 1~6. 처방전(배합비) ══════════
 * "BOM" 접두어 → ingestXlsxBom. 상위부품=제품, "원료 품명"=하위(원료), 수량(배합비)/재질(규격) props. */
function buildFormulas() {
  for (const p of PRODUCTS) {
    const rows: Record<string, unknown>[] = [];
    const list = FORMULA[p.code];
    const sum = list.reduce((a, [, v]) => a + v, 0);
    const water = Math.round((100 - sum) * 100) / 100;
    const all: [string, number][] = [["정제수", water], ...list];
    all.forEach(([ing, pct], i) => {
      rows.push({
        상위부품: p.full,
        "원료 품명": ing,
        INCI명: INCI.get(ing),
        "수량(배합비 %)": pct,
        기능: FN_OF(ing),
        공급사: ing === "정제수" ? "사내 정제수 설비" : ISUP.get(ing),
        "재질(원료 규격)": ISPEC.get(ing),
        투입상: i === 0 ? "수상" : ["유분·에몰리언트", "실리콘 오일", "유화제", "유화 보조제", "산화방지제", "자외선차단 성분"].includes(FN_OF(ing)) ? "유상" : FN_OF(ing) === "향료" || FN_OF(ing) === "보존제" || FN_OF(ing) === "보존 보조제" ? "후첨상" : "수상",
        투입온도: i === 0 ? "75도" : ["유분·에몰리언트", "실리콘 오일", "유화제", "유화 보조제"].includes(FN_OF(ing)) ? "75도" : "40도 이하",
      });
    });
    writeXlsx(`BOM_처방_${p.code.replace("-", "")}_${p.name.replace(/\s/g, "")}.xlsx`, [{ name: "처방", rows }]);
  }
}

/* ══════════ xlsx 7~9. 포장자재 BOM ══════════ */
const PKG_PARTS: Record<string, [string, string, number, string][]> = {
  "CP-101": [["단지 용기 본체 50ml", "PETG", 1, "우진팩"], ["단지 이너캡", "PP", 1, "우진팩"], ["단지 외캡", "ABS 증착", 1, "우진팩"], ["스파츌라", "PS", 1, "우진팩"], ["라벨(전면)", "PP 필름", 1, "우진팩"], ["라벨(후면 전성분)", "PP 필름", 1, "우진팩"], ["단상자", "백판지 350g", 1, "우진팩"], ["설명서", "모조지 80g", 1, "우진팩"], ["단상자 봉함 스티커", "PET", 1, "우진팩"], ["완충 인서트", "펄프몰드", 1, "우진팩"], ["수축필름", "PVC", 1, "우진팩"], ["외박스", "골판지 A골", 1, "우진팩"], ["파렛트 라벨", "감열지", 1, "우진팩"], ["실링 디스크", "알루미늄 라미네이트", 1, "우진팩"], ["가스켓", "PE", 1, "우진팩"], ["보관용 지퍼백", "LDPE", 1, "우진팩"], ["로트 각인 라벨", "PET", 1, "우진팩"], ["QR 인증 라벨", "PET", 1, "우진팩"], ["단상자 내지", "백판지 250g", 1, "우진팩"], ["출하 테이프", "OPP", 1, "우진팩"]],
  "CP-203": [["PET 원통 용기 200ml", "PET", 1, "우진팩"], ["이너 플러그", "LDPE", 1, "우진팩"], ["스크류 캡", "PP", 1, "우진팩"], ["캡 라이너", "PE 폼", 1, "우진팩"], ["라벨(전면)", "PP 필름", 1, "우진팩"], ["라벨(후면 전성분)", "PP 필름", 1, "우진팩"], ["라벨 접착제", "수성 아크릴", 1, "우진팩"], ["단상자", "백판지 300g", 1, "우진팩"], ["설명서", "모조지 70g", 1, "우진팩"], ["봉함 스티커", "PET", 1, "우진팩"], ["수축필름", "PETG", 1, "우진팩"], ["외박스", "골판지 B골", 1, "우진팩"], ["칸막이", "골판지", 1, "우진팩"], ["파렛트 라벨", "감열지", 1, "우진팩"], ["출하 테이프", "OPP", 1, "우진팩"], ["로트 각인", "잉크젯", 1, "사내"], ["QR 인증 라벨", "PET", 1, "우진팩"], ["완충 인서트", "펄프몰드", 1, "우진팩"], ["샘플 파우치", "알루미늄 라미네이트", 2, "우진팩"], ["보관용 지퍼백", "LDPE", 1, "우진팩"], ["방습제", "실리카겔", 1, "우진팩"], ["운송 라벨", "감열지", 1, "우진팩"]],
  "CP-305": [["펌프 용기 본체 50ml", "PP", 1, "우진팩"], ["펌프 헤드", "PP+POM", 1, "우진팩"], ["펌프 스프링", "STS304", 1, "우진팩"], ["펌프 가스켓", "실리콘", 1, "우진팩"], ["딥튜브", "LDPE", 1, "우진팩"], ["오버캡", "PP", 1, "우진팩"], ["숄더 링", "ABS 증착", 1, "우진팩"], ["라벨(전면)", "PP 필름", 1, "우진팩"], ["라벨(후면 전성분)", "PP 필름", 1, "우진팩"], ["기능성 표시 라벨", "PP 필름", 1, "우진팩"], ["단상자", "백판지 350g", 1, "우진팩"], ["설명서", "모조지 80g", 1, "우진팩"], ["봉함 스티커", "PET", 1, "우진팩"], ["수축필름", "PETG", 1, "우진팩"], ["완충 인서트", "펄프몰드", 1, "우진팩"], ["외박스", "골판지 A골", 1, "우진팩"], ["칸막이", "골판지", 1, "우진팩"], ["방습제", "실리카겔", 1, "우진팩"], ["파렛트 라벨", "감열지", 1, "우진팩"], ["QR 인증 라벨", "PET", 1, "우진팩"], ["로트 각인", "잉크젯", 1, "사내"], ["출하 테이프", "OPP", 1, "우진팩"], ["샘플 파우치", "알루미늄 라미네이트", 2, "우진팩"], ["운송 라벨", "감열지", 1, "우진팩"]],
};
function buildPkgBom() {
  for (const code of Object.keys(PKG_PARTS)) {
    const p = P(code);
    const rows: Record<string, unknown>[] = [{ 레벨: 0, 상위부품: "", 부품명: p.pkg, 품번: `${code}-PK-000`, 수량: 1, 재질: "-", 공급사: "우진팩", 규격: p.full }];
    PKG_PARTS[code].forEach(([name, mat, qty, sup], i) => {
      rows.push({ 레벨: 1, 상위부품: p.pkg, 부품명: name, 품번: `${code}-PK-${pad2(i + 1)}0`, 수량: qty, 재질: mat, 공급사: sup, 규격: `${p.full} 전용` });
    });
    writeXlsx(`BOM_포장자재_${code.replace("-", "")}.xlsx`, [{ name: "포장자재", rows }]);
  }
}

/* ══════════ xlsx 10. 원료 규격서 마스터 + 규제 적용 ══════════ */
function buildIngredientMaster() {
  const rows = ING.map(([kr, inci, cat, spec, sup], i) => ({
    상위부품: cat,
    "원료 품명": kr,
    INCI명: inci,
    "재질(원료 규격)": spec,
    "수량(표준 투입 %)": "",
    공급사: kr === "정제수" ? "사내 정제수 설비" : SUPPLIERS[sup],
    원료코드: `RM-${1000 + i * 7}`,
    "보관조건": ["차광 · 실온", "실온 · 밀폐", "냉장 2~8도", "질소 봉입 · 차광"][i % 4],
    "재검사 주기": ["12개월", "24개월", "6개월"][i % 3],
    "사용 제품": PRODUCTS.filter((p) => kr === "정제수" || FORMULA[p.code].some(([g]) => g === kr)).map((p) => p.code).join(" "),
  }));
  const regRows: Record<string, unknown>[] = [];
  for (const p of PRODUCTS) for (const r of p.regs) regRows.push({ 상위부품: p.full, 부품명: r, 재질: "규제·인증", 수량: 1, 비고: `${p.code} 적용 대상` });
  writeXlsx("BOM_원료규격서_마스터.xlsx", [
    { name: "원료마스터", rows },
    { name: "규제적용", rows: regRows },
  ]);
}

/* ══════════ 휴리스틱 xlsx 공통(QC/미생물/안정성/클레임) ══════════
 * 헤더: 프로젝트(proj) · 제품 품명(item) · … · 부적합 현상(fm) · 추정 원인(cause) · 조치(action)
 * → detectHeader 가 item+fm 을 찾아 행 단위로 HAS_FAILURE/CAUSED_BY/MITIGATED_BY/OCCURRED_IN 생성. */

const QC_ITEMS: [string, string][] = [
  ["성상", "고유의 성상"], ["색상", "고유의 색상"], ["향취", "고유의 향취"], ["pH", "5.0 ~ 6.5"],
  ["점도(cP)", "8,000 ~ 25,000"], ["비중", "0.95 ~ 1.05"], ["충전량(g)", "표시량 ±3%"], ["경도", "규격 내"],
  ["유화 입자경(um)", "1.0 이하"], ["상분리 여부", "없음"], ["이물", "없음"], ["총호기성생균수(CFU/g)", "1,000 이하"],
  ["대장균", "불검출"], ["녹농균", "불검출"], ["황색포도상구균", "불검출"], ["납(ppm)", "20 이하"],
  ["비소(ppm)", "10 이하"], ["수은(ppm)", "1 이하"], ["안티몬(ppm)", "10 이하"], ["카드뮴(ppm)", "5 이하"],
  ["디옥산(ppm)", "100 이하"], ["메탄올(ppm)", "2,000 이하"], ["포름알데하이드(ppm)", "2,000 이하"], ["프탈레이트류(ppm)", "100 이하"],
  ["용기 밀폐성", "누액 없음"], ["펌프 토출량(mg)", "표시량 ±10%"], ["라벨 접착력", "박리 없음"], ["캡 토크(kgf·cm)", "8 ~ 14"],
  ["내용물 온도안정성", "이상 없음"], ["표시기재사항", "적합"], ["SPF 지속력", "규격 내"], ["발림성 관능", "적합"],
  ["색상 편차 dE", "1.5 이하"], ["결정 석출", "없음"], ["기포", "없음"], ["침전", "없음"],
  ["잔류 용매", "불검출"], ["보존력(challenge)", "적합"], ["중량 편차", "±3% 이내"], ["포장 외관", "적합"],
];
const QC_VAL = (i: number, item: string): string => {
  if (item === "pH") return (5.2 + ((i * 7) % 12) / 10).toFixed(2);
  if (item.startsWith("점도")) return String(9000 + ((i * 743) % 15000));
  if (item.startsWith("총호기성")) return `<${10 * ((i % 8) + 1)}`;
  if (item.startsWith("충전량")) return (49.2 + ((i * 3) % 16) / 10).toFixed(2);
  if (item === "비중") return (0.96 + ((i * 5) % 9) / 100).toFixed(3);
  if (/불검출|없음/.test(item)) return "없음";
  return ["적합", "이상 없음", "규격 내"][i % 3];
};

function qcRows(p: Product, lot: string, seed: number, n: number, fails: Issue[]) {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const [item, spec] = pick(QC_ITEMS, seed + i);
    const f = fails[i % fails.length];
    const bad = i > 0 && i % Math.max(3, Math.floor(n / (fails.length + 1))) === 0 && rows.filter((r) => r["부적합 현상"]).length < fails.length;
    const idx = rows.filter((r) => r["부적합 현상"]).length;
    const use = bad ? fails[idx % fails.length] : f;
    rows.push({
      프로젝트: p.proj,
      "제품 품명": p.full,
      로트번호: lot,
      검사항목: item,
      규격: spec,
      실측: bad ? "규격 이탈" : QC_VAL(seed + i, item),
      판정: bad ? "부적합" : "적합",
      "부적합 현상": bad ? use.fm : "",
      "추정 원인": bad ? use.cause : "",
      조치: bad ? use.action : "",
      시험자: pick(["김하늘", "박지훈", "이서연", "정민호"], seed + i),
      시험일: `2025-${pad2(((seed + i) % 12) + 1)}-${pad2(((i * 5) % 27) + 1)}`,
    });
  }
  return rows;
}

function buildQc() {
  const specs: [string, string, string, Issue[], number][] = [
    ["QC성적서_CP101_CP101-2501A.xlsx", "CP-101", "CP101-2501A", [I("Q-2501"), I("Q-2506")], 3],
    ["QC성적서_CP102_CP102-2502A.xlsx", "CP-102", "CP102-2502A", [I("Q-2503"), I("Q-2509"), I("Q-2514")], 11],
    ["QC성적서_CP305_CP305-2502A.xlsx", "CP-305", "CP305-2502A", [I("Q-2504"), I("Q-2511"), I("Q-2516")], 19],
    ["QC성적서_CP306_CP306-2504A.xlsx", "CP-306", "CP306-2504A", [I("Q-2507"), I("Q-2513"), I("Q-2518")], 27],
  ];
  const n = [40, 32, 36, 25];
  specs.forEach(([file, code, lot, fails, seed], i) => {
    writeXlsx(file, [{ name: "QC성적서", rows: qcRows(P(code), lot, seed, n[i], fails) }]);
  });
}

const MICRO_ITEMS: [string, string][] = [
  ["총호기성생균수(CFU/g)", "1,000 이하"], ["진균수(CFU/g)", "500 이하"], ["대장균", "불검출"], ["녹농균", "불검출"],
  ["황색포도상구균", "불검출"], ["칸디다알비칸스", "불검출"], ["보존력 D7 세균 감소", "2 log 이상"], ["보존력 D14 세균 감소", "3 log 이상"],
  ["보존력 D28 세균 유지", "증가 없음"], ["보존력 D28 진균 유지", "증가 없음"], ["페녹시에탄올 함량(%)", "0.30 ~ 0.45"], ["1,2-헥산다이올 함량(%)", "1.40 ~ 1.60"],
  ["작업장 낙하균(CFU/plate)", "10 이하"], ["충전 노즐 표면 세균", "불검출"], ["정제수 생균수(CFU/ml)", "100 이하"], ["용기 세척 후 생균수", "10 이하"],
  ["작업자 손 표면 세균", "불검출"], ["공조 필터 차압(mmAq)", "규격 내"],
];
function buildMicro() {
  const specs: [string, string, string, Issue][] = [
    ["미생물시험성적서_CP203_CP203-2503A.xlsx", "CP-203", "CP203-2503A", I("Q-2505")],
    ["미생물시험성적서_CP101_CP101-2508C.xlsx", "CP-101", "CP101-2508C", I("Q-2512")],
  ];
  specs.forEach(([file, code, lot, iss], si) => {
    const p = P(code);
    const rows = MICRO_ITEMS.map(([item, spec], i) => {
      const bad = i === 0 || i === 6 || (si === 1 && i === 12);
      return {
        프로젝트: p.proj,
        "제품 품명": p.full,
        로트번호: lot,
        시험항목: item,
        기준: spec,
        실측: bad ? (i === 0 ? "2,400" : i === 6 ? "1.2 log" : "38") : i === 0 ? "<10" : "적합",
        판정: bad ? "부적합" : "적합",
        "이상 현상": bad ? iss.fm : "",
        "추정 원인": bad ? iss.cause : "",
        조치: bad ? iss.action : "",
        시험방법: "화장품 안전기준 등에 관한 규정 별표4",
        시험일: `2025-${pad2((si * 5 + 3) % 12 + 1)}-${pad2(((i * 3) % 27) + 1)}`,
      };
    });
    writeXlsx(file, [{ name: "미생물시험", rows }]);
  });
}

const STAB_ITEMS = ["성상", "색상", "향취", "pH", "점도(cP)", "상분리", "결정 석출", "총호기성생균수(CFU/g)", "충전량(g)", "용기 밀폐성"];
function buildStability() {
  const conds: [string, string, string][] = [
    ["안정성시험_가속_45도.xlsx", "가속(45도 · RH75%)", "가속"],
    ["안정성시험_장기_25도.xlsx", "장기(25도 · RH60%)", "장기"],
    ["안정성시험_순환_냉동해동.xlsx", "순환(-10도 <-> 45도 · 6cycle)", "순환"],
  ];
  const months = [0, 1, 2, 3, 6];
  conds.forEach(([file, cond, kind], ci) => {
    const rows: Record<string, unknown>[] = [];
    const targets = ci === 0 ? ["CP-101", "CP-102"] : ci === 1 ? ["CP-203", "CP-204"] : ["CP-305", "CP-306"];
    for (const code of targets) {
      const p = P(code);
      const lot = p.lots[0];
      const iss = ISSUES.filter((x) => x.prod === code);
      months.forEach((m, mi) => {
        STAB_ITEMS.forEach((item, ii) => {
          const k = mi * 10 + ii + ci;
          const bad = m >= 3 && ((ii === 4 && mi === 4) || (ii === 5 && mi === 3 && ci === 0) || (ii === 6 && mi === 4 && ci === 2));
          const use = pick(iss, k);
          rows.push({
            "시점(개월)": m,
            보관조건: cond,
            프로젝트: p.proj,
            "제품 품명": p.full,
            로트번호: lot,
            시험항목: item,
            규격: item === "pH" ? "초기 대비 ±0.5" : item.startsWith("점도") ? "초기 대비 ±20%" : "이상 없음",
            실측: bad ? "규격 이탈" : QC_VAL(k, item),
            판정: bad ? "부적합" : "적합",
            "이상 현상": bad ? use.fm : "",
            "추정 원인": bad ? use.cause : "",
            조치: bad ? use.action : "",
            시험구분: kind,
            시험일: `2025-${pad2(((ci * 3 + mi) % 12) + 1)}-${pad2(((ii * 3) % 27) + 1)}`,
          });
        });
      });
    }
    writeXlsx(file, [{ name: "안정성시험", rows }]);
  });
}

const REGIONS = ["서울", "경기", "부산", "대구", "광주", "대전", "제주", "인천", "강원", "충남"];
const CHANNELS = ["온라인몰", "H&B 스토어", "백화점", "면세점", "홈쇼핑", "해외 직구"];
const ROUTES = ["고객센터 전화", "온라인 문의", "매장 접수", "이메일", "SNS 채널"];
const RESULTS = ["교환", "환불", "재발송", "설명 안내", "회수 후 분석"];
function buildClaims() {
  const rows: Record<string, unknown>[] = [];
  for (let k = 0; k < 120; k++) {
    const iss = pick(ISSUES, k * 7 + (k >> 3));
    const p = P(iss.prod);
    const mo = (k % 12) + 1;
    rows.push({
      접수번호: `CL-2025-${String(1000 + k)}`,
      접수일: `2025-${pad2(mo)}-${pad2(((k * 5) % 28) + 1)}`,
      프로젝트: p.proj,
      "제품 품명": p.full,
      로트번호: iss.lot,
      지역: pick(REGIONS, k * 3),
      유통채널: pick(CHANNELS, k * 5 + 1),
      "증상 현상": iss.fm,
      "추정 원인": iss.cause,
      "처리결과 조치": iss.action,
      처리구분: pick(RESULTS, k + 2),
      접수경로: pick(ROUTES, k * 2),
      "심각도(1-10)": iss.sev,
      "동일로트 누적건수": iss.qty,
      "재발여부": k % 9 === 0 ? "재발" : "최초",
    });
  }
  writeXlsx("클레임집계_2025_전제품.xlsx", [{ name: "클레임", rows }]);
}

/* ══════════ docx ══════════
 * "부품/고장모드/원인/조치" 정확 키를 피해 linkFreeText 경로를 태운다:
 *   제품명:(품명→item) · 현상:(fm) · 추정 원인:(원인→cause) · 시정조치:(조치→action) · 프로젝트:(proj) */
function buildDocx(file: string, title: string, fields: [string, string][], sections: [string, string[]][]) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docx;
  const para = (t: string) => new Paragraph({ children: [new TextRun(t)] });
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    ...fields.map(([k, v]) => para(`${k}: ${v}`)),
    ...sections.flatMap(([h, ps]) => [new Paragraph({ text: h, heading: HeadingLevel.HEADING_2 }), ...ps.map(para)]),
  ];
  return Packer.toBuffer(new Document({ sections: [{ children }] })).then((buf: Buffer) => {
    fs.writeFileSync(path.join(OUT, file), buf);
    console.log("  docx", file);
  });
}

const baseFields = (iss: Issue, docNo: string): [string, string][] => {
  const p = P(iss.prod);
  return [
    ["문서번호", docNo],
    ["작성부서", "품질보증팀"],
    ["작성일", iss.date],
    ["프로젝트", p.proj],
    ["제품명", p.full],
    ["제품코드", p.code],
    ["제형", p.form],
    ["로트번호", iss.lot],
    ["현상", iss.fm],
    ["추정 원인", iss.cause],
    ["시정조치", iss.action],
    ["심각도", `${iss.sev} / 10`],
    ["접수건수", `${iss.qty}건`],
    ["적용 법규", p.regs.join(" · ")],
  ];
};

function buildIssueReports() {
  const specs: [string, string][] = [
    ["Q-2501", "품질이슈리포트_CP101_상분리.docx"],
    ["Q-2503", "품질이슈리포트_CP102_변색황변.docx"],
    ["Q-2505", "품질이슈리포트_CP203_미생물한도초과.docx"],
    ["Q-2508", "품질이슈리포트_CP204_내용물누액.docx"],
    ["Q-2511", "품질이슈리포트_CP305_펌프토출불량.docx"],
  ];
  return specs.map(([iid, file], i) => {
    const iss = I(iid);
    const p = P(iss.prod);
    const docNo = `QA-IR-2025-${pad2(i + 1)}`;
    return buildDocx(file, `품질 이슈 리포트 — ${p.code} ${iss.fm}`, baseFields(iss, docNo), [
      ["1. 개요", [
        `${CO} ${p.proj} 에서 생산한 ${p.full} 로트 ${iss.lot} 에 대하여 ${iss.date} 자로 ${iss.fm} 이슈가 접수되었다. 접수 시점 기준 동일 로트 누적 ${iss.qty}건이며 심각도는 ${iss.sev}점으로 평가되었다.`,
        `해당 제형은 ${p.form} 으로 ${p.pkg} 에 충전된다. 이슈 확인 즉시 동일 로트 재고를 출하 보류 처리하고 잔량 시료를 품질보증팀 보관 시료실로 이관하였다.`,
      ]],
      ["2. 현상 상세", [
        `외관 검사 결과 ${iss.fm} 이 육안으로 확인되었으며 보관 온도 상승 조건에서 현상이 가속되는 경향을 보였다. 동일 로트 보관 시료 10점 중 재현율은 40퍼센트 수준이다.`,
        `이화학 시험에서 pH 는 ${(5.1 + (iss.sev % 9) / 10).toFixed(2)}, 점도는 ${9000 + iss.qty * 137} cP 로 측정되어 초기값 대비 편차가 관찰되었다. 총호기성생균수는 ${iss.fm.includes("생균") || iss.fm.includes("미생물") ? "2,400 CFU/g 으로 기준(1,000 이하) 초과" : "100 CFU/g 미만으로 기준 이내"} 였다.`,
      ]],
      ["3. 원인 분석", [
        `제조 기록서와 공정 파라미터를 역추적한 결과 ${iss.cause} 가 근본 원인으로 판단되었다. 원료 입고 성적서, 칭량 기록, 유화 온도 프로파일, 냉각 곡선, 충전 조건을 교차 검토하였다.`,
        `동일 제형의 정상 로트와 비교 시험을 실시하여 해당 인자만을 변경한 재현 시험에서 동일 현상이 재현되었으며 이로써 원인 인자가 확정되었다.`,
      ]],
      ["4. 조치 및 재발방지", [
        `단기 조치로 해당 로트 전량 회수 및 폐기를 결정하였고 근본 대책으로 ${iss.action} 를 적용한다. 개선 후 3개 로트에 대하여 안정성 가속 시험과 미생물 한도 시험을 재실시한다.`,
        `개선 사항은 제조 표준서와 QC 검사 기준서에 반영하며 신규 개발 제품의 설계 검토 체크리스트에도 등재한다.`,
      ]],
      ["5. 규제 검토", [
        `적용 법규는 ${p.regs.join(" 및 ")} 이며 본 이슈는 표시기재나 안전성 항목의 위반에는 해당하지 않는다. 다만 ISO 22716 기준 일탈 관리 절차에 따라 일탈 보고서를 별도 기록한다.`,
      ]],
    ]);
  });
}

function buildDeviationReports() {
  const specs: [string, string, string][] = [
    ["Q-2507", "공정편차보고서_CP306_충전공정.docx", "DEV-2025-04"],
    ["Q-2506", "공정편차보고서_CP101_유화공정.docx", "DEV-2025-07"],
  ];
  return specs.map(([iid, file, no]) => {
    const iss = I(iid);
    const p = P(iss.prod);
    return buildDocx(file, `공정 편차(Deviation) 보고서 — ${p.code}`, baseFields(iss, no), [
      ["1. 편차 개요", [
        `${iss.date} ${p.full} 로트 ${iss.lot} 제조 중 공정 파라미터가 제조 표준서 범위를 벗어난 것이 확인되었다. 편차 등급은 Major 로 분류하였다.`,
        `편차 발견 즉시 생산을 중단하고 반제품을 격리하였으며 품질보증팀 책임자 승인 하에 조사에 착수하였다.`,
      ]],
      ["2. 편차 내용", [
        `표준 조건은 유화 온도 75도 유지 10분, 교반 3,000 RPM, 냉각 속도 분당 1.5도, 충전 온도 32도 이하이다. 실제 기록은 해당 항목 중 일부가 관리 범위를 이탈하였다.`,
        `공정 이탈의 직접 요인은 ${iss.cause} 로 확인되었으며 설비 로그와 작업자 인터뷰로 교차 검증하였다.`,
      ]],
      ["3. 품질 영향 평가", [
        `해당 반제품에 대하여 성상, pH, 점도, 유화 입자경, 미생물 한도 시험을 재실시한 결과 ${iss.fm} 항목에서 규격 이탈이 확인되어 제품 품질에 영향이 있다고 판단하였다.`,
      ]],
      ["4. 조치", [
        `${iss.action} 를 적용하고 관련 작업자를 재교육한다. 설비 예방정비 주기를 단축하고 파라미터 자동 기록 알람을 설정한다.`,
      ]],
    ]);
  });
}

function buildCapa() {
  const specs: [string, string, string][] = [
    ["Q-2505", "CAPA보고서_CP203_보존제재설계.docx", "CAPA-2025-02"],
    ["Q-2511", "CAPA보고서_CP305_용기상용성.docx", "CAPA-2025-05"],
  ];
  return specs.map(([iid, file, no]) => {
    const iss = I(iid);
    const p = P(iss.prod);
    return buildDocx(file, `CAPA 보고서 — ${p.code} ${iss.fm}`, baseFields(iss, no), [
      ["1. 문제 정의", [
        `${p.full} 로트 ${iss.lot} 에서 발생한 ${iss.fm} 은 단발성 불량이 아니라 동일 원인(${iss.cause})이 반복 작용한 계통 불량으로 판단되었다. 2025년 누적 접수 ${iss.qty}건이다.`,
      ]],
      ["2. 시정조치(Corrective Action)", [
        `${iss.action} 를 즉시 적용한다. 적용 범위는 동일 제형 전 품목이며 적용 시점 이후 생산분부터 유효하다.`,
        `기 생산 재고는 전수 재검사 후 적합품만 출하하고 부적합품은 폐기 처리한다.`,
      ]],
      ["3. 예방조치(Preventive Action)", [
        `수평 전개 대상은 ${PRODUCTS.filter((x) => x.code !== p.code).slice(0, 3).map((x) => x.code).join(" ")} 이며 동일 위험 인자를 가진 제형의 표준서를 일괄 개정한다.`,
        `원료 입고검사 항목에 로트 편차 관리 지표를 추가하고 공급사 정기 감사 주기를 24개월에서 12개월로 단축한다.`,
      ]],
      ["4. 효과성 검증", [
        `개선 후 3개 로트에 대하여 안정성 가속 3개월 시험과 challenge test 를 실시하여 모든 항목 적합을 확인한다. 검증 완료 후 CAPA 를 종결한다.`,
      ]],
    ]);
  });
}

function buildConsumerInvestigation() {
  const iss = I("Q-2503");
  const p = P(iss.prod);
  return buildDocx("소비자클레임조사_CP102_변색.docx", `소비자 클레임 조사 보고서 — ${p.code}`, baseFields(iss, "CS-2025-11"), [
    ["1. 접수 현황", [
      `2025년 2월부터 10월까지 ${p.full} 에 대하여 총 ${iss.qty}건의 변색 관련 클레임이 접수되었다. 채널별로는 온라인몰이 절반 이상을 차지하였고 지역별로는 서울과 경기 비중이 높았다.`,
      `접수 사유의 대부분은 개봉 후 2주 경과 시점에 내용물이 노랗게 변하였다는 내용이었다.`,
    ]],
    ["2. 회수품 분석", [
      `회수품 12점을 분석한 결과 색차계 dE 값이 평균 3.8 로 기준(1.5 이하)을 초과하였다. 아스코빌글루코사이드 함량은 초기 대비 68퍼센트 수준으로 감소하였다.`,
      `직사광선 노출 조건에서 보관한 시료가 실내 보관 시료보다 변색 속도가 3배 빨랐다.`,
    ]],
    ["3. 결론", [
      `근본 원인은 ${iss.cause} 로 확정되었으며 ${iss.action} 를 적용하기로 하였다. 병행하여 사용 설명서에 직사광선 회피 문구를 추가한다.`,
    ]],
  ]);
}

/* ══════════ pptx ══════════
 * 앵커: 표지 "프로젝트:/이슈:/부품:" · 슬라이드 "원인분석"(원인 라벨만) · "대책"(첫 줄=조치 라벨) */
const C_NAVY = "1A2B49", C_ACC = "00A2E5", C_SUB = "5B6B81", C_LINE = "D8DEE9", C_BG = "F3F7FB";

interface Deck { file: string; kind: string; issue: string; extraCauses: string[]; verify: string[]; docNo: string }
function buildDeck(d: Deck) {
  const iss = I(d.issue);
  const p = P(iss.prod);
  const pptx = new PptxGen();
  pptx.defineLayout({ name: "WIDE", width: 10, height: 5.63 });
  pptx.layout = "WIDE";

  const section = (title: string) => {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addText(title, { x: 0.45, y: 0.28, w: 9.1, h: 0.55, fontSize: 22, bold: true, color: C_NAVY });
    s.addShape("rect", { x: 0.45, y: 0.86, w: 1.1, h: 0.045, fill: { color: C_ACC }, line: { type: "none" } });
    return s;
  };
  const body = (s: any, lines: string[], y = 1.1, fs = 14) =>
    s.addText(lines.map((t, i) => ({ text: t, options: { breakLine: true, fontSize: fs, color: i === 0 ? C_NAVY : C_SUB } })),
      { x: 0.5, y, w: 9, h: 0.42 * lines.length + 0.2, valign: "top" });
  const table = (s: any, rows: string[][], y: number, colW: number[]) =>
    s.addTable(rows.map((r, ri) => r.map((c) => ({ text: c, options: ri === 0 ? { bold: true, color: "FFFFFF", fill: { color: C_NAVY }, fontSize: 11 } : { color: C_NAVY, fill: { color: ri % 2 === 0 ? C_BG : "FFFFFF" }, fontSize: 11 } }))),
      { x: 0.5, y, w: 9, colW, border: { pt: 0.5, color: C_LINE }, rowH: 0.3 });

  // 표지(앵커)
  {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape("rect", { x: 0, y: 0, w: 10, h: 0.14, fill: { color: C_ACC }, line: { type: "none" } });
    s.addText(d.kind, { x: 0.6, y: 1.0, w: 8.8, h: 0.9, fontSize: 34, bold: true, color: C_NAVY });
    body(s, [
      `프로젝트: ${p.proj}`,
      `이슈: ${iss.fm}`,
      `부품: ${p.full}`,
      `로트번호: ${iss.lot}`,
      `문서번호: ${d.docNo}`,
      `작성 품질보증팀 · 검토 연구개발팀 · 승인 생산본부`,
    ], 2.0, 15);
    s.addText(`${CO} · Quality Assurance · 2025`, { x: 0.62, y: 4.9, w: 8.8, h: 0.4, fontSize: 11, color: C_SUB });
  }
  // 현상
  {
    const s = section("현상");
    body(s, [`${p.full} 로트 ${iss.lot}`, `${iss.fm} 현상이 반복 확인되어 감성 품질과 안전성에 영향을 준다.`, `제형 ${p.form} · 용기 ${p.pkg}`], 1.05, 13);
    table(s, [
      ["접수 시기", "접수 경로", "건수", "비고"],
      [iss.date.slice(0, 7), "고객센터 클레임", String(Math.round(iss.qty * 0.5)), "최초 접수"],
      [`2025-${pad2(Math.min(12, Number(iss.date.slice(5, 7)) + 1))}`, "유통사 반품", String(Math.round(iss.qty * 0.3)), "유사 증상"],
      [`2025-${pad2(Math.min(12, Number(iss.date.slice(5, 7)) + 2))}`, "사내 안정성 시험", String(iss.qty - Math.round(iss.qty * 0.5) - Math.round(iss.qty * 0.3)), "재현 확인"],
    ], 2.6, [1.8, 3.2, 1.2, 2.8]);
  }
  // 발생 경위
  {
    const s = section("발생 경위");
    table(s, [
      ["일자", "단계", "내용"],
      [iss.date, "이슈 접수", `${d.docNo} 접수 · 동일 로트 출하 보류`],
      [`2025-${pad2(Number(iss.date.slice(5, 7)))}-${pad2(Math.min(28, Number(iss.date.slice(8, 10)) + 3))}`, "긴급 대응", "재고 전수 선별 및 보관 시료 확보"],
      [`2025-${pad2(Math.min(12, Number(iss.date.slice(5, 7)) + 1))}-05`, "원인 조사", "제조기록 역추적 및 재현 시험 착수"],
      [`2025-${pad2(Math.min(12, Number(iss.date.slice(5, 7)) + 2))}-12`, "대책 수립", `${iss.action} 적용안 확정`],
      [`2025-${pad2(Math.min(12, Number(iss.date.slice(5, 7)) + 3))}-20`, "검증 완료", "개선 로트 안정성 시험 합격"],
    ], 1.1, [1.6, 1.6, 5.8]);
  }
  // 5-Why
  {
    const s = section("5-Why 분석");
    table(s, [
      ["단계", "질문", "답"],
      ["Why 1", `왜 ${iss.fm} 이 발생했는가`, `${p.form} 제형에서 현상이 반복 관찰됨`],
      ["Why 2", "왜 해당 로트에 집중되는가", `${iss.cause} 관리 범위가 넓게 설정됨`],
      ["Why 3", "왜 관리 범위가 넓었는가", `${d.extraCauses[0] ?? iss.cause} 영향이 초기 검토에서 누락됨`],
      ["Why 4", "왜 누락되었는가", "유사 제형 이력이 체크리스트로 연결되지 않음"],
      ["Why 5", "왜 연결되지 않았는가", "과거 문서가 비정형으로 분산되어 검색이 어려움"],
    ], 1.1, [1.0, 3.6, 4.4]);
  }
  // 원인분석 (앵커 — 원인 라벨만)
  { body(section("원인분석"), [iss.cause, ...d.extraCauses], 1.15, 16); }
  // 원인 검증
  {
    const s = section("원인 검증");
    table(s, [
      ["후보 원인", "검증 방법", "판정"],
      [iss.cause, "인자 단독 변경 재현 시험", "재현됨 · 근본 원인"],
      ...d.extraCauses.map((c, i) => [c, i === 0 ? "제조기록 상관 분석" : "원료 로트 비교 시험", i === 0 ? "부분 기여 · 병행 관리" : "기각"]),
    ], 1.1, [3.4, 3.4, 2.2]);
  }
  // 대책 (앵커 — 첫 줄 = 조치)
  {
    const s = section("대책");
    body(s, [iss.action, `${iss.action} 적용으로 근본 원인(${iss.cause})을 제거하고 동일 제형 전 품목에 수평 전개한다.`], 1.05, 14);
    table(s, [
      ["구분", "개선 전", "개선 후"],
      ["공정", `${iss.cause} 관리 미흡`, iss.action],
      ["검사", "출하검사 샘플링", "중간공정 전수 모니터링 추가"],
      ["결과", `클레임 ${iss.qty}건`, "개선 로트 재발 0건"],
    ], 2.75, [1.4, 3.8, 3.8]);
  }
  // 검증 결과
  { body(section("검증 결과"), [...d.verify, "개선 후 3로트 전수 검사 및 유통 모니터링에서 재발 없음 확인."], 1.15, 14); }
  // 규제 검토
  { body(section("규제 검토"), [`적용 법규: ${p.regs.join(" · ")}`, "ISO 22716 일탈 관리 절차에 따라 일탈 보고서를 기록하고 연간 품질 리뷰에 포함한다."], 1.15, 14); }
  // 수평 전개
  {
    const s = section("수평 전개 및 표준화");
    table(s, [
      ["적용 대상", "적용 항목", "일정"],
      [PRODUCTS.filter((x) => x.code !== p.code)[0].full, iss.action, "2025 Q4"],
      [PRODUCTS.filter((x) => x.code !== p.code)[1].full, "제조 표준서 개정", "2026 Q1"],
      ["신규 개발 전 품목", "설계 검토 체크리스트 반영", "상시"],
    ], 1.1, [3.6, 3.4, 2.0]);
  }
  // 근거
  { body(section("근거"), [`접수번호: ${d.docNo}`, `관련 프로젝트: ${p.proj}`, `로트: ${iss.lot}`, "첨부: QC 성적서 · 안정성 시험 데이터 · 클레임 집계 · 회수품 사진"], 1.15, 14); }

  return pptx.writeFile({ fileName: path.join(OUT, d.file) }).then(() => console.log("  pptx", d.file));
}

const DECKS: Deck[] = [
  { file: "8D_CP101_상분리.pptx", kind: "8D 리포트", issue: "Q-2501", extraCauses: ["HLB 불일치", "교반 속도 편차"], verify: ["가속 45도 3개월 안정성 시험 합격", "유화 입자경 1.0um 이하 유지 확인"], docNo: "QA-8D-2025-01" },
  { file: "8D_CP203_미생물한도초과.pptx", kind: "8D 리포트", issue: "Q-2505", extraCauses: ["작업환경 미생물 오염", "pH 이탈"], verify: ["challenge test 전 균주 규격 만족", "작업장 낙하균 10 CFU/plate 이하 유지"], docNo: "QA-8D-2025-02" },
  { file: "8D_CP306_충전량부족.pptx", kind: "8D 리포트", issue: "Q-2507", extraCauses: ["용기 상용성 불량", "원료 로트 편차"], verify: ["충전량 편차 ±1.2% 이내 확보", "노즐 세정 주기 단축 후 재현 없음"], docNo: "QA-8D-2025-03" },
  { file: "8D_CP305_펌프토출불량.pptx", kind: "8D 리포트", issue: "Q-2511", extraCauses: ["점증제 수화 불충분", "충전 온도 이탈"], verify: ["펌프 토출량 표시량 ±5% 이내", "용기 상용성 6개월 시험 합격"], docNo: "QA-8D-2025-04" },
  { file: "재발방지_CP102_변색황변.pptx", kind: "재발방지 대책서", issue: "Q-2503", extraCauses: ["원료 로트 편차", "pH 이탈"], verify: ["차광 용기 적용 후 dE 1.2 유지", "광안정성 시험 합격"], docNo: "QA-CA-2025-01" },
  { file: "재발방지_CP204_내용물누액.pptx", kind: "재발방지 대책서", issue: "Q-2508", extraCauses: ["용기 상용성 불량", "충전 온도 이탈"], verify: ["실링 강도 규격 상향 후 누액 0건", "수송 진동 시험 합격"], docNo: "QA-CA-2025-02" },
  { file: "재발방지_CP204_결정석출.pptx", kind: "재발방지 대책서", issue: "Q-2517", extraCauses: ["HLB 불일치", "유화제 함량 부족"], verify: ["냉각 프로파일 개정 후 석출 없음", "순환 시험 6cycle 합격"], docNo: "QA-CA-2025-03" },
];

function buildDevReviewDeck(file: string, p: Product, docNo: string, risks: [string, string][]) {
  const pptx = new PptxGen();
  pptx.defineLayout({ name: "WIDE", width: 10, height: 5.63 });
  pptx.layout = "WIDE";
  const section = (t: string) => {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addText(t, { x: 0.45, y: 0.28, w: 9.1, h: 0.55, fontSize: 22, bold: true, color: C_NAVY });
    s.addShape("rect", { x: 0.45, y: 0.86, w: 1.1, h: 0.045, fill: { color: C_ACC }, line: { type: "none" } });
    return s;
  };
  const body = (s: any, lines: string[], y = 1.1, fs = 14) =>
    s.addText(lines.map((t, i) => ({ text: t, options: { breakLine: true, fontSize: fs, color: i === 0 ? C_NAVY : C_SUB } })),
      { x: 0.5, y, w: 9, h: 0.42 * lines.length + 0.2, valign: "top" });
  const table = (s: any, rows: string[][], y: number, colW: number[]) =>
    s.addTable(rows.map((r, ri) => r.map((c) => ({ text: c, options: ri === 0 ? { bold: true, color: "FFFFFF", fill: { color: C_NAVY }, fontSize: 11 } : { color: C_NAVY, fill: { color: ri % 2 === 0 ? C_BG : "FFFFFF" }, fontSize: 11 } }))),
      { x: 0.5, y, w: 9, colW, border: { pt: 0.5, color: C_LINE }, rowH: 0.3 });

  const first = ISSUES.find((x) => x.prod === p.code)!;
  {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape("rect", { x: 0, y: 0, w: 10, h: 0.14, fill: { color: C_ACC }, line: { type: "none" } });
    s.addText("신제품 개발 리뷰", { x: 0.6, y: 1.0, w: 8.8, h: 0.9, fontSize: 34, bold: true, color: C_NAVY });
    body(s, [`프로젝트: ${p.proj}`, `이슈: ${first.fm}`, `부품: ${p.full}`, `문서번호: ${docNo}`, `제형: ${p.form}`], 2.0, 15);
    s.addText(`${CO} · R&D Review · 2025`, { x: 0.62, y: 4.9, w: 8.8, h: 0.4, fontSize: 11, color: C_SUB });
  }
  { body(section("개발 개요"), [`${p.full}`, `제형 ${p.form} · 용기 ${p.pkg}`, `목표 pH 5.0~6.5 · 목표 점도 8,000~25,000 cP`, `적용 법규: ${p.regs.join(" · ")}`], 1.15, 14); }
  {
    const s = section("처방 구성");
    const top = FORMULA[p.code].slice(0, 6);
    table(s, [["원료", "INCI", "배합비(%)", "기능"], ...top.map(([g, v]) => [g, INCI.get(g)!, String(v), FN_OF(g)])], 1.1, [2.6, 3.2, 1.4, 1.8]);
  }
  { body(section("원인분석"), [first.cause, ...risks.map((r) => r[0])], 1.15, 16); }
  {
    const s = section("리스크 검토");
    table(s, [["리스크", "예상 원인", "대응"], ...risks.map(([c, a]) => [c, first.cause, a])], 1.1, [3.0, 3.0, 3.0]);
  }
  { body(section("대책"), [first.action, `개발 단계에서 ${first.action} 를 선행 반영하여 양산 이관 후 재발을 차단한다.`], 1.05, 14); }
  { body(section("검증 계획"), ["가속 45도 RH75% 3개월 안정성 시험", "장기 25도 RH60% 12개월 안정성 시험", "challenge test 및 미생물 한도 시험", "용기 상용성 6개월 시험", "임상 피부 자극 시험(첩포)"], 1.15, 14); }
  { body(section("근거"), [`문서번호: ${docNo}`, `프로젝트: ${p.proj}`, "첨부: 처방전 · 원료 규격서 · 안정성 시험 계획서"], 1.15, 14); }
  return pptx.writeFile({ fileName: path.join(OUT, file) }).then(() => console.log("  pptx", file));
}

function buildMonthlyReview() {
  const pptx = new PptxGen();
  pptx.defineLayout({ name: "WIDE", width: 10, height: 5.63 });
  pptx.layout = "WIDE";
  const section = (t: string) => {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addText(t, { x: 0.45, y: 0.28, w: 9.1, h: 0.55, fontSize: 22, bold: true, color: C_NAVY });
    s.addShape("rect", { x: 0.45, y: 0.86, w: 1.1, h: 0.045, fill: { color: C_ACC }, line: { type: "none" } });
    return s;
  };
  const body = (s: any, lines: string[], y = 1.1, fs = 14) =>
    s.addText(lines.map((t, i) => ({ text: t, options: { breakLine: true, fontSize: fs, color: i === 0 ? C_NAVY : C_SUB } })),
      { x: 0.5, y, w: 9, h: 0.42 * lines.length + 0.2, valign: "top" });
  const table = (s: any, rows: string[][], y: number, colW: number[]) =>
    s.addTable(rows.map((r, ri) => r.map((c) => ({ text: c, options: ri === 0 ? { bold: true, color: "FFFFFF", fill: { color: C_NAVY }, fontSize: 11 } : { color: C_NAVY, fill: { color: ri % 2 === 0 ? C_BG : "FFFFFF" }, fontSize: 11 } }))),
      { x: 0.5, y, w: 9, colW, border: { pt: 0.5, color: C_LINE }, rowH: 0.28 });

  const top = I("Q-2503");
  {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape("rect", { x: 0, y: 0, w: 10, h: 0.14, fill: { color: C_ACC }, line: { type: "none" } });
    s.addText("품질 월간 리뷰 2025-12", { x: 0.6, y: 1.0, w: 8.8, h: 0.9, fontSize: 32, bold: true, color: C_NAVY });
    body(s, [`프로젝트: ${P(top.prod).proj}`, `이슈: ${top.fm}`, `부품: ${P(top.prod).full}`, "문서번호: QA-MR-2025-12"], 2.0, 15);
    s.addText(`${CO} · Quality Assurance`, { x: 0.62, y: 4.9, w: 8.8, h: 0.4, fontSize: 11, color: C_SUB });
  }
  {
    const s = section("이슈 집계");
    table(s, [["제품", "주요 현상", "원인", "건수"], ...ISSUES.slice(0, 10).map((x) => [P(x.prod).code, x.fm, x.cause, String(x.qty)])], 1.05, [1.6, 2.8, 3.2, 1.4]);
  }
  { body(section("원인분석"), ["원료 로트 편차", "용기 상용성 불량", "교반 속도 편차", "자외선 노출"], 1.15, 16); }
  { body(section("대책"), ["원료 입고검사 강화", "공급사 정기 감사 주기를 12개월로 단축하고 로트 편차 관리 지표를 입고 성적서에 추가한다."], 1.05, 14); }
  {
    const s = section("조치 진행 현황");
    table(s, [["조치", "대상 제품", "상태"],
      ["유화 공정 온도 프로파일 개정", "CP-101 CP-204", "완료"],
      ["보존제 재설계(challenge test 재실시)", "CP-203 CP-101", "진행"],
      ["용기 상용성 재평가", "CP-305 CP-306", "진행"],
      ["차광 용기 변경", "CP-102 CP-204", "완료"],
      ["충전 노즐 세정 주기 단축", "CP-306", "완료"],
    ], 1.1, [4.0, 3.0, 2.0]);
  }
  { body(section("근거"), ["문서번호: QA-MR-2025-12", "첨부: 클레임집계_2025_전제품 · QC 성적서 · 안정성 시험"], 1.15, 14); }
  return pptx.writeFile({ fileName: path.join(OUT, "품질월간리뷰_2025_12.pptx") }).then(() => console.log("  pptx 품질월간리뷰_2025_12.pptx"));
}

/* ══════════ PDF (영문 전용, 라이브러리 없이 직접 작성) ══════════
 * 최소 유효 PDF: uncompressed content stream · Helvetica(base14) · xref 오프셋 정확 계산.
 * pypdf 로 텍스트 추출 가능. */
const pdfEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function writePdf(file: string, pages: string[][]) {
  const objs: string[] = [];
  const n = pages.length;
  const fontObj = 3 + n * 2;
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`);
  pages.forEach((lines, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
    const content =
      `BT\n/F1 10 Tf\n14 TL\n1 0 0 1 54 742 Tm\n` +
      lines.map((l) => `(${pdfEsc(l)}) Tj T*`).join("\n") +
      `\nET\n`;
    objs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`);
  });
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(path.join(OUT, file), Buffer.from(out, "latin1"));
  console.log("  pdf ", file, "·", pages.length, "pages");
}

function buildPdfs() {
  const hdr = (title: string, sub: string) => [
    "COSMEDIA CO., LTD.  (fictional company - sample document)",
    "12 Sanup-ro, Cheongju-si, Chungcheongbuk-do, Republic of Korea",
    "",
    title,
    sub,
    "-".repeat(88),
    "",
  ];

  // 1-2. MSDS
  const msds = (name: string, inci: string, cas: string, file: string, extra: string[]) =>
    writePdf(file, [
      [
        ...hdr(`SAFETY DATA SHEET (SDS)`, `Product: ${name}  /  INCI: ${inci}`),
        "SECTION 1. IDENTIFICATION",
        `  Product name          : ${name}`,
        `  INCI name             : ${inci}`,
        `  CAS number            : ${cas}`,
        "  Recommended use       : Cosmetic raw material",
        "  Supplier              : Hanul Fine Chemicals (fictional)",
        "  Emergency telephone   : +82-43-000-0000",
        "  Revision date         : 2025-03-01   Version 3.0",
        "",
        "SECTION 2. HAZARDS IDENTIFICATION",
        "  GHS classification    : Not classified as hazardous under GHS criteria",
        "  Signal word           : None",
        "  Hazard statements     : None known under normal conditions of use",
        "  Precautionary stmts   : Avoid contact with eyes. Wash hands after handling.",
        "",
        "SECTION 3. COMPOSITION / INFORMATION ON INGREDIENTS",
        `  ${inci} ................................ 99.0 - 100.0 %`,
        "  Water ..................................... 0.0 - 1.0 %",
        "",
        "SECTION 4. FIRST-AID MEASURES",
        "  Inhalation  : Move to fresh air. Seek medical advice if discomfort persists.",
        "  Skin        : Wash with plenty of water and soap.",
        "  Eyes        : Rinse cautiously with water for several minutes.",
        "  Ingestion   : Rinse mouth. Do not induce vomiting. Seek medical advice.",
        "",
        "SECTION 5. FIRE-FIGHTING MEASURES",
        "  Suitable extinguishing media : Water spray, dry chemical, carbon dioxide, foam.",
        "  Specific hazards             : Combustion may produce carbon oxides.",
        "  Protective equipment         : Self-contained breathing apparatus.",
        "",
        "SECTION 6. ACCIDENTAL RELEASE MEASURES",
        "  Personal precautions   : Avoid slipping hazard. Ventilate the area.",
        "  Environmental measures : Prevent entry into drains and waterways.",
        "  Clean-up methods       : Absorb with inert material and collect in containers.",
        "",
        "SECTION 7. HANDLING AND STORAGE",
        "  Handling : Use in a well ventilated area. Keep container tightly closed.",
        "  Storage  : Store below 30 C in a dry place away from direct sunlight.",
        "",
        "SECTION 8. EXPOSURE CONTROLS / PERSONAL PROTECTION",
        "  Engineering controls : General ventilation is normally adequate.",
        "  Eye protection       : Safety glasses with side shields.",
        "  Hand protection      : Nitrile rubber gloves.",
        "  Respiratory          : Not required under normal use.",
      ],
      [
        ...hdr("SAFETY DATA SHEET (SDS) - continued", `Product: ${name}  Page 2 of 3`),
        "SECTION 9. PHYSICAL AND CHEMICAL PROPERTIES",
        ...extra,
        "",
        "SECTION 10. STABILITY AND REACTIVITY",
        "  Chemical stability      : Stable under recommended storage conditions.",
        "  Conditions to avoid     : Excessive heat, direct sunlight, open flame.",
        "  Incompatible materials  : Strong oxidizing agents.",
        "  Hazardous decomposition : Carbon monoxide, carbon dioxide.",
        "",
        "SECTION 11. TOXICOLOGICAL INFORMATION",
        "  Acute oral toxicity   : LD50 (rat) > 2000 mg/kg",
        "  Skin irritation       : Non-irritating at use concentration",
        "  Eye irritation        : Mild irritation possible at high concentration",
        "  Sensitization         : Not a skin sensitizer",
        "  Carcinogenicity       : Not listed by IARC, NTP or OSHA",
        "",
        "SECTION 12. ECOLOGICAL INFORMATION",
        "  Biodegradability : Readily biodegradable",
        "  Bioaccumulation  : Not expected to bioaccumulate",
        "",
        "SECTION 13. DISPOSAL CONSIDERATIONS",
        "  Dispose of contents and container in accordance with local regulations.",
        "",
        "SECTION 14. TRANSPORT INFORMATION",
        "  UN number : Not regulated as dangerous goods (ADR / IMDG / IATA).",
      ],
      [
        ...hdr("SAFETY DATA SHEET (SDS) - continued", `Product: ${name}  Page 3 of 3`),
        "SECTION 15. REGULATORY INFORMATION",
        "  Korea    : Cosmetics Act, Regulation on Safety Standards for Cosmetics",
        "  USA      : MoCRA (Modernization of Cosmetics Regulation Act) applicable",
        "  EU       : Regulation (EC) No 1223/2009 Annex compliant",
        "  China    : NMPA registration dossier supported",
        "  GMP      : Manufactured under ISO 22716 certified facility",
        "",
        "SECTION 16. OTHER INFORMATION",
        "  Prepared by   : Quality Assurance Team, Cosmedia Co., Ltd.",
        "  Approved by   : Head of Quality Assurance",
        "  Revision note : Section 9 physical data updated. Section 15 MoCRA added.",
        "  Disclaimer    : This document describes a fictional product for system",
        "                  demonstration purposes only. It must not be used as a real SDS.",
        "",
        "USED IN FINISHED GOODS",
        "  CP-101 Hydra Moisture Cream 50ml",
        "  CP-102 Vita-C Brightening Ampoule 30ml",
        "  CP-203 Cica Soothing Toner 200ml",
        "  CP-204 Collagen Lifting Eye Cream 20ml",
        "  CP-305 UV Sun Cream SPF50+ 50ml",
        "  CP-306 Matte Cushion Foundation 15g",
      ],
    ]);

  msds("Glycerin (vegetable, 99.5%)", "Glycerin", "56-81-5", "MSDS_Glycerin_EN.pdf", [
    "  Appearance          : Clear viscous liquid",
    "  Odour               : Odourless",
    "  pH (10% solution)   : 5.0 - 7.0",
    "  Boiling point       : 290 C",
    "  Flash point         : 160 C (closed cup)",
    "  Relative density    : 1.258 - 1.263 at 20 C",
    "  Solubility in water : Miscible",
    "  Viscosity           : 1410 mPa.s at 20 C",
  ]);
  msds("Phenoxyethanol (preservative grade)", "Phenoxyethanol", "122-99-6", "MSDS_Phenoxyethanol_EN.pdf", [
    "  Appearance          : Colourless oily liquid",
    "  Odour               : Faint rose-like",
    "  pH (1% solution)    : 5.5 - 7.0",
    "  Boiling point       : 245 C",
    "  Flash point         : 121 C (closed cup)",
    "  Relative density    : 1.105 - 1.110 at 20 C",
    "  Solubility in water : 2.7 g / 100 ml at 20 C",
    "  Max use level       : 1.0 % (EU Annex V / Korea safety standard)",
  ]);

  // 3-4. Certificate of Analysis
  const coa = (file: string, mat: string, inci: string, lot: string, rows: [string, string, string][], usedIn: string) =>
    writePdf(file, [
      [
        ...hdr("CERTIFICATE OF ANALYSIS", `Raw material: ${mat}`),
        `  INCI name        : ${inci}`,
        `  Lot number       : ${lot}`,
        "  Manufacturer     : Nova Ingredients (fictional supplier)",
        "  Manufacture date : 2025-02-10",
        "  Expiry date      : 2027-02-09",
        "  Quantity         : 200 kg (8 drums x 25 kg)",
        "  Storage          : 2 - 25 C, protect from light",
        "",
        "TEST RESULTS",
        "  ITEM                              SPECIFICATION            RESULT",
        "  " + "-".repeat(82),
        ...rows.map(([a, b, c]) => `  ${a.padEnd(34)}${b.padEnd(25)}${c}`),
        "  " + "-".repeat(82),
        "",
        "  Overall judgement : PASS",
        "",
        "MICROBIOLOGICAL DATA",
        "  Total aerobic microbial count     <= 100 CFU/g            < 10 CFU/g",
        "  Yeast and mould                   <= 50 CFU/g             < 10 CFU/g",
        "  Escherichia coli                  Absent / 1 g            Absent",
        "  Pseudomonas aeruginosa            Absent / 1 g            Absent",
        "  Staphylococcus aureus             Absent / 1 g            Absent",
        "",
        "HEAVY METALS",
        "  Lead                              <= 10 ppm               < 1 ppm",
        "  Arsenic                           <= 2 ppm                < 0.5 ppm",
        "  Mercury                           <= 1 ppm                < 0.1 ppm",
        "  Cadmium                           <= 1 ppm                < 0.1 ppm",
      ],
      [
        ...hdr("CERTIFICATE OF ANALYSIS - continued", `Lot ${lot}  Page 2 of 2`),
        "REGULATORY STATEMENTS",
        "  BSE / TSE free              : Yes, no animal derived raw material used",
        "  GMO                         : Not derived from genetically modified organisms",
        "  Allergen (EU 26 substances) : Not present above declarable level",
        "  Ethylene oxide / 1,4-dioxane: Not detected (LOQ 1 ppm)",
        "  Nitrosamine                 : Not detected",
        "  REACH                       : Registered",
        "  ISO 22716 GMP               : Manufactured under certified GMP system",
        "",
        "USE IN FINISHED GOODS",
        `  ${usedIn}`,
        "",
        "RELEASE",
        "  Tested by   : QC Laboratory, Nova Ingredients",
        "  Approved by : QC Manager",
        "  Issue date  : 2025-02-12",
        "",
        "  This certificate refers to the lot identified above only.",
        "  Fictional document generated for ontology workbench demonstration.",
      ],
    ]);

  coa("COA_Niacinamide_LOT_NIA25021.pdf", "Niacinamide USP", "Niacinamide", "NIA-25021", [
    ["Appearance", "White crystalline powder", "Conforms"],
    ["Identification (IR)", "Conforms to reference", "Conforms"],
    ["Assay (HPLC)", "99.0 - 101.0 %", "99.7 %"],
    ["Melting point", "128 - 131 C", "129.4 C"],
    ["pH (5% solution)", "6.0 - 7.5", "6.8"],
    ["Loss on drying", "<= 0.5 %", "0.11 %"],
    ["Residue on ignition", "<= 0.1 %", "0.02 %"],
    ["Nicotinic acid", "<= 0.05 %", "0.007 %"],
    ["Related substances", "<= 0.5 %", "0.09 %"],
    ["Water content (KF)", "<= 0.5 %", "0.13 %"],
  ], "CP-101 Hydra Moisture Cream 50ml / CP-102 Vita-C Brightening Ampoule 30ml");

  coa("COA_CeramideNP_LOT_CER25034.pdf", "Ceramide NP", "Ceramide NP", "CER-25034", [
    ["Appearance", "White to off-white powder", "Conforms"],
    ["Identification (HPLC)", "Conforms to reference", "Conforms"],
    ["Assay (HPLC)", ">= 96.0 %", "97.8 %"],
    ["Melting range", "98 - 108 C", "103 C"],
    ["Loss on drying", "<= 2.0 %", "0.62 %"],
    ["Residual solvent (MeOH)", "<= 300 ppm", "42 ppm"],
    ["Acid value", "<= 2.0 mg KOH/g", "0.4"],
    ["Colour (Gardner)", "<= 3", "1"],
    ["Particle size D50", "<= 50 um", "31 um"],
    ["Sulphated ash", "<= 0.2 %", "0.03 %"],
  ], "CP-101 Hydra Moisture Cream 50ml / CP-204 Collagen Lifting Eye Cream 20ml");

  // 5. INCI / EU CPSR summary
  writePdf("CPSR_Summary_CP101_EN.pdf", [
    [
      ...hdr("COSMETIC PRODUCT SAFETY REPORT - SUMMARY", "Part A / Part B  -  Regulation (EC) No 1223/2009"),
      "1. PRODUCT IDENTIFICATION",
      "  Trade name        : CP-101 Hydra Moisture Cream 50ml",
      "  Product code      : CP-101",
      "  Category          : Leave-on face cream (O/W emulsion)",
      "  Responsible person: Cosmedia Co., Ltd. (fictional)",
      "  CPNP reference    : CPNP-0000000 (sample)",
      "  Project           : PJ 2025-CP101",
      "",
      "2. FULL INCI DECLARATION (descending order)",
      "  Water, Glycerin, Squalane, Butylene Glycol, Caprylic/Capric Triglyceride,",
      "  Butyrospermum Parkii (Shea) Butter, Glyceryl Stearate, Niacinamide,",
      "  Cetearyl Alcohol, Dimethicone, 1,2-Hexanediol, Polysorbate 60, Panthenol,",
      "  Ceramide NP, Phenoxyethanol, Carbomer, Allantoin, Sodium Hyaluronate,",
      "  Xanthan Gum, Ethylhexylglycerin, Tocopherol, Fragrance (Parfum),",
      "  Disodium EDTA, Citric Acid",
      "",
      "3. PHYSICOCHEMICAL CHARACTERISTICS",
      "  Appearance        : White opaque cream",
      "  pH                : 5.0 - 6.5 (target 5.8)",
      "  Viscosity         : 8,000 - 25,000 cP (Brookfield RV, sp.C, 12 rpm, 25 C)",
      "  Specific gravity  : 0.95 - 1.05",
      "  Fill weight       : 50 g +/- 3 %",
      "",
      "4. MICROBIOLOGICAL QUALITY",
      "  Total aerobic count : <= 1,000 CFU/g   (typical result < 100 CFU/g)",
      "  Specified organisms : Absent (E. coli, P. aeruginosa, S. aureus, C. albicans)",
      "  Challenge test      : ISO 11930 criteria A satisfied",
      "",
      "5. STABILITY AND PACKAGING COMPATIBILITY",
      "  Accelerated 45 C RH75%  : 3 months, conforming",
      "  Long term 25 C RH60%    : 12 months ongoing, conforming at 6 months",
      "  Freeze-thaw cycle       : 6 cycles, conforming",
      "  Packaging               : PETG jar, PP inner cap, ABS outer cap",
    ],
    [
      ...hdr("COSMETIC PRODUCT SAFETY REPORT - SUMMARY", "Page 2 of 2  -  CP-101"),
      "6. IMPURITIES AND TRACES",
      "  Heavy metals within Korean and EU limits. No prohibited substances of",
      "  Annex II present. 1,4-Dioxane not detected. Nitrosamines not detected.",
      "",
      "7. TOXICOLOGICAL PROFILE OF SUBSTANCES",
      "  Each ingredient is supported by supplier toxicological dossiers and",
      "  published SCCS opinions. No substance exceeds its restricted maximum",
      "  concentration listed in Annex III to VI.",
      "",
      "8. EXPOSURE ASSESSMENT",
      "  Daily applied amount : 1.54 g/day (SCCS default for face cream)",
      "  Retention factor     : 1.0",
      "  Body weight          : 60 kg",
      "  Margin of Safety     : > 100 for all substances evaluated",
      "",
      "9. UNDESIRABLE EFFECTS",
      "  Field complaints recorded in 2025 for this product concern phase separation,",
      "  viscosity decrease and total aerobic count excursion. Root causes were",
      "  identified as emulsifier content shortage, agitation speed deviation and",
      "  environmental microbial contamination. Corrective actions have been applied.",
      "",
      "10. CONCLUSION OF THE SAFETY ASSESSMENT",
      "  The product is considered safe for human health when used under normal",
      "  and reasonably foreseeable conditions of use.",
      "",
      "  Safety assessor : Dr. J. Han, Eur. Reg. Toxicologist (fictional)",
      "  Date            : 2025-06-30",
      "",
      "  Fictional document generated for ontology workbench demonstration.",
    ],
  ]);

  // 6. Supplier spec sheet
  writePdf("SupplierSpec_SodiumHyaluronate_EN.pdf", [
    [
      ...hdr("SUPPLIER SPECIFICATION SHEET", "Sodium Hyaluronate HMW 1.0-1.5 MDa"),
      "  Supplier          : Nova Ingredients (fictional)",
      "  Trade name        : NovaHA-HM 1200",
      "  INCI name         : Sodium Hyaluronate",
      "  CAS number        : 9067-32-7",
      "  EINECS            : 232-678-0",
      "  Appearance        : White to slightly yellowish powder or granule",
      "  Source            : Bacterial fermentation (Streptococcus zooepidemicus)",
      "  Document version  : SPEC-HA-1200 rev.4  (2025-01-20)",
      "",
      "SPECIFICATION",
      "  ITEM                              SPECIFICATION            METHOD",
      "  " + "-".repeat(82),
      "  Assay (dry basis)                 91.0 - 102.0 %           HPLC",
      "  Molecular weight                  1.0 - 1.5 MDa            SEC-MALS",
      "  pH (0.1% solution)                6.0 - 8.0                Potentiometry",
      "  Loss on drying                    <= 10.0 %                Gravimetric",
      "  Protein content                   <= 0.1 %                 Lowry",
      "  Heavy metals                      <= 20 ppm                ICP-MS",
      "  Lead                              <= 5 ppm                 ICP-MS",
      "  Total aerobic count               <= 100 CFU/g             ISO 21149",
      "  Yeast and mould                   <= 50 CFU/g              ISO 16212",
      "  Endotoxin                         <= 0.5 EU/mg             LAL",
      "  " + "-".repeat(82),
      "",
      "TYPICAL USE",
      "  Recommended level : 0.05 - 0.30 % in aqueous phase",
      "  Dispersion        : Sprinkle into water under moderate agitation, hydrate",
      "                      for at least 30 minutes before adding electrolytes.",
      "  Incompatibility   : High electrolyte concentration reduces viscosity.",
      "  Note              : Insufficient hydration time has been associated with",
      "                      graininess and viscosity deviation in finished goods.",
    ],
    [
      ...hdr("SUPPLIER SPECIFICATION SHEET - continued", "Page 2 of 2"),
      "PACKAGING AND STORAGE",
      "  Packaging   : 1 kg aluminium foil bag in fibre drum, nitrogen flushed",
      "  Storage     : Below 25 C, relative humidity below 60 %, protect from light",
      "  Shelf life  : 36 months from date of manufacture in unopened package",
      "  Re-test     : 12 months after first opening",
      "",
      "REGULATORY",
      "  Korea Cosmetics Act                : Compliant",
      "  Regulation (EC) No 1223/2009       : Compliant, not restricted",
      "  MoCRA (USA)                        : Supported by supplier dossier",
      "  China NMPA IECIC                   : Listed",
      "  ISO 22716 GMP                      : Certified manufacturing site",
      "",
      "USE IN FINISHED GOODS",
      "  CP-101 Hydra Moisture Cream 50ml       0.15 %",
      "  CP-102 Vita-C Brightening Ampoule 30ml 0.20 %",
      "  CP-203 Cica Soothing Toner 200ml       0.10 %",
      "  CP-204 Collagen Lifting Eye Cream 20ml 0.10 %",
      "",
      "  Fictional document generated for ontology workbench demonstration.",
    ],
  ]);
}

/* ══════════ 실행 ══════════ */
async function main() {
  console.log("gen-cosmetics → docs/화장품");
  buildFormulas();
  buildPkgBom();
  buildIngredientMaster();
  buildQc();
  buildMicro();
  buildStability();
  buildClaims();
  buildPdfs();
  for (const d of DECKS) await buildDeck(d);
  await buildDevReviewDeck("신제품개발리뷰_CP305_선크림.pptx", P("CP-305"), "RD-2025-05", [
    ["점증제 수화 불충분", "수상 수화 시간 30분 이상 확보"],
    ["용기 상용성 불량", "펌프 용기 6개월 상용성 시험 선행"],
    ["충전 온도 이탈", "충전 온도 32도 이하 인터록 적용"],
  ]);
  await buildDevReviewDeck("신제품개발리뷰_CP306_쿠션.pptx", P("CP-306"), "RD-2025-06", [
    ["충전 온도 이탈", "충전 라인 온도 자동 기록 도입"],
    ["원료 로트 편차", "색소 로트별 색차 dE 사전 검증"],
    ["용기 상용성 불량", "쿠션 퍼프 흡수량 규격화"],
  ]);
  await buildMonthlyReview();
  await Promise.all([...buildIssueReports(), ...buildDeviationReports(), ...buildCapa(), buildConsumerInvestigation()]);

  const files = fs.readdirSync(OUT).filter((f) => fs.statSync(path.join(OUT, f)).isFile());
  const total = files.reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`완료: ${files.length} files · ${(total / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
