import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/search";
import { ready } from "@/lib/store";

// GET /api/search?q=
export async function GET(req: NextRequest) {
  await ready();
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json(search(q));
}
