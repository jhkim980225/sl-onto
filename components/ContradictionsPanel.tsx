"use client";

// 우측 패널 · 전역 모순 스캔 — 질문 없이도 상시 노출되는 근거 기반 모순 목록.
// 판정은 GET /api/contradictions(lib/contradictions.ts)에서 온다 — 이 컴포넌트는 렌더만 한다.
// trace/근거 렌더는 Checklist.tsx 와 동일한 nodeIndex 헬퍼(buildChains/parseHop/relKo)를 재사용한다.
import type { Contradiction } from "@/lib/types";
import { buildChains, findIdByText, parseHop, type NodeIndex } from "./nodeIndex";
import ConfidenceBar from "./ConfidenceBar";
import PanelHeader from "./PanelHeader";
import { TraceChain } from "./TraceNode";

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
      <PanelHeader title="전역 모순 스캔" onClose={onClose} />

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
              <ConfidenceBar pct={it.confidence} barBg="linear-gradient(90deg,#e8a33d,#b3453c)" color="#b3453c" />

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
                  <TraceChain chains={chains} nodeIndex={nodeIndex} onSelectObject={onSelectObject} />
                </>
              )}
            </div>
          );
        })}
    </>
  );
}
