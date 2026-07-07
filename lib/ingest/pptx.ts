// lib/ingest/pptx.ts — pptx(zip) 를 풀어 슬라이드별 텍스트(<a:t>)를 순서대로 추출.
import { XMLParser } from "fast-xml-parser";
import * as fs from "node:fs";
import { unzipSync } from "./unzip";

export interface SlideData {
  index: number; // 1-based 슬라이드 번호
  lines: string[]; // <a:t> 텍스트(문서 순서)
}
export interface DeckData {
  slides: SlideData[];
}

const parser = new XMLParser({ ignoreAttributes: true, preserveOrder: false });

// 파싱 트리를 재귀 순회하며 태그(<a:t>)의 텍스트를 순서대로 수집.
function collectText(obj: unknown, tag: string, out: string[]): void {
  if (obj == null) return;
  if (Array.isArray(obj)) {
    for (const v of obj) collectText(v, tag, out);
    return;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === tag) {
        const arr = Array.isArray(v) ? v : [v];
        for (const t of arr) {
          const s = String(t ?? "").normalize("NFC").trim();
          if (s) out.push(s);
        }
      } else {
        collectText(v, tag, out);
      }
    }
  }
}

/** pptx 파일에서 슬라이드별 텍스트 라인을 추출. */
export function readDeck(filePath: string): DeckData {
  const zip = unzipSync(fs.readFileSync(filePath));
  const slideFiles = [...zip.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml$/)![1]) - Number(b.match(/slide(\d+)\.xml$/)![1]));
  const slides: SlideData[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = zip.get(slideFiles[i])!.toString("utf8");
    const tree = parser.parse(xml);
    const lines: string[] = [];
    collectText(tree, "a:t", lines);
    slides.push({ index: i + 1, lines });
  }
  return { slides };
}
