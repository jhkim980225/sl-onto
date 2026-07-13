"use client";

// 결과 프레임 뷰 전환 — 캔버스 좌상단 [Graph | 계층 | Table | RAW] 세그먼트.
export type ViewMode = "graph" | "hierarchy" | "table" | "raw";

const MODES: { id: ViewMode; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "hierarchy", label: "계층" },
  { id: "table", label: "Table" },
  { id: "raw", label: "RAW" },
];

export default function ViewToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div className="rf-toggle" role="tablist" aria-label="결과 뷰 전환">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={mode === m.id}
          className={"rf-toggle-btn" + (mode === m.id ? " active" : "")}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
