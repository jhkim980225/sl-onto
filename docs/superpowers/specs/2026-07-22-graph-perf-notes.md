# 그래프 성능 — 진단 기록 + 유보 항목

> 2026-07-22 · v82 배포 시점. 조사관 3(렌더·메모리·페이로드) 병렬 진단 종합.

## 결론 요약
"객체 노드 많아 느림"의 실체는 **클라이언트 CPU**(힘 시뮬 루프)이지 메모리·전송이 아니다.

| 계층 | 병목? | 근거 |
|---|---|---|
| 클라 시뮬 루프 | ⭐ **주범** | `Graph.tsx` alpha 바닥 0.12 → 수렴 후에도 rAF 로 영구 `tick()+render()` 60fps |
| 메모리 | ❌ 아님 | 임베딩·청크 인메모리 미적재(`loadAll` 이 id/type/label/props 만 SELECT), 180노드 ≈ 100KB |
| 페이로드 | ❌ 아님 | `/api/ontology` 17.4KB gzip(201KB raw), 노드에 임베딩 미포함 |

## v82 에서 처리한 것 (`fc55928`)
힘 시뮬 alpha 바닥 `0.12→0` + `loop()` 이 `alpha ≤ REST(0.12)` 면 `tick()/render()` 스킵.
rAF 는 계속 살려둬(빈 콜백 ~0 비용) 인터랙션의 alpha 재가열이 다음 프레임 자동 재개 — wake 배선 불필요.
정착 시점·모션·시각은 그대로, "정착 후 영구 burn" 꼬리만 제거. 정착 후 CPU ~0.

## 유보 항목 (지금 불필요 · 스케일 트리거 도달 시)
루프 정지로 180노드 기준 아래는 다 무해해졌다. **그때 오면 착수**, 지금은 YAGNI.

| 항목 | 위치(진단 시점) | 트리거 | 개요 |
|---|---|---|---|
| O(n²) 반발 → Barnes-Hut/쿼드트리 | `Graph.tsx` tick 전쌍 루프(≈380-399) | 노드 **500+** | 공간 인덱스로 O(n log n). d3-force 참조 |
| 엣지 뷰포트 컬링 | `render()` 전 엣지 setAttribute(≈469-494) | 엣지 **5000+** | 화면 밖 엣지 DOM 갱신 스킵 |
| 프레임당 배열 스프레드·hero find 제거 | `[...edges,...scenEdges]`(≈400,475), hero find(≈489) | 활성 모션 중 GC 튈 때 | 스프레드 1회 캐시 + hero 참조 보관. 정착 후엔 안 돌아 우선순위 낮음 |
| `/api/ontology` 응답 캐시·ETag | `app/api/ontology/route.ts` `JSON.stringify`+`gzipSync` 매 요청 | 서버 스루풋 문제 | 그래프 불변 시 재직렬화·재압축 회피. `gzipSync` 이벤트루프 블로킹도 비동기화 |
| store 재빌드 GC 압박 | `store.ts` syncFromDb→rebuildIndex(2s TTL) | 동시 요청 급증 시 | 매 재동기화가 전 노드/엣지 새 객체 재생성 |
| 캔버스 캐시 LRU·memo 무효화 | `store.ts` CACHES(LRU 없음) · `graph-memo.ts`(삭제 시 무효화 없음) | 캔버스 수 누적 | 삭제 캔버스 캐시·memo 미회수 소량 누수 |

## 주의
`Graph.tsx` 포스 그래프는 **재작성 금지**(CLAUDE.md 컨벤션) — 자체 물리엔진. 위 항목 전부 국소 추가로 가능.
