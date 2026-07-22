"""Stateless embedding + reasoning + LLM sidecar for SL OntoGround. Request -> result, no DB, no files."""
import asyncio
import json
import os
import re
from collections import defaultdict
from functools import lru_cache
from urllib.parse import quote, unquote

import httpx
from fastapi import FastAPI
from pydantic import BaseModel
from rdflib import Graph, Namespace, URIRef

MODEL_NAME = "intfloat/multilingual-e5-base"  # 768-dim, 512 tokens, Korean-strong
# ⚠ e5 계열은 "query: " / "passage: " 접두어를 요구한다. 접두어는 호출자(lib/embed.ts)가 붙인다 —
# 여기서 붙이면 이미 붙은 텍스트에 이중으로 들어간다.

app = FastAPI(title="sl-ontoground-embed")


@lru_cache(maxsize=1)
def get_model():
    # Lazy import: torch/sentence-transformers stay optional for /reason-only use.
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(MODEL_NAME)


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    vectors: list[list[float]]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    if not req.texts:
        return EmbedResponse(vectors=[])
    vectors = get_model().encode(req.texts, normalize_embeddings=True)
    return EmbedResponse(vectors=vectors.tolist())


# ---------------------------------------------------------------------------
# /reason — path-preserving rule reasoning over an in-request ontology graph.
# rdflib holds the triples (data structure / namespace hygiene); provenance
# (via-chains) is tracked in plain Python because OWL-RL closure keeps no proofs.
# ---------------------------------------------------------------------------

SLONTO = Namespace("http://slonto.local/")
MAX_DERIVED = 500  # ponytail: hard cap against combinatorial blowup; paginate if ever needed


def _uri(v: str) -> URIRef:
    return SLONTO[quote(v, safe="")]


def _local(u: URIRef) -> str:
    return unquote(str(u)[len(str(SLONTO)):])


class ReasonNode(BaseModel):
    id: str
    type: str = ""
    label: str = ""


class ReasonEdge(BaseModel):
    src: str
    rel: str
    dst: str
    weight: float | None = None


class ReasonRequest(BaseModel):
    nodes: list[ReasonNode] = []
    edges: list[ReasonEdge] = []


class DerivedEdge(BaseModel):
    src: str
    rel: str
    dst: str
    rule: str
    via: list[str]
    confidence: float


class ReasonResponse(BaseModel):
    derived: list[DerivedEdge]


def _edge_str(src: str, rel: str, dst: str) -> str:
    return f"{src}→{rel}→{dst}"


def _derive(req: ReasonRequest) -> list[DerivedEdge]:
    node_ids = {n.id for n in req.nodes}
    g = Graph()
    weights: dict[tuple[str, str, str], float] = {}
    for e in req.edges:
        if e.src not in node_ids or e.dst not in node_ids:
            continue  # dangling reference: skip, never 500
        g.add((_uri(e.src), _uri(e.rel), _uri(e.dst)))
        if e.weight is not None:
            weights[(e.src, e.rel, e.dst)] = e.weight

    def pairs(rel: str) -> list[tuple[str, str]]:
        return [(_local(s), _local(o)) for s, _, o in g.triples((None, _uri(rel), None))]

    original = {(_local(s), _local(p), _local(o)) for s, p, o in g}
    seen = set(original)  # dedupe: originals excluded, derived not repeated
    derived: list[DerivedEdge] = []

    def add(src: str, rel: str, dst: str, rule: str, via: list[str], conf: float) -> None:
        key = (src, rel, dst)
        if key in seen or len(derived) >= MAX_DERIVED:
            return
        seen.add(key)
        derived.append(DerivedEdge(src=src, rel=rel, dst=dst, rule=rule, via=via, confidence=conf))

    consists = pairs("CONSISTS_OF")

    # (a) consists-transitive: CONSISTS_OF closure, path depth <= 3
    adj: dict[str, list[str]] = defaultdict(list)
    for a, b in consists:
        adj[a].append(b)
    for start in list(adj):
        stack: list[tuple[str, list[str], frozenset]] = [(start, [], frozenset({start}))]
        while stack:
            node, path, vis = stack.pop()
            for child in adj.get(node, ()):
                if child in vis:
                    continue  # cycle guard
                npath = path + [_edge_str(node, "CONSISTS_OF", child)]
                if len(npath) >= 2:
                    add(start, "CONSISTS_OF", child, "consists-transitive", npath, 0.85)
                if len(npath) < 3:
                    stack.append((child, npath, vis | {child}))

    # (b) similar-symmetric: SIMILAR without its inverse
    similar = pairs("SIMILAR")
    sim_set = set(similar)
    for a, b in similar:
        if (b, a) not in sim_set:
            w = weights.get((a, "SIMILAR", b))
            add(b, "SIMILAR", a, "similar-symmetric",
                [_edge_str(a, "SIMILAR", b)], w if w is not None else 0.7)

    # (c) failure-propagation: CONSISTS_OF ∘ HAS_FAILURE ⇒ POTENTIAL_FAILURE (property chain)
    has_failure: dict[str, list[str]] = defaultdict(list)
    for c, f in pairs("HAS_FAILURE"):
        has_failure[c].append(f)
    for p, c in consists:
        for f in has_failure.get(c, ()):
            add(p, "POTENTIAL_FAILURE", f, "failure-propagation",
                [_edge_str(p, "CONSISTS_OF", c), _edge_str(c, "HAS_FAILURE", f)], 0.7)

    return derived


