# review-notes.md — 코드 리뷰 반영 기록

에이전트 코드 리뷰(lib·api·components 전수) 결과와 조치. 2026-07-03.

## 확정 수정
| # | 심각도 | 위치 | 결함 | 조치 |
|---|---|---|---|---|
| 1 | HIGH | `lib/search.ts` | 무매칭 쿼리에서 `hits[0].score` → TypeError → `/api/search` 500 | 빈 hits 가드 추가 → `{hits:[],neighbors:[]}` 반환. **라이브 200 확인** |
| 3 | LOW | `lib/infer.ts` `collectDocs` | 근거 문서를 `tv.objects`·`tv.docs` 양쪽 카운트 → "탐색 객체" 통계 부풀림 | `tv.objects.add` 제거(문서는 docs 카운터만) |
| 5 | LOW | `lib/ingest/index.ts` | 빈 weight 셀이 `Number("")===0` 으로 저장 → SIMILAR 유사도 0 붕괴(잠재) | 빈/누락 → `undefined`(infer 폴백 0.5 유지) |
| 2 | LOW-MED | `components/Workbench.tsx`·`SourcePanel` | `/api/sources` 빈 배열 시 "불러오는 중…" 고착·패널 모순 | 로딩/에러 상태로 분기 → "합계 0건 (시드 폴백)" 표시. 반영 완료 |

## 보류
| 4 | LOW | `Graph.tsx`/`Workbench.tsx` 타이머 | 언마운트 시 setTimeout 미정리 | reset이 `location.reload()` 라 실질 영향 낮음 — 보류(추후 cleanup) |

## 리뷰에서 clean 확인
- 골든 룰: 모든 체크항목이 근거+확신도 보유(근거·경로 없으면 필터), UI에 하드코딩 온톨로지 없음.
- store→ingest→seed 폴백 정상(빈/예외 시 seed).
- API ↔ `lib/types.ts` 계약 일치, 에러 경로(404/400) 정상, 그래프 SVG effect 스테일 클로저·레이스 없음.
- `traverse()`(store), `SearchHit.matched`(UI) 미사용 — 데드코드 수준, 결함 아님.
