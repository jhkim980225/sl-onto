# 문서 청킹 + 원문 RAG — 설계

> 작성일: 2026-07-20 · 기준: 운영 v79
> 선행: [multi-canvas](2026-07-20-multi-canvas-design.md) · [canvas-document-crud](2026-07-20-canvas-document-crud-design.md)

## 1. 문제

지금 시스템에는 **청킹이 없다.** `chunk`·`overlap`·크기 기반 분할 로직이 코드 전체에 0건이다.

임베딩 단위는 문서 청크가 아니라 **온톨로지 노드 1개**다(`lib/db.ts:229` `embedText`):

```ts
embedText = label + "\n" + props 값들.join(" ")   // 키는 버림, sub·type·st 제외
```

문서 원문은 어디에도 벡터화되지 않는다. 파싱 시점에 노드·엣지로 "소화"되고, 원본 바이트는
`sources.content` 에 뷰어 재파싱용으로만 남는다. `/api/ask` 의 RAG 컨텍스트에 들어가는 근거도
**파일명 문자열뿐**이다(`lib/ask.ts` — `d.filename`).

그래서 이런 질문에 답할 수 없다:

```
"안정성시험 45도 3개월 시점 pH 값은?"    → 표 셀은 노드가 아니다
"이 클레임 처리 결과가 뭐였지?"           → 원문을 LLM 이 못 본다
"이 문서 어디에 그렇게 써 있어?"          → 근거가 파일명뿐이다
```

## 2. 목표와 비목표

**목표**: 캔버스 안에서 **객체 선택 없이 자유 질문** → 문서 원문 근거로 답변 + 인용 구절 노출.

**비목표(이번 범위 밖)**
- 기존 `/api/ask`(객체 앵커 Q&A) 대체 — 성격이 다르므로 병행한다
- 청크를 `nlsearch`/`search` 후보 확장에 투입 — 검색 랭킹은 손대지 않는다
- 온톨로지 추출률 개선(청크로 노드를 더 뽑아내는 것)
- 이미지·스캔 OCR

## 3. 결정적 제약 — 임베딩 모델 최대 토큰

현재 모델 `paraphrase-multilingual-MiniLM-L12-v2` 의 **`max_seq_length = 128`**(운영 pyservice 에서
실측). 한국어 약 250~350자. 그보다 긴 텍스트는 **에러 없이 조용히 잘린다.**

노드 임베딩(라벨+속성)은 짧아서 문제가 없었지만, 문서 청킹에는 정면으로 걸린다. 500토큰 청크를
만들면 임베딩에는 앞 1/4만 반영된다.

### 실측 (운영 pyservice 이미지 v7, CPU 전용, 한국어 화장품 도메인 질의 4건)

| 모델 | 토큰 | 차원 | 피크 RSS | 질의 1건 | 처리량 | top-1 정확도 |
|---|---|---|---|---|---|---|
| MiniLM-L12 (현재) | 128 | 384 | 1,213MB | 18ms | 211/s | **3/4** |
| **multilingual-e5-base** | 512 | 768 | 1,687MB | **17ms** | 66/s | **4/4** |
| bge-m3 | 8192 | 1024 | 3,760MB | 59ms | 15/s | 4/4 |

현재 모델은 실제로 틀린다 — "선크림에 자외선차단제 얼마나 들어가나" 질의에 처방전 대신
**클레임 문서**를 1위로 뽑았다(0.470 vs 정답 0.387).

### 결정: multilingual-e5-base

- 정확도 4/4 — 현재 모델이 틀리던 것을 맞춘다
- 토큰 128 → 512(4배) — 청킹이 실용적인 크기가 된다
- **질의 지연이 안 늘어난다**(17ms vs 18ms). 벌크 처리량만 3배 차이인데 일회성 백필에만 영향
- 메모리 1,687MB — pyservice limit 2Gi → **3Gi** 로만 올리면 된다

**기각: bge-m3.** 정확도는 같은데 CPU 처리량이 **15 texts/s** 로 e5-base의 1/4다(청크 5,000개 기준
5분 30초 vs 75초). 메모리 3,760MB 라 limit 6Gi 가 필요하고, 8192토큰은 지금 쓸 데가 없다.

**e5 계열의 함정**: `query: ` / `passage: ` 접두어가 필수다. 빠뜨려도 **에러가 안 나고 품질만
조용히 떨어진다.** 이 레포는 임베딩 경로가 백필·검색으로 갈라져 있어 한쪽만 빠뜨리기 쉽다 →
`lib/embed.ts` 한 곳에서 강제하고 테스트로 고정한다(§8).

## 4. 청킹 전략 — 기존 구조 재활용

`lib/source-text.ts:45` 의 `extractSourceBlocks()` 가 이미 형식별 구조를 준다. **새 파서를 만들지
않고 그 위에 얹는다.**

