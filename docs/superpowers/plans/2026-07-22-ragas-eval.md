# RAGAS 평가 자동화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** doc-ask(문서 원문 RAG)를 RAGAS 5지표로 1회성 벤치마크하는 `eval/` 도구와 클러스터 실행 Job 을 만든다.

**Architecture:** 프로덕션 이미지와 분리된 `eval/` Python 도구. 테스트셋은 RAGAS TestsetGenerator 로 자동 생성(qwen3+e5), 평가는 배포 `/api/doc-ask` 에서 답변·컨텍스트를 모아 RAGAS `evaluate()` 로 채점. vLLM 심판은 클러스터 내부에서만 닿으므로 K8s Job 으로 실행한다.

**Tech Stack:** Python 3.11 · RAGAS 0.2.x · langchain-openai(vLLM /v1) · sentence-transformers(multilingual-e5-base) · requests · K8s Job

## Global Constraints

- **모델 env 설정화:** `LLM_MODEL` 기본 `qwen3-32b-finance`(현재 유일 텍스트 모델). 코드에 하드코딩 금지.
- **주소 env:** `DOC_ASK_BASE=http://sl-ontoground.sl-ontoground`(Service 포트 80→컨테이너 8000) · `VLLM_BASE=http://vllm-loadbalancer.vllm-cluster.svc.cluster.local/v1` · `EMBED_MODEL=intfloat/multilingual-e5-base` · `CANVAS=화장품`.
- **프로덕션 무관:** `eval/` 는 앱/pyservice 이미지에 안 들어간다. 별도 K8s Job.
- **심판=vLLM 직접**(pyservice `/llm` 세마포어 우회), `RunConfig(max_workers=3)` 로 동시성 제한.
- **e5 접두어 부재 한계:** RAGAS 임베딩엔 `query:`/`passage:` 접두어가 안 붙는다 — 벤치마크 내부 일관성엔 무해, 절대점수를 프로덕션 검색과 등치 금지(리포트에 명시).
- **RAGAS 버전 핀:** `ragas==0.2.14`. `to_pandas()` 컬럼(`user_input`·`reference_contexts`·`reference`)이 다르면 버전 확인.
- **테스트:** 순수 헬퍼(config·jsonl io·샘플 조립·리포트 포맷)는 `assert` 기반 `_selftest()` 로 `python <file>.py` 실행 시 자체 검증(프레임워크 없음). LLM/생성/평가는 Job 실행으로 통합 검증.
- **설계:** `docs/superpowers/specs/2026-07-22-ragas-eval-design.md`.

---

## File Structure

**신규**

| 파일 | 책임 |
|---|---|
| `eval/config.py` | env → 설정 dataclass(기본값 포함). 순수. |
| `eval/llm_embed.py` | qwen3(ChatOpenAI)·e5(HuggingFaceEmbeddings) → RAGAS 래퍼. gen/eval 공용. |
| `eval/jsonlio.py` | 골든셋 jsonl 읽기/쓰기. 순수. |
| `eval/gen_testset.py` | source-text → Documents → TestsetGenerator → 골든셋 jsonl. |
| `eval/ragas_eval.py` | 골든셋 + doc-ask → EvaluationDataset → evaluate() → 리포트. |
| `eval/report.py` | 점수·문항표 → markdown 문자열. 순수. |
| `eval/requirements.txt` | 의존성 핀. |
| `eval/README.md` | 실행법. |
| `eval/k8s/gen-job.yaml` | 테스트셋 생성 Job. |
| `eval/k8s/eval-job.yaml` | 평가 Job. |
| `eval/.dockerignore` 불필요 — Job 은 python:3.11-slim + pip, 소스는 ConfigMap/gitclone 대신 SFTP 마운트(§Task 5). |

**생성물(런타임):** `eval/golden_화장품.jsonl` · `eval/reports/ragas-<date>.{md,csv}`

---

## Task 1: 설정 + jsonl IO (순수 헬퍼)

