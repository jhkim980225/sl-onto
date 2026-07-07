# SL OntoGround — 문서 인덱스

FMEA 지식 온톨로지 워크벤치. 원천: `../정리할거.txt`(SL 과제 요구사항), `../FMEA_온톨로지_시연_v2.html`(데모).

## 읽는 순서
1. [requirements.md](requirements.md) — **왜/무엇** — 배경·요구사항·MVP 범위·추적표·완료기준
2. [tech-stack.md](tech-stack.md) — **무엇으로** — 스택 결정기록·버전·대안
3. [architecture.md](architecture.md) — **어떻게 (전체)** — 시스템 구조·데이터흐름·API·배포
4. [data-model.md](data-model.md) — **데이터** — 온톨로지 스키마·저장 schema·JSON 형태
5. [design.md](design.md) — **보이는 것** — UI 디자인 시스템(컬러·타이포·모션·그래프viz)
6. [features/](features/) — **기능별 상세**
   - [ingestion.md](features/ingestion.md) — 비정형 파일 → 정형화 → 온톨로지
   - [incremental-ingest.md](features/incremental-ingest.md) — 증분 인제스천 시연(업로드→델타 합류) (auto-create·견고 파싱)
   - [condensation-scenario.md](features/condensation-scenario.md) — 결로·습기 지역별 시연 + 설계도
   - [ontology-store.md](features/ontology-store.md) — 저장소
   - [search.md](features/search.md) — 키워드 검색
   - [nlsearch.md](features/nlsearch.md) — 자연어 검색(규칙기반 · LLM 옵트인)
   - [inference.md](features/inference.md) — 추론 엔진(상위 8 캡)
   - [graph-interaction.md](features/graph-interaction.md) — 그래프 포커스·타입 존·방사형 레이아웃
   - [workbench-ui.md](features/workbench-ui.md) — 워크벤치 UI
7. [deployment.md](deployment.md) — Docker standalone → 회사 클라우드 배포
8. [skills.md](skills.md) — 빌드에 쓸 Claude 스킬 + 커스텀 후보
9. [review-notes.md](review-notes.md) — 코드 리뷰 결과·반영 기록

## 상위 지침
- [../CLAUDE.md](../CLAUDE.md) — Claude Code 작업 지침·골든룰
- [../AGENTS.md](../AGENTS.md) — 개발 서브에이전트 + 제품 Agent 로드맵

## 한 줄 원칙
> 데모의 하드코딩 목업 → **데이터가 실제로 흐르는 시스템**. 모든 결론에 **근거+확신도**. 각 칸은 실 과제로 **갈아끼우기**.
