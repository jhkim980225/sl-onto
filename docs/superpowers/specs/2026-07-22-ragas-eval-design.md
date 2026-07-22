# RAGAS 평가 자동화 — 설계

> 2026-07-22 · doc-ask(문서 원문 RAG)의 검색·생성 성능을 RAGAS 로 1회성 벤치마크한다.

## 1. 목표와 범위

**목표:** 배포된 `/api/doc-ask` 파이프라인(청킹→임베딩→top-8 검색→qwen3 생성)의 품질을 지표로 수치화한다.
특히 앞서 관찰된 **검색 재현율 약점**("X 전부" 완결 집계에서 청크 누락)을 `context_recall` 로 정량화한다.

**범위(이번):**
- **1회성 벤치마크** — 코드 바뀔 때마다 도는 CI 게이트나 대시보드가 아니다. 한 번 돌려 현황 점수를 얻는다.
- 대상 캔버스: **화장품**(4문서 / 52청크). 골든셋도 이 문서 기준으로 생성한다.
- 지표 5종: `faithfulness` · `answer_relevancy` · `context_precision` · **`context_recall`** · `answer_correctness`.

**비범위:** CI 통합, 시계열 저장, 대시보드 UI, 다중 캔버스 동시 평가, 프로덕션 이미지 편입.

## 2. 제약 (실측 확인됨)

- **텍스트 LLM은 `qwen3-32b-finance` 하나뿐**(vLLM `vllm-loadbalancer`). 전용 RAG/한국어 모델 미배포.
  finance 파인튜닝이나 Qwen3-32B 기반이라 범용·한국어 능력 유지 — 화장품 배터리 12/12 실측. **모델은 env 로 빼서**
  나중에 전용 모델이 뜨면 한 줄 교체한다.
- **vLLM 심판 엔드포인트는 클러스터 내부에서만 접근**(`vllm-loadbalancer.vllm-cluster.svc`). 따라서 평가 코드는
  **클러스터 안(K8s Job)에서 실행**해야 한다.
- **임베딩 = `multilingual-e5-base`**(768dim). e5 는 `query:`/`passage:` 접두어를 요구하지만, RAGAS 내부
  임베딩 호출엔 접두어가 안 붙는다 — 접두어 없는 임베딩이라 품질이 약간 낮으나 벤치마크 일관성엔 영향 없다(§7 주의).
- **생성기·심판이 같은 qwen3** → `answer_correctness` 가 같은 말투를 편애할 수 있다(순환 평가). faithfulness·
  context_recall 은 영향이 적다. 1회성 벤치마크엔 수용한다.

## 3. 실행 방식 — K8s Job (분리)

평가 코드는 프로덕션 이미지와 무관하게 `eval/` 디렉토리에 둔다. `python:3.11-slim` 파드로 ns `sl-ontoground` 에
Job 을 투입해 실행한다 — 이 ns 에서 배포 앱(ClusterIP)과 vLLM 둘 다 접근된다.

```
클러스터 내부 Job (python:3.11-slim)
  ├─ pip install -r eval/requirements.txt   (런타임 ~2분, 1회성이라 수용)
  ├─ /api/doc-ask (앱, 실제 파이프라인)       ← 답변 + 근거 청크 수집
  └─ vLLM /v1 (심판·생성기, ChatOpenAI)       ← RAGAS 판정 (pyservice /llm 세마포어 우회)
```

**왜 심판을 vLLM 에 직접(pyservice `/llm` 아니라):** pyservice `/llm` 은 세마포어 동시 1 이라 평가가 프로덕션
질의를 막는다. RAGAS 는 `ChatOpenAI(base_url=vLLM/v1)` 로 vLLM 에 직접 붙어 우회하고, `max_workers` 로 동시성을
낮춰(예: 3) 공용 vLLM 과부하도 막는다. (단 피시험 대상인 답변 생성은 실제 경로 `/api/doc-ask` 를 그대로 탄다.)

## 4. 디렉토리 구조

```
eval/
  README.md              실행법 (kubectl apply → 로그 확인)
  requirements.txt       ragas==0.2.* · langchain-openai · langchain-huggingface · datasets · sentence-transformers · requests
  config.py              env 로 주입: DOC_ASK_BASE · VLLM_BASE · LLM_MODEL · EMBED_MODEL · CANVAS
  llm_embed.py           qwen3(ChatOpenAI)·e5(HuggingFaceEmbeddings) 래퍼 조립 — gen/eval 공용
  gen_testset.py         화장품 문서 → RAGAS TestsetGenerator → golden_화장품.jsonl
  ragas_eval.py          골든셋 + /api/doc-ask → EvaluationDataset → evaluate() → 리포트
  golden_화장품.jsonl    (생성물) {question, ground_truth, reference_contexts}
  reports/               (생성물) ragas-YYYYMMDD.md · .csv
  k8s/
    gen-job.yaml         테스트셋 생성 Job
    eval-job.yaml        평가 Job
```

