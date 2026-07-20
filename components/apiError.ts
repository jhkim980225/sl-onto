// 실패 응답 → 사용자에게 보여줄 한국어 사유. CanvasPanel/SchemaPanel/DocumentPanel 에
// 같은 함수가 세 벌 복사돼 있던 것을 한 곳으로 모았다.
// 라우트마다 shape 이 조금씩 다르다: {error} / {ok:false,error} / {error,issues} / {error,capability}.
// 공통분모는 error 하나뿐이라 그것만 읽고, 400 invalid input 은 어떤 필드가 문제인지만 덧붙인다.
interface ErrorBody {
  error?: string;
  needsSchema?: boolean;
  issues?: { fieldErrors?: Record<string, string[] | undefined> };
}

/** 실패 응답에서 사용자에게 보여줄 한국어 사유를 꺼낸다(JSON 이 아니어도 깨지지 않는다). */
export async function reasonOf(r: Response, fallback: string): Promise<string> {
  const b = (await r.json().catch(() => null)) as ErrorBody | null;
  // 409 needsSchema = 빈 스키마 캔버스 — 무엇을 먼저 해야 하는지로 바꿔 안내한다.
  if (b?.needsSchema) return "◈ 스키마에서 객체타입을 먼저 정의하세요.";
  if (!b?.error) return fallback;
  const fields = Object.keys(b.issues?.fieldErrors ?? {});
  return fields.length ? `${b.error} (${fields.join(", ")})` : b.error;
}
