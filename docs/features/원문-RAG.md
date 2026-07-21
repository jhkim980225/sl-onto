# feature: 원문 RAG — 문서 원문 기반 자유 질문 (코드 완료 · 배포 대기)

> **코드 완료 · 운영 미배포.** 브랜치 `feat/document-chunking` 에 구현됨:
> `lib/chunk.ts`(형식별 청커) · `doc_chunks` 테이블(`002-chunks.sql`) · `app/api/doc-ask` ·
> `components/DocAskPanel.tsx` · pyservice v8(e5-base 768dim + `task=docask`).
> 운영 배포는 002 마이그레이션(단방향, pyservice 선행) 때문에 대기 — [deployment.md](../deployment.md).
> 설계 [document-chunking](../superpowers/specs/2026-07-20-document-chunking-design.md) ·
> 계획 [2026-07-20-document-chunking.md](../superpowers/plans/2026-07-20-document-chunking.md).
> 노드 컨텍스트 기반 RAG(`/api/ask`)는 별개다 → [질의응답.md](질의응답.md)

## 문제 — 지금 시스템이 못 하는 것
문서는 파싱 시점에 노드·엣지로 "소화"될 뿐, 원문 텍스트 자체는 어디에도 벡터화되지 않는다.
`grep`으로 확인해도 청크 단위 저장이나 크기 기반 분할 로직(`chunk`, 문서 원문을 자르는 `overlap`)은
코드 전체에 0건이다(`lib/infer.ts`의 `sortByEvidenceOverlap`은 근거 집합의 겹침을 비교하는 별개
함수이지 문서 분할이 아니다). 그래서
[질의응답.md](질의응답.md)의 `/api/ask`가 주는 근거는 **파일명 문자열뿐**이고, 표 셀 값 하나
("안정성시험 45도 3개월 시점 pH 값은?")나 문서 안 서술("이 클레임 처리 결과가 뭐였지?") 같은
질문에는 답할 수 없다. 이 문서는 그 공백을 메우기 위한 **설계**를 요약한다 — 아래 내용은 전부
`docs/superpowers/specs/2026-07-20-document-chunking-design.md`에서 가져온 것이며, 구현되면
이 문서를 갱신해 계획됨 배너를 뗀다.

## 목표 — `/api/ask`를 대체하지 않고 병행한다
캔버스 안에서 **객체 선택 없이** 자유 질문하면 문서 원문을 근거로 답하고 인용 구절을 보여준다.
기존 `/api/ask`(객체 앵커 Q&A)는 성격이 달라 그대로 두고 새 엔드포인트로 병행할 계획이다.
범위 밖: 청크를 검색(`nlsearch`/`search`) 후보 확장에 투입, 온톨로지 추출률 개선, 이미지·스캔 OCR.

## 결정적 제약 — 임베딩 모델 교체 (e5-base)
현재 [벡터-임베딩.md](벡터-임베딩.md)의 모델(MiniLM-L12, 384-dim)은 `max_seq_length=128`토큰
(한국어 약 250~350자)이라 청킹에 정면으로 걸린다 — 500토큰짜리 청크를 만들어도 앞 1/4만
반영되고, 그마저도 에러 없이 조용히 잘린다. 운영 pyservice(v7, CPU 전용)로 한국어 화장품 도메인
질의 4건을 실측한 결과:

| 모델 | 토큰 | 차원 | top-1 정확도 |
|---|---|---|---|
| MiniLM-L12(현재) | 128 | 384 | 3/4 |
| **multilingual-e5-base(채택)** | 512 | 768 | 4/4 |
| bge-m3(기각) | 8192 | 1024 | 4/4 (처리량 1/4 · 메모리 2배) |

`multilingual-e5-base`로 교체가 결정됐다 — 정확도 4/4(현재 모델이 틀리던 질의를 맞춘다),
질의 지연은 오히려 그대로(17ms vs 18ms), 토큰 한도가 4배(512)로 늘어 청킹이 실용적인 크기가
된다. e5 계열은 `query: `/`passage: ` 접두어가 필수이고 빠뜨려도 에러 없이 품질만 조용히
떨어지는 함정이 있어, `lib/embed.ts` 한 곳에서 강제하고 테스트로 고정할 계획이다.

