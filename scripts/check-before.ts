// scripts/check-before.ts — 업그레이드 "이전" 파서(정형 전용)를 실무 샘플에 적용해 실패를 정량화.
// 실행: node --experimental-strip-types scripts/check-before.ts
// 기존 index.ts 의 정형 규칙만 그대로 재현한다(휴리스틱/자유텍스트 폴백 없음).
import { register } from "node:module";
import { fileURLToPath } from "node:url";
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

const { readWorkbook } = await import("../lib/ingest/xlsx.ts");
const { readDeck } = await import("../lib/ingest/pptx.ts");
const { readDoc } = await import("../lib/ingest/docx.ts");
const { normalize, resolveOrCreate } = await import("../lib/ingest/normalize.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.join(__dirname, "..", "data", "real-samples");
const EMPTY = (s: string) => !s || s === "-";

function oldParse(file: string, full: string): { objects: Set<string>; relations: number } {
  const objects = new Set<string>();
  let relations = 0;
  const res = (raw: string, type?: string): string | null => {
    if (EMPTY(raw)) return null;
    const r = type ? resolveOrCreate(raw, type as never) : normalize(raw);
    if (!r.id) return null;
    objects.add(r.id);
    return r.id;
  };
  const link = (a: string | null, b: string | null) => { if (a && b) relations++; };
  const ext = (file.split(".").pop() ?? "").toUpperCase();
  try {
    if (ext === "XLSX") {
      // 이전 파서: 파일명 접두어로만 분기. "설계FMEA…" 는 어떤 분기에도 안 걸림 → 아무것도 안 함.
      if (file.startsWith("FMEA")) {
        const { sheets } = readWorkbook(full);
        const rows = sheets.find((s) => s.name === "FMEA")?.rows ?? sheets[0]?.rows ?? [];
        for (const r of rows) {
          const item = res(r["부품"], "item"); const fm = res(r["고장모드"], "fm");
          const cause = res(r["원인"], "cause"); const action = res(r["현행조치"], "action");
          const proj = res(r["발생프로젝트"], "proj");
          link(item, fm); link(fm, cause); link(fm, action); link(proj, fm);
        }
      }
      // (법규기준/설계표준/고객사/유사도매트릭스 접두어도 실무 파일엔 해당 없음)
    } else if (ext === "PPTX") {
      const { slides } = readDeck(full);
      const all = slides.flatMap((s) => s.lines);
      const after = (p: string) => { const l = all.find((x) => x.startsWith(p)); return l ? l.slice(p.length).trim() : ""; };
      const sec = (h: string) => { const s = slides.find((sl) => sl.lines[0] === h); return s ? s.lines.slice(1) : []; };
      const proj = res(after("프로젝트:"), "proj"); const fm = res(after("이슈:"), "fm");
      const item = res(after("부품:"), "item");
      const causes = sec("원인분석").map((c) => res(c, "cause"));
      const action = res(sec("대책")[0] ?? "", "action");
      link(item, fm); for (const c of causes) link(fm, c); link(fm, action); void proj;
    } else if (ext === "DOCX") {
      const { paragraphs } = readDoc(full);
      const field: Record<string, string> = {};
      for (const p of paragraphs) { const m = p.match(/^([^:：]+)[:：]\s*(.*)$/); if (m) field[m[1].trim()] = m[2].trim(); }
      const item = res(field["부품"] ?? "", "item"); const fm = res(field["고장모드"] ?? "", "fm");
      const cause = res(field["원인"] ?? "", "cause"); const action = res(field["조치"] ?? "", "action");
      res(field["프로젝트"] ?? "", "proj");
      if (item && fm) link(item, fm); if (fm && cause) link(fm, cause);
      if (action) link(fm ?? cause, action);
    }
  } catch (e) { console.error("  (parse error)", file, e); }
  return { objects, relations };
}

console.log("=== BEFORE (정형 전용 파서) · data/real-samples ===");
const files = fs.readdirSync(REAL).filter((f) => /\.(xlsx|pptx|docx)$/i.test(f) && !f.startsWith("~$")).sort();
let totObj = 0, totRel = 0;
for (const f of files) {
  const { objects, relations } = oldParse(f, path.join(REAL, f));
  totObj += objects.size; totRel += relations;
  console.log(`  · ${f} → 객체 ${objects.size}, 관계 ${relations}`);
}
console.log(`합계: 객체 ${totObj}, 관계 ${totRel}`);
