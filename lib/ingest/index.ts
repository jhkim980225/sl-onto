// lib/ingest/index.ts — 원천 파일(data/sources/*)을 파싱·정규화해 온톨로지(nodes/edges)로 구축.
// 각 파일은 doc(근거) 노드가 되고 기여한 객체에 EVIDENCED_BY 로 연결된다.
// data/sources 가 없거나 비면 빈 결과를 반환한다(store 가 seed 로 폴백).
import type { Node, Edge, ObjType } from "../types";
import * as fs from "node:fs";
import * as path from "node:path";
import { readWorkbook, readWorkbookGrids } from "./xlsx";
import type { MergeRange } from "./xlsx";
import { readDeck } from "./pptx";
import { readDoc } from "./docx";
import { readDxfEntities, parseDrawing } from "./dxf";
import { normalize, canonical, resolveOrCreate, scanEntities } from "./normalize";

export interface PreviewItem {
  raw: string; // 원문(정형화 전)
  id: string; // 매핑된 표준 id
  label: string; // 표준 라벨
  type: ObjType;
  confidence: number; // 0..1
}
export interface SourceInfo {
  file: string;
  type: string; // XLSX | PPTX | DOCX
  sizeBytes: number;
  extracted: { objects: number; relations: number };
  preview: PreviewItem[];
}
export interface IngestResult {
  nodes: Node[];
  edges: Edge[];
  sources: SourceInfo[];
}

const SOURCES_DIR = () => path.join(process.cwd(), "data", "sources");
const EMPTY = (s: string) => !s || s === "-";
const extOf = (f: string) => (f.split(".").pop() ?? "").toUpperCase();

// 인제스천 누적 대상(파일 여러 개가 같은 sink 를 공유하면 전역 dedupe 가 적용된다).
interface Sink {
  nodes: Map<string, Node>;
  edges: Edge[];
  edgeKeys: Set<string>;
}
const newSink = (): Sink => ({ nodes: new Map(), edges: [], edgeKeys: new Set() });

/** 파일 하나를 sink 에 인제스트하고 SourceInfo 를 반환. 파싱 실패는 throw(호출측에서 처리).
 * pdfText: PDF 는 바이너리 파싱을 pyservice(/parse)가 이미 끝낸 상태 — 추출 텍스트만 받는다. */
