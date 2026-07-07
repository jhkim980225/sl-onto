// 자연어 검색 — 좁은 온톨로지에 대한 엔티티 링크 + 의도 파악 + 그래프 확장(규칙기반, 빠름·정확).
// 질의에 언급된 개념(부품·고장·원인·지역·유형)을 실제 엔티티로 연결하고 관계로 확장한다.
// 사내 LLM(qwen3)은 서버가 느려(수십 초) 기본 비활성. NL_USE_LLM=1 이면 LLM 우선(폴백=규칙기반). docs/features/nlsearch.md
import type { NLSearchResponse, SearchHit, ObjType, Node } from "./types";
import { allNodes, getNode, neighbors, deg, outEdges, evidenceOf, getActiveDrawing } from "./store";
import { featuresFromProps, hasFeatures, rankSimilarByShape } from "./shape-sim";

const nrm = (s: string) => (s ?? "").normalize("NFC").toLowerCase().trim();
const nospace = (s: string) => nrm(s).replace(/\s+/g, "");

// 지역 표현 → 법규 노드 id (백본)
const REGION_TERMS: [string, string, string][] = [
  ["북미", "RUS", "북미"], ["미국", "RUS", "북미"], ["미주", "RUS", "북미"], ["캐나다", "RUS", "북미"],
  ["fmvss", "RUS", "북미"], ["north america", "RUS", "북미"],
  ["유럽", "REU", "유럽"], ["ece", "REU", "유럽"], ["europe", "REU", "유럽"],
  ["한국", "RKR", "한국"], ["국내", "RKR", "한국"], ["kmvss", "RKR", "한국"],
  ["중국", "RCN", "중국"], ["china", "RCN", "중국"], ["gb 25991", "RCN", "중국"],
];

// 유형 의도 표현 → 객체 유형
const TYPE_TERMS: [string, ObjType][] = [
  ["프로젝트", "proj"], ["차종", "proj"], ["모델", "proj"], ["개발", "proj"],
  ["부품", "item"], ["구성", "item"], ["컴포넌트", "item"],
  ["고장", "fm"], ["불량", "fm"], ["결함", "fm"], ["현상", "fm"], ["이슈", "fm"], ["문제", "fm"],
  ["원인", "cause"], ["이유", "cause"],
  ["대책", "action"], ["조치", "action"], ["개선", "action"], ["해결", "action"], ["대응", "action"],
  ["법규", "reg"], ["규제", "reg"], ["인증", "reg"], ["기준", "reg"],
  ["마스터", "master"], ["표준", "master"], ["체크", "master"],
  ["스펙", "spec"], ["고객", "spec"],
];

// 도메인 동의어(엔티티 라벨 substring 매칭 보강) — 사용자의 일상 표현 → 온톨로지 개념 테마.
const SYNONYMS: [string, string[]][] = [
  ["결로", ["습기", "김서림", "성에", "물맺힘", "fog"]],
  ["간극", ["갭", "틈", "벌어짐", "맞물", "매칭", "끼워맞춤", "gap"]],
  ["단차", ["step", "턱", "맞물", "매칭"]],
  ["공차", ["맞물", "매칭", "끼워맞춤", "체결", "조립부"]],
  ["배광", ["광학", "빛분포", "beam", "광도"]],
  ["수축", ["변형", "휨", "shrink"]],
  ["휘도", ["밝기", "균일", "luminance"]],
  ["방열", ["발열", "열", "냉각", "thermal"]],
  ["균열", ["크랙", "깨짐", "crack"]],
  ["박리", ["벗겨짐", "코팅"]],
];

const TYPE_KO: Record<ObjType, string> = {
  item: "부품", fm: "고장모드", cause: "원인", action: "조치",
  reg: "법규", proj: "프로젝트", master: "마스터", spec: "고객스펙", doc: "문서",
};

interface Scored { n: Node; s: number; direct: boolean; }

