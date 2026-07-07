import { NextResponse } from "next/server";
import { getObject } from "@/lib/store";

// GET /api/object/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const obj = getObject(id);
  if (!obj) return NextResponse.json({ error: "not found", id }, { status: 404 });
  return NextResponse.json(obj);
}
