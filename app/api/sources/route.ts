import { NextResponse } from "next/server";
import { ingestAll } from "@/lib/ingest";
import { getRuntimeSources } from "@/lib/store";

// GET /api/sources — 원천 파일 목록 + 파일별 추출 요약/미리보기(정형화 전 → 후 시연용)
// 정적 data/sources 목록에 런타임 업로드(/api/ingest) 출처를 병합(같은 파일명은 업로드 쪽 우선).
export function GET() {
  const { sources } = ingestAll();
  const byFile = new Map(sources.map((s) => [s.file, s]));
  for (const s of getRuntimeSources()) byFile.set(s.file, s);
  return NextResponse.json({ sources: [...byFile.values()] });
}