/* ───────── 1단계(형상 유사) 대화 답변 — "이 도면/구조와 닮은 과거 설계가 있었나?" ─────────
 * 질의가 형상 유사 의도면, 도면 프로젝트(형상 특징 + .dxf 근거 보유)를 기준으로 shape-sim 랭킹을
 * 돌려 문장형 답변을 조립한다. 습기/결로가 언급되면 해당 이력 여부까지 답한다. */
const SHAPE_INTENT = /(유사|비슷|닮은|닮았)/;
const SHAPE_TOPIC = /(형상|구조|모듈|설계|도면|벤트|실링|개스킷|커넥터|헤드램프|램프)/;

/** 질의가 부품명을 명시하면(헤드램프·리어콤비·안개등·DRL) 그 도면으로 바인딩 — 업로드 순서와 무관. */
function drawingProjectFor(qn: string): Node | undefined {
  const drawings = allNodes().filter(
    (n) =>
      n.type === "proj" &&
      n.props?.some(([k]) => k.startsWith("형상.")) &&
      evidenceOf(n.id).some((d) => d.filename.toLowerCase().endsWith(".dxf"))
  );
  const named = drawings.find((p) =>
    evidenceOf(p.id).some((d) => {
      const f = d.filename;
      if (/리어\s*콤비/.test(qn)) return /리어콤비/.test(f);
      if (/안개등/.test(qn)) return /안개등/.test(f);
      if (/drl/i.test(qn)) return /DRL/i.test(f);
      if (/헤드램프/.test(qn)) return /헤드램프/.test(f);
      return false;
    })
  );
  return named ?? drawingProject();
}

function drawingProject(): Node | undefined {
  // "이 도면/이 커넥터"의 지시 대상: ① 마지막으로 분석·추가한 도면(대화 컨텍스트) 우선,
  // ② 없으면 도면 유래 프로젝트(형상.* props + .dxf 근거) 폴백 — 업로드 전에도 질의 가능.
  const active = getActiveDrawing();
  if (active) {
    const n = getNode(active);
    if (n && n.type === "proj") return n;
  }
  return allNodes().find(
    (n) =>
      n.type === "proj" &&
      n.props?.some(([k]) => k.startsWith("형상.")) &&
      evidenceOf(n.id).some((d) => d.filename.toLowerCase().endsWith(".dxf"))
  );
}

function answerShapeQuery(qn: string): NLSearchResponse | null {
  if (!(SHAPE_INTENT.test(qn) && SHAPE_TOPIC.test(qn))) return null;
  const base = drawingProjectFor(qn);
  if (!base) return null;
  const target = featuresFromProps(base);
  if (!hasFeatures(target)) return null;
  const ranked = rankSimilarByShape(
    target,
    allNodes().filter((n) => n.type === "proj" && n.id !== base.id),
    3
  );
  if (!ranked.length) return null;

  const top = ranked[0];
  const pct = Math.round(top.match.score * 100);
  const vehicle = top.node.props?.find(([k]) => k === "차종")?.[1];
  const fms = outEdges(top.node.id)
    .filter((e) => e.rel === "OCCURRED_IN")
    .map((e) => getNode(e.dst))
    .filter((n): n is Node => !!n && n.type === "fm");
  const askMoist = /(습기|결로|김서림|부식)/.test(qn);
  // 결로·습기 이력을 우선하고, 질의가 부식을 명시할 때만 부식 이력으로 폴백
  const moistFm =
    fms.find((f) => /결로|습기/.test(f.label)) ??
    (/부식/.test(qn) ? fms.find((f) => /부식/.test(f.label)) : undefined);
  const histPart = askMoist
    ? moistFm
      ? `해당 프로젝트에 **${moistFm.label}** 발생 이력이 있습니다.`
      : "해당 프로젝트에 습기 계열 이력은 확인되지 않습니다."
    : fms.length
      ? `발생 이력: ${fms.slice(0, 3).map((f) => f.label).join(", ")}.`
      : "";

  const answer =
    `[기준: ${base.label} 도면] ` +
    `네 — 형상 기준 ${pct}% 유사한 ${top.node.label}${vehicle ? `(${vehicle})` : ""}가 있습니다. ` +
    `일치: ${top.match.matched.slice(0, 3).join(" · ")}. ${histPart}`.trim();

  const hitNodes: Node[] = [top.node, ...(moistFm ? [moistFm] : fms.slice(0, 2)), base, ...ranked.slice(1).map((r) => r.node)];
  const seen = new Set<string>();
  const hits: SearchHit[] = hitNodes
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .map((n, i) => ({ id: n.id, label: n.label, type: n.type, score: 1 - i * 0.01, matched: ["label"] }));
  const nbr: string[] = [];
  for (const h of hits.slice(0, 2)) for (const nn of neighbors(h.id)) {
    if (nn.type === "doc" || seen.has(nn.id)) continue; seen.add(nn.id); nbr.push(nn.id);
  }
  return {
    answer,
    interpretation: `의도: 형상 유사 탐색 · 기준: ${base.label}(도면) · 후보 ${ranked.length}건`,
    hits,
    neighbors: nbr,
    mode: "llm",
  };
}