## 5. 데이터 흐름

**[1] 테스트셋 생성 (`gen_testset.py`)**
1. 화장품 4문서의 원문을 `GET /api/source-text?file=&canvas=화장품` 로 받아 langchain `Document` 로 만든다
   (문서당 1개, 메타에 파일명). — 청크가 아니라 문서 전체를 준다(TestsetGenerator 가 자체적으로 쪼갠다).
2. `TestsetGenerator(llm=qwen3, embedding_model=e5)` 로 `testset_size≈15` 생성.
   query 분포: 단일홉 구체(`single_hop_specific`) 다수 + 멀티홉 추상(`multi_hop_abstract`) 소수.
3. 결과를 `golden_화장품.jsonl` 로 저장 — 각 행 `{question, ground_truth, reference_contexts}`.

**[2] 사람 리뷰(권장):** 생성 품질이 qwen3 한계로 들쭉날쭉 → 이상한 문항을 골든셋에서 제거(15→12~13 채택).
건너뛰고 [1]→[3] 자동도 가능하나 한 번 훑기를 권장한다.

**[3] 평가 (`ragas_eval.py`)**
1. `golden_화장품.jsonl` 로드.
2. 각 질문 → `POST /api/doc-ask?canvas=화장품` → `{answer, chunks[]}` 수집. `chunks[].text` 가 검색된 컨텍스트.
3. RAGAS `EvaluationDataset` 조립:
   `user_input=question` · `response=answer` · `retrieved_contexts=[chunk.text…]` · `reference=ground_truth`.
4. `evaluate(dataset, metrics=[faithfulness, answer_relevancy, context_precision, context_recall,
   answer_correctness], llm=qwen3, embeddings=e5, run_config=RunConfig(max_workers=3))`.
5. 리포트 출력: `reports/ragas-<date>.md`(지표별 평균 + 문항별 표) · `.csv`(원자료).

## 6. 인터페이스 (경계)

- **config.py** — 단일 설정 진입점. 전부 env, 기본값은 운영 클러스터 내부 주소.
  `DOC_ASK_BASE=http://sl-ontoground.sl-ontoground:8000` · `VLLM_BASE=http://vllm-loadbalancer.vllm-cluster.svc.cluster.local/v1`
  · `LLM_MODEL=qwen3-32b-finance` · `EMBED_MODEL=intfloat/multilingual-e5-base` · `CANVAS=화장품`.
- **llm_embed.py** — `get_llm()`·`get_embeddings()` 반환(RAGAS 용 래퍼). gen/eval 이 공유해 모델 배선 중복 제거.
- **gen_testset.py / ragas_eval.py** — 각각 독립 실행 스크립트. 서로를 import 하지 않고 `golden_화장품.jsonl`
  파일로만 연결(느슨한 결합 — [1]과 [3]을 따로 재실행 가능).

## 7. 오류 처리·주의

- **doc-ask 실패(503 등):** 해당 문항은 `response=""`·에러 기록하고 스킵 카운트에 넣는다(전체 평가는 계속). 리포트에
  "N/M 문항 응답 실패" 명시 — 조용한 누락 금지.
- **TestsetGenerator 산출물 깨짐:** JSON 파싱 실패 행은 버리고 로그에 남긴다. 목표 수에 미달하면 그대로 진행(경고).
- **e5 접두어 부재:** RAGAS 임베딩 호출은 접두어 없이 나간다. 벤치마크 내부 일관성엔 무해하나, 절대 점수를
  프로덕션 검색(접두어 있음)과 1:1로 등치하지 않는다 — 리포트에 이 한계를 적는다.
- **vLLM 과부하:** `max_workers=3` 로 동시성 제한. 그래도 느리면 낮춘다. 평가는 프로덕션 한가할 때 돌린다.
- **재현성:** 리포트에 모델·임베딩·top-k·문항수·날짜를 헤더로 박는다(나중 비교 기준).

## 8. 검증(완료 기준)

- `gen_testset.py` 가 `golden_화장품.jsonl` 에 유효 문항 ≥10 을 쓴다.
- `ragas_eval.py` 가 5지표 평균 + 문항별 표를 `reports/` 에 남기고, 응답 실패 수를 함께 보고한다.
- Job 이 클러스터에서 완료(exit 0)하고 로그로 리포트 경로·요약을 출력한다.
- 최소 1개 지표(특히 `context_recall`)가 "X 전부" 유형 문항에서 낮게 나와 알려진 약점을 재현하는지 확인(정성).

## 9. 이후(비범위, 참고)

전용 RAG/한국어 모델 배포 시 `LLM_MODEL` env 교체 후 재실행. CI 게이트·시계열은 별도 스펙.
top-k 동적화·rerank 는 RAG 개선 스펙(`docs/superpowers/specs/2026-07-22-graph-perf-notes.md` 유보 항목과 별개).