**Files:**
- Create: `eval/config.py`, `eval/jsonlio.py`, `eval/requirements.txt`

**Interfaces:**
- Produces:
  - `config.load() -> Config` — dataclass 필드: `doc_ask_base, vllm_base, llm_model, embed_model, canvas`
  - `jsonlio.write(path: str, rows: list[dict]) -> None` / `jsonlio.read(path: str) -> list[dict]`

- [ ] **Step 1: requirements.txt 작성**

`eval/requirements.txt`:
```
ragas==0.2.14
langchain-openai==0.2.14
langchain-huggingface==0.1.2
sentence-transformers==3.3.1
datasets==3.2.0
requests==2.32.3
pandas==2.2.3
```

- [ ] **Step 2: config.py 작성 (selftest 포함)**

`eval/config.py`:
```python
# eval/config.py — env → 설정. 전부 env, 기본값은 운영 클러스터 내부 주소.
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    doc_ask_base: str
    vllm_base: str
    llm_model: str
    embed_model: str
    canvas: str


def load() -> Config:
    return Config(
        doc_ask_base=os.environ.get("DOC_ASK_BASE", "http://sl-ontoground.sl-ontoground"),
        vllm_base=os.environ.get("VLLM_BASE", "http://vllm-loadbalancer.vllm-cluster.svc.cluster.local/v1"),
        llm_model=os.environ.get("LLM_MODEL", "qwen3-32b-finance"),
        embed_model=os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-base"),
        canvas=os.environ.get("CANVAS", "화장품"),
    )


def _selftest():
    c = load()
    assert c.llm_model, "llm_model 비어있음"
    assert c.doc_ask_base.startswith("http"), c.doc_ask_base
    os.environ["LLM_MODEL"] = "test-model"
    assert load().llm_model == "test-model", "env override 안 됨"
    print("config selftest OK")


if __name__ == "__main__":
    _selftest()
```

- [ ] **Step 3: jsonlio.py 작성 (selftest 포함)**

`eval/jsonlio.py`:
```python
# eval/jsonlio.py — 골든셋 jsonl 읽기/쓰기. 순수.
import json


def write(path: str, rows: list[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def read(path: str) -> list[dict]:
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def _selftest():
    import tempfile, os
    rows = [{"question": "배합한도?", "ground_truth": "1.0%", "reference_contexts": ["a", "b"]}]
    p = os.path.join(tempfile.gettempdir(), "gold_test.jsonl")
    write(p, rows)
    back = read(p)
    assert back == rows, back
    print("jsonlio selftest OK")


if __name__ == "__main__":
    _selftest()
```

- [ ] **Step 4: selftest 실행**

Run: `python eval/config.py && python eval/jsonlio.py`
Expected: `config selftest OK` · `jsonlio selftest OK`

- [ ] **Step 5: 커밋**

```bash
git add eval/config.py eval/jsonlio.py eval/requirements.txt
git commit -m "feat(eval): RAGAS 평가 설정·jsonl IO 헬퍼"
```

---

## Task 2: LLM·임베딩 래퍼

**Files:**
- Create: `eval/llm_embed.py`

**Interfaces:**
- Consumes: `config.Config` (Task 1)
- Produces:
  - `get_llm(cfg) -> LangchainLLMWrapper` — RAGAS 용 qwen3 심판/생성기
  - `get_embeddings(cfg) -> LangchainEmbeddingsWrapper` — RAGAS 용 e5

- [ ] **Step 1: llm_embed.py 작성**

