"use client";

// SVG 포스 그래프 — FMEA_온톨로지_시연_v2.html 의 3~8절(렌더/물리/인터랙션) 이식.
// 데이터는 전부 props(API 응답)로 주입되며, 이 파일 안에는 어떤 온톨로지 데이터도 하드코딩하지 않는다.
// 물리 루프·DOM 조작은 데모와 동일하게 명령형으로 수행하고, React는 컨테이너만 소유한다.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { Edge, Node, ObjType, SearchHit } from "@/lib/types";
import { TYPES, TYPE_NAMES } from "./typeStyles";
import { relKo } from "./relLabels";

const W = 1600;
const H = 900;

// ── FEATURE 1: 대분류(TYPE) 클러스터 존 ──
// 8개 비-doc 타입의 결정론적 중심 좌표(W×H 전역에 걸쳐 구역 분리). 랜덤 없음.
// 배치는 시드 앵커의 대략적 분포를 존중해 초기 이동/스프링 충돌을 줄인다.
// AUTO 포함 시 item(36)·fm(32)·cause(23)·action(25)이 대형 클러스터가 되므로
// 이 네 존을 캔버스 사분면에 최대한 벌려 전체 보기에서도 존이 뭉치지 않게 한다.
const TYPE_CENTROID: Partial<Record<ObjType, { x: number; y: number }>> = {
  proj: { x: 640, y: 120 }, // 상단 좌-중
  spec: { x: 1360, y: 110 }, // 상단 우
  reg: { x: 1460, y: 430 }, // 우측
  master: { x: 1190, y: 800 }, // 하단 우
  action: { x: 650, y: 810 }, // 하단 중
  cause: { x: 170, y: 640 }, // 좌측 하단
  fm: { x: 400, y: 380 }, // 좌측 상단-중
  item: { x: 920, y: 470 }, // 중앙(코어 부품군)
};
const TYPE_GRAVITY = 0.013; // 존 중심으로 당기는 부드러운 인력(스프링을 압도하지 않을 만큼)
// 전체 보기(170노드·수천 엣지)에서는 스프링 합이 커서 존 중력을 더 세게 준다.
const TYPE_GRAVITY_FULL = 0.035;
const ANCHOR_PULL = 0.004; // 손배치 앵커의 약한 2차 인력(존 인력 보조)

// ── FEATURE 2: 클릭 → 관련도-거리 방사형 포커스 ──
const FOCUS_EASE = 0.2; // ftx/fty 목표로 매 틱 보간(부드러운 이동)
const FOCUS_RINGS = [190, 320, 450]; // 관련도 티어별 반지름(가까울수록 관련도 높음)
// 티어 0(가까움) = 핵심 구조 관계, 티어 1 = 주변 관계, 티어 2 = 근거 문서(가장 멂)
const REL_CLOSE = new Set([
  "CONSISTS_OF",
  "HAS_FAILURE",
  "CAUSED_BY",
  "MITIGATED_BY",
  "OCCURRED_IN",
  "THERMAL_RISK",
  "NEW_DESIGN_OF",
]);
const REL_FAR = new Set(["REF_MASTER", "UNDER_REG", "DRL_REG", "SPEC_OF", "TARGET_MARKET"]);
function relevanceTier(rel: string | undefined, weight: number | undefined): number {
  if (!rel) return 1;
  const r = rel.toUpperCase();
  if (r === "EVIDENCED_BY") return 2;
  if (r.startsWith("SIMILAR")) return (weight ?? 0) >= 0.7 ? 0 : 1;
  if (REL_CLOSE.has(r)) return 0;
  if (REL_FAR.has(r)) return 1;
  return 1;
}

interface GNode extends Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  /** FEATURE 2: 방사형 포커스 목표 좌표(설정 시 물리 대신 이 좌표로 부드럽게 이동). */
  ftx: number | null;
  fty: number | null;
  /** PHASE 1: 현재 뷰에서 보이는 엣지 기준 연결도 — 전체 보기 스프링 정규화용 */
  degNow: number;
  r: number;
  w: number;
  h: number;
  el: SVGGElement | null;
  added: boolean;
  hiddenNow: boolean;
}

interface GEdge {
  a: string;
  b: string;
  rel: string;
  weight?: number;
  scen: boolean;
  el: SVGLineElement | null;
  lel: SVGTextElement | null;
  added: boolean;
  /** PHASE 1: 현재 뷰(백본/전체)에서 숨김 여부 — 스프링·렌더에서 제외 */
  hiddenNow?: boolean;
}

export interface GraphCounts {
  nodes: number;
  edges: number;
  byType: Partial<Record<ObjType, number>>;
}

/** PHASE 1: 뷰 상태 통지 — 카운터("표시 중 N")·토글 라벨("전체 보기 (+N)")용 */
export interface ViewInfo {
  full: boolean;
  visible: number;
  hiddenCount: number;
}

export interface GraphHandle {
  /** STAGE 2: 코어 객체 → 코어 관계 → 근거 문서 위성(배치 스트리밍) 순으로 스폰.
   * opts.instant = 연출 없이 즉시 전체 마운트(?update=1 직행 진입용). */
  buildOntology: (
    nodes: Node[],
    edges: Edge[],
    handlers: {
      onLog: (html: string) => void;
      onCounts: (counts: GraphCounts) => void;
      onProgress: (pct: number) => void;
      onDone: () => void;
    },
    opts?: { instant?: boolean }
  ) => void;
  /** STAGE 3: 시나리오 노드/엣지 공개 + 체크리스트 항목별 웨이브 점등 */
  runScenario: (
    scenarioNodeId: string,
    scenEdges: Edge[],
    waves: string[][],
    handlers: { onWave: (i: number) => void; onDone: () => void }
  ) => void;
  applySearch: (hits: SearchHit[], neighbors: string[], query: string) => void;
  clearSelection: () => void;
  selectNode: (id: string) => void;
  zoomBy: (f: number) => void;
  zoomFit: () => void;
  /** PHASE 1: 전체 보기(true) ↔ 핵심(백본)만 보기(false) 전환 */
  setFullView: (on: boolean) => void;
  /** 객체 타입 탐색기: 특정 타입만 표시(null=기본 앵커 뷰) */
  filterByType: (t: string | null) => void;
  /** 인제스천 델타 합류: 새 노드/엣지를 기존 엔진에 등록·마운트(스폰+펄스). doc 노드는 제외. */
  addDelta: (nodes: Node[], edges: Edge[]) => void;
  /** 포커스 확장: 기본 1-hop 제한(핵심 관계 + 근거 일부)을 풀고 모든 이웃 표시 */
  setFocusExpand: (on: boolean) => void;
  /** 큐레이션 반영: 노드/특정 엣지를 캔버스에서 제거(서버 삭제·병합 후 호출) */
  removeFromCanvas: (nodeIds: string[], edgeKeys: string[]) => void;
}

/** 포커스 상태 통지 — 숨긴 이웃 수를 UI 버튼("숨겨진 관계 N개 더 보기")에 표시하기 위함. */
export interface FocusInfo {
  hidden: number;
  total: number;
  expanded: boolean;
}

interface GraphProps {
  onNodeClick: (id: string) => void;
  /** PHASE 1: 표시 노드 수/뷰 모드 변경 통지(구축 완료·토글·공개 시) */
  onViewChange?: (v: ViewInfo) => void;
  /** 포커스 진입/해제/확장 통지(해제 시 null) */
  onFocusChange?: (f: FocusInfo | null) => void;
}

