# pyservice — stateless embedding + reasoning sidecar

Multilingual (Korean-capable) 384-dim embeddings over HTTP; no DB, no filesystem. Model: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`.

- Local: `pip install -r requirements.txt` then `uvicorn main:app --port 8000`
- Docker: `docker build -t pyservice .` then `docker run -p 8000:8000 pyservice`
- Endpoints: `GET /health` → `{status,model}`; `POST /embed` `{texts:[...]}` → `{vectors:[[...384 L2-normalized floats...]]}`

## POST /reason

Path-preserving rule reasoning over a request-supplied ontology graph (rdflib triple store; provenance tracked explicitly — every derived edge carries its `via` chain of original edges). Stateless; edges referencing unknown node ids are skipped; empty input → `{"derived": []}`; result capped at 500.

Request:

```json
{ "nodes": [{"id": "LAMP", "type": "item", "label": "헤드램프"}],
  "edges": [{"src": "LAMP", "rel": "CONSISTS_OF", "dst": "HOUSING", "weight": 0.9}] }
```

Response (`weight` optional; derived edges never duplicate original edges):

```json
{ "derived": [{ "src": "LAMP", "rel": "CONSISTS_OF", "dst": "VENT",
                "rule": "consists-transitive",
                "via": ["LAMP→CONSISTS_OF→HOUSING", "HOUSING→CONSISTS_OF→VENT"],
                "confidence": 0.85 }] }
```

Rules:

| rule | derivation | confidence |
|---|---|---|
| `consists-transitive` | `CONSISTS_OF` transitive closure, path depth ≤ 3 | 0.85 |
| `similar-symmetric` | `A—SIMILAR→B` without inverse ⇒ `B—SIMILAR→A` | original `weight`, else 0.7 |
| `failure-propagation` | `parent—CONSISTS_OF→child` + `child—HAS_FAILURE→fm` ⇒ `parent—POTENTIAL_FAILURE→fm` (OWL property chain) | 0.7 |

Tests: `python -m pytest test_reason.py -q` (no embedding model load).
