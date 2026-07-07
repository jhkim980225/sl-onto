"use client";

// 하단 바 · 3단계 스테퍼 + 신규 조건 칩(편집 가능).
import type { DesignInput } from "@/lib/types";

interface StepperProps {
  stage: 1 | 2 | 3;
  condition: DesignInput;
  onChangeCondition: (next: DesignInput) => void;
  editable: boolean;
}

export default function Stepper({ stage, condition, onChangeCondition, editable }: StepperProps) {
  const steps: { n: 1 | 2 | 3; label: string }[] = [
    { n: 1, label: "흩어진 원천" },
    { n: 2, label: "온톨로지 구축" },
    { n: 3, label: "신규 설계 추론" },
  ];

  return (
    <footer className="botbar">
      {steps.map((s, i) => (
        <span key={s.n} style={{ display: "flex", alignItems: "center" }}>
          <div className={"step" + (stage === s.n ? " on" : "") + (stage > s.n ? " done" : "")}>
            <span className="num">{s.n}</span>
            {s.label}
          </div>
          {i < steps.length - 1 ? <span className="step-arrow">›</span> : null}
        </span>
      ))}
      <div className="grow" />
      <div className={"cond" + (stage >= 2 ? " show" : "")}>
        <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>신규 조건</span>
        {editable ? (
          <>
            <input
              value={condition.market}
              onChange={(e) => onChangeCondition({ ...condition, market: e.target.value })}
              aria-label="시장"
              placeholder="시장"
            />
            <input
              value={condition.lightSource}
              onChange={(e) => onChangeCondition({ ...condition, lightSource: e.target.value })}
              aria-label="광원"
              placeholder="광원"
            />
            <input
              value={condition.shape.join(", ")}
              onChange={(e) =>
                onChangeCondition({
                  ...condition,
                  shape: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              aria-label="형상 (콤마로 구분)"
              placeholder="형상"
              style={{ width: 160 }}
            />
          </>
        ) : (
          <>
            <span className="cc">{condition.market}향</span>
            <span className="cc">{condition.lightSource}</span>
            {condition.shape.map((s) => (
              <span className="cc" key={s}>
                {s}
              </span>
            ))}
          </>
        )}
      </div>
    </footer>
  );
}