function elNS<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element
): SVGElementTagNameMap[K] {
  const NS = "http://www.w3.org/2000/svg";
  const e = document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

const Graph = forwardRef<GraphHandle, GraphProps>(function Graph(
  { onNodeClick, onViewChange, onFocusChange },
  ref
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  const controllerRef = useRef<{
    buildOntology: GraphHandle["buildOntology"];
    runScenario: GraphHandle["runScenario"];
    applySearch: GraphHandle["applySearch"];
    clearSelection: GraphHandle["clearSelection"];
    selectNode: GraphHandle["selectNode"];
    zoomBy: GraphHandle["zoomBy"];
    zoomFit: GraphHandle["zoomFit"];
    setFullView: GraphHandle["setFullView"];
    filterByType: GraphHandle["filterByType"];
    addDelta: GraphHandle["addDelta"];
    setFocusExpand: GraphHandle["setFocusExpand"];
    removeFromCanvas: GraphHandle["removeFromCanvas"];
  } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      buildOntology: (...args: Parameters<GraphHandle["buildOntology"]>) =>
        controllerRef.current?.buildOntology(...args),
      runScenario: (...args) => controllerRef.current?.runScenario(...args),
      applySearch: (...args) => controllerRef.current?.applySearch(...args),
      clearSelection: () => controllerRef.current?.clearSelection(),
      selectNode: (id: string) => controllerRef.current?.selectNode(id),
      zoomBy: (f: number) => controllerRef.current?.zoomBy(f),
      zoomFit: () => controllerRef.current?.zoomFit(),
      setFullView: (on: boolean) => controllerRef.current?.setFullView(on),
      filterByType: (t: string | null) => controllerRef.current?.filterByType(t),
      addDelta: (...args) => controllerRef.current?.addDelta(...args),
      setFocusExpand: (on: boolean) => controllerRef.current?.setFocusExpand(on),
      removeFromCanvas: (...args) => controllerRef.current?.removeFromCanvas(...args),
    }),
    []
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const svg = svgRef.current!;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";

    const defs = elNS("defs", {}, svg);
    const rg = elNS("radialGradient", { id: "hlg" }, defs);
    elNS("stop", { offset: "0%", "stop-color": "#00a2e5", "stop-opacity": ".26" }, rg);
    elNS("stop", { offset: "45%", "stop-color": "#00a2e5", "stop-opacity": ".06" }, rg);
    elNS("stop", { offset: "100%", "stop-color": "#00a2e5", "stop-opacity": "0" }, rg);
    const glowG = elNS("g", { id: "hlGlow" }, svg);
    const glowC = elNS("circle", { cx: 800, cy: 440, r: 240, fill: "url(#hlg)" }, glowG);
    // FEATURE 1: 타입 존 라벨(노드 뒤·비상호작용) — 대분류 구역을 은은히 표기.
    const zoneG = elNS("g", { class: "zone-labels" }, svg);
    (Object.keys(TYPE_CENTROID) as ObjType[]).forEach((t) => {
      const c = TYPE_CENTROID[t]!;
      const t1 = elNS("text", { class: "zone-label", x: c.x, y: c.y - 6 }, zoneG);
      t1.textContent = TYPE_NAMES[t];
    });
    const edgeG = elNS("g", {}, svg);
    const labelG = elNS("g", {}, svg);
    const nodeG = elNS("g", {}, svg);

    const nodes: GNode[] = [];
    const nmap = new Map<string, GNode>();
    const edges: GEdge[] = []; // 코어 + 근거 관계 (stage2)
    const scenEdges: GEdge[] = []; // 시나리오 전용 (stage3)
    const adj = new Map<string, Set<string>>();

    function addAdj(a: string, b: string) {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }

    function nodeW(n: GNode) {
      return Math.max(94, n.label.length * 12 + 52) + (n.hero ? 26 : 0);
    }

    function mountNode(n: GNode) {
      if (n.added) return;
      n.added = true;
      const tp = TYPES[n.type];
      if (n.type === "doc") {
        const g = elNS(
          "g",
          { class: "node doc spawn", "data-id": n.id, tabindex: 0 },
          nodeG
        );
        elNS("circle", { r: n.r, fill: "#ffffff", stroke: tp.c, "stroke-width": 1, class: "box" }, g);
        const t = elNS("text", { class: "dlbl", x: 8, y: 3 }, g);
        t.textContent = n.label;
        n.el = g;
        bindNode(g, n);
        return;
      }
      const w = nodeW(n);
      const h = n.hero ? 52 : n.sub ? 44 : 36;
      n.w = w;
      n.h = h;
      const g = elNS(
        "g",
        { class: "node spawn", "data-id": n.id, tabindex: 0, role: "button", "aria-label": n.label },
        nodeG
      );
      if (n.hidden) g.style.display = "none";
      elNS(
        "rect",
        {
          width: w,
          height: h,
          rx: 9,
          fill: "#ffffff",
          stroke: n.hero ? "#00a2e5" : "#dbe3ee",
          "stroke-width": n.hero ? 1.6 : 1,
          class: "box",
        },
        g
      );
      elNS("rect", { width: 4, height: h, rx: 2, fill: tp.c }, g);
      const gl = elNS("text", { x: 14, y: n.hero ? 20 : 16, class: "glyph", fill: tp.c }, g);
      gl.textContent = tp.g;
      const lb = elNS("text", { x: 14, y: n.hero ? 38 : n.sub ? 30 : 24, class: "lbl" }, g);
      lb.textContent = n.label;
      if (n.hero) {
        lb.style.fontSize = "14.5px";
        lb.style.fontWeight = "700";
      }
      if (n.sub) {
        const sb = elNS("text", { x: w - 10, y: 16, class: "sub", "text-anchor": "end" }, g);
        sb.textContent = n.sub;
      }
      n.el = g;
      bindNode(g, n);
    }

    function mountEdge(e: GEdge) {
      if (e.added) return;
      e.added = true;
      const na = nmap.get(e.a);
      const nb = nmap.get(e.b);
      const bothCore = na && nb && na.type !== "doc" && nb.type !== "doc";
      const cls = "edge" + (bothCore ? " core" : "");
      e.el = elNS("line", { class: cls, "data-key": e.a + "|" + e.b }, edgeG);
      if (e.rel && e.rel.toUpperCase().startsWith("SIMILAR")) {
        e.el.style.strokeDasharray = "5 4";
      }
      if (bothCore) {
        e.lel = elNS(
          "text",
          { class: "edge-label", "text-anchor": "middle", "data-key": e.a + "|" + e.b },
          labelG
        );
        e.lel.textContent = relKo(e.rel); // 화면 표시만 한글 업무 언어로 (데이터는 원문 유지)
      }
    }

    function makeGNode(n: Node): GNode {
      return {
        ...n,
        x: (n.ax ?? W / 2) + (Math.random() * 60 - 30),
        y: (n.ay ?? H / 2) + (Math.random() * 60 - 30),
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        ftx: null,
        fty: null,
        degNow: 0,
        r: n.type === "doc" ? 4.5 : 0,
        w: 0,
        h: 0,
        el: null,
        added: false,
        hiddenNow: false,
      };
    }

    function addNode(n: Node): GNode {
      const gn = makeGNode(n);
      nodes.push(gn);
      nmap.set(gn.id, gn);
      return gn;
    }

    // ── 물리 시뮬레이션 ──
    let alpha = 0;
    let running = false;
    let raf = 0;

    function tick() {
      const act = nodes.filter((n) => n.added && !n.hiddenNow);
      for (let i = 0; i < act.length; i++) {
        const a = act[i];
        for (let j = i + 1; j < act.length; j++) {
          const b = act[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > 90000) continue;
          d2 = Math.max(d2, 120);
          const bothDoc = a.type === "doc" && b.type === "doc";
          const f = (bothDoc ? 520 : 2600) / d2;
          const d = Math.sqrt(d2);
          dx /= d;
          dy /= d;
          a.vx += dx * f;
          a.vy += dy * f;
          b.vx -= dx * f;
          b.vy -= dy * f;
        }
      }
      const allE = [...edges, ...scenEdges];
      for (const e of allE) {
        if (!e.added) continue;
        const a = nmap.get(e.a);
        const b = nmap.get(e.b);
        if (!a || !b || !a.added || !b.added) continue;
        // PHASE 1: 숨긴 노드에 닿은 스프링은 계산하지 않는다(백본 뷰 성능·안정).
        if (a.hiddenNow || b.hiddenNow) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const isDoc = a.type === "doc" || b.type === "doc";
        const rest = isDoc ? 62 : 170;
        let k = isDoc ? 0.05 : 0.018;
        // PHASE 1: 전체 보기에서는 스프링을 연결도(min degree)로 정규화(d3 forceLink 방식).
        // 허브가 수백 개 엣지를 갖는 전체 그래프에서 스프링 합이 타입 존 중력을 압도해
        // 전부 중앙 블롭으로 붕괴하는 것을 막는다. 백본(소규모) 뷰는 기존 그대로.
        if (fullView && !isDoc) {
          k /= Math.max(1, 2 * Math.min(a.degNow, b.degNow));
        }
        const f = (d - rest) * k;
        dx /= d;
        dy /= d;
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
      for (const n of act) {
        // FEATURE 2: 방사형 포커스 목표가 있으면 물리력을 무시하고 목표로 부드럽게 이동.
        if (n.ftx != null) {
          n.x += (n.ftx - n.x) * FOCUS_EASE;
          n.y += (n.fty! - n.y) * FOCUS_EASE;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        // FEATURE 1: 타입 존 중력(모든 비-doc 노드) + 손배치 앵커의 약한 2차 인력.
        if (n.type !== "doc") {
          const c = TYPE_CENTROID[n.type];
          if (c) {
            // 전체 보기에서는 존 중력을 강화해 스프링 합의 중앙 붕괴를 이긴다.
            const g = fullView ? TYPE_GRAVITY_FULL : TYPE_GRAVITY;
            n.vx += (c.x - n.x) * g;
            n.vy += (c.y - n.y) * g;
          }
          if (n.ax != null) {
            n.vx += (n.ax - n.x) * ANCHOR_PULL;
            n.vy += ((n.ay ?? H / 2) - n.y) * ANCHOR_PULL;
          }
        }
        n.vx *= 0.82;
        n.vy *= 0.82;
        if (n.fx != null) {
          n.x = n.fx;
          n.y = n.fy!;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        const cap = 14;
        n.x += Math.max(-cap, Math.min(cap, n.vx * alpha));
        n.y += Math.max(-cap, Math.min(cap, n.vy * alpha));
        n.x = Math.max(30, Math.min(W - 30, n.x));
        n.y = Math.max(30, Math.min(H - 30, n.y));
      }
      alpha = Math.max(alpha * 0.995, 0.12);
    }

    function render() {
      for (const n of nodes) {
        if (!n.el || n.hiddenNow) continue; // PHASE 1: 숨긴 노드는 DOM 갱신 생략
        if (n.type === "doc") n.el.setAttribute("transform", `translate(${n.x},${n.y})`);
        else n.el.setAttribute("transform", `translate(${n.x - n.w / 2},${n.y - n.h / 2})`);
      }
      for (const e of [...edges, ...scenEdges]) {
        if (!e.el || e.hiddenNow) continue;
        const a = nmap.get(e.a);
        const b = nmap.get(e.b);
        if (!a || !b) continue;
        e.el.setAttribute("x1", String(a.x));
        e.el.setAttribute("y1", String(a.y));
        e.el.setAttribute("x2", String(b.x));
        e.el.setAttribute("y2", String(b.y));
        if (e.lel) {
          e.lel.setAttribute("x", String((a.x + b.x) / 2));
          e.lel.setAttribute("y", String((a.y + b.y) / 2 - 6));
        }
      }
      const hero = [...nmap.values()].find((n) => n.hero);
      if (hero) {
        glowC.setAttribute("cx", String(hero.x));
        glowC.setAttribute("cy", String(hero.y));
      }
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function loop() {
      if (!running) return;
      tick();
      render();
      raf = requestAnimationFrame(loop);
    }
    function start() {
      if (running) return;
      running = true;
      if (reduced) {
        for (let i = 0; i < 300; i++) tick();
        render();
        running = false;
        return;
      }
      raf = requestAnimationFrame(loop);
    }

    // ── PHASE 1: 백본 기본 뷰 ↔ 전체 보기 ──
    // 구축 완료 후 기본은 큐레이션 백본(AUTO_ 제외·비-doc ~35개)만 표시.
    // 전체 170개는 "전체 보기" 토글로 명시적으로 연다. 숨긴 노드는 물리(반발/스프링)에서도 제외.
    let built = false; // 구축(spawn 스트리밍) 완료 후에만 뷰 규칙 적용
    let fullView = false;
    let typeFilter: string | null = null; // 객체 타입 탐색기 — 특정 타입만 표시(팔란티어식 파고들기)
    // 백본 밖에서 임시 공개된 노드(검색/체크리스트 선택, 시나리오 근거 문서). 포커스 해제 시 다시 접는다.
    const revealed = new Set<string>();
    // 인제스천 델타로 이 세션에 합류한 노드(대부분 AUTO_ id) + 델타 엣지가 닿은 기존 숨김 노드.
    // revealed와 달리 포커스 해제/뷰 토글에도 지워지지 않는다 — 리셋(새로고침) 전까지 항상 표시.
    const sessionAdded = new Set<string>();
    let hideTimer: number | undefined;

    function isBackbone(n: GNode): boolean {
      // 기본 뷰 = 대분류 앵커(부품 item)만. 나머지(프로젝트·고장모드·원인·조치·근거문서)는
      // 좌측 타입 탐색기 또는 노드 클릭 1홉 펼침으로 접근. 전체 덤프 없음 → 렉 방지.
      return n.type === "item";
    }
    function nodeVisibleNow(n: GNode): boolean {
      if (!n.added || n.hidden) return false; // n.hidden = 시나리오 공개 전(PJ26)
      // 타입 탐색기 활성 시: 그 타입 객체만(+ 포커스 공개·세션 추가). 앵커 백본보다 우선.
      if (typeFilter) return n.type === typeFilter || revealed.has(n.id) || sessionAdded.has(n.id);
      if (!built || fullView) return true;
      return isBackbone(n) || revealed.has(n.id) || sessionAdded.has(n.id);
    }
    // 백본 뷰에서 기본 제외되는 관계: 근거(EVIDENCED_BY)·약한 SIMILAR(<0.7).
    function excludedByDefault(e: GEdge): boolean {
      if (e.rel === "EVIDENCED_BY") return true;
      if (e.rel.toUpperCase().startsWith("SIMILAR") && (e.weight ?? 0) < 0.7) return true;
      return false;
    }
    function notifyView() {
      const visible = nodes.filter((n) => n.added && !n.hiddenNow && !n.hidden).length;
      onViewChangeRef.current?.({ full: fullView, visible, hiddenCount: nodes.length - visible });
    }
    function setElVisible(el: SVGElement, vis: boolean, anim: boolean, toShow: SVGElement[]) {
      if (vis) {
        el.style.display = "";
        if (el.classList.contains("vhide")) {
          if (anim) toShow.push(el); // 다음 프레임에 vhide 제거 → 페이드-인
          else el.classList.remove("vhide");
        }
      } else if (anim) {
        el.classList.add("vhide"); // 페이드-아웃 후 hideTimer가 display:none 처리
      } else {
        el.classList.add("vhide");
        el.style.display = "none";
      }
    }
    // PHASE 1 fix: 숨김→표시 전환 노드의 위치 재시딩.
    // 숨겨진 동안 물리에서 제외돼 스폰 시점의 낡은 좌표(중앙 뭉침)에 얼어 있으므로,
    // 공개 순간 자기 타입 존 중심 둘레의 결정론적 해바라기 나선(황금각 × 타입별 인덱스)에
    // 재배치해 존 안에서 이미 펼쳐진 채로 나타나게 한다. doc 노드는 부모(근거 대상) 둘레.
    // Math.random 미사용 — 인덱스 기반이라 항상 같은 배치.
    const GOLDEN_ANGLE = 2.399963229728653;
    function reseedNode(n: GNode, counters: Map<string, number>) {
      if (n.type === "doc") {
        const pid = n.parent ?? [...(adj.get(n.id) ?? new Set<string>())][0];
        const p = pid ? nmap.get(pid) : undefined;
        const key = "doc:" + (pid ?? "");
        const i = counters.get(key) ?? 0;
        counters.set(key, i + 1);
        const ang = i * GOLDEN_ANGLE;
        const r = 40 + 10 * Math.sqrt(i);
        const bx = p ? p.x : W / 2;
        const by = p ? p.y : H / 2;
        n.x = Math.max(30, Math.min(W - 30, bx + Math.cos(ang) * r));
        n.y = Math.max(30, Math.min(H - 30, by + Math.sin(ang) * r));
      } else {
        const c = TYPE_CENTROID[n.type] ?? { x: W / 2, y: H / 2 };
        const i = counters.get(n.type) ?? 0;
        counters.set(n.type, i + 1);
        const ang = i * GOLDEN_ANGLE;
        const r = 46 + 16 * Math.sqrt(i);
        n.x = Math.max(30, Math.min(W - 30, c.x + Math.cos(ang) * r));
        n.y = Math.max(30, Math.min(H - 30, c.y + Math.sin(ang) * r));
      }
      n.vx = 0;
      n.vy = 0;
    }
    // 뷰 규칙에 따라 모든 노드/엣지의 표시·물리 참여를 재계산.
    function applyView(animate: boolean) {
      if (!built) return;
      const anim = animate && !reduced;
      const toShow: SVGElement[] = [];
      const seedCounters = new Map<string, number>();
      let reseeded = 0;
      for (const n of nodes) {
        if (!n.added || !n.el) continue;
        const vis = nodeVisibleNow(n);
        const wasHidden = n.hiddenNow;
        n.hiddenNow = !vis; // 물리는 즉시 제외/포함(페이드와 무관)
        if (vis && wasHidden) {
          reseedNode(n, seedCounters); // 낡은(동결) 좌표 대신 존/부모 둘레에서 등장
          reseeded++;
        }
        setElVisible(n.el, vis, anim, toShow);
      }
      for (const e of [...edges, ...scenEdges]) {
        if (!e.el) continue;
        const a = nmap.get(e.a);
        const b = nmap.get(e.b);
        const vis =
          !!a && !!b && !a.hiddenNow && !b.hiddenNow &&
          (fullView || e.scen || !excludedByDefault(e) ||
            revealed.has(e.a) || revealed.has(e.b) ||
            sessionAdded.has(e.a) || sessionAdded.has(e.b));
        e.hiddenNow = !vis;
        setElVisible(e.el, vis, anim, toShow);
        if (e.lel) setElVisible(e.lel, vis, anim, toShow);
      }
      // 보이는 엣지 기준 연결도 재계산 — 전체 보기 스프링 정규화(tick)에서 사용.
      for (const n of nodes) n.degNow = 0;
      for (const e of [...edges, ...scenEdges]) {
        if (!e.added || e.hiddenNow) continue;
        const a = nmap.get(e.a);
        const b = nmap.get(e.b);
        if (a) a.degNow++;
        if (b) b.degNow++;
      }
      if (reseeded > 0) {
        // 강한 재가열: 재시딩된 노드들이 반발/스프링으로 존 안에서 빠르게 이완되도록.
        alpha = 1;
        if (reduced) {
          for (let i = 0; i < 300; i++) tick(); // reduced-motion: 즉시 정착
        } else {
          start(); // 루프가 꺼져 있으면 재가동(일반적으로는 이미 실행 중)
        }
        render(); // 재시딩 좌표를 즉시 DOM에 반영(페이드-인 전 낡은 프레임 방지)
      }
      if (anim) {
        if (toShow.length) {
          requestAnimationFrame(() => toShow.forEach((el) => el.classList.remove("vhide")));
        }
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          for (const n of nodes) if (n.hiddenNow && n.el) n.el.style.display = "none";
          for (const e of [...edges, ...scenEdges]) {
            if (!e.hiddenNow) continue;
            if (e.el) e.el.style.display = "none";
            if (e.lel) e.lel.style.display = "none";
          }
        }, 380);
      }
      // 전체 보기에서는 엣지를 배경 텍스처 수준으로 감춰 노드/허브 라벨이 읽히게 한다(CSS).
      svg.classList.toggle("fullview", fullView);
      applyLOD();
    }
    // 전체 보기 라벨 LOD: 연결도(degree) 상위 20개만 라벨 상시 표시, 나머지는 박스만.
    // (hover/선택/lit/pulse 시에는 lbl-on·sel 등의 클래스가 라벨을 다시 켠다 — CSS 참조)
    function applyLOD() {
      if (!fullView) {
        nodes.forEach((n) => n.el && n.el.classList.remove("lodoff"));
        return;
      }
      const vis = nodes.filter((n) => n.added && !n.hiddenNow && n.type !== "doc");
      const deg = (n: GNode) => adj.get(n.id)?.size ?? 0;
      const top = new Set(
        [...vis]
          .sort((a, b) => deg(b) - deg(a) || a.id.localeCompare(b.id)) // 결정론적 타이브레이크
          .slice(0, 20)
          .map((n) => n.id)
      );
      vis.forEach((n) => n.el && n.el.classList.toggle("lodoff", !top.has(n.id)));
    }

    // ── 인터랙션 ──
    let selId: string | null = null;
    // 지속(sticky) 포커스: 노드 선택 시 해당 노드+1홉 이웃만 남기고 나머지를 흐리게 유지한다.
    // hover(일시적)와 달리 다음 선택/배경 클릭/맞춤 보기 전까지 지속된다.
    let focusId: string | null = null;
    let dragN: GNode | null = null;
    // 포커스 기본 표시 제한(P1): 관계 종류별로 일부만 기본 표시(직접 원인·조치·품목 각 4개,
    // 근거 3개). "숨겨진 관계 N개 더 보기"로 확장(focusExpand=true) 시 모든 1홉 이웃 표시.
    let focusExpand = false;
    let focusVisible = new Set<string>(); // 현재 포커스에서 표시 중인 노드 id(선택 노드 포함)
    const FOCUS_PER_REL = 4; // 관계 종류당 기본 표시 이웃 수
    const FOCUS_DOC_CAP = 3; // 근거 문서 기본 표시 수

    function bindNode(g: SVGGElement, n: GNode) {
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        select(n.id);
        onNodeClickRef.current(n.id);
      });
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          select(n.id);
          onNodeClickRef.current(n.id);
        }
      });
      g.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        dragN = n;
        n.fx = n.x;
        n.fy = n.y;
        alpha = Math.max(alpha, 0.6);
      });
      g.addEventListener("mouseenter", () => hover(n.id, true));
      g.addEventListener("mouseleave", () => hover(n.id, false));
    }

    let scenarioRun = false;
    // 시나리오 웨이브가 실제로 점등 애니메이션 중일 때만 true. 이 동안에는 포커스-클릭을
    // 억제해 시나리오의 lit/dim이 우선하도록 한다(웨이브가 끝나면 다시 포커스 허용).
    let scenarioAnimating = false;
    function hover(id: string, on: boolean) {
      if (scenarioRun) return;
      // sticky 포커스가 걸려 있는 동안에는 hover가 포커스를 덮어쓰지 않도록 no-op.
      if (focusId) return;
      const nb = adj.get(id) ?? new Set<string>();
      nodes.forEach((n) => {
        if (!n.el) return;
        const near = n.id === id || nb.has(n.id);
        n.el.classList.toggle("dim", on && !near);
        // PHASE 1 LOD: 전체 보기에서 hover한 노드+이웃은 라벨을 임시로 켠다.
        n.el.classList.toggle("lbl-on", on && near);
        if (n.type === "doc") n.el.classList.toggle("showlbl", on && near);
      });
      edges.forEach((e) => {
        if (!e.el) return;
        const touch = e.a === id || e.b === id;
        e.el.classList.toggle("hov", on && touch);
        e.el.classList.toggle("dim", on && !touch);
      });
    }

    function select(id: string) {
      // PHASE 1: 백본 뷰에서 숨겨진 노드(AUTO_·doc)를 검색/체크리스트로 선택하면
      // 해당 노드 + 1홉 이웃을 자동 공개한다(선택이 조용히 무시되지 않도록).
      const sn = nmap.get(id);
      if (sn && built && !fullView && sn.added && sn.hiddenNow && !scenarioAnimating) {
        revealed.add(id);
        (adj.get(id) ?? new Set<string>()).forEach((o) => revealed.add(o));
        applyView(true);
        notifyView();
      }
      selId = id;
      nodes.forEach((n) => n.el && n.el.classList.toggle("sel", n.id === id));
      // 선택 = sticky 포커스 적용(정상 STAGE-2 탐색 시). 시나리오 실행 중에는
      // 시나리오 자체의 lit/dim이 우선하므로 포커스-클릭을 건너뛴다.
      applyFocus(id);
    }

    // 두 노드를 잇는 엣지(방향 무관)를 찾아 관련도 티어 판정에 사용.
    function edgeBetween(a: string, b: string): GEdge | undefined {
      for (const e of edges)
        if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
      for (const e of scenEdges)
        if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
      return undefined;
    }

    // FEATURE 2: 선택 노드를 로컬 중심으로 두고 1홉 이웃을 관련도-거리 링에 방사 배치.
    // 관련도 높음 = 가까운 링(안쪽), 낮음 = 먼 링(바깥). 각도는 인덱스 기반 결정론 분산.
    function applyRadialFocus(id: string) {
      // 이전 포커스의 방사형 핀을 모두 해제하고 새로 계산.
      nodes.forEach((n) => {
        n.ftx = null;
        n.fty = null;
      });
      const center = nmap.get(id);
      if (!center) return;
      // 선택 노드는 현재 뷰 중심으로 부드럽게 이동(로컬 중심).
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      center.ftx = cx;
      center.fty = cy;
      const tiers: GNode[][] = [[], [], []];
      (adj.get(id) ?? new Set<string>()).forEach((nid) => {
        const nn = nmap.get(nid);
        if (!nn || !nn.added || nn.hiddenNow) return;
        if (!focusVisible.has(nid)) return; // P1: 기본 1-hop 제한에서 숨긴 이웃은 링에 올리지 않음
        const e = edgeBetween(id, nid);
        tiers[relevanceTier(e?.rel, e?.weight)].push(nn);
      });
      tiers.forEach((arr, t) => {
        const r = FOCUS_RINGS[t];
        const count = arr.length;
        arr.forEach((nn, i) => {
          // 링마다 t*0.7 rad 만큼 회전시켜 안·바깥 링의 각이 겹치지 않게 한다.
          const ang = (i / Math.max(1, count)) * Math.PI * 2 + t * 0.7;
          nn.ftx = Math.max(60, Math.min(W - 60, cx + Math.cos(ang) * r));
          nn.fty = Math.max(60, Math.min(H - 60, cy + Math.sin(ang) * r));
        });
      });
      // reduced-motion: 애니메이션 없이 목표로 즉시 수렴. 그 외엔 물리 루프가 보간.
      if (reduced) {
        for (let i = 0; i < 200; i++) tick();
        render();
      } else {
        alpha = Math.max(alpha, 0.5);
      }
    }

    // 선택 노드 + 1홉 이웃 중 기본 표시분(핵심 전부 + 주변/근거 일부)만 남기고 나머지는 dim.
    function applyFocus(id: string) {
      // 시나리오 웨이브 애니메이션 중에는 시나리오 점등이 우선 — 포커스-클릭을 건너뛴다.
      // (STAGE 2 탐색 및 웨이브 종료 후의 명시적 노드/체크리스트 클릭에서는 포커스가 적용된다.)
      if (scenarioAnimating) return;
      if (focusId !== id) focusExpand = false; // 다른 노드로 이동하면 기본(제한) 뷰로 복귀
      focusId = id;

      // P1: 이웃을 관계 종류별로 묶어 기본 표시분을 고른다 — 직접 원인/조치/품목 등
      // 각 종류에서 일부(FOCUS_PER_REL)만, 근거 문서는 FOCUS_DOC_CAP 만. 나머지는
      // "숨겨진 관계 N개 더 보기"로 확장해야 표시된다(대형 허브 노드의 시각 과부하 방지).
      const byRel = new Map<string, string[]>();
      (adj.get(id) ?? new Set<string>()).forEach((nid) => {
        const nn = nmap.get(nid);
        // 숨은 이웃(백본 밖 고장모드·원인·조치·문서)도 후보에 포함 — 클릭 시 캡만큼 공개한다.
        if (!nn || !nn.added || nn.hidden) return; // n.hidden(시나리오 공개 전)만 제외
        const e = edgeBetween(id, nid);
        let key = (e?.rel ?? "REL").toUpperCase();
        if (key.startsWith("SIMILAR")) key = "SIMILAR";
        const arr = byRel.get(key);
        if (arr) arr.push(nid);
        else byRel.set(key, [nid]);
      });
      let total = 0;
      focusVisible = new Set<string>([id]);
      // 방금 합류한(fresh 강조) 노드는 종류별 캡에서 최우선 — 인제스천 직후 포커스가
      // 새 노드를 잘라내(디밍) "3개가 1개로 줄어드는" 문제 방지.
      const freshScore = (nid: string) => (nmap.get(nid)?.el?.classList.contains("fresh") ? 1 : 0);
      byRel.forEach((ids, rel) => {
        total += ids.length;
        const cap = rel === "EVIDENCED_BY" ? FOCUS_DOC_CAP : FOCUS_PER_REL;
        const ordered = focusExpand ? ids : [...ids].sort((x, y) => freshScore(y) - freshScore(x));
        for (const nid of focusExpand ? ids : ordered.slice(0, cap)) focusVisible.add(nid);
      });
      const hidden = total - (focusVisible.size - 1);
      onFocusChangeRef.current?.({ hidden, total, expanded: focusExpand });

      // 클릭한 노드의 focusVisible(캡 적용 1홉 이웃)만 백본 위에 공개. revealed 를 매 포커스마다
      // 리셋 → 누적 없이 항상 "백본 앵커 + 현재 노드 이웃"만 보이게(렉 방지).
      if (built && !fullView && !scenarioAnimating) {
        revealed.clear();
        focusVisible.forEach((fid) => revealed.add(fid));
        applyView(true);
        notifyView();
      }

      nodes.forEach((n) => {
        if (!n.el) return;
        const near = focusVisible.has(n.id);
        // 포커스 시 나머지 노드를 dim(가림)하지 않는다 — 대신 포커스 노드+이웃에 글로우(.lit) 강조.
        n.el.classList.remove("dim");
        n.el.classList.toggle("lit", near);
        n.el.classList.toggle("lbl-on", near);
        if (n.type === "doc") n.el.classList.toggle("showlbl", near);
      });
      edges.forEach((e) => {
        if (!e.el) return;
        const touch =
          (e.a === id && focusVisible.has(e.b)) || (e.b === id && focusVisible.has(e.a));
        e.el.classList.toggle("hov", touch);
        e.el.classList.toggle("dim", !touch);
      });
      // FEATURE 2: 이웃을 관련도 거리로 방사 배치(존 클러스터를 일시적으로 오버라이드).
      applyRadialFocus(id);
    }

    /** "숨겨진 관계 N개 더 보기" ↔ "핵심 관계만 보기" — 같은 노드 재적용은 expand를 유지한다. */
    function setFocusExpand(on: boolean) {
      focusExpand = on;
      if (focusId) applyFocus(focusId);
    }

    // sticky 포커스 해제 → 모든 노드/엣지 전체 불투명 복귀 + 방사형 핀 해제로 존 클러스터 재개.
    function clearFocus() {
      focusId = null;
      focusExpand = false;
      focusVisible = new Set();
      onFocusChangeRef.current?.(null);
      nodes.forEach((n) => {
        // FEATURE 2: 방사형 핀 해제 → 타입 존 중력이 다시 배치를 이어받는다.
        n.ftx = null;
        n.fty = null;
        if (!n.el) return;
        n.el.classList.remove("dim", "lit", "lbl-on");
        if (n.type === "doc") n.el.classList.remove("showlbl");
      });
      edges.forEach((e) => {
        if (!e.el) return;
        e.el.classList.remove("dim", "hov");
      });
      // PHASE 1: 포커스로 임시 공개된 노드는 다시 접는다(백본 기본 복귀).
      if (built && !fullView && revealed.size) {
        revealed.clear();
        applyView(true);
        notifyView();
      }
      // 존 클러스터 재정렬을 위해 물리를 다시 활성화(reduced 모드는 즉시 정착).
      if (reduced) {
        for (let i = 0; i < 200; i++) tick();
        render();
      } else {
        alpha = Math.max(alpha, 0.5);
      }
    }

    // ── 검색 ──
    function applySearch(hits: SearchHit[], neighbors: string[], query: string) {
      const hitIds = new Set(hits.map((h) => h.id));
      const neighborIds = new Set(neighbors);
      // 백본 뷰에서 숨겨진 히트(AUTO_ 등)는 공개해야 강조가 보인다 — 답변의 핵심 노드가
      // 캔버스에 없으면 "제대로 안 나온다"로 보임(선택(select)과 동일한 공개 규칙).
      if (query && built && !fullView && !scenarioAnimating) {
        let opened = false;
        for (const id of hitIds) {
          const n = nmap.get(id);
          if (n && n.added && n.hiddenNow) { revealed.add(id); opened = true; }
        }
        if (opened) { applyView(true); notifyView(); }
      }
      const lit = (id: string) => hitIds.has(id) || neighborIds.has(id);
      nodes.forEach((n) => {
        if (!n.el) return;
        const isHit = hitIds.has(n.id);
        n.el.classList.toggle("pulse", isHit);
        n.el.classList.toggle("dim", query ? !lit(n.id) : false);
      });
      // 엣지도 노드와 함께 디밍 — 노드만 흐려지면 흐려진 노드에 붙은 선들이
      // "허공에 뜬 선"으로 남는다(양끝이 하이라이트 집합일 때만 선 유지).
      for (const e of [...edges, ...scenEdges]) {
        if (!e.el) continue;
        const on = !query || (lit(e.a) && lit(e.b));
        e.el.classList.toggle("dim", !on);
        if (e.lel) e.lel.classList.toggle("dim", !on);
      }
      // 검색 방사형 배치: 부품(item) 히트를 중앙에, 관련 노드들을 타입별로 묶어(같은 유형 =
      // 이웃한 각도 섹터) 둘레에 핀 고정. 검색 해제 시 핀 해제 → 존 클러스터 복귀.
      nodes.forEach((n) => { n.ftx = null; n.fty = null; });
      if (query) {
        const centerHit =
          hits.map((h) => nmap.get(h.id)).find((n) => n && !n.hiddenNow && n.type === "item") ??
          hits.map((h) => nmap.get(h.id)).find((n) => n && !n.hiddenNow);
        if (centerHit) {
          const cx = vb.x + vb.w / 2;
          const cy = vb.y + vb.h / 2;
          centerHit.ftx = cx;
          centerHit.fty = cy;
          const others: GNode[] = [];
          for (const id of [...hitIds, ...neighborIds]) {
            if (id === centerHit.id) continue;
            const n = nmap.get(id);
            if (n && n.added && !n.hiddenNow) others.push(n);
          }
          // 타입별 그룹 → 개수 비례 각도 섹터(같은 유형끼리 인접 배치)
          const byType = new Map<string, GNode[]>();
          for (const n of others) {
            const arr = byType.get(n.type);
            if (arr) arr.push(n);
            else byType.set(n.type, [n]);
          }
          let angStart = -Math.PI / 2;
          const total = Math.max(1, others.length);
          for (const [, arr] of byType) {
            const span = (arr.length / total) * Math.PI * 2;
            arr.forEach((n, i) => {
              const ang = angStart + span * ((i + 0.5) / arr.length);
              const r = n.type === "doc" ? 420 : 250;
              n.ftx = Math.max(60, Math.min(W - 60, cx + Math.cos(ang) * r));
              n.fty = Math.max(60, Math.min(H - 60, cy + Math.sin(ang) * r));
            });
            angStart += span;
          }
        }
      }
      alpha = Math.max(alpha, 0.6);
      if (reduced) { for (let i = 0; i < 200; i++) tick(); render(); }
    }

    // ── 팬/줌/드래그 ──
    let vb = { x: 0, y: 0, w: W, h: H };
    let panning = false;
    // 배경 mousedown이 드래그(팬)였는지, 순수 클릭이었는지 구분 — 순수 클릭만 포커스를 해제한다.
    let pressMoved = false;
    let ps = { x: 0, y: 0, vx: 0, vy: 0 };
    function applyVB() {
      svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    }
    function svgPt(cx: number, cy: number) {
      const r = svg.getBoundingClientRect();
      return {
        x: vb.x + ((cx - r.left) / r.width) * vb.w,
        y: vb.y + ((cy - r.top) / r.height) * vb.h,
      };
    }
    function zoom(f: number, cx?: number, cy?: number) {
      const r = svg.getBoundingClientRect();
      const ccx = cx ?? r.left + r.width / 2;
      const ccy = cy ?? r.top + r.height / 2;
      const p = svgPt(ccx, ccy);
      vb.w = Math.min(2800, Math.max(500, vb.w * f));
      vb.h = (vb.w * H) / W;
      vb.x = p.x - ((ccx - r.left) / r.width) * vb.w;
      vb.y = p.y - ((ccy - r.top) / r.height) * vb.h;
      applyVB();
    }

    const onMouseDown = (e: MouseEvent) => {
      panning = true;
      pressMoved = false;
      svg.classList.add("dragging");
      ps = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (dragN) {
        const p = svgPt(e.clientX, e.clientY);
        dragN.fx = p.x;
        dragN.fy = p.y;
        alpha = Math.max(alpha, 0.4);
        return;
      }
      if (!panning) return;
      if (Math.abs(e.clientX - ps.x) > 4 || Math.abs(e.clientY - ps.y) > 4) pressMoved = true;
      const r = svg.getBoundingClientRect();
      vb.x = ps.vx - (e.clientX - ps.x) * (vb.w / r.width);
      vb.y = ps.vy - (e.clientY - ps.y) * (vb.h / r.height);
      applyVB();
    };
    const onMouseUp = () => {
      // 노드가 아닌 빈 배경을 드래그 없이 클릭 → sticky 포커스 해제.
      // (노드 mousedown은 stopPropagation 하므로 배경 press일 때만 panning=true)
      const bgClick = panning && !dragN && !pressMoved;
      if (dragN) {
        dragN.fx = null;
        dragN.fy = null;
        dragN = null;
      }
      panning = false;
      svg.classList.remove("dragging");
      if (bgClick && !scenarioRun && focusId) {
        clearFocus();
        clearSelection();
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.09 : 0.92, e.clientX, e.clientY);
    };
    svg.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    svg.addEventListener("wheel", onWheel, { passive: false });

    // ── STAGE 2: 온톨로지 구축 ──
    const typeCnt: Partial<Record<ObjType, number>> = {};
    let nCount = 0;
    let eCount = 0;
    // 인제스천 델타가 구축 이후에도 카운터를 갱신할 수 있도록 마지막 onCounts를 보관.
    let lastOnCounts: ((c: GraphCounts) => void) | null = null;
    function bump(n: GNode, onCounts: (c: GraphCounts) => void) {
      nCount++;
      typeCnt[n.type] = (typeCnt[n.type] ?? 0) + 1;
      onCounts({ nodes: nCount, edges: eCount, byType: { ...typeCnt } });
    }
    function bumpE(onCounts: (c: GraphCounts) => void) {
      eCount++;
      onCounts({ nodes: nCount, edges: eCount, byType: { ...typeCnt } });
    }

    function buildOntology(
      allNodes: Node[],
      allEdges: Edge[],
      handlers: {
        onLog: (html: string) => void;
        onCounts: (counts: GraphCounts) => void;
        onProgress: (pct: number) => void;
        onDone: () => void;
      },
      opts?: { instant?: boolean }
    ) {
      const { onLog, onCounts, onProgress, onDone } = handlers;
      lastOnCounts = onCounts;
      start();

      const coreDefs = allNodes.filter((n) => n.type !== "doc" && !n.hidden);
      const docDefs = allNodes.filter((n) => n.type === "doc");
      const coreEdgeDefs = allEdges.filter(
        (e) => !e.scen && e.rel !== "EVIDENCED_BY"
      );
      const evidenceEdgeDefs = allEdges.filter((e) => !e.scen && e.rel === "EVIDENCED_BY");
      const scenNodeDefs = allNodes.filter((n) => n.hidden);
      const scenEdgeDefs = allEdges.filter((e) => e.scen);

      // 시나리오(3단계) 노드/엣지는 미리 등록만 해두고 마운트하지 않는다.
      scenNodeDefs.forEach((n) => addNode(n));
      // scenEdgeDefs는 stage3에서 runScenario 호출 시 전달받아 마운트.
      void scenEdgeDefs;

      // ── 즉시 모드(?update=1): 연출 없이 전체를 동기 마운트하고 곧바로 완료 상태로 ──
      if (opts?.instant) {
        const evByDocI = new Map<string, Edge>();
        evidenceEdgeDefs.forEach((e) => evByDocI.set(e.dst, e));
        coreDefs.forEach((def) => {
          const n = addNode(def);
          mountNode(n);
          bump(n, onCounts);
        });
        coreEdgeDefs.forEach((def) => {
          const e: GEdge = { a: def.src, b: def.dst, rel: def.rel, weight: def.weight, scen: false, el: null, lel: null, added: false };
          edges.push(e);
          mountEdge(e);
          addAdj(e.a, e.b);
          bumpE(onCounts);
        });
        docDefs.forEach((d) => {
          const evEdge = evByDocI.get(d.id);
          const parentId = d.parent ?? evEdge?.src;
          const p = parentId ? nmap.get(parentId) : undefined;
          const n = addNode(d);
          if (p) {
            n.x = p.x + (Math.random() * 90 - 45);
            n.y = p.y + (Math.random() * 90 - 45);
          }
          mountNode(n);
          bump(n, onCounts);
          if (parentId) {
            const e: GEdge = { a: parentId, b: d.id, rel: "EVIDENCED_BY", scen: false, el: null, lel: null, added: false };
            edges.push(e);
            mountEdge(e);
            addAdj(e.a, e.b);
            bumpE(onCounts);
          }
        });
        onLog(`[docling] <span class="ok">✓ 완료</span> — 객체 ${nCount} · 관계 ${eCount}`);
        onProgress(100);
        built = true;
        applyView(true);
        for (let i = 0; i < 240; i++) tick(); // 물리 정착(연출 없이 배치 수렴)
        render();
        notifyView();
        onDone();
        return;
      }

      // 스폰 페이싱은 규모 반비례 — 시드(≈55노드)든 인제스천(≈135노드/1300+엣지)이든
      // 구축 연출이 총 ~6초 예산 안에 끝난다(고정 간격이면 대규모에서 30초+로 늘어짐).
      const NODE_BUDGET_MS = 3000; // 코어 객체 스폰 총 시간
      const EDGE_BUDGET_MS = 2200; // 코어 관계 스폰 총 시간
      const nodeStep = Math.min(120, Math.max(12, NODE_BUDGET_MS / Math.max(1, coreDefs.length)));

      // 6-1. 코어 객체 순차 스폰
      coreDefs.forEach((def, i) => {
        setTimeout(() => {
          const n = addNode(def);
          mountNode(n);
          bump(n, onCounts);
          alpha = 1;
          onLog(
            `[docling] <span class="ok">✓</span> 객체 생성 <span class="obj">${TYPES[n.type].g}</span> ${n.label}`
          );
        }, 300 + i * nodeStep);
      });
      const tCore = 300 + coreDefs.length * nodeStep;

      // 6-2. 코어 관계 스폰 — 40ms 틱마다 배치 마운트(엣지 수와 무관하게 EDGE_BUDGET 안에 완료)
      const EDGE_TICK_MS = 40;
      const edgeTicks = Math.max(1, Math.floor(EDGE_BUDGET_MS / EDGE_TICK_MS));
      const edgeBatchSize = Math.max(1, Math.ceil(coreEdgeDefs.length / edgeTicks));
      for (let t = 0; t * edgeBatchSize < coreEdgeDefs.length; t++) {
        const batch = coreEdgeDefs.slice(t * edgeBatchSize, (t + 1) * edgeBatchSize);
        setTimeout(() => {
          for (const def of batch) {
            const e: GEdge = { a: def.src, b: def.dst, rel: def.rel, weight: def.weight, scen: false, el: null, lel: null, added: false };
            edges.push(e);
            mountEdge(e);
            addAdj(e.a, e.b);
            bumpE(onCounts);
          }
          alpha = Math.max(alpha, 0.8);
        }, tCore + t * EDGE_TICK_MS);
      }
      const tEdge = tCore + Math.ceil(coreEdgeDefs.length / edgeBatchSize) * EDGE_TICK_MS;

      // 6-3. 근거 문서 위성 스트리밍 (배치)
      const docQueue = [...docDefs];
      const evByDoc = new Map<string, Edge>();
      evidenceEdgeDefs.forEach((e) => evByDoc.set(e.dst, e));
      const total = docQueue.length;
      let done = 0;
      function spawnBatch() {
        const batch = docQueue.splice(0, 8);
        if (!batch.length) {
          onProgress(100);
          onLog(`[docling] <span class="ok">✓ 완료</span> — 객체 ${nCount} · 관계 ${eCount}`);
          // PHASE 1: 구축 종료 → 핵심 백본 뷰로 자동 정리(전체는 "전체 보기" 토글).
          built = true;
          applyView(true);
          alpha = Math.max(alpha, 0.6);
          if (reduced) {
            for (let i = 0; i < 200; i++) tick();
            render();
          }
          notifyView();
          onDone();
          return;
        }
        batch.forEach((d) => {
          const evEdge = evByDoc.get(d.id);
          const parentId = d.parent ?? evEdge?.src;
          const p = parentId ? nmap.get(parentId) : undefined;
          const n = addNode(d);
          if (p) {
            n.x = p.x + (Math.random() * 90 - 45);
            n.y = p.y + (Math.random() * 90 - 45);
          }
          mountNode(n);
          bump(n, onCounts);
          if (parentId) {
            const e: GEdge = {
              a: parentId,
              b: d.id,
              rel: "EVIDENCED_BY",
              scen: false,
              el: null,
              lel: null,
              added: false,
            };
            edges.push(e);
            mountEdge(e);
            addAdj(e.a, e.b);
            bumpE(onCounts);
          }
          done++;
        });
        alpha = Math.max(alpha, 0.7);
        const last = batch[batch.length - 1];
        onLog(`[docling] <span class="ok">✓</span> ${last.label} → 근거 링크 연결`);
        onProgress(Math.round((done / Math.max(1, total)) * 100));
        setTimeout(spawnBatch, 150);
      }
      setTimeout(spawnBatch, tEdge + 200);
    }

    // ── STAGE 3: 시나리오 추론 ──
    function runScenario(
      scenarioNodeId: string,
      scenEdgeDefs: Edge[],
      waves: string[][],
      handlers: { onWave: (i: number) => void; onDone: () => void }
    ) {
      const { onWave, onDone } = handlers;
      scenarioRun = true;
      scenarioAnimating = true;
      // 시나리오 시작 시 기존 sticky 포커스는 해제(시나리오 점등이 무대를 넘겨받는다).
      clearFocus();
      const pj = nmap.get(scenarioNodeId);
      if (pj) {
        pj.hidden = false;
        mountNode(pj);
        if (pj.el) {
          pj.el.style.display = "";
          pj.el.classList.add("pulse");
        }
        notifyView(); // PHASE 1: 시나리오 노드 공개 → 표시 수 갱신
      }
      scenEdgeDefs.forEach((def) => {
        const e: GEdge = { a: def.src, b: def.dst, rel: def.rel, weight: def.weight, scen: true, el: null, lel: null, added: false };
        scenEdges.push(e);
        mountEdge(e);
        addAdj(e.a, e.b);
      });
      alpha = 1;
      start();
      setTimeout(() => {
        nodes.forEach((n) => {
          if (n.el && n.id !== scenarioNodeId) n.el.classList.add("dim");
        });
        [...edges, ...scenEdges].forEach((e) => e.el && e.el.classList.add("dim"));
      }, 600);

      const litSet = new Set<string>([scenarioNodeId]);
      waves.forEach((wave, wi) => {
        setTimeout(() => {
          wave.forEach((id) => {
            const n = nmap.get(id);
            if (!n) return;
            litSet.add(id);
            if (n.el) {
              n.el.classList.remove("dim");
              n.el.classList.add("lit");
            }
            let c = 0;
            (adj.get(id) ?? new Set<string>()).forEach((o) => {
              const on = nmap.get(o);
              if (c < 2 && on && on.type === "doc") {
                litSet.add(o);
                c++;
                // PHASE 1: 백본 뷰에서 숨겨진 근거 문서는 웨이브 점등 시 임시 공개.
                if (built && !fullView && on.hiddenNow) revealed.add(o);
                if (on.el) {
                  on.el.classList.remove("dim");
                  on.el.classList.add("lit", "showlbl");
                }
              }
            });
          });
          if (!fullView && revealed.size) {
            applyView(false); // 공개된 근거 문서/EVIDENCED_BY 엣지를 즉시 표시(점등 전에)
            notifyView();
          }
          [...edges, ...scenEdges].forEach((e) => {
            if (litSet.has(e.a) && litSet.has(e.b) && e.el) {
              e.el.classList.remove("dim");
              e.el.classList.add("lit");
              if (e.lel) e.lel.classList.add("lit");
            }
          });
          alpha = Math.max(alpha, 0.5);
          onWave(wi);
        }, 900 + wi * 900);
      });
      setTimeout(() => {
        // 웨이브 애니메이션 종료 → 이후 명시적 클릭(체크리스트 trace 등)은 포커스 허용.
        scenarioAnimating = false;
        onDone();
      }, 900 + waves.length * 900 + 400);
    }

    function clearSelection() {
      selId = null;
      nodes.forEach((n) => n.el && n.el.classList.remove("sel"));
      clearFocus();
    }

    // PHASE 1: 전체 보기 ↔ 핵심(백본)만 보기 전환. 예측 가능한 상태를 위해
    // 전환 시 sticky 포커스/임시 공개는 초기화한다. 시나리오 웨이브 중에는 무시.
    function setFullView(on: boolean) {
      if (!built || scenarioAnimating || fullView === on) return;
      fullView = on;
      revealed.clear();
      if (focusId) clearSelection(); // revealed는 이미 비웠으므로 내부 applyView 중복 없음
      applyView(true);
      alpha = Math.max(alpha, 0.7);
      if (reduced) {
        for (let i = 0; i < 250; i++) tick();
        render();
      } else {
        start();
      }
      notifyView();
    }

    // 객체 타입 탐색기: 특정 타입만 표시(null = 기본 앵커 뷰 복귀). 팔란티어 Object Explorer 파고들기.
    function filterByType(t: string | null) {
      if (!built || scenarioAnimating || typeFilter === t) return;
      typeFilter = t;
      revealed.clear();
      if (focusId) clearSelection();
      applyView(true);
      alpha = Math.max(alpha, 0.7);
      if (reduced) {
        for (let i = 0; i < 250; i++) tick();
        render();
      } else {
        start();
      }
      notifyView();
    }

    // ── 인제스천 델타 합류 ──
    // 새 노드/엣지를 초기 로드와 동일한 자료구조(nodes/nmap/edges/adj)에 등록하고,
    // 타입 존 중심 둘레의 결정론적 황금각 나선(reseedNode)으로 시딩한 뒤 스폰+펄스로 마운트한다.
    // doc 노드(doc:<file>)와 EVIDENCED_BY 근거 엣지는 초기 로드 뷰 규칙과 동일하게 캔버스에 올리지 않는다.
    // 합류한 노드는 sessionAdded에 넣어 백본/전체 어느 뷰에서도 리셋 전까지 항상 보이게 한다.
    const deltaPulseTimers: number[] = [];
    function addDelta(newNodes: Node[], newEdges: Edge[]) {
      const docIds = new Set(newNodes.filter((n) => n.type === "doc").map((n) => n.id));
      const nodeDefs = newNodes.filter((n) => n.type !== "doc" && !nmap.has(n.id));
      const edgeDefs = newEdges.filter(
        (e) => e.rel !== "EVIDENCED_BY" && !docIds.has(e.src) && !docIds.has(e.dst)
      );

      // 1) 새 노드 — 나선 인덱스는 같은 타입의 기존 노드 수에서 이어가 존 안에서 겹치지 않게.
      const seedCounters = new Map<string, number>();
      for (const n of nodes) {
        if (n.type !== "doc") seedCounters.set(n.type, (seedCounters.get(n.type) ?? 0) + 1);
      }
      const spawned: GNode[] = [];
      for (const def of nodeDefs) {
        const gn = addNode(def);
        reseedNode(gn, seedCounters);
        mountNode(gn);
        sessionAdded.add(gn.id);
        spawned.push(gn);
        nCount++;
        typeCnt[gn.type] = (typeCnt[gn.type] ?? 0) + 1;
      }

      // 2) 새 엣지 — 양 끝이 모두 캔버스(비-doc) 노드일 때만 마운트.
      //    기존 백본 밖(AUTO_ 숨김) 노드에 닿았다면 그 끝점도 세션 공개해 관계가 실제로 보이게 한다.
      const freshEdges: GEdge[] = [];
      for (const def of edgeDefs) {
        const a = nmap.get(def.src);
        const b = nmap.get(def.dst);
        if (!a || !b || a.type === "doc" || b.type === "doc") continue;
        const ge: GEdge = {
          a: def.src,
          b: def.dst,
          rel: def.rel,
          weight: def.weight,
          scen: false,
          el: null,
          lel: null,
          added: false,
        };
        edges.push(ge);
        mountEdge(ge);
        addAdj(ge.a, ge.b);
        eCount++;
        freshEdges.push(ge);
        if (!isBackbone(a)) sessionAdded.add(a.id);
        if (!isBackbone(b)) sessionAdded.add(b.id);
      }

      // 3) 합류 연출 — 새 객체는 빨간 링 + 팝인 + 레이더 핑, 새 관계는 빨간 대시 흐름으로
      //    ~9초간 강조해 "방금 들어온 것"이 화면에서 확실히 구분되게 한다.
      spawned.forEach((gn) => {
        if (!gn.el) return;
        gn.el.classList.add("fresh", "lbl-on");
        const cx = (gn.w ?? 32) / 2;
        const cy = (gn.h ?? 32) / 2;
        for (let i = 0; i < 2; i++) {
          const ping = elNS("circle", { class: "delta-ping", cx, cy, r: 26 }, gn.el);
          ping.style.animationDelay = `${i * 0.8}s`;
        }
      });
      freshEdges.forEach((ge) => ge.el?.classList.add("fresh"));
      deltaPulseTimers.push(
        window.setTimeout(() => {
          spawned.forEach((gn) => {
            if (!gn.el) return;
            gn.el.classList.remove("fresh", "lbl-on");
            gn.el.querySelectorAll(".delta-ping").forEach((p) => p.remove());
          });
          freshEdges.forEach((ge) => ge.el?.classList.remove("fresh"));
        }, 9000)
      );

      // 4) 뷰 재계산(sessionAdded 반영·기존 숨김 끝점 재시딩) + 물리 재가열.
      applyView(true);
      alpha = 1;
      if (reduced) {
        for (let i = 0; i < 250; i++) tick();
        render();
      } else {
        start();
      }
      notifyView();
      lastOnCounts?.({ nodes: nCount, edges: eCount, byType: { ...typeCnt } });
    }

    // 큐레이션 반영 — 노드/엣지를 캔버스·인덱스에서 제거(서버 삭제·병합 후).
    function removeFromCanvas(nodeIds: string[], edgeKeys: string[]) {
      const ids = new Set(nodeIds);
      const keys = new Set(edgeKeys);
      clearFocus();
      const dropE = (arr: GEdge[]) => {
        for (let i = arr.length - 1; i >= 0; i--) {
          const e = arr[i];
          if (ids.has(e.a) || ids.has(e.b) || keys.has(`${e.a}|${e.rel}|${e.b}`)) {
            e.el?.remove();
            e.lel?.remove();
            adj.get(e.a)?.delete(e.b);
            adj.get(e.b)?.delete(e.a);
            arr.splice(i, 1);
            eCount = Math.max(0, eCount - 1);
          }
        }
      };
      dropE(edges);
      dropE(scenEdges);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (!ids.has(n.id)) continue;
        n.el?.remove();
        nmap.delete(n.id);
        adj.delete(n.id);
        nodes.splice(i, 1);
        nCount = Math.max(0, nCount - 1);
        if (n.type !== "doc") typeCnt[n.type] = Math.max(0, (typeCnt[n.type] ?? 1) - 1);
      }
      lastOnCounts?.({ nodes: nCount, edges: eCount, byType: { ...typeCnt } });
      notifyView();
      alpha = Math.max(alpha, 0.5);
    }

    controllerRef.current = {
      buildOntology,
      runScenario,
      applySearch,
      clearSelection,
      selectNode: select,
      zoomBy: (f: number) => zoom(f),
      zoomFit: () => {
        vb = { x: 0, y: 0, w: W, h: H };
        applyVB();
        clearFocus();
      },
      setFullView,
      filterByType,
      addDelta,
      setFocusExpand,
      removeFromCanvas,
    };

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(hideTimer);
      deltaPulseTimers.forEach((t) => window.clearTimeout(t));
      svg.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      svg.removeEventListener("wheel", onWheel);
      controllerRef.current = null;
    };
    // 마운트 시 1회만 초기화 — onNodeClick은 ref로 최신값을 참조한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <svg id="graph" ref={svgRef} aria-label="온톨로지 그래프" />
    </div>
  );
});

export default Graph;
