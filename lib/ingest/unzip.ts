// lib/ingest/unzip.ts — 최소 동기 ZIP 리더 (pptx/docx = OOXML zip).
// ingestAll() 이 동기 시그니처라 jszip(async) 대신 중앙 디렉터리 기반 동기 해제를 쓴다.
// 중앙 디렉터리 항목이 압축 크기를 항상 담으므로 data descriptor 여부와 무관하게 안전하다.
import * as zlib from "node:zlib";

/** ZIP 버퍼에서 (파일명 → 압축 해제 버퍼) 맵을 동기로 추출. */
export function unzipSync(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // End Of Central Directory (PK\x05\x06) 를 뒤에서 탐색
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // 중앙 디렉터리 시작 오프셋

  const CEN = 0x02014b50;
  const LOC = 0x04034b50;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== CEN) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localOff) !== LOC) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(comp); // stored
    else if (method === 8) data = zlib.inflateRawSync(comp); // deflate
    else continue;
    out.set(name, data);
  }
  return out;
}
