"use client";

// 우측 패널 · STAGE 3 추론 결과 체크리스트 — 데모 showChecklist()의 정적 렌더를 React로 이식.
// 문구·확신도·근거·traversed는 전부 POST /api/infer 응답을 그대로 사용한다(하드코딩 없음).
//
// 항목 클릭 시 아코디언으로 펼쳐 전체 설명·전체 근거칩·근거 경로(trace)를 보여준다.
// trace hop("PJ26→SIMILAR→PJ21")은 /api/ontology에서 로드한 노드 색인으로 라벨을 해석해
// 사람이 읽을 수 있는 체인으로 렌더링하고, 각 노드/일치하는 근거칩 클릭 시 해당 객체를
// 그래프에서 선택 + 인스펙터로 로드한다(결론 → 근거 객체로 바로 이동하는 provenance 배선).
import { useEffect, useState } from "react";
import type { CheckItem, DesignInput, InferResponse } from "@/lib/types";
import { buildChains, findIdByText, labelOf, parseHop, type NodeIndex } from "./nodeIndex";
import { relKo } from "./relLabels";

interface ChecklistProps {
  loading: boolean;
  error: string | null;
  result: InferResponse | null;
  condition: DesignInput;
  revealedCount: number; // 순차 등장 애니메이션 — 몇 개까지 보여줄지
  nodeIndex: NodeIndex;
  onSelectObject: (id: string) => void;
}

