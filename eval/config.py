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
