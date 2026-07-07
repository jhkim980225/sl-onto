// lib/ingest/dxf.test.ts — DXF 파서 라운드트립 (`node --test --experimental-strip-types`).
// gen-sources 가 생성한 도면 → 제목블록/NOTE 형상 특징/BOM 이 정확히 복원되는지 검증.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import * as path from "node:path";

const HOOK = `
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const rel = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\\.[cm]?[jt]s$/.test(specifier);
    if (rel && !hasExt) return next(specifier + ".ts", context);
    throw err;
  }
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const { readDxfEntities, parseDrawing, dxfToSvg } = await import("./dxf.ts");
const { ingestAll } = await import("./index.ts");

const ASM = path.join(process.cwd(), "data", "sources", "도면_신규_헤드램프_HL22.dxf");

test("제목블록 라벨(부품명·프로젝트·차종·소재·도번)이 복원된다", () => {
  const d = parseDrawing(readDxfEntities(ASM));
  assert.equal(d.labels["부품명"], "헤드램프 어셈블리");
  assert.equal(d.labels["프로젝트"], "PJ 2027-HL22");
  assert.ok(d.labels["차종"]?.includes("SUV A"), `차종: ${d.labels["차종"]}`);
  assert.ok(d.labels["소재"]?.includes("PC"), `소재: ${d.labels["소재"]}`);
  assert.equal(d.labels["도번"], "DWG-HL22-A01");
});

test("NOTE 형상 특징(벤트·실링·개스킷·커넥터·렌즈·하우징)이 복원된다", () => {
  const d = parseDrawing(readDxfEntities(ASM));
  assert.ok(d.features["벤트 홀"]?.startsWith("2"), `벤트 홀: ${d.features["벤트 홀"]}`);
  assert.equal(d.features["실링"], "이중 개스킷");
  assert.equal(d.features["개스킷 소재"], "EPDM");
  assert.equal(d.features["커넥터"], "IP67");
  assert.equal(d.features["렌즈"], "곡면");
  assert.ok(d.features["하우징"]?.includes("밀폐형"), `하우징: ${d.features["하우징"]}`);
});

test("BOM 표 5행이 품번·품명·수량·재질로 복원된다", () => {
  const d = parseDrawing(readDxfEntities(ASM));
  assert.equal(d.bom.length, 5, `BOM 행 수: ${d.bom.length}`);
  const lens = d.bom.find((b) => b.name === "아우터 렌즈");
  assert.ok(lens, "BOM 에 아우터 렌즈가 없음");
  assert.equal(lens!.material, "PC");
  const vent = d.bom.find((b) => b.name === "방수벤트");
  assert.equal(vent?.qty, "2");
});

test("SVG 렌더가 도면 텍스트·형상을 포함한다 (미리보기)", () => {
  const svg = dxfToSvg(readDxfEntities(ASM));
  assert.ok(svg.startsWith("<svg"), "svg 루트 없음");
  assert.ok(svg.includes("헤드램프 어셈블리"), "제목 텍스트 누락");
  assert.ok(svg.includes("<path") && svg.includes("<circle"), "렌즈 아크/벤트 형상 누락");
});

test("ingestAll 이 도면을 원천으로 적재하고 구성(CONSISTS_OF)·형상 props 를 만든다", () => {
  const r = ingestAll();
  const src = r.sources.find((s) => s.file === "도면_신규_헤드램프_HL22.dxf");
  assert.ok(src, "도면이 원천 목록에 없음");
  assert.equal(src!.type, "DXF");
  assert.ok(src!.extracted.objects >= 5, `추출 객체 ${src!.extracted.objects}`);
  // 도면 프로젝트 노드에 형상 특징 props
  const proj = r.nodes.find((n) => n.type === "proj" && n.label === "PJ 2027-HL22");
  assert.ok(proj, "도면 프로젝트 노드 없음");
  assert.ok(proj!.props?.some(([k]) => k.startsWith("형상.")), "형상.* props 없음");
  // BOM → 헤드램프 어셈블리(IHL) 구성 엣지
  const consists = r.edges.filter((e) => e.src === "IHL" && e.rel === "CONSISTS_OF");
  assert.ok(consists.length >= 4, `IHL CONSISTS_OF ${consists.length}개`);
});