`eval/llm_embed.py`:
```python
# eval/llm_embed.py — qwen3(vLLM /v1)·e5(로컬 sentence-transformers)를 RAGAS 래퍼로 조립.
# gen_testset·ragas_eval 이 공유해 모델 배선 중복을 없앤다.
from ragas.llms import LangchainLLMWrapper
from ragas.embeddings import LangchainEmbeddingsWrapper
from langchain_openai import ChatOpenAI
from langchain_huggingface import HuggingFaceEmbeddings
from config import Config


def get_llm(cfg: Config) -> LangchainLLMWrapper:
    # vLLM 은 OpenAI 호환 — api_key 는 임의값. temperature 0 으로 판정 재현성 확보.
    chat = ChatOpenAI(
        model=cfg.llm_model,
        base_url=cfg.vllm_base,
        api_key="EMPTY",
        temperature=0,
        timeout=120,
        max_retries=1,
    )
    return LangchainLLMWrapper(chat)


def get_embeddings(cfg: Config) -> LangchainEmbeddingsWrapper:
    # e5 접두어(query:/passage:)는 붙지 않는다(설계 §7 한계). normalize 로 코사인 일관성만 확보.
    # 주의: HuggingFaceEmbeddings 는 첫 호출에 HF 허브에서 e5-base(~1GB)를 내려받는다 — 파드 egress 필요.
    # (pyservice v8/v9 이미지 빌드가 같은 방식으로 다운로드 성공 → 클러스터 egress 확인됨.)
    # egress 없으면: pyservice /embed 를 부르는 커스텀 BaseRagasEmbeddings 로 교체(폴백).
    hf = HuggingFaceEmbeddings(
        model_name=cfg.embed_model,
        encode_kwargs={"normalize_embeddings": True},
    )
    return LangchainEmbeddingsWrapper(hf)
```

- [ ] **Step 2: import 검증 (네트워크 없이 구성만)**

Run: `cd eval && python -c "import config, llm_embed; print('import OK')"`
Expected: `import OK` (의존성 설치된 환경에서. 로컬에 없으면 이 단계는 Job 런타임에 검증 — 그 경우 로그에 메모).

- [ ] **Step 3: 커밋**

```bash
git add eval/llm_embed.py
git commit -m "feat(eval): qwen3·e5 RAGAS 래퍼"
```

---

## Task 3: 테스트셋 생성

**Files:**
- Create: `eval/gen_testset.py`

**Interfaces:**
- Consumes: `config.load`, `llm_embed.get_llm/get_embeddings`, `jsonlio.write`, `GET /api/source-text`
- Produces: `eval/golden_화장품.jsonl` — 각 행 `{question, ground_truth, reference_contexts}`

- [ ] **Step 1: source-text 수집 헬퍼 + 문서 조립**

`eval/gen_testset.py` (앞부분):
```python
# eval/gen_testset.py — 화장품 문서 → RAGAS TestsetGenerator → 골든셋 jsonl.
# 실행: 클러스터 내 Job(§k8s/gen-job.yaml). 로컬은 vLLM 접근 불가.
import sys
import urllib.parse
import requests
from langchain_core.documents import Document
from ragas.testset import TestsetGenerator

import config
import llm_embed
import jsonlio

TESTSET_SIZE = int(__import__("os").environ.get("TESTSET_SIZE", "15"))
GOLDEN_PATH = "golden_화장품.jsonl"


def fetch_documents(cfg: config.Config) -> list[Document]:
    """캔버스 문서 목록(/api/sources) → 각 문서 원문(/api/source-text) → langchain Document."""
    cv = urllib.parse.quote(cfg.canvas)
    srcs = requests.get(f"{cfg.doc_ask_base}/api/sources?canvas={cv}", timeout=30).json()
    files = [s["file"] for s in srcs]
    docs: list[Document] = []
    for f in files:
        fq = urllib.parse.quote(f)
        r = requests.get(f"{cfg.doc_ask_base}/api/source-text?file={fq}&canvas={cv}", timeout=30)
        if not r.ok:
            print(f"[warn] source-text 실패({r.status_code}): {f}", file=sys.stderr)
            continue
        data = r.json()  # {file, format, blocks:[{label, lines[]}]}
        text = "\n".join(
            f"[{b['label']}]\n" + "\n".join(b.get("lines", []))
            for b in data.get("blocks", [])
        ).strip()
        if text:
            docs.append(Document(page_content=text, metadata={"filename": f}))
    return docs
```

- [ ] **Step 2: 생성·저장 본문**

