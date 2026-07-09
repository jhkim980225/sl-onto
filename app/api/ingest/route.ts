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
import { ingestOne, ingestPdfText } from "@/lib/ingest";
import { llmExtractToDelta } from "@/lib/ingest/llm-assist";
import { vocabCatalog } from "@/lib/ingest/normalize";
import { readDeck } from "@/lib/ingest/pptx";
import { readDoc } from "@/lib/ingest/docx";
import { llmExtract } from "@/lib/llm";
import { parseDocument, parseEnabled } from "@/lib/parse";
import { mergeDelta, registerSource, allNodes, allEdges, ready } from "@/lib/store";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXT = /\.(xlsx|pptx|docx|dxf|pdf)$/i;

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
  // 옵트인 LLM 보강 — 기본 OFF. vLLM 이 쿼리당 30~90초라 명시적 ?llm=1 일 때만.
  const llmOptIn = new URL(req.url).searchParams.get("llm") === "1";

  const name = path.basename(f.name || "").normalize("NFC");
  if (!ALLOWED_EXT.test(name)) return bad(400, "지원 형식은 .xlsx / .pptx / .docx / .dxf / .pdf 입니다");
  if (f.size === 0) return bad(400, "빈 파일입니다");
  if (f.size > MAX_BYTES) return bad(400, "파일이 10MB 를 초과합니다");

  const buf = Buffer.from(await f.arrayBuffer());
  let pdfText = "";
  let result: ReturnType<typeof ingestOne>;
  if (/\.pdf$/i.test(name)) {
    // PDF: 바이너리 파싱은 pyservice(/parse) 담당(스캔 PDF OCR 은 docling 탑재 시).
    // pyservice 미가용이면 이 파일만 실패 — 다른 형식 인제스천은 영향 없음.
    if (!parseEnabled()) return bad(503, "PDF 인제스천은 pyservice(/parse)가 필요합니다 — PYSERVICE_URL 미설정");
    const parsed = await parseDocument(name, buf);
    if (!parsed) return bad(422, "PDF 파싱 실패 — pyservice(/parse) 미가용이거나 추출 오류");
    // 표 셀도 자유 텍스트 스캔 대상에 포함(행 단위로 평탄화).
    pdfText = [parsed.text, ...parsed.tables.flatMap((t) => t.map((row) => row.join(" | ")))].join("\n").trim();
    if (!pdfText) return bad(422, "PDF 에서 텍스트를 추출하지 못했습니다(이미지 전용 스캔 — OCR 은 docling 탑재 필요)");
    result = ingestPdfText(name, pdfText, buf.length);
  } else {
    try {
      result = ingestBufferAs(name, buf);
    } catch (err) {
      return bad(422, `파싱 실패(손상되었거나 지원하지 않는 문서): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const delta = await mergeDelta(result.nodes, result.edges);
  await registerSource(result.source, buf);

  // 옵트인 LLM 보강 — 규칙 파싱이 빈약할 때(객체 3개 미만)만, 자유 텍스트 문서(pdf/pptx/docx)에 한해.
  // PYSERVICE_URL 미가용·LLM 실패·비 JSON 응답은 전부 조용히 스킵(규칙 결과 그대로).
  let llmAssist: { added: { nodes: number; edges: number } } | undefined;
  if (llmOptIn && result.source.extracted.objects < 3 && /\.(pdf|pptx|docx)$/i.test(name)) {
    llmAssist = await tryLlmAssist(name, buf, pdfText);
  }

  return NextResponse.json({
    ok: true,
    file: name,
    source: result.source,
    delta: { nodes: delta.addedNodes, edges: delta.addedEdges, updated: delta.touched },
    totals: totals(),
    ...(llmAssist ? { llmAssist } : {}),
  });
}

/** 문서 텍스트를 LLM(task=extract)에 보내 개체·관계 델타를 병합. 어떤 실패도 undefined(스킵). */
async function tryLlmAssist(name: string, buf: Buffer, pdfText: string) {
  try {
    const text = pdfText || extractProseText(name, buf);
    if (!text.trim()) return undefined;
    const extracted = await llmExtract(text.slice(0, 4000), vocabCatalog());
    if (!extracted) return undefined; // pyservice 미가용/실패 — 규칙 결과 그대로
    const delta = llmExtractToDelta(extracted, `doc:${name}`, allNodes());
    const merged = await mergeDelta(delta.nodes, delta.edges, "llm-assist");
    return { added: { nodes: merged.addedNodes.length, edges: merged.addedEdges.length } };
  } catch (err) {
    console.warn("[ingest] LLM 보강 스킵:", err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

/** pptx/docx 산문 텍스트 추출(파서는 파일 경로를 받으므로 임시파일 경유). */
function extractProseText(name: string, buf: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slonto-llm-"));
  const tmp = path.join(dir, `upload${path.extname(name).toLowerCase()}`);
  try {
    fs.writeFileSync(tmp, buf);
    if (/\.pptx$/i.test(name)) return readDeck(tmp).slides.flatMap((s) => s.lines).join("\n");
    if (/\.docx$/i.test(name)) return readDoc(tmp).paragraphs.join("\n");
    return "";
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
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
