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

## POST /llm

In-house vLLM gateway (OpenAI-compatible `/chat/completions`, `<think>` stripped, JSON extracted, temperature 0). Concurrency 1 (asyncio semaphore — vLLM overload guard); total wait+call ceiling 120s. Failures (timeout, non-JSON, vLLM down, unknown task) are **always HTTP 200** `{"ok": false, "error": "..."}` — never 500.

Env: `LLM_BASE_URL` (default `http://vllm-loadbalancer.vllm-cluster.svc.cluster.local/v1`), `LLM_MODEL` (default `qwen3-32b-finance`), `LLM_TIMEOUT_S` (default 90).

### task: nlsearch

```json
{ "task": "nlsearch", "query": "북미 결로", "catalog": "[item] I1=램프 | I2=하우징" }
```

→

```json
{ "ok": true, "result": { "answer": "요약", "interpretation": "조건", "ids": ["I1", "I2"] } }
```

### task: review

```json
{ "task": "review", "condition": "북미 헤드램프 결로",
  "checklist": [{ "no": 1, "title": "벤트 위치", "desc": "하단 벤트 확인", "confidence": 80 }],
  "masterAudit": ["마스터 3.2항 누락"], "contradictions": ["CHECK 1 vs 마스터 상충"] }
```

→ (`citedChecks`는 int로 정규화, `opinion` 비면 `ok:false`)

```json
{ "ok": true, "result": { "opinion": "[CHECK 1] ... 소견 3~5문장", "citedChecks": [1] } }
```

Tests: `python -m pytest test_llm.py -q` (vLLM mocked, no network).