`eval/gen_testset.py` (이어서):
```python
def main():
    cfg = config.load()
    docs = fetch_documents(cfg)
    print(f"[gen] 문서 {len(docs)}개 로드")
    if not docs:
        print("[gen] 문서 0개 — 중단", file=sys.stderr)
        sys.exit(1)

    generator = TestsetGenerator(llm=llm_embed.get_llm(cfg), embedding_model=llm_embed.get_embeddings(cfg))
    dataset = generator.generate_with_langchain_docs(docs, testset_size=TESTSET_SIZE)
    df = dataset.to_pandas()  # 컬럼: user_input, reference_contexts, reference, synthesizer_name

    rows = []
    for _, r in df.iterrows():
        q = str(r.get("user_input") or "").strip()
        gt = str(r.get("reference") or "").strip()
        ctxs = list(r.get("reference_contexts") or [])
        if not q or not gt:
            continue  # 깨진 생성물 폐기(qwen3 한계)
        rows.append({"question": q, "ground_truth": gt, "reference_contexts": ctxs})

    jsonlio.write(GOLDEN_PATH, rows)
    print(f"[gen] 골든셋 {len(rows)}/{len(df)} 유효 문항 → {GOLDEN_PATH}")
    if len(rows) < 10:
        print(f"[gen][warn] 유효 문항 {len(rows)} < 10 — 생성 품질 확인 필요", file=sys.stderr)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 문법·import 검증**

Run: `cd eval && python -c "import ast; ast.parse(open('gen_testset.py',encoding='utf-8').read()); print('syntax OK')"`
Expected: `syntax OK`

- [ ] **Step 4: 커밋**

```bash
git add eval/gen_testset.py
git commit -m "feat(eval): TestsetGenerator 로 골든셋 자동 생성"
```

---

## Task 4: 평가 + 리포트

**Files:**
- Create: `eval/report.py`, `eval/ragas_eval.py`

**Interfaces:**
- Consumes: `config.load`, `llm_embed.*`, `jsonlio.read`, `POST /api/doc-ask`
- Produces: `eval/reports/ragas-<date>.md` · `.csv`

- [ ] **Step 1: report.py 작성 (selftest 포함)**

`eval/report.py`:
```python
# eval/report.py — 지표 평균 + 문항별 표 → markdown. 순수(포맷만).
METRIC_ORDER = ["faithfulness", "answer_relevancy", "context_precision", "context_recall", "answer_correctness"]


def format_report(header: dict, means: dict, rows: list[dict], failed: int) -> str:
    lines = ["# RAGAS 평가 리포트", ""]
    for k, v in header.items():
        lines.append(f"- **{k}**: {v}")
    lines.append(f"- **응답 실패**: {failed}/{failed + len(rows)}")
    lines += ["", "## 지표 평균", "", "| 지표 | 평균 |", "|---|---|"]
    for m in METRIC_ORDER:
        if m in means:
            lines.append(f"| {m} | {means[m]:.3f} |")
    lines += ["", "> e5 접두어 부재로 절대점수를 프로덕션 검색과 1:1 등치하지 말 것(설계 §7).", ""]
    lines += ["## 문항별", "", "| # | 질문 | " + " | ".join(METRIC_ORDER) + " |",
              "|---|---|" + "---|" * len(METRIC_ORDER)]
    for i, r in enumerate(rows):
        cells = " | ".join(f"{r.get(m):.2f}" if isinstance(r.get(m), (int, float)) else "-" for m in METRIC_ORDER)
        q = str(r.get("question", ""))[:40].replace("|", "/")
        lines.append(f"| {i + 1} | {q} | {cells} |")
    return "\n".join(lines) + "\n"


def _selftest():
    md = format_report(
        {"model": "qwen3", "date": "2026-07-22"},
        {"faithfulness": 0.812, "context_recall": 0.66},
        [{"question": "배합한도?", "faithfulness": 0.9, "context_recall": 0.5}],
        failed=1,
    )
    assert "지표 평균" in md and "0.812" in md and "응답 실패**: 1/2" in md, md
    print("report selftest OK")


