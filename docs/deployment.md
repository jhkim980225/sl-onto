# deployment.md — 배포

Next.js `output:'standalone'` 단일 컨테이너. 어떤 회사 클라우드든 이미지 하나로 배포한다.

## 로컬 빌드·실행
```bash
npm ci
npm run build          # .next/standalone 생성 (data/sources 트레이싱 포함)
node .next/standalone/server.js   # PORT 미지정 시 3000
```

## Docker
```bash
docker build -t sl-ontoground .
docker run -p 8000:8000 sl-ontoground
# http://localhost:8000
```
- `$PORT` 주입 대응(없으면 8000), `HOSTNAME=0.0.0.0` 바인딩.
- 무상태: 인메모리 온톨로지를 기동 시 `data/sources` 인제스천으로 재구축 → 볼륨/DB 불필요.

## 회사 클라우드
이미지를 사내 레지스트리에 푸시 후 컨테이너 서비스에 배포:
- **Cloud Run / ACA / App Service**: 이미지 지정, 포트=컨테이너 `$PORT`.
- **ECS / K8s**: Deployment + Service, `containerPort` 매핑, 필요 시 HPA.

## FEDA 클러스터 실제 배포 기록 (배포 완료 · 현재 v27)
- v25: 샘플 인제스천 개편 — 매 클릭 새 현장보고(차수 증가)로 결로·습기(FMFOG)에 정확히 3개 노드
  (부품·원인·조치) 부착, "이미 반영됨" 케이스 제거, 완료 시 결로·습기 자동 포커스.
- v26: 노드 삭제 후 직전 탐색 항목 자동 복귀(포커스·인스펙터 유지).
- v27: 포커스 종류별 캡에서 신규(fresh) 노드 최우선 — 인제스천 직후 새 노드 3개가 잘려 1개로 보이던 문제 수정.
- v28~v29(현재): FMEA 초안 다운로드 클릭 → **취약점 분석 리포트(이미지) 모달** → 모달 내 다운로드 버튼으로
  xlsx 다운로드. 이미지는 `public/vuln-analysis.png`(원본 `data/도면취약점.png`) — standalone 은 public/ 을
  자동 포함하지 않으므로 **Dockerfile 에 `COPY /app/public ./public` 필수**(v29 에서 수정).
- 대상: FEDA K8s (fedamaster1 192.168.0.100, Rocky 9.7, v1.30.14, containerd, 워커 12+).
- 접속(배포용): 파이썬 paramiko SSH `feda@192.168.0.100` (kubectl=admin, docker 그룹).
- 절차: 소스 SFTP → `~/sl-ontoground` → `docker build` → 레지스트리 push → `kubectl apply`.
- **레지스트리: `192.168.0.100:5000`** — 노드별 containerd `certs.d` 신뢰가 **클러스터 전역**인 레지스트리를 써야 함.
  `:5001`은 일부 워커(03/04)만 신뢰 → 다른 워커에 스케줄되면 `ImagePullBackOff`(HTTP→HTTPS 오류). 따라서 **`:5000` 고정**.
- 리소스: ns `sl-ontoground`, Deployment 2 replica(무상태), Service NodePort **30494** → 8000.
- **접속: `http://192.168.0.100:30494/`** (사내망).
- **현재 배포 = v48 (2026-07-08, pyservice v3)** — v48: pyservice `/llm`(vLLM 게이트웨이,
  qwen3-32b-finance, 동시 1 세마포어) + **AI 종합 소견(RAG)** — 체크리스트 `[🤖 AI 종합 소견]` 버튼,
  [CHECK n] 인용 강제, Postgres `ai_opinions` 캐시(첫 생성 실측 60.4초 → 캐시 0.12초, 기본 조건
  pre-warm 완료). nlsearch LLM 경로도 pyservice 경유(NL_USE_LLM 게이트 불변).
- v47 (2026-07-08, pyservice v2) — pyservice `/reason` RDF 리즈닝
  (rdflib, 유도 관계 오버레이 — 전이 구성·유사 대칭·고장 전파, via 근거 체인) + "🔗 유도 관계" 배지.
  프로덕션 실측 유도 81건, 스모크 20 불변식 PASS.
