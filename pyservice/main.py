"""Stateless embedding + reasoning sidecar for SL OntoGround. Request -> result, no DB, no files."""
import os
from collections import defaultdict
from functools import lru_cache
from urllib.parse import quote, unquote

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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
