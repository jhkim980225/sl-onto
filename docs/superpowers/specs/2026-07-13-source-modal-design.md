# 근거 문서 미리보기 모달 창 + 표 렌더링 설계

- 날짜: 2026-07-13 · 상태: 승인(구두)
- 배경: 근거 문서 원문을 우측 패널에 텍스트 라인으로 보여줌 → 좁고 읽기 불편.
  사용자는 **모달 창**으로 크게 띄우고 xlsx는 **실제 표**로, 인용 부분(셀/텍스트)을 강조하길 원함.

## API (완료)

`GET /api/source-text` 의 xlsx 블록에 `rows?: string[][]`(그리드) 추가됨. lines(폴백 텍스트)도 유지.
블록: `{ label, lines: string[], rows?: string[][] }`.

## 컴포넌트 — components/SourceModal.tsx (신규)

props: `{ source: SourceInfo; highlightIds?: Set<string>; onClose: () => void }`.
- 오버레이 모달(기존 drawing-modal 패턴 — 배경 클릭·ESC 닫기, 화면 대부분 차지, 스크롤).
- 헤더: 파일명 + 크기·추출결과 + ✕ 닫기. 강조 안내("🔎 N곳 언급 강조").
- 본문: `/api/source-text?file=` fetch(마운트 시).
  - **xlsx(rows 있는 블록)**: `<table>` 렌더 — 첫 행을 헤더(th)로, 나머지 tr/td. **셀 텍스트가 강조 토큰
    부분매칭이면 그 `<td>`에 .cell-hl 강조**(셀 배경 시안). 첫 강조 셀로 스크롤.
  - **pptx/docx/pdf(lines)**: 블록 라벨 + 라인 목록, 라인 내 강조 토큰 `<mark>`(기존 SourcePreview 방식 재사용).
  - dxf: 도면 이미지(/api/drawing-svg) 크게 렌더.
  - 로딩·에러·미지원 상태.
- 강조 토큰: highlightIds 중 길이 2+ (기존 SourcePreview hlRegex 로직 재사용 — 이스케이프·긴토큰우선 alternation).

## Workbench 배선

- 근거 문서 열기(handleOpenEvidenceFile)가 우측 패널 SourcePreview 대신 **모달**을 연다.
  - 상태 `sourceModalOpen: boolean` 추가. handleOpenEvidenceFile: setSelectedSource + setSourceHighlight + setSourceModalOpen(true).
  - `rightPanelMode === "source"` 분기 제거(더는 패널로 안 봄). 모달은 최상위에서 `{sourceModalOpen && <SourceModal .../>}`.
- 기존 호출부(Inspector onOpenEvidence, Checklist, Condensation onOpenDoc, AskPanel onOpenDoc)는 시그니처 동일 —
  전부 모달로 열림(일관).
- SourcePreview.tsx 는 더 이상 렌더되지 않으면 제거(또는 남겨도 무방 — 우선 렌더 분기만 모달로 교체, 미사용 정리).

## CSS

`sm-` 접두: 모달 오버레이(drawing-modal 유사, 더 넓게 max-width 900), 헤더, 스크롤 본문,
표(`sm-table` — 얇은 보더, sticky 헤더, 셀 패딩), `.cell-hl`(셀 강조 시안 배경), `.ft-hl`(텍스트 mark 재사용).

## 범위 제외 (YAGNI)

원본 서식(폰트·병합셀 시각) 재현 · 페이지네이션 · 다운로드 · 표 정렬/필터.

## 완료 기준

- [ ] 근거 문서 클릭 → 모달 창 뜸(배경/ESC 닫기)
- [ ] xlsx = 표 렌더 + 인용 셀 강조 + 첫 강조 셀 스크롤
- [ ] pptx/docx/pdf = 텍스트 + mark 강조 · dxf = 도면 이미지
- [ ] tsc clean · build · 콘솔 0
