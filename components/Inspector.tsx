"use client";

// 우측 패널 · 객체 인스펙터 — FMEA 요약 카드.
// 관계를 CAUSED_BY 등 내부 관계명 나열이 아니라 대상 품목/주요 원인/추천 조치/근거 문서 등
// 업무 언어 그룹으로 번역해 보여준다(내부 데이터는 그대로, 표시만 치환 — relLabels.ts).
// + 탐색 히스토리(뒤로 가기 / 경유 관계 브레드크럼) 내비게이션.
import { Fragment, useState } from "react";
import type { ObjectDetail, Rel } from "@/lib/types";
import { TYPES, TYPE_NAMES } from "./typeStyles";
import { groupRelations, relKo } from "./relLabels";

/** 탐색 히스토리 한 항목 — via는 "어떻게 이 객체에 도달했는가"(관계명+방향 또는 진입 경로 태그). */
export interface NavEntry {
  id: string;
  label: string;
  via: string;
  /** 새 진입점(그래프 캔버스 클릭/검색/자연어 검색) — 브레드크럼 트레일을 여기서부터 다시 시작한다. */
  fresh: boolean;
}

interface InspectorProps {
  loading: boolean;
  error: string | null;
  obj: ObjectDetail | null;
  history: NavEntry[];
  onGo: (id: string, via?: string) => void;
  onBack: () => void;
  onJumpTo: (index: number) => void;
  onOpenCondensation?: () => void;
  /** 다음 액션: 이 고장모드/원인을 신규 설계 조건에 리스크로 반영 */
  onAddToCondition?: (label: string) => void;
  /** 이미 조건에 반영된 리스크 라벨(shape 항목) — 버튼 상태 표시용 */
  conditionRisks?: string[];
  /** 근거 문서 클릭 → 원천 미리보기(SourcePreview)로 이동 */
  onOpenDoc?: (filename: string) => void;
  /** 미리보기가 가능한 원천 파일명 목록 — 있으면 해당 행만 클릭 가능 표시 */
  sourceFiles?: string[];
  /** 큐레이션 — 노드 삭제 / 관계 삭제 / 병합 시작(다음 클릭 노드로 병합) */
  onDeleteNode?: (id: string, label: string) => void;
  onDeleteRel?: (src: string, rel: string, dst: string, currentId: string) => void;
  onMergeStart?: (id: string, label: string) => void;
}

/** 결로 지역별 분석 시나리오의 진입점이 되는 객체(아우터 렌즈 / 결로·습기). */
const CONDENSATION_ENTRY_IDS = new Set(["ILENS", "FMFOG"]);

/** 브레드크럼에 접지 않고 보여줄 최대 항목 수. 넘치면 앞쪽을 "…"로 접는다. */
const MAX_CRUMBS = 4;

