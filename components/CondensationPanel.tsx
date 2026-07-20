"use client";

// 우측 패널 · 결로(습기) 지역별 분석 시나리오.
// 아우터 렌즈 ↔ 결로·습기 실패모드를 앵커로, 지역 탭(아시아/유럽/북미/중국)마다
// GET /api/condensation?region=KEY 를 불러와 상세(기후·습도·위험도·규제·원인·시험·대책)와
// 단면도(CondensationDrawing)를 함께 렌더링한다. 값은 전부 API 응답 — 하드코딩 없음.
import { useEffect, useState } from "react";
import CondensationDrawing from "./CondensationDrawing";
import PanelHeader from "./PanelHeader";
import { riskColor, type CondensationDetail, type RegionKey, type RegionSummary } from "./condensationTypes";
import { apiFetch } from "@/lib/api-client";

interface CondensationPanelProps {
  regions: RegionSummary[];
  onSelectObject: (id: string) => void;
  onOpenEvidence: (filename: string) => void;
  onClose: () => void;
}

export default function CondensationPanel({ regions, onSelectObject, onOpenEvidence, onClose }: CondensationPanelProps) {
  const [activeRegion, setActiveRegion] = useState<RegionKey>("asia");
  const [detail, setDetail] = useState<CondensationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/condensation?region=${encodeURIComponent(activeRegion)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`지역 상세 조회 실패 (${res.status})`);
        return res.json() as Promise<CondensationDetail>;
      })
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRegion]);

  return (
    <>
      <PanelHeader title="결로 지역별 분석" onClose={onClose} />
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
        {detail ? detail.anchor.component.label : "아우터 렌즈"} → {detail ? detail.anchor.failure.label : "결로·습기"}
      </h2>
      {detail && (
        <div className="cond-anchor">
          <span className="chip-link" onClick={() => onSelectObject(detail.anchor.component.id)}>
            {detail.anchor.component.label}
          </span>
          {" · "}
          <span className="chip-link" onClick={() => onSelectObject(detail.anchor.housing.id)}>
            {detail.anchor.housing.label}
          </span>
          {" · "}
          <span className="chip-link" onClick={() => onSelectObject(detail.anchor.failure.id)}>
            {detail.anchor.failure.label}
          </span>
        </div>
      )}

      <div className="cond-tabs" role="tablist">
        {regions.map((r) => (
          <button
            key={r.key}
            role="tab"
            aria-selected={activeRegion === r.key}
            className={"cond-tab" + (activeRegion === r.key ? " active" : "")}
            onClick={() => setActiveRegion(r.key)}
          >
            <span className="dot" style={{ background: riskColor(r.riskLevel) }} />
            {r.name}
          </button>
        ))}
      </div>

      {loading && <div className="insp-empty">지역 데이터를 불러오는 중…</div>}
      {error && (
        <div className="insp-empty">
          불러오지 못했습니다.
          <br />
          <span className="k">{error}</span>
        </div>
      )}

      {!loading && !error && detail && (
        <>
          <CondensationDrawing
            drawing={detail.drawing}
            lensLabel={detail.anchor.component.label}
            housingLabel={detail.anchor.housing.label}
            riskLevel={detail.region.riskLevel}
          />

          <div className="cond-kv-row">
            <span className="k">국가</span>
            <span className="v">{detail.region.countries}</span>
          </div>
          <div className="cond-kv-row">
            <span className="k">기후</span>
            <span className="v">{detail.region.climate}</span>
          </div>
          <div className="cond-kv-row">
            <span className="k">습도</span>
            <span className="v">{detail.region.humidity}</span>
          </div>
          <div className="cond-kv-row">
            <span className="k">위험도</span>
            <span className="v">
              <span
                className="cond-risk-badge"
                style={{ background: riskColor(detail.region.riskLevel) + "22", color: riskColor(detail.region.riskLevel) }}
              >
                {detail.region.riskLevel}
              </span>
              <span style={{ marginLeft: 8, color: "var(--ink-faint)" }}>{detail.region.riskNote}</span>
            </span>
          </div>

          {detail.regObject && (
            <div className="cond-kv-row">
              <span className="k">적용 규제</span>
              <span className="v">
                <span className="chip-link" onClick={() => onSelectObject(detail.regObject!.id)}>
                  {detail.regObject.label}
                </span>
                {detail.regObject.props.map(([k, v]) => (
                  <span key={k} style={{ marginLeft: 8, color: "var(--ink-faint)", fontSize: 11 }}>
                    {k}: {v}
                  </span>
                ))}
              </span>
            </div>
          )}

          <div className="sec-label">근본 원인</div>
          <div className="cond-causes">
            {detail.region.causes.map((c, i) => (
              <span className="cond-cause-chip" key={i}>
                {c}
              </span>
            ))}
          </div>

          <div className="sec-label">시험 방법</div>
          <div className="cond-kv-row" style={{ border: "none" }}>
            <span className="v">{detail.region.test}</span>
          </div>

          <div className="sec-label">권장 대책</div>
          {detail.region.actions.map((a, i) => (
            <div className="cond-action" key={i}>
              <span
                className={"al" + (a.id ? " clickable" : "")}
                onClick={a.id ? () => onSelectObject(a.id) : undefined}
              >
                {a.label}
              </span>
              <span className="an">— {a.note}</span>
            </div>
          ))}

          {detail.relatedActions.length > 0 && (
            <>
              <div className="sec-label">온톨로지 내 관련 조치</div>
              <div className="cond-related">
                {detail.relatedActions.map((a) => (
                  <span className="cond-evd-chip" key={a.id} onClick={() => onSelectObject(a.id)}>
                    {a.label}
                  </span>
                ))}
              </div>
            </>
          )}

          {detail.evidence.length > 0 && (
            <>
              <div className="sec-label">근거 문서</div>
              <div className="cond-related">
                {detail.evidence.map((file, i) => (
                  <span className="cond-evd-chip" key={i} onClick={() => onOpenEvidence(file)} title="클릭하면 원천 파일 정형화 미리보기를 엽니다">
                    {file}
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
