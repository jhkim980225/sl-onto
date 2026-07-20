// lib/canvas-context.ts — 요청별 "현재 캔버스" 컨텍스트.
// store 공개 시그니처를 바꾸지 않고 캔버스를 전파하기 위한 장치(호출부 276곳 무변경).
// 라우트 진입점에서 withCanvas() 로 한 번 깔면 그 아래 모든 동기·비동기 호출이 같은 캔버스를 본다.
// 설계: docs/superpowers/specs/2026-07-20-multi-canvas-design.md §4
import { AsyncLocalStorage } from "node:async_hooks";

/** 부트스트랩 캔버스 id. 기존(램프 FMEA) 데이터가 귀속되는 곳. */
export const DEFAULT_CANVAS = "default";

const ALS = new AsyncLocalStorage<string>();

/** fn 실행 동안 현재 캔버스를 id 로 고정한다. 중첩 가능(안쪽이 이김). */
export function withCanvas<T>(id: string, fn: () => T): T {
  return ALS.run(id, fn);
}

/** 현재 캔버스 id. 컨텍스트 밖이면 기본 캔버스로 폴백한다.
 * 폴백은 테스트·모듈로드 경로를 위한 것이며, 라우트에서 일어나면 버그다 — 개발 모드에서 경고한다. */
export function currentCanvas(): string {
  const id = ALS.getStore();
  if (id) return id;
  if (process.env.NODE_ENV === "development") {
    console.warn("[canvas] 컨텍스트 밖에서 캔버스 조회 — 기본 캔버스로 폴백\n" + new Error().stack);
  }
  return DEFAULT_CANVAS;
}
