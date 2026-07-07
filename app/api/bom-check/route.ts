import { NextResponse } from "next/server";
import { z } from "zod";
import { checkBom } from "@/lib/bom-consistency";
import { getObject, ready } from "@/lib/store";

// GET /api/bom-check?item=<id> — 그 부품의 BOM(CONSISTS_OF) 정합성 검사 결과
const QuerySchema = z.object({ item: z.string().min(1) });

export async function GET(req: Request) {
  await ready();
  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({ item: searchParams.get("item") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { item } = parsed.data;
  const obj = getObject(item);
  if (!obj) return NextResponse.json({ error: "not found", item }, { status: 404 });

  const findings = checkBom(item);
  return NextResponse.json({ findings, item: obj });
}
