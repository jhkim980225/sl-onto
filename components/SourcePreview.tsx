"use client";

// 근거 문서 미리보기 — 원천 파일 클릭 시 우측 패널에 표시.
// 주(主): 실제 파일 원문 전체(/api/source-text)를 렌더하고, 답변이 인용한 라벨 토큰을
// 원문 라인에서 <mark className="ft-hl"> 로 강조 + 첫 강조 라인으로 스크롤한다.
// 보조: 원문→표준코드 정규화 매핑(DoclingPreviewList)은 접이식 <details> 로 하단 유지.
// dxf(도면)는 원문 텍스트가 없어 기존 도면 이미지 뷰를 그대로 사용한다. 원본은 절대 덮어쓰지 않는다.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SourceInfo } from "./sourceTypes";
import DoclingPreviewList from "./DoclingPreviewList";

interface SourcePreviewProps {
  source: SourceInfo;
  onClose: () => void;
  /** 답변 근거 하이라이트 — 이 라벨/​id 토큰이 원문 라인에 나타나면 강조하고 첫 라인으로 스크롤. */
  highlightIds?: Set<string>;
}

interface SourceText {
  file: string;
  format: string;
  blocks: { label: string; lines: string[] }[];
}

type FtStatus = "loading" | "ok" | "unsupported" | "error";

export default function SourcePreview({ source, onClose, highlightIds }: SourcePreviewProps) {
  const kb = Math.max(1, Math.round(source.sizeBytes / 1024));
  const [enlarged, setEnlarged] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const drawingUrl = /\.dxf$/i.test(source.file)
    ? `/api/drawing-svg?file=${encodeURIComponent(source.file)}`
    : null;

  // 원문 전체 fetch — 마운트 및 source 변경 시. dxf 는 도면 뷰를 쓰므로 fetch 생략.
  const [ft, setFt] = useState<SourceText | null>(null);
  const [ftStatus, setFtStatus] = useState<FtStatus>("loading");
  const [ftError, setFtError] = useState("");
  useEffect(() => {
    if (drawingUrl) {
      setFtStatus("unsupported");
      setFt(null);
      return;
    }
    let cancelled = false;
    setFtStatus("loading");
    setFt(null);
    setFtError("");
    fetch(`/api/source-text?file=${encodeURIComponent(source.file)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok) {
          setFt(body as SourceText);
          setFtStatus("ok");
        } else if (r.status === 415) {
          setFtStatus("unsupported"); // 도면 등 원문 텍스트 없음
        } else {
          setFtError(body?.error || `원문 요청 실패 (HTTP ${r.status})`);
          setFtStatus("error");
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setFtError(String(e?.message || e));
        setFtStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [source.file, drawingUrl]);

  // 강조 토큰: highlightIds 중 길이 2 이상. 긴 토큰 우선(겹침 시 부분매칭 방지) alternation 정규식.
  const hlRegex = useMemo(() => {
    if (!highlightIds || highlightIds.size === 0) return null;
    const toks = [...highlightIds]
      .filter((t) => typeof t === "string" && t.trim().length >= 2)
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (toks.length === 0) return null;
    return new RegExp(`(${toks.join("|")})`, "gi");
  }, [highlightIds]);

  // 라인 한 줄을 강조 노드로 변환. split(캡처그룹) → 홀수 인덱스가 매칭 조각.
  function markLine(line: string): { nodes: ReactNode; hl: boolean } {
    if (!hlRegex) return { nodes: line, hl: false };
    const parts = line.split(hlRegex);
    if (parts.length === 1) return { nodes: line, hl: false };
    const nodes = parts.map((p, i) =>
      i % 2 === 1 ? (
        <mark className="ft-hl" key={i}>
          {p}
        </mark>
      ) : (
        p
      ),
    );
    return { nodes, hl: true };
  }

  // 블록 렌더 + 강조 라인 수 집계(한 패스).
  const { blockNodes, hlLineCount } = useMemo(() => {
    if (!ft) return { blockNodes: null as ReactNode, hlLineCount: 0 };
    let count = 0;
    const blockNodes = ft.blocks.map((block, bi) => (
      <div className="ft-block" key={bi}>
        <div className="ft-block-label">{block.label}</div>
        {block.lines.map((line, li) => {
          const { nodes, hl } = markLine(line);
          if (hl) count++;
          return (
            <div className="ft-line" data-hl={hl ? "1" : undefined} key={li}>
              {nodes}
            </div>
          );
        })}
      </div>
    ));
    return { blockNodes, hlLineCount: count };
    // markLine 은 hlRegex 에만 의존 → deps 에 ft·hlRegex.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ft, hlRegex]);

  const wantedHl = !!highlightIds && highlightIds.size > 0;

  // 첫 강조 라인으로 자동 스크롤(문서 열자마자 "여기가 근거" 보이게).
  useEffect(() => {
    if (ftStatus !== "ok" || hlLineCount === 0) return;
    const first = listRef.current?.querySelector<HTMLElement>('.ft-line[data-hl="1"]');
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [source.file, ftStatus, hlLineCount]);

  // 크게 보기: ESC 로 닫기
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEnlarged(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enlarged]);

  return (
    <>
      <div className="sec-label">근거 문서</div>
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

      {/* 도면(DXF)은 원문 텍스트가 없어 렌더된 도면 미리보기를 사용 — 클릭/버튼으로 크게 보기 */}
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
      ) : (
        <>
          <div className="sec-label">원문</div>
          {ftStatus === "loading" && <div className="ft-loading">원문 불러오는 중…</div>}

          {ftStatus === "error" && (
            <>
              <div className="ft-error">원문을 불러올 수 없습니다: {ftError}</div>
              {/* 폴백: 정형화 발췌를 그대로 노출 */}
              <DoclingPreviewList preview={source.preview} highlightIds={highlightIds} />
            </>
          )}

          {ftStatus === "ok" && (
            <>
              {wantedHl && (
                <div className="src-hl-note">
                  {hlLineCount > 0 ? (
                    <>
                      🔎 원문에서 <b>{hlLineCount}곳</b> 언급을 강조했습니다.
                    </>
                  ) : (
                    <>인용 언급을 원문에서 찾지 못했습니다.</>
                  )}
                </div>
              )}
              <div className="ft-scroll" ref={listRef}>
                {blockNodes}
              </div>
              <details className="ft-map-details">
                <summary>정규화 매핑 보기 (원문 → 표준코드·라벨)</summary>
                <DoclingPreviewList preview={source.preview} highlightIds={highlightIds} />
              </details>
            </>
          )}
        </>
      )}

      {/* dxf: 도면 뷰 아래에도 정규화 매핑을 접이식으로 유지 */}
      {drawingUrl && (
        <details className="ft-map-details">
          <summary>정규화 매핑 보기 (원문 → 표준코드·라벨)</summary>
          <DoclingPreviewList preview={source.preview} highlightIds={highlightIds} />
        </details>
      )}

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
