// 결로·습기 지역별 시연 시나리오 (아우터렌즈 → FMFOG).
// 온톨로지 백본(ILENS·IHSG·FMFOG·CVENT·AVENT·규제 노드)에 "지역 축"과 "설계도 주석"을 얹는다.
// docs/features/결로-시나리오.md
import { getObject, getNode, evidenceOf } from "@/lib/store";

export type RegionKey = "asia" | "europe" | "na" | "china";

/** 설계도(SVG 단면) 주석 플래그 — 프론트 렌더가 지역별로 켜고 끈다. */
export interface DrawingSpec {
  extraVent: boolean; // 벤트 용량 확대(2개소)
  drain: boolean; // 하부 드레인 경로
  lensHeater: boolean; // 렌즈 히팅 와이어
  doubleGasket: boolean; // 씰링 이중화
  membraneBreather: boolean; // 소수성 멤브레인 브리더
  dustMembrane: boolean; // 방진·방습 겸용 멤브레인
  hydrophobicCoating: boolean; // 발수(소수성) 코팅
  callouts: string[]; // 도면 위 라벨(주석)
}

export interface RegionInfo {
  key: RegionKey;
  name: string; // 표시명
  countries: string; // 대표 국가
  regId: string; // 온톨로지 reg 노드 id
  regName: string; // 규제 표시명
  climate: string; // 기후 특성
  humidity: string; // 습도/온도 프로파일
  riskLevel: "높음" | "중" | "중~높음";
  riskNote: string;
  causes: string[]; // 근본 원인(우선순위)
  test: string; // 시험 방법
  actions: { id: string; label: string; note: string }[]; // 권장 대책(온톨로지 action id 연결 가능)
  drawing: DrawingSpec;
}

/** 시나리오 앵커 — 온톨로지 백본 id */
export const CONDENSATION_ANCHOR = {
  component: "ILENS", // 아우터 렌즈 (PC)
  housing: "IHSG", // 하우징 (PP-GF)
  failure: "FMFOG", // 결로·습기
  cause: "CVENT", // 벤트·씰링 설계
  action: "AVENT", // 벤트 경로 개선
} as const;

export const REGIONS: Record<RegionKey, RegionInfo> = {
  asia: {
    key: "asia",
    name: "아시아",
    countries: "한국 · 동남아",
    regId: "RKR",
    regName: "KMVSS",
    climate: "고온다습 · 우기 집중호우 · 큰 일교차",
    humidity: "RH 80–95% (우기) · 온도 -10~40°C",
    riskLevel: "높음",
    riskNote: "내부 결로 필드 클레임 빈발 지역 — 급냉 시 렌즈 내면 응결",
    causes: ["벤트 용량 부족", "씰링 열화", "급냉 응결"],
    test: "온습도 사이클(-10↔40°C, RH90%) 20cyc + 침수 IPX7",
    actions: [
      { id: "AVENT", label: "벤트 경로 개선", note: "벤트 용량 2개소 확대 + 하부 드레인 신설" },
      { id: "", label: "발수 코팅", note: "렌즈 내면 소수성 코팅으로 응결 유동화" },
    ],
    drawing: {
      extraVent: true, drain: true, lensHeater: false, doubleGasket: false,
      membraneBreather: false, dustMembrane: false, hydrophobicCoating: true,
      callouts: ["벤트 용량 확대 ×2", "하부 드레인", "발수 코팅(내면)"],
    },
  },
  europe: {
    key: "europe",
    name: "유럽",
    countries: "EU",
    regId: "REU",
    regName: "ECE R149",
    climate: "저온·습윤 · 결빙 · 서리",
    humidity: "RH 70–90% · 온도 -25~35°C",
    riskLevel: "중~높음",
    riskNote: "저온 응결·착빙 — 히팅 부재 시 렌즈 하부 서리/결로",
    causes: ["저온 응결", "히팅 부재", "씰링 경화"],
    test: "저온 결빙 사이클 + 방수 IPX9K",
    actions: [
      { id: "", label: "렌즈 히팅 와이어", note: "렌즈 하부 발열 코일로 결빙·서리 방지" },
      { id: "AVENT", label: "씰링 이중화", note: "이중 개스킷으로 저온 침습 차단" },
    ],
    drawing: {
      extraVent: false, drain: false, lensHeater: true, doubleGasket: true,
      membraneBreather: false, dustMembrane: false, hydrophobicCoating: false,
      callouts: ["렌즈 히팅 코일", "이중 개스킷", "방수 IPX9K"],
    },
  },
  na: {
    key: "na",
    name: "북미",
    countries: "미국 · 캐나다",
    regId: "RUS",
    regName: "FMVSS 108",
    climate: "큰 온도 스윙 · 건습 반복",
    humidity: "RH 40–85% · 온도 -30~45°C",
    riskLevel: "중",
    riskNote: "급격한 온도 변화 결로 — 브리더 응답 지연 시 내부 습기 잔류",
    causes: ["온도 스윙 결로", "브리더 응답 지연"],
    test: "열충격(-30↔45°C) + 습도 사이클",
    actions: [
      { id: "", label: "소수성 멤브레인 브리더", note: "습기 배출·수분 차단 동시(GORE형 멤브레인)" },
      { id: "AVENT", label: "벤트 위치 최적화", note: "상하 벤트 배치로 대류 순환 확보" },
    ],
    drawing: {
      extraVent: false, drain: false, lensHeater: false, doubleGasket: false,
      membraneBreather: true, dustMembrane: false, hydrophobicCoating: false,
      callouts: ["멤브레인 브리더", "상·하 벤트 배치"],
    },
  },
  china: {
    key: "china",
    name: "중국",
    countries: "중국",
    regId: "RCN",
    regName: "GB 25991",
    climate: "고습 · 미세먼지 · 지역 편차 큼",
    humidity: "RH 75–95% · 분진 다량",
    riskLevel: "높음",
    riskNote: "방습·방진 동시 요구 — 방진필터 막힘 시 내압 상승·결로",
    causes: ["방진필터 막힘", "고습 침투"],
    test: "방진+방습 복합 + 침수 IPX7",
    actions: [
      { id: "", label: "방진·방습 겸용 벤트", note: "분진 차단 멤브레인으로 막힘 방지" },
      { id: "AVENT", label: "개스킷 재질 상향", note: "고습 내구 실리콘 개스킷" },
    ],
    drawing: {
      extraVent: false, drain: true, lensHeater: false, doubleGasket: false,
      membraneBreather: false, dustMembrane: true, hydrophobicCoating: false,
      callouts: ["방진 멤브레인 벤트", "강화 개스킷", "하부 드레인"],
    },
  },
};

