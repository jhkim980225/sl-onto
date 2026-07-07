// lib/ingest/xlsx.ts — SheetJS 로 워크북을 읽어 시트별 행(레코드)으로 반환.
import * as XLSX from "xlsx";
import * as fs from "node:fs";

export interface SheetData {
  name: string;
  rows: Record<string, string>[]; // 헤더 → 셀 문자열
}
export interface WorkbookData {
  sheets: SheetData[];
}

// 병합셀·헤더 위치가 불규칙한 "실무" FMEA 문서를 위한 원시 그리드(행렬) + 병합정보.
export interface MergeRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}
export interface SheetGrid {
  name: string;
  grid: string[][]; // 행 × 열 셀 문자열(헤더 가정 없음)
  merges: MergeRange[];
}
export interface WorkbookGrids {
  sheets: SheetGrid[];
}

const cell = (v: unknown): string => (v == null ? "" : String(v).normalize("NFC").trim());

/** 워크북 파일을 읽어 시트별 json 행으로 파싱. 모든 셀은 문자열로 정규화(NFC). */
export function readWorkbook(filePath: string): WorkbookData {
  const wb = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
  const sheets: SheetData[] = [];
  for (const name of wb.SheetNames) {
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: "" });
    const rows = raw.map((r) => {
      const o: Record<string, string> = {};
      for (const k of Object.keys(r)) o[k.normalize("NFC").trim()] = cell(r[k]);
      return o;
    });
    sheets.push({ name: name.normalize("NFC").trim(), rows });
  }
  return { sheets };
}

/** 워크북을 헤더 가정 없이 원시 2D 그리드 + 병합정보로 읽는다(실무 FMEA 휴리스틱용). */
export function readWorkbookGrids(filePath: string): WorkbookGrids {
  const wb = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
  const sheets: SheetGrid[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: true });
    const grid = aoa.map((row) => (Array.isArray(row) ? row.map(cell) : []));
    const merges: MergeRange[] = (ws["!merges"] ?? []).map((m: XLSX.Range) => ({
      s: { r: m.s.r, c: m.s.c },
      e: { r: m.e.r, c: m.e.c },
    }));
    sheets.push({ name: name.normalize("NFC").trim(), grid, merges });
  }
  return { sheets };
}
