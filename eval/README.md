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
