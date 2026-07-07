# feature: ontology-store — 온톨로지 저장소

## 책임
객체·관계·근거를 영속하고, 조회/이웃탐색 원시 연산을 제공. 스키마는 [../data-model.md](../data-model.md).

## 모듈: `lib/store.ts` (인메모리)
```ts
type Node = { id:string; type:ObjType; label:string; sub?:string; hero?:boolean; props?:[string,string][] }
type Edge = { src:string; rel:string; dst:string; weight?:number; scen?:boolean }

// 조회
getNode(id): Node | undefined
allNodes(): Node[]                    // search/nlsearch 공용
allEdges(): Edge[]
getGraph(opts?): { nodes:Node[]; edges:Edge[] }   // stage: 'core'(문서 제외)|'all'
getObject(id): { ...Node; relations:Rel[]; evidence:Doc[] } | null
neighbors(id, opts?): Node[]          // rel 필터·방향 옵션
traverse(startId, relPath[]): Node[]  // 추론용 경로 탐색
evidenceOf(id): Doc[]                  // EVIDENCED_BY doc
outEdges(id) / inEdges(id) / deg(id)  // 원시 접근자
```

## 동작
- **모듈 로드 시** `ingestAll()`(data/sources 파싱) 결과로 인덱스 구축. 노드가 0이거나 예외면 `lib/seed.ts` 폴백
  (컨테이너 무상태 배포 안전). `initStore()` 같은 명시 호출은 없음 — 모듈 부수효과로 1회 구축.
- `byId`/`outMap`/`inMap`/`degree` 인덱스를 미리 만들고, **양끝 객체가 존재하는 링크만** 채택(무결성).
- `getGraph({stage})`로 코어/근거문서 부분 반환(스테이지 스트리밍 지원).
- `getObject`는 in/out 관계를 합쳐 인스펙터용으로 정리.

## 불변식
- 모든 `doc`는 정확히 하나의 부모에 `EVIDENCED_BY`로 연결(고아 근거 금지).
- `links.src/dst`는 존재하는 `objects.id`만 참조(무결성).
- 매핑 필드(`original_code`/`mapped_code`/`confidence`)는 있으면 함께 반환.

## 확장 이음새
- 인메모리 → Postgres: 이 모듈 구현만 교체, 시그니처 유지.
- 인제스천 → Docling: `ingestAll()` 출력 형태만 맞추면 store 무변경.

## 규모 (인제스천 결과)
- data/sources(약 34개) 인제스천 → **≈170 노드 / 2,156 엣지**(auto-create 포함). 폴백 시 seed 규모(≈275 노드).

## 테스트
- `getObject('IHL')` 관계에 `HAS_FAILURE→FMBEAM` 포함.
- 무결성: 모든 링크 양끝 객체 존재, 모든 doc 부모 존재.
