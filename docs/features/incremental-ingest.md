# feature: incremental-ingest — 증분 인제스천 시연

살아있는 온톨로지에 **새 문서 1건을 업로드하면 델타만 파싱·병합**되어 그래프에 실시간 합류한다.
"버튼 누르면 전체 생성"(데모 연출)이 아닌 **실제 운영 파이프라인의 축소판**을 보여주는 탭.

## 흐름
상단 "📥 문서 인제스천" 탭(온톨로지 구축 후 활성) → 파일 드롭(.xlsx/.pptx/.docx, ≤10MB) 또는
**"샘플 문서로 시연"** → 결과: `새 객체 N · 새 관계 M · 기존 객체 연결 K · 전체 객체 totals` +
원문→표준 매핑·확신도 미리보기 → 그래프에 새 노드가 유형 구역 근처에 스폰(백본 뷰에서도 표시) → 좌측 원천 목록 갱신.

## 백엔드
- `lib/ingest/index.ts` `ingestOne(filePath, fileName)` — 단일 파일을 기존 파이프라인(정형 브랜치+휴리스틱+자유텍스트 폴백)으로 파싱.
- `lib/store.ts` `mergeDelta(nodes, edges)` — 인메모리 인덱스에 증분 병합. **멱등**(같은 파일 재병합 → 빈 델타).
  기존 노드는 덮어쓰지 않음(원본 보존). `registerSource`/`getRuntimeSources` 로 `/api/sources` 에 런타임 파일 노출.
- `POST /api/ingest` — multipart `file` 업로드 또는 `{"sample":true}`.
  샘플은 `lib/ingest/sample.ts` 가 SheetJS 인메모리 생성(안개등램프·리어시그널램프 2종 로테이션, 소진 시 `alreadyIngested`).
  샘플엔 **신규 엔티티(auto-create 0.66)와 기존 엔티티 해소(아우터 렌즈 0.95)** 가 함께 들어 있어 두 능력을 동시 시연.
- 응답: `{ ok, file, source, delta:{nodes,edges,updated}, totals }`.

## 프론트
- `components/IngestPanel.tsx` (우측 패널 모드 "ingest") + Workbench 배선.
- `Graph.addDelta(nodes, edges)` — 유형 centroid 근처 결정적 시드 + spawn/pulse, **백본 뷰에서도 세션 추가분은 표시**,
  doc 노드는 캔버스 제외. 카운터(객체/관계/표시 중) 갱신.

## 검증 (2026-07-05)
- 샘플: 새 객체 8·관계 9·기존 연결 3, 카운터 170→179 / 표시 중 34→42, 미리보기에 신규(크레이징 66%)+해소(아우터 렌즈 95%).
- 멱등: 재요청 → 두 번째 샘플 → `alreadyIngested`. 실무 파일 multipart 업로드 동작. `npm test` 24 pass.

## 한계 (정직)
- **인메모리 단일 프로세스** — 멀티 레플리카에선 업로드가 한 파드에만 반영. 클러스터 데모는 replicas=1 또는 sticky session.
  재기동 시 업로드분 소실(data/sources 원본만 재구축). 영속화는 Postgres 교체 지점.
