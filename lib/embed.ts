// Python 사이드카(/embed) 태스크 래퍼 — 상태 없음. 질의·문서 텍스트 → 384dim 벡터(모델 교체 후 768dim).
// 골든 룰: pyservice 가 죽어도 검색·부팅은 막지 않는다 — 어떤 오류도 삼켜서 안전한 빈값 반환(throw 금지).
//
// ⚠ e5 접두어: multilingual-e5-base 는 문서에 "passage: ", 질의에 "query: " 를 요구한다.
// 빠뜨려도 에러가 안 나고 검색 품질만 조용히 떨어진다. 그래서 접두어 없이 부를 수 있는
// 함수(embed/embedOne)를 아예 두지 않는다. lib/embed.test.ts 가 이걸 고정한다.
import { dbEnabled, nodesMissingEmbedding, setEmbedding } from "./db";
import { pyEnabled, pyPost } from "./pyservice";

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
