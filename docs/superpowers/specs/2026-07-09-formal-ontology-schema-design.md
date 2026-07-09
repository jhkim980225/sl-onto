# 형식 온톨로지 1차 — 스키마 형식화 설계

- 날짜: 2026-07-09 · 상태: 승인(구두) · 단계: 1/2 (2단계 = 실데이터 대비 파이프라인, 별도 스펙)
- 배경: 현재 온톨로지는 "타입 달린 그래프" — 관계 domain/range 제약 없음(빈 배열), 속성 스키마 없음,
  분류 계층 없음. 과제 실전(실제 SL 데이터) 대비 형식 온톨로지로 승격한다.
- 정책 결정(확정): 위반은 **경고+큐레이션**(차단 없음) · 서브타입 **단층 도입** · **RDF Turtle 내보내기 포함**.

## A. 메타모델 확장 (DB)

### A-1. 관계 domain/range
`lib/db/seed-metamodel.ts`의 `RELATION_TYPES`에 실제 `src_types`/`dst_types` 채움:

| rel | src | dst |
|---|---|---|
| HAS_FAILURE | item | fm |
| CAUSED_BY | fm | cause |
| MITIGATED_BY | fm, cause | action |
| EVIDENCED_BY | (전 타입) | doc |
| REF_MASTER | item, proj, action | master |
| UNDER_REG | item, proj | reg |
| DRL_REG | item, proj | reg |
| CONSISTS_OF | item | item |
| OCCURRED_IN | fm | proj |
| SIMILAR | item, proj | item, proj (대칭) |
| THERMAL_RISK | item, cause | fm, item |
| SPEC_OF | spec | proj, item |
| NEW_DESIGN_OF | proj, item | item, proj |
| TARGET_MARKET | proj | reg |

- `EVIDENCED_BY`처럼 "전 타입 허용"은 빈 배열 유지(빈 배열 = 제약 없음 관례 유지).
- 기존 DB 마이그레이션: 시드는 `ON CONFLICT DO NOTHING`이라 기존 행이 빈 배열로 남음 →
  `ready()`에서 **src_types/dst_types가 비어 있고 시드에 값이 있으면 UPDATE** (스키마 편집 UI 없으므로 안전).
- 실데이터에 위 표 밖의 조합이 실제로 있으면(검증 리포트로 발견) 표를 넓힌다 — 표가 데이터를 이긴다는 태도 금지.

### A-2. 서브타입 (단층 분류)
- 새 테이블 `object_subtypes(type_id, st_id, label_ko, keywords TEXT[], description)`. PK=(type_id, st_id).
- **노드의 기존 `sub` 필드는 자유 요약 텍스트라 재사용 불가** → 새 필드 `st`(선택)를 Node에 추가,
  `nodes.props` JSONB에 저장(스키마 변경 없음).
- 시드 분류체계(키워드 포함, 라벨 매칭용):
  - item: 광원(LED·벌브·레이저), 광학(렌즈·리플렉터·이너렌즈·아우터렌즈), 하우징·기구(하우징·브라켓·베젤·씰·벤트), 전장(드라이버·PCB·커넥터·와이어), 모듈·어셈블리(어셈블리·모듈)
  - fm: 광학계(광도·배광·눈부심·색), 열계(과열·변형·수축·크랙), 환경계(결로·습기·부식·침수), 전장계(단선·쇼트·플리커·오작동), 기구계(진동·소음·이탈·파손)
  - cause: 설계(공차·형상·재질선정), 재료(재질·열화), 공정(성형·조립·용접), 환경(온도·습도·진동·염수)
  - action: 설계변경, 재질변경, 검증시험, 공정개선
  - reg: 북미(FMVSS·SAE·DOT), 유럽(ECE·UNECE), 기타
  - proj/master/spec/doc: 분류 없음(1차)
- **자동 분류기** `lib/schema/classify.ts`: 라벨+props 텍스트에 키워드 매칭 → `st` 부여.
  인제스천 시 + 부팅 백필(st 없는 노드) 실행. 미분류는 위반 아님(탐색기에서 "미분류" 그룹).
- 원본 보존: 분류는 `st`에만 기록, label/props 불변.

### A-3. 속성 정의
- 새 테이블 `property_defs(type_id, key, label_ko, datatype, required)`. PK=(type_id, key).
  datatype ∈ text | number | enum(옵션은 options TEXT[]).
