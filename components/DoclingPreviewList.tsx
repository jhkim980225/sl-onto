"use client";

// 공용 정형화 미리보기 목록 — IngestPanel·SourcePreview에 바이트 동일하게 복붙돼 있던
// `.src-prev-list / .src-prev-row` 블록(섹션 라벨 포함) 추출(마크업·클래스명 불변).
import { TYPES } from "./typeStyles";
import type { SourcePreviewItem } from "./sourceTypes";

export default function DoclingPreviewList({
  preview,
  highlightIds,
}: {
  preview: SourcePreviewItem[];
  /** 강조 매칭 토큰(id 또는 라벨). 행의 id·label·raw 중 하나가 들면 강조(답변 근거). 없으면 강조 없음. */
  highlightIds?: Set<string>;
}) {
  const isHl = (p: SourcePreviewItem) =>
    !!highlightIds && (highlightIds.has(p.id) || highlightIds.has(p.label) || highlightIds.has(p.raw));
  return (
    <>
      <div className="sec-label">Docling 추출 → 정규화 (원문 → 표준코드·라벨)</div>
      <div className="src-prev-list">
        {preview.map((p, i) => {
          const tp = TYPES[p.type];
          const mapped = p.raw !== p.label;
          const pct = Math.round(p.confidence * 100);
          const hl = isHl(p);
          return (
            <div className={"src-prev-row" + (mapped ? " mapped" : "") + (hl ? " hl" : "")} data-hl={hl ? "1" : undefined} key={i}>
              <div className="src-prev-line">
                <span className="src-prev-raw">&ldquo;{p.raw}&rdquo;</span>
                <span className="src-prev-arrow">→</span>
                <span className="src-prev-glyph" style={{ color: tp.c }}>
                  {tp.g}
                </span>
                <span className="src-prev-obj">{p.label}</span>
                <span className="src-prev-id">{p.id}</span>
              </div>
              <div className="src-prev-conf-row">
                {mapped && <span className="src-prev-tag">매핑됨</span>}
                <div className="bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <span className="cv">확신도 {pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
