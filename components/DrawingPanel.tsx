"use client";

// 우측 패널 · 도면 분석 결과 — "이 도면과 닮은 과거 설계가 있었나"에 답하는 화면.
// 추출 요약(제목블록·형상 특징) + 형상 유사 설계 카드(유사도%·일치 근거·고장 이력·차종) +
// [이 조건으로 추론 실행]. 유사도는 형상 특징 기반(shape-sim) — 차명이 아니라 형상이 기준.
import type { DesignInput } from "@/lib/types";

export interface SimilarDesign {
  projId: string;
  projLabel: string;
  vehicle: string;
  score: number;
  matched: string[];
  differed: string[];
  history: { fmId: string; fmLabel: string }[];
}

export interface DrawingResult {
  ok: boolean;
  file: string;
  drawing?: { labels: Record<string, string>; features: Record<string, string> };
  vulnerabilities?: { level: "높음" | "주의"; title: string; detail: string }[];
  conditions: Partial<DesignInput> | null;
  similar: SimilarDesign[];
  note?: string;
}

interface DrawingPanelProps {
  loading: boolean;
  error: string | null;
  result: DrawingResult | null;
  onSelectObject: (id: string) => void;
  onApplyConditions: (c: Partial<DesignInput>) => void;
  onClose: () => void;
  onPickFile: () => void;
  onSample: () => void;
}

export default function DrawingPanel({ loading, error, result, onSelectObject, onApplyConditions, onClose, onPickFile, onSample }: DrawingPanelProps) {
  if (loading) {
    return (
      <>
        <div className="sec-label">도면 분석</div>
        <div className="insp-empty">도면을 파싱하고 형상 유사 설계를 탐색하는 중…</div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <div className="sec-label">도면 분석</div>
        <div className="insp-empty">
          도면 분석에 실패했습니다.
          <br />
          <span className="k">{error}</span>
        </div>
      </>
    );
  }
  if (!result) {
    return (
      <>
        <div className="sec-label">도면 분석</div>
        <button className="cond-btn" onClick={onPickFile}>📐 도면 파일 선택 (.dxf)</button>
        <button className="cond-btn" onClick={onSample}>▶ 샘플 도면 추가 — 신규 리어 콤비램프</button>
        <div className="insp-empty" style={{ marginTop: 10 }}>
          도면을 추가하면 제목블록·형상 특징·BOM 이 파싱되어 온톨로지에 합류하고(신규 객체·관계는
          그래프에 빨간 강조로 스폰), 형상 유사 과거 설계와 발생 이력을 탐색합니다.
        </div>
      </>
    );
  }

  const labels = result.drawing?.labels ?? {};
  const features = result.drawing?.features ?? {};

  return (
    <>
      <div className="sec-label">도면 분석</div>
      <div className="obj-head">
        <span className="tp" style={{ background: "var(--c-doc)" }}>DXF</span>
        <h2 style={{ wordBreak: "break-all" }}>{result.file}</h2>
      </div>

      <div className="kv" style={{ marginBottom: 4 }}>
        {["부품명", "프로젝트", "차종", "소재"].map((k) =>
          labels[k] ? (
            <span key={k} style={{ display: "contents" }}>
              <span className="k">{k}</span>
              <span className="v">{labels[k]}</span>
            </span>
          ) : null
        )}
      </div>

      {Object.keys(features).length > 0 ? (
        <>
          <div className="sec-label">형상 특징 (도면 NOTE)</div>
          <div className="stats" style={{ margin: "6px 0 8px" }}>
            {Object.entries(features).map(([k, v]) => (
              <span className="stat" key={k}>
                {k} <b>{v}</b>
              </span>
            ))}
          </div>
        </>
      ) : null}

      {result.note ? <div className="insp-empty">{result.note}</div> : null}

      {result.vulnerabilities && result.vulnerabilities.length > 0 ? (
        <>
          <div className="sec-label">설계 취약점 검사</div>
          {result.vulnerabilities.map((v, i) => (
            <div className="sim-card" key={i} style={{ background: v.level === "높음" ? "#fef6f5" : "#fffdf5" }}>
              <div className="sim-head">
                <span className={"sim-chip " + (v.level === "높음" ? "diff" : "ok")} style={v.level === "주의" ? { background: "#fff8e8", color: "#9a7b1a", borderColor: "#efe2b8" } : undefined}>
                  {v.level}
                </span>
                <b style={{ fontSize: 12.5 }}>{v.title}</b>
              </div>
              <div className="sim-hist" style={{ marginTop: 4 }}>{v.detail}</div>
            </div>
          ))}
        </>
      ) : null}

      {result.similar.length > 0 ? (
        <>
          <div className="sec-label">형상 유사 과거 설계 — 차명이 아니라 형상 기준</div>
          {result.similar.map((s) => (
            <div className="sim-card" key={s.projId}>
              <div className="sim-head">
                <span className="sim-proj" onClick={() => onSelectObject(s.projId)}>
                  {s.projLabel}
                </span>
                {s.vehicle ? <span className="sim-vehicle">{s.vehicle}</span> : null}
                <span className="sim-score">{Math.round(s.score * 100)}%</span>
              </div>
              <div className="cf" style={{ margin: "4px 0 6px" }}>
                <div className="bar">
                  <i style={{ width: `${Math.round(s.score * 100)}%` }} />
                </div>
                <span className="cv">형상 유사</span>
              </div>
              <div className="sim-chips">
                {s.matched.slice(0, 4).map((m, i) => (
                  <span className="sim-chip ok" key={i}>✓ {m}</span>
                ))}
                {s.differed.slice(0, 2).map((m, i) => (
                  <span className="sim-chip diff" key={i}>≠ {m}</span>
                ))}
              </div>
              {s.history.length > 0 ? (
                <div className="sim-hist">
                  발생 이력:{" "}
                  {s.history.map((h, i) => (
                    <span key={h.fmId}>
                      {i > 0 ? " · " : ""}
                      <span className="sim-hist-fm" onClick={() => onSelectObject(h.fmId)}>
                        {h.fmLabel}
                      </span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="sim-hist none">발생 이력 없음</div>
              )}
            </div>
          ))}
        </>
      ) : null}

      {result.conditions ? (
        <button className="cond-btn" onClick={() => onApplyConditions(result.conditions!)}>
          ▶ 이 조건으로 추론 실행 — 체크리스트·FMEA 초안
        </button>
      ) : null}
      <button className="btn btn-ghost src-prev-close" onClick={onClose}>
        ← 인스펙터로
      </button>
    </>
  );
}
