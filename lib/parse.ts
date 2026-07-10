// lib/parse.ts — Python 사이드카(/parse) 태스크 래퍼. 업로드 PDF → 텍스트/표 추출.
// 골든 룰: pyservice 가 죽어도 절대 throw 하지 않는다 — 실패는 null, 호출부(route)가 해당 파일만 실패 처리.
// 전송·타임아웃·조용한 실패는 lib/pyservice.ts 공용 클라이언트가 담당.
import { pyEnabled, pyPost } from "./pyservice";

const PARSE_TIMEOUT_MS = Number(process.env.PARSE_TIMEOUT_MS || 60000); // docling OCR 대비 넉넉히

export interface ParsedDocument {
  text: string;
  tables: string[][][]; // [표][행][셀]
  pages: number;
  engine: string; // "docling" | "pypdf"
}

export function parseEnabled(): boolean {
  return pyEnabled();
}

/** PDF 버퍼 → 추출 결과. 비활성·미가용·추출실패면 null. */
export async function parseDocument(filename: string, buf: Buffer): Promise<ParsedDocument | null> {
  const data = await pyPost<{ ok?: boolean; error?: string; text?: string; tables?: string[][][]; pages?: number; engine?: string }>(
    "/parse", { filename, content_base64: buf.toString("base64") }, PARSE_TIMEOUT_MS, `parse ${filename}`);
  if (!data) return null;
  if (!data.ok) {
    console.warn(`[parse] pyservice error (${filename}): ${data.error ?? "unknown"}`);
    return null;
  }
  return {
    text: String(data.text ?? ""),
    tables: Array.isArray(data.tables) ? data.tables : [],
    pages: Number(data.pages ?? 0),
    engine: String(data.engine ?? ""),
  };
}