@app.post("/reason", response_model=ReasonResponse)
def reason(req: ReasonRequest) -> ReasonResponse:
    try:
        return ReasonResponse(derived=_derive(req))
    except Exception:
        return ReasonResponse(derived=[])  # never 500 on reasoning input


# ---------------------------------------------------------------------------
# /export — RDF Turtle export of the ontology (schema + instances). rdflib
# serializes; ids/keys are percent-quoted into URIs, Korean labels stay as
# rdfs:label literals (lang=ko). Failures return an empty graph, never 500.
# ---------------------------------------------------------------------------

from rdflib import Literal  # noqa: E402
from rdflib.namespace import RDF, RDFS, XSD  # noqa: E402

SLO = Namespace("http://sl-ontoground.local/onto#")
_NUM = re.compile(r"^-?\d+(\.\d+)?$")  # xsd:decimal lexical space (no exponent)


def _slo(v: str) -> URIRef:
    return SLO[quote(v, safe="")]


class ExpObjectType(BaseModel):
    type_id: str
    label_ko: str = ""
    description: str | None = None


class ExpRelationType(BaseModel):
    rel_id: str
    label_ko: str = ""
    src_types: list[str] = []
    dst_types: list[str] = []
    directed: bool = True


class ExpSubtype(BaseModel):
    type_id: str
    st_id: str
    label_ko: str = ""


class ExpPropertyDef(BaseModel):
    type_id: str
    key: str
    label_ko: str = ""
    datatype: str = "text"


class ExpNode(BaseModel):
    id: str
    type: str = ""
    st: str | None = None
    label: str = ""
    props: list[list[str]] | None = None


class ExpEdge(BaseModel):
    src: str
    rel: str
    dst: str


class ExportRequest(BaseModel):
    objectTypes: list[ExpObjectType] = []
    relationTypes: list[ExpRelationType] = []
    subtypes: list[ExpSubtype] = []
    propertyDefs: list[ExpPropertyDef] = []
    nodes: list[ExpNode] = []
    edges: list[ExpEdge] = []


class ExportResponse(BaseModel):
    ttl: str
    triples: int


def _label(g: Graph, u: URIRef, text: str) -> None:
    if text:
        g.add((u, RDFS.label, Literal(text, lang="ko")))