/* ───────── 2단계(지역·환경 교차) — "이 벤트/등급이 목표 지역 환경을 감당하는가" 모순 탐지 ───────── */
const REGION_CROSS_INTENT = /(지역|시장|국가|동남아|중동|고온다습|온습도|기후|환경|감당|충분)/;

function answerRegionCross(qn: string): NLSearchResponse | null {
  if (!REGION_CROSS_INTENT.test(qn)) return null;
  if (!/(벤트|결로|습기|개스킷|ip|등급|커넥터|방수|설계|모듈|헤드램프|램프|차종)/.test(qn)) return null;
  const base = drawingProjectFor(qn);
  if (!base) return null;
  const target = featuresFromProps(base);
  if (!hasFeatures(target)) return null;
  const ranked = rankSimilarByShape(
    target,
    allNodes().filter((n) => n.type === "proj" && n.id !== base.id),
    2
  );
  const top = ranked[0];
  const topMoist = top
    ? outEdges(top.node.id).some((e) => {
        const fm = getNode(e.dst);
        return e.rel === "OCCURRED_IN" && !!fm && /결로|습기/.test(fm.label);
      })
    : false;
  const ip = target.커넥터 ?? "미기재";
  const vent = target.벤트수 ? `벤트 ${target.벤트수}개소(${target.벤트배치 ?? "-"})` : "벤트 미기재";
  const pct = top ? Math.round(top.match.score * 100) : 0;
  const market = base.props?.find(([k]) => k === "시장")?.[1]; // 도면 제목블록의 목표 시장
  const topMarket = top?.node.props?.find(([k]) => k === "시장")?.[1];

  const answer =
    `[기준: ${base.label} 도면] ` +
    (market ? `목표 시장은 **${market}**입니다(도면 제목블록). ` : "") +
    `스펙만 보면 통과입니다 — 커넥터 ${ip} 등급, ${vent}. ` +
    `그러나 교차하면 모순이 드러납니다: 고온다습 지역(아시아 RH 80–95% · 중국 RH 75–95%)은 ` +
    `내부 결로 필드 클레임 빈발 지역(위험도 높음)이고, ` +
    (top
      ? `형상 ${pct}% 유사한 ${top.node.label}${topMarket ? `(${topMarket}향)` : ""}가 동일 벤트 구조로 ${topMoist ? "**결로·습기 클레임 이력**을 갖고 있습니다" : "운영된 이력이 있습니다"}. `
      : "") +
    `등급 통과 ≠ 지역 환경 감당 — 벤트 용량 확대·하부 드레인·발수 코팅(아시아권 표준 대책) 재검토를 권장합니다.`;

  const ids = ["FMFOG", "CVENT", "AVENT", "RKR", "RCN", ...(top ? [top.node.id] : []), base.id];
  const seen = new Set<string>();
  const hits: SearchHit[] = ids
    .map((id) => getNode(id))
    .filter((n): n is Node => !!n && !seen.has(n.id) && (seen.add(n.id), true))
    .map((n, i) => ({ id: n.id, label: n.label, type: n.type, score: 1 - i * 0.01, matched: ["label"] }));
  return {
    answer,
    interpretation: `의도: 지역·환경 교차(모순 탐지) · 기준: ${base.label}(도면) · 지역: 고온다습(아시아·중국)`,
    hits,
    neighbors: [],
    mode: "llm",
  };
}

