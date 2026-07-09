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
  /** 서브타입 분류(object_subtypes.st_id) — 키워드 분류기가 자동 부여, 미분류면 undefined */
  st?: string;
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

/** 전역 모순 스캔(lib/contradictions.ts) 항목 — 질문 없이도 상시 노출되는 근거 기반 모순. */
export interface Contradiction {
  kind: "record-gap" | "market-env" | "master-missing";
  title: string;
  detail: string;
  projects: string[];         // 관련 프로젝트 라벨
  evidence: string[];         // 근거 문서·객체 라벨 칩
  trace: string[];            // 근거 경로 "PJ26→SIMILAR→PJ21" (실존 엣지만)
  confidence: number;         // %
}

/** GET /api/contradictions */
export interface ContradictionsResponse {
  items: Contradiction[];
  scannedAt?: string;
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
  /** 확신도 산식 공개 — confidenceOf() 가 이미 계산하는 항을 그대로 노출(옵셔널, 구 버전 무영향). */
  breakdown?: {
    sim: number;    // 유사도 항 기여분(가중 적용 후, 0..1)
    evid: number;   // 근거수 항 기여분
    sev: number;    // 심각도 항 기여분
    master: number; // 마스터 일치 항 기여분
    boost: number;  // 조건 부스트 합계
    weights: { sim: number; evid: number; sev: number; master: number }; // 가중치 상수
  };
}

/** 마스터 대조(masterAudit) — 도달한 마스터별 설계표준 필수 항목 커버리지.
 * covered/missing/unknown 은 required 를 분할한다(각 항목은 정확히 하나에만 속함).
 * missing = 커버 근거 전무(확신), unknown = 부분/애매(오탐 방지 — 미확인으로 보수적 표기). */
export interface MasterAudit {
  master: { id: string; label: string };
  required: string[];
  covered: string[];
  missing: string[];
  unknown: string[];
  evidence: string[]; // 마스터로 도달한 concern 들의 근거 칩(문서·조치 등)
}

/** POST /api/infer 출력 */
export interface InferResponse {
  checklist: CheckItem[];
  total?: number; // 캡 이전 전체 관련 항목 수(체크리스트는 상위 N개만)
  traversed: { objects: number; edges: number; docs: number };
  masterAudit?: MasterAudit[]; // 도달한 fm/원인 기준 마스터 대조(옵셔널 — 기존 소비자 무영향)
  /** 오케스트레이터 파이프라인 실행 로그(옵셔널) — lib/orchestrator.ts. counts 는 전부 실측. */
  pipeline?: { name: string; ms: number; summary: string; counts?: Record<string, number> }[];
}
