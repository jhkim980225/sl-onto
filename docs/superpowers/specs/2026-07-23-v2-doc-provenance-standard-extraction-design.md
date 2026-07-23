# v2 문서 규격화 + Document 노드(근거 복원) 설계

- 날짜: 2026-07-23
- 상태: 승인 대기(스펙 리뷰 전)
- 대상 브랜치: main (v2 배포됨 — 앱 v4 · pyservice v11)
- 선행: `2026-07-22-v2-neo4j-foundation-design.md`(v2 인제스천·pod-per-canvas)

## 1. 문제

v2 인제스천(`lib/ingest-v2/pipeline.ts`)은 비정형 문서를 LLM으로 파싱해 개체·관계 그래프로
적재한다. 그러나:

1. **표준 규격이 없다.** 추출 산출이 내부용 `{type,label}` / `{srcLabel,rel,dstLabel}` 라 문서
   교환·검증에 쓸 정식 스펙이 없다. 실무 배치(`docs/source/batch_01_parsed.json`)는 이미
   `{id, doc_type, summary, entities[{name,type}], relations[{subject,predicate,object}]}` 형태로
   문서당 1레코드를 만들지만, 파이프라인은 이 규격을 산출·노출하지 않는다.
2. **문서 단위 정보가 사라진다.** v2는 의도적으로 doc 노드를 안 만든다("소스=씨앗, 그래프=진실").
   그래서 문서 요약·분류·발신/수신 같은 **문서 단위 메타와 근거(어떤 개체가 어느 문서에서 나왔나)**를
   담을 곳이 없다.

## 2. 목표 / 비목표

**목표(이번 이터레이션):**
- 문서당 표준 JSON 규격을 **정식 스펙으로 고정**하고 파이프라인이 그 규격을 산출·노출.
- **Document 노드 신설** — 문서 요약·분류(자유 LLM 라벨)·출처 메타 보관, 추출 개체와 `MENTIONS` 연결.
- 추출을 **1회 LLM 호출**로 유지(접근안 A) — summary·doc_type을 기존 graphextract 산출에 추가.

**비목표(이번엔 안 함):**
- **신규 포맷(hwp·csv·이미지 OCR/비전) — 스킵.** 기존 지원(eml·xlsx·pptx·docx·dxf) 유지.
- 파이프라인 단계 시각화 UI(원문→JSON→그래프 진행 표현) — 이번 범위 아님.
- 배치 다건 처리(폴더 통째) — 이번 범위 아님. 단건 업로드 경로 유지.

## 3. 표준 규격 (interchange JSON)

문서 1건 = 1레코드. `GET /api/v2/document/[id]` 및 인제스천 응답이 이 형태를 반환한다.

```json
{
  "id": "<원본 파일 경로/식별자>",
  "doc_type": "<자유 LLM 분류 라벨, 예: 견적·자료요청·원료소개>",
  "summary": "<1~2문장 한국어 요약>",
  "source": { "from": "", "to": "", "date": "", "subject": "" },
  "entities":  [ { "name": "정아라", "type": "인물" } ],
  "relations": [ { "subject": "정아라", "predicate": "소속", "object": "주식회사 성진" } ]
}
```

- `source`는 이메일 등 구조화 메타가 있을 때만 채운다(없으면 빈 문자열).
- `entities[].name`은 원문 표기 그대로, `type`은 LLM 라벨(범용).
- `relations`는 subject/predicate/object 라벨 참조(개체 name과 일치).

내부 추출 산출은 기존 `{type,label}`/`{srcLabel,rel,dstLabel}`을 유지하고, 표준 노출 시점에만
`label→name`, `srcLabel/rel/dstLabel→subject/predicate/object`로 매핑한다(무손실 리네임).

## 4. 데이터 모델 (Neo4j)

**신규 노드 레이블 `Document`:**
```
(:Document {
  id,          // 원본 파일 식별자(캔버스 내 유일). 재적재 시 upsert 키.
  doc_type,    // 자유 LLM 라벨
  summary,     // 1~2문장
  from, to, date, subject,  // 출처 메타(없으면 "")
  ingested_at  // ISO 문자열(서버가 채움)
})
```

**신규 관계 `MENTIONS`:** `(:Document)-[:MENTIONS]->(:Entity)` — 추출된 각 개체마다 1개.
근거 복원(어떤 개체가 어느 문서에서 나왔나)의 최소 형태.

