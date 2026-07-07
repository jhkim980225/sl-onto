// lib/infer.ts — 추론 엔진 (핵심).
// 신규 설계 조건(DesignInput) → 온톨로지 그래프 탐색 → 근거·확신도가 붙은 설계 검토 체크리스트.
// 하드코딩 금지: 모든 항목은 store 그래프에서 계산되고, trace 는 실제 엣지 경로다.
// 참조: docs/features/inference.md, docs/data-model.md, FMEA_온톨로지_시연_v2.html
import type { DesignInput, InferResponse, CheckItem, Node, Edge, MasterAudit } from "./types";
import { getNode, allNodes, outEdges, inEdges, evidenceOf } from "./store";
import { SYNONYMS } from "./nlsearch";

/* ────────────────────────── 확신도 가중치 (튜닝 상수) ────────────────────────── */
// confidence = clamp( w1*유사도 + w2*근거수정규화 + w3*심각도정규화 + w4*마스터일치 + 조건부스트 ) * 100
const W1_SIM = 0.4;
const W2_EVID = 0.15;
const W3_SEV = 0.3;
const W4_MASTER = 0.15;
const EVID_FULL = 10; // 근거 문서 정규화 기준 (이 이상이면 1.0)
const SEV_FULL = 10; // 심각도 S 정규화 기준

// 조건 부스트 (파이프라인 4단계)
const BOOST_MARKET = 0.08; // 시장 법규 일치
const BOOST_SLIM = 0.1; // 슬림 → 수축 원인 가중
const BOOST_LED = 0.08; // LED → 방열 인과사슬
const BOOST_FOG = 0.1; // 밀폐·방수 형상 → 결로·습기 가중 (벤트·씰링 인과)
const BOOST_SHAPE = 0.06; // 형상 키워드 관련성
const BOOST_COMPONENT = 0.04; // 대상 부품 일치

// 프로젝트 유사도 결합 (SIMILAR 엣지 가중 + 조건 매칭)
const SIM_EDGE_W = 0.65;
const SIM_COND_W = 0.35;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const arrow = "→"; // →

// 한글 문자열 비교는 유니코드 정규화 형태(NFC/NFD)에 민감하다. SWC(Next 빌드)와
// node --strip-types 는 소스 리터럴을 서로 다른 형태로 컴파일할 수 있어, HTTP 입력·시드
// 데이터·소스 리터럴이 섞이면 시각적으로 같아도 .includes()/정규식이 어긋난다.
// → 모든 비교 경계에서 NFC 로 정규화해 견고하게 만든다.
const norm = (s: string | undefined | null): string => (s ?? "").normalize("NFC");

/* ────────────────────────── 탐색 누적기 (traversed 카운트) ────────────────────────── */
interface Traversal {
  objects: Set<string>;
  edges: Set<string>; // key: src|rel|dst
  docs: Set<string>;
}
function edgeKey(e: Edge): string {
  return `${e.src}|${e.rel}|${e.dst}`;
}
function hopStr(e: Edge): string {
  return `${e.src}${arrow}${e.rel}${arrow}${e.dst}`;
}

/* ────────────────────────── 그래프 탐색 헬퍼 ────────────────────────── */
interface Step {
  edge: Edge;
  node: Node;
}
/** src 에서 rel 조건을 만족하는 out 엣지를 따라간 (엣지, 도착노드) 목록. 누락 노드는 건너뜀. */
function follow(srcId: string, relPred: (rel: string) => boolean, tv: Traversal): Step[] {
  const res: Step[] = [];
  for (const e of outEdges(srcId)) {
    if (!relPred(e.rel)) continue;
    const node = getNode(e.dst);
    if (!node) continue;
    tv.edges.add(edgeKey(e));
    tv.objects.add(e.src);
    tv.objects.add(e.dst);
    res.push({ edge: e, node });
  }
  return res;
}
/** 특정 (src,rel,dst) 엣지가 실제 존재하면 반환 (trace hop 검증용). */
function findEdge(srcId: string, relPred: (rel: string) => boolean, dstId: string): Edge | undefined {
  return outEdges(srcId).find((e) => e.dst === dstId && relPred(e.rel));
}

/** 앵커와 근거 문서를 공유하는 순으로 정렬 — 자유 텍스트 공동언급 노이즈(과다 링크) 대신
 * 같은 사건 문서에서 나온 조치·마스터가 제목/근거 대표로 뽑히게 한다. 동률은 원래 순서 유지. */