- v46 (2026-07-08). v24~v45 요약: Postgres+pgvector 영속화(+Python 임베딩 사이드카
  pyservice, `k8s/pyservice.yaml`) · 그래프 포커스/hover 개선 · 부품 앵커 추론(v45).
  v46: BOM 파서+정합성 검증 · 전역 모순 스캔 배지 · 마스터 대조 audit · 품질 감사(🧹) ·
  확신도 breakdown · 오케스트레이터 v0 · 임베딩 자동 백필. 신규 원천 3개(BOM 2·결로 마스터)는
  `/api/ingest` 업로드로 DB 병합 완료(179 노드/2198 엣지, 임베딩 179/179). 프로덕션 스모크 17/17
  (`npx tsx scripts/smoke.ts http://192.168.0.100:30494`).
- 이하 v2~v23 상세 변경 이력:
  v2(자연어 검색·그래프 인터랙션·라이트 SL 테마·견고 파싱) + v3(FMEA 초안 다운로드)
  + v4(백본 우선 초기화면·전체 보기 토글·라벨 LOD) + v5(인스펙터 뒤로가기·이동 경로) + v6(증분 인제스천 탭)
  + v7(결로·습기 기본 데모 조건 + 인스펙터 FMEA 요약 카드·관계명 한글화·포커스 1-hop 제한·
  브레드크럼·"신규 설계 조건에 반영" 액션 + 복합 pptx 원천(13슬라이드) + 시연 문구 제거)
  + v8(온톨로지 구축 연출 시간 예산 페이싱 ~8초 + NL 검색 유사 표현 매칭 — 동의어 테마 확장·라벨 토큰 부분 매칭)
  + v9(`?update=1` 쿼리 파라미터 → 구축 완료 상태 직행 — 연출 스킵 즉시 마운트)
  + v10(인제스천 델타 합류 강조 — 새 객체 빨간 링·팝인·레이더 핑 ~9초, 새 관계 빨간 대시 흐름)
  + **v11(2D 도면 1차 — 합성 DXF 도면 2종 + DXF 파서(제목블록·NOTE 형상특징·BOM 표) + 인제스천 통합 +
  `GET /api/drawing-svg` 도면 렌더 + 원천 미리보기에 도면 이미지 표시 + 업로드 .dxf 허용)
  + v12(인스펙터 근거 문서 행 클릭 → 원천 미리보기 열기 — 도면이면 도면 이미지 포함)
  + **v13(형상 유사 탐색 1단계 — shape-sim 형상 특징 유사도(설명 가능) + `POST /api/drawing-input`
  도면 업로드→유사 설계 카드("차명이 아니라 형상"·발생 이력)→SIMILAR(weight) 병합→도면 시드 추론 +
  자연어 형상 유사 질의 문장형 답변 + 헤더 "📐 도면 분석" 버튼)
  + **v14(모순 탐지 대화 2종 — 2단계 지역·환경 교차("스펙 통과 ≠ 지역 감당") + 4단계 소비자 반응 교차
  ("FMEA 기록엔 없는데 커뮤니티 김서림 언급" — 합성 소비자반응_커뮤니티.xlsx 원천 추가))
  + v15(도면 미리보기 크게 보기 — 전체 화면 오버레이, 이미지 클릭/버튼 열기·ESC/배경 클릭 닫기)
  + **v16(목표 시장 데이터 — 도면 제목블록 "시장" 행 + 프로젝트 시장 속성(형상특징 시트) →
  지역 교차 답변이 실제 목표 시장·유사 프로젝트 시장을 인용, "어느 시장향인가" 질문 응답 가능)
  + **v17(도면 "추가" 시연 — 📐 도면 분석 패널에 파일 선택/샘플 도면(신규 리어 콤비램프, 서버 즉석 생성) 버튼.
  추가 시 신규 프로젝트·부품 객체와 CONSISTS_OF·SIMILAR 관계가 빨간 강조로 그래프 합류 + 전체 카운터 갱신)
  + **v18("이 설계/이 커넥터" 지시 대상 명시 — "이" = 마지막 분석·추가 도면(대화 컨텍스트, store ACTIVE_DRAWING),
  답변 서두에 [기준: PJ… 도면] 표기. 테스트 도면 2종 data/test-drawings/ + scripts/gen-test-drawings.ts)
  + v19(질의 주어 명시 바인딩 — "신규 헤드램프/리어콤비/안개등/DRL" 이름으로 도면 지정, 시나리오 질문 주어 명시형)
  + v20(검색/질의 하이라이트 시 엣지도 함께 디밍 — 노드만 흐려져 "허공에 뜬 선"으로 보이던 버그 수정)
  + **v21(검색 히트 중 백본 뷰 숨김 노드 자동 공개 — 답변 핵심 노드(PJ 2020-HL09 등)가 안 보이던 문제 수정 +
  소비자 반응 답변에 크롤링 출처 URL 표기)
  + **v22(큐레이션 — 인스펙터에서 노드 삭제·관계 삭제(✕)·"다른 객체에 병합"(병합 모드: 다음 클릭 = 대상,
  from 라벨은 "병합됨" 속성으로 보존 — 원본 보존 골든 룰, `POST /api/curate`, 인메모리·리셋 시 원복) +
  검색 방사형 배치 — 부품(item) 히트를 중앙, 관련 노드를 타입별 인접 섹터로 그룹 배치)
  + **v23(도면 취약점 검사(lib/drawing-risk.ts — 열팽창 차이·벤트-발열원 근접·IP 등급 vs 시장·밀폐 벤트 부족,
  도면 분석 패널 "설계 취약점 검사" 카드) + 병합·삭제 버튼 obj-head 상단 이동 + 테스트 도면 2종 추가(턴시그널 HL27·헤드램프개선 HL28))**.
