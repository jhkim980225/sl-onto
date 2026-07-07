"use client";

// 검색창 아래 결과 드롭다운 — GET /api/search 의 hits[]를 유형 glyph/색과 함께 나열.
// 클릭(마우스다운) 시 부모가 그래프 선택·인스펙터 로딩을 수행한다(provenance 이동).
import type { SearchHit } from "@/lib/types";
import { TYPES } from "./typeStyles";

interface SearchResultsProps {
  hits: SearchHit[];
  onSelect: (hit: SearchHit) => void;
}

export default function SearchResults({ hits, onSelect }: SearchResultsProps) {
  if (hits.length === 0) {
    return (
      <div className="search-dd" role="listbox">
        <div className="search-dd-empty">일치하는 객체가 없습니다</div>
      </div>
    );
  }
  return (
    <div className="search-dd" role="listbox">
      {hits.slice(0, 8).map((h) => {
        const tp = TYPES[h.type];
        return (
          <div
            key={h.id}
            className="search-dd-row"
            role="option"
            aria-selected="false"
            tabIndex={0}
            // mousedown(뿐 아니라 preventDefault)으로 처리해 input의 blur보다 먼저 선택을 확정한다.
            onMouseDown={(ev) => {
              ev.preventDefault();
              onSelect(h);
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onSelect(h);
              }
            }}
          >
            <span className="search-dd-glyph" style={{ color: tp.c }}>
              {tp.g}
            </span>
            <span className="search-dd-label">{h.label}</span>
          </div>
        );
      })}
    </div>
  );
}
