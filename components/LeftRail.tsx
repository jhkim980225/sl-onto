"use client";

// 좌측 아이콘 레일(48px) + 활성 시 드로어(252px). Neo4j Browser 식.
// 기본 접힘 — 아이콘 클릭으로 드로어 펼침. 드로어 내용은 children(현재는 타입 탐색기).
import type { ReactNode } from "react";

interface RailIcon {
  id: string;
  glyph: string;
  label: string;
  ready: boolean; // false = 준비중(disabled)
}

const ICONS: RailIcon[] = [
  { id: "types", glyph: "▣", label: "객체 타입", ready: true },
  { id: "history", glyph: "🕐", label: "히스토리", ready: false },
  { id: "saved", glyph: "🔖", label: "저장 뷰", ready: false },
  { id: "settings", glyph: "⚙", label: "설정", ready: false },
];

interface LeftRailProps {
  active: string | null;
  onSelect: (id: string | null) => void;
  children: ReactNode;
}

export default function LeftRail({ active, onSelect, children }: LeftRailProps) {
  const activeLabel = ICONS.find((i) => i.id === active)?.label ?? "";
  return (
    <div className="lr">
      <nav className="lr-rail">
        {ICONS.map((ic) => (
          <button
            key={ic.id}
            className={"lr-ico" + (active === ic.id ? " active" : "")}
            disabled={!ic.ready}
            title={ic.ready ? ic.label : `${ic.label} · 준비중`}
            onClick={() => onSelect(active === ic.id ? null : ic.id)}
          >
            {ic.glyph}
          </button>
        ))}
      </nav>
      {active !== null && (
        <div className="lr-drawer">
          <div className="lr-head">
            <span>{activeLabel}</span>
            <button className="lr-close" title="접기" onClick={() => onSelect(null)}>
              ✕
            </button>
          </div>
          <div className="lr-body">{children}</div>
        </div>
      )}
    </div>
  );
}
