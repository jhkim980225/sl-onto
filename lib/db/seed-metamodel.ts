// lib/db/seed-metamodel.ts — 온톨로지 메타모델 시드(순수 데이터, 프레임워크 비의존).
// 지금까지 코드에 하드코딩돼 있던 타입·관계 정의를 DB(object_types/relation_types)로 승격한다.
// 출처: lib/types.ts(ObjType 유니언) · components/typeStyles.ts(색·glyph·존 라벨) · components/relLabels.ts(관계 라벨).
// 값은 원본과 1:1로 유지(색·라벨 변경 금지) — 부팅 시 비었을 때만 INSERT 된다.

export interface ObjectTypeSeed {
  type_id: string;
  label_ko: string;
  color: string;
  icon: string;
  description: string;
}

export interface RelationTypeSeed {
  rel_id: string;
  label_ko: string;
  description: string;
  src_types: string[];
  dst_types: string[];
  directed: boolean;
}

// typeStyles.ts TYPES(색·glyph) + TYPE_NAMES(한국어 존 라벨). description 은 존 라벨을 재사용.
export const OBJECT_TYPES: ObjectTypeSeed[] = [
  { type_id: "item", label_ko: "부품·구성", color: "#FFC46B", icon: "ITEM", description: "부품·구성" },
  { type_id: "fm", label_ko: "고장모드", color: "#FF5470", icon: "FM", description: "고장모드" },
  { type_id: "cause", label_ko: "원인", color: "#FF8A3D", icon: "CAUSE", description: "원인" },
  { type_id: "action", label_ko: "조치", color: "#5EDC9A", icon: "ACT", description: "조치" },
  { type_id: "reg", label_ko: "법규·인증", color: "#5EA8FF", icon: "REG", description: "법규·인증" },
  { type_id: "proj", label_ko: "프로젝트", color: "#B18CFF", icon: "PJ", description: "프로젝트" },
  { type_id: "master", label_ko: "마스터", color: "#4FE0D2", icon: "MSTR", description: "설계 표준·마스터" },
  { type_id: "spec", label_ko: "고객 스펙", color: "#93A8FF", icon: "SPEC", description: "고객 스펙" },
  { type_id: "doc", label_ko: "근거 문서", color: "#8291a8", icon: "DOC", description: "근거 문서" },
];

// relLabels.ts REL_KO 를 관계 정의로 이관. label_ko = 짧은 표시 라벨.
// SIMILAR 는 대칭 관계 → directed:false. 나머지는 방향성 있음.
// domain/range(src_types/dst_types) = 형식 온톨로지 1차에서 확정(스펙 2026-07-09 §A-1).
// 빈 배열 = 제약 없음(EVIDENCED_BY 는 전 타입 → doc). 위반은 차단이 아니라 품질 감사 경고.
export const RELATION_TYPES: RelationTypeSeed[] = [
  { rel_id: "HAS_FAILURE", label_ko: "고장", description: "부품 → 발생 가능 고장모드", src_types: ["item"], dst_types: ["fm"], directed: true },
  { rel_id: "CAUSED_BY", label_ko: "원인", description: "고장모드 → 원인", src_types: ["fm"], dst_types: ["cause"], directed: true },
  { rel_id: "MITIGATED_BY", label_ko: "조치", description: "고장모드/원인 → 조치", src_types: ["fm", "cause"], dst_types: ["action"], directed: true },
  { rel_id: "EVIDENCED_BY", label_ko: "근거", description: "객체 → 근거 문서(provenance)", src_types: [], dst_types: ["doc"], directed: true },
  { rel_id: "REF_MASTER", label_ko: "표준 참조", description: "설계 표준·마스터 참조", src_types: ["item", "proj", "action"], dst_types: ["master"], directed: true },
  { rel_id: "UNDER_REG", label_ko: "법규", description: "적용 법규·인증", src_types: ["item", "proj"], dst_types: ["reg"], directed: true },
  { rel_id: "DRL_REG", label_ko: "법규", description: "DRL 배광 법규", src_types: ["item", "proj"], dst_types: ["reg"], directed: true },
  { rel_id: "CONSISTS_OF", label_ko: "구성", description: "어셈블리 → 구성 부품", src_types: ["item"], dst_types: ["item"], directed: true },
  { rel_id: "OCCURRED_IN", label_ko: "발생", description: "고장 발생 프로젝트 이력", src_types: ["fm"], dst_types: ["proj"], directed: true },
  { rel_id: "SIMILAR", label_ko: "유사", description: "유사 프로젝트/부품(대칭)", src_types: ["item", "proj"], dst_types: ["item", "proj"], directed: false },
  { rel_id: "THERMAL_RISK", label_ko: "열 리스크", description: "열 리스크 연관", src_types: ["item", "cause"], dst_types: ["fm", "item"], directed: true },
  { rel_id: "SPEC_OF", label_ko: "고객 스펙", description: "고객 스펙 → 적용 프로젝트", src_types: ["spec"], dst_types: ["proj", "item"], directed: true },
  { rel_id: "NEW_DESIGN_OF", label_ko: "신규 설계", description: "신규 설계 연관", src_types: ["proj", "item"], dst_types: ["item", "proj"], directed: true },
  { rel_id: "TARGET_MARKET", label_ko: "타깃 시장", description: "타깃 시장 연관", src_types: ["proj"], dst_types: ["reg"], directed: true },
];

/* ── 서브타입(단층 분류) — 형식 온톨로지 1차. keywords = classify.ts 자동 분류 매칭용(소문자·NFC 비교). ── */
export interface SubtypeSeed {
  type_id: string;
  st_id: string;
  label_ko: string;
  keywords: string[];
  description?: string;
}

