"use client";

// STAGE 1 혼돈 오버레이 — 흩어진 원천 파일 칩 그리드 + CTA 힌트.
// chaosGone/chaosHidden 토글 상태는 Workbench(handleBuildOntology)가 소유하고 props 로 받는다.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { SourceInfo } from "./sourceTypes";

const CHAOS_SAMPLES: [string, string][] = [
  ["XLSX", "FMEA_2016_HL03.xlsx"],
  ["XLSX", "검토시트_수출형.xlsx"],
  ["PPTX", "재발방지_간극.pptx"],
  ["PPTX", "대책서_배광이슈.pptx"],
  ["TIF", "2D스캔_단면_주석.tif"],
  ["BOM", "BOM_HL07_rev4.xlsx"],
  ["PTS", "PTS-8812_클레임"],
  ["PTS", "PTS-9034_외관"],
  ["SPEC", "HKMC_ES_광학.pdf"],
  ["XLSX", "시험결과_방열.xlsx"],
];

interface ChaosChip {
  key: string;
  ext: string;
  fn: string;
  left: number;
  top: number;
  rot: number;
  fx: number;
  fy: number;
  delay: number;
}

function makeChaosChips(samples: [string, string][] = CHAOS_SAMPLES): ChaosChip[] {
  const chips: ChaosChip[] = [];
  const pool = samples.length > 0 ? samples : CHAOS_SAMPLES;
  for (let i = 0; i < 72; i++) {
    const [ext, fn] = pool[i % pool.length];
    const x = 6 + Math.random() * 84;
    const y = 6 + Math.random() * 78;
    chips.push({
      key: `chip${i}`,
      ext,
      fn,
      left: x,
      top: y,
      rot: Number((Math.random() * 8 - 4).toFixed(1)),
      fx: (50 - x) * 6,
      fy: (46 - y) * 6,
      delay: Number((Math.random() * 0.4).toFixed(2)),
    });
  }
  return chips;
}

export default function ChaosOverlay({
  hidden,
  gone,
  sources,
  sourcesLoading,
  sourcesError,
}: {
  hidden: boolean;
  gone: boolean;
  sources: SourceInfo[];
  sourcesLoading: boolean;
  sourcesError: string | null;
}) {
  const [chips, setChips] = useState<ChaosChip[]>(() => makeChaosChips());

  // 혼돈 칩을 실제 파일명으로 재시딩(간단히 가능한 범위 내에서 실데이터화).
  useEffect(() => {
    if (sources.length > 0) setChips(makeChaosChips(sources.map((s) => [s.type, s.file])));
  }, [sources]);

  const sourceTypeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sources) m.set(s.type, (m.get(s.type) ?? 0) + 1);
    return m;
  }, [sources]);

  if (hidden) return null;

  return (
    <>
      <div className="chaos" id="chaos">
        {chips.map((c) => (
          <div
            key={c.key}
            className={"chip" + (gone ? " gone" : "")}
            style={
              {
                left: `${c.left}%`,
                top: `${c.top}%`,
                transform: `rotate(${c.rot}deg)`,
                transitionDelay: `${c.delay}s`,
                "--fx": `${c.fx}px`,
                "--fy": `${c.fy}px`,
              } as CSSProperties
            }
          >
            <span className="x">{c.ext}</span>
            {c.fn}
          </div>
        ))}
      </div>
      <div className="chaos-cta" id="chaosCta" style={{ opacity: gone ? 0 : 1, transition: "opacity .5s" }}>
        <div className="hint">
          {sourcesLoading ? (
            "흩어진 원천 파일을 불러오는 중…"
          ) : sources.length > 0 ? (
            <>
              {[...sourceTypeCounts.entries()].map(([type, count], i) => (
                <span key={type}>
                  {i > 0 && " · "}
                  {type} <b>{count}</b>
                </span>
              ))}{" "}
              — 총 <b>{sources.length}</b>개 파일, 설계자 한 사람이 다 기억할 수 없습니다
            </>
          ) : (
            <>
              원천 파일 없음{sourcesError ? ` (${sourcesError})` : ""} — 시드 데이터로 동작 중
            </>
          )}
        </div>
        {/* 온톨로지 구축 버튼 제거 — 기본 진입이 구축 완료 화면 직행(DB 원본) */}
      </div>
    </>
  );
}
