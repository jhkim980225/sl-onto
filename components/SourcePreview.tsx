"use client";

// STAGE 1 · 정형화 미리보기 — 원천 파일 클릭 시 우측 패널에 표시.
// 비정형 원문(raw)이 Docling 추출을 거쳐 표준 온톨로지 객체(id/label/type)로 정규화되는 과정을
// "원문 → 표준코드/라벨 (확신도 NN%)" 형태로 보여준다. 원본은 절대 덮어쓰지 않고 표준 매핑·확신도를
// 함께 보존한다는 온톨로지의 약속을 실제 API 데이터(/api/sources)로 증명하는 화면.
import { useEffect, useState } from "react";
import type { SourceInfo } from "./sourceTypes";
import DoclingPreviewList from "./DoclingPreviewList";

interface SourcePreviewProps {
  source: SourceInfo;
  onClose: () => void;
}

export default function SourcePreview({ source, onClose }: SourcePreviewProps) {
  const kb = Math.max(1, Math.round(source.sizeBytes / 1024));
  const [enlarged, setEnlarged] = useState(false);

  // 크게 보기: ESC 로 닫기
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEnlarged(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enlarged]);

  const drawingUrl = /\.dxf$/i.test(source.file)
    ? `/api/drawing-svg?file=${encodeURIComponent(source.file)}`
    : null;
  return (
    <>
      <div className="sec-label">정형화 미리보기</div>
      <div className="obj-head">
        <span className="tp" style={{ background: "var(--c-doc)" }}>
          {source.type}
        </span>
        <h2 style={{ wordBreak: "break-all" }}>{source.file}</h2>
      </div>
      <div className="kv" style={{ marginBottom: 4 }}>
        <span className="k">크기</span>
        <span className="v">{kb} KB</span>
        <span className="k">추출 결과</span>
        <span className="v">
          객체 {source.extracted.objects} · 관계 {source.extracted.relations}
        </span>
      </div>

      {/* 도면(DXF)은 렌더된 미리보기를 함께 표시 — 클릭/버튼으로 크게 보기 */}
      {drawingUrl ? (
        <>
          <div className="sec-label">도면 미리보기</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="src-drawing src-drawing-click"
            src={drawingUrl}
            alt={`${source.file} 도면 미리보기`}
            title="클릭하면 크게 봅니다"
            onClick={() => setEnlarged(true)}
          />
          <button type="button" className="morerel morerel-btn" onClick={() => setEnlarged(true)}>
            🔍 크게 보기
          </button>
          {enlarged ? (
            <div className="drawing-modal" role="dialog" aria-label="도면 크게 보기" onClick={() => setEnlarged(false)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={drawingUrl} alt={`${source.file} 도면 확대`} onClick={(e) => e.stopPropagation()} />
              <button type="button" className="drawing-modal-close" onClick={() => setEnlarged(false)} aria-label="닫기">
                ✕ 닫기 (ESC)
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <DoclingPreviewList preview={source.preview} />

      <div
        style={{
          fontSize: 11,
          color: "var(--ink-faint)",
          lineHeight: 1.6,
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid var(--line)",
        }}
      >
        원본 표현은 <b style={{ color: "var(--amber)" }}>덮어쓰지 않고</b> 그대로 보존하며, 표준 매핑·확신도를 함께
        제공합니다 — 온톨로지의 약속.
      </div>
      <button className="btn btn-ghost src-prev-close" onClick={onClose}>
        ← 원천 목록으로
      </button>
    </>
  );
}