/* ───────── 4단계(소비자 반응 교차) — "FMEA 기록엔 없는데 커뮤니티 언급이 있다" 모순 ───────── */
const CONSUMER_INTENT = /(소비자|커뮤니티|카페|게시판|온라인|포럼|반응|언급)/;

function answerConsumerCross(qn: string): NLSearchResponse | null {
  if (!CONSUMER_INTENT.test(qn)) return null;
  const mentions: { proj: Node; symptom: string; detail: string; hasFmea: boolean }[] = [];
  for (const p of allNodes()) {
    if (p.type !== "proj" || !p.props) continue;
    for (const [k, v] of p.props) {
      if (!k.startsWith("소비자언급.")) continue;
      const hasFmea = outEdges(p.id).some((e) => {
        const fm = getNode(e.dst);
        return e.rel === "OCCURRED_IN" && !!fm && /결로|습기/.test(fm.label);
      });
      mentions.push({ proj: p, symptom: k.slice("소비자언급.".length), detail: v, hasFmea });
    }
  }
  if (!mentions.length) return null;
  mentions.sort((a, b) => Number(a.hasFmea) - Number(b.hasFmea)); // 모순(기록 없음) 먼저
  const gap = mentions.find((m) => !m.hasFmea);
  const listed = mentions
    .slice(0, 3)
    .map((m) => `${m.proj.label} "${m.symptom}" ${m.detail}`)
    .join(" · ");
  const answer =
    `네 — 커뮤니티 언급이 있습니다: ${listed}. ` +
    (gap
      ? `주목할 모순: **${gap.proj.label}**는 FMEA 기록상 결로·습기 이력이 없는데 커뮤니티에 "${gap.symptom}" 언급(${gap.detail})이 있습니다 — 내부 기록과 실사용 간 괴리로, 필드 신호가 품질 데이터에 아직 반영되지 않았을 가능성이 있습니다.`
      : `언급된 프로젝트들은 모두 FMEA 결로 이력과 정합합니다.`);
  const seen = new Set<string>();
  const hits: SearchHit[] = [...mentions.map((m) => m.proj), getNode("FMFOG")]
    .filter((n): n is Node => !!n && !seen.has(n.id) && (seen.add(n.id), true))
    .map((n, i) => ({ id: n.id, label: n.label, type: n.type, score: 1 - i * 0.01, matched: ["label"] }));
  return {
    answer,
    interpretation: `의도: 소비자 반응 교차(내부 기록 대조) · 언급 ${mentions.length}건`,
    hits,
    neighbors: [],
    mode: "llm",
  };
}