function sortByEvidenceOverlap(steps: Step[], anchorId: string): Step[] {
  if (steps.length < 2) return steps;
  const anchorDocs = new Set(evidenceOf(anchorId).map((d) => d.id));
  return steps
    .map((s, i) => {
      let ov = 0;
      for (const d of evidenceOf(s.node.id)) if (anchorDocs.has(d.id)) ov++;
      return { s, i, ov };
    })
    .sort((a, b) => b.ov - a.ov || a.i - b.i)
    .map((x) => x.s);
}

const isSimilar = (r: string) => /^SIMILAR/i.test(r);
const isRel = (name: string) => (r: string) => r === name;

/** SIMILAR 엣지의 유사도 값 (weight 필드 우선, 없으면 rel 문자열에서 파싱). */
function edgeWeight(e: Edge): number | undefined {
  if (typeof e.weight === "number") return e.weight;
  const m = /([0-9]*\.?[0-9]+)/.exec(e.rel);
  return m ? parseFloat(m[1]) : undefined;
}

/** 노드 props/label/sub 를 하나의 검색 문자열로 (NFC 정규화). */
function nodeText(n: Node): string {
  let t = `${n.label} ${n.sub ?? ""}`;
  if (n.props) for (const [k, v] of n.props) t += ` ${k} ${v}`;
  return norm(t);
}

/** 심각도 S 파싱 (props 에서 '심각도 S' 또는 'S' 키). 없으면 기본 5. */
function severityOf(n: Node | undefined): number {
  if (!n || !n.props) return 5;
  for (const [k, v] of n.props) {
    if (/심각도|(^|[^A-Za-z])S($|[^A-Za-z])/.test(k) || k.trim() === "S") {
      const m = /([0-9]+(\.[0-9]+)?)/.exec(v);
      if (m) return parseFloat(m[1]);
    }
  }
  return 5;
}

/* ────────────────────────── 조건(시장·형상·광원) ────────────────────────── */
function marketKeywords(m: string): string[] {
  const mm = norm(m);
  const map: Record<string, string[]> = {
    북미: ["북미", "미국", "캐나다", "FMVSS", "North"],
    유럽: ["유럽", "ECE", "R149", "Europe"],
    한국: ["한국", "KMVSS", "Korea"],
    중국: ["중국", "GB", "China"],
  };
  for (const k of Object.keys(map)) if (mm.includes(norm(k))) return map[k].map(norm);
  return mm ? [mm] : [];
}
/** 형상 구절을 토큰으로 분해 ("분리형 DRL" → ["분리형","DRL"]), NFC 정규화. */
function shapeTokens(shape: string[]): string[] {
  const out: string[] = [];
  for (const s of shape) for (const tok of norm(s).split(/\s+/)) if (tok.length >= 2) out.push(tok);
  return out;
}
function textMatchesAny(text: string, keys: string[]): boolean {
  const t = norm(text);
  return keys.some((k) => k && t.includes(norm(k)));
}

/* ────────────────────────── 유사 프로젝트 스코어링 (1단계) ────────────────────────── */
interface ProjScore {
  proj: Node;
  sim: number; // 0..1 결합 유사도
  simEdge?: Edge; // seed→proj SIMILAR 엣지 (trace 시작점)
}

/** 신규 설계를 대표하는 seed 프로젝트 노드 탐색 (PJ26). 견고하게 여러 단서로. */
function findSeedProject(input: DesignInput): Node | undefined {
  // 0) 명시 시드(도면 업로드 흐름) — 도면 proj 의 SIMILAR(형상 유사도) 엣지를 소비한다
  if (input.seedProject) {
    const n = getNode(norm(input.seedProject));
    if (n && n.type === "proj") return n;
  }
  const projs = allNodes().filter((n) => n.type === "proj");
  // 1) NEW_DESIGN_OF / TARGET_MARKET out 엣지를 가진 프로젝트 (시나리오 신규 노드)
  for (const p of projs) {
    if (outEdges(p.id).some((e) => e.rel === "NEW_DESIGN_OF" || e.rel === "TARGET_MARKET")) return p;
  }
  // 2) hidden 플래그 (시나리오 전 숨김 = 신규)
  const hid = projs.find((p) => p.hidden);
  if (hid) return hid;
  // 3) 관례상 id
  return getNode("PJ26");
}

