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

## 4. 저장 스키마 (SQLite)
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