def _build_export(req: ExportRequest) -> Graph:
    g = Graph()
    g.bind("slo", SLO)

    # schema: object types
    for ot in req.objectTypes:
        u = _slo(ot.type_id)
        g.add((u, RDF.type, RDFS.Class))
        _label(g, u, ot.label_ko)
        if ot.description:
            g.add((u, RDFS.comment, Literal(ot.description, lang="ko")))

    # schema: subtypes (single-level)
    subtype_keys = set()
    for st in req.subtypes:
        subtype_keys.add((st.type_id, st.st_id))
        u = _slo(f"{st.type_id}_{st.st_id}")
        g.add((u, RDF.type, RDFS.Class))
        g.add((u, RDFS.subClassOf, _slo(st.type_id)))
        _label(g, u, st.label_ko)

    # schema: relation types
    # ponytail: multi domain/range → first type only, empty array → omitted
    # (1차 단순화 per spec; owl:unionOf when Protégé fidelity matters)
    for rt in req.relationTypes:
        u = _slo(rt.rel_id)
        g.add((u, RDF.type, RDF.Property))
        _label(g, u, rt.label_ko)
        if rt.src_types:
            g.add((u, RDFS.domain, _slo(rt.src_types[0])))
        if rt.dst_types:
            g.add((u, RDFS.range, _slo(rt.dst_types[0])))

    # schema: property defs
    for pd in req.propertyDefs:
        u = _slo(f"prop_{pd.key}")
        g.add((u, RDF.type, RDF.Property))
        g.add((u, RDFS.domain, _slo(pd.type_id)))
        g.add((u, RDFS.range, XSD.decimal if pd.datatype == "number" else XSD.string))
        _label(g, u, pd.label_ko)

    # instances: nodes
    for n in req.nodes:
        u = _slo(f"n_{n.id}")
        if n.type:
            cls = f"{n.type}_{n.st}" if n.st and (n.type, n.st) in subtype_keys else n.type
            g.add((u, RDF.type, _slo(cls)))
        _label(g, u, n.label)
        for p in n.props or []:
            if len(p) < 2:
                continue  # malformed pair: skip, never 500
            k, v = str(p[0]), str(p[1])
            lit = Literal(v, datatype=XSD.decimal) if _NUM.match(v.strip()) else Literal(v)
            g.add((u, _slo(f"prop_{k}"), lit))

    # instances: edges
    for e in req.edges:
        g.add((_slo(f"n_{e.src}"), _slo(e.rel), _slo(f"n_{e.dst}")))

    return g


@app.post("/export", response_model=ExportResponse)
def export(req: ExportRequest) -> ExportResponse:
    try:
        g = _build_export(req)
        return ExportResponse(ttl=g.serialize(format="turtle"), triples=len(g))
    except Exception:
        return ExportResponse(ttl="", triples=0)  # never 500 on export input


# ---------------------------------------------------------------------------
# /llm — in-house vLLM gateway (OpenAI-compatible /chat/completions, qwen3).
# Absorbs the direct call previously in Next lib/nlsearch.ts. Failures are
# always HTTP 200 {"ok": false, "error": ...} — callers fall back, never 500.
# ---------------------------------------------------------------------------

LLM_BASE_URL = os.environ.get(
    "LLM_BASE_URL", "http://vllm-loadbalancer.vllm-cluster.svc.cluster.local/v1"
).rstrip("/")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen3-32b-finance")
LLM_TIMEOUT_S = float(os.environ.get("LLM_TIMEOUT_S", "90"))
LLM_TOTAL_TIMEOUT_S = 120.0  # semaphore wait + vLLM call, hard ceiling

_llm_sem = asyncio.Semaphore(1)  # ponytail: 동시 1 — vLLM 과부하 보호, 큐가 필요해지면 워커 분리

# 프롬프트 원문: lib/nlsearch.ts 376-377행 이식 (검증된 자산 — 문구 변경 금지)
NLSEARCH_SYSTEM = (
    '너는 FMEA 온톨로지 검색기다. 목록의 id만 써서 질의 관련 id를 관련도순 최대 12개 고른다. '
    '지역은 법규로: 북미→FMVSS 108, 유럽→ECE R149, 한국→KMVSS, 중국→GB 25991. '
    'JSON만 출력: {"answer":"요약","interpretation":"조건","ids":[...]}. /no_think'
)
REVIEW_SYSTEM = (
    '너는 자동차 램프 설계 검토 수석 엔지니어다. 아래 체크리스트·마스터 대조·모순 정보를 근거로 '
    '종합 검토 소견 3~5문장을 작성하라. 반드시 근거로 삼은 CHECK 번호를 본문에 [CHECK n] 형식으로 인용하라. '
    '데이터에 없는 사실 창작 금지. JSON만 출력: {"opinion":"...","citedChecks":[n,...]} /no_think'
)
ASK_SYSTEM = (
    '너는 FMEA 온톨로지 질의응답 어시스턴트다. 아래 "선택 객체 컨텍스트"(객체 속성·관계 R n·근거 문서)만 '
    '근거로 사용자 질문에 한국어 3~6문장으로 답하라. 근거로 삼은 관계 번호를 본문에 [R n] 형식으로 인용하라. '
    '컨텍스트에 없는 사실은 창작하지 말고, 컨텍스트로 답할 수 없으면 그렇게 말하라. '
    'JSON만 출력: {"answer":"...","citedRels":[n,...]} /no_think'
)
DOCASK_SYSTEM = (
    '너는 사내 문서 질의응답 어시스턴트다. 아래 "문서 청크" 만 근거로 사용자 질문에 한국어 3~6문장으로 답하라. '
    '근거로 삼은 청크 번호를 본문에 [C n] 형식으로 인용하라. 수치·날짜는 청크에 적힌 값을 그대로 옮기고 '
    '계산하거나 추정하지 마라. 청크에 없는 사실은 창작하지 말고, 청크로 답할 수 없으면 그렇게 말하라. '
    'JSON만 출력: {"answer":"...","citedChunks":[n,...]} /no_think'
)
EXTRACT_SYSTEM = (
    '너는 FMEA 문서 개체 추출기다. 문서에서 부품(item)·고장모드(fm)·원인(cause)·조치(action)·프로젝트(proj) '
    '개체와 관계(HAS_FAILURE/CAUSED_BY/MITIGATED_BY/OCCURRED_IN)만 추출하라. '
    '개체가 통제 어휘 목록에 있으면 그 id를 쓰고, 없으면 id 없이 label만 반환하라. '
    '문서에 없는 개체·관계 창작 금지. JSON만 출력: '
    '{"entities":[{"type":"item","id":"IHL","label":"헤드램프 어셈블리"},{"type":"cause","label":"신규 원인"}],'
    '"relations":[{"srcLabel":"...","rel":"HAS_FAILURE","dstLabel":"..."}]} /no_think'
)