목표 청크 크기 **800자**(512토큰 한도에 여유를 둔 값).

| 형식 | 블록 | 청킹 |
|---|---|---|
| xlsx | 시트별 `rows` 그리드 | **헤더 행 + 데이터 N행**. 800자 직전까지 묶고 **다음 청크에 헤더를 다시 붙인다** |
| pptx | 슬라이드별 `lines` | 슬라이드 1장 = 청크 1개. 800자 넘으면 분할 |
| docx | `본문` 문단 배열 | 문단을 800자까지 묶음. **문단 경계에서만** 자른다 |
| pdf | pyservice `/parse` text+tables | 빈 줄 기준 문단 묶음, 표는 행 단위 |
| dxf | 없음 | 청킹 안 함(도면) |

### xlsx 헤더 반복이 핵심

클레임집계 120행을 그냥 자르면 이렇게 된다:

```
CL-2025-1043 │ 2025-03-12 │ PJ 2025-CP101 │ ... │ 상분리 │ 유화제 함량 부족 │ ...
```

각 값이 무슨 컬럼인지 알 수 없어 "상분리 클레임의 원인" 질의에 안 걸린다. 헤더를 매 청크에
붙이면 `증상 현상`·`추정 원인` 이 함께 임베딩돼 검색된다.

### 오버랩

산문(docx·pdf)만 **1문단**. 표는 헤더 반복이 그 역할을 하므로 **오버랩 없음** — 넣으면 같은 행이
두 청크에 중복돼 검색 결과가 지저분해진다.

## 5. 저장

```sql
CREATE TABLE IF NOT EXISTS doc_chunks (
  canvas_id  TEXT NOT NULL,
  file       TEXT NOT NULL,
  seq        INTEGER NOT NULL,          -- 문서 내 순번(0부터)
  block      TEXT NOT NULL,             -- "클레임" · "슬라이드 3" · "본문"
  text       TEXT NOT NULL,             -- 임베딩 입력이자 인용 표시 원문
  embedding  vector(768),
  PRIMARY KEY (canvas_id, file, seq),
  FOREIGN KEY (canvas_id, file) REFERENCES sources(canvas_id, file) ON DELETE CASCADE
);
```

**`sources` 에 FK CASCADE** — 문서를 지우면 청크가 자동으로 사라진다. 서브프로젝트 2에서 고생한
문서 삭제 정합성이 여기서는 공짜로 해결된다. `lib/documents.ts` 는 손대지 않는다.

`nodes.embedding` 은 유지한다(용도가 다르다 — 검색 후보 확장). 다만 모델 교체로 **둘 다 768차원**이
된다.

**벡터 인덱스는 두지 않는다.** 현재 `nodes` 도 seq scan 이고(`lib/db/schema.sql:7` 의 기존 결정),
청크 수천 개 규모에서는 여전히 seq scan 이 빠르다.
`// ponytail: 청크가 수만 개 되면 doc_chunks.embedding 에 HNSW 인덱스.`

## 6. 검색·생성

```
질문
 └→ embed("query: " + 질문)                       lib/embed.ts
 └→ SELECT ... FROM doc_chunks
      WHERE canvas_id = $1 AND embedding IS NOT NULL
      ORDER BY embedding <=> $2 LIMIT 8            lib/db.ts
 └→ 컨텍스트 조립: [C1] 파일명 · 블록 \n 원문 … [C8]
 └→ pyservice /llm task=docask                     한국어 답변 + [C n] 인용
```

### API

```
POST /api/doc-ask?canvas=<id>
  body: { question: string(2..500) }
  200 { answer, citedChunks: number[], chunks: [{ n, file, block, text }], cached, ms }
  409 { ok:false, error:"이 캔버스에 청크가 없습니다 — 문서를 먼저 등록하세요", needsDocs:true }
  503 { error:"pyservice(/llm) 미가용" }
```

`/api/ask`(객체 앵커)는 **그대로 둔다.** 성격이 다르고, 기존 것을 건드리면 회귀 위험만 크다.

**캐시**: `ai_opinions` 재사용. 키 `docask_<fnv1a(question)>` — 기존 `ask_` 접두어와 같은 방식으로
네임스페이스를 분리한다(`lib/ask.ts:28` 참고).

### 골든 룰 이행

인용된 `[C n]` 의 **파일명·블록·원문 구절**을 응답에 함께 싣는다. UI 가 근거를 그대로 보여준다 —
지금 `/api/ask` 가 파일명만 주던 것보다 근거가 강해진다.

**한계 명시**: 본문의 `[C n]` 이 실존하는 번호인지 서버가 검증하지 않는다(기존 `/api/ask` 와 동일).
`citedChunks` 정수 배열만 정제한다.
`// ponytail: 인용 번호 검증은 답변 후처리에서. 지금은 chunks 를 함께 노출해 사람이 대조 가능.`

