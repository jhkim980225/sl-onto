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
    resp = requests.get(f"{cfg.doc_ask_base}/api/sources?canvas={cv}", timeout=30).json()
    files = [s["file"] for s in resp.get("sources", [])]  # /api/sources → {sources:[{file,...}]}
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
