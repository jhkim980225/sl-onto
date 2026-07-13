# 원천 파일 전체 원문 뷰 + 언급 강조 설계

- 날짜: 2026-07-13 · 상태: 승인(구두)
- 배경: 근거 문서 미리보기가 정형화 발췌(preview 6행)만 보여줌. 사용자는 **실제 파일 원문 전체**를
  보고 답변이 언급하는 부분이 그 안에서 강조되기를 원함.
- 방향: 파일 원문(전체 텍스트)을 렌더하고, 답변 인용 라벨(대상 객체·고장모드 등)에 해당하는
  텍스트를 `<mark>` 강조. 기존 정형화 매핑은 접이식 보조 섹션으로 유지.

## 데이터 소스

- 베이스라인 파일: 컨테이너 디스크 `process.cwd()/data/sources/<file>`.
- 업로드 파일: Postgres `sources.content` BYTEA (베이스라인은 NULL).
- 파서(전체 내용): xlsx `readWorkbookGrids`(행×열), pptx `readDeck`(슬라이드 lines),
  docx `readDoc`(문단), pdf pyservice `/parse`(텍스트+표). dxf 는 도면 뷰(이미지) 유지 — 원문 텍스트 없음.

## API — GET /api/source-text?file=<name>

- 파일 위치: 디스크(data/sources) 우선, 없으면 DB content(getSourceContent) → 임시파일(withTempFile).
- 추출 → `{ file, format, blocks: { label: string; lines: string[] }[] }`:
  - xlsx: 시트별 블록(label=시트명), lines = 각 행 셀을 " │ " 로 조인(빈 행 제외).
  - pptx: 슬라이드별 블록(label="슬라이드 N"), lines = 슬라이드 텍스트 라인.
  - docx: 단일 블록(label="본문"), lines = 문단.
  - pdf: pyservice /parse → 블록 label="본문", lines = text 개행 분리 + 표는 행 조인. pyservice 미가용 503.
  - dxf: 415(도면은 기존 이미지 뷰 사용) 또는 blocks=[] + note.
- 404 파일 없음, 415 미지원, 503 pdf pyservice 미가용. 실패해도 서버 안 죽음.
- 라인 수 상한(예: 파일당 2000행) — 폭주 방지, 초과 시 잘림 표기.

## db.ts

`getSourceContent(file: string): Promise<Buffer | null>` — sources.content 조회(없거나 NULL이면 null).

## 프론트 (SourcePreview)

- 열릴 때 `/api/source-text?file=` fetch. 로딩/에러/미지원(dxf·pdf미가용) 상태.
- 블록 렌더: 블록 라벨 + 라인 목록(모노스페이스, 스크롤). 각 라인에서 **강조 라벨 토큰**이
  부분문자열로 나오면 `<mark class="ft-hl">` 로 감쌈(대소문자·공백 관대, 여러 개).
- 강조 토큰 = highlightIds 중 라벨류(사람 텍스트). id(FMFOG 등)는 원문에 없어 무해 — 전부 시도.
- 첫 강조 라인으로 자동 스크롤 + "N개 언급 강조" 안내.
- 기존 정형화 매핑(DoclingPreviewList)은 `<details>` "정규화 매핑" 접이식으로 하단 유지.
- dxf 는 기존 도면 이미지 뷰 그대로(원문 텍스트 없음).

## 범위 제외 (YAGNI)

- 원본 서식(폰트·색·표 렌더) 재현 — 텍스트만. xlsx 표는 셀 조인 텍스트.
- 페이지네이션·검색창 · 원본 파일 다운로드.

## 완료 기준

- [ ] /api/source-text 가 xlsx/pptx/docx/pdf 원문 블록 반환(디스크·DB 양쪽)
- [ ] SourcePreview 가 원문 전체 렌더 + 인용 라벨 `<mark>` 강조 + 첫 강조 스크롤
- [ ] 정형화 매핑 접이식 유지 · dxf 도면 뷰 유지 · tsc clean · build · 콘솔 0
