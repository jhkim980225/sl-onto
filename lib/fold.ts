// lib/fold.ts — 라벨 표기 접기(fold) 공용 유틸. lib/quality.ts(중복 후보)와
// lib/ingest/llm-assist.ts(LLM 관계 라벨 매칭)가 같은 접기 규칙을 공유한다.

/** 공백·가운뎃점·기호를 접어 비교하는 폴드 키 — 대소문자·띄어쓰기 차이만 있는 표기 변형을 잡는다. */
export const foldKey = (s: string) =>
  (s ?? "").normalize("NFC").trim().toLowerCase().replace(/[\s·\-_/()]/g, "");
