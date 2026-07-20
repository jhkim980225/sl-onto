# data-model.md — 온톨로지 데이터 모델

출처: 데모 `FMEA_온톨로지_시연_v2.html`의 `TYPES` / `CORE` / `CORE_EDGES` / `DOC_RULES`.

## 1. 객체 유형 (9종)
| 코드 | glyph | 유형 | 대표 속성 | 예시 |
|---|---|---|---|---|
| `item` | ITEM | 부품·구성 | 소재, 구성, 리스크 | 헤드램프 어셈블리, LED 모듈, 하우징(PP-GF), 아우터 렌즈(PC) |
| `fm` | FM | 고장모드 | 심각도 S, 원본코드·매핑·확신도 | 간극 벌어짐, 배광 편차, 수축 변형, 결로, 휘도 불균일 |
| `cause` | CAUSE | 원인 | 분류, 발생도 O | 조립 공차 누적, 소재 수축 과다, 방열 설계 미흡 |
| `action` | ACT | 조치 | 유형(공정/재료/설계/검증), 사례 | 금형 치수 수정, 저수축 소재 변경, 방열 리브 추가 |
| `reg` | REG | 법규·인증 | 국가, 핵심 | FMVSS 108, ECE R149, KMVSS, GB 25991 |
| `proj` | PJ | 프로젝트 | 차종, 광원, 이슈이력 | PJ 2016-HL03 … PJ 2026-HL21(신규) |
| `master` | MSTR | 마스터 | 성격, 필수 항목 | 간극·단차 마스터, LED 방열 마스터, 배광 법규 마스터 |
| `spec` | SPEC | 고객 스펙 | 고객사, 포함 | HKMC ES 스펙, GMW 스펙 |
| `doc` | DOC | 근거 문서 | 형식, 추출객체 | PTS-8812, 재발방지_간극.pptx, FMEA_HL07.xlsx |

## 2. 관계 유형 (12종)
| 관계 | 방향 | 의미 |
|---|---|---|
| `CONSISTS_OF` | item→item | 부품 구성(BOM) |
| `HAS_FAILURE` | item→fm | 부품의 고장모드 |
| `CAUSED_BY` | fm→cause | 고장모드의 원인 |
| `MITIGATED_BY` | fm/cause→action | 조치로 완화 |
| `REF_MASTER` | fm/cause→master | 표준 마스터 참조(누락 방지) |
| `UNDER_REG` | fm/item→reg | 규제 적용 |
| `DRL_REG` | item→reg | DRL 관련 규제 |
| `THERMAL_RISK` | item→cause | 발열 리스크 |
| `OCCURRED_IN` | proj→fm | 프로젝트 발생 이력 |
| `SPEC_OF` | proj→spec | 적용 고객 스펙 |
| `SIMILAR` (형상=`SIMILAR_SHAPE`) | proj↔proj | 유사도 0~1 — **추론 핵심 축** |
| `EVIDENCED_BY` | any→doc | 원본 문서 근거 |
| (시나리오) `NEW_DESIGN_OF`, `TARGET_MARKET` | proj→item/reg | 신규 설계 조건 |

## 3. 속성 & 온톨로지의 약속
- 자유 key-value 속성(`props`)에 도메인 값 저장.
- FMEA 정량: `S`(심각도), `O`(발생도). 확장 시 `D`(검출도), `RPN`.
- **매핑 보존(필수):** 원본 코드를 덮어쓰지 않는다.
  ```
  original_code: "외관-B"   (2014)
  mapped_code:   "GAP-EXT"
  confidence:    0.72
  ```
- **근거:** 모든 객체는 `EVIDENCED_BY`로 `doc`에 연결(provenance).

## 3.1 캔버스 — 격리 축 (`canvases`)