function InspectorNav({
  history,
  onBack,
  onJumpTo,
}: {
  history: NavEntry[];
  onBack: () => void;
  onJumpTo: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (history.length === 0) return null;

  // 브레드크럼은 마지막 fresh 진입점부터의 연속 체인만 보여준다(뒤로 가기는 전체 flat 히스토리 사용).
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].fresh) {
      start = i;
      break;
    }
  }
  const trail = history.slice(start);
  const overflow = !expanded && trail.length > MAX_CRUMBS;
  const visible = overflow ? trail.slice(trail.length - MAX_CRUMBS) : trail;
  const visStart = start + (trail.length - visible.length);

  return (
    <div className="insp-nav">
      <button
        type="button"
        className="insp-back"
        disabled={history.length < 1}
        onClick={onBack}
        title="이전 객체로 돌아가기 (처음이면 부품 전체 보기)"
        aria-label="뒤로"
      >
        ←
      </button>
      <div className="insp-crumbs">
        {overflow ? (
          <span
            className="insp-crumb-ellipsis"
            title={`앞의 ${trail.length - visible.length}개 항목 펼치기`}
            onClick={() => setExpanded(true)}
          >
            …
          </span>
        ) : null}
        {visible.map((e, i) => {
          const abs = visStart + i;
          const isCurrent = abs === history.length - 1;
          return (
            <Fragment key={`${abs}-${e.id}`}>
              {i > 0 || overflow ? <span className="insp-crumb-via">{e.via}</span> : null}
              <span
                className={"insp-crumb" + (isCurrent ? " current" : "")}
                title={e.label}
                onClick={isCurrent ? undefined : () => onJumpTo(abs)}
              >
                {e.label}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default function Inspector({
  loading,
  error,
  obj,
  history,
  onGo,
  onBack,
  onJumpTo,
  onOpenCondensation,
  onAddToCondition,
  conditionRisks,
  onOpenDoc,
  sourceFiles,
  onDeleteNode,
  onDeleteRel,
  onMergeStart,
}: InspectorProps) {
  const nav = <InspectorNav history={history} onBack={onBack} onJumpTo={onJumpTo} />;

  if (loading) {
    return (
      <>
        <div className="sec-label">객체 인스펙터</div>
        {nav}
        <div className="insp-empty">불러오는 중…</div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <div className="sec-label">객체 인스펙터</div>
        {nav}
        <div className="insp-empty">
          객체 정보를 불러오지 못했습니다.
          <br />
          <span className="k">{error}</span>
        </div>
      </>
    );
  }
  if (!obj) {
    return (
      <>
        <div className="sec-label">객체 인스펙터</div>
        <div className="insp-empty">
          온톨로지 구축을 시작하면 문서가 실시간으로 객체·관계로 변환됩니다.
          <br />
          <br />
          노드를 <span className="k">클릭</span>하면 속성·근거·관계, <span className="k">드래그</span>하면 이동,{" "}
          <span className="k">호버</span>하면 이웃이 하이라이트됩니다.
          <br />
          <br />
          <span className="k">온톨로지의 약속:</span> 모든 객체는{" "}
          <b style={{ color: "var(--amber)" }}>원본 문서를 근거로</b> 연결되며, 원본 코드값은 덮어쓰지 않고 표준
          매핑·확신도를 함께 보존합니다.
        </div>
      </>
    );
  }

  const tp = TYPES[obj.type];
  const rels = obj.relations ?? [];
  const evidence = obj.evidence ?? [];
  const groups = groupRelations(rels);

  // 속성을 카드 섹션으로 분류: 영향 · 위험도(S/O/D/RPN) · 나머지 속성.
  const props = obj.props ?? [];
  const isRiskKey = (k: string) => /심각도|발생도|검출도/.test(k) || k.trim() === "RPN";
  const riskProps = props.filter(([k]) => isRiskKey(k));
  const effectProps = props.filter(([k]) => k === "영향");
  const otherProps = props.filter(([k]) => !isRiskKey(k) && k !== "영향");
  const riskLabel = (k: string) => (k.trim() === "RPN" ? "위험 우선순위 RPN" : k);

  // 상위 맥락 브레드크럼: 이 객체를 소유/포함하는 부모(대상 품목·상위 구성)를 경로로 표시.
  const parentRel =
    rels.find((r) => r.rel === "HAS_FAILURE" && r.dir === "in") ??
    rels.find((r) => r.rel === "CONSISTS_OF" && r.dir === "in");

  // 다음 액션: 고장모드/원인은 신규 설계 조건에 리스크로 반영할 수 있다.
  const riskable = obj.type === "fm" || obj.type === "cause";
  const riskTag = `${obj.label} 리스크`;
  const riskAdded = (conditionRisks ?? []).includes(riskTag);

  return (
    <>
      <div className="sec-label">객체 인스펙터</div>
      {nav}
      {parentRel ? (
        <div className="obj-context">
          <span className="obj-context-link" onClick={() => onGo(parentRel.other, relKo(parentRel.rel))}>
            {parentRel.otherLabel}
          </span>
          <span className="obj-context-sep">›</span>
          {TYPE_NAMES[obj.type]}
          <span className="obj-context-sep">›</span>
          <b>{obj.label}</b>
        </div>
      ) : null}
      <div className="obj-head">
        <span className="tp" style={{ background: tp.c }}>
          {tp.g}
        </span>
        <h2>
          <span className="obj-type-name">{TYPE_NAMES[obj.type]}:</span> {obj.label}
          {obj.sub ? (
            <span style={{ fontSize: 11, color: "var(--ink-faint)", fontFamily: "var(--mono)" }}> {obj.sub}</span>
          ) : null}
        </h2>
        {onMergeStart || onDeleteNode ? (
          <div className="obj-actions">
            {onMergeStart ? (
              <button type="button" className="obj-act" title="다른 객체에 병합 — 클릭 후 대상 노드를 클릭하세요(원본 라벨은 '병합됨'으로 보존)" onClick={() => onMergeStart(obj.id, obj.label)}>
                ⇄ 병합
              </button>
            ) : null}
            {onDeleteNode ? (
              <button type="button" className="obj-act obj-act-del" title="객체 삭제(연결 관계 포함)" onClick={() => onDeleteNode(obj.id, obj.label)}>
                🗑 삭제
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 연결 요약 — 관계 원문 나열 대신 업무 언어 그룹별 집계 */}
      {rels.length + evidence.length > 0 ? (
        <div className="stats" style={{ margin: "8px 0 4px" }}>
          <span className="stat">
            연결 정보 <b>{rels.length + evidence.length}</b>개
          </span>
          {groups.slice(0, 4).map((g) => (
            <span className="stat" key={g.title}>
              {g.title} <b>{g.rels.length}</b>
            </span>
          ))}
          {evidence.length > 0 ? (
            <span className="stat">
              근거 문서 <b>{evidence.length}</b>
            </span>
          ) : null}
        </div>
      ) : null}

      {effectProps.length > 0 ? (
        <>
          <div className="sec-label">영향</div>
          <div className="kv">
            {effectProps.map(([, v], i) => (
              <span className="v" style={{ gridColumn: "1 / -1" }} key={i}>
                {v}
              </span>
            ))}
          </div>
        </>
      ) : null}

      {riskProps.length > 0 ? (
        <>
          <div className="sec-label">위험도</div>
          <div className="kv">
            {riskProps.map(([k, v], i) => (
              <Fragment key={i}>
                <span className="k">{riskLabel(k)}</span>
                <span className="v">{v}</span>
              </Fragment>
            ))}
          </div>
        </>
      ) : null}

      {groups.map((g) => (
        <RelGroupSection key={g.title} group={g} onGo={onGo} onDeleteRel={onDeleteRel} currentId={obj.id} />
      ))}

      {otherProps.length > 0 ? (
        <>
          <div className="sec-label">속성</div>
          <div className="kv">
            {otherProps.map(([k, v], i) => (
              <Fragment key={i}>
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </Fragment>
            ))}
          </div>
        </>
      ) : null}

      {evidence.length > 0 ? (
        <>
          <div className="sec-label">근거 문서 {evidence.length}</div>
          {evidence.slice(0, 10).map((d) => {
            const openable = !!onOpenDoc && (sourceFiles?.includes(d.filename) ?? false);
            return (
              <div
                className={"evd" + (openable ? " evd-click" : "")}
                key={d.id}
                role={openable ? "button" : undefined}
                tabIndex={openable ? 0 : undefined}
                title={openable ? "클릭하면 원천 문서 미리보기를 엽니다" : undefined}
                onClick={openable ? () => onOpenDoc!(d.filename) : undefined}
                onKeyDown={
                  openable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenDoc!(d.filename);
                        }
                      }
                    : undefined
                }
              >
                <span className="ee">{d.ext}</span>
                <span className="rn">{d.filename}</span>
                {openable ? <span className="rel-go">›</span> : null}
              </div>
            );
          })}
          {evidence.length > 10 ? <div className="morerel">… 외 {evidence.length - 10}개 문서</div> : null}
        </>
      ) : null}

      {onOpenCondensation && CONDENSATION_ENTRY_IDS.has(obj.id) ? (
        <button className="cond-btn" onClick={onOpenCondensation}>
          🌫 결로 지역별 분석 →
        </button>
      ) : null}
      {onAddToCondition && riskable ? (
        <button
          className="cond-btn"
          disabled={riskAdded}
          title={
            riskAdded
              ? "이미 신규 설계 조건에 반영되어 있습니다"
              : "이 리스크를 신규 설계 조건에 추가하고 체크리스트를 다시 계산합니다"
          }
          onClick={() => onAddToCondition(obj.label)}
        >
          {riskAdded ? "✓ 신규 설계 조건에 반영됨" : "➕ 신규 설계 조건에 반영"}
        </button>
      ) : null}
    </>
  );
}

/** 관계 그룹 섹션 — 기본 4개 표시, 넘치면 "숨겨진 항목 N개 더 보기"로 펼침. */
const GROUP_PREVIEW = 4;

function RelGroupSection({
  group,
  onGo,
  onDeleteRel,
  currentId,
}: {
  group: { title: string; rels: Rel[] };
  onGo: (id: string, via?: string) => void;
  onDeleteRel?: (src: string, rel: string, dst: string, currentId: string) => void;
  currentId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? group.rels : group.rels.slice(0, GROUP_PREVIEW);
  return (
    <>
      <div className="sec-label">
        {group.title} {group.rels.length > 1 ? group.rels.length : ""}
      </div>
      {shown.map((r, i) => (
        <div className="rel" key={`${r.other}-${i}`} onClick={() => onGo(r.other, relKo(r.rel))}>
          <span className="rn">{r.otherLabel}</span>
          {onDeleteRel && currentId ? (
            <span
              className="rel-del"
              title="이 관계 삭제"
              onClick={(e) => {
                e.stopPropagation();
                const src = r.dir === "out" ? currentId : r.other;
                const dst = r.dir === "out" ? r.other : currentId;
                onDeleteRel(src, r.rel, dst, currentId);
              }}
            >
              ✕
            </span>
          ) : null}
          <span className="rel-go">›</span>
        </div>
      ))}
      {group.rels.length > GROUP_PREVIEW ? (
        <button type="button" className="morerel morerel-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "접기" : `숨겨진 항목 ${group.rels.length - GROUP_PREVIEW}개 더 보기`}
        </button>
      ) : null}
    </>
  );
}
