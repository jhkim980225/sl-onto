"use client";

// 결과 프레임 Table 뷰 — 현재 뷰 스냅샷을 노드/관계 두 표로. 파생은 lib/view-table(순수),
// 한글 라벨·타입 색은 여기서 입힌다. 행 클릭 → onSelect(id)로 그래프 포커스.
import { useMemo, useState } from "react";
import { buildNodeRows, buildRelRows, type View } from "@/lib/view-table";
import { TYPES, TYPE_NAMES } from "./typeStyles";
import { relKo } from "./relLabels";
import type { ObjType } from "@/lib/types";

type Tab = "nodes" | "rels";
type SortKey = "type" | "label";

export default function TableView({
  view,
  onSelect,
}: {
  view: View;
  onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("nodes");
  const [sortKey, setSortKey] = useState<SortKey>("type");
  const [asc, setAsc] = useState(true);

  const nodeRows = useMemo(() => {
    const rows = buildNodeRows(view);
    const dir = asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortKey === "type" ? a.type : a.label;
      const bv = sortKey === "type" ? b.type : b.label;
      return av.localeCompare(bv) * dir || a.label.localeCompare(b.label);
    });
  }, [view, sortKey, asc]);

  const relRows = useMemo(() => buildRelRows(view), [view]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setAsc((v) => !v);
    else {
      setSortKey(k);
      setAsc(true);
    }
  };
  const arrow = (k: SortKey) => (sortKey === k ? (asc ? " ▲" : " ▼") : "");

  return (
    <div className="rf-view">
      <div className="rf-tabs">
        <button className={"rf-tab" + (tab === "nodes" ? " active" : "")} onClick={() => setTab("nodes")}>
          노드 {nodeRows.length}
        </button>
        <button className={"rf-tab" + (tab === "rels" ? " active" : "")} onClick={() => setTab("rels")}>
          관계 {relRows.length}
        </button>
      </div>
      <div className="rf-table-scroll">
        {tab === "nodes" ? (
          <table className="rf-table">
            <thead>
              <tr>
                <th className="rf-sortable" onClick={() => toggleSort("type")}>타입{arrow("type")}</th>
                <th className="rf-sortable" onClick={() => toggleSort("label")}>라벨{arrow("label")}</th>
                <th>서브타입</th>
                <th>속성</th>
                <th className="rf-num">근거</th>
              </tr>
            </thead>
            <tbody>
              {nodeRows.map((r) => (
                <tr key={r.id} className="rf-row" onClick={() => onSelect(r.id)}>
                  <td>
                    <span className="rf-chip" style={{ background: TYPES[r.type as ObjType]?.c ?? "#8291a8" }} />
                    {TYPE_NAMES[r.type as ObjType] ?? r.type}
                  </td>
                  <td className="rf-label">{r.label}</td>
                  <td className="rf-dim">{r.st ?? ""}</td>
                  <td className="rf-dim rf-props">{r.propsSummary}</td>
                  <td className="rf-num">{r.evidenceCount || ""}</td>
                </tr>
              ))}
              {nodeRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="rf-empty">현재 뷰에 노드가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="rf-table">
            <thead>
              <tr>
                <th>시작</th>
                <th className="rf-num">관계</th>
                <th>끝</th>
              </tr>
            </thead>
            <tbody>
              {relRows.map((r, i) => (
                <tr key={i} className="rf-row" onClick={() => onSelect(r.src)}>
                  <td className="rf-label">{r.srcLabel}</td>
                  <td className="rf-rel">{relKo(r.rel)}</td>
                  <td className="rf-label">{r.dstLabel}</td>
                </tr>
              ))}
              {relRows.length === 0 && (
                <tr>
                  <td colSpan={3} className="rf-empty">현재 뷰에 관계가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