## 7. 마이그레이션·백필

```
lib/db/migrations/002-embedding-768.sql
  -- ALTER COLUMN ... TYPE vector(768) USING NULL 은 vector 간 자동 캐스팅이 없어 거부될 수 있다.
  -- 어차피 기존 값을 버리므로 DROP/ADD 가 확실하고 짧다.
  ALTER TABLE nodes DROP COLUMN embedding;
  ALTER TABLE nodes ADD COLUMN embedding vector(768);
  CREATE TABLE doc_chunks (...);

pyservice v8
  - MODEL_NAME 을 intfloat/multilingual-e5-base 로
  - /llm 에 task="docask" 추가(시스템 프롬프트: 청크 컨텍스트만 근거, [C n] 인용 강제)
  - k8s/pyservice.yaml limit 2Gi → 3Gi
  - schema.sql 도 함께 갱신(신규 설치가 마이그레이션을 안 타므로 최종 형태가 같아야 한다)
```

**기존 임베딩은 차원이 달라 보존 불가**하다. 폐기 후 재생성이 유일한 경로다(245개, 66/s → 약 4초).

**트리거 조건**: `001-canvas` 와 같은 방식 — `doc_chunks` 테이블 부재를 감지해 1회 실행, 단일
트랜잭션. 재실행 멱등.

**백필**: `lib/store.ts` 의 `scheduleEmbedBackfill(canvasId)` 이 유일한 진입점이다. 그 안에서
노드 임베딩 백필 뒤에 청크 백필을 이어 돌린다 — 대기열(`backfillPending` Set)·동시성 제한을
그대로 재사용하므로 새 스케줄러를 만들지 않는다. 호출 지점(부팅 hydrate·mergeDelta 후·관리
엔드포인트)도 변경 없다. 기존 문서 42건(램프 41 + 화장품 1)은 첫 부팅에서 청킹된다.

**순서 주의**: 마이그레이션이 `nodes.embedding` 을 NULL 로 만들므로, 백필이 돌기 전까지 시맨틱
검색 후보 확장이 빈 결과를 준다. 규칙 검색은 정상 동작하므로 사용자에게는 "검색이 조금 덜
똑똑한" 몇 초로 보인다. 실패가 아니다.

## 8. 에러 처리

| 상황 | 처리 |
|---|---|
| 청크 0개인 캔버스에 질문 | 409 + `needsDocs` — UI 가 "문서를 먼저 등록하세요" 안내 |
| pyservice `/embed` 미가용 | 질의 임베딩 불가 → 503. 기존 규칙 검색과 달리 **폴백이 없다**(원문 검색은 벡터가 전부) |
| pyservice `/llm` 미가용 | 503 + 사유. 기존 `/api/ask` 와 동일 |
| 청킹 실패(손상 문서) | 그 문서만 청크 0개. 인제스천 자체는 성공 — 청킹은 부가 기능이므로 막지 않는다 |
| e5 접두어 누락 | **컴파일로 못 막는다.** `lib/embed.ts` 가 유일한 진입점이 되도록 하고, 접두어를 붙이는지 테스트로 고정 |
| 마이그레이션 실패 | 단일 트랜잭션 abort. 부팅 실패로 표면화 |

## 9. 테스트

| 파일 | 검증 |
|---|---|
| `lib/chunk.test.ts` (신규) | xlsx 청크에 **헤더가 매번 포함**되는지 · 800자 상한 · 문단 경계 보존 · 표는 오버랩 없음 · 빈 블록은 청크 0개 |
| `lib/embed.test.ts` (신규) | `embedQuery` 는 `query: `, `embedPassage` 는 `passage: ` 접두어를 붙인다(e5 함정 회귀 방어) |
| `lib/documents.test.ts` (기존) | 문서 삭제 시 청크가 CASCADE 로 사라지는지 — DB 모드 필요하므로 수동 검증으로 대체 |

수동(실행) 검증:

1. 마이그레이션 후 노드 245개 재임베딩 확인(`embedding IS NOT NULL` 카운트)
2. 화장품 문서 전량 업로드 → 청크 수·평균 길이 확인
3. `POST /api/doc-ask` 로 §1의 세 질문 — 원문에만 있는 수치가 답변에 나오는지
4. 인용 `[C n]` 의 `chunks[n]` 이 실제로 그 내용을 담고 있는지 사람이 대조
5. 문서 1건 삭제 → `doc_chunks` 에서 그 파일 행이 사라졌는지
6. 캔버스 격리 — 램프 질문이 화장품 청크를 안 물어오는지

## 10. 범위 밖 (후속)

- 청크를 `nlsearch`/`search` 후보 확장에 투입
- 인용 번호 실존 검증
- HNSW 벡터 인덱스
- 리랭커(cross-encoder) 도입
- 표 셀 단위 구조화 질의(SQL-like)
