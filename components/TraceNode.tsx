"use client";

// 공용 trace 렌더 — Checklist·ContradictionsPanel·ReasonPanel에 바이트 동일하게 복붙돼 있던
// TraceNode 함수와 trace-chain 블록을 추출(마크업·클래스명 불변).
// Inspector.tsx의 TraceChip(로컬 라벨 캐시 변종)은 별개 — 여기로 합치지 않는다.
import { labelOf, type Hop, type NodeIndex } from "./nodeIndex";
import { relKo } from "./relLabels";

export default function TraceNode({
  id,
  nodeIndex,
  onSelectObject,
}: {
  id: string;
  nodeIndex: NodeIndex;
  onSelectObject: (id: string) => void;
}) {
  const known = nodeIndex.has(id);
  return (
    <span
      className={"trace-node" + (known ? "" : " self")}
      onClick={
        known
          ? (ev) => {
              ev.stopPropagation();
              onSelectObject(id);
            }
          : undefined
      }
    >
      {labelOf(nodeIndex, id)}
    </span>
  );
}

/** buildChains() 결과를 trace-chain div들로 렌더 — 섹션 라벨(근거 경로 등)은 호출부 소유. */
export function TraceChain({
  chains,
  nodeIndex,
  onSelectObject,
}: {
  chains: Hop[][];
  nodeIndex: NodeIndex;
  onSelectObject: (id: string) => void;
}) {
  return (
    <>
      {chains.map((chain, ci) => (
        <div className="trace-chain" key={ci}>
          <TraceNode id={chain[0].a} nodeIndex={nodeIndex} onSelectObject={onSelectObject} />
          {chain.map((hop, hi) => (
            <span key={hi} style={{ display: "contents" }}>
              <span className="trace-rel">—{hop.rel ? relKo(hop.rel) : "→"}→</span>
              <TraceNode id={hop.b} nodeIndex={nodeIndex} onSelectObject={onSelectObject} />
            </span>
          ))}
        </div>
      ))}
    </>
  );
}