/** seed 조건 대비 기존 프로젝트의 조건 매칭 비율 (0..1). */
function conditionMatch(proj: Node, input: DesignInput): number {
  const text = nodeText(proj); // NFC 정규화됨
  let hit = 0;
  let tot = 0;
  // 광원
  tot++;
  if (input.lightSource && text.includes(norm(input.lightSource))) hit++;
  // 형상 토큰
  for (const tok of shapeTokens(input.shape ?? [])) {
    tot++;
    if (text.includes(tok)) hit++;
  }
  // 시장 (프로젝트 스펙/비고에 간접 반영)
  tot++;
  if (textMatchesAny(text, marketKeywords(input.market ?? ""))) hit++;
  return tot ? hit / tot : 0;
}

/** 상위 유사 프로젝트 목록. seed 의 SIMILAR 이웃을 우선, 없으면 전체 프로젝트를 조건으로 스코어. */
function scoreProjects(seed: Node | undefined, input: DesignInput, tv: Traversal): ProjScore[] {
  const scores: ProjScore[] = [];
  const seen = new Set<string>();

  if (seed) {
    tv.objects.add(seed.id);
    for (const { edge, node } of follow(seed.id, isSimilar, tv)) {
      if (node.type !== "proj" || seen.has(node.id)) continue;
      seen.add(node.id);
      const ew = edgeWeight(edge) ?? 0.5;
      const cond = conditionMatch(node, input);
      const sim = clamp01(SIM_EDGE_W * ew + SIM_COND_W * cond);
      scores.push({ proj: node, sim, simEdge: edge });
    }
  }

  // 폴백: SIMILAR 이웃이 없으면 (seed·시나리오 엣지 미완) 전체 프로젝트를 조건으로 스코어
  if (scores.length === 0) {
    for (const p of allNodes()) {
      if (p.type !== "proj") continue;
      if (seed && p.id === seed.id) continue;
      const cond = conditionMatch(p, input);
      if (cond <= 0) continue;
      scores.push({ proj: p, sim: clamp01(cond) });
    }
  }

  scores.sort((a, b) => b.sim - a.sim);
  return scores.slice(0, 5); // 상위 N
}

/* ────────────────────────── Concern (내부 후보 항목) ────────────────────────── */
interface Concern {
  anchor: string; // 앵커 노드 id
  category: string;
  title: string;
  desc: string;
  evidence: string[];
  trace: string[];
  sim: number;
  severity: number;
  hasMaster: boolean;
  masterNode?: Node; // REF_MASTER 로 도달한 마스터 노드(마스터 대조용 — hasMaster 는 boolean 요약)
  docCount: number;
  boost: number;
}

/** 근거 문서 수집 → 문자열 칩 + traversed.docs 누적. */
function collectDocs(id: string, tv: Traversal, limit = 3): string[] {
  const docs = evidenceOf(id);
  const chips: string[] = [];
  for (const d of docs) {
    tv.docs.add(d.id); // 근거 문서는 docs 카운터에만 (objects 와 중복 카운트 금지)
    tv.edges.add(`${id}|EVIDENCED_BY|${d.id}`);
    if (chips.length < limit) chips.push(d.filename);
  }
  return chips;
}

function pushUnique(arr: string[], v: string | undefined | null) {
  if (v && !arr.includes(v)) arr.push(v);
}

/* ────────────────────────── 마스터 대조(masterAudit) ────────────────────────── */
// 마스터 노드의 "항목"/"항목N" props 를 필수 항목 문자열로 분해("·"/","로 병기된 값 지원 —
// 기존 MGAP/MTHERM/MBEAM 은 단일 "항목" 안에 "·"로 여러 항목을 담고, 신규 마스터는 항목1..N 컬럼).
function requiredItemsOf(m: Node): string[] {
  const out: string[] = [];
  if (!m.props) return out;
  for (const [k, v] of m.props) {
    if (!/^항목\d*$/.test(k)) continue;
    for (const part of v.split(/[·,]/).map((s) => s.trim()).filter(Boolean)) {
      if (!out.includes(part)) out.push(part);
    }
  }
  return out;
}

const STOP_TOKENS = new Set(["이상", "이하", "이내"].map(norm));
const isNumericTok = (t: string) => /^[0-9]/.test(t);

// SYNONYMS(lib/nlsearch.ts) 그룹에서 토큰이 속한 동의어 집합(자기 자신 포함)을 반환.
function synonymGroup(tok: string): string[] {
  const t = norm(tok);
  for (const [base, syns] of SYNONYMS) {
    const all = [base, ...syns].map(norm);
    if (all.includes(t)) return all;
  }
  return [t];
}