# v2 범용 지식그래프 추출 — FMEA 도메인에 얽매이지 않고 임의 개체·관계를 뽑는다.
GRAPHEXTRACT_SYSTEM = (
    '너는 지식그래프 추출기다. 문서(이메일·메모 등)에 등장하는 개체와 개체 사이 관계를 추출하라. '
    '개체 type 은 짧은 영문 소문자 종류(person·org·product·place·concept·event·project 등 자유). '
    'label 은 원문 표기 그대로. 관계는 srcLabel(출발 개체 label)·rel(관계명, 짧은 동사구)·dstLabel(도착 개체 label). '
    '문서에 실제로 등장하는 것만, 창작 금지. 대명사·일반명사(그것·회사 등)는 개체로 만들지 마라. '
    'JSON만 출력: {"entities":[{"type":"person","label":"김철수"},{"type":"org","label":"아크메"}],'
    '"relations":[{"srcLabel":"김철수","rel":"소속","dstLabel":"아크메"}]} /no_think'
)

EXTRACT_TEXT_MAX = 4000  # 문서 텍스트 절단 — 프롬프트 폭주 방지


class ChecklistItem(BaseModel):
    no: int
    title: str = ""
    desc: str = ""
    confidence: int = 0


class LLMRequest(BaseModel):
    task: str
    # nlsearch
    query: str = ""
    catalog: str = ""
    # review
    condition: str = ""
    checklist: list[ChecklistItem] = []
    masterAudit: list[str] = []
    contradictions: list[str] = []
    # ask (객체 Q&A — RAG 컨텍스트는 Next 가 조립)
    question: str = ""
    context: str = ""
    # extract (인제스천 LLM 보강 — 통제 어휘 카탈로그는 Next lib/ingest/normalize.ts 가 조립)
    text: str = ""
    vocab: str = ""


