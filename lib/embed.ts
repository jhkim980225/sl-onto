// Python 사이드카(/embed) 태스크 래퍼 — 상태 없음. 질의·문서 텍스트 → 384dim 벡터(모델 교체 후 768dim).
// 골든 룰: pyservice 가 죽어도 검색·부팅은 막지 않는다 — 어떤 오류도 삼켜서 안전한 빈값 반환(throw 금지).
//
// ⚠ e5 접두어: multilingual-e5-base 는 문서에 "passage: ", 질의에 "query: " 를 요구한다.
// 빠뜨려도 에러가 안 나고 검색 품질만 조용히 떨어진다. 그래서 접두어 없이 부를 수 있는
// 함수(embed/embedOne)를 아예 두지 않는다. lib/embed.test.ts 가 이걸 고정한다.
import {
  dbEnabled, nodesMissingEmbedding, setEmbedding,
  replaceChunks, chunksMissingEmbedding, setChunkEmbedding, chunkCountOf,
} from "./db";
import { pyEnabled, pyPost } from "./pyservice";
// ⚠ 순환 import: store.ts → embed.ts → source-bytes.ts → store.ts. Node ESM 은 순환을 허용하지만
// 모듈 최상위에서 쓰면 초기화 순서에 따라 undefined 가 된다. 아래 심볼들은 backfillChunks() 실행
// 시점에만 호출하므로(최상위 사용 없음) 안전하다 — 최상위로 끌어올리지 말 것.
import { getRuntimeSources } from "./store";
import { canvasSourceBytes } from "./source-bytes";
import { extractSourceBlocks } from "./source-text";
import { chunkBlocks } from "./chunk";

const EMBED_TIMEOUT_MS = 10000;
const BATCH = 64;

export const E5_PASSAGE = "passage: ";
export const E5_QUERY = "query: ";

export function embedEnabled(): boolean {
  return pyEnabled();
}

/** 내부 전용 — 접두어가 이미 붙은 텍스트만 받는다. */
async function embedRaw(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const data = await pyPost<{ vectors?: number[][] }>("/embed", { texts }, EMBED_TIMEOUT_MS, "embed");
  return Array.isArray(data?.vectors) ? data.vectors : [];
}

/** 문서·노드 텍스트 임베딩(passage). 미가용이면 []. */
export async function embedPassage(texts: string[]): Promise<number[][]> {
  return embedRaw(texts.map((t) => E5_PASSAGE + t));
}

/** 질의 임베딩(query). 미가용이면 null. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const [v] = await embedRaw([E5_QUERY + text]);
  return v ?? null;
}

/** embedding IS NULL 노드를 배치로 채운다. 멱등(NULL 만 채움). DB·pyservice 미가용이면 skip. */
export async function backfillEmbeddings(): Promise<{ embedded: number; skipped: boolean }> {
  if (!dbEnabled() || !embedEnabled()) return { embedded: 0, skipped: true };
  const rows = await nodesMissingEmbedding();
  let embedded = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vecs = await embedPassage(batch.map((r) => r.text));
    if (vecs.length !== batch.length) break; // pyservice 중단 — 나머지는 다음 호출에 위임(멱등)
    for (let j = 0; j < batch.length; j++) {
      await setEmbedding(batch[j].id, vecs[j]);
      embedded++;
    }
  }
  return { embedded, skipped: false };
}

/** 청크가 없는 문서를 청킹하고, embedding IS NULL 청크를 채운다. 멱등.
 * 문서 원본 바이트는 sources.content(업로드) 또는 data/sources(베이스라인)에서 온다 —
 * lib/source-bytes.ts 가 캔버스 소유권까지 확인한 뒤 돌려준다. */
export async function backfillChunks(): Promise<{ chunked: number; embedded: number; skipped: boolean }> {
  if (!dbEnabled() || !embedEnabled()) return { chunked: 0, embedded: 0, skipped: true };

  // ① 아직 청크가 없는 문서를 청킹한다.
  let chunked = 0;
  for (const s of getRuntimeSources()) {
    if (/\.dxf$/i.test(s.file)) continue; // 도면은 원문 텍스트가 없다
    if ((await chunkCountOf(s.file)) > 0) continue;
    const buf = await canvasSourceBytes(s.file);
    if (!buf) continue;
    let blocks;
    try {
      blocks = extractSourceBlocks(s.file, buf, { cap: false }).blocks;
    } catch {
      continue; // 손상 문서 — 그 문서만 청크 0개. 인제스천은 이미 성공했다
    }
    const chunks = chunkBlocks(blocks);
    if (!chunks.length) continue;
    await replaceChunks(s.file, chunks);
    chunked += chunks.length;
  }

  // ② 임베딩이 빈 청크를 배치로 채운다.
  const rows = await chunksMissingEmbedding();
  let embedded = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vecs = await embedPassage(batch.map((r) => r.text));
    if (vecs.length !== batch.length) break; // pyservice 중단 — 다음 호출에 위임(멱등)
    for (let j = 0; j < batch.length; j++) {
      await setChunkEmbedding(batch[j].file, batch[j].seq, vecs[j]);
      embedded++;
    }
  }
  return { chunked, embedded, skipped: false };
}