export interface CondensationDetail {
  anchor: {
    component: { id: string; label: string } | null;
    housing: { id: string; label: string } | null;
    failure: { id: string; label: string } | null;
  };
  region: RegionInfo;
  regObject: { id: string; label: string; props: [string, string][] } | null;
  relatedActions: { id: string; label: string }[]; // 온톨로지에 실재하는 조치
  evidence: string[]; // 근거 문서(실파일)
  drawing: DrawingSpec;
}

const lite = (id: string) => {
  const n = getNode(id);
  return n ? { id: n.id, label: n.label } : null;
};

/** 지역 하나에 대한 상세 — 온톨로지 백본과 결합해 반환. */
export function condensationDetail(region: RegionKey): CondensationDetail {
  const r = REGIONS[region];
  const reg = getObject(r.regId);
  // 온톨로지에 실재하는 조치만 연결(백본 AVENT 등)
  const relatedActions = r.actions
    .filter((a) => a.id && getNode(a.id))
    .map((a) => ({ id: a.id, label: getNode(a.id)!.label }));
  // 근거: 결로 고장모드/렌즈/원인에 연결된 실제 문서
  const ev = new Set<string>();
  for (const anchorId of [CONDENSATION_ANCHOR.failure, CONDENSATION_ANCHOR.component, CONDENSATION_ANCHOR.cause]) {
    for (const d of evidenceOf(anchorId)) ev.add(d.filename);
  }
  return {
    anchor: {
      component: lite(CONDENSATION_ANCHOR.component),
      housing: lite(CONDENSATION_ANCHOR.housing),
      failure: lite(CONDENSATION_ANCHOR.failure),
    },
    region: r,
    regObject: reg ? { id: reg.id, label: reg.label, props: reg.props ?? [] } : null,
    relatedActions,
    evidence: [...ev],
    drawing: r.drawing,
  };
}

export function allRegions(): { key: RegionKey; name: string; regName: string; riskLevel: string }[] {
  return (Object.keys(REGIONS) as RegionKey[]).map((k) => ({
    key: k, name: REGIONS[k].name, regName: REGIONS[k].regName, riskLevel: REGIONS[k].riskLevel,
  }));
}
