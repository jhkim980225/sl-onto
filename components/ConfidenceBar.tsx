"use client";

// 공용 확신도 막대 — `.cf > .bar > i(width%) + .cv` 반복 블록 추출(마크업·클래스명 불변).
// 색 변종은 barBg(막대 그라디언트)·color(% 텍스트)로 — 미지정 시 style 속성 자체를 내지 않아
// 기존 무스타일 마크업과 DOM이 동일하다.
// DrawingPanel의 변종(.cf에 margin + cv 텍스트 "형상 유사")은 대상 아님.

export default function ConfidenceBar({ pct, barBg, color }: { pct: number; barBg?: string; color?: string }) {
  return (
    <div className="cf">
      <div className="bar">
        <i style={barBg ? { width: `${pct}%`, background: barBg } : { width: `${pct}%` }} />
      </div>
      <span className="cv" style={color ? { color } : undefined}>
        {pct}%
      </span>
    </div>
  );
}
