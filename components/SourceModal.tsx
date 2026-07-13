"use client";

// 근거 문서 미리보기 — 원천 파일 클릭 시 전체 화면 모달로 크게 표시.
// xlsx는 실제 표(<table>)로, pptx/docx/pdf는 텍스트 라인으로, dxf는 도면 이미지로 렌더한다.
// 답변이 인용한 라벨 토큰을 원문에서 강조(셀 배경 cell-hl / 라인 내 <mark ft-hl>)하고 첫 강조로 스크롤.
// (기존 SourcePreview 의 hlRegex·markLine·fetch 상태머신·도면 뷰 로직을 모달로 이식.)
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SourceInfo } from "./sourceTypes";

interface SourceModalProps {
  source: SourceInfo;
  highlightIds?: Set<string>;
  onClose: () => void;
}

interface SourceBlock {
  label: string;
  lines: string[];
  rows?: string[][];
}
interface SourceText {
  file: string;
  format: string;
  blocks: SourceBlock[];
}

type FtStatus = "loading" | "ok" | "unsupported" | "error";

export default function SourceModal({ source, highlightIds, onClose }: SourceModalProps) {
  const kb = Math.max(1, Math.round(source.sizeBytes / 1024));
  const bodyRef = useRef<HTMLDivElement>(null);

  const drawingUrl = /\.dxf$/i.test(source.file)
    ? `/api/drawing-svg?file=${encodeURIComponent(source.file)}`
    : null;

  // ESC 로 닫기 + 배경 스크롤 잠금.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
  const hlTokens = useMemo(
    () =>
      highlightIds
        ? [...highlightIds]
            .filter((t) => typeof t === "string" && t.trim().length >= 2)
            .sort((a, b) => b.length - a.length)
        : [],
    [highlightIds],
  );
  const hlRegex = useMemo(() => {
    if (hlTokens.length === 0) return null;
    const esc = hlTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`(${esc.join("|")})`, "gi");
  }, [hlTokens]);
  // 셀(표) 부분매칭 판정 — /g 정규식은 lastIndex 상태가 있어 재사용 위험 → 소문자 includes 로 별도 판정.
  const hlLower = useMemo(() => hlTokens.map((t) => t.toLowerCase()), [hlTokens]);
  const cellHit = (s: string) => {
    if (hlLower.length === 0) return false;
    const low = s.toLowerCase();
    return hlLower.some((t) => low.includes(t));
  };

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

  // 블록 렌더 + 강조 개수 집계(한 패스). xlsx(rows)는 표, 그 외는 라인.
  const { blockNodes, hlCount } = useMemo(() => {
    if (!ft) return { blockNodes: null as ReactNode, hlCount: 0 };
    let count = 0;
    const blockNodes = ft.blocks.map((block, bi) => {
      if (block.rows && block.rows.length > 0) {
        const [head, ...body] = block.rows;
        return (
          <div className="sm-block" key={bi}>
            <div className="sm-block-label">{block.label}</div>
            <div className="sm-table-wrap">
              <table className="sm-table">
                <thead>
                  <tr>
                    {head.map((h, ci) => (
                      <th key={ci}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => {
                        const hit = cellHit(cell);
                        if (hit) count++;
                        return (
                          <td key={ci} className={hit ? "cell-hl" : undefined}>
                            {cell}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }
      return (
        <div className="sm-block" key={bi}>
          <div className="sm-block-label">{block.label}</div>
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
      );
    });
    return { blockNodes, hlCount: count };
    // markLine·cellHit 는 hlRegex/hlLower 에만 의존 → deps 에 ft·hlRegex·hlLower.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ft, hlRegex, hlLower]);

  const wantedHl = !!highlightIds && highlightIds.size > 0;

  // 첫 강조(셀 또는 라인)로 자동 스크롤.
  useEffect(() => {
    if (ftStatus !== "ok" || hlCount === 0) return;
    const first = bodyRef.current?.querySelector<HTMLElement>('td.cell-hl, .ft-line[data-hl="1"]');
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [source.file, ftStatus, hlCount]);

  return (
    <div className="sm-overlay" role="dialog" aria-label={`${source.file} 원문`} onClick={onClose}>
      <div className="sm-card" onClick={(e) => e.stopPropagation()}>
        <div className="sm-header">
          <div className="sm-head-main">
            <span className="tp" style={{ background: "var(--c-doc)" }}>
              {source.type}
            </span>
            <h2 className="sm-title">{source.file}</h2>
          </div>
          <div className="sm-head-meta">
            크기 {kb} KB · 객체 {source.extracted.objects} · 관계 {source.extracted.relations}
            {wantedHl && hlCount > 0 && <span className="sm-hl-badge">🔎 {hlCount}곳 언급 강조</span>}
          </div>
          <button type="button" className="sm-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="sm-body" ref={bodyRef}>
          {drawingUrl ? (
            <>
              <div className="sm-block-label">도면 미리보기</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="sm-drawing" src={drawingUrl} alt={`${source.file} 도면 미리보기`} />
            </>
          ) : (
            <>
              {ftStatus === "loading" && <div className="ft-loading">원문 불러오는 중…</div>}
              {ftStatus === "unsupported" && (
                <div className="ft-loading">이 형식은 원문 텍스트 미리보기를 지원하지 않습니다.</div>
              )}
              {ftStatus === "error" && (
                <div className="ft-error">원문을 불러올 수 없습니다: {ftError}</div>
              )}
              {ftStatus === "ok" && (
                <>
                  {wantedHl && hlCount === 0 && (
                    <div className="src-hl-note">인용 언급을 원문에서 찾지 못했습니다.</div>
                  )}
                  {blockNodes}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