/** 필수 항목이 텍스트 코퍼스에 커버되는 비율: 1=완전 일치(covered), 0<x<1=부분(unknown), 0=전무(missing).
 * 오탐보다 안전 — 애매하면(부분 일치) unknown 으로 두고 covered 를 단정하지 않는다. */
function coverageRatio(req: string, corpus: string): number {
  const whole = norm(req).trim();
  if (!whole) return 0; // 공백 항목은 판정 불가 — missing 처리 (리뷰 지적)
  const toks = whole.split(/\s+/).filter((t) => t.length >= 2 && !STOP_TOKENS.has(t) && !isNumericTok(t));
  // 전부 불용어/숫자면 통짜 문자열로 폴백하되, 불용어 단독("이상" 등)이 코퍼스 아무데나
  // 걸리는 오탐을 막기 위해 3자 미만이면 판정 포기(missing).
  if (toks.length === 0) {
    if (whole.length < 3 || STOP_TOKENS.has(whole)) return 0;
    toks.push(whole);
  }
  let hit = 0;
  for (const t of toks) if (synonymGroup(t).some((s) => corpus.includes(s))) hit++;
  return hit / toks.length;
}

function concernCorpus(c: Concern): string {
  return norm(`${c.title} ${c.desc} ${c.evidence.join(" ")}`);
}

/** 이번 추론에서 도달한 concern 들을 REF_MASTER 마스터별로 묶어 필수 항목 커버리지를 계산. */
function buildMasterAudit(items: { c: Concern }[]): MasterAudit[] {
  const byMaster = new Map<string, { master: Node; corpus: string[]; evidence: string[] }>();
  for (const { c } of items) {
    if (!c.masterNode) continue;
    let g = byMaster.get(c.masterNode.id);
    if (!g) {
      g = { master: c.masterNode, corpus: [], evidence: [] };
      byMaster.set(c.masterNode.id, g);
    }
    g.corpus.push(concernCorpus(c));
    for (const e of c.evidence) pushUnique(g.evidence, e);
  }

  const audits: MasterAudit[] = [];
  for (const g of byMaster.values()) {
    const required = requiredItemsOf(g.master);
    if (required.length === 0) continue; // 항목 없는 마스터는 대조 대상 아님
    const corpus = g.corpus.join(" ");
    const covered: string[] = [];
    const missing: string[] = [];
    const unknown: string[] = [];
    for (const req of required) {
      const ratio = coverageRatio(req, corpus);
      if (ratio >= 1) covered.push(req);
      else if (ratio > 0) unknown.push(req);
      else missing.push(req);
    }
    audits.push({ master: { id: g.master.id, label: g.master.label }, required, covered, missing, unknown, evidence: g.evidence });
  }
  return audits;
}

