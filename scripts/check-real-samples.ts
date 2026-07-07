// scripts/check-real-samples.ts — 실무 샘플(data/real-samples)에 대한 추출 리포트.
// 실행: node --experimental-strip-types scripts/check-real-samples.ts
// 파일별 추출 객체/관계 수, 핵심 스팟체크(병합 부품셀·대체헤더·산문 링크),
// 그리고 데모 데이터(data/sources) 총계를 함께 출력한다.
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

// 확장자 없는 상대 import → ".ts" 보정(테스트 러너와 동일 훅).
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

const { ingestAll } = await import("../lib/ingest/index.ts");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(__dirname, "..", "data", "real-samples");
const DEMO = path.join(__dirname, "..", "data", "sources");

function report(dir: string, title: string) {
  const r = ingestAll(dir);
  console.log(`\n=== ${title} (${dir}) ===`);
  console.log(`총 노드 ${r.nodes.length} · 총 엣지 ${r.edges.length} · 파일 ${r.sources.length}`);
  for (const s of r.sources) {
    console.log(`  · ${s.file} [${s.type}] → 객체 ${s.extracted.objects}, 관계 ${s.extracted.relations}`);
  }
  return r;
}

const real = report(REAL, "REAL-SAMPLES");

// ── 스팟체크: 실무 xlsx/pptx/docx 에서 실제로 무엇을 뽑았는가 ──
const nodeById = new Map(real.nodes.map((n) => [n.id, n]));
const lbl = (id: string) => nodeById.get(id)?.label ?? id;
const out = (src: string, rel: string) =>
  real.edges.filter((e) => e.src === src && e.rel === rel).map((e) => lbl(e.dst));

console.log("\n--- 스팟체크(실무 추출 정확성) ---");
console.log("[병합 부품셀] IHL(헤드램프) HAS_FAILURE →", out("IHL", "HAS_FAILURE").join(", ") || "(없음)");
console.log("[대체 헤더시트] ILED(LED모듈) HAS_FAILURE →", out("ILED", "HAS_FAILURE").join(", ") || "(없음)");
console.log("           ILED 경로 CAUSED_BY(via fm)…", real.edges.filter((e) => e.rel === "CAUSED_BY" && lbl(e.src) === "LED 조기 사멸").map((e) => lbl(e.dst)).join(", ") || "(없음)");
console.log("[산문 pptx] FMFOG(결로) CAUSED_BY →", out("FMFOG", "CAUSED_BY").join(", ") || "(없음)");
console.log("           FMFOG MITIGATED_BY →", out("FMFOG", "MITIGATED_BY").join(", ") || "(없음)");
console.log("[산문 docx] FMSHRINK(수축변형) CAUSED_BY →", out("FMSHRINK", "CAUSED_BY").join(", ") || "(없음)");
console.log("           IHSG(하우징) HAS_FAILURE →", out("IHSG", "HAS_FAILURE").join(", ") || "(없음)");
console.log("           FMSHRINK MITIGATED_BY →", out("FMSHRINK", "MITIGATED_BY").join(", ") || "(없음)");

// 타입별 분포
const byType: Record<string, number> = {};
for (const n of real.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
console.log("\n실무 노드 타입 분포:", JSON.stringify(byType));

// ── 데모 데이터 회귀(총계) ──
const demo = report(DEMO, "DEMO data/sources");
console.log(`\n데모 회귀 기준선: 노드 ${demo.nodes.length}, 엣지 ${demo.edges.length}, 파일 ${demo.sources.length}`);
