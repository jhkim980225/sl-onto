// lib/ingest/tempfile.ts — 버퍼를 임시파일로 내려 파일 경로 기반 파서를 태우는 공용 헬퍼.
// (파서들이 파일 경로를 받으므로 업로드 버퍼는 임시파일 경유가 필요 — ingest·drawing-input 공용)
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** 버퍼를 임시파일(확장자는 name 에서 승계)로 쓰고 fn(경로) 실행, 종료 시 디렉터리 정리. */
export function withTempFile<T>(name: string, buf: Buffer, fn: (tmpPath: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slonto-"));
  const tmp = path.join(dir, `upload${path.extname(name).toLowerCase()}`);
  try {
    fs.writeFileSync(tmp, buf);
    return fn(tmp);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}
