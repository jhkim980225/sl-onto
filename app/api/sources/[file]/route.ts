// DELETE/PUT /api/sources/[file] — 캔버스 안의 문서 1건 삭제·교체
// (설계 docs/superpowers/specs/2026-07-20-canvas-document-crud-design.md §4).
//
//   DELETE — doc 노드 + 이 문서가 유일 근거인 객체 제거, sources 행·원본 바이트 삭제
//   PUT    — 교체 = 삭제 + 재인제스천. 파싱을 먼저 하고 성공했을 때만 지운다(원자성, 설계 §3).
//            대상 문서가 없으면 그냥 등록된다(upsert 의미 — PUT).
import { NextResponse } from "next/server";
import * as path from "node:path";
import { ingestOne, ingestPdfText } from "@/lib/ingest";
import { withTempFile } from "@/lib/ingest/tempfile";
import { parseDocument, parseEnabled } from "@/lib/parse";
import { mergeDelta, registerSource, getMetamodel, ready } from "@/lib/store";
import { deleteDocument } from "@/lib/documents";
import { withCanvasRoute } from "@/lib/canvas-route";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB — /api/ingest 와 동일
const ALLOWED_EXT = /\.(xlsx|pptx|docx|dxf|pdf)$/i;

const bad = (status: number, error: string) => NextResponse.json({ error }, { status });

/** 디렉터리 탈출 차단 — drawing-svg 와 같은 방침(경로 구분자 없는 순수 파일명만). */
const unsafeName = (f: string) => !f || f.includes("/") || f.includes("\\") || f.includes("..");

export async function DELETE(req: Request, { params }: { params: Promise<{ file: string }> }) {
  return withCanvasRoute(req, async () => {
    await ready();
    const { file } = await params;
    if (unsafeName(file)) return bad(400, "잘못된 파일명입니다");
    const result = await deleteDocument(file.normalize("NFC"));
    if (!result) return bad(404, "문서를 찾을 수 없습니다");
    return NextResponse.json({ ok: true, ...result });
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ file: string }> }) {
  return withCanvasRoute(req, async () => {
    await ready();
    const { file } = await params;
    if (unsafeName(file)) return bad(400, "잘못된 파일명입니다");
    // 객체타입이 없는 캔버스에는 노드를 넣을 수 없다(nodes.type FK) — /api/ingest 와 같은 선제 안내.
    if (getMetamodel().objectTypes.length === 0) {
      return NextResponse.json(
        { error: "이 캔버스에는 객체타입이 없습니다. ◈ 스키마에서 먼저 정의하세요", needsSchema: true },
        { status: 409 }
      );
    }

    const ct = req.headers.get("content-type") ?? "";
    if (!ct.includes("multipart/form-data")) return bad(400, "본문은 multipart/form-data(file) 여야 합니다");
    const form = await req.formData();
    const f = form.get("file");
    if (!(f instanceof File)) return bad(400, 'multipart field "file" 이 없습니다');

    const name = path.basename(f.name || "").normalize("NFC");
    if (unsafeName(name) || !ALLOWED_EXT.test(name))
      return bad(400, "지원 형식은 .xlsx / .pptx / .docx / .dxf / .pdf 입니다");
    if (f.size === 0) return bad(400, "빈 파일입니다");
    if (f.size > MAX_BYTES) return bad(400, "파일이 10MB 를 초과합니다");
    const buf = Buffer.from(await f.arrayBuffer());

    // ── 1) 파싱 먼저. 여기서 실패하면 원본 문서는 그대로 남는다(설계 §3 원자성).
    let result: ReturnType<typeof ingestOne>;
    if (/\.pdf$/i.test(name)) {
      if (!parseEnabled()) return bad(400, "PDF 인제스천은 pyservice(/parse)가 필요합니다 — PYSERVICE_URL 미설정");
      const parsed = await parseDocument(name, buf);
      if (!parsed) return bad(400, "PDF 파싱 실패 — pyservice(/parse) 미가용이거나 추출 오류");
      const text = [parsed.text, ...parsed.tables.flatMap((t) => t.map((row) => row.join(" | ")))].join("\n").trim();
      if (!text) return bad(400, "PDF 에서 텍스트를 추출하지 못했습니다");
      result = ingestPdfText(name, text, buf.length);
    } else {
      try {
        result = withTempFile(name, buf, (tmp) => ingestOne(tmp, name));
      } catch (err) {
        return bad(400, `파싱 실패(손상되었거나 지원하지 않는 문서): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── 1-b) 추출 0건도 거부한다. 이 레포의 파서는 견고 파싱이라 손상된 파일에도 throw 하지 않고
    // 빈 결과를 돌려준다(data/real-samples 대응). 그대로 진행하면 원본을 지우고 빈 델타를 병합해
    // 문서의 그래프가 통째로 사라진다 — 교체가 파괴 동작이 된다. 실측으로 확인된 실패 모드다.
    // 정말 빈 문서를 넣으려면 삭제 후 등록으로 명시적으로 하면 된다.
    if (result.source.extracted.objects === 0) {
      return bad(
        400,
        "새 파일에서 추출된 객체가 없습니다 — 손상되었거나 형식이 다른 문서로 보입니다. 기존 문서는 그대로 두었습니다."
      );
    }

    // ── 2) 파싱 성공 후에만 기존 문서 제거 → 병합
    const removed = (await deleteDocument(file.normalize("NFC")))?.removed ?? { doc: 0, nodes: 0, edges: 0 };
    const delta = await mergeDelta(result.nodes, result.edges);
    await registerSource(result.source, buf);

    return NextResponse.json({
      ok: true,
      replaced: true,
      file: name,
      source: result.source,
      removed,
      added: { nodes: delta.addedNodes.length, edges: delta.addedEdges.length },
    });
  });
}
