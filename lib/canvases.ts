// lib/canvases.ts — 캔버스 CRUD 도메인 로직. 라우트는 이 함수들을 부르기만 한다.
// 존재 여부는 인메모리 Set 캐시 — withCanvasRoute 가 요청마다 검사하므로 DB 왕복을 없앤다.
// ponytail: 단일 파드 전제. 멀티 레플리카가 되면 짧은 TTL 로 바꾼다.
import * as db from "./db";
import { dropCanvasCache } from "./store";
import { DEFAULT_CANVAS } from "./canvas-context";

export interface CanvasSummary {
  id: string; name: string; description: string | null;
  nodeCount: number; docCount: number; deletedAt: string | null;
}

/** 표시명 → id slug. 한글은 유지(음절 손실 없음), 그 외 비문자는 '-' 로. */
export function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return s || "canvas";
}

let existsCache: Set<string> | undefined;

export function invalidateCanvasList(): void {
  existsCache = undefined;
}

/** 활성(미삭제) 캔버스인지. 삭제된 캔버스는 false. */
export async function canvasExists(id: string): Promise<boolean> {
  // 인메모리 모드(테스트·로컬)에는 canvases 테이블이 없다 — 기본 캔버스만 존재하는 것으로 본다.
  if (!db.dbEnabled()) return id === DEFAULT_CANVAS;
  // withCanvasRoute 가 핸들러(=store.ready())보다 먼저 이걸 부른다. 부팅 첫 요청이 데이터
  // 라우트면 canvases 테이블이 아직 없으므로 여기서 스키마·마이그레이션을 먼저 보장한다.
  // db.ready() 는 멱등이고 모듈 레벨 Promise 가드가 있어 반복 호출 비용이 없다.
  await db.ready();
  if (!existsCache) existsCache = new Set((await db.canvasRows(false)).map((c) => c.id));
  return existsCache.has(id);
}

const toSummary = (r: Awaited<ReturnType<typeof db.canvasRows>>[number]): CanvasSummary => ({
  id: r.id, name: r.name, description: r.description,
  nodeCount: r.nodeCount, docCount: r.docCount,
  deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
});

export async function listCanvases(includeDeleted = false): Promise<CanvasSummary[]> {
  if (!db.dbEnabled()) {
    return [{ id: DEFAULT_CANVAS, name: "램프", description: null, nodeCount: 0, docCount: 0, deletedAt: null }];
  }
  return (await db.canvasRows(includeDeleted)).map(toSummary);
}

/** 캔버스 쓰기는 Postgres 가 있어야 성립한다. 인메모리 모드에서 그냥 두면 getPool() 이
 * connectionString: undefined 로 Pool 을 만들어 localhost 연결에 매달렸다가 500 으로 끝난다 —
 * 사용자는 원인을 알 수 없다. 도메인 계층에서 한 번 막아 모든 호출자를 커버한다.
 * 라우트는 이 오류를 503 으로 변환한다(클라이언트가 요청을 고쳐서 해결할 수 없는 서버 상태). */
export class CanvasWriteUnavailable extends Error {
  constructor() {
    super("DB 모드에서만 캔버스를 만들거나 수정할 수 있습니다");
    this.name = "CanvasWriteUnavailable";
  }
}

function requireDb(): void {
  if (!db.dbEnabled()) throw new CanvasWriteUnavailable();
}

/** 새 캔버스 생성 — 빈 스키마. 메타모델을 시드하지 않는다(설계 §3.4). */
export async function createCanvas(name: string, description: string | null): Promise<CanvasSummary> {
  requireDb();
  const base = slugify(name);
  const taken = new Set((await db.canvasRows(false)).concat(await db.canvasRows(true)).map((c) => c.id));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`; // id 충돌 시 접미사
  await db.insertCanvas(id, name.trim(), description);
  invalidateCanvasList();
  return { id, name: name.trim(), description, nodeCount: 0, docCount: 0, deletedAt: null };
}

export async function renameCanvas(id: string, name: string, description: string | null): Promise<void> {
  requireDb();
  await db.updateCanvas(id, name.trim(), description);
  invalidateCanvasList();
}

/** 소프트 삭제(휴지통). 마지막 활성 캔버스는 지울 수 없다 — 앱이 빈 상태가 되면 복구 경로가 없다. */
export async function deleteCanvas(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  requireDb();
  const active = await db.canvasRows(false);
  if (active.length <= 1) return { ok: false, reason: "마지막 캔버스는 삭제할 수 없습니다" };
  if (!active.some((c) => c.id === id)) return { ok: false, reason: "존재하지 않는 캔버스입니다" };
  await db.softDeleteCanvas(id);
  invalidateCanvasList();
  dropCanvasCache(id);
  return { ok: true };
}

export async function restoreCanvas(id: string): Promise<void> {
  requireDb();
  await db.restoreCanvas(id);
  invalidateCanvasList();
}

/** 영구 삭제 — 노드·엣지·문서·스키마·change_log 가 CASCADE 로 사라진다. 되돌릴 수 없다.
 * 반드시 휴지통(소프트 삭제)을 거친 캔버스만 지운다. 앱에 인증이 없어서, 가드가 없으면
 * `curl -X DELETE '.../api/canvases/default?purge=1'` 한 줄로 운영 온톨로지 전체가 날아간다
 * (브라우저 이름 확인 프롬프트는 UI 밖에서 무력하다). */
export async function purgeCanvas(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  requireDb();
  const active = await db.canvasRows(false);
  if (active.some((c) => c.id === id)) {
    return { ok: false, reason: "활성 캔버스는 영구 삭제할 수 없습니다 — 먼저 휴지통으로 옮기세요" };
  }
  const trashed = await db.canvasRows(true);
  if (!trashed.some((c) => c.id === id)) {
    return { ok: false, reason: "휴지통에 없는 캔버스입니다" };
  }
  await db.purgeCanvas(id);
  invalidateCanvasList();
  dropCanvasCache(id);
  return { ok: true };
}
