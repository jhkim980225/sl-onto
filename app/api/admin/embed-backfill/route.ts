import { ready } from "@/lib/store";
import { backfillEmbeddings } from "@/lib/embed";

// POST /api/admin/embed-backfill — embedding IS NULL 노드 재임베딩(멱등).
// 부팅 시 pyservice 미가용으로 백필이 스킵된 뒤 검색이 계속 degraded 될 때 재트리거용.
// ponytail: 1차엔 인증 없음(admin 전용). 배포 후 보호 추가할 것.
export async function POST() {
  await ready();
  const r = await backfillEmbeddings();
  return Response.json(r);
}
