"use client";

// 우측 패널 · 문서 인제스천(증분 반영) — 이미 구축된 온톨로지에 새 문서를 더한다.
// 파일 업로드(.xlsx/.pptx/.docx) 또는 샘플 문서로 POST /api/ingest 를 호출하고,
// 결과(새 객체/관계 통계 + 원문→표준 매핑 미리보기 + 새 노드 목록)를 보여준다.
// 새 노드 클릭 시 부모의 handleNodeClick funnel(via "인제스천")로 그래프 선택/포커스.
import { useRef, useState, type DragEvent } from "react";
import { TYPES, TYPE_NAMES } from "./typeStyles";
import type { IngestResponse } from "./ingestTypes";
import DoclingPreviewList from "./DoclingPreviewList";
import PanelHeader from "./PanelHeader";

const ACCEPT = ".xlsx,.pptx,.docx,.dxf";

interface IngestPanelProps {
  loading: boolean;
  error: string | null;
  result: IngestResponse | null;
  /** 이번 세션의 인제스천 이력(최신이 앞) — result와 동일 객체가 [0]에 있다. */
  history: IngestResponse[];
  onIngestFile: (file: File) => void;
  onIngestSample: () => void;
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

export default function IngestPanel({
  loading,
  error,
  result,
  history,
  onIngestFile,
  onIngestSample,
  onSelectNode,
  onClose,
}: IngestPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const pickFile = () => {
    if (!loading) fileInputRef.current?.click();
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (loading) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onIngestFile(f);
  };

  // 캔버스에 실제로 합류하는 것만 통계로 보여준다(doc 노드·EVIDENCED_BY 근거 엣지는 제외).
  const newNodes = result ? result.delta.nodes.filter((n) => n.type !== "doc") : [];
  const newEdgeCount = result
    ? result.delta.edges.filter((e) => e.rel !== "EVIDENCED_BY").length
    : 0;
  const prevRuns = history.slice(1);

  return (
    <>
      <PanelHeader title="문서 인제스천" onClose={onClose} />

      <div className="ing-intro">
        이미 구축된 온톨로지에 새 문서를 증분 반영합니다 — 실제 운영 파이프라인의 축소판.
      </div>

      <div
        className={"ing-drop" + (dragOver ? " over" : "") + (loading ? " busy" : "")}
        role="button"
        tabIndex={0}
        aria-label="문서 파일 업로드"
        onClick={pickFile}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pickFile();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <span className="big" aria-hidden="true">
          📄
        </span>
        <span>파일을 끌어다 놓거나 클릭해 선택</span>
        <span className="fmt">.xlsx · .pptx · .docx — 최대 10MB</span>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onIngestFile(f);
            e.target.value = ""; // 같은 파일 재선택도 change가 발생하도록
          }}
        />
      </div>

      <button className="btn btn-primary ing-sample" disabled={loading} onClick={onIngestSample}>
        ▶ 샘플 문서 인제스천
      </button>

      {loading && (
        <div className="ing-loading">
          <span className="nls-spinner" aria-hidden="true" />
          문서 정형화 중…
        </div>
      )}

      {!loading && error && (
        <div className="ing-error">
          인제스천에 실패했습니다.
          <br />
          <span className="k">{error}</span>
        </div>
      )}

      {!loading && !error && result && (
        <>
          <div className="sec-label">인제스천 결과</div>
          <div className="obj-head">
            <span className="tp" style={{ background: "var(--c-doc)", color: "#ffffff" }}>
              {result.source.type}
            </span>
            <h2 style={{ wordBreak: "break-all", fontSize: 14.5 }}>{result.file}</h2>
          </div>

          {result.alreadyIngested ? (
            <div className="ing-note">
              이미 반영된 샘플입니다 — 온톨로지에 새로 추가된 객체/관계가 없습니다.
            </div>
          ) : (
            <div className="stats ing-stats">
              <span className="stat">
                새 객체 <b>{newNodes.length}</b>
              </span>
              <span className="stat">
                새 관계 <b>{newEdgeCount}</b>
              </span>
              <span className="stat">
                기존 객체 연결 <b>{result.delta.updated.length}</b>
              </span>
              <span className="stat">
                전체 객체 <b>{result.totals.nodes}</b>
              </span>
            </div>
          )}

          {result.source.preview.length > 0 && <DoclingPreviewList preview={result.source.preview} />}

          {newNodes.length > 0 && (
            <>
              <div className="sec-label">그래프에 합류한 새 객체 · {newNodes.length}</div>
              <div className="nls-hits">
                {newNodes.map((n) => {
                  const tp = TYPES[n.type];
                  return (
                    <button key={n.id} className="nls-hit" onClick={() => onSelectNode(n.id)}>
                      <span className="nls-hit-glyph" style={{ color: tp.c }}>
                        {tp.g}
                      </span>
                      <span className="nls-hit-body">
                        <span className="nls-hit-label">{n.label}</span>
                        <span className="nls-hit-type">{TYPE_NAMES[n.type]}</span>
                      </span>
                      <span className="nls-hit-arrow" aria-hidden="true">
                        →
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {prevRuns.length > 0 && (
        <details className="ing-hist">
          <summary>이전 인제스천 · {prevRuns.length}</summary>
          {prevRuns.map((r, i) => (
            <div className="ing-hist-row" key={`${r.file}-${i}`}>
              <span className="ext">{r.source.type}</span>
              <span className="nm">{r.file}</span>
              <span className="ct">
                {r.alreadyIngested
                  ? "변화 없음"
                  : `+${r.delta.nodes.filter((n) => n.type !== "doc").length} 객체`}
              </span>
            </div>
          ))}
        </details>
      )}

      {!loading && !result && !error && (
        <div className="insp-empty" style={{ marginTop: 12 }}>
          문서를 업로드하거나 샘플 문서를 인제스천하면, 새로 추출된 객체·관계가 그래프에
          실시간으로 합류하는 과정을 볼 수 있습니다.
        </div>
      )}
    </>
  );
}
