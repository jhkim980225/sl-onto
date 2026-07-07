// GET /api/drawing-svg?file=<도면.dxf> — data/sources 의 DXF 를 SVG 로 렌더해 반환(웹 미리보기).
// 파일명은 경로 구분자 없는 .dxf 만 허용(디렉터리 탈출 방지), 존재하지 않으면 404.
import * as fs from "node:fs";
import * as path from "node:path";
import { parseDxfEntities, dxfToSvg } from "@/lib/ingest/dxf";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const file = url.searchParams.get("file") ?? "";
  if (!/^[^\\/]+\.dxf$/i.test(file)) {
    return Response.json({ error: "file 파라미터는 .dxf 파일명이어야 합니다" }, { status: 400 });
  }
  const full = path.join(process.cwd(), "data", "sources", file);
  let content: string;
  try {
    content = fs.readFileSync(full, "utf8");
  } catch {
    return Response.json({ error: "도면을 찾을 수 없습니다" }, { status: 404 });
  }
  const svg = dxfToSvg(parseDxfEntities(content));
  return new Response(svg, {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}
