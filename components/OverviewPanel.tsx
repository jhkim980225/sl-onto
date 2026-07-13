"use client";

// 결과 프레임 오버뷰 — 캔버스 우하단 접이식. 현재 뷰의 타입별 노드 수·관계별 수(Neo4j 톤).
// 좌측 타입 탐색기(전체 온톨로지)와 숫자가 다를 수 있음 — 뷰 스코프 vs 전체(의도).
import { useMemo, useState } from "react";
import { buildOverviewCounts } from "@/lib/view-overview";
import type { View } from "@/lib/view-table";
import { TYPES, TYPE_NAMES } from "./typeStyles";
import { relKo } from "./relLabels";
import type { ObjType } from "@/lib/types";

export default function OverviewPanel({ view }: { view: View }) {
  const [open, setOpen] = useState(false);
  const c = useMemo(() => buildOverviewCounts(view), [view]);

  return (
    <div className={"rf-overview" + (open ? " open" : "")}>
      <button className="rf-ov-head" onClick={() => setOpen((v) => !v)}>
        <span className="rf-ov-title">오버뷰</span>
        <span className="rf-ov-badge">
          현재 뷰 {c.nodeTotal}객체 / {c.edgeTotal}관계
        </span>
        <span className="rf-ov-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="rf-ov-body">
          <div className="rf-ov-sec">노드 타입</div>
          <div className="rf-ov-list">
            {c.byType.map((t) => (
              <div key={t.type} className="rf-ov-item">
                <span className="rf-chip" style={{ background: TYPES[t.type as ObjType]?.c ?? "#8291a8" }} />
                <span className="rf-ov-name">{TYPE_NAMES[t.type as ObjType] ?? t.type}</span>
                <span className="rf-ov-count">{t.count}</span>
              </div>
            ))}
            {c.byType.length === 0 && <div className="rf-ov-empty">비어 있음</div>}
          </div>
          <div className="rf-ov-sec">관계</div>
          <div className="rf-ov-list">
            {c.byRel.map((r) => (
              <div key={r.rel} className="rf-ov-item">
                <span className="rf-ov-name">{relKo(r.rel)}</span>
                <span className="rf-ov-count">{r.count}</span>
              </div>
            ))}
            {c.byRel.length === 0 && <div className="rf-ov-empty">비어 있음</div>}
          </div>
        </div>
      )}
    </div>
  );
}
