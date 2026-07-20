// lib/source-bytes.ts — "이 캔버스에 등록된 문서"의 원본 바이트를 돌려준다.
//
// 왜 필요한가: source-text·drawing-svg 가 data/sources 디스크를 캔버스 검사 없이 먼저 읽고 있었다.
// withCanvasRoute 는 캔버스가 존재하는지만 보고 그 파일이 이 캔버스 것인지는 모른다. 결과로
//   ① 캔버스 B 에서 램프 베이스라인 문서 원문·도면이 그대로 열렸고(격리 위반),
//   ② B 가 같은 이름으로 올린 문서를 열면 디스크의 램프 원문이 B 의 근거로 표시됐다(골든 룰 1 위반).
//
// 순서가 중요하다: DB(업로드분) → 디스크(베이스라인). 뒤집으면 ②가 다시 살아난다.
import * as fs from "node:fs";
import * as path from "node:path";
import { getSourceContent } from "./db";
import { getRuntimeSources } from "./store";

/** 현재 캔버스에 등록된 문서면 원본 바이트, 아니면 null(호출자가 404 로 변환). */
export async function canvasSourceBytes(file: string): Promise<Buffer | null> {
  // 이 캔버스의 문서 목록에 없으면 디스크에 같은 이름이 있어도 주지 않는다.
  if (!getRuntimeSources().some((s) => s.file === file)) return null;

  const fromDb = await getSourceContent(file);
  if (fromDb) return fromDb;

  // 베이스라인(data/sources)은 DB 에 content 가 NULL 이라 디스크에서 읽는다.
  const disk = path.join(process.cwd(), "data", "sources", file);
  return fs.existsSync(disk) ? fs.readFileSync(disk) : null;
}
