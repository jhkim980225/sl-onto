"use client";

// 우측 패널 · 온톨로지 품질 스캔 — 자동 생성(AUTO_*) 잡음·고립 노드·근거 누락을 찾아만 준다.
// 판정은 GET /api/quality(lib/quality.ts)에서 온다 — 이 컴포넌트는 렌더 + 액션 위임만 한다.
// 실행(병합/삭제)은 직접 fetch 하지 않고 Workbench 가 넘겨준 콜백(기존 curate 경유)을 호출한다.
// ContradictionsPanel 과 같은 배지→패널→그래프 포커스 관례를 따른다(구조 복제·간소화).
import type { QualityIssue } from "@/lib/quality";
import { labelOf, type NodeIndex } from "./nodeIndex";
import ConfidenceBar from "./ConfidenceBar";
import PanelHeader from "./PanelHeader";

interface QualityPanelProps {
  loading: boolean;
  error: string | null;
  items: QualityIssue[];
  nodeIndex: NodeIndex;
  onSelectObject: (id: string) => void;
  onMerge: (fromId: string, fromLabel: string, intoId: string) => void;
  onDelete: (id: string, label: string) => void;
  /** rel-domain 전용 — 제약 위반 관계 삭제(POST /api/curate deleteEdge 경유) */
  onDeleteEdge: (edge: { src: string; rel: string; dst: string }) => void;
  onClose: () => void;
}

// 잡음 정리(기존 3종)=앰버, 스키마 위반(형식 온톨로지 1차 4종)=레드 — 배지·확신도에 같은 색.
const KIND_META: Record<QualityIssue["kind"], { icon: string; label: string; color: string }> = {
  "dup-candidate": { icon: "⧉", label: "중복 후보", color: "#8a6d1f" },
  orphan: { icon: "◌", label: "고립 노드", color: "#8a6d1f" },
  "no-evidence": { icon: "⚠", label: "근거 없음", color: "#8a6d1f" },
  "rel-domain": { icon: "⛓", label: "관계 제약 위반", color: "#b3453c" },
  "bad-subtype": { icon: "🏷", label: "미등록 서브타입", color: "#b3453c" },
  "missing-prop": { icon: "▢", label: "필수 속성 누락", color: "#b3453c" },
  "bad-datatype": { icon: "≠", label: "속성 형식 오류", color: "#b3453c" },
};

export default function QualityPanel({
  loading,
  error,
  items,
  nodeIndex,
  onSelectObject,
  onMerge,
  onDelete,
  onDeleteEdge,
  onClose,
}: QualityPanelProps) {
  return (
    <>
      <PanelHeader title="온톨로지 정리" onClose={onClose} />

      {loading && <div className="insp-empty">온톨로지를 스캔하는 중…</div>}
      {error && (
        <div className="insp-empty">
          품질 스캔에 실패했습니다.
          <br />
          <span className="k">{error}</span>
        </div>
      )}
      {!loading && !error && items.length === 0 && <div className="insp-empty">정리할 항목이 없습니다.</div>}

      {!loading &&
        !error &&
        items.map((it, i) => {
          const label = labelOf(nodeIndex, it.nodeId);
          const known = nodeIndex.has(it.nodeId);
          const meta = KIND_META[it.kind];
          return (
            <div className="chk show" key={i}>
              <span className="no" style={{ color: meta.color }}>
                {meta.icon} {meta.label}
              </span>
              <h3 className={known ? "clickable" : undefined} onClick={known ? () => onSelectObject(it.nodeId) : undefined}>
                {it.title}
              </h3>
              <p>{it.detail}</p>
              <ConfidenceBar pct={it.confidence} barBg="linear-gradient(90deg,#e8c33d,#8a6d1f)" color={meta.color} />

              {it.evidence.length > 0 && (
                <>
                  <div className="sec-label">근거</div>
                  <div className="evs">
                    {it.evidence.map((e, j) => (
                      <span key={j} className="evc">
                        {e}
                      </span>
                    ))}
                  </div>
                </>
              )}

              <div className="evs" style={{ marginTop: 8 }}>
                {it.kind === "dup-candidate" && it.mergeInto && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => onMerge(it.nodeId, label, it.mergeInto!)}
                    title={`"${label}" 을(를) "${labelOf(nodeIndex, it.mergeInto)}" 로 병합`}
                  >
                    병합 → {labelOf(nodeIndex, it.mergeInto)}
                  </button>
                )}
                {it.kind === "rel-domain" && it.edge && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => onDeleteEdge(it.edge!)}
                    title={`제약 위반 관계 ${it.edge.src} —${it.edge.rel}→ ${it.edge.dst} 삭제`}
                  >
                    관계 삭제 ({it.edge.rel})
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => onDelete(it.nodeId, label)}>
                  삭제
                </button>
              </div>
            </div>
          );
        })}
    </>
  );
}