**기존 유지:** `Entity`(결정적 id·dedup)·개체 간 관계·임베딩 — 변경 없음.

**제약/인덱스:** `Document.id` 유니크 제약을 `ensureSchema()`에 추가(기존 Entity 제약과 동일 패턴).

## 5. 추출 변경 (pyservice — 접근안 A)

`GRAPHEXTRACT_SYSTEM`(pyservice/main.py) 프롬프트에 문서 단위 2필드를 추가한다:

```
JSON만 출력:
{"summary":"<1~2문장>","doc_type":"<분류 라벨>",
 "entities":[{"type":"person","label":"김철수"}],
 "relations":[{"srcLabel":"김철수","rel":"소속","dstLabel":"아크메"}]}
```

- 응답 정규화(`_norm_extract`)에 `summary`·`doc_type` 통과 추가(문자열, 없으면 "").
- `max_tokens`는 현재 800(v11 배포됨). summary 추가분 여유 관찰 — 절단 재발 시 graphextract만 1200.
- `lib/llm.ts`의 `LlmExtractResult`에 `summary?: string`·`doc_type?: string` 추가.

## 6. 파이프라인 (`lib/ingest-v2/`)

`ingestFileToGraph(canvasId, fileName, buf)`:
1. 원문 추출(기존). eml이면 `parseEml`로 from/to/date/subject 확보(email.ts 이미 파싱함 — 필드만 노출).
2. `llmGraphExtract(text)` → `{summary, doc_type, entities, relations}`.
3. `extractToGraph`로 EntityInput/RelationInput 생성(기존).
4. **Document 노드 upsert** — id=fileName, summary·doc_type·source메타·ingested_at.
5. 엔티티 upsert(기존) → **각 엔티티에 `MENTIONS` 연결**(Document→Entity).
6. 개체 간 관계 upsert(기존).
7. 반환: 표준 레코드(§3) + `{entities, relations}` 카운트.

**순수/IO 분리 유지:** Document 메타 구성(파일명·source·summary→레코드)은 순수 함수로,
Neo4j 쓰기(`upsertDocument`·`linkMentions`)는 `canvas-repo`에.

## 7. API / 그래프 렌더

- `GET /api/v2/document/[id]?canvas=` → 표준 JSON(§3). 미존재 404.
- `GET /api/v2/graph` — Document 노드도 포함(`MENTIONS` 엣지와 함께). 프론트는 Document를
  별도 형상(예: 문서 아이콘/색)으로 렌더 — 문서가 개체를 묶는 허브로 보인다.
  ⚠ 그래프가 문서 노드로 붐빌 수 있으니, 그래프 응답에 노드 종류 플래그(`kind: "document"|"entity"`)를
  실어 프론트에서 토글 가능하게.
- 인제스천 응답(`/api/v2/ingest`)에 표준 레코드를 함께 반환(규격 실증).

## 8. 에러 처리

- LLM이 summary/doc_type 누락 → 빈 문자열로 적재(추출 자체는 성공 처리). 그래프는 여전히 유효.
- Document upsert 실패 → 해당 문서 `skipped`로 보고, 예외를 파이프라인 밖으로 던지지 않음(기존 정책).
- 기존 개체 없는 문서(개체 0) → Document는 만들되 MENTIONS 0. summary만 있는 문서도 근거로 남음.

## 9. 테스트

- `extract-to-graph.test.ts` 확장: summary/doc_type 통과, Document 레코드 구성 순수함수 검증.
- `pipeline.test.ts`(신규 또는 기존 확장): mock repo로 Document upsert + MENTIONS 호출 검증.
- pyservice: `_norm_extract`가 summary/doc_type 보존하는지 단위 검증(없을 때 "" 폴백).
- e2e(배포 후): `batch_01` 이메일 1건 업로드 → `GET /api/v2/document/[id]`가 §3 규격 반환 +
  그래프에 Document 노드·MENTIONS 등장.

## 10. 배포

- pyservice 프롬프트 변경 → pyservice v12. 앱 변경 → v2 앱 v5. `scripts/deploy-v2.py`로 원샷.
- 스키마: `ensureSchema()`가 `Document.id` 제약 추가 — 신규 캔버스 자동, 기존 캔버스는
  다음 인제스천 시 `ensureSchema` 재호출로 멱등 적용.
- 롤백=이미지 태그(`rollout undo`). Document 노드는 추가만 하므로 기존 개체 그래프 무영향.