온톨로지는 하나가 아니다. **캔버스 = 도메인(부서·제품군)별 완전 격리 워크스페이스**로,
데이터도 스키마도 0에서 시작한다. 기존 램프 FMEA 데이터는 `default` 캔버스에 귀속된다
(179 노드 / 2,198 엣지 / 40 문서).

```sql
CREATE TABLE canvases (
  id          TEXT PRIMARY KEY,       -- slug: 'default', 'electronics'
  name        TEXT NOT NULL,          -- 표시명: '램프', '전장'
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ             -- 소프트 삭제(휴지통). NULL = 활성
);
```

완전 격리이므로 **캔버스 A와 B가 같은 노드 id 를 가질 수 있다**(둘 다 `ILENS` 를 만들 수 있다).
따라서 모든 테이블의 PK 에 `canvas_id` 가 선행한다(`lib/db/schema.sql`).

| 테이블 | PK | 비고 |
|---|---|---|
| `nodes` | `(canvas_id, id)` | `(canvas_id, type)` → `object_types` FK — **객체타입 없는 캔버스엔 노드를 넣을 수 없다** |
| `edges` | `(canvas_id, src, rel, dst)` | `(canvas_id, rel)` → `relation_types`, 양끝 → `nodes` ON DELETE CASCADE |
| `sources` | `(canvas_id, file)` | 업로드 원본 바이트(`content`) 포함 |
| `object_types` | `(canvas_id, type_id)` | |
| `relation_types` | `(canvas_id, rel_id)` | |
| `object_subtypes` | `(canvas_id, type_id, st_id)` | `(canvas_id, type_id)` → `object_types` |
| `property_defs` | `(canvas_id, type_id, key)` | 〃 |
| `meta` | `(canvas_id, key)` | `active_drawing` 이 캔버스별 |
| `ai_opinions` | `(canvas_id, key)` | 다른 캔버스 LLM 답변이 캐시로 새면 안 됨 |
| `change_log` | `seq` (+ `canvas_id` 컬럼) | |

**메타모델도 캔버스별이다.** §1의 객체 9종 · §2의 관계 12종은 `default` 캔버스의 시드값이며,
사용자가 만드는 캔버스는 **빈 스키마**로 시작해 `/api/schema/object-types` ·
`/api/schema/relation-types` 로 직접 정의한다(설계 §3.4). `nodes.embedding`(pgvector 384-dim)은
컬럼 변경 없이 유사도 쿼리에 `canvas_id` 조건만 붙는다.

**마이그레이션**: `lib/db/migrations/001-canvas.sql` — 단일 온톨로지 DB를 캔버스 DB로 승격.
단일 트랜잭션, **단방향**(되돌리기 스크립트 없음). 배포 주의사항은 [deployment.md](deployment.md).

> 설계: [superpowers/specs/2026-07-20-multi-canvas-design.md](superpowers/specs/2026-07-20-multi-canvas-design.md)

## 4. 저장 스키마 (초기 MVP 안 — SQLite)

> 아래는 MVP 초안이다. 현행 영속 스키마는 Postgres(`lib/db/schema.sql`)이며 §3.1 의 캔버스
> 복합 PK 를 따른다.

```sql
CREATE TABLE objects (
  id     TEXT PRIMARY KEY,
  type   TEXT NOT NULL,          -- item|fm|cause|action|reg|proj|master|spec|doc
  label  TEXT NOT NULL,
  sub    TEXT,                   -- 부제
  props  TEXT NOT NULL DEFAULT '{}'  -- JSON (S,O,original_code,mapped_code,confidence…)
);
CREATE TABLE links (
  src    TEXT NOT NULL,
  rel    TEXT NOT NULL,
  dst    TEXT NOT NULL,
  weight REAL,                   -- SIMILAR 유사도 등
  scen   INTEGER NOT NULL DEFAULT 0,  -- 시나리오 전용 여부
  PRIMARY KEY (src, rel, dst)
);
CREATE TABLE evidence (          -- doc 노드 = objects(type='doc')와 1:1, 부모 링크 별도
  id       TEXT PRIMARY KEY,
  parent   TEXT NOT NULL,        -- EVIDENCED_BY 대상 객체
  ext      TEXT NOT NULL,        -- PTS|PPTX|XLSX|TIF|BOM|SPEC
  filename TEXT NOT NULL,
  props    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_links_src ON links(src);
CREATE INDEX idx_links_dst ON links(dst);
CREATE INDEX idx_objects_type ON objects(type);
```
> 대안: 데이터가 작으면 `lib/seed.ts`의 인메모리 구조로 대체 가능(스키마는 동일 형태 유지).

