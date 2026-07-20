# 캔버스 내 문서 CRUD — 설계

> 작성일: 2026-07-20 · 서브프로젝트 2
> 전제: 서브프로젝트 1(캔버스 골격) 완료 — `docs/superpowers/specs/2026-07-20-multi-canvas-design.md`

## 1. 목표

캔버스 안에서 문서를 **등록·수정(교체)·삭제**할 수 있게 한다.

현재 상태:

| | 상태 |
|---|---|
| 등록 | ✅ `POST /api/ingest` — 이미 캔버스 스코핑됨 |
| 수정 | ❌ 경로 없음 |
| 삭제 | ❌ DB·store·API·UI 어디에도 없음 |

## 2. 핵심 제약 — 엣지에 출처가 없다

```ts
// lib/types.ts:29
export interface Edge { src: string; rel: string; dst: string; weight?: number; scen?: boolean }
```

노드는 `EVIDENCED_BY` 로 근거 문서가 추적되지만 **엣지는 출처를 남기지 않는다**.
따라서 "이 문서가 만든 엣지"를 정확히 특정할 수 없다.

### 채택한 삭제 규칙 — 근거 없는 노드만 제거

```
1. doc:<파일명> 노드 삭제        → EVIDENCED_BY 엣지가 FK CASCADE 로 사라진다
2. 남은 근거가 0이 된 노드 삭제   → 그 노드의 엣지도 CASCADE
3. 다른 문서가 받치는 노드는 유지
4. sources 행 삭제(원본 바이트 포함)
```

**골든 룰 1(근거 우선)의 직접적 표현이다** — 근거가 사라진 객체는 남을 이유가 없다.

**알려진 한계**: 그 문서가 만들었지만 양끝 노드가 다른 문서에도 근거를 둔 엣지는 남는다.
응답에 `keptEdges` 수를 실어 사용자가 알 수 있게 한다.
`// ponytail: 엣지 출처 미추적. 남는 엣지가 실제 문제가 되면 edges.props 에 docs[] 를 기록하고 정확 삭제로 전환.`

기각안:
- **엣지 출처 기록 후 정확 삭제** — 기존 179노드/2198엣지는 출처가 없어 소급 불가. 신규 문서에만
  정확해지는 절반짜리라 규칙이 두 개가 된다.
- **삭제 후 전체 재인제스천** — 정확하지만 느리고 수동 큐레이션(병합·삭제)이 전부 날아간다.

## 3. 수정 = 교체(재인제스천)

같은 파일명에 새 파일을 올리면 **삭제 후 재등록**한다. 별도 로직을 만들지 않는다 —
삭제와 등록이 이미 있으므로 합성으로 충분하다.

원자성: 한 요청 안에서 `삭제 → 인제스천` 을 순차 수행한다. 인제스천이 실패하면 문서가
사라진 상태로 남으므로, **파싱을 먼저 하고 성공했을 때만 삭제·병합**한다.

## 4. API

```
DELETE /api/sources/[file]?canvas=<id>
  200 { ok: true, removed: { doc: 1, nodes: N, edges: M }, keptEdges: K }
  404 { error: "문서를 찾을 수 없습니다" }

PUT /api/sources/[file]?canvas=<id>       (multipart/form-data, field=file)
  200 { ok: true, replaced: true, removed: {...}, added: { nodes, edges } }
  400 { error }  — 확장자·크기 위반, 파싱 실패
  409 { error, needsSchema: true }  — 빈 스키마 캔버스
```

`[file]` 은 URL 인코딩된 파일명. 경로 구분자·`..` 는 거부한다(디렉터리 탈출 방지 —
`app/api/drawing-svg/route.ts` 의 기존 검증과 같은 방침).

**베이스라인 문서 보호**: `data/sources/` 에서 온 문서도 삭제 가능하다. 캔버스는 사용자
작업 공간이고, `default` 캔버스를 초기화하려면 DB를 비우고 재기동하면 된다(기존 절차).

## 5. 도메인 로직 — `lib/documents.ts` (신규)

```ts
/** 문서 1건과 그에 딸린 고아 객체를 제거. @returns 제거·유지 통계 */
export async function deleteDocument(file: string): Promise<DeleteResult | null>
```

절차:

1. `getNode("doc:" + file)` — 없으면 `null`(404)
2. `inEdges(docId)` 에서 `EVIDENCED_BY` 소스 노드 수집 = 이 문서가 근거인 객체들
3. 각 후보에 대해 `evidenceOf(id)` 가 이 문서 **하나뿐**이면 삭제 대상
4. `removeNode(docId)` → `removeNode(각 고아)` (store 가 write-through, 엣지 CASCADE)
5. `db.deleteSource(file)` — `sources` 행 + `content` 바이트
6. 남은 엣지 수 계산해 `keptEdges` 로 보고

**삭제 순서 주의**: 고아 판정을 먼저 **전부** 계산한 뒤 삭제한다. doc 노드를 먼저 지우면
`evidenceOf` 결과가 바뀌어 판정이 어긋난다.

## 6. UI

좌측 레일에 **`📄 문서`** 드로어를 추가한다(`components/DocumentPanel.tsx`).

```
📄 문서 (3)
  □ FMEA_HL30.xlsx        ⟳  ✕
     12객체 / 9관계
  □ 8D_결로.pptx           ⟳  ✕
     6객체 / 4관계
  [+ 문서 등록]  ← 기존 인제스천 패널 열기
```

- `⟳` 교체 → 파일 선택 → `PUT`
- `✕` 삭제 → 확인 다이얼로그(**제거될 객체 수 명시**) → `DELETE`
- 삭제 후 그래프에서 해당 노드 제거 + 카운터 갱신

기존 `IngestPanel`(우측 `📥 문서 인제스천`)은 **등록 전용으로 유지**한다. 목록·수정·삭제는
좌측 드로어가 담당 — 등록은 드래그앤드롭 중심이라 넓은 우측 패널이 맞고, 관리는 목록
중심이라 좌측 드로어가 맞다.

## 7. 에러 처리

| 상황 | 처리 |
|---|---|
| 없는 문서 삭제 | 404 |
| 파일명에 `/`·`\`·`..` | 400 (경로 탈출 차단) |
| 교체 시 파싱 실패 | 400, **원본 유지**(파싱 성공 후에만 삭제) |
| 빈 스키마 캔버스에 교체 | 409 + `needsSchema` |
| 삭제 도중 DB 실패 | store 는 write-through — DB 커밋 실패 시 메모리 미변경 |
| 인메모리 모드 | 삭제·교체 모두 동작(메모리만). `sources.content` 는 DB 전용이라 무시 |

## 8. 테스트

| 파일 | 검증 |
|---|---|
| `lib/documents.test.ts` | 고아 판정 — 근거 1개(이 문서)면 삭제, 2개 이상이면 유지 · doc 노드 먼저 지우면 판정이 깨진다는 순서 회귀 · 없는 문서면 null |

수동(실행) 검증:

1. 캔버스에 문서 2건 인제스천 → 공유 노드가 생기는지 확인
2. 1건 삭제 → 공유 노드는 살아있고 전용 노드만 사라지는지
3. 나머지 1건 삭제 → 캔버스가 비는지
4. 교체 → 객체 수가 새 파일 기준으로 바뀌는지
5. 파싱 실패 파일로 교체 시도 → 400 + 원본 유지

## 9. 범위 밖

- 엣지 출처 추적(정확 삭제)
- 문서 버전 이력·롤백
- 캔버스 간 문서 이동
- 추출 결과 개별 편집(기존 `/api/curate` 가 일부 커버)