/* ────────────────────────── 메인 파이프라인 ────────────────────────── */
export function infer(input: DesignInput): InferResponse {
  // 방어적 입력 정규화 (+ 한글 NFC 정규화: HTTP 입력이 NFD 로 올 수 있음)
  const safe: DesignInput = {
    market: norm(input?.market),
    lightSource: norm(input?.lightSource),
    shape: (Array.isArray(input?.shape) ? input.shape : []).map(norm),
    components: (Array.isArray(input?.components) ? input.components : []).map(norm),
    anchorItem: input?.anchorItem ? norm(input.anchorItem) : undefined,
    seedProject: input?.seedProject ? norm(input.seedProject) : undefined,
  };

  const tv: Traversal = { objects: new Set(), edges: new Set(), docs: new Set() };
  const concerns = new Map<string, Concern>();

  const SLIM = norm("슬림");
  const slimActive = safe.shape.some((s) => s.includes(SLIM)); // safe.shape 는 이미 NFC
  const ledActive = /LED/i.test(safe.lightSource);
  const fogActive = safe.shape.some((s) => /밀폐|방수/.test(s)); // 밀폐형 하우징 → 내부 습기 배출 제약
  const shapeToks = shapeTokens(safe.shape);
  const marketKeys = marketKeywords(safe.market);

  // ── 2~5단계: 고장모드 수집 + 확장 + 근거 ──
  // 고장모드 하나를 concern 으로 확장(원인·마스터·조치·법규·근거·부스트).
  // 프로젝트 앵커(유사 프로젝트의 OCCURRED_IN)와 부품 앵커(선택 부품의 HAS_FAILURE) 공용.
  function expandFm(fm: Node, baseTrace: string[], sim: number, originLabel: string, originKind: "proj" | "item") {
    if (fm.type !== "fm") return;

    // 기존 concern 병합 (중복 고장모드는 유사도 max)
    let c = concerns.get(fm.id);
    if (!c) {
      c = {
        anchor: fm.id,
        category: "failure-mode",
        title: "",
        desc: "",
        evidence: [],
        trace: [],
        sim,
        severity: severityOf(fm),
        hasMaster: false,
        docCount: 0,
        boost: 0,
      };
      concerns.set(fm.id, c);
    }
    c.sim = Math.max(c.sim, sim);
    for (const t of baseTrace) pushUnique(c.trace, t);

    // 3단계: 원인 / 마스터 / 조치 / 법규 확장
    const causes = sortByEvidenceOverlap(follow(fm.id, isRel("CAUSED_BY"), tv), fm.id);
    let masters = follow(fm.id, isRel("REF_MASTER"), tv);
    let actions = follow(fm.id, isRel("MITIGATED_BY"), tv);
    const regs = follow(fm.id, isRel("UNDER_REG"), tv);
    // 원인의 마스터·조치도 (예: FMBEAM→CTHERM→MTHERM/ARIB)
    for (const cs of causes) {
      for (const m of follow(cs.node.id, isRel("REF_MASTER"), tv)) masters.push(m);
      for (const a of follow(cs.node.id, isRel("MITIGATED_BY"), tv)) actions.push(a);
    }
    // 대표 마스터·조치는 이 고장모드와 근거 문서를 공유하는 것 우선 (공동언급 노이즈 배제)
    masters = sortByEvidenceOverlap(masters, fm.id);
    actions = sortByEvidenceOverlap(actions, fm.id);

    const master = masters[0]?.node;
    const action = actions[0]?.node;
    if (master) {
      c.hasMaster = true;
      c.masterNode = master;
    }

    // 5단계: 근거 부착 (고장모드 문서 + 원인 문서 + 마스터/조치/앵커 라벨)
    const docChips = collectDocs(fm.id, tv, 2);
    for (const chip of docChips) pushUnique(c.evidence, chip);
    if (causes[0]) for (const chip of collectDocs(causes[0].node.id, tv, 1)) pushUnique(c.evidence, chip);
    if (master) pushUnique(c.evidence, master.label);
    if (action) pushUnique(c.evidence, action.label);
    pushUnique(c.evidence, originLabel);
    c.docCount = Math.max(c.docCount, evidenceOf(fm.id).length);

    // 제목·설명 (데이터 기반 생성)
    const causeLabels = causes.slice(0, 3).map((x) => x.node.label).join(", ");
    c.title = `${fm.label} 검토${master ? ` — ${master.label} 적용` : action ? ` — ${action.label}` : ""}`;
    const head =
      originKind === "item"
        ? `선택 부품 ${originLabel} 고장 이력 (관련도 ${(c.sim * 100) | 0}%). `
        : `유사 프로젝트 ${originLabel} 발생 이력 (유사도 ${(c.sim * 100) | 0}%). `;
    c.desc =
      head +
      `심각도 S=${c.severity}${causeLabels ? ` · 원인 경로: ${causeLabels}` : ""}.` +
      (master ? ` 표준 마스터 ${master.label} 필수 참조 — 누락 방지.` : "");

    // ── 4단계 부분: 시장 법규 부스트 (북미 → FMVSS 108(RUS) 활성, 유럽 전용 배제) ──
    const marketReg = regs.map((r) => r.node).find((rn) => textMatchesAny(nodeText(rn), marketKeys));
    if (marketReg) {
      const regEdge = findEdge(fm.id, isRel("UNDER_REG"), marketReg.id);
      if (regEdge) pushUnique(c.trace, hopStr(regEdge)); // fm→UNDER_REG→reg
      pushUnique(c.evidence, marketReg.label); // 예: "FMVSS 108"
      for (const chip of collectDocs(marketReg.id, tv, 1)) pushUnique(c.evidence, chip);
      c.category = "regulatory";
      c.boost += BOOST_MARKET;
      c.title = `${safe.market} ${fm.label} 법규 적합성 — ${marketReg.label}`;
      c.desc =
        `${safe.market}향 조건 자동 감지 → ${marketReg.label} 적용. ` +
        `타 시장(유럽 ECE 등)과 배광 기준 상이 — 시뮬레이션 조건 분리 필수. 심각도 S=${c.severity}.`;
    }

    // 형상 키워드 관련성 부스트 (예: 분리형 DRL → 휘도)
    if (shapeToks.length && textMatchesAny(nodeText(fm), shapeToks)) c.boost += BOOST_SHAPE;

    // 부품 일치 부스트 (fm 을 가진 item 이 입력 부품과 일치)
    if (safe.components && safe.components.length) {
      const owners = inEdges(fm.id)
        .filter((e) => e.rel === "HAS_FAILURE")
        .map((e) => getNode(e.src))
        .filter((n): n is Node => !!n);
      if (owners.some((o) => safe.components!.some((cp) => o.label.includes(cp) || cp.includes(o.label)))) {
        c.boost += BOOST_COMPONENT;
      }
    }
  }

  // ── 앵커 선택: anchorItem(사용자가 그래프에서 명시 선택한 부품)이 있으면 "부품 중심" 모드. ──
  // 부품 노드를 클릭하고 추론하면 그 부품의 고장 이력만 체크리스트로(그 부품에 맞는 검토).
  // anchorItem 없으면 기존 "유사 프로젝트" 기반(신규 설계 기본 조건 흐름 — components 는 소프트 부스트만).
  const ITEM_ANCHOR_SIM = 0.9; // 부품 직접 앵커는 관련도 높게
  // 정확 일치 우선 — includes 만 쓰면 "LED" 같은 짧은 라벨이 노드 순서 따라 먼저 잡힌다(리뷰 지적).
  const anchorItem = safe.anchorItem
    ? allNodes().find((n) => n.type === "item" && n.label === safe.anchorItem) ??
      allNodes().find(
        (n) => n.type === "item" && (n.label.includes(safe.anchorItem!) || safe.anchorItem!.includes(n.label))
      )
    : undefined;
  const itemScoped = !!anchorItem;

  if (anchorItem) {
    // 부품 중심: 선택 부품의 HAS_FAILURE 고장모드에서 직접 시드.
    tv.objects.add(anchorItem.id);
    for (const fmStep of follow(anchorItem.id, isRel("HAS_FAILURE"), tv)) {
      expandFm(fmStep.node, [hopStr(fmStep.edge)], ITEM_ANCHOR_SIM, anchorItem.label, "item"); // item→HAS_FAILURE→fm
    }
  } else {
    // 기본: 유사 프로젝트 스코어링 → 각 프로젝트의 OCCURRED_IN 고장모드.
    const seed = findSeedProject(safe);
    const projScores = scoreProjects(seed, safe, tv);
    for (const ps of projScores) {
      for (const fmStep of follow(ps.proj.id, isRel("OCCURRED_IN"), tv)) {
        const baseTrace: string[] = [];
        if (ps.simEdge) pushUnique(baseTrace, hopStr(ps.simEdge)); // seed→SIMILAR→proj
        pushUnique(baseTrace, hopStr(fmStep.edge)); // proj→OCCURRED_IN→fm
        expandFm(fmStep.node, baseTrace, ps.sim, ps.proj.label, "proj");
      }
    }
  }

  // ── 조건 기반 원인 concern(수축/방열/결로) — 기본 모드에서만. 부품 중심에선 그 부품 fm 으로 한정. ──
  if (!itemScoped) {
    // 슬림 → 수축 원인(CSHRINK)
    if (slimActive) addCauseConcern(concerns, tv, "수축", "shrink-slim", BOOST_SLIM, "(슬림 형상)");
    // LED → 방열 인과사슬(CTHERM→FMBEAM)
    if (ledActive) addCauseConcern(concerns, tv, "방열|발열|열", "led-thermal", BOOST_LED, "(LED 방열)");
    // 밀폐·방수 형상 → 결로·습기 가중 + 벤트·씰링 원인
    if (fogActive) {
      for (const c of concerns.values()) {
        const anchorNode = getNode(c.anchor);
        if (anchorNode?.type === "fm" && /결로|습기/.test(norm(anchorNode.label))) c.boost += BOOST_FOG;
      }
      addCauseConcern(concerns, tv, "벤트|씰링", "fog-vent", BOOST_FOG, "(밀폐 하우징)");
    }
  }

  // ── 6단계: 확신도 계산 + 조립 + 정렬 ──
  const items = [...concerns.values()]
    .filter((c) => c.evidence.length > 0 && c.trace.length > 0) // 근거·경로 필수 (골든 룰)
    .map((c) => {
      const { confidence, breakdown } = confidenceOf(c);
      return { c, confidence, breakdown };
    });

  items.sort((a, b) => b.confidence - a.confidence || b.c.severity - a.c.severity);

  // 마스터 대조 — 캡 이전 전체 도달 concern 기준(체크리스트에 안 실린 항목도 커버리지 판단에 반영).
  const masterAudit = buildMasterAudit(items);

  // 대규모 온톨로지에선 관련 concern 이 수십 개 나온다 → 확신도 상위 N개만 체크리스트로.
  const MAX_ITEMS = 8;
  const total = items.length;
  const top = items.slice(0, MAX_ITEMS);

  const checklist: CheckItem[] = top.map((it, i) => ({
    no: i + 1,
    title: it.c.title || getNode(it.c.anchor)?.label || "검토 항목",
    desc: it.c.desc,
    evidence: it.c.evidence,
    confidence: it.confidence,
    trace: it.c.trace,
    breakdown: it.breakdown,
  }));

  return {
    checklist,
    total, // 캡 이전 전체 관련 항목 수 (UI 에서 "상위 N / total" 표기용)
    traversed: { objects: tv.objects.size, edges: tv.edges.size, docs: tv.docs.size },
    masterAudit: masterAudit.length > 0 ? masterAudit : undefined,
  };
}

