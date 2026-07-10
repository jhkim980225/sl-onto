"use client";

// 우측 패널 · 유도 관계(pyservice /reason) — "온톨로지가 스스로 유도한 관계"를 조회 전용으로 노출.
// 골든 룰: 원본 보존 — 이 목록은 DB/store에 병합되지 않는다(검토용 오버레이). confidence 항상 노출.
// ContradictionsPanel을 복제·간소화 — trace 렌더는 동일한 nodeIndex 헬퍼(buildChains/parseHop/relKo)를 재사용.
import type { DerivedEdge, DerivedRule } from "@/lib/reason";
import { buildChains, parseHop, type NodeIndex } from "./nodeIndex";
import { relKo } from "./relLabels";
import ConfidenceBar from "./ConfidenceBar";
import PanelHeader from "./PanelHeader";
import TraceNode, { TraceChain } from "./TraceNode";

interface ReasonPanelProps {
  loading: boolean;
  error: string | null;
  items: DerivedEdge[];
  nodeIndex: NodeIndex;
  onSelectObject: (id: string) => void;
  onClose: () => void;
}

const RULE_LABEL: Record<DerivedRule, string> = {
  "consists-transitive": "전이 구성",
  "similar-symmetric": "유사 대칭",
  "failure-propagation": "고장 전파",
};

export default function ReasonPanel({ loading, error, items, nodeIndex, onSelectObject, onClose }: ReasonPanelProps) {
  return (
    <>
      <PanelHeader title="유도 관계" onClose={onClose} />

      {loading && <div className="insp-empty">온톨로지에서 관계를 유도하는 중…</div>}
      {error && (
        <div className="insp-empty">
          유도 관계 조회에 실패했습니다.
          <br />
          <span className="k">{error}</span>
        </div>
      )}
      {!loading && !error && items.length === 0 && <div className="insp-empty">유도된 관계가 없습니다.</div>}

      {!loading &&
        !error &&
        items.map((it, i) => {
          const chains = buildChains(it.via.map(parseHop));
          const pct = Math.round(it.confidence * 100);
          return (
            <div className="chk show" key={i}>
              <span className="no" style={{ color: "#00a2e5" }}>
                {RULE_LABEL[it.rule] ?? it.rule}
              </span>
              <h3>
                <TraceNode id={it.src} nodeIndex={nodeIndex} onSelectObject={onSelectObject} />
                {" —"}
                {relKo(it.rel)}
                {"→ "}
                <TraceNode id={it.dst} nodeIndex={nodeIndex} onSelectObject={onSelectObject} />
              </h3>
              <ConfidenceBar pct={pct} barBg="linear-gradient(90deg,#7fc9ea,#00a2e5)" color="#00a2e5" />

              {chains.length > 0 && (
                <>
                  <div className="sec-label">유도 근거(원본 엣지)</div>
                  <TraceChain chains={chains} nodeIndex={nodeIndex} onSelectObject={onSelectObject} />
                </>
              )}
            </div>
          );
        })}
    </>
  );
}