- 시드(최소, 실데이터 보며 확장): item — 재질(text)·수량(number), reg — 지역(enum: 북미/유럽/한국/글로벌),
  fm — 심각도(number, 선택). required는 1차에서 전부 false 시작(실무 문서 필드 채움율 낮음 —
  required 남발하면 위반 폭주). 예외: doc 제외 전 타입 "근거 연결"은 기존 no-evidence 규칙이 담당.
- 노드 `props`는 자유 [key,value] 배열 유지 — 정의된 key만 datatype 검증 대상.

## B. 검증 엔진

`lib/schema/validate.ts` (순수 함수) — `scanQuality()`에 규칙 추가, `QualityKind` 확장:

| kind | 내용 | confidence |
|---|---|---|
| `rel-domain` | 엣지 src/dst 타입이 relation_types 제약 밖 | 85 |
| `bad-subtype` | `st` 값이 object_subtypes에 없음 | 80 |
| `missing-prop` | required 속성 누락 | 60 |
| `bad-datatype` | number 정의 key에 비수치 값 등 | 70 |

- 기존 관례 유지: 규칙당 상한 8건·확신도 임계 40·`QualityIssue` 형태 재사용(엣지 위반은 nodeId=src).
- 처리(큐레이션): 기존 /api/curate 삭제·병합 재사용 + **관계 삭제**(rel-domain용, persistDeleteEdge 이미 있음).
- 인제스천 차단 없음. 메타모델은 store 부팅 시 DB에서 로드해 인메모리 캐시(기존 패턴).

## C. RDF Turtle 내보내기

- pyservice `POST /export` (rdflib): 입력 = {objectTypes, relationTypes, subtypes, nodes, edges},
  출력 = Turtle 텍스트. 네임스페이스 `slo:` (가칭 `http://sl-ontoground.local/onto#`).
  - 스키마부: object_type → `rdfs:Class`, subtype → `rdfs:subClassOf`, relation_type → `rdf:Property` +
    `rdfs:domain`/`rdfs:range`(다중은 생략 또는 owl:unionOf 없이 첫 타입만 — 1차 단순화), property_def → `rdf:Property`.
  - 인스턴스부: 노드 → 개체(`rdf:type` = 클래스 or 서브클래스), 엣지 → 트리플, props → 데이터 속성,
    근거(EVIDENCED_BY)도 일반 트리플로.
- Next `GET /api/ontology/export?format=ttl` → store 스냅샷을 pyservice로 전달, `text/turtle` 응답.
  pyservice 죽으면 503 + 안내(JSON). format 기본 ttl, 그 외 400.
- 검증: Protégé/rdflib 파싱 가능해야 함(pyservice 테스트에서 rdflib 재파싱 왕복 확인).

## D. UI (최소)

- QualityPanel: 새 kind 4종 아이콘·라벨 추가(기존 카드 UI 재사용). rel-domain 카드엔 "관계 삭제" 액션.
- 좌측 타입 탐색기: 타입 아래 서브타입 그룹(건수 표시, 클릭 시 해당 노드 필터) + "미분류" 그룹.
- 헤더 어딘가(설정/내보내기 메뉴)에 "온톨로지 내보내기(.ttl)" 링크 — `<a href="/api/ontology/export?format=ttl" download>`.
- 스키마 편집 UI 없음(시드 관리).

## 범위 제외 (1차)

- OWL 추론기(owlrl) 풀 적용 — 기존 /reason 규칙 유지
- 다층 계층·다중 분류·스키마 버저닝·스키마 편집 UI
- required 속성의 공격적 지정(실데이터 채움율 확인 후)

## 구현 분할 (병렬)

- **A(기반, 선행)**: schema.sql + seed-metamodel + db.ts 로더/마이그레이션 + store 메타모델 캐시 + Node.st + 분류기·백필
- **B(A 뒤)**: validate.ts + scanQuality 통합 + 테스트
- **C(A와 병렬 가능, 계약 고정)**: pyservice /export + Next 프록시 + 테스트
- **D(B 뒤)**: QualityPanel 확장 + 타입 탐색기 서브타입 + 내보내기 링크

## 완료 기준

- [ ] relation_types에 domain/range 적재(신규+기존 DB 모두), 빈 배열=무제약 관례 유지
- [ ] 전 노드 서브타입 자동 분류 실행(미분류 허용), 탐색기에 서브타입 트리 표시
- [ ] scanQuality가 스키마 위반 4종 보고, 큐레이션(삭제·관계삭제) 동작
- [ ] `/api/ontology/export?format=ttl`이 rdflib 왕복 파싱되는 Turtle 반환
- [ ] 기존 테스트 + 신규 테스트 green, smoke.ts 통과
