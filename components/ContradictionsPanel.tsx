"use client";

// 우측 패널 · 전역 모순 스캔 — 질문 없이도 상시 노출되는 근거 기반 모순 목록.
// 판정은 GET /api/contradictions(lib/contradictions.ts)에서 온다 — 이 컴포넌트는 렌더만 한다.
// trace/근거 렌더는 Checklist.tsx 와 동일한 nodeIndex 헬퍼(buildChains/parseHop/relKo)를 재사용한다.
import type { Contradiction } from "@/lib/types";
import { buildChains, findIdByText, labelOf, parseHop, type NodeIndex } from "./nodeIndex";
import { relKo } from "./relLabels";

interface ContradictionsPanelProps {
  loading: boolean;
  error: string | null;
  items: Contradiction[];
  nodeIndex: NodeIndex;
  onSelectObject: (id: string) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<Contradiction["kind"], string> = {
  "record-gap": "기록 괴리",
  "market-env": "등급-환경 모순",
  "master-missing": "마스터 미참조",
};

export default function ContradictionsPanel({
  loading,
  error,
  items,
  nodeIndex,
  onSelectObject,
  onClose,
}: ContradictionsPanelProps) {
  return (
    <>
      <div className="cond-head">
        <span className="sec-label" style={{ margin: 0 }}>
          전역 모순 스캔
        </span>
        <span className="cond-back" onClick={onClose}>
          ← 인스펙터로
        </span>
      </div>

      {loading && <div className="insp-empty">온톨로지를 스캔하는 중…</div>}
      {error && (
        <div className="insp-empty">
          모순 스캔에 실패했습니다.
          <br />
          <span className="k">{error}</span>
        </div>
      )}
      {!loading && !error && items.length === 0 && <div className="insp-empty">발견된 모순이 없습니다.</div>}

      {!loading &&
        !error &&
        items.map((it, i) => {
          const chains = buildChains(it.trace.map(parseHop));
          return (
            <div className="chk show" key={i}>
              <span className="no" style={{ color: "#b3453c" }}>
                {KIND_LABEL[it.kind]}
              </span>
              <h3>{it.title}</h3>
              <p>{it.detail}</p>
              <div className="cf">
                <div className="bar">
                  <i style={{ width: `${it.confidence}%`, background: "linear-gradient(90deg,#e8a33d,#b3453c)" }} />
                </div>
                <span className="cv" style={{ color: "#b3453c" }}>
                  {it.confidence}%
                </span>
              </div>

              {it.projects.length > 0 && (
                <div className="evs">
                  {it.projects.map((p, j) => {
                    const id = findIdByText(nodeIndex, p);
                    return (
                      <span
                        key={j}
                        className={"evc" + (id ? " clickable" : "")}
                        onClick={id ? () => onSelectObject(id) : undefined}
                      >
                        {p}
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="sec-label">근거</div>
              <div className="evs">
                {it.evidence.map((e, j) => {
                  const id = findIdByText(nodeIndex, e);
                  return (
                    <span
                      key={j}
                      className={"evc" + (id ? " clickable" : "")}
                      onClick={id ? () => onSelectObject(id) : undefined}
                    >
                      {e}
                    </span>
                  );
                })}
              </div>

              {chains.length > 0 && (
                <>
                  <div className="sec-label">근거 경로</div>
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
              )}
            </div>
          );
        })}
    </>
  );
}

function TraceNode({
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