def strip_think(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def extract_json(text: str) -> dict | None:
    """Port of Next extractJson: drop <think> blocks, parse outermost {...}."""
    c = strip_think(text)
    a, b = c.find("{"), c.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        out = json.loads(c[a : b + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    return out if isinstance(out, dict) else None


def salvage_answer(content: str) -> str:
    """docask 전용 구제 — JSON 이 절단/오염돼도 답 텍스트만 살린다(근거 청크는 라우트가 보여줌).
    qwen3 가 /no_think 에도 흘리는 <think> 나 코드펜스, 잘린 JSON 에서 answer 를 뽑는다."""
    c = strip_think(content)
    m = re.search(r'"answer"\s*:\s*"((?:[^"\\]|\\.)*)"', c)  # 잘린 JSON 이라도 answer 필드가 온전하면
    if m:
        try:
            return json.loads('"' + m.group(1) + '"').strip()
        except (json.JSONDecodeError, ValueError):
            return m.group(1).strip()
    c = re.sub(r"```(?:json)?", "", c).strip()  # 코드펜스 제거
    return c.strip("{} \n").strip()


def _messages(req: LLMRequest) -> list[dict]:
    if req.task == "nlsearch":
        return [
            {"role": "system", "content": NLSEARCH_SYSTEM},
            {"role": "user", "content": f"/no_think 목록:\n{req.catalog}\n\n질의: {req.query}"},
        ]
    if req.task == "review":
        lines = [f"설계 조건: {req.condition}", "", "체크리스트:"]
        lines += [
            f"CHECK {c.no}: {c.title} — {c.desc} (confidence {c.confidence}%)"
            for c in req.checklist
        ]
        if req.masterAudit:
            lines += ["", "마스터 대조:"] + [f"- {m}" for m in req.masterAudit]
        if req.contradictions:
            lines += ["", "모순:"] + [f"- {c}" for c in req.contradictions]
        return [
            {"role": "system", "content": REVIEW_SYSTEM},
            {"role": "user", "content": "/no_think " + "\n".join(lines)},
        ]
    if req.task == "ask":
        return [
            {"role": "system", "content": ASK_SYSTEM},
            {"role": "user", "content": f"/no_think 선택 객체 컨텍스트:\n{req.context}\n\n질문: {req.question}"},
        ]
    if req.task == "docask":
        return [
            {"role": "system", "content": DOCASK_SYSTEM},
            {"role": "user", "content": f"/no_think 문서 청크:\n{req.context}\n\n질문: {req.question}"},
        ]
    if req.task == "extract":
        return [
            {"role": "system", "content": EXTRACT_SYSTEM},
            {"role": "user", "content": f"/no_think 통제 어휘:\n{req.vocab}\n\n문서:\n{req.text[:EXTRACT_TEXT_MAX]}"},
        ]
    if req.task == "graphextract":
        return [
            {"role": "system", "content": GRAPHEXTRACT_SYSTEM},
            {"role": "user", "content": f"/no_think 문서:\n{req.text[:EXTRACT_TEXT_MAX]}"},
        ]
    raise ValueError(f"unknown task: {req.task}")


async def _chat(messages: list[dict], max_tokens: int = 400) -> str:
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT_S) as client:
        res = await client.post(
            f"{LLM_BASE_URL}/chat/completions",
            json={"model": LLM_MODEL, "max_tokens": max_tokens, "temperature": 0, "messages": messages},
        )
        res.raise_for_status()
        return res.json()["choices"][0]["message"]["content"]


async def _guarded_chat(messages: list[dict], max_tokens: int = 400) -> str:
    async with _llm_sem:
        return await _chat(messages, max_tokens)


def _to_int_list(v) -> list[int]:
    out = []
    for x in v if isinstance(v, list) else []:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def _norm_extract(out: dict) -> dict:
    """추출 응답 정규화 — 비 dict/빈 필드는 관대하게 버린다(_to_int_list 스타일)."""
    entities = []
    for e in out.get("entities") if isinstance(out.get("entities"), list) else []:
        if not isinstance(e, dict):
            continue
        typ = str(e.get("type") or "").strip()
        label = str(e.get("label") or "").strip()
        if not typ or not label:
            continue
        ent = {"type": typ, "label": label}
        eid = str(e.get("id") or "").strip()
        if eid:
            ent["id"] = eid
        entities.append(ent)
    relations = []
    for r in out.get("relations") if isinstance(out.get("relations"), list) else []:
        if not isinstance(r, dict):
            continue
        src = str(r.get("srcLabel") or "").strip()
        rel = str(r.get("rel") or "").strip()
        dst = str(r.get("dstLabel") or "").strip()
        if src and rel and dst:
            relations.append({"srcLabel": src, "rel": rel, "dstLabel": dst})
    return {"entities": entities, "relations": relations}


@app.post("/llm")
async def llm(req: LLMRequest) -> dict:
    try:
        messages = _messages(req)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    # extract(개체 목록)·docask(한국어 3~6문장 답+citedChunks)는 토큰 여유가 필요하다.
    # 400 이면 qwen3 가 /no_think 에도 흘리는 <think> 추론이 JSON 을 밀어내 절단 → 파싱 실패.
    max_tokens = 800 if req.task in ("extract", "docask") else 400
    try:
        content = await asyncio.wait_for(_guarded_chat(messages, max_tokens), timeout=LLM_TOTAL_TIMEOUT_S)
    except Exception as e:  # timeout, connect error, HTTP error — never 500
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    out = extract_json(content)
    if req.task == "docask":
        # docask 는 JSON 파싱 실패해도 원문 텍스트를 답으로 살린다 — 근거 청크는 라우트가 이미
        # 보여주므로 503 보다 낫다. (qwen3 추론 누출·토큰 절단으로 간헐 파싱 실패하던 문제 대응.)
        if out is not None:
            answer = str(out.get("answer") or "").strip()
            cited = _to_int_list(out.get("citedChunks"))
        else:
            answer, cited = salvage_answer(content), []
        if not answer:
            return {"ok": False, "error": "empty answer"}
        return {"ok": True, "result": {"answer": answer, "citedChunks": cited}}
    if out is None:
        return {"ok": False, "error": "LLM output is not JSON"}
    if req.task in ("extract", "graphextract"):
        return {"ok": True, "result": _norm_extract(out)}
    if req.task == "nlsearch":
        return {"ok": True, "result": {
            "answer": str(out.get("answer") or "").strip(),
            "interpretation": str(out.get("interpretation") or "").strip(),
            "ids": [str(i) for i in out.get("ids") or [] if str(i).strip()],
        }}
    if req.task == "ask":
        answer = str(out.get("answer") or "").strip()
        if not answer:
            return {"ok": False, "error": "empty answer"}
        return {"ok": True, "result": {"answer": answer, "citedRels": _to_int_list(out.get("citedRels"))}}
    opinion = str(out.get("opinion") or "").strip()
    if not opinion:
        return {"ok": False, "error": "empty opinion"}
    return {"ok": True, "result": {"opinion": opinion, "citedChecks": _to_int_list(out.get("citedChecks"))}}


# ---------------------------------------------------------------------------
# /parse — document (PDF) text extraction for ingestion. Stateless: bytes in,
# text/tables out. Engine: docling if installed (scanned-PDF OCR + table
# structure; lazy import like torch), else pypdf (text-layer PDFs only).
# Failures are HTTP 200 {"ok": false, ...} — Next fails that one file, never 500.
# ---------------------------------------------------------------------------

import base64  # noqa: E402
import io  # noqa: E402


class ParseRequest(BaseModel):
    filename: str = ""
    content_base64: str


class ParseResponse(BaseModel):
    ok: bool
    text: str = ""
    tables: list[list[list[str]]] = []  # [table][row][cell]
    pages: int = 0
    engine: str = ""
    error: str = ""


@lru_cache(maxsize=1)
def get_docling_converter():
    # ponytail: docling 미설치가 1차 기본(이미지 +3GB 회피) — 설치돼 있으면 자동 사용.
    from docling.document_converter import DocumentConverter

    return DocumentConverter()


def _parse_docling(filename: str, data: bytes) -> tuple[str, list[list[list[str]]], int]:
    from docling.datamodel.base_models import DocumentStream

    res = get_docling_converter().convert(DocumentStream(name=filename or "upload.pdf", stream=io.BytesIO(data)))
    doc = res.document
    tables: list[list[list[str]]] = []
    for t in getattr(doc, "tables", []) or []:
        try:
            grid = t.data.grid  # TableData.grid: rows of TableCell
            tables.append([[(c.text or "") for c in row] for row in grid])
        except Exception:
            continue  # 표 하나 실패는 격리
    return doc.export_to_markdown(), tables, doc.num_pages()


def _parse_pypdf(data: bytes) -> tuple[str, int]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = [(p.extract_text() or "") for p in reader.pages]
    return "\n".join(pages).strip(), len(reader.pages)


@app.post("/parse", response_model=ParseResponse)
def parse(req: ParseRequest) -> ParseResponse:
    try:
        data = base64.b64decode(req.content_base64, validate=True)
    except Exception:
        return ParseResponse(ok=False, error="invalid base64")
    if not data:
        return ParseResponse(ok=False, error="empty content")
    try:
        text, tables, pages = _parse_docling(req.filename, data)
        return ParseResponse(ok=True, text=text, tables=tables, pages=pages, engine="docling")
    except ImportError:
        pass  # docling 미설치 → pypdf 폴백
    except Exception:
        pass  # docling 이 이 파일에서 실패 → pypdf 재시도
    try:
        text, pages = _parse_pypdf(data)
    except Exception as e:  # 손상 PDF 등 — never 500
        return ParseResponse(ok=False, error=f"{type(e).__name__}: {e}")
    return ParseResponse(ok=True, text=text, tables=[], pages=pages, engine="pypdf")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
