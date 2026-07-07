import { z } from "zod";
import { buildFmeaWorkbook } from "@/lib/fmea-draft";
import { ready } from "@/lib/store";

const Body = z.object({
  market: z.string().min(1),
  lightSource: z.string().min(1),
  shape: z.array(z.string()).default([]),
  components: z.array(z.string()).optional(),
  anchorItem: z.string().optional(),
});

// POST /api/fmea-draft { DesignInput } → 채워진 DFMEA 초안 xlsx 다운로드
export async function POST(req: Request) {
  await ready();
  let input;
  try {
    input = Body.parse(await req.json());
  } catch {
    return new Response(JSON.stringify({ error: "invalid body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const buf = buildFmeaWorkbook(input, { date });

  const fnameKo = `FMEA초안_${input.anchorItem ?? input.market}_${input.lightSource}_${date.replace(/-/g, "")}.xlsx`;
  const encoded = encodeURIComponent(fnameKo);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="fmea-draft.xlsx"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}
