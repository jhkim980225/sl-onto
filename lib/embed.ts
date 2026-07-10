// Python 사이드카(/embed) 태스크 래퍼 — 상태 없음. 질의·노드 텍스트 → 384dim 벡터.
// 골든 룰: pyservice 가 죽어도 검색·부팅은 막지 않는다 — 어떤 네트워크 오류도 삼켜서 안전한 빈값 반환(throw 금지).
// 전송·타임아웃·조용한 실패는 lib/pyservice.ts 공용 클라이언트가 담당.
// 설계: docs/superpowers/specs/2026-07-07-postgres-python-1차-design.md ("Python 사이드카", "첫 수직 관통")
import { dbEnabled, nodesMissingEmbedding, setEmbedding } from "./db";
import { pyEnabled, pyPost } from "./pyservice";

const EMBED_TIMEOUT_MS = 10000;
const BATCH = 64;

export function embedEnabled(): boolean {
  return pyEnabled();
}

/** 텍스트 배열 → 벡터 배열. 입력 공백·비활성·미가용이면 []. (검색 경로로 절대 throw 하지 않음) */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const data = await pyPost<{ vectors?: number[][] }>("/embed", { texts }, EMBED_TIMEOUT_MS, "embed");
  return Array.isArray(data?.vectors) ? data.vectors : [];
}

/** 단일 텍스트 임베딩 편의. 비활성·미가용이면 null. */
export async function embedOne(text: string): Promise<number[] | null> {
  const [v] = await embed([text]);
  return v ?? null;
}

/** embedding IS NULL 노드를 배치로 채운다. 멱등(NULL 만 채움). DB·pyservice 미가용이면 skip. */
export async function backfillEmbeddings(): Promise<{ embedded: number; skipped: boolean }> {
  if (!dbEnabled() || !embedEnabled()) return { embedded: 0, skipped: true };
  const rows = await nodesMissingEmbedding();
  let embedded = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vecs = await embed(batch.map((r) => r.text));
    if (vecs.length !== batch.length) break; // pyservice 중단 — 나머지는 남겨두고 다음 호출에 위임(멱등)
    for (let j = 0; j < batch.length; j++) {
      await setEmbedding(batch[j].id, vecs[j]);
      embedded++;
    }
  }
  return { embedded, skipped: false };
}
