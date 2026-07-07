# skills.md — 빌드에 쓸 Claude 스킬

이 프로젝트를 만들 때 사용하는 Claude Code 스킬과 시점. (도메인 규칙은 [../CLAUDE.md](../CLAUDE.md))

## 1. 프로세스 스킬 (순서)
| 스킬 | 시점 | 상태 |
|---|---|---|
| `superpowers:brainstorming` | 착수 전 요구·설계 정렬 | ✅ 완료 → `requirements.md` |
| `superpowers:writing-plans` | 요구 확정 후 단계별 구현 플랜 | ▶ 다음 |
| `superpowers:test-driven-development` | `lib/` 도메인 로직(검색·추론) 구현 시 | 대기 |
| `superpowers:systematic-debugging` | 버그·예상외 동작 발생 시 | 필요 시 |
| `superpowers:verification-before-completion` | 완료 선언 전 실제 동작 검증 | 종료 전 |
| `code-review` / `review` | 변경 diff 리뷰 | 커밋 전 |

## 2. 구현 스킬
| 스킬 | 용도 |
|---|---|
| `frontend-design` | 데모 이식/폴리시 시 UI 품질 유지(디자인 토큰은 `design.md`) |
| `nextjs-developer`(에이전트) | Next 페이지·Route Handler·빌드 |
| `run` / `verify` | 앱 실제 구동·변경 동작 확인 |

## 3. 적용 원칙
- `lib/search.ts`, `lib/infer.ts`는 순수 함수 → **TDD로** 먼저 테스트(입력 조건→기대 체크리스트) 후 구현.
- UI 이식은 재작성이 아니라 데이터 배선 교체 → `frontend-design`은 폴리시 단계에서만.
- 완료 전 `verification-before-completion`으로 3단계 흐름을 실제 클릭해 확인.

## 4. 커스텀 프로젝트 스킬 후보 (확장기)
- `seed-ontology` — 시드 데이터를 갱신/검증(스키마 일치, 근거 링크 무결성).
- `add-object-type` — 새 객체/관계 유형 추가 시 색 토큰·범례·스키마 일괄 반영.
- `deploy-to-cloud` — 회사 클라우드 이미지 빌드·푸시 표준 절차.
> MVP에선 만들지 않는다. 반복이 확인되면 `skill-creator`로 생성.
