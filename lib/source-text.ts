// lib/source-text.ts — 원천 파일(xlsx/pptx/docx)의 전체 원문을 블록 텍스트로 추출.
// 프레임워크 비의존. 버퍼를 임시파일로 내려 파일경로 기반 파서(xlsx/pptx/docx)를 태운다.
// pdf 는 async pyservice(/parse) 라 여기서 다루지 않는다 — 라우트가 별도 처리.
import * as path from "node:path";
import { readWorkbookGrids } from "./ingest/xlsx";
import { readDeck } from "./ingest/pptx";
import { readDoc } from "./ingest/docx";
import { withTempFile } from "./ingest/tempfile";

export interface SourceBlock {
  label: string;
  lines: string[];
}
export interface SourceText {
  format: string;
  blocks: SourceBlock[];
}

const MAX_LINES = 2000; // 폭주 방지 — 전체 라인 합계 상한

// 블록들의 전체 라인 수가 상한을 넘으면 잘라내고 마지막 블록에 생략 표기를 붙인다.
function capLines(blocks: SourceBlock[]): SourceBlock[] {
  const total = blocks.reduce((n, b) => n + b.lines.length, 0);
  if (total <= MAX_LINES) return blocks;
  const out: SourceBlock[] = [];
  let budget = MAX_LINES;
  for (const b of blocks) {
    if (budget <= 0) break;
    if (b.lines.length <= budget) {
      out.push(b);
      budget -= b.lines.length;
    } else {
      out.push({ label: b.label, lines: b.lines.slice(0, budget) });
      budget = 0;
    }
  }
  const last = out[out.length - 1];
  if (last) last.lines = [...last.lines, `… (이하 생략, 총 ${total}행)`];
  return out;
}

/** 확장자별 전체 원문 블록 추출. pdf/dxf/미지원은 빈 blocks(라우트가 상태코드 처리). */
export function extractSourceBlocks(fileName: string, buf: Buffer): SourceText {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".xlsx") {
    const { sheets } = withTempFile(fileName, buf, (tmp) => readWorkbookGrids(tmp));
    const blocks = sheets.map((s) => ({
      label: s.name,
      // 각 행을 " │ " 로 조인. 전부 빈 셀인 행은 제외.
      lines: s.grid
        .filter((row) => row.some((c) => c.trim() !== ""))
        .map((row) => row.join(" │ ")),
    }));
    return { format: "xlsx", blocks: capLines(blocks) };
  }
  if (ext === ".pptx") {
    const { slides } = withTempFile(fileName, buf, (tmp) => readDeck(tmp));
    const blocks = slides.map((s) => ({ label: `슬라이드 ${s.index}`, lines: s.lines }));
    return { format: "pptx", blocks: capLines(blocks) };
  }
  if (ext === ".docx") {
    const { paragraphs } = withTempFile(fileName, buf, (tmp) => readDoc(tmp));
    return { format: "docx", blocks: capLines([{ label: "본문", lines: paragraphs }]) };
  }
  if (ext === ".dxf") return { format: "dxf", blocks: [] }; // 도면은 프론트 이미지 뷰
  return { format: ext.replace(/^\./, "") || "unknown", blocks: [] };
}
