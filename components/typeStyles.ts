// 유형별 시각 상수 — design.md에 고정된 색·glyph (데모 TYPES와 동일, 변경 금지).
// Graph/Inspector/SearchResults 등 여러 컴포넌트가 공유하는 단일 소스.
import type { ObjType } from "@/lib/types";

export const TYPES: Record<ObjType, { c: string; g: string }> = {
  item: { c: "#FFC46B", g: "ITEM" },
  fm: { c: "#FF5470", g: "FM" },
  cause: { c: "#FF8A3D", g: "CAUSE" },
  action: { c: "#5EDC9A", g: "ACT" },
  reg: { c: "#5EA8FF", g: "REG" },
  proj: { c: "#B18CFF", g: "PJ" },
  master: { c: "#4FE0D2", g: "MSTR" },
  spec: { c: "#93A8FF", g: "SPEC" },
  doc: { c: "#8291a8", g: "DOC" },
};

// 대분류(TYPE) 한국어 존 라벨 — 그래프의 타입별 클러스터 구역 라벨에 사용.
export const TYPE_NAMES: Record<ObjType, string> = {
  item: "부품·구성",
  fm: "고장모드",
  cause: "원인",
  action: "조치",
  reg: "법규·인증",
  proj: "프로젝트",
  master: "마스터",
  spec: "고객 스펙",
  doc: "근거 문서",
};
