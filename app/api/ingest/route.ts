// POST /api/ingest — 증분 인제스천: 온톨로지가 살아있는 상태에서 문서 1개를 추가로 파싱·병합하고
// "무엇이 새로 들어왔는지"(델타)만 돌려준다.
//   1) multipart/form-data (field `file`): 업로드된 xlsx/pptx/docx 를 임시파일로 받아 ingestOne → mergeDelta
//   2) JSON { "sample": true }: 번들 데모 샘플(FMEA 검토시트)을 SheetJS 로 인메모리 생성해 동일 경로로 인제스트
// 응답: { ok, file, source, delta: { nodes, edges, updated }, totals } — delta 는 "새로 추가된 것"만.
//
// 주의(멀티 레플리카): 병합은 이 프로세스의 인메모리 store 만 바꾼다. 클러스터 데모는
// replicas=1 또는 sticky session 으로 운영할 것 (lib/store.ts mergeDelta 주석 참조).
import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { ingestOne } from "@/lib/ingest";
import { mergeDelta, registerSource, allNodes, allEdges, ready } from "@/lib/store";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXT = /\.(xlsx|pptx|docx|dxf)$/i;

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });
const totals = () => ({ nodes: allNodes().length, edges: allEdges().length });

/** 버퍼를 임시파일(os.tmpdir)로 내려 ingestOne 을 태운다. 파싱 실패는 throw. */
function ingestBufferAs(fileName: string, buf: Buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slonto-ingest-"));
  const tmp = path.join(dir, `upload${path.extname(fileName).toLowerCase()}`);
  try {
    fs.writeFileSync(tmp, buf);
    return ingestOne(tmp, fileName);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

export async function POST(req: Request) {
  await ready();
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) return await handleUpload(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return bad(400, "본문은 multipart/form-data(file) 또는 JSON 이어야 합니다");
    }
    if (body !== null && typeof body === "object" && (body as Record<string, unknown>).sample === true) {
      return handleSample();
    }
    return bad(400, '지원하지 않는 요청 — multipart field "file" 또는 { "sample": true }');
  } catch (err) {
    // 어떤 입력에도 서버가 죽지 않는다(견고성).
    console.error("POST /api/ingest failed:", err);
    return bad(422, `인제스천 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleUpload(req: Request) {
  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) return bad(400, 'multipart field "file" 이 없습니다');

  const name = path.basename(f.name || "").normalize("NFC");
  if (!ALLOWED_EXT.test(name)) return bad(400, "지원 형식은 .xlsx / .pptx / .docx / .dxf 입니다");
  if (f.size === 0) return bad(400, "빈 파일입니다");
  if (f.size > MAX_BYTES) return bad(400, "파일이 10MB 를 초과합니다");

  const buf = Buffer.from(await f.arrayBuffer());
  let result: ReturnType<typeof ingestOne>;
  try {
    result = ingestBufferAs(name, buf);
  } catch (err) {
    return bad(422, `파싱 실패(손상되었거나 지원하지 않는 문서): ${err instanceof Error ? err.message : String(err)}`);
  }

  const delta = await mergeDelta(result.nodes, result.edges);
  await registerSource(result.source, buf);
  return NextResponse.json({
    ok: true,
    file: name,
    source: result.source,
    delta: { nodes: delta.addedNodes, edges: delta.addedEdges, updated: delta.touched },
    totals: totals(),
  });
}

// 샘플 인제스천 — 매 클릭마다 새 현장 보고(차수 증가)가 결로·습기(FMFOG)에 정확히 3개 노드
// (부품·원인·조치)를 붙인다. 라벨에 차수가 들어가 항상 새 델타가 생기며("이미 반영됨" 없음),
// 응답의 focus 로 클라이언트가 결로·습기 노드를 활성화(포커스)한다.
let SAMPLE_ROUND = 0;

async function handleSample() {
  SAMPLE_ROUND++;
  const n = SAMPLE_ROUND;
  const rows = [
    {
      부품: `벤트 어셈블리 개선형-${n}`,
      기능: "습기 배출",
      고장모드: "결로·습기",
      원인: `습기 유입 경로 미확인-${n}`,
      영향: "감성 품질 저하",
      심각도S: 6,
      발생도O: 4,
      현행조치: `실링 보강안-${n}`,
      원본코드: "",
      발생프로젝트: "",
    },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "FMEA");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const fileName = `FMEA_현장보고_결로_${n}차.xlsx`;
  let result: ReturnType<typeof ingestOne>;
  try {
    result = ingestBufferAs(fileName, buf);
  } catch (err) {
    return bad(422, `샘플 생성 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  const delta = await mergeDelta(result.nodes, result.edges);
  await registerSource(result.source, buf);
  return NextResponse.json({
    ok: true,
    file: fileName,
    focus: "FMFOG", // 결로·습기 활성화 대상
    source: result.source,
    delta: { nodes: delta.addedNodes, edges: delta.addedEdges, updated: delta.touched },
    totals: totals(),
  });
}