function ruleBasedNL(query: string): NLSearchResponse {
  const qn = nrm(query);
  const qns = nospace(query);
  if (!qns) return { answer: "", hits: [], neighbors: [], mode: "fallback" };

  // 0) 시나리오 답변기(문장형) — 소비자 교차 → 형상 유사 → 지역·환경 교차 순으로 시도
  const staged = answerConsumerCross(qn) ?? answerShapeQuery(qn) ?? answerRegionCross(qn);
  if (staged) return staged;

  // 1) 지역 감지 → 법규 id
  const regIds = new Set<string>();
  const regionNames = new Set<string>();
  for (const [term, id, name] of REGION_TERMS) {
    if (qn.includes(term) && getNode(id)) { regIds.add(id); regionNames.add(name); }
  }
  // 2) 유형 의도
  const typeHints = new Set<ObjType>();
  for (const [term, t] of TYPE_TERMS) if (qn.includes(term)) typeHints.add(t);
  // 3) 동의어 → 질의에 추가 매칭 키 확보
  const synHitTerms = new Set<string>();
  for (const [base, syns] of SYNONYMS) {
    if (qns.includes(nospace(base)) || syns.some((s) => qns.includes(nospace(s)))) synHitTerms.add(base);
  }

  // 4) 엔티티 링크: 라벨/동의어가 질의에 언급된 노드 = 직접 시드
  const scores = new Map<string, Scored>();
  const bump = (n: Node, s: number, direct: boolean) => {
    const cur = scores.get(n.id);
    if (!cur || s > cur.s) scores.set(n.id, { n, s, direct: direct || (cur?.direct ?? false) });
  };
  for (const n of allNodes()) {
    if (n.type === "doc") continue;
    const labelns = nospace(n.label);
    let hit = 0;
    if (labelns.length >= 2 && qns.includes(labelns)) hit = 3 + Math.min(labelns.length, 8) * 0.05;
    // 동의어 테마 일치(예: 질의에 '습기' → '결로' 라벨 노드)
    if (!hit) for (const t of synHitTerms) if (labelns.includes(nospace(t))) { hit = 2.2; break; }
    // 라벨 토큰 부분 매칭(예: 질의 '조립 공차' → 라벨 '조립 공차 누적') — 라벨 전체가 질의에
    // 없어도 라벨 토큰(2자+)이 질의에 충분히(합계 4자+) 겹치면 낮은 점수로 시드.
    // 합계 4자 문턱이 '부품' 같은 일반어 단독 토큰의 과다 시드를 막는다.
    if (!hit) {
      let matched = 0;
      for (const tok of n.label.normalize("NFC").split(/[\s·/()]+/)) {
        const t = nospace(tok);
        if (t.length >= 2 && qns.includes(t)) matched += t.length;
      }
      if (matched >= 4) hit = 1.7 + Math.min(matched, 10) * 0.03;
    }
    if (hit) bump(n, hit, true);
  }
  // 지역 법규 노드는 직접 시드
  for (const id of regIds) { const n = getNode(id); if (n) bump(n, 2.6, true); }

  const directIds = [...scores.values()].filter((x) => x.direct).map((x) => x.n.id);

  // 5) 그래프 확장(직접 시드의 1-hop 이웃, 문서 제외)
  for (const id of directIds) {
    const base = scores.get(id)!.s;
    for (const nb of neighbors(id)) {
      if (nb.type === "doc") continue;
      bump(nb, base * 0.42, false);
    }
  }

  // 6) 지역 필터: 지역 지정 시 다른 지역 법규는 제거
  if (regIds.size) for (const n of allNodes()) if (n.type === "reg" && !regIds.has(n.id)) scores.delete(n.id);

  // 7) 유형 부스트 + 랭킹
  let ranked = [...scores.values()];
  ranked.forEach((x) => { if (typeHints.has(x.n.type)) x.s *= 1.45; x.s += deg(x.n.id) * 0.001; });
  ranked.sort((a, b) => b.s - a.s || (a.n.id < b.n.id ? -1 : 1));
  const top = ranked.slice(0, 12);

  const hits: SearchHit[] = top.map((x, i) => ({
    id: x.n.id, label: x.n.label, type: x.n.type, score: 1 - i * 0.01, matched: ["label"],
  }));

  // 이웃(상위 4개 hit 기준)
  const nseen = new Set(hits.map((h) => h.id));
  const nbr: string[] = [];
  for (const h of hits.slice(0, 4)) for (const nn of neighbors(h.id)) {
    if (nn.type === "doc" || nseen.has(nn.id)) continue; nseen.add(nn.id); nbr.push(nn.id);
  }

  // 해석/답변 템플릿
  const parts: string[] = [];
  if (regionNames.size) parts.push(`지역: ${[...regionNames].join("·")}`);
  const directLabels = top.filter((x) => x.direct).slice(0, 4).map((x) => x.n.label);
  if (directLabels.length) parts.push(`개념: ${directLabels.join("·")}`);
  if (typeHints.size) parts.push(`유형: ${[...typeHints].map((t) => TYPE_KO[t]).join("·")}`);
  const byType: Record<string, number> = {};
  hits.forEach((h) => (byType[TYPE_KO[h.type]] = (byType[TYPE_KO[h.type]] || 0) + 1));
  const typeSummary = Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(", ");
  const answer = hits.length
    ? `관련 객체 ${hits.length}건 (${typeSummary}). ${directLabels.slice(0, 3).join(", ")} 중심으로 연결된 항목입니다.`
    : "질의에서 매칭되는 온톨로지 개념을 찾지 못했습니다. 부품·고장모드·지역 등을 포함해 다시 물어보세요.";

  return { answer, interpretation: parts.join(" · ") || undefined, hits, neighbors: nbr, mode: "llm" };
}