export const OBJECT_SUBTYPES: SubtypeSeed[] = [
  // item — 램프 구성 요소 대분류
  { type_id: "item", st_id: "light-source", label_ko: "광원", keywords: ["led", "벌브", "레이저", "광원", "halogen", "할로겐"] },
  { type_id: "item", st_id: "optics", label_ko: "광학", keywords: ["렌즈", "리플렉터", "이너렌즈", "아우터렌즈", "라이트가이드", "프로젝션", "reflector", "lens", "쉴드", "확산"] },
  { type_id: "item", st_id: "housing", label_ko: "하우징·기구", keywords: ["하우징", "브라켓", "베젤", "씰", "벤트", "가스켓", "커버", "housing", "bracket", "vent", "실링", "개스킷", "데코", "스크류"] },
  { type_id: "item", st_id: "electric", label_ko: "전장", keywords: ["드라이버", "pcb", "커넥터", "와이어", "하네스", "모터", "ecu", "기판", "connector"] },
  { type_id: "item", st_id: "assembly", label_ko: "모듈·어셈블리", keywords: ["어셈블리", "모듈", "assy", "램프", "헤드램프", "리어램프", "drl", "안개등"] },
  { type_id: "item", st_id: "thermal-mgmt", label_ko: "방열·열관리", keywords: ["히트싱크", "방열", "heatsink", "그리스"] },
  // fm — 고장모드 계열
  { type_id: "fm", st_id: "optical", label_ko: "광학계 고장", keywords: ["광도", "배광", "눈부심", "색", "점등", "조도", "글레어", "광량", "휘도", "광축", "백화"] },
  { type_id: "fm", st_id: "thermal", label_ko: "열계 고장", keywords: ["과열", "변형", "수축", "크랙", "황변", "열"] },
  { type_id: "fm", st_id: "environment", label_ko: "환경계 고장", keywords: ["결로", "습기", "부식", "침수", "먼지", "수분", "방수", "이물"] },
  { type_id: "fm", st_id: "electrical", label_ko: "전장계 고장", keywords: ["단선", "쇼트", "플리커", "오작동", "접촉불량", "단락", "통전", "점멸", "사멸"] },
  { type_id: "fm", st_id: "mechanical", label_ko: "기구계 고장", keywords: ["진동", "소음", "이탈", "파손", "유격", "떨림", "파단", "박리", "간극", "단차", "스크래치", "융착"] },
  // cause — 원인 계열
  { type_id: "cause", st_id: "design", label_ko: "설계 원인", keywords: ["공차", "형상", "설계", "간섭", "구조", "브리더", "히팅"] },
  { type_id: "cause", st_id: "material", label_ko: "재료 원인", keywords: ["재질", "열화", "수지", "소재", "물성"] },
  { type_id: "cause", st_id: "process", label_ko: "공정 원인", keywords: ["성형", "조립", "용접", "사출", "공정", "금형", "게이트", "융착", "도금", "코팅", "접촉"] },
  { type_id: "cause", st_id: "environment", label_ko: "환경 원인", keywords: ["온도", "습도", "진동", "염수", "자외선", "외기", "응결", "산화", "열충격", "고습", "막힘"] },
  // action — 조치 계열
  { type_id: "action", st_id: "design-change", label_ko: "설계 변경", keywords: ["설계 변경", "형상 변경", "공차", "구조 변경", "설계변경", "벤트", "용량", "배치", "재설계", "보강", "리브", "멤브레인", "실링", "히팅"] },
  { type_id: "action", st_id: "material-change", label_ko: "재질 변경", keywords: ["재질 변경", "소재", "재질변경", "코팅", "안정제", "방청"] },
  { type_id: "action", st_id: "verification", label_ko: "검증 시험", keywords: ["시험", "테스트", "검증", "평가", "측정", "시뮬레이션"] },
  { type_id: "action", st_id: "process-improve", label_ko: "공정 개선", keywords: ["공정", "조립성", "작업", "관리", "금형", "게이트", "사출", "융착", "접착", "조건", "냉각 회로"] },
  // reg — 관할 지역
  { type_id: "reg", st_id: "na", label_ko: "북미 법규", keywords: ["fmvss", "sae", "dot", "북미"] },
  { type_id: "reg", st_id: "eu", label_ko: "유럽 법규", keywords: ["ece", "unece", "r48", "r112", "유럽"] },
  { type_id: "reg", st_id: "etc", label_ko: "기타 법규", keywords: ["kmvss", "gb", "adr"] },
  // proj/master/spec/doc — 1차 분류 없음
];

/* ── 타입별 표준 속성 정의 — 노드 props 는 자유 배열 유지, 정의된 key 만 datatype 검증 대상.
 * required 는 전부 false 시작(실무 문서 필드 채움율 확인 전 위반 폭주 방지 — 스펙 §A-3). ── */
export interface PropertyDefSeed {
  type_id: string;
  key: string;
  label_ko: string;
  datatype: "text" | "number" | "enum";
  options?: string[];
  required?: boolean;
}

export const PROPERTY_DEFS: PropertyDefSeed[] = [
  { type_id: "item", key: "재질", label_ko: "재질", datatype: "text" },
  { type_id: "item", key: "수량", label_ko: "수량", datatype: "number" },
  { type_id: "reg", key: "지역", label_ko: "관할 지역", datatype: "enum", options: ["북미", "유럽", "한국", "글로벌"] },
  { type_id: "fm", key: "심각도", label_ko: "심각도", datatype: "number" },
];

/** 메타모델 스냅샷 — store 캐시·검증기·내보내기 공용 형태. */
export interface Metamodel {
  objectTypes: ObjectTypeSeed[];
  relationTypes: RelationTypeSeed[];
  subtypes: SubtypeSeed[];
  propertyDefs: PropertyDefSeed[];
}
