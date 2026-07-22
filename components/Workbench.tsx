"use client";

// FEDA OntoGround 워크벤치 — FMEA_온톨로지_시연_v2.html 의 오케스트레이션(§5~7, DOM 셸)을 이식.
// 하드코딩된 CORE/CORE_EDGES/DOC_RULES/CHECKLIST는 전부 제거하고 API(fetch) 응답으로 대체한다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Graph, { type FocusInfo, type GraphCounts, type GraphHandle, type ViewInfo } from "./Graph";
import ChaosOverlay from "./ChaosOverlay";
import Inspector, { type NavEntry } from "./Inspector";
import Checklist from "./Checklist";
import DesignConditionForm from "./DesignConditionForm";
import SourcePanel from "./SourcePanel";
import LeftRail from "./LeftRail";
import CanvasPanel from "./CanvasPanel";
import SchemaPanel from "./SchemaPanel";
import { reasonOf } from "./apiError";
import DocumentPanel from "./DocumentPanel";
import SourceModal from "./SourceModal";
import Stepper from "./Stepper";
import SearchResults from "./SearchResults";
import CondensationPanel from "./CondensationPanel";
import NLSearchPanel from "./NLSearchPanel";
import IngestPanel from "./IngestPanel";
import DrawingPanel, { type DrawingResult } from "./DrawingPanel";
import ContradictionsPanel from "./ContradictionsPanel";
import AskPanel, { type AskEntry } from "./AskPanel";
import DocAskPanel from "./DocAskPanel";
import QualityPanel from "./QualityPanel";
import ReasonPanel from "./ReasonPanel";
import ViewToggle, { type ViewMode } from "./ViewToggle";
import TableView from "./TableView";
import RawView from "./RawView";
import HierarchyView from "./HierarchyView";
import OverviewPanel from "./OverviewPanel";
import type { View } from "@/lib/view-table";
import type { Capability } from "@/lib/capabilities";
import { buildNodeIndex, type NodeIndex } from "./nodeIndex";
import { useContradictions } from "./useContradictions";
import { useQualityScan } from "./useQualityScan";
import { useReason } from "./useReason";
import type { SourceInfo, SourcesResponse } from "./sourceTypes";
import type { IngestResponse } from "./ingestTypes";
import type { RegionsResponse, RegionSummary } from "./condensationTypes";
import type {
  DesignInput,
  Edge,
  GraphResponse,
  InferResponse,
  NLSearchResponse,
  Node,
  ObjType,
  ObjectDetail,
  SearchHit,
  SearchResponse,
} from "@/lib/types";
import { apiFetch, withCanvasUrl } from "@/lib/api-client";

type Stage = 1 | 2 | 3;

// 결로·습기 데모 기본 조건 — 아우터 렌즈 · 아시아(고온다습) · 밀폐형 하우징.
// 밀폐형 → 결로·벤트 부스트(lib/infer.ts BOOST_FOG)로 체크리스트 최상위에 결로 항목이 온다.
const DEFAULT_CONDITION: DesignInput = {
  market: "아시아",
  lightSource: "LED",
  shape: ["슬림", "밀폐형"], // 데이터 형상 옵션(GET /api/design-options)과 일치 — 칩 중복 방지
  components: ["아우터 렌즈"],
};

/** 좌측 탐색기 서브타입 집계 — 타입별 st_id("" = 미분류) → 건수. doc 은 탐색기 대상 아님. */
function computeStCounts(nodes: Node[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const n of nodes) {
    if (n.type === "doc") continue;
    const m = (out[n.type] ??= {});
    const k = n.st ?? "";
    m[k] = (m[k] ?? 0) + 1;
  }
  return out;
}

/** 체크리스트 항목의 trace(예: "PJ26→SIMILAR→PJ21")에서 실제 그래프 노드 id만 추출. */
function parseTraceIds(trace: string[], idSet: Set<string>): string[] {
  const found = new Set<string>();
  for (const seg of trace) {
    for (const tok of seg.split(/→|->/)) {
      const t = tok.trim();
      if (idSet.has(t)) found.add(t);
    }
  }
  return [...found];
}

interface WorkbenchProps {
  canvas: string; // 현재 캔버스 id — CanvasPanel 활성 표시용(데이터 스코핑은 apiFetch 가 담당)
  onSwitchCanvas: (id: string) => void;
  onReset: () => void;
}

