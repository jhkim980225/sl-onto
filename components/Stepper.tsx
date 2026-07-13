"use client";

// 하단 바 · 3단계 스테퍼. (조건 입력은 우측 패널 DesignConditionForm 으로 이관)

interface StepperProps {
  stage: 1 | 2 | 3;
}

export default function Stepper({ stage }: StepperProps) {
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
    </footer>
  );
}
