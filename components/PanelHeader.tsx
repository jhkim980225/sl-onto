"use client";

// 공용 패널 헤더 — 우측 패널 7종(모순·품질·유도·검색·결로·질문·인제스천)에 반복되던
// `.cond-head > .sec-label + .cond-back` 블록 추출(마크업·클래스명 불변).

export default function PanelHeader({
  title,
  onClose,
  backLabel = "← 인스펙터로",
}: {
  title: string;
  onClose: () => void;
  backLabel?: string;
}) {
  return (
    <div className="cond-head">
      <span className="sec-label" style={{ margin: 0 }}>
        {title}
      </span>
      <span className="cond-back" onClick={onClose}>
        {backLabel}
      </span>
    </div>
  );
}
