// POST /api/ingest 응답 타입 — lib/types.ts에는 없으므로 컴포넌트 레이어에 로컬로 선언한다.
// (lib/*, app/api/*는 다른 에이전트 소유 — 이 파일은 계약을 읽기 전용으로 반영한다.)
import type { Edge, Node } from "@/lib/types";
import type { SourceInfo } from "./sourceTypes";

/** POST /api/ingest 성공 응답. delta = 이번 인제스천으로 "새로" 추가된 것만. */
export interface IngestResponse {
  ok: true;
  file: string;
  source: SourceInfo;
  delta: {
    nodes: Node[];
    edges: Edge[];
    /** 새 엣지를 얻은 "기존" 노드 id 목록 */
    updated: string[];
  };
  totals: { nodes: number; edges: number };
  /** 샘플 모드에서 이미 반영된 경우 true(델타는 비어 있음) */
  alreadyIngested?: boolean;
}

/** 오류 응답({ok:false,error} · 4xx) 판별용 */
export interface IngestErrorResponse {
  ok: false;
  error: string;
}