export default function Workbench({ canvas, onSwitchCanvas, onReset }: WorkbenchProps) {
  const graphRef = useRef<GraphHandle | null>(null);
  const graphDataRef = useRef<GraphResponse | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Enter로 자연어 검색을 실행하면 true — 아직 응답 오지 않은 인스턴트 키워드 fetch가
  // 뒤늦게 드롭다운을 다시 열지 않도록 막는다. 다음 타이핑 시 false로 리셋.
  const nlSubmittedRef = useRef(false);
  const staggerTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [stage, setStage] = useState<Stage>(1);
  // 병합 모드 상태를 그래프 클릭 콜백(이른 정의)에서 참조하기 위한 ref
  const mergeSourceRef = useRef<{ id: string; label: string } | null>(null);
  const handleMergeIntoRef = useRef<((id: string) => void) | null>(null);
  const [chaosGone, setChaosGone] = useState(false);
  const [chaosHidden, setChaosHidden] = useState(false);

  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<SourceInfo | null>(null);

  const [buildStarted, setBuildStarted] = useState(false);
  const [ontologyBuilt, setOntologyBuilt] = useState(false);
  const [ontologyError, setOntologyError] = useState<string | null>(null);
  const [graphCounts, setGraphCounts] = useState<GraphCounts>({ nodes: 0, edges: 0, byType: {} });
  // PHASE 1: 전체 온톨로지 규모(뷰와 무관) + 현재 표시 중인 노드 수/뷰 모드.
  const [fullTotals, setFullTotals] = useState<{ nodes: number; edges: number } | null>(null);
  // 객체 타입 탐색기 — 그래프를 특정 타입으로 파고들기(null=기본 앵커 뷰)
  const [leftPanel, setLeftPanel] = useState<string | null>(null); // 좌측 드로어 활성 아이콘(null=접힘)
  const [activeType, setActiveType] = useState<ObjType | null>(null);
  // 서브타입 탐색기(형식 온톨로지 1차) — activeType 아래 st_id 필터("__none"=미분류, null=타입 전체)
  const [activeSt, setActiveSt] = useState<string | null>(null);
  const [stCounts, setStCounts] = useState<Record<string, Record<string, number>>>({});
  // 서브타입 라벨 매핑(GET /api/schema 메타모델) — 구축 완료 후 1회 조회
  const [subtypeDefs, setSubtypeDefs] = useState<{ type_id: string; st_id: string; label_ko: string }[]>([]);
  // 기능 가용성(GET /api/schema capabilities) — 이 캔버스 스키마에 필요한 객체타입이 없으면
  // 해당 기능 버튼을 아예 감춘다. 로드 전에는 {} 라 감춰진 상태로 시작한다(설계 §5).
  const [caps, setCaps] = useState<Partial<Record<Capability, boolean>>>({});
  const [viewInfo, setViewInfo] = useState<ViewInfo | null>(null);
  const [focusInfo, setFocusInfo] = useState<FocusInfo | null>(null);
  // 결과 프레임 — Graph/Table/RAW 토글 + 현재 뷰 스냅샷(Table/RAW/오버뷰 공용).
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [view, setView] = useState<View>({ nodes: [], edges: [] });
  // Graph 읽기전용 게터로 현재 가시 노드/엣지 스냅샷을 당겨온다(토글·포커스/뷰 변화 시).
  const refreshView = useCallback(() => {
    const v = graphRef.current?.getView();
    if (v) setView(v);
  }, []);
  const [ingestVisible, setIngestVisible] = useState(false);
  const [ingestLines, setIngestLines] = useState<string[]>([]);
  const [ingestPct, setIngestPct] = useState(0);

  const [scenarioTriggered, setScenarioTriggered] = useState(false);
  const [condition, setCondition] = useState<DesignInput>(DEFAULT_CONDITION);
  // 마지막 추론에 실제 사용한 입력(anchorItem 포함) — 체크리스트 헤더·FMEA 초안이 이걸 쓴다.
  const [lastInferInput, setLastInferInput] = useState<DesignInput | null>(null);

  const [rightPanelMode, setRightPanelMode] = useState<
    | "inspector"
    | "checklist"
    | "source"
    | "condensation"
    | "nlsearch"
    | "ingest"
    | "drawing"
    | "contradictions"
    | "quality"
    | "reason"
    | "ask"
    | "docask"
  >("inspector");
  // 객체 질문(Q&A) 대화 이력 — 패널이 인스펙터로 전환돼도 유지되도록 Workbench 가 보관.
  const [askHistory, setAskHistory] = useState<AskEntry[]>([]);
  const [condensationRegions, setCondensationRegions] = useState<RegionSummary[] | null>(null);
  const [condensationLoading, setCondensationLoading] = useState(false);
  const [condensationError, setCondensationError] = useState<string | null>(null);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [inspectorObj, setInspectorObj] = useState<ObjectDetail | null>(null);

  const [inferLoading, setInferLoading] = useState(false);
  const [inferError, setInferError] = useState<string | null>(null);
  const [inferResult, setInferResult] = useState<InferResponse | null>(null);
  const [revealedChecklistCount, setRevealedChecklistCount] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [nodeIndex, setNodeIndex] = useState<NodeIndex>(() => new Map());
  // id→label 조회를 handleNodeClick(의존성 없는 콜백) 안에서도 쓰기 위한 ref 미러.
  const nodeIndexRef = useRef<NodeIndex>(new Map());
  // 마지막으로 선택한 노드({id,label,type}) — 신규 설계 추론을 선택 부품(item) 기준으로 돌리기 위함.
  const selectedNodeRef = useRef<{ id: string; label: string; type: ObjType } | null>(null);

  // ── 탐색 히스토리 — 선택할 때마다 {id, label, via} push. 뒤로/크럼 점프는 push 없이 재선택. ──
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);

  // ── 자연어 검색(Enter 제출) 상태 ──
  const [nlQuery, setNlQuery] = useState("");
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlResult, setNlResult] = useState<NLSearchResponse | null>(null);

  // ── 문서 인제스천(증분 반영) 상태 ──
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestResponse | null>(null);
  const [ingestHistory, setIngestHistory] = useState<IngestResponse[]>([]);

  // ── STAGE 1: 실제 원천 파일 목록 조회 (온톨로지 구축 전에도 "흩어진 원천"이 실데이터임을 보여준다) ──
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/sources")
      .then((res) => {
        if (!res.ok) throw new Error(`원천 조회 실패 (${res.status})`);
        return res.json() as Promise<SourcesResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setSources(data.sources);
      })
      .catch((err) => {
        if (cancelled) return;
        setSourcesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setSourcesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 전역 모순 스캔 · 품질 스캔 — 온톨로지 구축 완료 후 상시 조회, 큐레이션 액션 후 refresh 재스캔.
  const {
    items: contradictions,
    loading: contradictionsLoading,
    error: contradictionsError,
    refresh: refreshContradictions,
  } = useContradictions(ontologyBuilt);
  const {
    items: quality,
    loading: qualityLoading,
    error: qualityError,
    refresh: refreshQuality,
    setError: setQualityError,
  } = useQualityScan(ontologyBuilt);
  // pyservice /reason 유도 관계 — 배지("🔗 유도 관계 N건", DB 미반영 조회 전용 오버레이).
  const { derivedRelations, loading: reasonLoading, error: reasonError } = useReason(ontologyBuilt);

  // 서브타입 라벨 매핑(형식 온톨로지 1차) + 기능 가용성 — 같은 /api/schema 한 번으로 둘 다 받는다.
  // 실패해도 탐색기 서브타입 트리·조건부 버튼만 생략(치명 아님).
  // ontologyBuilt 를 기다리지 않는다 — 라우트가 ready() 를 보장하고, 빈 캔버스에서도 캡이 필요하다.
  // 마운트 1회로는 부족하다 — ◈ 스키마에서 타입을 정의하면 새로고침 없이 버튼이 나타나야 한다.
  const refreshCaps = useCallback(() => {
    apiFetch("/api/schema")
      .then((res) => {
        if (!res.ok) throw new Error(`스키마 조회 실패 (${res.status})`);
        return res.json() as Promise<{
          subtypes: { type_id: string; st_id: string; label_ko: string }[];
          capabilities?: Partial<Record<Capability, boolean>>;
        }>;
      })
      .then((d) => {
        setSubtypeDefs(d.subtypes);
        setCaps(d.capabilities ?? {});
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshCaps();
  }, [refreshCaps]);

  // ── 결로 지역별 분석 시나리오 진입 (Inspector에서 아우터 렌즈/결로·습기 선택 시) ──
  const handleOpenCondensation = useCallback(() => {
    setRightPanelMode("condensation");
    if (condensationRegions || condensationLoading) return; // 이미 로드됨/로딩 중이면 재요청하지 않음
    setCondensationLoading(true);
    setCondensationError(null);
    apiFetch("/api/condensation")
      .then((res) => {
        if (!res.ok) throw new Error(`지역 목록 조회 실패 (${res.status})`);
        return res.json() as Promise<RegionsResponse>;
      })
      .then((data) => setCondensationRegions(data.regions))
      .catch((err) => setCondensationError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCondensationLoading(false));
  }, [condensationRegions, condensationLoading]);

  // 근거 문서 칩 클릭 → 원천 파일 정형화 미리보기(SourcePreview)로 이동.
  // highlightIds: 답변이 인용한 객체 id들 — 그 문서에서 해당 추출 행을 강조(질문 답변 근거 확인).
  const [sourceHighlight, setSourceHighlight] = useState<Set<string>>(new Set());
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const handleOpenEvidenceFile = useCallback(
    (file: string, highlightIds?: string[]) => {
      const found = sources.find((s) => s.file === file);
      if (!found) return;
      // 명시 토큰(질문 답변 근거) 없으면, 현재 선택 객체 라벨 + 관계 상대 라벨을 기본 강조로 —
      // 인스펙터·체크리스트에서 근거 문서를 열어도 그 객체 언급이 원문에서 강조되게.
      const tokens =
        highlightIds ??
        (inspectorObj
          ? [inspectorObj.label, ...inspectorObj.relations.map((r) => r.otherLabel)].filter(Boolean)
          : []);
      setSourceHighlight(new Set(tokens));
      setSelectedSource(found);
      setSourceModalOpen(true);
    },
    [sources, inspectorObj]
  );

  // 인스펙터 근거 문서 행의 "미리보기 가능" 판정용 파일명 목록
  const sourceFileNames = useMemo(() => sources.map((s) => s.file), [sources]);

  const stageName = useMemo(() => {
    const names = ["흩어진 원천 데이터", ontologyBuilt ? "온톨로지 구축 완료" : "온톨로지 구축 중", "신규 설계 추론"];
    return names[stage - 1];
  }, [stage, ontologyBuilt]);

  // ── 노드 클릭 → 인스펙터 (모든 선택이 지나는 단일 funnel) ──
  // opts.via   : 어떻게 이 객체에 도달했는지(관계명+방향 또는 진입 태그). 히스토리 항목에 기록.
  // opts.fresh : 새 진입점(그래프 클릭/검색/자연어 검색) — 브레드크럼 트레일을 여기서 다시 시작.
  // opts.push  : false면 히스토리에 push하지 않는다(뒤로 가기/크럼 점프 재선택용 가드).
  const handleNodeClick = useCallback(
    (id: string, opts?: { via?: string; fresh?: boolean; push?: boolean }) => {
      setRightPanelMode("inspector");
      setInspectorLoading(true);
      setInspectorError(null);
      graphRef.current?.selectNode(id);
      const meta = nodeIndexRef.current.get(id);
      selectedNodeRef.current = meta ? { id, label: meta.label, type: meta.type } : null;
      if (opts?.push !== false) {
        const via = opts?.via ?? "선택";
        const fresh = opts?.fresh ?? false;
        setNavHistory((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].id === id) return prev; // 같은 객체 연속 선택은 중복 push 방지
          const label = nodeIndexRef.current.get(id)?.label ?? id;
          return [...prev, { id, label, via, fresh }];
        });
      }
      apiFetch(`/api/object/${encodeURIComponent(id)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`객체 조회 실패 (${res.status})`);
          return res.json() as Promise<ObjectDetail>;
        })
        .then((data) => {
          setInspectorObj(data);
          // 인덱스에 없어서 id로 기록된 라벨을 실제 라벨로 보정(best-effort).
          setNavHistory((prev) =>
            prev.some((e) => e.id === data.id && e.label === e.id)
              ? prev.map((e) => (e.id === data.id && e.label === e.id ? { ...e, label: data.label } : e))
              : prev
          );
        })
        .catch((err) => {
          setInspectorObj(null);
          setInspectorError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setInspectorLoading(false));
    },
    []
  );

  // 그래프 캔버스에서 직접 클릭 — 새 진입점으로 트레일을 리셋한다.
  const handleGraphNodeClick = useCallback(
    (id: string) => {
      if (mergeSourceRef.current) { handleMergeIntoRef.current?.(id); return; } // 병합 모드: 클릭 = 대상 선택
      handleNodeClick(id, { via: "그래프 선택", fresh: true });
    },
    [handleNodeClick]
  );

  // 인스펙터 관계 행 클릭 — via에 관계명+방향("HAS_FAILURE →" / "REF_MASTER ←")이 담겨 온다.
  const handleInspectorGo = useCallback(
    (id: string, via?: string) => handleNodeClick(id, { via: via ?? "선택" }),
    [handleNodeClick]
  );

  // 체크리스트 trace/근거 클릭 — 트레일을 이어간다(진입점 아님).
  const handleChecklistSelect = useCallback(
    (id: string) => handleNodeClick(id, { via: "체크리스트 근거" }),
    [handleNodeClick]
  );

  // 결로 분석 패널의 객체 링크 클릭.
  const handleCondensationSelect = useCallback(
    (id: string) => handleNodeClick(id, { via: "결로 분석" }),
    [handleNodeClick]
  );

  // 모순 스캔 패널의 객체/근거 링크 클릭.
  const handleContradictionSelect = useCallback(
    (id: string) => handleNodeClick(id, { via: "모순 스캔", fresh: true }),
    [handleNodeClick]
  );

  // 품질 스캔 패널의 객체 링크 클릭.
  const handleQualitySelect = useCallback(
    (id: string) => handleNodeClick(id, { via: "품질 스캔", fresh: true }),
    [handleNodeClick]
  );

  // 유도 관계 패널의 객체 링크 클릭.
  const handleReasonSelect = useCallback(
    (id: string) => handleNodeClick(id, { via: "유도 관계", fresh: true }),
    [handleNodeClick]
  );

  // 질문 패널의 근거 관계/[R n] 클릭 — 그래프 포커스만(패널 유지, 인스펙터 전환 없음).
  const handleAskFocus = useCallback((id: string) => {
    graphRef.current?.selectNode(id);
  }, []);

  // ── 뒤로 가기: 현재 항목을 pop하고 직전 항목을 push 없이 재선택(그래프 포커스 포함) ──
  const handleNavBack = useCallback(() => {
    // 루트(항목 1개 이하)에서 뒤로 = 포커스 해제하고 부품(item) 백본으로 복귀.
    if (navHistory.length <= 1) {
      setNavHistory([]);
      setInspectorObj(null);
      graphRef.current?.clearSelection();
      return;
    }
    const next = navHistory.slice(0, -1);
    setNavHistory(next);
    handleNodeClick(next[next.length - 1].id, { push: false });
  }, [navHistory, handleNodeClick]);

  // ── 브레드크럼 점프: 해당 항목까지 히스토리를 잘라내고 push 없이 재선택 ──
  const handleNavJumpTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= navHistory.length - 1) return; // 마지막(현재) 항목은 no-op
      const next = navHistory.slice(0, index + 1);
      setNavHistory(next);
      handleNodeClick(next[next.length - 1].id, { push: false });
    },
    [navHistory, handleNodeClick]
  );

  // ── STAGE 1 → 2: 온톨로지 구축 시작 (instant = ?update=1 직행 진입, 연출 스킵) ──
  const handleBuildOntology = useCallback(
    (instant = false) => {
      if (buildStarted) return;
      setBuildStarted(true);
      setChaosGone(true);
      if (instant) setChaosHidden(true);
      else setTimeout(() => setChaosHidden(true), 800);
      setStage(2);
      setIngestVisible(!instant);
      setOntologyError(null);

      apiFetch("/api/ontology")
        .then((res) => {
          if (!res.ok) throw new Error(`온톨로지 조회 실패 (${res.status})`);
          return res.json() as Promise<GraphResponse>;
        })
        .then((data) => {
          // 기본 진입 시 특정 노드(헤드램프 어셈블리 등) 강조(hero 박스·글로우) 해제 —
          // 어떤 노드도 미리 선택된 것처럼 보이지 않게 한다.
          for (const n of data.nodes) if (n.hero) n.hero = false;
          graphDataRef.current = data;
          setFullTotals({ nodes: data.nodes.length, edges: data.edges.length });
          setStCounts(computeStCounts(data.nodes));
          const idx = buildNodeIndex(data.nodes);
          nodeIndexRef.current = idx;
          setNodeIndex(idx);
          graphRef.current?.buildOntology(
            data.nodes,
            data.edges,
            {
              onLog: (html) => setIngestLines((prev) => [...prev, html].slice(-7)),
              onCounts: setGraphCounts,
              onProgress: setIngestPct,
              onDone: () => {
                setOntologyBuilt(true);
                setTimeout(() => setIngestVisible(false), instant ? 0 : 2600);
              },
            },
            { instant }
          );
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          setOntologyError(msg);
          setIngestLines((prev) => [...prev, `<span style="color:#FF5470">[docling] 오류 — ${msg}</span>`]);
        });
    },
    [buildStarted]
  );

  // ── 기본 진입 = 구축 완료 화면 직행(카오스·구축버튼·연출 스킵) ──
  // DB 가 원본이라 매 진입마다 구축 연출은 불필요. (구 ?update=1 은 하위호환으로 동일 동작)
  const autoBuildRef = useRef(false);
  useEffect(() => {
    if (autoBuildRef.current) return;
    autoBuildRef.current = true;
    handleBuildOntology(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── STAGE 2 → 3: 신규 설계 추론 시연 ──
  const handleRunScenario = useCallback(() => {
    if (!ontologyBuilt) return;
    const firstRun = !scenarioTriggered; // 최초만 그래프 웨이브 연출, 재실행은 체크리스트만 갱신
    // 선택한 노드가 부품(item)이면 그 부품 기준으로 추론(anchorItem 명시). 없으면 기본 조건.
    const sel = selectedNodeRef.current;
    const inferInput: DesignInput =
      sel && sel.type === "item" ? { ...condition, anchorItem: sel.label } : condition;
    setLastInferInput(inferInput);
    staggerTimeoutsRef.current.forEach(clearTimeout); // 재실행 시 이전 stagger 타이머 정리
    staggerTimeoutsRef.current = [];
    setScenarioTriggered(true);
    setStage(3);
    setInferLoading(true);
    setInferError(null);
    setRevealedChecklistCount(0);

    const gd = graphDataRef.current;

    apiFetch("/api/infer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inferInput),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await reasonOf(res, `추론 API 실패 (${res.status})`));
        return res.json() as Promise<InferResponse>;
      })
      .then((data) => {
        setInferLoading(false);
        const scenarioNode = gd?.nodes.find((n) => n.hidden);
        const scenEdges: Edge[] = gd?.edges.filter((e) => e.scen) ?? [];
        const reveal = () => {
          setInferResult(data);
          setRightPanelMode("checklist");
          data.checklist.forEach((_, i) => {
            const t = setTimeout(() => setRevealedChecklistCount((c) => Math.max(c, i + 1)), 200 + i * 360);
            staggerTimeoutsRef.current.push(t);
          });
        };
        if (firstRun && gd && scenarioNode) {
          const idSet = new Set(gd.nodes.map((n) => n.id));
          const waves = [[scenarioNode.id], ...data.checklist.map((c) => parseTraceIds(c.trace, idSet))];
          graphRef.current?.runScenario(scenarioNode.id, scenEdges, waves, {
            onWave: () => {},
            onDone: reveal,
          });
        } else {
          // 재실행이거나 시나리오 노드를 못 찾은 경우: 웨이브 없이 체크리스트만 갱신.
          reveal();
        }
      })
      .catch((err) => {
        setInferLoading(false);
        setInferError(err instanceof Error ? err.message : String(err));
        setRightPanelMode("checklist");
      });
  }, [scenarioTriggered, ontologyBuilt, condition]);

  // ── 도면 분석 (POST /api/drawing-input): 업로드 → 형상 유사 설계 카드 + 조건 후보 ──
  const drawingInputRef = useRef<HTMLInputElement | null>(null);
  const [drawingLoading, setDrawingLoading] = useState(false);
  const [drawingError, setDrawingError] = useState<string | null>(null);
  const [drawingResult, setDrawingResult] = useState<DrawingResult | null>(null);

  const handleDrawingFile = useCallback((fileOrSample: File | { sample: true }) => {
    setDrawingLoading(true);
    setDrawingError(null);
    setRightPanelMode("drawing");
    const init: RequestInit =
      fileOrSample instanceof File
        ? (() => {
            const fd = new FormData();
            fd.append("file", fileOrSample);
            return { method: "POST", body: fd };
          })()
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sample: true }) };
    apiFetch("/api/drawing-input", init)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error ?? `도면 분석 실패 (${res.status})`);
        return data as DrawingResult & { delta?: GraphResponse };
      })
      .then((data) => {
        setDrawingLoading(false);
        setDrawingResult(data);
        // 도면 프로젝트 + SIMILAR(형상 유사) 엣지를 그래프에 합류(빨간 강조) + 전체 카운터 갱신
        if (data.delta && (data.delta.nodes.length || data.delta.edges.length)) {
          graphRef.current?.addDelta(data.delta.nodes, data.delta.edges);
        }
        const t = (data as { totals?: { nodes: number; edges: number } }).totals;
        if (t) setFullTotals({ nodes: t.nodes, edges: t.edges });
      })
      .catch((err) => {
        setDrawingLoading(false);
        setDrawingError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  // 도면 조건 적용 → 즉시 추론(웨이브 연출 없이) — "도면을 던지면 체크리스트가 나온다"
  const handleApplyDrawingConditions = useCallback(
    (c: Partial<DesignInput>) => {
      const next: DesignInput = {
        ...condition,
        components: c.components?.length ? c.components : condition.components,
        shape: c.shape?.length ? c.shape : condition.shape,
        seedProject: c.seedProject,
      };
      setCondition(next);
      setScenarioTriggered(true);
      setStage(3);
      setInferLoading(true);
      setInferError(null);
      setRightPanelMode("checklist");
      apiFetch("/api/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(await reasonOf(res, `추론 API 실패 (${res.status})`));
          return res.json() as Promise<InferResponse>;
        })
        .then((data) => {
          setInferLoading(false);
          setInferResult(data);
          setRevealedChecklistCount(data.checklist.length);
        })
        .catch((err) => {
          setInferLoading(false);
          setInferError(err instanceof Error ? err.message : String(err));
        });
    },
    [condition]
  );

  // ── 큐레이션: 노드/관계 삭제 · 노드 병합 (인메모리 — 리셋 시 원복) ──
  const [mergeSource, setMergeSource] = useState<{ id: string; label: string } | null>(null);
  mergeSourceRef.current = mergeSource;

  const curate = useCallback((body: Record<string, unknown>) => {
    return apiFetch("/api/curate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error ?? `큐레이션 실패 (${res.status})`);
      return d;
    });
  }, []);

  const handleDeleteNode = useCallback(
    (id: string, label: string) => {
      if (!window.confirm(`"${label}" 객체와 연결 관계를 삭제할까요?\n(인메모리 편집 — 서버 재시작 시 원복)`)) return;
      curate({ op: "deleteNode", id })
        .then((d) => {
          graphRef.current?.removeFromCanvas([id], []);
          setFullTotals({ nodes: d.totals.nodes, edges: d.totals.edges });
          // 삭제 후에도 보던 맥락 유지 — 히스토리에서 삭제된 노드를 걷어내고
          // 직전 항목(예: 결로·습기)을 다시 선택(포커스+인스펙터 복원).
          const prev = navHistory.filter((e) => e.id !== id);
          setNavHistory(prev);
          const back = prev[prev.length - 1];
          if (back) handleNodeClick(back.id, { push: false });
          else setInspectorObj(null);
        })
        .catch((e) => setInspectorError(e instanceof Error ? e.message : String(e)));
    },
    [curate, navHistory, handleNodeClick]
  );

  const handleDeleteRel = useCallback(
    (src: string, rel: string, dst: string, currentId: string) => {
      curate({ op: "deleteEdge", src, rel, dst })
        .then((d) => {
          graphRef.current?.removeFromCanvas([], [`${src}|${rel}|${dst}`]);
          setFullTotals({ nodes: d.totals.nodes, edges: d.totals.edges });
          handleNodeClick(currentId, { push: false }); // 인스펙터 새로고침
        })
        .catch((e) => setInspectorError(e instanceof Error ? e.message : String(e)));
    },
    [curate, handleNodeClick]
  );

  // 병합: 인스펙터에서 시작 → 다음에 클릭하는 노드가 병합 대상(into)
  const handleMergeInto = useCallback(
    (intoId: string) => {
      if (!mergeSource || intoId === mergeSource.id) return;
      const from = mergeSource;
      setMergeSource(null);
      curate({ op: "merge", from: from.id, into: intoId })
        .then((d) => {
          graphRef.current?.removeFromCanvas([from.id], []);
          if (d.movedEdges?.length) graphRef.current?.addDelta([], d.movedEdges); // 이관 관계 합류(강조)
          setFullTotals({ nodes: d.totals.nodes, edges: d.totals.edges });
          handleNodeClick(intoId, { via: "병합", fresh: true });
        })
        .catch((e) => setInspectorError(e instanceof Error ? e.message : String(e)));
    },
    [mergeSource, curate, handleNodeClick]
  );
  handleMergeIntoRef.current = handleMergeInto;

  // ── 품질 패널 액션: 중복 후보 병합 / 고립·근거없음 노드 삭제 — curate() 경유, 액션 후 재스캔 ──
  const handleQualityMerge = useCallback(
    (fromId: string, fromLabel: string, intoId: string) => {
      if (!window.confirm(`"${fromLabel}" 을(를) 병합할까요?\n(저장소에 반영됩니다 — 되돌리려면 재인제스천 필요)`)) return;
      curate({ op: "merge", from: fromId, into: intoId })
        .then((d) => {
          graphRef.current?.removeFromCanvas([fromId], []);
          if (d.movedEdges?.length) graphRef.current?.addDelta([], d.movedEdges);
          setFullTotals({ nodes: d.totals.nodes, edges: d.totals.edges });
          if (selectedNodeRef.current?.id === fromId) selectedNodeRef.current = null; // 사라진 노드 참조 정리
          void refreshQuality();
          void refreshContradictions(); // 병합이 모순 판정을 바꿀 수 있음
        })
        .catch((e) => setQualityError(e instanceof Error ? e.message : String(e)));
    },
    [curate, refreshQuality, refreshContradictions]
  );

  const handleQualityDelete = useCallback(
    (id: string, label: string) => {
      if (!window.confirm(`"${label}" 객체와 연결 관계를 삭제할까요?\n(저장소에 반영됩니다 — 되돌리려면 재인제스천 필요)`)) return;
      curate({ op: "deleteNode", id })
        .then((d) => {
          graphRef.current?.removeFromCanvas([id], []);
          setFullTotals({ nodes: d.totals.nodes, edges: d.totals.edges });
          if (selectedNodeRef.current?.id === id) selectedNodeRef.current = null; // 사라진 노드 참조 정리
          void refreshQuality();
          void refreshContradictions();
        })
        .catch((e) => setQualityError(e instanceof Error ? e.message : String(e)));
    },
    [curate, refreshQuality, refreshContradictions]
  );

  // rel-domain(관계 제약 위반) 전용 — 위반 관계만 삭제(노드는 보존). 기존 deleteEdge 큐레이션 재사용.
  const handleQualityDeleteEdge = useCallback(
    (edge: { src: string; rel: string; dst: string }) => {
      const nm = (id: string) => nodeIndexRef.current.get(id)?.label ?? id;
      if (
        !window.confirm(
          `관계 "${nm(edge.src)} —${edge.rel}→ ${nm(edge.dst)}" 을(를) 삭제할까요?\n(저장소에 반영됩니다 — 되돌리려면 재인제스천 필요)`
        )
      )
        return;
      curate({ op: "deleteEdge", src: edge.src, rel: edge.rel, dst: edge.dst })
        .then((d) => {
          graphRef.current?.removeFromCanvas([], [`${edge.src}|${edge.rel}|${edge.dst}`]);
          setFullTotals({ nodes: d.totals.nodes, edges: d.totals.edges });
          void refreshQuality();
          void refreshContradictions();
        })
        .catch((e) => setQualityError(e instanceof Error ? e.message : String(e)));
    },
    [curate, refreshQuality, refreshContradictions]
  );

  // ── 다음 액션: 인스펙터의 고장모드/원인을 신규 설계 조건에 리스크로 반영 ──
  // 추론이 이미 실행된 상태(STAGE 3)라면 새 조건으로 체크리스트를 즉시 재계산한다
  // (웨이브 연출 없이 결과만 갱신 — "그래프 탐색"이 다음 설계 행동으로 이어지는 경로).
  const handleAddRiskToCondition = useCallback(
    (label: string) => {
      const risk = `${label} 리스크`;
      const next: DesignInput = condition.shape.includes(risk)
        ? condition
        : { ...condition, shape: [...condition.shape, risk] };
      if (next !== condition) setCondition(next);
      if (!scenarioTriggered) return; // 아직 추론 전이면 조건에만 반영 — 추론 시 사용됨
      setInferLoading(true);
      setInferError(null);
      setRightPanelMode("checklist");
      apiFetch("/api/infer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(await reasonOf(res, `추론 API 실패 (${res.status})`));
          return res.json() as Promise<InferResponse>;
        })
        .then((data) => {
          setInferLoading(false);
          setInferResult(data);
          setRevealedChecklistCount(data.checklist.length); // 재계산은 연출 없이 즉시 표시
        })
        .catch((err) => {
          setInferLoading(false);
          setInferError(err instanceof Error ? err.message : String(err));
        });
    },
    [condition, scenarioTriggered]
  );

  // ── 검색 (디바운스) — 온톨로지가 구축된 이후(STAGE 2+)에만 활성화 ──
  const handleSearchChange = useCallback(
    (q: string) => {
      setSearchQuery(q);
      nlSubmittedRef.current = false; // 사용자가 다시 타이핑하면 키워드 드롭다운 복구
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      const query = q.trim();
      if (!query) {
        setSearchHits([]);
        setSearchOpen(false);
        graphRef.current?.applySearch([], [], "");
        return;
      }
      if (!ontologyBuilt) return; // 그래프가 아직 없으면 검색을 걸지 않는다.
      searchDebounceRef.current = setTimeout(() => {
        apiFetch(`/api/search?q=${encodeURIComponent(query)}`)
          .then((res) => {
            if (!res.ok) throw new Error(`검색 실패 (${res.status})`);
            return res.json() as Promise<SearchResponse>;
          })
          .then((data) => {
            if (nlSubmittedRef.current) return; // Enter로 NL 검색이 실행됐으면 드롭다운을 열지 않는다
            graphRef.current?.applySearch(data.hits, data.neighbors, query);
            setSearchHits(data.hits);
            setSearchOpen(true);
          })
          .catch(() => {
            /* 검색 API 미가용 시 조용히 무시 — UI degrade */
            setSearchHits([]);
          });
      }, 250);
    },
    [ontologyBuilt]
  );

  // ── 검색 결과 클릭 → 그래프 선택(펄스) + 인스펙터 로드 (provenance 이동) ──
  const handleSelectSearchHit = useCallback(
    (hit: SearchHit) => {
      // 검색 드롭다운/입력을 닫고, 남아있는 검색 강조(applySearch dim·pulse)를 먼저 완전히
      // 해제한다. 그래야 이어지는 selectNode → applyFocus(자기 자신 + 1홉 이웃)가 이겨서
      // 캔버스에서 그 노드를 직접 클릭한 것과 동일한 포커스 결과가 된다.
      setSearchOpen(false);
      setSearchQuery("");
      setSearchHits([]);
      graphRef.current?.applySearch([], [], "");
      handleNodeClick(hit.id, { via: "검색", fresh: true });
    },
    [handleNodeClick]
  );

  // ── 자연어 검색(Enter 제출) — POST /api/nlsearch, 결과는 우측 nlsearch 패널로 ──
  const handleNLSearch = useCallback(
    (raw: string) => {
      const query = raw.trim();
      if (query.length < 2 || !ontologyBuilt) return; // 빈/사소한 질의는 무시
      // 인스턴트 키워드 드롭다운을 닫고 자연어 검색 모드로 전환한다.
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      nlSubmittedRef.current = true; // in-flight 키워드 응답이 드롭다운을 다시 열지 못하게
      setSearchOpen(false);
      setSearchHits([]);
      setNlQuery(query);
      setNlLoading(true);
      setNlError(null);
      setNlResult(null);
      setRightPanelMode("nlsearch");

      apiFetch("/api/nlsearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`자연어 검색 실패 (${res.status})`);
          return res.json() as Promise<NLSearchResponse>;
        })
        .then((data) => {
          setNlResult(data);
          // 매칭된 객체를 그래프에 강조(펄스) + 이웃 하이라이트.
          graphRef.current?.applySearch(data.hits, data.neighbors, query);
        })
        .catch((err) => {
          setNlError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => setNlLoading(false));
    },
    [ontologyBuilt]
  );

  // ── 자연어 검색 결과의 hit 클릭 → 그래프 강조 해제 후 해당 노드 포커스 + 인스펙터 로딩 ──
  const handleSelectNLHit = useCallback(
    (id: string) => {
      graphRef.current?.applySearch([], [], "");
      handleNodeClick(id, { via: "자연어 검색", fresh: true });
    },
    [handleNodeClick]
  );

  // ── 문서 인제스천 — 성공 시 좌측 원천 패널의 파일 목록/카운트를 최신화 ──
  const refreshSources = useCallback(() => {
    apiFetch("/api/sources")
      .then((res) => {
        if (!res.ok) throw new Error(`원천 조회 실패 (${res.status})`);
        return res.json() as Promise<SourcesResponse>;
      })
      .then((data) => setSources(data.sources))
      .catch(() => {
        /* 목록 갱신 실패는 조용히 무시 — 기존 목록 유지 */
      });
  }, []);

  // ── 문서 삭제·교체(좌측 📄 문서 드로어) 후 그래프 재동기화 ──
  // buildOntology 는 append 라 재호출하면 중복 마운트된다. 대신 /api/ontology 를 다시 받아
  // 사라진 노드는 removeFromCanvas, 새로 생긴 노드/엣지는 addDelta — 큐레이션·인제스천이 쓰는 경로 그대로.
  const handleDocumentsChanged = useCallback(() => {
    apiFetch("/api/ontology")
      .then((res) => {
        if (!res.ok) throw new Error(`온톨로지 조회 실패 (${res.status})`);
        return res.json() as Promise<GraphResponse>;
      })
      .then((data) => {
        const prev = graphDataRef.current;
        const nextIds = new Set(data.nodes.map((n) => n.id));
        const prevIds = new Set(prev?.nodes.map((n) => n.id) ?? []);
        const goneIds = (prev?.nodes ?? []).filter((n) => !nextIds.has(n.id)).map((n) => n.id);
        const newNodes = data.nodes.filter((n) => !prevIds.has(n.id));
        const key = (e: Edge) => `${e.src}|${e.rel}|${e.dst}`;
        const prevEdges = new Set((prev?.edges ?? []).map(key));
        const newEdges = data.edges.filter((e) => !prevEdges.has(key(e)));

        if (goneIds.length) graphRef.current?.removeFromCanvas(goneIds, []);
        if (newNodes.length || newEdges.length) graphRef.current?.addDelta(newNodes, newEdges);

        graphDataRef.current = data;
        setFullTotals({ nodes: data.nodes.length, edges: data.edges.length });
        setStCounts(computeStCounts(data.nodes));
        const idx = buildNodeIndex(data.nodes);
        nodeIndexRef.current = idx;
        setNodeIndex(idx);

        if (goneIds.length) {
          // 사라진 객체를 보고 있었다면 인스펙터·히스토리·앵커 참조를 걷어낸다.
          const gone = new Set(goneIds);
          setNavHistory((h) => h.filter((e) => !gone.has(e.id)));
          setInspectorObj((o) => (o && gone.has(o.id) ? null : o));
          if (selectedNodeRef.current && gone.has(selectedNodeRef.current.id)) selectedNodeRef.current = null;
        }
        refreshSources();
        refreshCaps();
      })
      .catch((err) => setOntologyError(err instanceof Error ? err.message : String(err)));
  }, [refreshSources, refreshCaps]);

  // POST /api/ingest 공통 경로 — FormData(파일 업로드) 또는 JSON 문자열({sample:true}).
  const runIngest = useCallback(
    (body: FormData | string) => {
      setIngestLoading(true);
      setIngestError(null);
      const init: RequestInit =
        typeof body === "string"
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body }
          : { method: "POST", body };
      apiFetch("/api/ingest", init)
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as
            | (IngestResponse | { ok: false; error?: string })
            | null;
          if (!res.ok || !data || data.ok !== true) {
            const msg =
              data && data.ok === false && typeof data.error === "string"
                ? data.error
                : `인제스천 API 실패 (${res.status})`;
            throw new Error(msg);
          }
          return data;
        })
        .then((data) => {
          setIngestResult(data);
          setIngestHistory((prev) => [data, ...prev]);
          if (!data.alreadyIngested && (data.delta.nodes.length > 0 || data.delta.edges.length > 0)) {
            // 그래프 델타 합류(스폰+펄스, doc 노드는 Graph 내부에서 제외).
            graphRef.current?.addDelta(data.delta.nodes, data.delta.edges);
            // 전체 규모 카운터(객체/관계)를 서버 totals로 갱신.
            setFullTotals(data.totals);
            // 라벨 색인·그래프 데이터 캐시에도 병합(히스토리 라벨/후속 시나리오 trace 대비).
            const idx: NodeIndex = new Map(nodeIndexRef.current);
            for (const n of data.delta.nodes) idx.set(n.id, { label: n.label, type: n.type });
            nodeIndexRef.current = idx;
            setNodeIndex(idx);
            if (graphDataRef.current) {
              graphDataRef.current = {
                nodes: [...graphDataRef.current.nodes, ...data.delta.nodes],
                edges: [...graphDataRef.current.edges, ...data.delta.edges],
              };
              setStCounts(computeStCounts(graphDataRef.current.nodes));
            }
          }
          refreshSources();
          // 샘플 인제스천: 결로·습기 노드 활성화(포커스) — 새 3개 노드가 그 둘레에 합류한 모습이 보이게.
          const focusId = (data as { focus?: string }).focus;
          if (focusId) {
            setTimeout(() => handleNodeClick(focusId, { via: "샘플 인제스천", fresh: true }), 700);
          }
        })
        .catch((err) => setIngestError(err instanceof Error ? err.message : String(err)))
        .finally(() => setIngestLoading(false));
    },
    [refreshSources]
  );

  const handleIngestFile = useCallback(
    (file: File) => {
      if (ingestLoading) return;
      // dxf 는 인제스천이 아니라 📐 도면 분석(/api/drawing-input) 전용이라 여기서 제외한다.
      if (!/\.(xlsx|pptx|docx|pdf)$/i.test(file.name)) {
        setIngestError("지원하지 않는 형식입니다 — .xlsx / .pptx / .docx / .pdf 파일만 업로드할 수 있습니다.");
        setIngestResult(null);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setIngestError("파일이 10MB를 초과합니다.");
        setIngestResult(null);
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      runIngest(fd);
    },
    [ingestLoading, runIngest]
  );

  const handleIngestSample = useCallback(() => {
    if (ingestLoading) return;
    runIngest(JSON.stringify({ sample: true }));
  }, [ingestLoading, runIngest]);

  // 인제스천 결과의 새 객체 클릭 → 기존 선택 funnel로(그래프 포커스 + 인스펙터).
  const handleIngestNodeSelect = useCallback(
    (id: string) => handleNodeClick(id, { via: "인제스천", fresh: true }),
    [handleNodeClick]
  );

  // 소프트 리셋 — 부모(WorkbenchLoader)가 key 를 바꿔 리마운트한다(하드 리프레시 없음).
  const handleReset = onReset;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo">
            SL <em>OntoGround</em>
          </span>
          <span className="sub">FMEA 지식 온톨로지 워크벤치 · for SL Corporation</span>
        </div>
        <div className="grow" />
        <div className={"search" + (nlLoading ? " search-busy" : "")}>
          {nlLoading ? (
            <span className="search-spinner" aria-hidden="true" />
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#93a1b5" strokeWidth={2.4}>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.4-4.4" />
            </svg>
          )}
          <input
            id="q"
            type="text"
            placeholder="온톨로지 검색 — 간극, 배광, FMVSS… · Enter로 문장 검색"
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => {
              if (searchHits.length > 0) setSearchOpen(true);
            }}
            onBlur={() => {
              // 드롭다운 항목의 onMouseDown이 먼저 선택을 확정하므로, 약간의 지연 후 닫는다.
              window.setTimeout(() => setSearchOpen(false), 120);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                return;
              }
              if (e.key === "Enter") {
                // Enter = 자연어(문장) 검색. 인스턴트 키워드 드롭다운은 닫고 NL 경로로.
                e.preventDefault();
                handleNLSearch(searchQuery);
              }
            }}
          />
          {searchOpen && ontologyBuilt && <SearchResults hits={searchHits} onSelect={handleSelectSearchHit} />}
        </div>
        <input
          ref={drawingInputRef}
          type="file"
          accept=".dxf"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleDrawingFile(f);
            e.target.value = "";
          }}
        />
        {caps.drawing && (
          <button
            className="btn btn-ghost"
            id="btnDrawing"
            disabled={!ontologyBuilt || drawingLoading}
            title={ontologyBuilt ? "도면(.dxf)을 업로드해 형상 유사 과거 설계를 탐색" : "온톨로지 구축 후 사용 가능"}
            onClick={() => setRightPanelMode("drawing")}
          >
            {drawingLoading ? "📐 분석 중…" : "📐 도면 분석"}
          </button>
        )}
        <button
          className="btn btn-ghost"
          id="btnIngest"
          disabled={!ontologyBuilt}
          title={ontologyBuilt ? "새 문서를 온톨로지에 증분 반영" : "온톨로지 구축 후 사용 가능"}
          onClick={() => setRightPanelMode("ingest")}
        >
          📥 문서 인제스천
        </button>
        {caps.contradictions && contradictions.length > 0 && (
          <button
            className="btn btn-ghost"
            id="btnContradictions"
            style={{ color: "#b3453c", borderColor: "#f3d5d2" }}
            title="전 프로젝트/고장모드를 순회한 근거 기반 모순 스캔 결과"
            onClick={() => setRightPanelMode("contradictions")}
          >
            ⚠ 모순 {contradictions.length}건
          </button>
        )}
        {quality.length > 0 && (
          <button
            className="btn btn-ghost"
            id="btnQuality"
            style={{ color: "#8a6d1f", borderColor: "#eee0b3" }}
            title="자동 생성 중복 후보·고립 노드·근거 누락 스캔 결과"
            onClick={() => setRightPanelMode("quality")}
          >
            🧹 정리 {quality.length}건
          </button>
        )}
        <button
          className="btn btn-ghost"
          id="btnAsk"
          disabled={!ontologyBuilt}
          title={
            ontologyBuilt
              ? inspectorObj
                ? `선택 객체 '${inspectorObj.label}' 에 대해 사내 LLM에 질문`
                : "객체를 선택한 뒤 사내 LLM에 질문"
              : "온톨로지 구축 후 사용 가능"
          }
          onClick={() => setRightPanelMode("ask")}
        >
          🤖 질문
        </button>
        <button
          className="btn btn-ghost"
          id="btnDocAsk"
          title="캔버스 문서 원문에 자유롭게 질문(객체 선택 불필요)"
          onClick={() => setRightPanelMode("docask")}
        >
          📖 문서 질문
        </button>
        {derivedRelations.length > 0 && (
          <button
            className="btn btn-ghost"
            id="btnReason"
            style={{ color: "#00789e", borderColor: "#b3e2f2" }}
            title="온톨로지가 기존 관계 조합으로 스스로 유도한 관계(검토용, DB 미반영)"
            onClick={() => setRightPanelMode("reason")}
          >
            🔗 유도 관계 {derivedRelations.length}건
          </button>
        )}
        {ontologyBuilt && (
          <a
            className="btn btn-ghost"
            id="btnExportTtl"
            href={withCanvasUrl("/api/ontology/export?format=ttl")}
            download
            title="온톨로지 전체(스키마+인스턴스)를 RDF Turtle 파일로 내보내기"
          >
            ⬇ .ttl
          </a>
        )}
        <button className="btn btn-ghost" id="btnReset" onClick={handleReset}>
          처음부터
        </button>
        {caps.infer && (
          <button
            className="btn btn-primary"
            id="btnScenario"
            disabled={!ontologyBuilt}
            title={
              inspectorObj?.type === "item"
                ? `선택 부품 '${inspectorObj.label}' 설계 조건 패널 열기 (조건 확인 후 '추론 실행')`
                : "설계 조건 패널 열기 (조건 선택 후 '추론 실행')"
            }
            onClick={() => setRightPanelMode("checklist")}
          >
            {inspectorObj?.type === "item"
              ? `▶ '${inspectorObj.label.length > 10 ? inspectorObj.label.slice(0, 10) + "…" : inspectorObj.label}' 설계 검토`
              : "▶ 신규 설계 추론"}
          </button>
        )}
      </header>

      <div className={"main" + (leftPanel ? " left-open" : "")}>
        <LeftRail
          active={leftPanel}
          onSelect={setLeftPanel}
          panels={{
            canvases: <CanvasPanel current={canvas} onSwitch={onSwitchCanvas} />,
            documents: <DocumentPanel onChanged={handleDocumentsChanged} />,
            types: (
              <SourcePanel
                counts={graphCounts}
                activeType={activeType}
                onSelectType={(t) => {
                  setActiveType(t);
                  setActiveSt(null);
                  graphRef.current?.filterByType(t);
                }}
                subtypeDefs={subtypeDefs}
                stCounts={stCounts}
                activeSubtype={activeSt}
                onSelectSubtype={(t, st) => {
                  setActiveType(t);
                  setActiveSt(st);
                  graphRef.current?.filterByType(st ? `${t}:${st}` : t);
                }}
              />
            ),
            schema: <SchemaPanel onChanged={refreshCaps} />,
          }}
        />

        <section className="canvas-wrap" id="cw">
          <div className="stagechip" id="stageChip">
            STAGE <b>{stage}</b> / 3 — {stageName}
          </div>
          {/* PHASE 1: 구축 후에는 뷰와 무관하게 전체 온톨로지 규모 + 표시 중 수를 보여준다. */}
          <div className="counter">
            <span className="c">
              객체 <b>{ontologyBuilt && fullTotals ? fullTotals.nodes : graphCounts.nodes}</b>
            </span>
            <span className="c">
              관계 <b>{ontologyBuilt && fullTotals ? fullTotals.edges : graphCounts.edges}</b>
            </span>
            {ontologyBuilt && viewInfo && (
              <span className="c">
                표시 중 <b>{viewInfo.visible}</b>
              </span>
            )}
          </div>
          {/* 빈 캔버스 — 스키마 정의 → 문서 인제스천 순서를 안내한다(타입이 없으면 적재되지 않는다). */}
          {ontologyBuilt && fullTotals?.nodes === 0 && (
            <div className="cv-empty-guide">
              <h3>빈 캔버스입니다</h3>
              <ol>
                <li>
                  <b>◈ 스키마</b> 드로어에서 객체타입·관계타입을 정의하세요.
                </li>
                <li>
                  <b>📥 문서 인제스천</b>으로 문서를 부어 온톨로지를 구축하세요.
                </li>
              </ol>
              <p className="cv-empty-note">타입이 없으면 문서를 넣어도 적재되지 않습니다.</p>
            </div>
          )}
          {/* 전체 덤프(숨겨진 객체 모두 보기) 버튼 제거 — 174노드/2171엣지 일괄 렌더가 렉 유발.
              대신 기본 = 대분류 앵커(부품·프로젝트)만, 노드 클릭 시 1홉 관계를 펼쳐 본다. */}
          {mergeSource && (
            <div className="viewtoggle" style={{ top: 88, right: 16, color: "#b3453c", borderColor: "#f3d5d2" }}>
              ⇄ 병합 모드: &ldquo;{mergeSource.label}&rdquo; → 대상 노드를 클릭하세요{" "}
              <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => setMergeSource(null)}>
                취소
              </span>
            </div>
          )}
          {ontologyBuilt && focusInfo && (focusInfo.hidden > 0 || focusInfo.expanded) && (
            <button
              className="viewtoggle focus-more"
              title={
                focusInfo.expanded
                  ? "직접 원인·조치·품목 등 핵심 관계만 표시"
                  : "선택 객체의 모든 연결을 표시"
              }
              onClick={() => graphRef.current?.setFocusExpand(!focusInfo.expanded)}
            >
              {focusInfo.expanded ? "핵심 관계만 보기" : `숨겨진 관계 ${focusInfo.hidden}개 더 보기`}
            </button>
          )}

          <ChaosOverlay
            hidden={chaosHidden}
            gone={chaosGone}
            sources={sources}
            sourcesLoading={sourcesLoading}
            sourcesError={sourcesError}
          />
          {ontologyError && (
            <div
              className="disclaimer"
              style={{ left: 16, right: "auto", bottom: 46, color: "#FF5470" }}
            >
              온톨로지 API 오류: {ontologyError}
            </div>
          )}

          {ontologyBuilt && (
            <ViewToggle
              mode={viewMode}
              onChange={(m) => {
                setViewMode(m);
                refreshView();
              }}
            />
          )}

          <div className="rf-graph-layer" style={{ display: viewMode === "graph" ? undefined : "none" }}>
            <Graph
              ref={graphRef}
              onNodeClick={handleGraphNodeClick}
              onViewChange={(v) => {
                setViewInfo(v);
                refreshView();
              }}
              onFocusChange={(f) => {
                setFocusInfo(f);
                refreshView();
              }}
            />
          </div>
          {ontologyBuilt && (
            // 계층 뷰는 전체 온톨로지(현재 뷰 아님) 기준 — display 토글로 마운트 유지(접힘 상태 보존).
            <div className="hv-layer" style={{ display: viewMode === "hierarchy" ? undefined : "none" }}>
              <HierarchyView
                active={viewMode === "hierarchy"}
                nodes={graphDataRef.current?.nodes ?? []}
                subtypeDefs={subtypeDefs}
                onSelectNode={(id) => {
                  setViewMode("graph");
                  handleGraphNodeClick(id);
                }}
              />
            </div>
          )}
          {viewMode === "table" && <TableView view={view} onSelect={handleGraphNodeClick} />}
          {viewMode === "raw" && <RawView view={view} />}
          {ontologyBuilt && <OverviewPanel view={view} />}

          <div className={"ingest" + (ingestVisible ? " show" : "")} id="ingest">
            <div className="ih">
              <span className="t">DOCLING INGESTION</span>
              <span className="p" id="ipct">
                {ingestPct}%
              </span>
            </div>
            <div className="lines" id="ilines">
              {ingestLines.map((html, i) => (
                // eslint-disable-next-line react/no-danger
                <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
              ))}
            </div>
            <div className="ibar">
              <i id="ibar" style={{ width: `${ingestPct}%` }} />
            </div>
          </div>

          <div className="zoombar">
            <button id="zin" title="확대" onClick={() => graphRef.current?.zoomBy(0.85)}>
              ＋
            </button>
            <button id="zout" title="축소" onClick={() => graphRef.current?.zoomBy(1.18)}>
              －
            </button>
            <button id="zfit" title="전체 보기" onClick={() => graphRef.current?.zoomFit()}>
              ⤢
            </button>
          </div>
        </section>

        <aside className="side right" id="insp">
          {rightPanelMode === "checklist" ? (
            <>
              <DesignConditionForm
                condition={condition}
                onChange={setCondition}
                anchorLabel={inspectorObj?.type === "item" ? inspectorObj.label : null}
                onRun={handleRunScenario}
                running={inferLoading}
              />
              <Checklist
                loading={inferLoading}
                error={inferError}
                result={inferResult}
                condition={lastInferInput ?? condition}
                revealedCount={revealedChecklistCount}
                nodeIndex={nodeIndex}
                onSelectObject={handleChecklistSelect}
              />
              {!inferResult && !inferLoading && !inferError && (
                <div className="insp-empty">조건을 선택하고 <b>▶ 추론 실행</b>을 누르면 검토 체크리스트가 생성됩니다.</div>
              )}
            </>
          ) : rightPanelMode === "nlsearch" ? (
            <NLSearchPanel
              query={nlQuery}
              loading={nlLoading}
              error={nlError}
              result={nlResult}
              onSelectHit={handleSelectNLHit}
              onClose={() => {
                graphRef.current?.applySearch([], [], "");
                setRightPanelMode("inspector");
              }}
            />
          ) : rightPanelMode === "ingest" ? (
            <IngestPanel
              loading={ingestLoading}
              error={ingestError}
              result={ingestResult}
              history={ingestHistory}
              onIngestFile={handleIngestFile}
              onIngestSample={handleIngestSample}
              onSelectNode={handleIngestNodeSelect}
              onClose={() => setRightPanelMode("inspector")}
            />
          ) : rightPanelMode === "drawing" ? (
            <DrawingPanel
              loading={drawingLoading}
              error={drawingError}
              result={drawingResult}
              onSelectObject={(id) => handleNodeClick(id, { via: "도면 분석", fresh: true })}
              onApplyConditions={handleApplyDrawingConditions}
              onClose={() => setRightPanelMode("inspector")}
              onPickFile={() => drawingInputRef.current?.click()}
              onSample={() => handleDrawingFile({ sample: true })}
            />
          ) : rightPanelMode === "contradictions" ? (
            <ContradictionsPanel
              loading={contradictionsLoading}
              error={contradictionsError}
              items={contradictions}
              nodeIndex={nodeIndex}
              onSelectObject={handleContradictionSelect}
              onClose={() => setRightPanelMode("inspector")}
            />
          ) : rightPanelMode === "quality" ? (
            <QualityPanel
              loading={qualityLoading}
              error={qualityError}
              items={quality}
              nodeIndex={nodeIndex}
              onSelectObject={handleQualitySelect}
              onMerge={handleQualityMerge}
              onDelete={handleQualityDelete}
              onDeleteEdge={handleQualityDeleteEdge}
              onClose={() => setRightPanelMode("inspector")}
            />
          ) : rightPanelMode === "ask" ? (
            <AskPanel
              objectId={inspectorObj?.id ?? null}
              objectLabel={inspectorObj?.label ?? null}
              history={askHistory}
              onAppend={(entry) => setAskHistory((prev) => [...prev, entry])}
              onFocusNode={handleAskFocus}
              onOpenDoc={handleOpenEvidenceFile}
              onClose={() => setRightPanelMode("inspector")}
            />
          ) : rightPanelMode === "docask" ? (
            <DocAskPanel
              onOpenDoc={(f, hl) => handleOpenEvidenceFile(f, hl)}
              onClose={() => setRightPanelMode("inspector")}
            />
          ) : rightPanelMode === "reason" ? (
            <ReasonPanel
              loading={reasonLoading}
              error={reasonError}
              items={derivedRelations}
              nodeIndex={nodeIndex}
              onSelectObject={handleReasonSelect}
              onClose={() => setRightPanelMode("inspector")}
            />
          ) : rightPanelMode === "condensation" ? (
            condensationRegions ? (
              <CondensationPanel
                regions={condensationRegions}
                onSelectObject={handleCondensationSelect}
                onOpenEvidence={handleOpenEvidenceFile}
                onClose={() => setRightPanelMode("inspector")}
              />
            ) : (
              <>
                <div className="sec-label">결로 지역별 분석</div>
                <div className="insp-empty">
                  {condensationError ? (
                    <>
                      지역 목록을 불러오지 못했습니다.
                      <br />
                      <span className="k">{condensationError}</span>
                    </>
                  ) : (
                    "불러오는 중…"
                  )}
                </div>
              </>
            )
          ) : (
            <Inspector
              loading={inspectorLoading}
              error={inspectorError}
              obj={inspectorObj}
              history={navHistory}
              onGo={handleInspectorGo}
              onBack={handleNavBack}
              onJumpTo={handleNavJumpTo}
              onOpenCondensation={handleOpenCondensation}
              onAddToCondition={handleAddRiskToCondition}
              conditionRisks={condition.shape}
              onOpenDoc={handleOpenEvidenceFile}
              sourceFiles={sourceFileNames}
              onDeleteNode={handleDeleteNode}
              onDeleteRel={handleDeleteRel}
              onMergeStart={(id, label) => setMergeSource({ id, label })}
            />
          )}
        </aside>
      </div>

      {sourceModalOpen && selectedSource && (
        <SourceModal
          source={selectedSource}
          highlightIds={sourceHighlight}
          onClose={() => setSourceModalOpen(false)}
        />
      )}

      <Stepper stage={stage} />
    </>
  );
}
