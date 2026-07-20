# feature: FMEA 초안 문서 생성

> **레거시 — FMEA 전용.** 이 기능은 동작하지만 신규 투자 대상이 아니다.
> FMEA 객체타입(`fm`·`cause`·`item` 등)을 하드 가정하므로 `default`(램프) 캔버스에서만 쓸 수 있고,
> 다른 캔버스에서는 `lib/capabilities.ts` 가 409 로 막는다.
> 제품의 현재 방향은 [../../README.md](../../README.md) 참조.

신규 설계 조건 + 온톨로지 탐색으로 **채워진 DFMEA 워크시트(xlsx)** 를 생성·다운로드한다.
과제 요구 "설계 조건별 **맞춤형 FMEA 초안 생성**"에 대응하는 실제 업무 산출물.

## 산출물
설계 FMEA 워크시트(13컬럼): `No · 부품/기능 · 잠재적 고장모드 · 잠재적 고장의 영향 · 심각도(S) ·
잠재적 고장원인 · 발생도(O) · 현행 설계관리(예방) · 현행 설계관리(검출) · 검출도(D) · RPN · 우선순위 · 권고 조치사항 · 근거`
+ 타이틀 블록(대상·설계조건·작성일)과 요약 행.

## 로직 (`lib/fmea-draft.ts`)
- **대상 부품**: `anchorItem`(부품 앵커 — 그래프에서 item 선택 후 추론) 있으면 그 부품(+구성)으로
  하드 스코프(파일명에도 반영), 없으면 `components` → item 노드 + 그 구성(`CONSISTS_OF`).
  그것도 없으면 헤드램프 어셈블리 기본. 라벨 정확 일치 우선.
- 각 item → `HAS_FAILURE` 고장모드 → `CAUSED_BY` 원인. fm 에서 S(`심각도 S`), 원인에서 O(`발생도 O`)/D(`검출도 D`, 기본 5).
- **RPN = S × O × D**, 우선순위(높음 ≥125 / 중 ≥60 / 낮음).
- 현행 설계관리(예방) = `REF_MASTER` 마스터 참조, 권고조치 = `MITIGATED_BY` 조치(상위 3), 근거 = `EVIDENCED_BY` 문서.
- **조건 부스트**: 슬림→수축 원인, LED→방열/배광 관련 발생도(O) +1.
- **정제(중요)**: FMEA 초안은 **큐레이션 백본(비-AUTO)만** 사용 — auto-create 벌크 엔티티는 조합 링크 노이즈가 있어 제외.
  fm-원인 중복 제거 · 원인 3/행·조치 3/행·총 40행 상한. → 사리에 맞는 ~13행 초안.
- **마스터 대조 요약**: 워크시트 하단에 `infer(input).masterAudit` 커버/누락/미확인 행
  (설계표준 필수 항목 커버리지 — [그래프-추론.md](그래프-추론.md) 참조).

## API
- `POST /api/fmea-draft` (body: `DesignInput`) → `application/vnd...spreadsheetml.sheet` 첨부 다운로드
  (`Content-Disposition: attachment; filename*=UTF-8''FMEA초안_...xlsx`). SheetJS(`xlsx`)로 생성.

## UI
- STAGE 3 체크리스트 패널 헤더에 **"📄 FMEA 초안 다운로드 (xlsx)"** 버튼(`components/Checklist.tsx` `downloadFmea`).
  현재 신규 설계 조건으로 POST → blob → 브라우저 다운로드.

## 확장
- DOCX 리포트 형식 추가, 셀 서식(RPN 색상·테두리; `xlsx-js-style`), 조치결과/재RPN 열, LLM 기반 설명 문구 생성.
