"use client";

// pyservice /reason 유도 관계 상태 훅 — 온톨로지 구축 완료 후 상시 조회
// (배지 "🔗 유도 관계 N건", DB 미반영 조회 전용 오버레이). pyservice 미가용이면 조용히 빈 배열.
import { useCallback, useEffect, useState } from "react";
import type { DerivedEdge } from "@/lib/reason";
import { apiFetch } from "@/lib/api-client";

export function useReason(ontologyBuilt: boolean) {
  const [derivedRelations, setDerivedRelations] = useState<DerivedEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    return apiFetch("/api/reason")
      .then((res) => {
        if (!res.ok) throw new Error(`유도 관계 조회 실패 (${res.status})`);
        return res.json() as Promise<{ items: DerivedEdge[] }>;
      })
      .then((data) => {
        setDerivedRelations(data.items);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!ontologyBuilt) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ontologyBuilt]);

  return { derivedRelations, loading, error };
}