if __name__ == "__main__":
    _selftest()
```

- [ ] **Step 2: report selftest 실행**

Run: `python eval/report.py`
Expected: `report selftest OK`

- [ ] **Step 3: ragas_eval.py 작성**

`eval/ragas_eval.py`:
```python
# eval/ragas_eval.py — 골든셋 + /api/doc-ask → RAGAS evaluate() → 리포트.
# 실행: 클러스터 내 Job(§k8s/eval-job.yaml).
import os
import sys
import urllib.parse
import requests
import pandas as pd
from ragas import evaluate, EvaluationDataset
from ragas.run_config import RunConfig
from ragas.metrics import faithfulness, answer_relevancy, context_precision, context_recall, answer_correctness

import config
import llm_embed
import jsonlio
import report

GOLDEN_PATH = os.environ.get("GOLDEN_PATH", "golden_화장품.jsonl")
DATE = os.environ.get("REPORT_DATE", "unknown")  # Job 이 주입(스크립트는 시계 안 씀)
METRICS = [faithfulness, answer_relevancy, context_precision, context_recall, answer_correctness]


def collect(cfg: config.Config, golden: list[dict]):
    """각 질문 → /api/doc-ask → 샘플. 실패 문항은 스킵하고 카운트."""
    cv = urllib.parse.quote(cfg.canvas)
    samples, failed = [], 0
    for g in golden:
        try:
            r = requests.post(
                f"{cfg.doc_ask_base}/api/doc-ask?canvas={cv}",
                json={"question": g["question"]},
                timeout=200,
            )
            d = r.json()
            if not (r.ok and d.get("ok")):
                failed += 1
                print(f"[eval][fail] {g['question'][:30]} → {r.status_code} {d.get('error','')}", file=sys.stderr)
                continue
            samples.append({
                "user_input": g["question"],
                "response": d.get("answer") or "",
                "retrieved_contexts": [c["text"] for c in d.get("chunks", [])],
                "reference": g["ground_truth"],
            })
        except Exception as e:
            failed += 1
            print(f"[eval][exc] {g['question'][:30]} → {type(e).__name__}", file=sys.stderr)
    return samples, failed


def main():
    cfg = config.load()
    golden = jsonlio.read(GOLDEN_PATH)
    print(f"[eval] 골든셋 {len(golden)}문항")
    samples, failed = collect(cfg, golden)
    print(f"[eval] 응답 수집 {len(samples)} / 실패 {failed}")
    if not samples:
        print("[eval] 유효 샘플 0 — 중단", file=sys.stderr)
        sys.exit(1)

    ds = EvaluationDataset.from_list(samples)
    result = evaluate(
        ds, metrics=METRICS,
        llm=llm_embed.get_llm(cfg), embeddings=llm_embed.get_embeddings(cfg),
        run_config=RunConfig(max_workers=3),
    )
    df = result.to_pandas()

    means = {m: float(df[m].mean()) for m in report.METRIC_ORDER if m in df.columns}
    rows = []
    for _, r in df.iterrows():
        row = {"question": r.get("user_input", "")}
        for m in report.METRIC_ORDER:
            if m in df.columns:
                row[m] = r.get(m)
        rows.append(row)

    os.makedirs("reports", exist_ok=True)
    header = {"model": cfg.llm_model, "embed": cfg.embed_model, "canvas": cfg.canvas,
              "top_k": 8, "문항수": len(samples), "date": DATE}
    md = report.format_report(header, means, rows, failed)
    with open(f"reports/ragas-{DATE}.md", "w", encoding="utf-8") as f:
        f.write(md)
    df.to_csv(f"reports/ragas-{DATE}.csv", index=False)
    print(md)
    print(f"[eval] 리포트 → reports/ragas-{DATE}.md")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 문법 검증**

Run: `cd eval && python -c "import ast; [ast.parse(open(f,encoding='utf-8').read()) for f in ['ragas_eval.py']]; print('syntax OK')"`
Expected: `syntax OK`

