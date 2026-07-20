"use client";

// 전역 모순 스캔 상태 훅 — 온톨로지 구축 완료 후 상시 조회(배지 "⚠ 모순 N건").
// refresh 는 큐레이션(병합/삭제) 후 재스캔에 재사용된다.
import { useCallback, useEffect, useState } from "react";
import type { Contradiction, ContradictionsResponse } from "@/lib/types";
import { apiFetch } from "@/lib/api-client";

export function useContradictions(ontologyBuilt: boolean) {
  const [items, setItems] = useState<Contradiction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    return apiFetch("/api/contradictions")
      .then((res) => {
        if (!res.ok) throw new Error(`모순 스캔 실패 (${res.status})`);
        return res.json() as Promise<ContradictionsResponse>;
      })
      .then((data) => {
        setItems(data.items);
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

  return { items, loading, error, refresh };
}
