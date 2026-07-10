// lib/fold.ts — 라벨 표기 접기(fold) 공용 유틸. lib/quality.ts(중복 후보)와
// lib/ingest/llm-assist.ts(LLM 관계 라벨 매칭)가 같은 접기 규칙을 공유한다.

/** 공백·가운뎃점·기호를 접어 비교하는 폴드 키 — 대소문자·띄어쓰기 차이만 있는 표기 변형을 잡는다. */
export const foldKey = (s: string) =>
  (s ?? "").normalize("NFC").trim().toLowerCase().replace(/[\s·\-_/()]/g, "");

/** FNV-1a 32bit → 8자리 hex — 순수·결정론적(플랫폼 무관, 랜덤/시각 미사용, 의존성 없음).
 * 캐시 키(review-opinion·ask)와 AUTO_ id(ingest/normalize)가 공유 — 출력 바이트 호환 유지 필수. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
