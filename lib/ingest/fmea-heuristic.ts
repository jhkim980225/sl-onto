// lib/ingest/fmea-heuristic.ts — 실무 FMEA 워크시트 휴리스틱 (lib/ingest/index.ts 에서 분리).
// 알려진 접두어(정형 참조/FMEA)에 매칭되지 않은 xlsx 를 헤더 자동탐지 · 동의어 컬럼매핑 ·
// 병합셀 채움으로 해석한다. Ctx(resolve/link/getNode/addProp) 주입 — index.ts 와 동일 계약.
import { readWorkbookGrids } from "./xlsx";
import type { MergeRange } from "./xlsx";
import type { XlsxCtx } from "./index";

type Role =
  | "item" | "fm" | "cause" | "action" | "effect"
  | "S" | "O" | "D" | "RPN" | "proj" | "prevent" | "detect";

// 컬럼명 동의어 → 역할. 순서 = 우선순위(구체적 항목 먼저: RPN·검출도 를 일반 '검출'보다 앞에).
const ROLE_SYNS: [Role, string[]][] = [
  ["RPN", ["rpn"]],
  ["S", ["심각도", "severity"]],
  ["O", ["발생도", "occurrence"]],
  ["D", ["검출도", "detection"]],
  ["proj", ["발생프로젝트", "프로젝트", "project", "차종"]],
  ["item", ["부품명", "부품", "품명", "항목", "기능", "구성품", "item", "part"]],
  ["fm", ["고장모드", "불량모드", "failuremode", "고장형태", "현상"]],
  ["cause", ["고장원인", "발생원인", "원인", "메커니즘", "cause"]],
  ["action", ["권고조치", "조치사항", "대책", "조치", "개선", "시정", "action"]],
  ["effect", ["영향", "effect"]],
  ["prevent", ["예방", "prevention"]],
  ["detect", ["검출관리", "검출"]],
];

export const nsl = (s: string) => (s ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, "");

function matchRole(cellText: string): Role | null {
  const c = nsl(cellText);
  if (!c) return null;
  for (const [role, syns] of ROLE_SYNS) {
    for (const s of syns) {
      const ss = nsl(s);
      if (ss && c.includes(ss)) return role;
    }
  }
  return null;
}

// 병합범위의 좌상단 값을 범위 전체(빈 셀)에 전파 — 세로 병합된 부품셀·2행 헤더 처리.
function fillMerges(grid: string[][], merges: MergeRange[]): void {
  for (const m of merges) {
    const v = grid[m.s.r]?.[m.s.c] ?? "";
    if (!v) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      if (!grid[r]) grid[r] = [];
      for (let c = m.s.c; c <= m.e.c; c++) {
        if ((grid[r][c] ?? "") === "") grid[r][c] = v;
      }
    }
  }
}

interface HeaderPick {
  row: number;
  span: number; // 1 = 단일행, 2 = 2행 병합 헤더
  roleCol: Partial<Record<Role, number>>;
  core: number; // item/fm/cause/action 매칭 수
}

function scoreCells(cells: string[]): { roleCol: Partial<Record<Role, number>>; core: number; total: number } {
  const roleCol: Partial<Record<Role, number>> = {};
  for (let c = 0; c < cells.length; c++) {
    const r = matchRole(cells[c]);
    if (r && roleCol[r] === undefined) roleCol[r] = c; // 역할당 첫 컬럼만
  }
  const core = (["item", "fm", "cause", "action"] as Role[]).filter((r) => roleCol[r] !== undefined).length;
  return { roleCol, core, total: Object.keys(roleCol).length };
}

// 앞쪽 최대 15행에서 FMEA 컬럼 키워드가 가장 잘 맞는 헤더행(또는 2행 병합)을 고른다.
function detectHeader(grid: string[][]): HeaderPick | null {
  let best: HeaderPick | null = null;
  let bestKey = [-1, -1, -1]; // [core, total, -span]
  const limit = Math.min(15, grid.length);
  for (let r = 0; r < limit; r++) {
    const single = grid[r] ?? [];
    const cand: { span: number; cells: string[] }[] = [{ span: 1, cells: single }];
    if (r + 1 < grid.length) {
      const next = grid[r + 1] ?? [];
      const width = Math.max(single.length, next.length);
      const merged: string[] = [];
      for (let c = 0; c < width; c++) merged[c] = `${single[c] ?? ""} ${next[c] ?? ""}`.trim();
      cand.push({ span: 2, cells: merged });
    }
    for (const { span, cells } of cand) {
      const { roleCol, core, total } = scoreCells(cells);
      if (core < 2 || roleCol.item === undefined || roleCol.fm === undefined) continue;
      const key = [core, total, -span];
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
        bestKey = key;
        best = { row: r, span, roleCol, core };
      }
    }
  }
  return best;
}

export function ingestXlsxHeuristic(full: string, ctx: XlsxCtx): void {
  const { resolve, link, getNode, addProp } = ctx;
  let sheets;
  try {
    sheets = readWorkbookGrids(full).sheets;
  } catch {
    return; // 이상 파일은 조용히 건너뜀(견고성)
  }
  for (const sh of sheets) {
    try {
      fillMerges(sh.grid, sh.merges);
      const hdr = detectHeader(sh.grid);
      if (!hdr) continue; // FMEA 성격이 아니면 스킵
      const col = hdr.roleCol;
      const at = (r: number, role: Role): string => {
        const c = col[role];
        return c === undefined ? "" : (sh.grid[r]?.[c] ?? "");
      };
      for (let r = hdr.row + hdr.span; r < sh.grid.length; r++) {
        const fmV = at(r, "fm");
        if (!fmV.trim()) continue; // 고장모드 없는 행 = 비고/구분/빈 행 → 스킵
        const item = resolve(at(r, "item"), "item");
        const fm = resolve(fmV, "fm");
        const cause = resolve(at(r, "cause"), "cause");
        const action = resolve(at(r, "action"), "action");
        const proj = resolve(at(r, "proj"), "proj");
        if (fm) {
          const nf = getNode(fm);
          addProp(nf, "심각도 S", at(r, "S"));
          addProp(nf, "영향", at(r, "effect"));
          addProp(nf, "RPN", at(r, "RPN"));
          addProp(nf, "예방관리", at(r, "prevent"));
        }
        if (cause) {
          const nc = getNode(cause);
          addProp(nc, "발생도 O", at(r, "O"));
          addProp(nc, "검출도 D", at(r, "D"));
        }
        link(item, "HAS_FAILURE", fm);
        link(fm, "CAUSED_BY", cause);
        link(fm, "MITIGATED_BY", action);
        link(proj, "OCCURRED_IN", fm);
      }
    } catch {
      continue; // 시트 단위 실패 격리
    }
  }
}