function ingestFileInto(sink: Sink, file: string, full: string, pdfText?: string): SourceInfo {
  const { nodes, edges, edgeKeys } = sink;

  const getNode = (id: string): Node => {
    let n = nodes.get(id);
    if (!n) {
      const c = canonical(id);
      n = { id, type: c?.type ?? ("item" as ObjType), label: c?.label ?? id, props: [] };
      nodes.set(id, n);
    }
    return n;
  };
  const addProp = (n: Node, key: string, val: string) => {
    if (EMPTY(val)) return;
    n.props ??= [];
    if (!n.props.some(([k]) => k === key)) n.props.push([key, val]);
  };
  const addEdge = (src: string, rel: string, dst: string, opts: { weight?: number; scen?: boolean } = {}) => {
    getNode(src);
    getNode(dst);
    const key = `${src}|${rel}|${dst}`;
    if (edgeKeys.has(key)) return false;
    edgeKeys.add(key);
    const e: Edge = { src, rel, dst };
    if (opts.weight !== undefined && !Number.isNaN(opts.weight)) e.weight = opts.weight;
    if (opts.scen) e.scen = true;
    edges.push(e);
    return true;
  };

  const contributed = new Set<string>();
  const preview: PreviewItem[] = [];
  let relations = 0;

  // 원문 → 표준 id 정규화. type 이 주어지면 통제 어휘에 없는 값도 자동 생성(auto-create)한다.
  // type 없이 호출하면(참조 xlsx 의 id 컬럼) 기존 무손실 매핑만 — 미해결 시 드롭.
  const resolve = (raw: string, type?: ObjType, record = true): string | null => {
    if (EMPTY(raw)) return null;
    const r = type ? resolveOrCreate(raw, type) : normalize(raw);
    if (!r.id) return null;
    getNode(r.id);
    if (record) {
      contributed.add(r.id);
      if (preview.length < 6 && !preview.some((p) => p.raw === r.raw && p.id === r.id)) {
        preview.push({ raw: r.raw, id: r.id, label: r.label!, type: r.type!, confidence: r.confidence });
      }
    }
    return r.id;
  };
  const link = (src: string | null, rel: string, dst: string | null, opts?: { weight?: number; scen?: boolean }) => {
    if (!src || !dst) return;
    addEdge(src, rel, dst, opts); // 전역 중복 제거
    relations++; // 이 파일이 주장하는 관계 수(중복 여부와 무관)
  };

  const ext = extOf(file);
  if (ext === "XLSX") ingestXlsx(file, full, { resolve, link, getNode, addProp });
  else if (ext === "PPTX") ingestPptx(full, { resolve, link });
  else if (ext === "DOCX") ingestDocx(full, { resolve, link });
  else if (ext === "DXF") ingestDxf(full, { resolve, link, getNode, addProp });
  else if (ext === "PDF") {
    // PDF 는 텍스트 추출(pyservice)이 선행 조건 — 여기서는 자유 텍스트 엔티티 링크만(pptx 산문과 동일 경로).
    if (!pdfText) throw new Error("PDF 는 추출 텍스트가 필요합니다(pyservice /parse 선행)");
    linkFreeText(pdfText, { resolve, link });
  } else throw new Error(`지원하지 않는 확장자: ${ext}`);

  // 파일 → doc 노드 + EVIDENCED_BY
  const docId = `doc:${file}`;
  const [firstContrib] = contributed; // 대표 부모(EVIDENCED_BY 대상 중 첫 기여 객체)
  nodes.set(docId, {
    id: docId,
    type: "doc",
    label: file,
    ext,
    parent: firstContrib,
    props: [["형식", ext], ["정형화", "Docling 추출 완료"]],
  });
  for (const objId of contributed) addEdge(objId, "EVIDENCED_BY", docId);

  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(full).size;
  } catch {}
  return { file, type: ext, sizeBytes, extracted: { objects: contributed.size, relations }, preview };
}

export function ingestAll(dir: string = SOURCES_DIR()): IngestResult {
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(dir)
      // Office 임시 잠금 파일(~$…) 은 제외 — 유효한 문서가 아니라 파싱 노이즈만 만든다.
      .filter((f) => /\.(xlsx|pptx|docx|dxf)$/i.test(f) && !f.startsWith("~$"))
      .sort();
  } catch {
    return { nodes: [], edges: [], sources: [] };
  }
  if (files.length === 0) return { nodes: [], edges: [], sources: [] };

  const sink = newSink();
  const sources: SourceInfo[] = [];
  for (const file of files) {
    try {
      sources.push(ingestFileInto(sink, file, path.join(dir, file)));
    } catch (err) {
      // 개별 파일 파싱 실패는 건너뛰고 나머지를 계속(견고성).
      console.error("ingest: failed to parse", file, err);
      continue;
    }
  }

  return { nodes: [...sink.nodes.values()], edges: sink.edges, sources };
}

/** 단일 파일 증분 인제스천 — 파일이 산출하는 모든 노드/엣지(기존 store 와 겹치는 것 포함)를 반환.
 * resolveOrCreate 의 결정론적 id(동일 라벨 → 동일 AUTO id) 덕분에 기존 store id 와 그대로 일치하므로
 * 병합(store.mergeDelta)에서 dedupe 된다. doc 노드(`doc:<fileName>`) + EVIDENCED_BY 포함.
 * 파싱 실패는 throw — 호출측(route)에서 422 로 변환한다. */
export function ingestOne(filePath: string, fileName: string): { nodes: Node[]; edges: Edge[]; source: SourceInfo } {
  const sink = newSink();
  const source = ingestFileInto(sink, fileName, filePath);
  return { nodes: [...sink.nodes.values()], edges: sink.edges, source };
}

/** PDF 증분 인제스천 — pyservice /parse 가 추출한 텍스트를 자유 텍스트 엔티티 링크 파이프라인에
 * 태워 노드/엣지 + doc 근거를 만든다. sync(파일 I/O 없음) — 비동기 추출은 호출측(route) 책임.
 * 부팅 ingestAll() 은 PDF 미대상(베이스라인에 PDF 없음) — 업로드 경로 전용. */