/* ────────────────────────── 원인 기반 조건 concern (수축/방열) ────────────────────────── */
// 이미 수집된 고장모드에서 CAUSED_BY 로 도달하는 특정 원인(라벨 정규식)을 앵커로,
// 그 원인의 마스터·조치·역방향 고장모드(FMSHRINK 등)를 실제 엣지로 엮어 concern 생성.
function addCauseConcern(
  concerns: Map<string, Concern>,
  tv: Traversal,
  labelRegexSrc: string,
  category: string,
  boost: number,
  suffix: string
) {
  const re = new RegExp(norm(labelRegexSrc)); // NFC 정규화된 패턴
  const cause = allNodes().find((n) => n.type === "cause" && re.test(norm(n.label)));
  if (!cause) return;
  if (concerns.has(cause.id)) return; // 이미 앵커됨

  // 이미 수집된 고장모드(concern) 중 이 원인을 CAUSED_BY 로 가진 것을 찾아 경로 시작점 확보
  let sourceFmTrace: string[] | undefined;
  let sourceFmId: string | undefined;
  for (const c of concerns.values()) {
    if (c.category !== "failure-mode" && c.category !== "regulatory") continue;
    const link = findEdge(c.anchor, isRel("CAUSED_BY"), cause.id);
    if (link) {
      sourceFmTrace = c.trace.filter((t) => !t.includes("UNDER_REG")); // 프로젝트→FM 경로만
      sourceFmId = c.anchor;
      break;
    }
  }
  if (!sourceFmId || !sourceFmTrace) return; // 도달 불가 → 조용히 스킵

  tv.objects.add(cause.id);
  const trace: string[] = [...sourceFmTrace];
  const causeEdge = findEdge(sourceFmId, isRel("CAUSED_BY"), cause.id)!;
  tv.edges.add(edgeKey(causeEdge));
  pushUnique(trace, hopStr(causeEdge)); // fm→CAUSED_BY→cause

  const evidence: string[] = [];
  for (const chip of collectDocs(cause.id, tv, 2)) pushUnique(evidence, chip);

  // 원인 → 마스터 / 조치
  const masters = follow(cause.id, isRel("REF_MASTER"), tv);
  const actions = follow(cause.id, isRel("MITIGATED_BY"), tv);

  // 역방향: 이 원인을 CAUSED_BY 로 지목하는 고장모드(예: FMSHRINK→CSHRINK).
  // 이 원인 테마(수축 등)와 라벨이 일치하는 고장모드를 우선 선택 → 정확한 조치/근거 연결.
  const inFms: { fm: Node; edge: Edge }[] = [];
  for (const e of inEdges(cause.id)) {
    if (e.rel !== "CAUSED_BY") continue;
    const fm = getNode(e.src);
    if (fm && fm.type === "fm") inFms.push({ fm, edge: e });
  }
  const themeToken = norm(labelRegexSrc.split("|")[0]);
  inFms.sort((a, b) => {
    const am = re.test(norm(a.fm.label)) || norm(a.fm.label).includes(themeToken) ? 1 : 0;
    const bm = re.test(norm(b.fm.label)) || norm(b.fm.label).includes(themeToken) ? 1 : 0;
    return bm - am;
  });
  const relatedFm = inFms[0]?.fm;
  if (relatedFm) {
    const e = inFms[0].edge;
    tv.edges.add(edgeKey(e));
    tv.objects.add(relatedFm.id);
    pushUnique(trace, hopStr(e)); // relatedFm→CAUSED_BY→cause (실제 엣지)
    for (const a of follow(relatedFm.id, isRel("MITIGATED_BY"), tv)) actions.push(a);
    for (const m of follow(relatedFm.id, isRel("REF_MASTER"), tv)) masters.push(m);
    for (const chip of collectDocs(relatedFm.id, tv, 1)) pushUnique(evidence, chip);
  }

  // 대표 마스터·조치는 원인(없으면 관련 fm)과 근거 문서를 공유하는 것 우선
  const overlapAnchor = evidenceOf(cause.id).length > 0 ? cause.id : relatedFm?.id ?? cause.id;
  const master = sortByEvidenceOverlap(masters, overlapAnchor)[0]?.node;
  const action = sortByEvidenceOverlap(actions, overlapAnchor)[0]?.node;
  if (master) pushUnique(evidence, master.label);
  if (action) pushUnique(evidence, action.label);
  if (relatedFm) pushUnique(evidence, relatedFm.label);
  if (evidence.length === 0) pushUnique(evidence, cause.label);

  const sev = severityOf(relatedFm ?? cause);
  const sourceSim = mostSimilarConcern(concerns, sourceFmId);

  concerns.set(cause.id, {
    anchor: cause.id,
    category,
    title: `${cause.label} 검토 ${suffix}${master ? ` — ${master.label}` : action ? ` — ${action.label}` : ""}`,
    desc:
      `${suffix.replace(/[()]/g, "")} 조건 활성 → 원인 "${cause.label}" 가중.` +
      (relatedFm ? ` ${relatedFm.label} 이력과 연결.` : "") +
      (action ? ` 조치 전례: ${action.label}.` : "") +
      ` 심각도 S=${sev}.`,
    evidence,
    trace,
    sim: sourceSim,
    severity: sev,
    hasMaster: !!master,
    masterNode: master,
    docCount: evidenceOf(cause.id).length,
    boost,
  });
}

