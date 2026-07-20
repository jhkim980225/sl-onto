// lib/api-client.ts — 클라이언트 전용. 모든 API 호출에 현재 캔버스를 붙인다.
// 컴포넌트가 fetch 를 직접 부르면 캔버스가 빠져 400 이 난다 — 반드시 이 헬퍼를 쓴다.
let CURRENT = "default";

export function setApiCanvas(id: string): void { CURRENT = id; }
export function getApiCanvas(): string { return CURRENT; }

/** 캔버스 파라미터가 붙은 URL. 이미 canvas 가 있으면 유지한다. */
export function withCanvasUrl(path: string): string {
  const u = new URL(path, typeof window === "undefined" ? "http://localhost" : window.location.origin);
  if (!u.searchParams.has("canvas")) u.searchParams.set("canvas", CURRENT);
  return u.pathname + u.search;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(withCanvasUrl(path), init);
}