export function ingestPdfText(fileName: string, text: string, sizeBytes = 0): { nodes: Node[]; edges: Edge[]; source: SourceInfo } {
  const sink = newSink();
  const source = ingestFileInto(sink, fileName, "", text);
  source.sizeBytes = sizeBytes;
  return { nodes: [...sink.nodes.values()], edges: sink.edges, source };
}

/* ────────────────────────── 파일 유형별 의미 해석 ────────────────────────── */

interface Ctx {
  resolve: (raw: string, type?: ObjType, record?: boolean) => string | null;
  link: (src: string | null, rel: string, dst: string | null, opts?: { weight?: number; scen?: boolean }) => void;
}
interface XlsxCtx extends Ctx {
  getNode: (id: string) => Node;
  addProp: (n: Node, key: string, val: string) => void;
}

// 참조 xlsx 컬럼 → seed prop 키 매핑(정형 참조 테이블은 id 명시).
function ingestXlsx(file: string, full: string, ctx: XlsxCtx) {
  const { resolve, link, getNode, addProp } = ctx;
  const { sheets } = readWorkbook(full);
  const sheet = (name: string) => sheets.find((s) => s.name === name);

  if (file.startsWith("FMEA")) {
    // FMEA 검토시트: 행 = (부품·기능·고장모드·원인·영향·S·O·현행조치·원본코드·발생프로젝트)
    const rows = sheet("FMEA")?.rows ?? sheets[0]?.rows ?? [];
    for (const r of rows) {
      // 컬럼이 곧 타입 — 통제 어휘에 없는 값은 auto-create 로 편입.
      const item = resolve(r["부품"], "item");
      const fm = resolve(r["고장모드"], "fm");
      const cause = resolve(r["원인"], "cause");
      const action = resolve(r["현행조치"], "action");
      const proj = resolve(r["발생프로젝트"], "proj");
      if (fm) {
        const nf = getNode(fm);
        addProp(nf, "심각도 S", r["심각도S"]);
        addProp(nf, "영향", r["영향"]);
        addProp(nf, "RPN", r["RPN"]);
      }
      if (cause) {
        const nc = getNode(cause);
        addProp(nc, "발생도 O", r["발생도O"]);
        addProp(nc, "검출도 D", r["검출도D"]);
      }
      link(item, "HAS_FAILURE", fm);
      link(fm, "CAUSED_BY", cause);
      link(fm, "MITIGATED_BY", action);
      link(proj, "OCCURRED_IN", fm);
      // 비표준 원본 코드 매핑 시연 (예: "외관-B" → FMGAP, 확신도 0.72). 타입 미지정 → 무손실 매핑만.
      if (!EMPTY(r["원본코드"])) resolve(r["원본코드"]);
    }
    return;
  }

  if (file.startsWith("법규기준")) {
    for (const r of sheet("법규")?.rows ?? []) {
      const id = resolve(r["id"]);
      if (!id) continue;
      const n = getNode(id);
      addProp(n, "국가", r["국가"]);
      addProp(n, "핵심", r["핵심"]);
      addProp(n, "비고", r["비고"]);
    }
    for (const r of sheet("법규적용")?.rows ?? []) {
      link(resolve(r["대상id"]), r["관계"], resolve(r["reg_id"]));
    }
    return;
  }

  if (file.startsWith("설계표준")) {
    for (const r of sheet("마스터")?.rows ?? []) {
      const id = resolve(r["id"]);
      if (!id) continue;
      const n = getNode(id);
      if (!EMPTY(r["sub"])) n.sub = r["sub"];
      addProp(n, "성격", r["성격"]);
      addProp(n, "항목", r["항목"]);
      // 항목1..N 컬럼(신규 마스터의 필수 항목 나열 — 결로체크리스트 등): 있는 만큼 props 로.
      for (const k of Object.keys(r)) if (/^항목\d+$/.test(k)) addProp(n, k, r[k]);
      link(resolve(r["참조원id"]), r["관계"] || "REF_MASTER", id);
    }
    return;
  }

  if (file.startsWith("고객사")) {
    for (const r of sheet("스펙")?.rows ?? []) {
      const id = resolve(r["id"]);
      if (!id) continue;
      const n = getNode(id);
      if (!EMPTY(r["sub"])) n.sub = r["sub"];
      addProp(n, "고객사", r["고객사"]);
      addProp(n, "포함", r["포함"]);
      for (const p of (r["적용프로젝트"] || "").split(",").map((s) => s.trim())) {
        link(resolve(p), "SPEC_OF", id);
      }
    }
    return;
  }

  if (file.startsWith("유사도매트릭스")) {
    for (const r of sheet("프로젝트")?.rows ?? []) {
      const id = resolve(r["id"]);
      if (!id) continue;
      const n = getNode(id);
      if (!EMPTY(r["요약"])) n.sub = r["요약"];
      if (r["hidden"] === "Y") n.hidden = true;
      addProp(n, "차종", r["차종"]);
      addProp(n, "광원", r["광원"]);
      addProp(n, "이슈 이력", r["이슈이력"]);
      addProp(n, "비고", r["비고"]);
      addProp(n, "상태", r["상태"]);
      addProp(n, "조건", r["조건"]);
    }
    for (const r of sheet("부품")?.rows ?? []) {
      const id = resolve(r["id"]);
      if (!id) continue;
      const n = getNode(id);
      if (!EMPTY(r["요약"])) n.sub = r["요약"];
      if (r["hero"] === "Y") n.hero = true;
      addProp(n, "구성", r["구성"]);
      addProp(n, "특성", r["특성"]);
      addProp(n, "소재", r["소재"]);
      addProp(n, "리스크", r["리스크"]);
    }
    for (const r of sheet("구성")?.rows ?? []) {
      link(resolve(r["상위id"]), r["관계"], resolve(r["하위id"]));
    }
    for (const r of sheet("유사도")?.rows ?? []) {
      link(resolve(r["from_id"]), "SIMILAR", resolve(r["to_id"]), {
        // 빈 셀은 0 이 아니라 "가중치 없음" 으로 (Number("")===0 방지 → infer 폴백 0.5 유지)
        weight: r["weight"] === "" || r["weight"] == null ? undefined : Number(r["weight"]),
        scen: r["scenario"] === "Y",
      });
    }
    for (const r of sheet("시나리오")?.rows ?? []) {
      link(resolve(r["from_id"]), r["관계"], resolve(r["to_id"]), { scen: true });
    }
    // 형상특징 → proj props("형상.*") — 도면 형상 유사 탐색(shape-sim)의 비교 기준 벡터
    for (const r of sheet("형상특징")?.rows ?? []) {
      const id = resolve(r["id"], undefined, false);
      if (!id) continue;
      const n = getNode(id);
      addProp(n, "시장", r["시장"]);
      addProp(n, "형상.하우징", r["하우징"]);
      addProp(n, "형상.벤트 홀", r["벤트홀"]);
      addProp(n, "형상.실링", r["실링"]);
      addProp(n, "형상.개스킷 소재", r["개스킷소재"]);
      addProp(n, "형상.커넥터", r["커넥터"]);
      addProp(n, "형상.렌즈", r["렌즈"]);
    }
    return;
  }

  if (file.startsWith("소비자반응")) {
    // 4단계 소비자 반응 교차 — 프로젝트 노드에 "소비자언급.*" props 로 부착(근거 = 이 파일)
    for (const r of sheet("언급")?.rows ?? []) {
      const proj = resolve(r["프로젝트"], "proj");
      if (!proj) continue;
      addProp(getNode(proj), `소비자언급.${r["증상"]}`, `${r["언급수"]}건 (${r["지역"]}·${r["계절"]} · ${r["출처"]}${r["URL"] ? ` · ${r["URL"]}` : ""})`);
    }
    return;
  }

  if (file.startsWith("BOM")) {
    ingestXlsxBom(full, ctx);
    return;
  }

  // 알려진 접두어(정형 참조/FMEA)에 매칭되지 않은 xlsx = "실무" 문서 → 휴리스틱 FMEA 추출.
  // (data/sources 의 정형 파일은 위 분기에서 이미 return 되므로 여기 도달하지 않는다 — 부가적.)
  ingestXlsxHeuristic(full, ctx);
}