## 5. 시드 데이터 규모 (데모 기준)
- 코어 객체 ≈ 35, 관계 ≈ 40, 근거 문서 위성 ≈ 240 (`DOC_RULES` 생성) → 총 노드 ≈ 275.
- 실 과제 전환 시 이 시드만 Docling 출력으로 교체.

## 6. API JSON 형태
```jsonc
// GET /api/ontology
{ "nodes": [ { "id":"IHL","type":"item","label":"헤드램프 어셈블리","sub":"LED·분리형 DRL","hero":true } ],
  "edges": [ { "src":"IHL","rel":"CONSISTS_OF","dst":"ILED","weight":null,"scen":false } ] }

// GET /api/object/IHL
{ "id":"IHL","type":"item","label":"헤드램프 어셈블리",
  "props":[["구성","LED모듈·라이트가이드·하우징·렌즈"],["BOM","BOM_HL07_rev4"]],
  "relations":[ {"rel":"HAS_FAILURE","dir":"out","other":"FMBEAM","label":"배광 편차"} ],
  "evidence":[ {"ext":"BOM","filename":"BOM_HL07_rev4.xlsx"} ] }

// POST /api/infer  →
{ "checklist":[
    { "no":1,"title":"범퍼 매칭부 간극 관리 — 마스터 M-GAP 적용",
      "desc":"유사 형상 PJ 2021-HL12 간극 2mm 클레임 …",
      "evidence":["PTS-8812","재발방지_간극.pptx","간극·단차 마스터"],
      "confidence":91,
      "trace":["PJ26→SIMILAR→PJ21","PJ21→OCCURRED_IN→FMGAP","FMGAP→REF_MASTER→MGAP"] } ],
  "traversed": { "objects":34, "edges":41, "docs":12 } }

// GET /api/canvases  (?trash=1 이면 삭제된 것만)
{ "canvases":[ { "id":"default","name":"램프","description":null,
                 "nodeCount":179,"docCount":40,"deletedAt":null } ] }

// GET /api/schema?canvas=default — 메타모델 + 스키마에서 유도한 기능 가용성
{ "objectTypes":[…], "relationTypes":[…], "subtypes":[…], "propertyDefs":[…],
  "capabilities": { "infer":true,"fmeaDraft":true,"contradictions":true,
                    "bomCheck":true,"condensation":true } }

// DELETE /api/sources/[file]?canvas=default — 문서 1건 삭제(근거 0이 된 객체만 함께 제거)
{ "ok":true, "removed": { "doc":1, "nodes":8, "edges":21 }, "keptEdges":3 }

// GET /api/contradictions — 전역 모순 스캔(상시 노출용, 규칙당 상한 5 · confidence 플로어 40%)
{ "items":[
    { "kind":"record-gap",          // record-gap | market-env | master-missing
      "title":"PJ 2020-HL09 — 커뮤니티 언급 vs FMEA 기록 괴리",
      "detail":"…", "projects":["PJ09"],
      "evidence":["소비자반응_커뮤니티.xlsx"],
      "trace":["PJ09→OCCURRED_IN→…"],  // 실존 엣지만 (근거 우선 골든 룰)
      "confidence":85 } ],
  "scannedAt":"2026-07-07T…" }
```
