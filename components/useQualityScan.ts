"use client";

// 온톨로지 품질 스캔 상태 훅 — 중복 후보·고립 노드·근거 누락(배지 "🧹 정리 N건").
// 상태부만 담당: 병합/삭제 액션 핸들러는 Workbench 에 있고, 액션 후 refresh 로 재스캔한다.
// setError 는 큐레이션 액션 실패를 품질 패널에 표시하기 위해 함께 노출.
import { useCallback, useEffect, useState } from "react";
import type { QualityIssue, QualityResponse } from "@/lib/quality";

export function useQualityScan(ontologyBuilt: boolean) {
  const [items, setItems] = useState<QualityIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    return fetch("/api/quality")
      .then((res) => {
        if (!res.ok) throw new Error(`품질 스캔 실패 (${res.status})`);
        return res.json() as Promise<QualityResponse>;
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

  return { items, loading, error, refresh, setError };
}
