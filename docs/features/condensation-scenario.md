# feature: condensation-scenario — 결로·습기 지역별 시연

아우터 렌즈(ILENS)의 **결로·습기(FMFOG)** 를 축으로, **지역(아시아·유럽·북미·중국)** 을 선택하면
지역별 상세 정보와 **설계도(단면도)** 가 나오는 시연 시나리오. 온톨로지 백본에 "지역 축"을 얹는다.

## 왜 온톨로지 기반인가
앵커가 전부 실제 온톨로지 노드다: `ILENS`(아우터 렌즈)·`IHSG`(하우징)·`FMFOG`(결로·습기)·
`CVENT`(벤트·씰링)·`AVENT`(벤트 경로 개선) + 지역 규제 `RKR/REU/RUS/RCN`. 근거 문서도 실파일
(`품질리포트_결로.docx` 등)을 `EVIDENCED_BY` 로 끌어온다.

## 데이터 (`lib/scenario/condensation.ts`)
- `REGIONS: Record<RegionKey, RegionInfo>` — asia·europe·na·china.
- 각 지역: 기후·습도 프로파일 · 위험도 · 적용 규제(온톨로지 reg id) · 근본원인 · 시험방법 · 권장 대책 · **설계도 스펙**.
- `condensationDetail(region)` — 지역 데이터 + 온톨로지 조회(getObject/evidenceOf) 결합.

### 설계도 스펙(지역별 주석 토글)
`DrawingSpec` boolean 플래그로 단면도 주석을 켠다:
| 지역 | 주요 대책(설계도) |
|---|---|
| 아시아 | 벤트 용량 확대 ×2 · 하부 드레인 · 발수 코팅 |
| 유럽 | 렌즈 히팅 코일 · 이중 개스킷 · IPX9K |
| 북미 | 소수성 멤브레인 브리더 · 상·하 벤트 |
| 중국 | 방진 멤브레인 벤트 · 강화 개스킷 · 드레인 |

## API (`app/api/condensation/route.ts`)
- `GET /api/condensation` → 지역 목록.
- `GET /api/condensation?region=asia` → `CondensationDetail`(앵커·지역상세·규제객체·근거·설계도 스펙).

## UI (components/)
- 인스펙터에서 `ILENS`/`FMFOG` 선택 시 "🌫 결로 지역별 분석 →" 진입.
- 지역 탭 → 상세(기후·습도·위험·규제·원인·시험·대책) + 근거/조치 클릭 시 그래프 선택.
- **설계도**: 헤드램프 단면 SVG(아우터렌즈·하우징·LED·씰링·방수벤트·드레인·결로영역) + 지역별 주석 변형.

## 확장
- 실 도면(CAD/PDF) 연동 시 SVG 단면을 실도면 뷰어로 교체(주석·핫스팟은 온톨로지 링크 유지).
- 지역 축을 다른 고장모드(배광·휘도)로도 일반화 가능.