// BOM(부품표) xlsx: 행 = (상위 부품, 부품명, 수량, 재질, …). 컬럼명은 동의어 허용
// (상위부품/모듈/assembly, 부품명/품명/part, 수량/qty, 재질/소재/material) — 헤더 자동탐지는
// 불요(정형 시트 가정)하되 실제 헤더 텍스트를 동의어로 찾는다. 상위 부품이 있으면 CONSISTS_OF,
// 없으면(최상위 어셈블리 행) 노드만 생성. 통제 어휘 밖 부품명은 auto-create 로 편입.
const BOM_COL_SYN = {
  parent: ["상위부품", "상위 부품", "모듈", "assembly", "parent"],
  child: ["부품명", "품명", "부품", "part"],
  qty: ["수량", "qty", "quantity"],
  material: ["재질", "소재", "material"],
} as const;

function ingestXlsxBom(full: string, ctx: XlsxCtx) {
  const { resolve, link, getNode, addProp } = ctx;
  const { sheets } = readWorkbook(full);
  // 완전 일치를 부분 일치보다 우선한다 — "부품명"은 "상위 부품"의 부분 문자열이라
  // includes 만으로 매칭하면 상위/하위 컬럼이 같은 헤더로 뒤섞인다(자기 자신 CONSISTS_OF 유발).
  const findCol = (headers: string[], syns: readonly string[]) => {
    const exact = headers.find((h) => syns.some((s) => nsl(h) === nsl(s)));
    if (exact) return exact;
    return headers.find((h) => syns.some((s) => nsl(h).includes(nsl(s))));
  };

  for (const sh of sheets) {
    if (sh.rows.length === 0) continue;
    const headers = Object.keys(sh.rows[0]);
    const parentCol = findCol(headers, BOM_COL_SYN.parent);
    const childCol = findCol(headers.filter((h) => h !== parentCol), BOM_COL_SYN.child);
    const qtyCol = findCol(headers, BOM_COL_SYN.qty);
    const matCol = findCol(headers, BOM_COL_SYN.material);
    if (!childCol) continue; // 부품명 컬럼이 없으면 BOM 시트가 아님 — 견고하게 skip

    for (const r of sh.rows) {
      const childRaw = r[childCol];
      if (EMPTY(childRaw)) continue; // 빈 행 skip
      const child = resolve(childRaw, "item");
      if (!child) continue;
      const nc = getNode(child);
      if (qtyCol) addProp(nc, "수량", r[qtyCol]);
      if (matCol) addProp(nc, "재질", r[matCol]);

      const parentRaw = parentCol ? r[parentCol] : "";
      if (!EMPTY(parentRaw)) {
        const parent = resolve(parentRaw, "item");
        link(parent, "CONSISTS_OF", child);
      }
    }
  }
}

