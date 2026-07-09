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

MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"  # 384-dim, Korean-capable

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
    raise ValueError(f"unknown task: {req.task}")


async def _chat(messages: list[dict]) -> str:
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT_S) as client:
        res = await client.post(
            f"{LLM_BASE_URL}/chat/completions",
            json={"model": LLM_MODEL, "max_tokens": 400, "temperature": 0, "messages": messages},
        )
        res.raise_for_status()
        return res.json()["choices"][0]["message"]["content"]


async def _guarded_chat(messages: list[dict]) -> str:
    async with _llm_sem:
        return await _chat(messages)


def _to_int_list(v) -> list[int]:
    out = []
    for x in v if isinstance(v, list) else []:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


@app.post("/llm")
async def llm(req: LLMRequest) -> dict:
    try:
        messages = _messages(req)
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    try:
        content = await asyncio.wait_for(_guarded_chat(messages), timeout=LLM_TOTAL_TIMEOUT_S)
    except Exception as e:  # timeout, connect error, HTTP error — never 500
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    out = extract_json(content)
    if out is None:
        return {"ok": False, "error": "LLM output is not JSON"}
    if req.task == "nlsearch":
        return {"ok": True, "result": {
            "answer": str(out.get("answer") or "").strip(),
            "interpretation": str(out.get("interpretation") or "").strip(),
            "ids": [str(i) for i in out.get("ids") or [] if str(i).strip()],
        }}
    opinion = str(out.get("opinion") or "").strip()
    if not opinion:
        return {"ok": False, "error": "empty opinion"}
    return {"ok": True, "result": {"opinion": opinion, "citedChecks": _to_int_list(out.get("citedChecks"))}}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
