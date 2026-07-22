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
