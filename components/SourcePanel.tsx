"use client";

// 좌측 패널 · 객체 타입 탐색기(팔란티어 Object Explorer). 타입·서브타입 클릭 → 그래프 필터.
// 현재 뷰 요약은 캔버스 우하단 오버뷰 패널이 담당(스코프 구분).
import type { GraphCounts } from "./Graph";
import type { ObjType } from "@/lib/types";

const LEGEND: { t: ObjType; label: string; color: string }[] = [
  { t: "item", label: "부품·구성", color: "var(--c-item)" },
  { t: "fm", label: "고장모드", color: "var(--c-fm)" },
  { t: "cause", label: "원인", color: "var(--c-cause)" },
  { t: "action", label: "조치", color: "var(--c-action)" },
  { t: "reg", label: "법규·인증", color: "var(--c-reg)" },
  { t: "proj", label: "프로젝트", color: "var(--c-proj)" },
  { t: "master", label: "마스터", color: "var(--c-master)" },
  { t: "spec", label: "고객 스펙", color: "var(--c-spec)" },
  { t: "doc", label: "근거 문서", color: "var(--c-doc)" },
];

interface SourcePanelProps {
  counts: GraphCounts;
  /** 객체 타입 탐색기 — 현재 필터 타입(null=전체 앵커) */
  activeType?: ObjType | null;
  /** 타입 클릭 시 그래프를 그 타입으로 필터(같은 타입 재클릭=해제) */
  onSelectType?: (t: ObjType | null) => void;
  /** 서브타입 정의(GET /api/schema) — 라벨 매핑·표시 순서 */
  subtypeDefs?: { type_id: string; st_id: string; label_ko: string }[];
  /** 타입별 서브타입 집계(st_id → 건수, "" = 미분류) — Workbench 가 그래프 데이터에서 계산 */
  stCounts?: Record<string, Record<string, number>>;
  /** 현재 필터 서브타입(st_id 또는 "__none"=미분류, null=타입 전체) */
  activeSubtype?: string | null;
  /** 서브타입 클릭 — st=null 이면 타입 전체로 복귀 */
  onSelectSubtype?: (t: ObjType, st: string | null) => void;
}

export default function SourcePanel({
  counts,
  activeType = null,
  onSelectType,
  subtypeDefs = [],
  stCounts = {},
  activeSubtype = null,
  onSelectSubtype,
}: SourcePanelProps) {
  return (
    <aside className="side left">
      {/* 객체 타입 탐색기 (팔란티어 Object Explorer) — 타입 클릭해 그래프 파고들기 */}
      <div className="sec-label">
        객체 타입 · 클릭해 탐색
        {activeType && onSelectType ? (
          <button className="type-clear" onClick={() => onSelectType(null)}>
            ✕ 전체
          </button>
        ) : null}
      </div>
      <div className="legend">
        {LEGEND.map((l) => {
          const n = counts.byType[l.t] ?? 0;
          const active = activeType === l.t;
          // 서브타입 트리 — 타입을 펼친(필터 활성) 동안만 그 타입 아래에 표시(형식 온톨로지 1차).
          // 메타모델 순서대로, 건수 0 서브타입은 생략, st 없는 노드는 "미분류" 그룹으로 마지막에.
          const defs = subtypeDefs.filter((s) => s.type_id === l.t);
          const cnt = stCounts[l.t] ?? {};
          const subRows: { st: string; label: string; n: number }[] = active && defs.length > 0
            ? [
                ...defs.map((s) => ({ st: s.st_id, label: s.label_ko, n: cnt[s.st_id] ?? 0 })).filter((r) => r.n > 0),
                ...((cnt[""] ?? 0) > 0 ? [{ st: "__none", label: "미분류", n: cnt[""] }] : []),
              ]
            : [];
          return (
            <div className="lg-group" key={l.t}>
              <button
                className={"lg lg-btn" + (active ? " active" : "")}
                disabled={!onSelectType || n === 0}
                onClick={() => onSelectType?.(active ? null : l.t)}
                title={`${l.label} ${n}개만 그래프에 표시`}
              >
                <span className="dot" style={{ background: l.color }} />
                {l.label}
                <span className="n">{n}</span>
              </button>
              {subRows.map((r) => {
                const stActive = activeSubtype === r.st;
                return (
                  <button
                    className={"lg lg-btn lg-sub" + (stActive ? " active" : "")}
                    key={r.st}
                    disabled={!onSelectSubtype}
                    onClick={() => onSelectSubtype?.(l.t, stActive ? null : r.st)}
                    title={`${l.label} · ${r.label} ${r.n}개만 그래프에 표시`}
                  >
                    <span className="tick">└</span>
                    {r.label}
                    <span className="n">{r.n}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
