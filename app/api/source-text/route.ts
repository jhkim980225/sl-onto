// GET /api/source-text?file=<name> — 원천 파일의 전체 원문을 블록 텍스트로 반환.
//   디스크(data/sources) 우선, 없으면 DB(sources.content). 둘 다 없으면 404.
//   xlsx/pptx/docx → extractSourceBlocks. pdf → pyservice(/parse). dxf → 415(도면 이미지 뷰).
// 응답: { file, format, blocks: { label, lines: string[] }[] }. 어떤 입력에도 서버 안 죽음.
import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import { getSourceContent } from "@/lib/db";
import { extractSourceBlocks } from "@/lib/source-text";
import { parseDocument, parseEnabled } from "@/lib/parse";
import { ready } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

export const runtime = "nodejs";

const MAX_LINES = 2000;
const bad = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    try {
      const raw = new URL(req.url).searchParams.get("file");
      if (!raw) return bad(400, "file 파라미터가 필요합니다");
      const file = path.basename(raw).normalize("NFC"); // 경로 탈출 방지 — data/sources 밖 접근 금지

      // 바이트 확보: 디스크(베이스라인) 우선, 없으면 DB 업로드 원본.
      const diskPath = path.join(process.cwd(), "data", "sources", file);
      let buf: Buffer | null = fs.existsSync(diskPath) ? fs.readFileSync(diskPath) : null;
      if (!buf) buf = await getSourceContent(file);
      if (!buf) return bad(404, "파일을 찾을 수 없습니다");

      const ext = path.extname(file).toLowerCase();

      if (ext === ".dxf") {
        return bad(415, "도면은 원문 텍스트가 없습니다 — 도면 미리보기를 사용하세요");
      }

      if (ext === ".pdf") {
        if (!parseEnabled()) return bad(503, "PDF 원문은 pyservice(/parse)가 필요합니다 — PYSERVICE_URL 미설정");
        const parsed = await parseDocument(file, buf);
        if (!parsed) return bad(422, "PDF 파싱 실패 — pyservice(/parse) 미가용이거나 추출 오류");
        const lines = [
          ...parsed.text.split(/\r?\n/),
          ...parsed.tables.flatMap((t) => t.map((row) => row.join(" │ "))),
        ].filter((l) => l.trim() !== "");
        if (lines.length === 0) return bad(422, "PDF 에서 텍스트를 추출하지 못했습니다");
        const capped =
          lines.length > MAX_LINES
            ? [...lines.slice(0, MAX_LINES), `… (이하 생략, 총 ${lines.length}행)`]
            : lines;
        return NextResponse.json({ file, format: "pdf", blocks: [{ label: "본문", lines: capped }] });
      }

      const { format, blocks } = extractSourceBlocks(file, buf);
      return NextResponse.json({ file, format, blocks });
    } catch (err) {
      console.error("GET /api/source-text failed:", err);
      return bad(422, `원문 추출 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