## 청킹 단위
새 파서를 만들지 않고 기존 `lib/source-text.ts`의 `extractSourceBlocks()` 위에 얹는다.
목표 청크 크기 **800자**(512토큰 한도에 여유를 둔 값).

| 형식 | 청킹 방식 |
|---|---|
| xlsx | 헤더 행 + 데이터 N행을 800자까지 묶고, **다음 청크에도 헤더를 다시 붙인다**(컬럼 의미 보존) |
| pptx | 슬라이드 1장 = 청크 1개, 800자 넘으면 분할 |
| docx | 문단을 800자까지 묶되 **문단 경계에서만** 자른다 |
| pdf | pyservice `/parse` 결과를 빈 줄 기준 문단 묶음, 표는 행 단위 |
| dxf | 청킹 안 함(도면) |

오버랩은 산문(docx·pdf)만 1문단. 표는 헤더 반복이 오버랩 역할을 대신하므로 오버랩 없음(넣으면
같은 행이 중복 검색된다).

## 저장 — `doc_chunks` 테이블(신규)
```sql
CREATE TABLE doc_chunks (
  canvas_id TEXT, file TEXT, seq INTEGER, block TEXT, text TEXT, embedding vector(768),
  PRIMARY KEY (canvas_id, file, seq),
  FOREIGN KEY (canvas_id, file) REFERENCES sources(canvas_id, file) ON DELETE CASCADE
);
```
`sources`에 FK CASCADE를 걸어 문서를 지우면 청크가 자동으로 사라지게 한다 — [문서-관리.md](문서-관리.md)가
겪은 "엣지에 출처가 없어 정확 삭제가 안 된다"는 문제를 청크 레벨에서는 처음부터 피해가는 설계다.
`nodes.embedding`은 용도가 다르므로(검색 후보 확장) 그대로 유지하되, 모델 교체로 차원만 768로
맞춘다.

## 검색·생성 흐름 (설계)
```
질문 → embed("query: " + 질문) → doc_chunks 코사인 top-8(canvas_id 스코프)
     → 컨텍스트 조립: [C1] 파일명·블록·원문 … [C8] → pyservice /llm task=docask → [C n] 인용 답변
```
설계된 API: `POST /api/doc-ask` — `{ question(2..500) }` → `{ answer, citedChunks, chunks, cached, ms }`.
청크가 없는 캔버스는 409 `needsDocs`, 사이드카 미가용은 503 — [질의응답.md](질의응답.md)의 `/api/ask`와
달리 **규칙기반 폴백이 없다**(원문 검색은 벡터가 전부이므로). 인용 방식은 `/api/ask`의 `[R n]`과
같은 패턴을 원문 청크에 적용한 것 — `[C n]` 인용에 그 청크의 파일명·블록·원문 구절을 함께 응답에
실어 골든 룰(근거 우선)을 지킨다. 다만 설계 문서 스스로 명시하듯 **인용 번호가 실존하는지는
서버가 검증하지 않는다**(`/api/ask`와 동일한 한계) — 대신 `chunks` 전체를 함께 노출해 사람이
대조할 수 있게 한다.

## 백필 — 기존 진입점 재사용 (설계)
새 스케줄러를 만들지 않고 [벡터-임베딩.md](벡터-임베딩.md)의 `scheduleEmbedBackfill(canvasId)`
안에서 노드 임베딩 백필 뒤에 청크 백필을 이어 돌리는 설계다. 호출 지점(부팅 hydrate·문서 병합
후·관리 엔드포인트)도 변경 없이 그대로 재사용한다.

## 왜 아직 없는가 — 하지 않은 이유가 아니라 순서
청킹 자체는 어렵지 않지만, 임베딩 모델 교체(384→768차원)가 선행돼야 청크 단위 임베딩이
실용적인 정확도를 낸다. 기존 `nodes.embedding`도 차원이 바뀌므로 전량 재생성이 필요하다
(245개, 실측 처리량 66/s ≈ 4초) — 모델 교체 없이 청킹만 먼저 넣으면 정확도가 떨어진 채로
기능이 나가므로, 계획은 두 변경을 한 구현 계획(8태스크)으로 묶어 순서대로 처리하도록 짜여 있다.
