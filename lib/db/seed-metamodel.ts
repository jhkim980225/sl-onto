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
// domain/range(src_types/dst_types)는 기존 코드에서 확정할 수 없으므로 빈 배열(제약 없음, 스펙 §①).
// ponytail: 타입 제약이 필요해지면 그때 src_types/dst_types 채운다(1차는 경고 로그만).
export const RELATION_TYPES: RelationTypeSeed[] = [
  { rel_id: "HAS_FAILURE", label_ko: "고장", description: "부품 → 발생 가능 고장모드", src_types: [], dst_types: [], directed: true },
  { rel_id: "CAUSED_BY", label_ko: "원인", description: "고장모드 → 원인", src_types: [], dst_types: [], directed: true },
  { rel_id: "MITIGATED_BY", label_ko: "조치", description: "고장모드/원인 → 조치", src_types: [], dst_types: [], directed: true },
  { rel_id: "EVIDENCED_BY", label_ko: "근거", description: "객체 → 근거 문서(provenance)", src_types: [], dst_types: [], directed: true },
  { rel_id: "REF_MASTER", label_ko: "표준 참조", description: "설계 표준·마스터 참조", src_types: [], dst_types: [], directed: true },
  { rel_id: "UNDER_REG", label_ko: "법규", description: "적용 법규·인증", src_types: [], dst_types: [], directed: true },
  { rel_id: "DRL_REG", label_ko: "법규", description: "DRL 배광 법규", src_types: [], dst_types: [], directed: true },
  { rel_id: "CONSISTS_OF", label_ko: "구성", description: "어셈블리 → 구성 부품", src_types: [], dst_types: [], directed: true },
  { rel_id: "OCCURRED_IN", label_ko: "발생", description: "고장 발생 프로젝트 이력", src_types: [], dst_types: [], directed: true },
  { rel_id: "SIMILAR", label_ko: "유사", description: "유사 프로젝트/부품(대칭)", src_types: [], dst_types: [], directed: false },
  { rel_id: "THERMAL_RISK", label_ko: "열 리스크", description: "열 리스크 연관", src_types: [], dst_types: [], directed: true },
  { rel_id: "SPEC_OF", label_ko: "고객 스펙", description: "고객 스펙 → 적용 프로젝트", src_types: [], dst_types: [], directed: true },
  { rel_id: "NEW_DESIGN_OF", label_ko: "신규 설계", description: "신규 설계 연관", src_types: [], dst_types: [], directed: true },
  { rel_id: "TARGET_MARKET", label_ko: "타깃 시장", description: "타깃 시장 연관", src_types: [], dst_types: [], directed: true },
];
