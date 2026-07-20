// GET  /api/canvases  — 활성 캔버스 목록(+ 노드·문서 수). ?trash=1 이면 휴지통(삭제된 것만).
// POST /api/canvases  — 생성 { name, description? }. 빈 스키마로 시작(설계 §3.4).
// 캔버스 자체를 다루므로 withCanvasRoute 를 쓰지 않는다 — 이 라우트에는 캔버스 컨텍스트가 없다.
import { NextResponse } from "next/server";
import { z } from "zod";
import * as db from "@/lib/db";
import { listCanvases, createCanvas } from "@/lib/canvases";
import { parseJsonBody } from "@/lib/schemas";

export const runtime = "nodejs";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).optional(),
});

// DATABASE_URL 없는 인메모리 모드에서는 db.ready() 가 연결을 시도하다 실패한다.
// listCanvases 는 그 경우 기본 캔버스만 돌려주므로 부팅을 건너뛴다.
const dbReady = () => (db.dbEnabled() ? db.ready() : Promise.resolve());

export async function GET(req: Request) {
  await dbReady();
  const trash = new URL(req.url).searchParams.get("trash") === "1";
  return NextResponse.json({ canvases: await listCanvases(trash) });
}

export async function POST(req: Request) {
  await dbReady();
  const parsed = await parseJsonBody(req, CreateSchema);
  if (!parsed.ok) return parsed.response;

  const canvas = await createCanvas(parsed.data.name, parsed.data.description ?? null);
  return NextResponse.json({ canvas }, { status: 201 });
}
