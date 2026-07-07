// lib/ingest/sample.ts — 증분 인제스천 데모용 번들 샘플 FMEA 검토시트(SheetJS 인메모리 생성).
// 내용은 결정론적(랜덤/Date 미사용) — 같은 라벨은 항상 같은 AUTO id 로 해석되어 재병합 시 빈 델타가 된다.
// 각 샘플은 (1) 통제 어휘/기존 온톨로지에 없는 신규 엔티티 5개 이상(auto-create 시연)과
// (2) 기존 엔티티(아우터 렌즈 ILENS · 벤트·씰링 설계 CVENT · 방열 리브 추가 ARIB 등)로의
// 링크 2개 이상(entity resolution 시연)을 함께 담는다.
import * as XLSX from "xlsx";

export interface SampleSpec {
  fileName: string;
  rows: Record<string, string>[]; // 헤더 = FMEA 정형 분기(부품/고장모드/원인/…)가 기대하는 컬럼명
}

// 샘플 1 — 신규 입고 안개등 램프.
// 신규: 크레이징, 내한성 부족, 렌즈 재질 변경(PMMA 내한 그레이드), 세정제 화학 침식,
//       내화학 코팅 적용, 안개등 인너 렌즈, 씰링 립 형상 변경, PJ 2027-FL02  (8개)
// 기존 링크: 부품 "아우터 렌즈"(ILENS), 고장모드 "결로·습기"(FMFOG), 원인 "벤트·씰링 설계"(CVENT)
const SAMPLE_FOG: SampleSpec = {
  fileName: "FMEA_신규입고_안개등램프_검토시트.xlsx",
  rows: [
    {
      부품: "아우터 렌즈",
      고장모드: "크레이징",
      원인: "내한성 부족",
      영향: "렌즈 표면 미세균열·외관 불량",
      심각도S: "6",
      발생도O: "4",
      검출도D: "5",
      RPN: "120",
      현행조치: "렌즈 재질 변경(PMMA 내한 그레이드)",
      발생프로젝트: "PJ 2027-FL02",
    },
    {
      부품: "아우터 렌즈",
      고장모드: "크레이징",
      원인: "세정제 화학 침식",
      영향: "크랙 진전·투과율 저하",
      심각도S: "6",
      발생도O: "3",
      검출도D: "6",
      RPN: "108",
      현행조치: "내화학 코팅 적용",
      발생프로젝트: "PJ 2027-FL02",
    },
    {
      부품: "안개등 인너 렌즈",
      고장모드: "결로·습기",
      원인: "벤트·씰링 설계",
      영향: "점등 시 물맺힘 얼룩",
      심각도S: "5",
      발생도O: "4",
      검출도D: "4",
      RPN: "80",
      현행조치: "씰링 립 형상 변경",
      발생프로젝트: "PJ 2027-FL02",
    },
  ],
};

// 샘플 2 — 신규 입고 리어 시그널 램프.
// 신규: 플로우 마크, 사출 수지 온도 과다, 게이트 밸런스 최적화, 리어 시그널 모듈,
//       점멸 응답 지연, 드라이버 IC 서멀 셧다운, PJ 2027-RL05  (7개)
// 기존 링크: "아우터 렌즈"(ILENS), "방열 리브 추가"(ARIB), "수축 변형"(FMSHRINK),
//            "소재 수축 과다"(CSHRINK), "저수축 소재 변경"(AMAT)
const SAMPLE_REAR: SampleSpec = {
  fileName: "FMEA_신규입고_리어시그널램프_검토시트.xlsx",
  rows: [
    {
      부품: "아우터 렌즈",
      고장모드: "플로우 마크",
      원인: "사출 수지 온도 과다",
      영향: "외관 줄무늬 불량",
      심각도S: "5",
      발생도O: "4",
      검출도D: "4",
      RPN: "80",
      현행조치: "게이트 밸런스 최적화",
      발생프로젝트: "PJ 2027-RL05",
    },
    {
      부품: "리어 시그널 모듈",
      고장모드: "점멸 응답 지연",
      원인: "드라이버 IC 서멀 셧다운",
      영향: "시인성 저하·법규 부적합 우려",
      심각도S: "7",
      발생도O: "3",
      검출도D: "5",
      RPN: "105",
      현행조치: "방열 리브 추가",
      발생프로젝트: "PJ 2027-RL05",
    },
    {
      부품: "리어 시그널 모듈",
      고장모드: "수축 변형",
      원인: "소재 수축 과다",
      영향: "조립 간섭·간극 불량",
      심각도S: "5",
      발생도O: "3",
      검출도D: "4",
      RPN: "60",
      현행조치: "저수축 소재 변경",
      발생프로젝트: "PJ 2027-RL05",
    },
  ],
};

/** 데모 샘플 목록(순서 = 사용 순서). route 는 doc 노드가 아직 없는 첫 샘플을 고른다. */
export const SAMPLES: SampleSpec[] = [SAMPLE_FOG, SAMPLE_REAR];

/** 샘플 스펙 → xlsx 바이너리(Buffer). 시트명 "FMEA" — 정형 FMEA 분기가 그대로 파싱한다. */
export function buildSampleXlsx(spec: SampleSpec): Buffer {
  const ws = XLSX.utils.json_to_sheet(spec.rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "FMEA");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
