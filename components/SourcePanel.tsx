"use client";

// 좌측 패널 · 원천 데이터(실데이터, GET /api/sources) / Docling 파이프 설명 / 유형 범례.
// 데모의 하드코딩된 카운트(엑셀 412건 등)를 실제 적재 대상 파일 목록으로 대체 —
// STAGE 1(온톨로지 구축 전)에도 "흩어진 원천"이 실제 데이터임을 보여준다.
import type { GraphCounts } from "./Graph";
import type { ObjType } from "@/lib/types";
import type { SourceInfo } from "./sourceTypes";

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

const TYPE_LABEL: Record<string, string> = {
  XLSX: "엑셀 시트",
  PPTX: "프레젠테이션",
  DOCX: "워드 문서",
  DXF: "2D 도면",
};

interface SourcePanelProps {
  counts: GraphCounts;
  sources: SourceInfo[];
  sourcesLoading: boolean;
  sourcesError: string | null;
  onSelectSource: (file: string) => void;
}

export default function SourcePanel({
  counts,
  sources,
  sourcesLoading,
  sourcesError,
  onSelectSource,
}: SourcePanelProps) {
  const byType = new Map<string, number>();
  for (const s of sources) byType.set(s.type, (byType.get(s.type) ?? 0) + 1);

  return (
    <aside className="side left">
      <div className="sec-label">원천 데이터 · 정형화 전</div>
      {sourcesLoading && (
        <div className="insp-empty" style={{ padding: "4px 2px", fontSize: 12 }}>
          불러오는 중…
        </div>
      )}
      {!sourcesLoading && sources.length === 0 && (
        <>
          <div className="src-total">
            <span>합계</span>
            <b>0건 (시드 폴백)</b>
          </div>
          <div className="insp-empty" style={{ padding: "4px 2px 8px", fontSize: 11.5 }}>
            원천 파일 목록을 가져오지 못했습니다. 온톨로지는 시드 데이터로 계속 동작합니다.
            {sourcesError ? (
              <>
                <br />
                <span className="k">{sourcesError}</span>
              </>
            ) : null}
          </div>
        </>
      )}
      {!sourcesLoading && sources.length > 0 && (
        <>
          {[...byType.entries()].map(([type, count]) => (
            <div className="src-row" key={type}>
              <span className="ext">{type}</span>
              <span className="nm">{TYPE_LABEL[type] ?? type}</span>
              <span className="ct">{count}</span>
            </div>
          ))}
          <div className="src-total">
            <span>합계</span>
            <b>{sources.length.toLocaleString()}건</b>
          </div>

          <div className="sec-label">원천 파일 — 클릭하면 정형화 미리보기</div>
          <div>
            {sources.map((s) => (
              <div
                className="src-row src-row-file"
                key={s.file}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSource(s.file)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectSource(s.file);
                  }
                }}
              >
                <span className="ext">{s.type}</span>
                <span className="nm" title={s.file}>
                  {s.file}
                </span>
                <span className="ct">
                  {Math.max(1, Math.round(s.sizeBytes / 1024))}KB · {s.extracted.objects}개
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="pipe">
        <div className="arrow">▼</div>
        <div className="t">
          <b>Docling 정형화</b>
          <br />
          추출 → 항목화 → 정규화 → 분류
        </div>
        <div className="arrow" style={{ marginTop: 4 }}>
          ▼
        </div>
        <div className="t">
          <b>지식 온톨로지</b> 실시간 적재
        </div>
      </div>
      <div className="sec-label">온톨로지 객체 유형</div>
      <div className="legend">
        {LEGEND.map((l) => (
          <div className="lg" key={l.t}>
            <span className="dot" style={{ background: l.color }} />
            {l.label}
            <span className="n">{counts.byType[l.t] ?? 0}</span>
          </div>
        ))}
      </div>
      <div className="sec-label">연결 유형</div>
      <div style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 2 }}>
        발생 가능한 고장 · 원인
        <br />
        개선·완화 조치 · 적용 법규
        <br />
        프로젝트 유사도 <span style={{ color: "var(--amber)" }}>← 형상 기준</span>
        <br />
        참조 표준 · 근거 문서
      </div>
    </aside>
  );
}
