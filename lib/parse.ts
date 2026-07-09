// lib/parse.ts — Python 사이드카(/parse) 클라이언트. 업로드 PDF → 텍스트/표 추출.
// 골든 룰: pyservice 가 죽어도 절대 throw 하지 않는다 — 실패는 null, 호출부(route)가 해당 파일만 실패 처리.
// 패턴은 lib/embed.ts 와 동일(PYSERVICE_URL 게이트, AbortController 타임아웃, 조용한 로그).
const PARSE_TIMEOUT_MS = Number(process.env.PARSE_TIMEOUT_MS || 60000); // docling OCR 대비 넉넉히

export interface ParsedDocument {
  text: string;
  tables: string[][][]; // [표][행][셀]
  pages: number;
  engine: string; // "docling" | "pypdf"
}

export function parseEnabled(): boolean {
  return !!process.env.PYSERVICE_URL;
}

function pysvc(): string {
  return (process.env.PYSERVICE_URL || "").replace(/\/$/, "");
}

/** PDF 버퍼 → 추출 결과. 비활성·미가용·추출실패면 null. */
export async function parseDocument(filename: string, buf: Buffer): Promise<ParsedDocument | null> {
  if (!parseEnabled()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PARSE_TIMEOUT_MS);
  try {
    const res = await fetch(`${pysvc()}/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content_base64: buf.toString("base64") }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[parse] pyservice ${res.status} — ${filename}`);
      return null;
    }
    const data = await res.json();
    if (!data?.ok) {
      console.warn(`[parse] pyservice error (${filename}): ${data?.error ?? "unknown"}`);
      return null;
    }
    return {
      text: String(data.text ?? ""),
      tables: Array.isArray(data.tables) ? (data.tables as string[][][]) : [],
      pages: Number(data.pages ?? 0),
      engine: String(data.engine ?? ""),
    };
  } catch (e) {
    console.warn(`[parse] pyservice unavailable (${filename}): ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
