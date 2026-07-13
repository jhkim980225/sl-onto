"use client";

// 우측 패널 상단 · 신규 설계 추론 조건 입력 + 실행 (입력→실행→결과 한 컬럼).
// 조건은 기존 온톨로지가 인식하는 값에서 선택 — 시장·광원 드롭다운, 형상 토글 칩(복수).
import type { DesignInput } from "@/lib/types";

interface DesignConditionFormProps {
  condition: DesignInput;
  onChange: (next: DesignInput) => void;
  anchorLabel: string | null;
  onRun: () => void;
  running: boolean;
}

// 추론이 실제로 인식·부스트하는 값들(시장→법규, 광원→방열, 형상→수축·결로·휘도).
const MARKETS = ["북미", "유럽", "아시아", "중국", "한국"];
const LIGHT_SOURCES = ["LED", "LED 분리형", "할로겐", "레이저"];
const SHAPES = ["슬림 하우징", "밀폐형", "분리형 DRL", "개방형", "곡면 렌즈", "일체형"];

export default function DesignConditionForm({
  condition,
  onChange,
  anchorLabel,
  onRun,
  running,
}: DesignConditionFormProps) {
  const toggleShape = (s: string) => {
    const has = condition.shape.includes(s);
    onChange({ ...condition, shape: has ? condition.shape.filter((x) => x !== s) : [...condition.shape, s] });
  };

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
        <select value={condition.market} onChange={(e) => onChange({ ...condition, market: e.target.value })} aria-label="시장">
          {/* 현재 값이 목록에 없으면(과거 조건 등) 그 값도 옵션으로 노출 */}
          {!MARKETS.includes(condition.market) && condition.market ? (
            <option value={condition.market}>{condition.market}</option>
          ) : null}
          {MARKETS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="dc-field">
        <span>광원</span>
        <select value={condition.lightSource} onChange={(e) => onChange({ ...condition, lightSource: e.target.value })} aria-label="광원">
          {!LIGHT_SOURCES.includes(condition.lightSource) && condition.lightSource ? (
            <option value={condition.lightSource}>{condition.lightSource}</option>
          ) : null}
          {LIGHT_SOURCES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </label>
      <div className="dc-field dc-field-shape">
        <span>형상</span>
        <div className="dc-chips">
          {SHAPES.map((s) => (
            <button
              key={s}
              type="button"
              className={"dc-chip" + (condition.shape.includes(s) ? " on" : "")}
              onClick={() => toggleShape(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <button className="btn btn-primary dc-run" onClick={onRun} disabled={running}>
        {running ? "추론 중…" : "▶ 추론 실행"}
      </button>
    </div>
  );
}
