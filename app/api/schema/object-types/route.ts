// POST/PATCH /api/schema/object-types           — 객체타입 생성·수정(upsert)
// DELETE     /api/schema/object-types?type_id=  — 삭제(그 타입 노드가 남아 있으면 409)
// 캔버스별 메타모델을 편집한다 — 빈 캔버스를 쓸 수 있게 하는 진입점(설계 §3.4).
import { NextResponse } from "next/server";
import { z } from "zod";
import * as db from "@/lib/db";
import { ready, reloadMetamodel } from "@/lib/store";
import { withCanvasRoute } from "@/lib/canvas-route";
import { parseJsonBody } from "@/lib/schemas";

export const runtime = "nodejs";

const ObjectTypeSchema = z.object({
  type_id: z.string().trim().regex(/^[a-z][a-z0-9_-]{0,30}$/, "소문자로 시작하는 영숫자·_·- 만"),
  label_ko: z.string().trim().min(1).max(40),
  color: z.string().trim().max(20).nullable().optional(),
  icon: z.string().trim().max(8).nullable().optional(),
  description: z.string().trim().max(200).nullable().optional(),
});

/** DB 없는 인메모리 모드에서는 편집을 persist 할 곳이 없다 — pg 연결 시도 전에 막는다. */
const noDb = () => NextResponse.json({ error: "DB 모드에서만 스키마를 편집할 수 있습니다" }, { status: 400 });

async function upsert(req: Request) {
  return withCanvasRoute(req, async () => {
    if (!db.dbEnabled()) return noDb();
    await ready();
    const parsed = await parseJsonBody(req, ObjectTypeSchema);
    if (!parsed.ok) return parsed.response;

    const d = parsed.data;
    await db.upsertObjectType({
      type_id: d.type_id,
      label_ko: d.label_ko,
      color: d.color ?? null,
      icon: d.icon ?? null,
      description: d.description ?? null,
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
    const typeId = new URL(req.url).searchParams.get("type_id");
    if (!typeId) return NextResponse.json({ error: "type_id 가 필요합니다" }, { status: 400 });

    // 선제 검사 — 노드가 남은 채로 지우면 nodes.type FK 위반이 난다.
    const used = await db.objectTypeUsage(typeId);
    if (used > 0) {
      return NextResponse.json(
        { error: `이 타입의 노드가 ${used}개 남아 있어 삭제할 수 없습니다`, nodeCount: used },
        { status: 409 }
      );
    }
    await db.deleteObjectType(typeId); // 서브타입·속성정의는 FK CASCADE
    await reloadMetamodel();
    return NextResponse.json({ ok: true });
  });
}
