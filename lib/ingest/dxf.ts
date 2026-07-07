// lib/ingest/dxf.ts — 2D 도면(DXF R12 ASCII) 파서 + SVG 렌더.
// DXF 는 "그룹코드 줄 + 값 줄" 쌍의 반복. TEXT/LINE/CIRCLE/ARC 만 해석한다(제도 텍스트·외형).
// 우리 생성 도면(scripts/gen-sources.ts buildDrawings)의 규칙:
//  - 제목블록/NOTE 는 "키: 값" TEXT 라벨 (부품명:/프로젝트:/차종:/소재:, 벤트 홀: 등)
//  - BOM 표는 "품번/품명/수량/재질" 헤더 행 아래 같은 y 좌표 = 같은 행인 TEXT 그리드
// 실무 CAD 도면 일반화(블록·치수 엔티티·레이아웃)는 범위 밖 — 키:값이 없으면 부분 추출로 감쇠.
// docs/superpowers/specs/2026-07-06-2d-drawing-design.md
import * as fs from "node:fs";

export interface DxfEntity {
  type: "TEXT" | "LINE" | "CIRCLE" | "ARC";
  /** 그룹코드 → 값 (10/20 좌표, 40 크기/반지름, 1 텍스트, 50/51 각도 등) */
  g: Record<string, string>;
}

export interface DxfText {
  value: string;
  x: number;
  y: number;
  h: number;
}

export interface BomRow {
  no: string;
  name: string;
  qty: string;
  material: string;
}

export interface DrawingData {
  /** 제목블록 등 "키: 값" 라벨 (부품명·프로젝트·차종·소재·도번…) — 첫 등장 우선 */
  labels: Record<string, string>;
  /** NOTE 의 형상 특징 키:값 (하우징·벤트 홀·실링·개스킷 소재·커넥터·렌즈…) */
  features: Record<string, string>;
  /** 키:값 형태가 아닌 일반 주석 문장 */
  notes: string[];
  bom: BomRow[];
  texts: DxfText[];
}

const ENT_TYPES = new Set(["TEXT", "LINE", "CIRCLE", "ARC"]);

/** DXF 본문에서 지원 엔티티를 순서대로 추출. */
export function parseDxfEntities(content: string): DxfEntity[] {
  const lines = content.split(/\r?\n/);
  const out: DxfEntity[] = [];
  let i = 0;
  while (i < lines.length - 1) {
    const code = lines[i].trim();
    const val = (lines[i + 1] ?? "").trim();
    if (code === "0" && ENT_TYPES.has(val)) {
      const e: DxfEntity = { type: val as DxfEntity["type"], g: {} };
      let j = i + 2;
      while (j < lines.length - 1 && lines[j].trim() !== "0") {
        e.g[lines[j].trim()] = (lines[j + 1] ?? "").trim();
        j += 2;
      }
      out.push(e);
      i = j;
    } else {
      i += 2;
    }
  }
  return out;
}

export function readDxfEntities(filePath: string): DxfEntity[] {
  return parseDxfEntities(fs.readFileSync(filePath, "utf8"));
}

const num = (v: string | undefined) => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

export function dxfTexts(ents: DxfEntity[]): DxfText[] {
  return ents
    .filter((e) => e.type === "TEXT" && (e.g["1"] ?? "").trim())
    .map((e) => ({
      value: (e.g["1"] ?? "").normalize("NFC").trim(),
      x: num(e.g["10"]),
      y: num(e.g["20"]),
      h: num(e.g["40"]),
    }));
}

// NOTE 형상 특징으로 인정하는 키 (그 외 "키: 값" 은 제목블록 라벨로 분류)
const FEATURE_KEYS = new Set(["하우징", "벤트 홀", "벤트", "실링", "개스킷 소재", "개스킷", "커넥터", "렌즈", "결로 방지", "드레인"]);