- [ ] **Step 5: 커밋**

```bash
git add eval/report.py eval/ragas_eval.py
git commit -m "feat(eval): doc-ask 수집 + RAGAS evaluate + 리포트"
```

---

## Task 5: K8s Job + README

배포 앱과 달리 `eval/` 는 이미지가 없다. `python:3.11-slim` 파드에 소스를 **SFTP 로 마스터에 올려 hostPath 로 마운트**하기보다, 간단히 **소스를 tar 로 ConfigMap 화하긴 큼** → 대신 **Job initContainer 가 소스를 받도록** 하지 않고, 가장 단순하게: 마스터에서 `eval/` 를 파드에 `kubectl cp` 로 넣고 실행하는 절차를 README 로 문서화한다(1회성이라 이 방식이 가볍다).

**Files:**
- Create: `eval/k8s/gen-job.yaml`, `eval/k8s/eval-job.yaml`, `eval/README.md`

**Interfaces:** 없음(운영 절차)

- [ ] **Step 1: gen-job.yaml**

`eval/k8s/gen-job.yaml`:
```yaml
# 테스트셋 생성 Job — sleep 무한 파드로 띄우고 kubectl cp 후 exec 로 실행(README 절차).
apiVersion: batch/v1
kind: Job
metadata:
  name: ragas-gen
  namespace: sl-ontoground
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: gen
          image: python:3.11-slim
          workingDir: /eval
          command: ["bash", "-lc", "sleep 36000"]  # cp 대기용 — README 절차로 pip+실행
          env:
            - { name: DOC_ASK_BASE, value: "http://sl-ontoground.sl-ontoground" }
            - { name: VLLM_BASE, value: "http://vllm-loadbalancer.vllm-cluster.svc.cluster.local/v1" }
            - { name: LLM_MODEL, value: "qwen3-32b-finance" }
            - { name: EMBED_MODEL, value: "intfloat/multilingual-e5-base" }
            - { name: CANVAS, value: "화장품" }
            - { name: TESTSET_SIZE, value: "15" }
          resources:
            limits: { memory: "4Gi", cpu: "2" }
```

- [ ] **Step 2: eval-job.yaml**

`eval/k8s/eval-job.yaml`: gen-job.yaml 과 동일 구조, `metadata.name: ragas-eval`, `containers[0].name: eval`, env 에 `REPORT_DATE`·`GOLDEN_PATH` 추가:
```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: ragas-eval
  namespace: sl-ontoground
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: eval
          image: python:3.11-slim
          workingDir: /eval
          command: ["bash", "-lc", "sleep 36000"]
          env:
            - { name: DOC_ASK_BASE, value: "http://sl-ontoground.sl-ontoground" }
            - { name: VLLM_BASE, value: "http://vllm-loadbalancer.vllm-cluster.svc.cluster.local/v1" }
            - { name: LLM_MODEL, value: "qwen3-32b-finance" }
            - { name: EMBED_MODEL, value: "intfloat/multilingual-e5-base" }
            - { name: CANVAS, value: "화장품" }
            - { name: GOLDEN_PATH, value: "golden_화장품.jsonl" }
            - { name: REPORT_DATE, value: "20260722" }
          resources:
            limits: { memory: "4Gi", cpu: "2" }
```

- [ ] **Step 3: README.md — 실행 절차**

