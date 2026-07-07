import { NextRequest, NextResponse } from "next/server";
import { getGraph, ready } from "@/lib/store";

// GET /api/ontology?stage=core|all
export async function GET(req: NextRequest) {
  await ready();
  const stage = req.nextUrl.searchParams.get("stage");
  const graph = getGraph({ stage: stage === "core" ? "core" : "all" });
  return NextResponse.json(graph);
}
