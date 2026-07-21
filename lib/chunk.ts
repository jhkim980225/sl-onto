// lib/chunk.ts — 원문 블록 → 임베딩·검색용 청크. 순수 함수(DB·네트워크 무관).
// 설계: docs/superpowers/specs/2026-07-20-document-chunking-design.md §4
//
// 왜 형식별로 다른가:
//   표(rows 있음)  — 헤더를 매 청크에 반복한다. 안 하면 각 셀이 무슨 컬럼인지 알 수 없어
//                    "상분리 클레임의 원인" 같은 질의에 안 걸린다. 오버랩은 넣지 않는다
//                    (헤더 반복이 그 역할을 하고, 넣으면 같은 행이 두 청크에 중복된다).
//   산문(lines만)  — 문단 경계에서만 자르고 1문단 겹친다(경계에 걸친 맥락 보존).
import type { SourceBlock } from "./source-text";

/** 목표 청크 크기. e5-base 512토큰 한도(한국어 약 1,000~1,300자)에 여유를 둔 값. */
export const CHUNK_CHARS = 800;

export interface Chunk {
  seq: number;
  block: string;
  text: string;
}

const clean = (lines: string[]) => lines.map((l) => l.trim()).filter((l) => l !== "");

/** 표 블록: 헤더 + 데이터 행 묶음. 헤더는 매 청크에 반복, 데이터 행은 중복 없음. */
function chunkTable(rows: string[][]): string[] {
  const [head, ...body] = rows;
  if (!head) return [];
  const headText = head.join(" │ ");
  const dataLines = clean(body.map((r) => r.join(" │ ")));
  if (!dataLines.length) return headText.trim() ? [headText] : [];

  const out: string[] = [];
  let cur: string[] = [];
  let len = headText.length;
  for (const line of dataLines) {
    // 헤더만으로 이미 상한을 넘는 극단적 표는 행 1개씩이라도 담는다(무한 루프 방지).
    if (cur.length > 0 && len + line.length + 1 > CHUNK_CHARS) {
      out.push([headText, ...cur].join("\n"));
      cur = [];
      len = headText.length;
    }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) out.push([headText, ...cur].join("\n"));
  return out;
}

/** 산문 블록: 문단 경계에서만 자르고 인접 청크가 1문단 겹친다. */
function chunkProse(lines: string[]): string[] {
  const paras = clean(lines);
  if (!paras.length) return [];

  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const p of paras) {
    if (cur.length > 0 && len + p.length + 1 > CHUNK_CHARS) {
      out.push(cur.join("\n"));
      const overlap = cur[cur.length - 1]; // 1문단 오버랩
      cur = [overlap];
      len = overlap.length;
    }
    cur.push(p);
    len += p.length + 1;
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

/** 블록 배열 → 문서 전체 청크. seq 는 0부터 연속. */
export function chunkBlocks(blocks: SourceBlock[]): Chunk[] {
  const out: Chunk[] = [];
  for (const b of blocks) {
    const texts = b.rows && b.rows.length > 0 ? chunkTable(b.rows) : chunkProse(b.lines);
    for (const text of texts) out.push({ seq: out.length, block: b.label, text });
  }
  return out;
}
