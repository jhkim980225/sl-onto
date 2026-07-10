"use client";

// 우측 패널 · 자연어 검색 결과.
// 상단 검색창에서 Enter로 제출하면 POST /api/nlsearch 를 호출하고, 그 응답을
// 여기서 렌더링한다. answer(요약)·interpretation(해석)·hits[](관련 객체)를 보여주며,
// hit 클릭 시 부모의 handleNodeClick(id)로 그래프 포커스 + 인스펙터 로딩을 수행한다.
import type { NLSearchResponse } from "@/lib/types";
import { TYPES, TYPE_NAMES } from "./typeStyles";
import PanelHeader from "./PanelHeader";

interface NLSearchPanelProps {
  query: string;
  loading: boolean;
  error: string | null;
  result: NLSearchResponse | null;
  onSelectHit: (id: string) => void;
  onClose: () => void;
}

export default function NLSearchPanel({ query, loading, error, result, onSelectHit, onClose }: NLSearchPanelProps) {
  return (
    <>
      <PanelHeader title="자연어 검색" onClose={onClose} />

      {query && <div className="nls-query">&ldquo;{query}&rdquo;</div>}

      {loading ? (
        <div className="nls-loading">
          <span className="nls-spinner" aria-hidden="true" />
          질의를 이해하고 관련 객체를 찾는 중…
        </div>
      ) : error ? (
        <div className="insp-empty">
          자연어 검색에 실패했습니다.
          <br />
          <span className="k">{error}</span>
        </div>
      ) : result ? (
        <>
          {result.mode === "fallback" && <div className="nls-mode">키워드 기반 폴백 결과</div>}

          <div className="nls-answer">{result.answer}</div>

          {result.interpretation && (
            <div className="nls-interp">
              <span className="nls-interp-icon" aria-hidden="true">
                ⌖
              </span>
              {result.interpretation}
            </div>
          )}

          <div className="sec-label">관련 객체 · {result.hits.length}</div>
          {result.hits.length === 0 ? (
            <div className="insp-empty">관련 객체를 찾지 못했습니다.</div>
          ) : (
            <div className="nls-hits">
              {result.hits.map((h) => {
                const tp = TYPES[h.type];
                return (
                  <button key={h.id} className="nls-hit" onClick={() => onSelectHit(h.id)}>
                    <span className="nls-hit-glyph" style={{ color: tp.c }}>
                      {tp.g}
                    </span>
                    <span className="nls-hit-body">
                      <span className="nls-hit-label">{h.label}</span>
                      <span className="nls-hit-type">{TYPE_NAMES[h.type]}</span>
                    </span>
                    <span className="nls-hit-arrow" aria-hidden="true">
                      →
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="insp-empty">검색 결과가 없습니다.</div>
      )}
    </>
  );
}
