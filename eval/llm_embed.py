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