/** 텍스트들을 제목블록 라벨 / 형상 특징 / 일반 주석 / BOM 표로 해석. */
export function parseDrawing(ents: DxfEntity[]): DrawingData {
  const texts = dxfTexts(ents);
  const labels: Record<string, string> = {};
  const features: Record<string, string> = {};
  const notes: string[] = [];

  // 1) "키: 값" 라벨 분류 (NOTE 항목의 "1. " 번호 접두는 제거)
  for (const t of texts) {
    const stripped = t.value.replace(/^\d+[.)]\s*/, "");
    const m = stripped.match(/^([^:：]{1,20})[:：]\s*(.+)$/);
    if (!m) {
      // 번호 접두가 있었는데 키:값이 아니면 일반 주석
      if (/^\d+[.)]\s+/.test(t.value)) notes.push(stripped);
      continue;
    }
    const k = m[1].trim();
    const v = m[2].trim();
    if (k === "NOTE") continue;
    if (FEATURE_KEYS.has(k)) {
      if (!(k in features)) features[k] = v;
    } else if (!(k in labels)) {
      labels[k] = v;
    }
  }

  // 2) BOM 표 — 헤더 셀("품번/품명/수량/재질")의 좌표로 표 영역과 컬럼 x 를 확정한 뒤,
  //    그 x-범위 안의 텍스트만 y(±2) 행으로 묶는다(같은 높이의 NOTE 등 표 밖 텍스트와 병합 방지).
  const bom: BomRow[] = [];
  const hNo = texts.find((t) => t.value === "품번");
  if (hNo) {
    const colX = ["품번", "품명", "수량", "재질"].map(
      (k) => texts.find((t) => t.value === k && Math.abs(t.y - hNo.y) <= 2)?.x
    );
    if (colX.every((x): x is number => x != null)) {
      const left = colX[0] - 4;
      const right = colX[3] + 60;
      const cand = texts
        .filter((t) => t.x >= left && t.x <= right && t.y < hNo.y - 2)
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const rows: DxfText[][] = [];
      for (const t of cand) {
        const row = rows.find((r) => Math.abs(r[0].y - t.y) <= 2);
        if (row) row.push(t);
        else rows.push([t]);
      }
      for (const row of rows) {
        // 각 셀을 가장 가까운 컬럼에 배정
        const byCol: (string | undefined)[] = [];
        for (const cell of row) {
          let best = 0;
          for (let c = 1; c < colX.length; c++) {
            if (Math.abs(cell.x - (colX[c] as number)) < Math.abs(cell.x - (colX[best] as number))) best = c;
          }
          if (byCol[best] == null) byCol[best] = cell.value;
        }
        if (!/^\d+$/.test(byCol[0] ?? "")) break; // 품번이 숫자가 아니면 표 종료(제목블록 등)
        bom.push({ no: byCol[0]!, name: byCol[1] ?? "", qty: byCol[2] ?? "", material: byCol[3] ?? "" });
      }
    }
  }

  return { labels, features, notes, bom, texts };
}

/** 도면 SVG 렌더 — 웹 미리보기용(LINE/CIRCLE/ARC/TEXT). viewBox 는 엔티티 경계에서 계산. */
export function dxfToSvg(ents: DxfEntity[]): string {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const e of ents) {
    const x = num(e.g["10"]), y = num(e.g["20"]);
    if (e.type === "LINE") { see(x, y); see(num(e.g["11"]), num(e.g["21"])); }
    else if (e.type === "CIRCLE" || e.type === "ARC") { const r = num(e.g["40"]); see(x - r, y - r); see(x + r, y + r); }
    else see(x, y);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
  const H = maxY + minY; // y 뒤집기 기준(위=DXF 상단)
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const shapes: string[] = [];
  const labels: string[] = [];
  for (const e of ents) {
    const g = e.g;
    if (e.type === "LINE") {
      shapes.push(`<line x1="${num(g["10"])}" y1="${H - num(g["20"])}" x2="${num(g["11"])}" y2="${H - num(g["21"])}" />`);
    } else if (e.type === "CIRCLE") {
      shapes.push(`<circle cx="${num(g["10"])}" cy="${H - num(g["20"])}" r="${num(g["40"])}" />`);
    } else if (e.type === "ARC") {
      const cx = num(g["10"]), cy = num(g["20"]), r = num(g["40"]);
      const a1 = (num(g["50"]) * Math.PI) / 180, a2 = (num(g["51"]) * Math.PI) / 180;
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const large = Math.abs(a2 - a1) > Math.PI ? 1 : 0;
      shapes.push(`<path d="M ${x1} ${H - y1} A ${r} ${r} 0 ${large} 0 ${x2} ${H - y2}" />`);
    } else if (e.type === "TEXT") {
      labels.push(
        `<text x="${num(g["10"])}" y="${H - num(g["20"])}" font-size="${num(g["40"]) * 1.25}">${esc(g["1"] ?? "")}</text>`
      );
    }
  }
  const pad = 6;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}" style="background:#fff">` +
    `<g stroke="#1a2b49" stroke-width="0.6" fill="none">${shapes.join("")}</g>` +
    `<g fill="#1a2b49" font-family="'Malgun Gothic','Apple SD Gothic Neo',sans-serif">${labels.join("")}</g>` +
    `</svg>`
  );
}
