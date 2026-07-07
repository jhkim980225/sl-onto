// 관계명 한글화 — 내부 온톨로지 관계명(CAUSED_BY 등)은 데이터에 그대로 두고,
// 사용자 화면 표시만 업무 언어로 치환한다. 인스펙터·범례·체크리스트 trace가 공유.
import type { Rel } from "@/lib/types";

/** 관계명 → 짧은 표시 라벨 (trace 화살표·브레드크럼 경유 표기용). */
const REL_KO: Record<string, string> = {
  HAS_FAILURE: "고장",
  CAUSED_BY: "원인",
  MITIGATED_BY: "조치",
  EVIDENCED_BY: "근거",
  REF_MASTER: "표준 참조",
  UNDER_REG: "법규",
  DRL_REG: "법규",
  CONSISTS_OF: "구성",
  OCCURRED_IN: "발생",
  SIMILAR: "유사",
  THERMAL_RISK: "열 리스크",
  SPEC_OF: "고객 스펙",
  NEW_DESIGN_OF: "신규 설계",
  TARGET_MARKET: "타깃 시장",
};

/** 짧은 한글 관계 라벨. 미등록 관계는 원문 유지. */
export function relKo(rel: string): string {
  const r = rel.toUpperCase();
  if (r.startsWith("SIMILAR")) return REL_KO.SIMILAR;
  return REL_KO[r] ?? rel;
}

/** 인스펙터 그룹 — 관계를 방향까지 반영해 업무 언어 묶음으로 번역한다. */
export interface RelGroup {
  title: string;
  rels: Rel[];
}

// (관계, 방향) → 그룹 제목. 방향에 따라 의미가 반대가 된다
// (예: item —HAS_FAILURE→ fm 이므로 fm 쪽에서 보면 in = 대상 품목).
function groupTitle(rel: string, dir: "in" | "out"): string | null {
  const r = rel.toUpperCase();
  if (r === "EVIDENCED_BY") return null; // 근거 문서 섹션에서 별도 표시
  if (r.startsWith("SIMILAR")) return "유사 프로젝트";
  switch (`${r}|${dir}`) {
    case "HAS_FAILURE|out": return "발생 가능한 고장";
    case "HAS_FAILURE|in": return "대상 품목";
    case "CAUSED_BY|out": return "주요 원인";
    case "CAUSED_BY|in": return "유발하는 고장";
    case "MITIGATED_BY|out": return "추천 조치";
    case "MITIGATED_BY|in": return "개선 대상";
    case "REF_MASTER|out": return "참조 표준·마스터";
    case "REF_MASTER|in": return "참조하는 항목";
    case "UNDER_REG|out":
    case "DRL_REG|out": return "적용 법규";
    case "UNDER_REG|in":
    case "DRL_REG|in": return "규제 대상";
    case "CONSISTS_OF|out": return "구성 부품";
    case "CONSISTS_OF|in": return "상위 구성";
    case "OCCURRED_IN|out": return "발생 이력(고장)";
    case "OCCURRED_IN|in": return "발생 프로젝트";
    case "THERMAL_RISK|out":
    case "THERMAL_RISK|in": return "열 리스크 연관";
    case "SPEC_OF|out": return "고객 스펙";
    case "SPEC_OF|in": return "적용 프로젝트";
    case "NEW_DESIGN_OF|out":
    case "NEW_DESIGN_OF|in":
    case "TARGET_MARKET|out":
    case "TARGET_MARKET|in": return "신규 설계 연관";
    default: return "관련 항목";
  }
}

/** FMEA 요약 카드 그룹 순서 — 사용자가 읽는 순서(품목 → 고장 → 원인 → 조치 → 참조). */
const GROUP_ORDER = [
  "대상 품목",
  "발생 가능한 고장",
  "주요 원인",
  "유발하는 고장",
  "추천 조치",
  "개선 대상",
  "구성 부품",
  "상위 구성",
  "적용 법규",
  "규제 대상",
  "참조 표준·마스터",
  "참조하는 항목",
  "발생 프로젝트",
  "발생 이력(고장)",
  "유사 프로젝트",
  "고객 스펙",
  "적용 프로젝트",
  "신규 설계 연관",
  "열 리스크 연관",
  "관련 항목",
];

/** 관계 목록 → 표시 순서가 정해진 그룹 배열. EVIDENCED_BY 는 제외된다. */
export function groupRelations(rels: Rel[]): RelGroup[] {
  const map = new Map<string, Rel[]>();
  for (const r of rels) {
    const title = groupTitle(r.rel, r.dir);
    if (!title) continue;
    const arr = map.get(title);
    if (arr) arr.push(r);
    else map.set(title, [r]);
  }
  const groups: RelGroup[] = [];
  for (const title of GROUP_ORDER) {
    const arr = map.get(title);
    if (arr) {
      groups.push({ title, rels: arr });
      map.delete(title);
    }
  }
  for (const [title, arr] of map) groups.push({ title, rels: arr }); // 안전망(미등록 그룹)
  return groups;
}
