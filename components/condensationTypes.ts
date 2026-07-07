// GET /api/condensation 응답 타입 — lib/types.ts에는 없으므로 컴포넌트 레이어에 로컬로 선언한다.
// (lib/*, app/api/*는 다른 에이전트 소유 — 이 파일은 읽기 전용 계약만 반영한다.)

export type RegionKey = "asia" | "europe" | "na" | "china";

export interface RegionSummary {
  key: RegionKey;
  name: string;
  regName: string;
  riskLevel: string;
}

export interface RegionsResponse {
  regions: RegionSummary[];
}

export interface CondensationAction {
  id: string;
  label: string;
  note: string;
}

/** 지역별 단면도 주석 플래그 — 모두 boolean + 근거 callouts. */
export interface DrawingFlags {
  extraVent: boolean;
  drain: boolean;
  lensHeater: boolean;
  doubleGasket: boolean;
  membraneBreather: boolean;
  dustMembrane: boolean;
  hydrophobicCoating: boolean;
  callouts: string[];
}

export interface CondensationRegionDetail {
  key: RegionKey;
  name: string;
  countries: string;
  regId: string;
  regName: string;
  climate: string;
  humidity: string;
  riskLevel: string;
  riskNote: string;
  causes: string[];
  test: string;
  actions: CondensationAction[];
  drawing: DrawingFlags;
}

export interface CondensationAnchorRef {
  id: string;
  label: string;
}

/** 위험도 문자열("높음"/"중~높음"/"중"/…)을 팔레트 색으로 매핑(패턴 매칭, 값 하드코딩 아님). */
export function riskColor(level: string): string {
  if (/높음/.test(level)) return "#FF5470";
  if (/중~높음/.test(level)) return "#FF8A3D";
  return "#8291a8";
}

/** GET /api/condensation?region=KEY */
export interface CondensationDetail {
  anchor: {
    component: CondensationAnchorRef; // 아우터 렌즈
    housing: CondensationAnchorRef; // 하우징
    failure: CondensationAnchorRef; // 결로·습기
  };
  region: CondensationRegionDetail;
  regObject: { id: string; label: string; props: [string, string][] } | null;
  relatedActions: CondensationAnchorRef[];
  evidence: string[];
  drawing: DrawingFlags;
}
