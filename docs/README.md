# SL OntoGround — 문서 인덱스

비정형 사내 문서를 **벡터 RAG + 그래프 온톨로지**로 적재해 **검색·질의응답**하는 워크벤치.
캔버스 = 도메인별 완전 격리 워크스페이스. 모든 답변에 **근거 문서 + 확신도**.

## 읽는 순서
1. [requirements.md](requirements.md) — **왜/무엇** — 문제·범위·완료기준
2. [tech-stack.md](tech-stack.md) — **무엇으로** — 스택 결정기록·검색/RAG 계층
3. [architecture.md](architecture.md) — **어떻게 (전체)** — 구조·데이터흐름·API·캔버스 스코핑
4. [data-model.md](data-model.md) — **데이터** — 메타모델·캔버스 스키마·JSON 형태
5. [design.md](design.md) — **보이는 것** — UI 디자인 시스템
6. [features/](features/) — **기능별 상세** (아래)
7. [deployment.md](deployment.md) — Docker standalone → FEDA K8s
8. [skills.md](skills.md) · [review-notes.md](review-notes.md)

## 기능 문서

**저장·적재**
[온톨로지-저장소](features/온톨로지-저장소.md) ·
[인제스천](features/인제스천.md) ·
[증분-인제스천](features/증분-인제스천.md) ·
[문서-관리](features/문서-관리.md)

**캔버스·스키마**
[다중-캔버스](features/다중-캔버스.md) ·
[스키마-편집](features/스키마-편집.md) ·
[스키마-검증](features/스키마-검증.md) ·
[기능-가용성](features/기능-가용성.md)

**검색·질의응답**
[키워드-검색](features/키워드-검색.md) ·
[자연어-검색](features/자연어-검색.md) ·
[벡터-임베딩](features/벡터-임베딩.md) ·
[질의응답](features/질의응답.md) ·
[관계-유도](features/관계-유도.md) ·
[원문-RAG](features/원문-RAG.md) *(계획됨)*

**UI·운영**
[워크벤치-UI](features/워크벤치-UI.md) ·
[그래프-인터랙션](features/그래프-인터랙션.md) ·
[뷰-3종](features/뷰-3종.md) ·
[원문-보기](features/원문-보기.md) ·
[품질-스캔](features/품질-스캔.md) ·
[큐레이션](features/큐레이션.md)

**레거시 — FMEA 전용** (동작하지만 신규 투자 없음)
[그래프-추론](features/legacy-fmea/그래프-추론.md) ·
[FMEA-초안생성](features/legacy-fmea/FMEA-초안생성.md) ·
[BOM-정합성](features/legacy-fmea/BOM-정합성.md) ·
[모순-검사](features/legacy-fmea/모순-검사.md) ·
[결로-시나리오](features/legacy-fmea/결로-시나리오.md) ·
[2D-설계도](features/legacy-fmea/2D-설계도.md) ·
[검토의견-오케스트레이터](features/legacy-fmea/검토의견-오케스트레이터.md)

과제 대응 기록(아카이브): [legacy/과제요구-구현현황.md](legacy/과제요구-구현현황.md)

## 상위 지침
- [../CLAUDE.md](../CLAUDE.md) — 작업 지침·골든룰
- [../AGENTS.md](../AGENTS.md) — 서브에이전트 위임 규칙

## 한 줄 원칙
> 문서를 부으면 그래프가 자란다. 모든 답에 **근거 + 확신도**. 각 칸은 **갈아끼우기** 가능.