/* ───── 실무 FMEA 워크시트 휴리스틱: 헤더 자동탐지 · 동의어 컬럼매핑 · 병합셀 채움 ───── */

type Role =
  | "item" | "fm" | "cause" | "action" | "effect"
  | "S" | "O" | "D" | "RPN" | "proj" | "prevent" | "detect";

// 컬럼명 동의어 → 역할. 순서 = 우선순위(구체적 항목 먼저: RPN·검출도 를 일반 '검출'보다 앞에).
const ROLE_SYNS: [Role, string[]][] = [
  ["RPN", ["rpn"]],
  ["S", ["심각도", "severity"]],
  ["O", ["발생도", "occurrence"]],
  ["D", ["검출도", "detection"]],
  ["proj", ["발생프로젝트", "프로젝트", "project", "차종"]],
  ["item", ["부품명", "부품", "품명", "항목", "기능", "구성품", "item", "part"]],
  ["fm", ["고장모드", "불량모드", "failuremode", "고장형태", "현상"]],
  ["cause", ["고장원인", "발생원인", "원인", "메커니즘", "cause"]],
  ["action", ["권고조치", "조치사항", "대책", "조치", "개선", "시정", "action"]],
  ["effect", ["영향", "effect"]],
  ["prevent", ["예방", "prevention"]],
  ["detect", ["검출관리", "검출"]],
];

const nsl = (s: string) => (s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, "");

