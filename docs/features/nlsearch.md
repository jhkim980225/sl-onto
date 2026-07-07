# feature: nlsearch — 자연어 검색

## 책임
자연어 질문(한국어)을 좁은 FMEA 온톨로지에 대한 **엔티티 링크 + 의도 파악 + 그래프 확장**으로 풀어
관련 객체를 관련도 순으로 반환한다. 키워드 검색([search.md](search.md))을 **보완**한다.
- 상단 검색창: 입력 중 = 키워드 드롭다운(기존), **Enter = 자연어 질문**(이 기능).
- 결과는 우측 `NLSearchPanel` 에 렌더(요약·해석·관련객체). hit 클릭 → 그래프 포커스 + 인스펙터.

## 모듈: `lib/nlsearch.ts`
```ts
nlSearch(query: string): Promise<NLSearchResponse>
// NLSearchResponse = { answer, interpretation?, hits: SearchHit[], neighbors: string[], mode: "llm"|"fallback" }
```

## 규칙기반 파이프라인 (기본 경로 · 빠름 <1s · 한국어 정확)
질의 문자열을 NFC 정규화 후:
1. **지역 감지 → 법규 매핑:** 북미/미국/FMVSS→`RUS`(FMVSS 108) · 유럽/ECE→`REU`(ECE R149) ·
   한국/국내/KMVSS→`RKR`(KMVSS) · 중국/GB 25991→`RCN`(GB 25991). (`REGION_TERMS`)
2. **유형 의도:** "고장·불량·현상"→fm, "원인"→cause, "대책·조치·개선"→action, "법규·규제·인증"→reg,
   "부품·구성"→item, "프로젝트·차종"→proj, "마스터·표준"→master, "스펙·고객"→spec. (`TYPE_TERMS`)
3. **도메인 동의어:** 결로≈습기·김서림·성에·fog, 간극/단차/공차≈맞물림·매칭·끼워맞춤·체결,
   배광≈광학·beam, 방열≈발열·열 등. (`SYNONYMS`)
4. **엔티티 링크:** 노드 라벨/동의어가 질의에 언급되면 **직접 시드**(점수 3+), 동의어 테마 일치 2.2,
   지역 법규 노드 2.6. **라벨 토큰 부분 매칭**(질의 "조립 공차" → 라벨 "조립 공차 누적", 겹친 토큰
   합계 4자+ 문턱으로 일반어 과다 시드 방지) 1.7+.
5. **그래프 확장:** 직접 시드의 1-hop 이웃(문서 제외)을 시드 점수 ×0.42 로 가산.
6. **지역 필터:** 지역이 지정되면 **다른 지역 법규 노드는 제거**(북미 질의에 유럽 법규 안 섞임).
7. **유형 부스트 + 랭킹:** 의도 유형 일치 시 ×1.45, degree 미세 가산 → 상위 12개 hit + 이웃.
8. **해석/답변 템플릿:** `interpretation`("지역: 북미 · 개념: 결로 · 유형: 조치"),
   `answer`("관련 객체 N건 (유형별 집계). …중심으로 연결된 항목입니다.").

## LLM 경로 (기본 OFF · `NL_USE_LLM=1` 로 옵트인)
- 사내 vLLM `qwen3-32b-finance` 에 카탈로그(id=라벨 목록)를 주고 관련 id 를 고르게 함(JSON 강제, `/no_think`).
- 실패/타임아웃/빈 결과 시 규칙기반으로 폴백.
- 환경변수: `LLM_BASE_URL`(기본 in-cluster vllm-loadbalancer) · `LLM_MODEL`(qwen3-32b-finance) · `LLM_TIMEOUT_MS`(60000).

### 왜 기본은 규칙기반인가 (결정 기록)
| 대안 | 결과 | 판단 |
|---|---|---|
| **규칙기반**(채택) | 엔티티 링크 + 그래프 확장. **<1s**, 한국어 정확, 결정론적 | ✅ 기본 |
| in-cluster vLLM `qwen3-32b-finance` | 품질은 되나 **쿼리당 ~60–70s** (서버 과부하) | 너무 느림 → 옵트인만 |
| ollama `nomic-embed-text` 임베딩 | 한국어 개념을 **변별 못함**(유사도 붕괴) | 사용 안 함 |
> 좁고 통제된 온톨로지에서는 규칙기반 링크가 임베딩/대형 LLM보다 빠르고 정확. LLM 슬롯은 서버가 빨라지면 켠다.

## API: `POST /api/nlsearch`
- body `{ query: string(1..400) }`(zod) → `NLSearchResponse`. 빈/잘못된 body → 400.

## 확장 이음새
- 규칙 → LLM: `NL_USE_LLM=1` 만으로 전환(폴백 유지). 임베딩 도입 시 `ruleBasedNL` 내부만 교체.
