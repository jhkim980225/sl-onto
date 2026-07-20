// lib/graph-memo.ts — 전역 그래프 스캔 결과를 그래프 크기 키로 메모이즈 (reason·contradictions·quality 공용).
// ponytail: 노드·엣지 수가 같은데 내용만 바뀌는 경우(라벨 수정 등)는 못 잡는다 —
// 증분 병합은 항상 수를 늘리므로 데모 규모에선 충분. 정확 무효화가 필요해지면 store에 리비전 카운터.
import { allNodes, allEdges } from "./store";
import { currentCanvas } from "./canvas-context";

/** compute(동기/비동기)를 캔버스별 `${nodes}|${edges}` 키로 캐시. compute 가 throw 하면 캐시는 갱신되지 않는다.
 * 캔버스별 엔트리를 따로 두는 이유: 단일 슬롯이면 캔버스를 오갈 때마다 서로를 축출해 매번 재계산한다. */
export function memoizeByGraphSize<T>(compute: () => T | Promise<T>): () => Promise<T> {
  const perCanvas = new Map<string, { key: string; value: T }>();
  return async () => {
    const canvas = currentCanvas();
    const key = `${allNodes().length}|${allEdges().length}`;
    const hit = perCanvas.get(canvas);
    if (!hit || hit.key !== key) {
      const value = await compute();
      perCanvas.set(canvas, { key, value });
      return value;
    }
    return hit.value;
  };
}