function matchRole(cellText: string): Role | null {
  const c = nsl(cellText);
  if (!c) return null;
  for (const [role, syns] of ROLE_SYNS) {
    for (const s of syns) {
      const ss = nsl(s);
      if (ss && c.includes(ss)) return role;
    }
  }
  return null;
}

// 병합범위의 좌상단 값을 범위 전체(빈 셀)에 전파 — 세로 병합된 부품셀·2행 헤더 처리.
function fillMerges(grid: string[][], merges: MergeRange[]): void {
  for (const m of merges) {
    const v = grid[m.s.r]?.[m.s.c] ?? "";
    if (!v) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      if (!grid[r]) grid[r] = [];
      for (let c = m.s.c; c <= m.e.c; c++) {
        if ((grid[r][c] ?? "") === "") grid[r][c] = v;
      }
    }
  }
}

interface HeaderPick {
  row: number;
  span: number; // 1 = 단일행, 2 = 2행 병합 헤더
  roleCol: Partial<Record<Role, number>>;
  core: number; // item/fm/cause/action 매칭 수
}

function scoreCells(cells: string[]): { roleCol: Partial<Record<Role, number>>; core: number; total: number } {
  const roleCol: Partial<Record<Role, number>> = {};
  for (let c = 0; c < cells.length; c++) {
    const r = matchRole(cells[c]);
    if (r && roleCol[r] === undefined) roleCol[r] = c; // 역할당 첫 컬럼만
  }
  const core = (["item", "fm", "cause", "action"] as Role[]).filter((r) => roleCol[r] !== undefined).length;
  return { roleCol, core, total: Object.keys(roleCol).length };
}

// 앞쪽 최대 15행에서 FMEA 컬럼 키워드가 가장 잘 맞는 헤더행(또는 2행 병합)을 고른다.
function detectHeader(grid: string[][]): HeaderPick | null {
  let best: HeaderPick | null = null;
  let bestKey = [-1, -1, -1]; // [core, total, -span]
  const limit = Math.min(15, grid.length);
  for (let r = 0; r < limit; r++) {
    const single = grid[r] ?? [];
    const cand: { span: number; cells: string[] }[] = [{ span: 1, cells: single }];
    if (r + 1 < grid.length) {
      const next = grid[r + 1] ?? [];
      const width = Math.max(single.length, next.length);
      const merged: string[] = [];
      for (let c = 0; c < width; c++) merged[c] = `${single[c] ?? ""} ${next[c] ?? ""}`.trim();
      cand.push({ span: 2, cells: merged });
    }
    for (const { span, cells } of cand) {
      const { roleCol, core, total } = scoreCells(cells);
      if (core < 2 || roleCol.item === undefined || roleCol.fm === undefined) continue;
      const key = [core, total, -span];
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
        bestKey = key;
        best = { row: r, span, roleCol, core };
      }
    }
  }
  return best;
}

function ingestXlsxHeuristic(full: string, ctx: XlsxCtx): void {
  const { resolve, link, getNode, addProp } = ctx;
  let sheets;
  try {
    sheets = readWorkbookGrids(full).sheets;
  } catch {
    return; // 이상 파일은 조용히 건너뜀(견고성)
  }
  for (const sh of sheets) {
    try {
      fillMerges(sh.grid, sh.merges);
      const hdr = detectHeader(sh.grid);
      if (!hdr) continue; // FMEA 성격이 아니면 스킵
      const col = hdr.roleCol;
      const at = (r: number, role: Role): string => {
        const c = col[role];
        return c === undefined ? "" : (sh.grid[r]?.[c] ?? "");
      };
      for (let r = hdr.row + hdr.span; r < sh.grid.length; r++) {
        const fmV = at(r, "fm");
        if (!fmV.trim()) continue; // 고장모드 없는 행 = 비고/구분/빈 행 → 스킵
        const item = resolve(at(r, "item"), "item");
        const fm = resolve(fmV, "fm");
        const cause = resolve(at(r, "cause"), "cause");
        const action = resolve(at(r, "action"), "action");
        const proj = resolve(at(r, "proj"), "proj");
        if (fm) {
          const nf = getNode(fm);
          addProp(nf, "심각도 S", at(r, "S"));
          addProp(nf, "영향", at(r, "effect"));
          addProp(nf, "RPN", at(r, "RPN"));
          addProp(nf, "예방관리", at(r, "prevent"));
        }
        if (cause) {
          const nc = getNode(cause);
          addProp(nc, "발생도 O", at(r, "O"));
          addProp(nc, "검출도 D", at(r, "D"));
        }
        link(item, "HAS_FAILURE", fm);
        link(fm, "CAUSED_BY", cause);
        link(fm, "MITIGATED_BY", action);
        link(proj, "OCCURRED_IN", fm);
      }
    } catch {
      continue; // 시트 단위 실패 격리
    }
  }
}

