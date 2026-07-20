// POST /api/drawing-input — 도면(.dxf) 업로드 → 온톨로지 합류 + 형상 유사 과거 설계 탐색 + 조건 후보.
// "이 도면과 닮은 과거 설계가 있었나"에 답하는 엔드포인트. 라우트는 파싱·머지·응답만 —
// 형상 유사 랭킹·SIMILAR 병합·고장 이력·조건 후보 조립은 lib/drawing-input.ts analyzeDrawing().
// docs/superpowers/specs/2026-07-06-2d-drawing-design.md
import { NextResponse } from "next/server";
import * as path from "node:path";
import { analyzeDrawing } from "@/lib/drawing-input";
import { ingestOne } from "@/lib/ingest";
import { parseDxfEntities, parseDrawing } from "@/lib/ingest/dxf";
import { withTempFile } from "@/lib/ingest/tempfile";
import { allEdges, allNodes, getMetamodel, getRuntimeSources, mergeDelta, ready, registerSource, setActiveDrawing } from "@/lib/store";
import { assessDrawing } from "@/lib/drawing-risk";
import { withCanvasRoute } from "@/lib/canvas-route";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;
const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  return withCanvasRoute(req, async () => {
    await ready();
    try {
      let name: string;
      let buf: Buffer;
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        // { "sample": true } — 서버가 신규 도면(리어 콤비램프)을 즉석 생성해 추가 시연
        const body = await req.json().catch(() => null);
        if (!body || body.sample !== true) return bad(400, 'JSON 은 { "sample": true } 만 지원합니다');
        const { buildSampleDrawingDxf, SAMPLE_DRAWING_NAME } = await import("@/lib/ingest/drawing-sample");
        name = SAMPLE_DRAWING_NAME;
        buf = Buffer.from(buildSampleDrawingDxf(), "utf8");
      } else {
        const form = await req.formData();
        const f = form.get("file");
        if (!(f instanceof File)) return bad(400, 'multipart field "file" 이 없습니다');
        name = path.basename(f.name || "").normalize("NFC");
        if (!/\.dxf$/i.test(name)) return bad(400, "도면 입력은 .dxf 만 지원합니다");
        if (f.size === 0 || f.size > MAX_BYTES) return bad(400, "빈 파일이거나 10MB 를 초과합니다");
        buf = Buffer.from(await f.arrayBuffer());
      }
      const drawing = parseDrawing(parseDxfEntities(buf.toString("utf8")));

      // 1) 온톨로지 합류 (기존 인제스천 파이프라인 재사용 — 멱등)
      // /api/ingest 와 동일한 두 가드. 없으면 (a) 빈 스키마 캔버스에서 nodes.type FK 위반 raw 500,
  // (b) 같은 이름 재업로드 시 sources 행만 교체되고 옛 노드가 남아 근거가 어긋난다.
  if (getMetamodel().objectTypes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "이 캔버스에는 객체타입이 없습니다. ◈ 스키마에서 먼저 정의하세요", needsSchema: true },
      { status: 409 }
    );
  }
  if (getRuntimeSources().some((s) => s.file === name)) {
    return NextResponse.json(
      { ok: false, error: `"${name}" 도면이 이미 있습니다. 내용을 바꾸려면 📄 문서에서 ⟳ 교체를 쓰세요.`, duplicate: true },
      { status: 409 }
    );
  }

  const result = withTempFile(name, buf, (tmp) => ingestOne(tmp, name));
      const delta = await mergeDelta(result.nodes, result.edges, "drawing.add");
      await registerSource(result.source, buf);

      // 2) 도면 프로젝트 노드(형상 특징 보유) 확정
      const parsedProj = result.nodes.find(
        (n) => n.type === "proj" && n.props?.some(([k]) => k.startsWith("형상."))
      );
      if (!parsedProj) {
        return NextResponse.json({
          ok: true, file: name, source: result.source, conditions: null, similar: [],
          delta: { nodes: delta.addedNodes, edges: delta.addedEdges, updated: delta.touched },
          totals: { nodes: allNodes().length, edges: allEdges().length },
          note: "도면에서 프로젝트·형상 특징을 찾지 못해 유사 탐색을 건너뜀(제목블록/NOTE 확인)",
        });
      }
      await setActiveDrawing(parsedProj.id); // 이후 자연어 질의의 "이 도면/이 커넥터" 지시 대상

      // 3) 형상 유사 분석 — 랭킹·SIMILAR 병합·고장 이력·조건 후보 (lib/drawing-input.ts)
      const analysis = await analyzeDrawing(parsedProj, drawing);

      return NextResponse.json({
        ok: true,
        file: name,
        source: result.source,
        drawing: { labels: drawing.labels, features: drawing.features },
        vulnerabilities: assessDrawing(drawing, [], drawing.labels["시장"]),
        conditions: analysis.conditions,
        similar: analysis.similar,
        delta: {
          nodes: delta.addedNodes,
          edges: [...delta.addedEdges, ...analysis.simEdges],
          updated: delta.touched,
        },
        totals: { nodes: allNodes().length, edges: allEdges().length },
      });
    } catch (err) {
      console.error("POST /api/drawing-input failed:", err);
      return bad(422, `도면 분석 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
