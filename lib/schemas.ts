// lib/schemas.ts — 라우트 공용 zod 스키마 + JSON 본문 파싱 헬퍼 (infer·review-opinion 공용).
import { z } from "zod";

/** 신규 설계 조건(DesignInput) 입력 스키마 */
export const DesignInputSchema = z.object({
  market: z.string().min(1),
  lightSource: z.string().min(1),
  shape: z.array(z.string()).min(1),
  components: z.array(z.string()).optional(),
  anchorItem: z.string().optional(),
});

/** req.json() → schema 검증. 실패 시 400 Response 를 돌려준다(웹 표준 Response — 프레임워크 비의존). */
export async function parseJsonBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: Response.json({ error: "invalid JSON body" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: Response.json({ error: "invalid input", issues: parsed.error.flatten() }, { status: 400 }),
    };
  }
  return { ok: true, data: parsed.data };
}