export default function Checklist({
  loading,
  error,
  result,
  condition,
  revealedCount,
  nodeIndex,
  onSelectObject,
}: ChecklistProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [dl, setDl] = useState(false);
  // FMEA 초안 다운로드 클릭 → 취약점 분석 리포트(이미지) 모달을 먼저 보여주고,
  // 모달 안의 다운로드 버튼이 실제 xlsx 다운로드를 수행한다.
  const [vulnOpen, setVulnOpen] = useState(false);
  useEffect(() => {
    if (!vulnOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVulnOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vulnOpen]);

  // 현재 조건으로 채워진 DFMEA 초안(xlsx)을 생성·다운로드
  async function downloadFmea() {
    if (dl) return;
    setDl(true);
    try {
      const res = await fetch("/api/fmea-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(condition),
      });
      if (!res.ok) throw new Error("생성 실패");
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      const fname = m ? decodeURIComponent(m[1]) : "FMEA초안.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* 조용히 무시 — 버튼 상태만 복구 */
    } finally {
      setDl(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="sec-label">추론 결과</div>
        <div className="insp-empty">온톨로지를 탐색해 체크리스트를 생성하는 중…</div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <div className="sec-label">추론 결과</div>
        <div className="insp-empty">
          추론 API를 아직 사용할 수 없습니다.
          <br />
          <span className="k">{error}</span>
        </div>
      </>
    );
  }
  if (!result) return null;

  const { checklist, traversed, masterAudit } = result;

  return (
    <>
      <div className="sec-label">추론 결과</div>
      <div className="chk-head">
        <h2>설계 검토 체크리스트</h2>
        <div className="m">
          {condition.anchorItem
            ? `선택 부품 '${condition.anchorItem}' 고장 이력 기준 · ${condition.market}향 ${condition.lightSource} — 온톨로지 탐색으로 도출`
            : `${(condition.components ?? []).join(", ")} · ${condition.market}향 ${condition.lightSource} ${condition.shape.join(" · ")} — 온톨로지 탐색으로 도출`}
        </div>
      </div>
      <button className="fmea-dl" onClick={() => setVulnOpen(true)} disabled={dl} title="취약점 분석 리포트를 확인하고 DFMEA 워크시트를 내려받습니다">
        {dl ? "FMEA 초안 생성 중…" : "📄 FMEA 초안 다운로드"}
      </button>
      {vulnOpen ? (
        <div className="drawing-modal" role="dialog" aria-label="도면 취약점 분석 리포트" onClick={() => setVulnOpen(false)}>
          <div className="vuln-modal-body" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/vuln-analysis.png" alt="도면 취약점 분석 리포트" />
            <div className="vuln-modal-bar">
              <button
                className="btn btn-primary"
                disabled={dl}
                onClick={() => {
                  downloadFmea();
                }}
              >
                {dl ? "생성 중…" : "📄 FMEA 초안 다운로드"}
              </button>
              <button className="btn btn-ghost" onClick={() => setVulnOpen(false)}>
                닫기 (ESC)
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="stats">
        <span className="stat">
          탐색 객체 <b>{traversed.objects}</b>
        </span>
        <span className="stat">
          관계 <b>{traversed.edges}</b>
        </span>
        <span className="stat">
          근거 문서 <b>{traversed.docs}</b>
        </span>
        <span className="stat">
          체크항목 <b>{checklist.length}</b>
        </span>
      </div>
      <div id="chkList">
        {checklist.map((c, i) => (
          <ChecklistRow
            key={c.no}
            c={c}
            index={i}
            revealed={i < revealedCount}
            expanded={expanded === c.no}
            onToggle={() => setExpanded((cur) => (cur === c.no ? null : c.no))}
            nodeIndex={nodeIndex}
            onSelectObject={onSelectObject}
          />
        ))}
      </div>
      {masterAudit && masterAudit.length > 0 && (
        <>
          <div className="sec-label">마스터 대조</div>
          {masterAudit.map((ma) => (
            <div className="master-audit" key={ma.master.id}>
              <div className="master-audit-head">
                <b>{ma.master.label}</b>
                <span className="m">
                  필수 {ma.required.length}항목 중 {ma.covered.length} 커버
                  {ma.missing.length > 0
                    ? ` — '${ma.missing[0]}'${ma.missing.length > 1 ? ` 외 ${ma.missing.length - 1}건` : ""} 누락`
                    : ""}
                </span>
              </div>
              <div className="ma-chips">
                {ma.covered.map((r) => (
                  <span key={"c:" + r} className="ma-chip" title="체크리스트에서 확인됨">
                    ✓ {r}
                  </span>
                ))}
                {ma.missing.map((r) => (
                  <span key={"m:" + r} className="ma-chip ma-miss" title="체크리스트에서 확인되지 않음 — 검토 필요">
                    ⚠ {r}
                  </span>
                ))}
                {ma.unknown.map((r) => (
                  <span key={"u:" + r} className="ma-chip ma-unknown" title="부분 근거 — 확신 없음, 직접 확인 필요">
                    {r} 미확인
                  </span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      <div
        style={{
          fontSize: 11,
          color: "var(--ink-faint)",
          lineHeight: 1.6,
          marginTop: 6,
          paddingTop: 10,
          borderTop: "1px solid var(--line)",
        }}
      >
        모든 항목은 <b style={{ color: "var(--amber)" }}>원본 문서 근거</b>와 확신도를 함께 제시합니다.
        <br />
        최종 판단은 설계 엔지니어가 수행합니다 — 검토용 초안.
      </div>
    </>
  );
}

interface ChecklistRowProps {
  c: CheckItem;
  index: number;
  revealed: boolean;
  expanded: boolean;
  onToggle: () => void;
  nodeIndex: NodeIndex;
  onSelectObject: (id: string) => void;
}

function ChecklistRow({ c, index, revealed, expanded, onToggle, nodeIndex, onSelectObject }: ChecklistRowProps) {
  const preview = c.desc.length > 64 ? c.desc.slice(0, 64) + "…" : c.desc;
  const chains = expanded ? buildChains(c.trace.map(parseHop)) : [];

  return (
    <div
      className={"chk" + (revealed ? " show" : "") + (expanded ? " expanded" : "")}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="no">CHECK {String(index + 1).padStart(2, "0")}</span>
      <h3>{c.title}</h3>
      {!expanded && <p className="chk-desc-preview">{preview}</p>}
      <div className="cf">
        <div className="bar">
          <i style={{ width: `${c.confidence}%` }} />
        </div>
        <span className="cv">{c.confidence}%</span>
      </div>

      {expanded && (
        <div className="chk-detail" onClick={(ev) => ev.stopPropagation()}>
          <p>{c.desc}</p>

          <div className="sec-label">근거 문서·사례</div>
          <div className="evs">
            {c.evidence.map((e, j) => {
              const objId = findIdByText(nodeIndex, e);
              return (
                <span
                  key={j}
                  className={"evc" + (objId ? " clickable" : "")}
                  title={objId ? "클릭하면 해당 객체를 엽니다" : undefined}
                  onClick={objId ? () => onSelectObject(objId) : undefined}
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
      )}
    </div>
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
