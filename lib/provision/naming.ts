// lib/provision/naming.ts — 캔버스 id → k8s 리소스 이름·bolt URI(정규화·검증). 순수 함수.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md §3, §5

const PREFIX = "neo4j-";
const MAX_LEN = 63;

/** 기본 네임스페이스(캔버스별 Neo4j pod가 사는 곳). opts 로 override 가능. */
export const DEFAULT_NAMESPACE = "sl-ontoground-v2";

/** FNV-1a 32bit — 비ASCII/충돌 대비 짧은 안정 해시 접미사(암호학적 용도 아님). */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * canvasId → 유효한 k8s 리소스 이름 (`neo4j-<slug>`, `[a-z0-9-]`, 영숫자로 시작/끝, ≤63자).
 * 한글·공백·대문자 등은 슬러그화하고, 슬러그가 비거나 원본과 달라지면(정보 손실) 해시 접미사를 붙여
 * 결정적이면서 서로 다른 입력이 충돌하지 않도록 한다.
 */
export function resourceName(canvasId: string): string {
  if (!canvasId) throw new Error("resourceName: canvasId가 비어있습니다");

  const slug = canvasId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const lossless = slug === canvasId.toLowerCase();
  const base = slug || "canvas";
  const name = lossless ? base : `${base}-${shortHash(canvasId)}`;

  const full = `${PREFIX}${name}`;
  const truncated = full.slice(0, MAX_LEN).replace(/-+$/g, "");
  return truncated;
}

/** 캔버스의 Neo4j Service 클러스터 내부 bolt URI. */
export function boltUri(canvasId: string, namespace: string = DEFAULT_NAMESPACE): string {
  return `bolt://${resourceName(canvasId)}.${namespace}:7687`;
}