function mostSimilarConcern(concerns: Map<string, Concern>, fmId: string): number {
  return concerns.get(fmId)?.sim ?? 0.5;
}

/* ────────────────────────── 확신도 공식 ────────────────────────── */
// confidence 최종 값(반올림된 %)은 기존 산식과 1%p도 다르지 않다 — breakdown 은 이미 계산되던
// 항을 버리지 않고 그대로 동반 반환할 뿐이다(순수 노출, 로직 변경 없음).
function confidenceOf(c: Concern): { confidence: number; breakdown: NonNullable<CheckItem["breakdown"]> } {
  const sim = clamp01(c.sim);
  const evidenceNorm = clamp01(c.docCount / EVID_FULL);
  const severityNorm = clamp01(c.severity / SEV_FULL);
  const masterMatch = c.hasMaster ? 1 : 0;

  let simTerm = W1_SIM * sim;
  let evidTerm = W2_EVID * evidenceNorm;
  let sevTerm = W3_SEV * severityNorm;
  let masterTerm = W4_MASTER * masterMatch;
  let boostTerm = c.boost;

  const raw = simTerm + evidTerm + sevTerm + masterTerm + boostTerm;
  const confidence = Math.round(clamp01(raw) * 100);

  // raw > 1 (부스트 누적으로 상한 초과)이면 confidence 는 clamp01 로 1(100%)에 묶인다 —
  // breakdown 항도 동일 비율로 축소해 합계가 clamp 후 값과 어긋나지 않게 한다.
  if (raw > 1) {
    const scale = 1 / raw;
    simTerm *= scale;
    evidTerm *= scale;
    sevTerm *= scale;
    masterTerm *= scale;
    boostTerm *= scale;
  }

  return {
    confidence,
    breakdown: {
      sim: simTerm,
      evid: evidTerm,
      sev: sevTerm,
      master: masterTerm,
      boost: boostTerm,
      weights: { sim: W1_SIM, evid: W2_EVID, sev: W3_SEV, master: W4_MASTER },
    },
  };
}