- **직행 URL: `http://192.168.0.100:30494/?update=1`** — 카오스·구축 버튼·스폰 연출 없이 곧바로
  STAGE 2 완료 상태(검색·인스펙터·추론 버튼 즉시 사용 가능). 기본 URL은 3단계 스토리 연출 유지.
- **replicas = 1** — 읽기 캐시(인메모리 인덱스)의 파드 간 정합 때문에 유지. 업로드분은 이제
  **Postgres 영속**이라 파드 재시작에도 보존 — `rollout restart` 는 더 이상 데모 리셋이 아님
  (리셋하려면 DB 그래프 테이블 비우고 재기동 → `data/sources` 재인제스천).
- **이미지 정리(용량):** 마스터 로컬 docker·원격 tar 는 **최신 3개 v태그만 유지**(deploy 스크립트 prune —
  v번호 단조 증가 전제. 다음 번호는 반드시 마스터 `docker images` + `kubectl get rs` 로 확인).
  레지스트리(`:5000`, 공용 `registry:2`)는 **삭제 비활성(HTTP 405)** — 태그 v1/v2 가 남아 있으나 레이어가
  버전 간 공유(dedup)라 실 점유는 작음. 진짜 제거하려면 관리자가 `REGISTRY_STORAGE_DELETE_ENABLED` + GC 실행 필요
  (공용 인프라라 임의 재시작 금지).
- 재배포:
  ```bash
  docker build -t 192.168.0.100:5000/sl-ontoground:vN .
  docker push 192.168.0.100:5000/sl-ontoground:vN
  kubectl -n sl-ontoground set image deploy/sl-ontoground web=192.168.0.100:5000/sl-ontoground:vN
  ```
  (LLM 자연어 검색을 켜려면 Deployment 에 `NL_USE_LLM=1` + `LLM_BASE_URL`/`LLM_MODEL` env 주입 — 기본 OFF.)

## 상태 구성 (Postgres 전환 완료)
- 앱 Deployment 에 `DATABASE_URL`(클러스터 내 Postgres) 주입 — DB=원본, 인메모리=읽기 캐시.
- `PYSERVICE_URL=http://pyservice.sl-ontoground:8000` — 임베딩 사이드카(`k8s/pyservice.yaml`,
  sentence-transformers 다국어 MiniLM). 임베딩 백필은 부팅·병합 후 자동(재트리거 `POST /api/admin/embed-backfill`).
- Docling 등 추가 Python 기능도 같은 사이드카 패턴으로 확장.

## 원천 파일 포함
- `next.config.mjs`의 `outputFileTracingIncludes`가 `data/sources/**`를 standalone에 포함.
- Dockerfile은 보완적으로 `data/`를 런타임 이미지에 명시 복사.
- 실 데이터 전환 시 `data/sources`를 교체(또는 `scripts/gen-sources.ts` 재실행)하고 재빌드.
