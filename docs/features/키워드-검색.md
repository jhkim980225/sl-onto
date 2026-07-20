# feature: search — 검색

## 책임
텍스트 질의로 관련 객체를 찾고, 그래프 근접도로 확장·랭킹. (임베딩은 확장기 슬롯)

> **자연어 검색과 상보 관계:** 이 키워드 검색은 상단 검색창 **입력 중 드롭다운**을 담당한다.
> **Enter** 를 누르면 자연어 질문으로 해석돼 [nlsearch.md](nlsearch.md)(`POST /api/nlsearch`)로 넘어간다.
> 즉 keyword = 빠른 노드 점프, NL = 문장형 질의 이해. 둘 다 규칙기반·온톨로지 기반이라 근거 추적 가능.

## 모듈: `lib/search.ts`
```ts
search(q: string): { hits: Hit[]; neighbors: string[] }
// Hit = { id, label, type, score, matched: ('label'|'sub'|'prop'|'evidence')[] }
```

## 알고리즘 (MVP: 키워드 + 그래프)
1. **정규화:** 소문자·공백 정리. 도메인 동의어 소사전(선택): 간극≈갭, 배광≈광학, 결로≈습기.
2. **필드 매칭 점수:** label(3) > sub(2) > props(1.5) > evidence filename(1). 부분일치 허용.
3. **그래프 확장:** 상위 hit의 1-hop 이웃을 `neighbors`로 추가(하이라이트용).
4. **랭킹:** 매칭점수 내림차순, 동점 시 degree(연결수) 높은 순.

## API: `GET /api/search?q=`
- 반환 `{hits, neighbors}` → UI가 매칭 노드 `pulse`, 비매칭 `dim`.
- 빈 `q`면 하이라이트 해제(빈 결과).

## UX 연결
- 상단 검색창 입력마다 호출(디바운스). 데모의 검색 동작과 동일.
- 예시 질의: "간극", "배광", "FMVSS", "결로".

## 확장 이음새
- 키워드 → 임베딩: `search()` 내부만 교체(임베딩 API로 벡터 유사도), 시그니처·API 계약 유지.
- 하이브리드(키워드+벡터) 랭크 융합은 확장기.

## 테스트
- "간극" → `FMGAP`(간극 벌어짐) 최상위, `MGAP`·`AMOLD` 이웃 포함.
- "FMVSS" → `RUS`(FMVSS 108) hit.
- 빈 질의 → hits 0.
