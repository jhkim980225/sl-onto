// GET /api/drawing-svg?file=<도면.dxf> — data/sources 의 DXF 를 SVG 로 렌더해 반환(웹 미리보기).
// 파일명은 경로 구분자 없는 .dxf 만 허용(디렉터리 탈출 방지), 존재하지 않으면 404.
import { parseDxfEntities, dxfToSvg } from "@/lib/ingest/dxf";
import { canvasSourceBytes } from "@/lib/source-bytes";
import { ready } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return withCanvasRoute(req, async () => {
    await ready();
    const url = new URL(req.url);
    const file = url.searchParams.get("file") ?? "";
    if (!/^[^\/]+\.dxf$/i.test(file)) {
      return Response.json({ error: "file 파라미터는 .dxf 파일명이어야 합니다" }, { status: 400 });
    }
    // 이 캔버스에 등록된 도면만. 디스크 직독은 타 캔버스 도면을 노출하고,
    // 반대로 업로드된 도면(바이트가 DB 에만 있음)은 못 찾는다. lib/source-bytes.ts 참조.
    const buf = await canvasSourceBytes(file.normalize("NFC"));
    if (!buf) return Response.json({ error: "이 캔버스에 없는 도면입니다" }, { status: 404 });
    const svg = dxfToSvg(parseDxfEntities(buf.toString("utf8")));
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" },
    });
  });
}
