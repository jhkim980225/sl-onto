// lib/pyservice.ts — Python 사이드카 공용 HTTP 클라이언트. llm/embed/parse/reason 이 공유한다.
// 골든 룰: pyservice 가 죽거나 느려도 절대 throw 하지 않는다 — 실패는 null + console.warn, 호출부가 폴백 결정.

/** PYSERVICE_URL 게이트 — 사이드카 태스크(llm/embed/parse/reason) 공통. */
export function pyEnabled(): boolean {
  return !!process.env.PYSERVICE_URL;
}

function base(): string {
  return (process.env.PYSERVICE_URL || "").replace(/\/$/, "");
}

/** POST {PYSERVICE_URL}{path}. 비활성·HTTP 오류·네트워크 오류·타임아웃이면 null(+warn(tag)). throw 금지. */
export async function pyPost<T>(path: string, body: unknown, timeoutMs: number, tag: string): Promise<T | null> {
  if (!pyEnabled()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[pyservice] ${res.status} — ${tag}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`[pyservice] unavailable (${tag}): ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
