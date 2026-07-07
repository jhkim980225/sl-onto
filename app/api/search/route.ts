import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/search";

// GET /api/search?q=
export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json(search(q));
}
