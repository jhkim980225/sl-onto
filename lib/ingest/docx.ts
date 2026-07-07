// lib/ingest/docx.ts — docx(zip) 의 word/document.xml 에서 문단(<w:p>)별 텍스트(<w:t>) 추출.
import { XMLParser } from "fast-xml-parser";
import * as fs from "node:fs";
import { unzipSync } from "./unzip";

export interface DocData {
  paragraphs: string[]; // 문단별 텍스트(빈 문단 제외)
}

// preserveOrder 로 <w:p> 경계를 보존해 문단 단위로 <w:t> 를 이어 붙인다.
const parser = new XMLParser({ ignoreAttributes: true, preserveOrder: true });

function collectTag(node: unknown, tag: string, out: string[]): void {
  if (Array.isArray(node)) {
    for (const v of node) collectTag(v, tag, out);
    return;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (tag in o) {
      const children = o[tag];
      if (Array.isArray(children)) {
        for (const c of children) {
          if (c && typeof c === "object" && "#text" in (c as Record<string, unknown>)) {
            out.push(String((c as Record<string, unknown>)["#text"]).normalize("NFC"));
          }
        }
      }
    }
    for (const v of Object.values(o)) collectTag(v, tag, out);
  }
}

// preserveOrder 트리에서 각 <w:p> 노드를 찾아 그 하위 <w:t> 텍스트를 합쳐 한 문단으로.
function walkParagraphs(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const v of node) walkParagraphs(v, out);
    return;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ("w:p" in o) {
      const texts: string[] = [];
      collectTag(o["w:p"], "w:t", texts);
      const line = texts.join("").normalize("NFC").trim();
      if (line) out.push(line);
      return; // 문단 내부는 이미 수집됨
    }
    for (const v of Object.values(o)) walkParagraphs(v, out);
  }
}

/** docx 파일에서 문단 텍스트를 추출. */
export function readDoc(filePath: string): DocData {
  const zip = unzipSync(fs.readFileSync(filePath));
  const docXml = zip.get("word/document.xml");
  if (!docXml) return { paragraphs: [] };
  const xml = docXml.toString("utf8");
  const tree = parser.parse(xml);
  const paragraphs: string[] = [];
  walkParagraphs(tree, paragraphs);
  return { paragraphs };
}
