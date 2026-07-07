import { NextRequest, NextResponse } from "next/server";
import { getGraph } from "@/lib/store";

// GET /api/ontology?stage=core|all
export function GET(req: NextRequest) {
  const stage = req.nextUrl.searchParams.get("stage");
  const graph = getGraph({ stage: stage === "core" ? "core" : "all" });
  return NextResponse.json(graph);
}
