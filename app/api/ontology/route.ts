import { gzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { getGraph, ready } from "@/lib/store";

// GET /api/ontology?stage=core|all
// 전 그래프 JSON(≈200KB)이 최대 페이로드인데 NodePort 직결이라 앞단 gzip 이 없고,
// Next compress 는 standalone Route Handler 응답엔 적용되지 않음(실측) — 여기서 직접 압축한다.
export async function GET(req: NextRequest) {
  await ready();
  const stage = req.nextUrl.searchParams.get("stage");
  const graph = getGraph({ stage: stage === "core" ? "core" : "all" });

  const body = JSON.stringify(graph);
  const acceptsGzip = (req.headers.get("accept-encoding") ?? "").includes("gzip");
  if (!acceptsGzip) return NextResponse.json(graph);
  return new NextResponse(new Uint8Array(gzipSync(body)), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-encoding": "gzip",
      vary: "Accept-Encoding",
    },
  });
}
