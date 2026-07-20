"use client";

// 좌측 아이콘 레일(48px) + 활성 시 드로어(252px). Neo4j Browser 식.
// 기본 접힘 — 아이콘 클릭으로 드로어 펼침. 드로어 내용은 panels[활성 아이콘 id].
import type { ReactNode } from "react";

interface RailIcon {
  id: string;
  glyph: string;
  label: string;
  ready: boolean; // false = 준비중(disabled)
}

const ICONS: RailIcon[] = [
  { id: "canvases", glyph: "▤", label: "캔버스", ready: true },
  { id: "types", glyph: "▣", label: "객체 타입", ready: true },
  { id: "schema", glyph: "◈", label: "스키마", ready: true },
  { id: "history", glyph: "🕐", label: "히스토리", ready: false },
];

interface LeftRailProps {
  active: string | null;
  onSelect: (id: string | null) => void;
  panels: Record<string, ReactNode>;
}

export default function LeftRail({ active, onSelect, panels }: LeftRailProps) {
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
          <div className="lr-body">{panels[active] ?? null}</div>
        </div>
      )}
    </div>
  );
}
