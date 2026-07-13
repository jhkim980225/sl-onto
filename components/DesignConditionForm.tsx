"use client";

// 우측 패널 상단 · 신규 설계 추론 조건 입력 + 실행 (입력→실행→결과 한 컬럼).
import type { DesignInput } from "@/lib/types";

interface DesignConditionFormProps {
  condition: DesignInput;
  onChange: (next: DesignInput) => void;
  anchorLabel: string | null;
  onRun: () => void;
  running: boolean;
}

export default function DesignConditionForm({
  condition,
  onChange,
  anchorLabel,
  onRun,
  running,
}: DesignConditionFormProps) {
  return (
    <div className="dc-form">
      <div className="dc-head">설계 조건</div>
      {anchorLabel ? (
        <div className="dc-anchor">
          부품 앵커: <b>{anchorLabel}</b>
        </div>
      ) : null}
      <label className="dc-field">
        <span>시장</span>
        <input
          value={condition.market}
          onChange={(e) => onChange({ ...condition, market: e.target.value })}
          aria-label="시장"
          placeholder="시장"
        />
      </label>
      <label className="dc-field">
        <span>광원</span>
        <input
          value={condition.lightSource}
          onChange={(e) => onChange({ ...condition, lightSource: e.target.value })}
          aria-label="광원"
          placeholder="광원"
        />
      </label>
      <label className="dc-field">
        <span>형상</span>
        <input
          value={condition.shape.join(", ")}
          onChange={(e) =>
            onChange({
              ...condition,
              shape: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
          aria-label="형상 (콤마로 구분)"
          placeholder="형상 (콤마 구분)"
        />
      </label>
      <button className="btn btn-primary dc-run" onClick={onRun} disabled={running}>
        {running ? "추론 중…" : "▶ 추론 실행"}
      </button>
    </div>
  );
}