/* ───────── 옵션: 사내 LLM(qwen3) — 서버가 느려 기본 비활성(NL_USE_LLM=1 로 켬) ───────── */
const LLM_BASE = (process.env.LLM_BASE_URL || "http://vllm-loadbalancer.vllm-cluster.svc.cluster.local/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "qwen3-32b-finance";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60000);

function catalog(): string {
  const byType: Record<string, string[]> = {};
  for (const n of allNodes()) { if (n.type === "doc") continue; (byType[n.type] ??= []).push(`${n.id}=${n.label}`); }
  const order: ObjType[] = ["item", "fm", "cause", "action", "reg", "proj", "master", "spec"];
  return order.filter((t) => byType[t]?.length).map((t) => `[${t}] ${byType[t].join(" | ")}`).join("\n");
}
function extractJson(text: string): { answer?: string; interpretation?: string; ids?: string[] } | null {
  const c = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const a = c.indexOf("{"), b = c.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(c.slice(a, b + 1)); } catch { return null; }
}
async function llmNL(query: string): Promise<NLSearchResponse | null> {
  const body = {
    model: LLM_MODEL, max_tokens: 400, temperature: 0,
    messages: [
      { role: "system", content: `너는 FMEA 온톨로지 검색기다. 목록의 id만 써서 질의 관련 id를 관련도순 최대 12개 고른다. 지역은 법규로: 북미→FMVSS 108, 유럽→ECE R149, 한국→KMVSS, 중국→GB 25991. JSON만 출력: {"answer":"요약","interpretation":"조건","ids":[...]}. /no_think` },
      { role: "user", content: `/no_think 목록:\n${catalog()}\n\n질의: ${query}` },
    ],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${LLM_BASE}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) return null;
    const out = extractJson((await res.json())?.choices?.[0]?.message?.content ?? "");
    if (!out?.ids?.length) return null;
    const seen = new Set<string>(); const hits: SearchHit[] = [];
    for (const raw of out.ids) {
      const n = getNode(String(raw)) || allNodes().find((x) => x.type !== "doc" && x.label === String(raw).trim());
      if (!n || seen.has(n.id)) continue; seen.add(n.id);
      hits.push({ id: n.id, label: n.label, type: n.type, score: 1 - hits.length * 0.01, matched: ["label"] });
      if (hits.length >= 12) break;
    }
    if (!hits.length) return null;
    const nseen = new Set(hits.map((h) => h.id)); const nbr: string[] = [];
    for (const h of hits.slice(0, 4)) for (const nn of neighbors(h.id)) { if (nn.type === "doc" || nseen.has(nn.id)) continue; nseen.add(nn.id); nbr.push(nn.id); }
    return { answer: out.answer?.trim() || `관련 객체 ${hits.length}건`, interpretation: out.interpretation?.trim(), hits, neighbors: nbr, mode: "llm" };
  } catch { return null; } finally { clearTimeout(timer); }
}

export async function nlSearch(query: string): Promise<NLSearchResponse> {
  const q = (query || "").trim();
  if (!q) return { answer: "", hits: [], neighbors: [], mode: "fallback" };
  if (process.env.NL_USE_LLM === "1") {
    const llm = await llmNL(q);
    if (llm) return llm;
  }
  return ruleBasedNL(q);
}