/* ───── 자유 텍스트(pptx/docx) 엔티티 링크: 정형 파싱이 아무 관계도 못 뽑을 때만 폴백 ─────
 * 통제 어휘 스캔 + "키: 값" 라벨 필드로 부품/고장모드/원인/조치/프로젝트를 모으고
 * 문서(슬라이드/섹션) 내 공동언급을 HAS_FAILURE/CAUSED_BY/MITIGATED_BY 로 연결한다. */
const FIELD_PATTERNS: [ObjType, string][] = [
  ["item", "부품|품명|항목|구성품"],
  ["fm", "고장모드|불량모드|현상|이슈|고장"],
  ["cause", "원인|메커니즘"],
  ["action", "대책|조치|개선|시정조치"],
  ["proj", "프로젝트|차종|적용차종"],
];

function linkFreeText(text: string, ctx: Ctx): void {
  const { resolve, link } = ctx;
  const items = new Set<string>();
  const fms = new Set<string>();
  const causes = new Set<string>();
  const actions = new Set<string>();
  const put = (t: ObjType, id: string | null) => {
    if (!id) return;
    if (t === "item") items.add(id);
    else if (t === "fm") fms.add(id);
    else if (t === "cause") causes.add(id);
    else if (t === "action") actions.add(id);
  };
  // 1) 통제 어휘 스캔(알려진 라벨/동의어 언급)
  for (const h of scanEntities(text)) put(h.type, resolve(h.id, h.type));
  // 2) "키: 값" 라벨 필드(산문 속 반정형) — 미등록 값은 auto-create
  for (const [type, kw] of FIELD_PATTERNS) {
    const re = new RegExp(`(?:${kw})\\s*[:：]\\s*([^\\n:：]+)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const val = m[1].trim().split(/[,·/]/)[0].trim();
      put(type, resolve(val, type));
    }
  }
  // 3) 공동언급 연결(문서 전체 — 단일 이슈 문서 가정)
  for (const it of items) for (const fm of fms) link(it, "HAS_FAILURE", fm);
  for (const fm of fms) for (const c of causes) link(fm, "CAUSED_BY", c);
  for (const fm of fms) for (const a of actions) link(fm, "MITIGATED_BY", a);
  if (fms.size === 0) {
    // 고장모드가 없으면 부품/원인 → 조치로 폴백 연결(예: LED 방열 CTHERM→ARIB)
    for (const it of items) for (const a of actions) link(it, "MITIGATED_BY", a);
    for (const c of causes) for (const a of actions) link(c, "MITIGATED_BY", a);
  }
}

// 재발방지 대책서(pptx): 표지·현상·원인분석·대책·근거 슬라이드.
function ingestPptx(full: string, ctx: Ctx) {
  const { resolve, link } = ctx;
  const { slides } = readDeck(full);
  const all = slides.flatMap((s) => s.lines);
  const after = (prefix: string) => {
    const l = all.find((x) => x.startsWith(prefix));
    return l ? l.slice(prefix.length).trim() : "";
  };
  const sectionBody = (header: string): string[] => {
    const s = slides.find((sl) => sl.lines[0] === header);
    return s ? s.lines.slice(1) : [];
  };
  // 슬라이드 라벨이 타입을 암시 — 표지/현상/원인분석/대책 섹션별로 기대 타입 부여(auto-create).
  const proj = resolve(after("프로젝트:"), "proj");
  const fm = resolve(after("이슈:"), "fm");
  const item = resolve(after("부품:"), "item");
  // 원인분석 슬라이드에 산문·키:값·번호가 섞여 있어도 원인 라벨(짧은 명사구)만 취한다.
  const causeLine = (l: string) =>
    l.length <= 30 && !/[:：]/.test(l) && !/[.。]\s*$/.test(l) && !/^\d+[.)]?\s/.test(l);
  const causes = sectionBody("원인분석").filter(causeLine).map((c) => resolve(c, "cause"));
  const action = resolve(sectionBody("대책")[0] ?? "", "action");
  // pptx 는 지식(인과·대책) 근거. 발생(OCCURRED_IN)은 FMEA 만 판단.
  let made = 0;
  const L = (a: string | null, rel: string, b: string | null) => {
    if (a && b) { link(a, rel, b); made++; }
  };
  L(item, "HAS_FAILURE", fm);
  for (const c of causes) L(fm, "CAUSED_BY", c);
  L(fm, "MITIGATED_BY", action);
  // 정형 앵커가 아무 관계도 못 뽑으면(산문 8D 등) 자유 텍스트 링크로 폴백.
  if (made === 0) linkFreeText(all.join("\n"), ctx);
}

// 2D 도면(dxf): 제목블록(부품명·프로젝트·차종·소재) + NOTE 형상 특징 + BOM 표.
// 도면이 주장하는 것 = 부품 구성(BOM→CONSISTS_OF)과 프로젝트·형상 속성. 고장/원인 판단은 하지 않는다.
function ingestDxf(full: string, ctx: XlsxCtx) {
  const { resolve, link, getNode, addProp } = ctx;
  const d = parseDrawing(readDxfEntities(full));

  const item = resolve(d.labels["부품명"], "item");
  const proj = resolve(d.labels["프로젝트"], "proj");
  if (item) {
    const ni = getNode(item);
    addProp(ni, "소재", d.labels["소재"]);
    addProp(ni, "도번", d.labels["도번"]);
  }
  if (proj) {
    const np = getNode(proj);
    addProp(np, "차종", d.labels["차종"]);
    addProp(np, "시장", d.labels["시장"]);
    // 형상 특징 → proj props("형상.*") — shape-sim(형상 유사도)의 특징 벡터 원천
    for (const [k, v] of Object.entries(d.features)) addProp(np, `형상.${k}`, v);
  }
  // BOM → 어셈블리 구성(CONSISTS_OF) + 재질 속성
  for (const b of d.bom) {
    const child = resolve(b.name, "item");
    if (!child) continue;
    if (b.material && !EMPTY(b.material) && b.material !== "-") addProp(getNode(child), "재질", b.material);
    link(item, "CONSISTS_OF", child);
  }
  // 라벨이 하나도 없으면(우리 규칙 밖 도면) 텍스트 전체에서 통제 어휘 스캔 폴백
  if (!item && !proj && d.bom.length === 0) {
    for (const h of scanEntities(d.texts.map((t) => t.value).join("\n"))) resolve(h.id, h.type);
  }
}

// 품질 리포트(docx): 프로젝트/부품/고장모드/원인/조치/비고 문단.
function ingestDocx(full: string, ctx: Ctx) {
  const { resolve, link } = ctx;
  const { paragraphs } = readDoc(full);
  const field: Record<string, string> = {};
  for (const p of paragraphs) {
    const m = p.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (m) field[m[1].trim()] = m[2].trim();
  }
  const item = resolve(field["부품"] ?? "", "item");
  const fm = resolve(field["고장모드"] ?? "", "fm");
  const cause = resolve(field["원인"] ?? "", "cause");
  const action = resolve(field["조치"] ?? "", "action");
  resolve(field["프로젝트"] ?? "", "proj");
  let made = 0;
  if (item && fm) { link(item, "HAS_FAILURE", fm); made++; }
  if (fm && cause) { link(fm, "CAUSED_BY", cause); made++; }
  // 조치는 고장모드가 있으면 fm→action, 없으면 원인→action (예: 방열 CTHERM→ARIB)
  if (action && (fm || cause)) { link(fm ?? cause, "MITIGATED_BY", action); made++; }
  // 정형 필드가 아무 관계도 못 뽑으면(산문 리포트) 자유 텍스트 링크로 폴백.
  if (made === 0) linkFreeText(paragraphs.join("\n"), ctx);
}
