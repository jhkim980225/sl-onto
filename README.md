# SL OntoGround

FMEA 지식 **온톨로지 워크벤치** (팔란티어 온톨로지 스타일). 흩어진 FMEA 문서(xlsx·pptx·docx)를
객체·관계 온톨로지로 정형화·적재하고, 신규 설계 조건으로 유사 사례를 그래프 탐색해
**근거·확신도가 붙은 설계 검토 체크리스트**를 생성한다. SL(에스엘㈜) 자동차 램프 부품 대상.

## 빠른 시작
```bash
npm ci
npm run dev        # http://localhost:3000 (점유 시 3001+)
```
1. **온톨로지 구축 시작** → 실제 원천 파일(`data/sources/`, 약 34개) 인제스천 → 그래프(≈170 노드/2156 엣지)
2. **신규 설계 추론 시연** → 조건(북미·LED·분리형 DRL·슬림)으로 체크리스트 도출(확신도 상위 8)
3. 체크리스트/노드 클릭 → 근거 경로·근거 파일 추적. 검색창: 입력=키워드 드롭다운, **Enter=자연어 질문**
4. 아우터 렌즈/결로·습기 인스펙터 → **결로 지역별 분석**(지역 탭 + 설계도 SVG)

## 주요 기능
- **인제스천**: 실제 Office 파일 파싱 → 온톨로지. 통제 어휘 + **미지 엔티티 auto-create** + **견고 파싱**(병합헤더·동의어 컬럼·자유텍스트 링크).
- **추론**: 규칙기반 그래프 탐색 → 근거·확신도 체크리스트(상위 8, `total` 로 전체 수 표기).
- **검색**: 키워드(드롭다운) + **자연어 검색**(규칙기반, `POST /api/nlsearch`; 사내 LLM 옵트인 `NL_USE_LLM=1`).
- **그래프**: 클릭 포커스/디밍 · 대분류 타입 존 · 관련도 방사형 레이아웃.
- **테마**: 라이트 SL 브랜드(흰 배경·네이비 텍스트·시안 액센트 `#00a2e5`).

## 스택
Next.js(App Router, TS) · Route Handlers API · 인메모리 온톨로지(→ Postgres) ·
규칙기반 그래프 추론(→ LLM RAG) · 인제스천(xlsx/pptx/docx 파싱 → 정형화) · Docker standalone.
API: `/ontology` `/object/[id]` `/search` `/nlsearch` `/infer` `/sources` `/condensation`.

## 구조
```
app/          페이지 + api/ (ontology·object·search·nlsearch·infer·sources·condensation)
components/    워크벤치 UI (Graph·Inspector·Checklist·SourcePanel·NLSearchPanel·Condensation{Panel,Drawing})
lib/          도메인 로직 (store·search·nlsearch·infer·seed·types) + ingest/ (파서·정규화) + scenario/ (결로)
scripts/      gen-sources.ts · gen-real-samples.ts · check-before.ts · check-real-samples.ts
data/sources/ 데모 원천 파일 · data/real-samples/ 실무형 견고파싱 검증 샘플
docs/         설계 문서 — 시작점: docs/README.md
```

## 테스트 · 빌드 · 배포
```bash
npm test           # 36 pass (search·infer·ingest 라운드트립·robust 견고파싱)
npm run build      # standalone
docker build -t sl-ontoground . && docker run -p 8000:8000 sl-ontoground
```
**배포됨(v2):** FEDA K8s ns `sl-ontoground`, NodePort 30494 → `http://192.168.0.100:30494/` (사내망).

문서: [docs/README.md](docs/README.md) · 배포: [docs/deployment.md](docs/deployment.md) · 작업지침: [CLAUDE.md](CLAUDE.md)
