// GET /api/sources 응답 타입 — lib/types.ts에는 없으므로 컴포넌트 레이어에 로컬로 선언한다.
// (lib/*, app/api/*는 다른 에이전트 소유 — 이 파일은 읽기 전용 계약만 반영한다.)
import type { ObjType } from "@/lib/types";

/** 원문 추출 항목 하나가 표준 온톨로지 객체로 정규화된 결과(정형화 미리보기의 근거). */
export interface SourcePreviewItem {
  raw: string; // 원문 표현 (예: "외관-B") — 덮어쓰지 않고 보존
  id: string; // 매핑된 표준 객체 id (예: "FMGAP")
  label: string; // 표준 라벨 (예: "간극 벌어짐")
  type: ObjType;
  confidence: number; // 0..1
}

export interface SourceInfo {
  file: string;
  type: string; // 원천 파일 형식: XLSX | PPTX | DOCX 등
  sizeBytes: number;
  extracted: { objects: number; relations: number };
  preview: SourcePreviewItem[];
}

export interface SourcesResponse {
  sources: SourceInfo[];
}