`eval/README.md`:
```markdown
# RAGAS 평가 (1회성 벤치마크)

설계: `docs/superpowers/specs/2026-07-22-ragas-eval-design.md`

vLLM 심판이 클러스터 내부에서만 닿으므로 **파드 안에서** 실행한다. 파드를 sleep 로 띄우고
소스를 `kubectl cp` 로 넣은 뒤 pip 설치·실행한다(1회성이라 이미지 빌드 생략).

## [1] 테스트셋 생성
```bash
kubectl apply -f eval/k8s/gen-job.yaml
POD=$(kubectl -n sl-ontoground get pod -l job-name=ragas-gen -o name)
kubectl -n sl-ontoground cp eval "${POD#pod/}:/eval"
kubectl -n sl-ontoground exec $POD -- bash -lc "cd /eval && pip -q install -r requirements.txt && python gen_testset.py"
kubectl -n sl-ontoground cp "${POD#pod/}:/eval/golden_화장품.jsonl" eval/golden_화장품.jsonl
kubectl delete -f eval/k8s/gen-job.yaml
```

## [2] 리뷰(권장)
`eval/golden_화장품.jsonl` 을 열어 이상한 문항 제거(qwen3 생성 품질 한계).

## [3] 평가
```bash
kubectl apply -f eval/k8s/eval-job.yaml
POD=$(kubectl -n sl-ontoground get pod -l job-name=ragas-eval -o name)
kubectl -n sl-ontoground cp eval "${POD#pod/}:/eval"   # 리뷰한 골든셋 포함
kubectl -n sl-ontoground exec $POD -- bash -lc "cd /eval && pip -q install -r requirements.txt && python ragas_eval.py"
kubectl -n sl-ontoground cp "${POD#pod/}:/eval/reports" eval/reports
kubectl delete -f eval/k8s/eval-job.yaml
```

리포트: `eval/reports/ragas-<date>.md`
```

- [ ] **Step 4: yaml 문법 검증**

Run: `python -c "import yaml,glob; [yaml.safe_load(open(f,encoding='utf-8')) for f in glob.glob('eval/k8s/*.yaml')]; print('yaml OK')"`
Expected: `yaml OK` (PyYAML 있으면. 없으면 `kubectl apply --dry-run=client -f eval/k8s/gen-job.yaml` 로 대체)

- [ ] **Step 5: 커밋**

```bash
git add eval/k8s/gen-job.yaml eval/k8s/eval-job.yaml eval/README.md
git commit -m "feat(eval): K8s Job 매니페스트 + 실행 절차"
```

---

## Task 6: 테스트셋 생성 실행 (운영)

**Files:** 없음(실행)

- [ ] **Step 1: gen Job 실행 + 골든셋 회수**

README [1] 절차 실행. 로그에 `[gen] 골든셋 N/15 유효 문항` 확인.
Expected: `eval/golden_화장품.jsonl` 에 유효 문항 ≥10.

- [ ] **Step 2: 골든셋 육안 리뷰**

`eval/golden_화장품.jsonl` 열어 화장품 문서와 무관하거나 깨진 문항 제거. 남은 수 기록.

- [ ] **Step 3: 커밋(리뷰한 골든셋)**

```bash
git add eval/golden_화장품.jsonl
git commit -m "chore(eval): 화장품 골든셋 생성·리뷰"
```

---

## Task 7: 평가 실행 + 리포트 (운영)

**Files:** 없음(실행)

- [ ] **Step 1: eval Job 실행 + 리포트 회수**

README [3] 절차 실행. 로그에 지표 평균표 출력 확인.
Expected: `eval/reports/ragas-<date>.md`·`.csv` 생성, `응답 실패 N/M` 명시.

- [ ] **Step 2: 약점 재현 확인(정성)**

`context_recall` 이 "X 전부" 유형 문항에서 낮게 나오는지 확인 — 알려진 검색 재현율 약점 재현.

- [ ] **Step 3: 커밋(리포트)**

```bash
git add eval/reports/
git commit -m "chore(eval): RAGAS 벤치마크 1회차 리포트"
```

---

## 최종 검증 (전체 완료 후)

- [ ] `python eval/config.py && python eval/jsonlio.py && python eval/report.py` → 3개 selftest OK
- [ ] `eval/golden_화장품.jsonl` 유효 문항 ≥10
- [ ] `eval/reports/ragas-<date>.md` 에 5지표 평균 + 문항별 표 + 응답 실패 수
- [ ] 리포트 헤더에 모델·임베딩·top-k·문항수·날짜 기록
- [ ] `eval/` 가 프로덕션 이미지(앱·pyservice)에 안 들어감(별도 Job 만)
