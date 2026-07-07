// 온톨로지 타입 계약 — 모든 lib/·api/·components/가 이 형태를 따른다.
// 출처: docs/data-model.md

export type ObjType =
  | "item" | "fm" | "cause" | "action"
  | "reg" | "proj" | "master" | "spec" | "doc";

/** 그래프 노드 (그래프 조회용 경량 형태) */
export interface Node {
  id: string;
  type: ObjType;
  label: string;
  sub?: string;
  hero?: boolean;
  hidden?: boolean;            // 신규 프로젝트 등 시나리오 전 숨김
  /** 앵커 좌표(데모 레이아웃 유지용, 선택) */
  ax?: number;
  ay?: number;
  /** doc 노드의 부모(EVIDENCED_BY 대상) */
  parent?: string;
  ext?: string;               // doc 형식: PTS|PPTX|XLSX|TIF|BOM|SPEC
  /** 표시용 key-value 속성 */
  props?: [string, string][];
}

/** 그래프 엣지 */
export interface Edge {
  src: string;
  rel: string;
  dst: string;
  weight?: number;            // SIMILAR 유사도 등
  scen?: boolean;             // 시나리오 전용 여부
}

/** 인스펙터용 관계 항목 */
export interface Rel {
  rel: string;
  dir: "in" | "out";
  other: string;              // 상대 객체 id
  otherLabel: string;
}

/** 근거 문서 */
export interface Doc {
  id: string;
  ext: string;
  filename: string;
  props?: [string, string][];
}

/** GET /api/ontology */
export interface GraphResponse {
  nodes: Node[];
  edges: Edge[];
}

/** GET /api/object/[id] */
export interface ObjectDetail extends Node {
  relations: Rel[];
  evidence: Doc[];
}

/** GET /api/search */
export interface SearchHit {
  id: string;
  label: string;
  type: ObjType;
  score: number;
  matched: ("label" | "sub" | "prop" | "evidence")[];
}
export interface SearchResponse {
  hits: SearchHit[];
  neighbors: string[];        // 하이라이트할 이웃 id
}

/** POST /api/nlsearch — 자연어 검색 */
export interface NLSearchResponse {
  answer: string;            // 자연어 요약(한국어)
  interpretation?: string;   // 질의 해석(이해한 필터)
  hits: SearchHit[];         // 관련 객체(관련도 순)
  neighbors: string[];       // 하이라이트용 이웃
  mode: "llm" | "fallback";  // llm 실패 시 키워드 폴백
}

/** POST /api/infer 입력 */
export interface DesignInput {
  market: string;             // 예: "북미"
  lightSource: string;        // 예: "LED"
  shape: string[];            // 예: ["분리형 DRL","슬림 하우징"]
  components?: string[];
  /** 명시적 부품 앵커 — 사용자가 그래프에서 부품(item) 노드를 선택하고 추론한 경우.
   * 설정 시 그 부품의 고장 이력만으로 체크리스트를 스코프한다(components 소프트 부스트와 구분). */
  anchorItem?: string;
  /** 유사 탐색 시드 프로젝트 id (도면 업로드 흐름 — 없으면 기존 시나리오 노드 사용) */
  seedProject?: string;
}

/** 추론 체크리스트 항목 */
export interface CheckItem {
  no: number;
  title: string;
  desc: string;
  evidence: string[];         // 문서/사례 칩
  confidence: number;         // %
  trace: string[];            // 근거 경로 "PJ26→SIMILAR→PJ21"
}

/** POST /api/infer 출력 */
export interface InferResponse {
  checklist: CheckItem[];
  total?: number; // 캡 이전 전체 관련 항목 수(체크리스트는 상위 N개만)
  traversed: { objects: number; edges: number; docs: number };
}
