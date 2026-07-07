// lib/ingest/robust.test.ts — 실무(비정형) FMEA xlsx 휴리스틱 검증.
// `node --test --experimental-strip-types`. 임시 디렉터리에 타이틀블록 + 2행 병합헤더 +
// 세로 병합 부품셀 + 비고행 을 가진 워크북을 만들고 ingestAll(dir) 결과를 단언한다.
import test from "node:test";
import assert from "node:assert/strict";
import { register, createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

const HOOK = `
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const { ingestAll } = await import("./index.ts");
type Edge = import("../types.ts").Edge;

// 임시 워크북 작성: 타이틀블록·2행 병합헤더·세로 병합 부품셀·비고행·대체헤더 시트.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slonto-robust-"));
const B = "";
const R = (sr: number, sc: number, er: number, ec: number) => ({ s: { r: sr, c: sc }, e: { r: er, c: ec } });

const g1: string[][] = [
  ["설계 FMEA 검토서", B, B, B, B, B, B], // 타이틀
  ["문서번호: X-1", B, "차종: PJ 2019-HL07", B, B, B, B], // 문서정보
  [B, B, B, B, B, B, B], // 공백
  ["항목/기능", "잠재적 고장모드", "심각도(S)", "잠재적 고장원인/메커니즘", "발생도(O)", "검출도(D)", "권고 조치사항"], // 헤더상단
  [B, B, B, B, B, B, B], // 헤더하단(2행 병합 시연 — 세로병합으로 채워짐)
  ["헤드램프 어셈블리", "결로·습기", "7", "벤트·씰링 설계", "5", "4", "벤트 경로 개선"],
  [B, "간극 벌어짐", "6", "조립 공차 누적", "4", "5", "금형 치수 수정"],
  ["비고: 정기 검토분", B, B, B, B, B, B], // 비고행(고장모드 없음 → 스킵)
];
const ws1 = XLSX.utils.aoa_to_sheet(g1);
ws1["!merges"] = [
  R(0, 0, 0, 6),
  R(3, 0, 4, 0), R(3, 1, 4, 1), R(3, 2, 4, 2), R(3, 3, 4, 3), R(3, 4, 4, 4), R(3, 5, 4, 5), R(3, 6, 4, 6),
  R(5, 0, 6, 0), // 부품셀 세로병합(헤드램프 ×2)
];

// 대체 컬럼명 시트(동의어): 품명/Failure Mode/발생원인/개선대책
const g2: string[][] = [
  ["품명", "Failure Mode", "발생원인", "개선대책"],
  ["LED 모듈", "LED 조기 사멸", "방열 설계 미흡", "방열 리브 추가"],
];
const ws2 = XLSX.utils.aoa_to_sheet(g2);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws1, "DFMEA");
XLSX.utils.book_append_sheet(wb, ws2, "불량이력");
XLSX.writeFile(wb, path.join(dir, "설계FMEA_테스트_실무.xlsx"));

const result = ingestAll(dir);
const edges: Edge[] = result.edges;
const has = (src: string, rel: string, dst: string) => edges.some((e) => e.src === src && e.rel === rel && e.dst === dst);
const outCount = (src: string, rel: string) => edges.filter((e) => e.src === src && e.rel === rel).length;

test("세로 병합된 부품셀이 아래 행으로 전파되어 한 부품이 여러 고장모드를 가진다", () => {
  assert.ok(has("IHL", "HAS_FAILURE", "FMFOG"), "헤드램프→결로 누락");
  assert.ok(has("IHL", "HAS_FAILURE", "FMGAP"), "헤드램프→간극(병합 전파) 누락");
  assert.equal(outCount("IHL", "HAS_FAILURE"), 2, "병합 부품셀이 정확히 2개 고장모드로 연결");
});

test("2행 병합헤더 하위 동의어 컬럼 매핑으로 원인·조치가 연결된다", () => {
  assert.ok(has("FMFOG", "CAUSED_BY", "CVENT"), "결로→벤트씰링 원인 누락");
  assert.ok(has("FMFOG", "MITIGATED_BY", "AVENT"), "결로→벤트경로 조치 누락");
});

test("비고/공백 행은 데이터로 오인되지 않는다", () => {
  const bogus = result.nodes.find((n) => n.label.startsWith("비고"));
  assert.equal(bogus, undefined, "비고 행이 노드로 생성됨");
});

test("대체 컬럼명(품명/Failure Mode/발생원인/개선대책) 시트도 매핑된다", () => {
  assert.ok(has("ILED", "HAS_FAILURE", edges.find((e) => e.src === "ILED" && e.rel === "HAS_FAILURE")?.dst ?? ""), "LED모듈 고장모드 누락");
  assert.ok(edges.some((e) => e.rel === "CAUSED_BY" && e.dst === "CTHERM"), "방열 설계 미흡(CTHERM) 원인 누락");
  assert.ok(edges.some((e) => e.rel === "MITIGATED_BY" && e.dst === "ARIB"), "방열 리브 추가(ARIB) 조치 누락");
});

test("S/O/D 속성이 고장모드·원인 노드에 부착된다", () => {
  const fmfog = result.nodes.find((n) => n.id === "FMFOG");
  assert.ok(fmfog?.props?.some(([k]) => k === "심각도 S"), "심각도 S prop 누락");
  const cvent = result.nodes.find((n) => n.id === "CVENT");
  assert.ok(cvent?.props?.some(([k]) => k === "발생도 O"), "발생도 O prop 누락");
});

test("cleanup temp dir", () => {
  fs.rmSync(dir, { recursive: true, force: true });
});
