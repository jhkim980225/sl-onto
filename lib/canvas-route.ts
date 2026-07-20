// lib/canvas-route.ts — 모든 데이터 라우트의 공통 진입점.
// ?canvas 를 파싱·검증하고 그 아래 전부를 캔버스 컨텍스트 안에서 실행한다.
// 누락 라우트는 grep -L withCanvasRoute app/api/**/route.ts 로 찾는다.
import { withCanvas } from "./canvas-context";
import { canvasExists } from "./canvases";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function withCanvasRoute(
  req: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  const id = new URL(req.url).searchParams.get("canvas");
  // 기본 캔버스로 조용히 폴백하지 않는다 — 다른 부서 데이터를 잘못 보여줄 수 있다(설계 §8).
  if (!id) return json({ error: "canvas 파라미터가 필요합니다" }, 400);
  if (!(await canvasExists(id))) return json({ error: "존재하지 않는 캔버스입니다", canvas: id }, 404);
  return withCanvas(id, handler);
}
