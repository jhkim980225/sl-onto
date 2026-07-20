"use client";

// 우측 패널 상단 · 신규 설계 추론 조건 입력 + 실행 (입력→실행→결과 한 컬럼).
// 조건 옵션은 실제 프로젝트 데이터에서 자동 생성(GET /api/design-options) — 시장·광원 드롭다운, 형상 토글 칩.
import { useEffect, useState } from "react";
import type { DesignInput } from "@/lib/types";
import { apiFetch } from "@/lib/api-client";

interface DesignConditionFormProps {
  condition: DesignInput;
  onChange: (next: DesignInput) => void;
  anchorLabel: string | null;
  onRun: () => void;
  running: boolean;
}

interface Options {
  markets: string[];
  lightSources: string[];
  shapes: string[];
}

// fetch 실패·빈 응답 시 폴백(추론이 인식하는 최소 값).
const FALLBACK: Options = {
  markets: ["북미", "유럽", "아시아", "중국", "한국"],
  lightSources: ["LED", "할로겐"],
  shapes: ["슬림", "밀폐형", "곡면", "개방형"],
};

export default function DesignConditionForm({
  condition,
  onChange,
  anchorLabel,
  onRun,
  running,
}: DesignConditionFormProps) {
  const [opts, setOpts] = useState<Options>(FALLBACK);
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/design-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Options | null) => {
        if (cancelled || !d) return;
        // 비어있는 축은 폴백 유지.
        setOpts({
          markets: d.markets?.length ? d.markets : FALLBACK.markets,
          lightSources: d.lightSources?.length ? d.lightSources : FALLBACK.lightSources,
          shapes: d.shapes?.length ? d.shapes : FALLBACK.shapes,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleShape = (s: string) => {
    const has = condition.shape.includes(s);
    onChange({ ...condition, shape: has ? condition.shape.filter((x) => x !== s) : [...condition.shape, s] });
  };

  // 현재 선택값이 옵션에 없으면(과거 조건 등) 그 값도 노출.
  const withCurrent = (list: string[], cur: string) =>
    cur && !list.includes(cur) ? [cur, ...list] : list;
  // 형상 칩 = 데이터 옵션 ∪ 현재 선택된 값(옵션 밖이어도 표시).
  const shapeChips = [...new Set([...opts.shapes, ...condition.shape])];

  return (
    <div className="dc-form">
      <div className="dc-head">설계 조건</div>
      {anchorLabel ? (
        <div className="dc-anchor">
          부품 앵커: <b>{anchorLabel}</b>
        </div>
      ) : null}
      <label className="dc-field">
        <span>시장</span>
        <select value={condition.market} onChange={(e) => onChange({ ...condition, market: e.target.value })} aria-label="시장">
          {withCurrent(opts.markets, condition.market).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="dc-field">
        <span>광원</span>
        <select value={condition.lightSource} onChange={(e) => onChange({ ...condition, lightSource: e.target.value })} aria-label="광원">
          {withCurrent(opts.lightSources, condition.lightSource).map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </label>
      <div className="dc-field dc-field-shape">
        <span>형상</span>
        <div className="dc-chips">
          {shapeChips.map((s) => (
            <button
              key={s}
              type="button"
              className={"dc-chip" + (condition.shape.includes(s) ? " on" : "")}
              onClick={() => toggleShape(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {/* 형상 0개는 서버가 400 으로 거절한다 — 버튼을 막고 이유를 먼저 알린다. */}
      <button className="btn btn-primary dc-run" onClick={onRun} disabled={running || condition.shape.length === 0}>
        {running ? "추론 중…" : "▶ 추론 실행"}
      </button>
      {condition.shape.length === 0 && <div className="dc-hint">형상을 하나 이상 선택하세요.</div>}
    </div>
  );
}
