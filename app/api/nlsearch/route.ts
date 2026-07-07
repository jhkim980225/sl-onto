import { NextResponse } from "next/server";
import { z } from "zod";
import { nlSearch } from "@/lib/nlsearch";
import { ready } from "@/lib/store";

const Body = z.object({ query: z.string().min(1).max(400) });

// POST /api/nlsearch  { query }  → 자연어 검색(LLM 해석 + 온톨로지 조회)
export async function POST(req: Request) {
  await ready();
  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const result = await nlSearch(parsed.query);
  return NextResponse.json(result);
}
