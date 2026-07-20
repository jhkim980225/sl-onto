// POST/PATCH /api/schema/relation-types          — 관계타입 생성·수정(upsert)
// DELETE     /api/schema/relation-types?rel_id=  — 삭제(그 관계 엣지가 남아 있으면 409)
// src_types·dst_types 는 domain/range — 관계 검증·추론이 이 값을 본다.
import { NextResponse } from "next/server";
import { z } from "zod";
import * as db from "@/lib/db";
import { ready, reloadMetamodel } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";
import { parseJsonBody } from "@/lib/schemas";

export const runtime = "nodejs";

const RelationTypeSchema = z.object({
  rel_id: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,30}$/, "대문자·숫자·_ 만 (예: HAS_FAILURE)"),
  label_ko: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).nullable().optional(),
  // .default([]) 는 parseJsonBody 의 z.ZodType<T> 추론에서 output 이 optional 로 잡힌다 — ?? 로 처리.
  src_types: z.array(z.string()).optional(),
  dst_types: z.array(z.string()).optional(),
});

/** DB 없는 인메모리 모드에서는 편집을 persist 할 곳이 없다 — pg 연결 시도 전에 막는다. */
const noDb = () => NextResponse.json({ error: "DB 모드에서만 스키마를 편집할 수 있습니다" }, { status: 400 });

async function upsert(req: Request) {
  return withCanvasRoute(req, async () => {
    if (!db.dbEnabled()) return noDb();
    await ready();
    const parsed = await parseJsonBody(req, RelationTypeSchema);
    if (!parsed.ok) return parsed.response;

    const d = parsed.data;
    await db.upsertRelationType({
      rel_id: d.rel_id,
      label_ko: d.label_ko,
      description: d.description ?? null,
      src_types: d.src_types ?? [],
      dst_types: d.dst_types ?? [],
    });
    await reloadMetamodel();
    return NextResponse.json({ ok: true });
  });
}

export const POST = upsert;
export const PATCH = upsert;

export async function DELETE(req: Request) {
  return withCanvasRoute(req, async () => {
    if (!db.dbEnabled()) return noDb();
    await ready();
    const relId = new URL(req.url).searchParams.get("rel_id");
    if (!relId) return NextResponse.json({ error: "rel_id 가 필요합니다" }, { status: 400 });

    // 선제 검사 — 엣지가 남은 채로 지우면 edges.rel FK 위반이 난다.
    const used = await db.relationTypeUsage(relId);
    if (used > 0) {
      return NextResponse.json(
        { error: `이 관계의 엣지가 ${used}개 남아 있어 삭제할 수 없습니다`, edgeCount: used },
        { status: 409 }
      );
    }
    await db.deleteRelationType(relId);
    await reloadMetamodel();
    return NextResponse.json({ ok: true });
  });
}
