"use client";

// Workbench는 SVG 포스 그래프·랜덤 배치·matchMedia 등 브라우저 전용 로직을 담고 있어
// SSR 시 하이드레이션 불일치가 발생한다. 클라이언트 전용으로만 마운트한다.
// 캔버스 선택도 여기서 확정한다 — 확정 전에는 렌더하지 않는다(잘못된 캔버스로 fetch 방지).
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { setApiCanvas } from "@/lib/api-client";

const Workbench = dynamic(() => import("./Workbench"), { ssr: false });

const LS_KEY = "sl-onto:canvas";

export default function WorkbenchLoader() {
  // "처음부터" = 소프트 리셋. key 를 바꿔 Workbench 를 리마운트하면 모든 useState 가 초기값으로
  // 돌아가고 이펙트가 재실행된다 — 하드 리프레시(location.reload) 없이 클라이언트에서 전체 초기화.
  // 캔버스 전환도 같은 장치를 쓴다(key 에 캔버스 id 포함).
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => setResetKey((k) => k + 1), []);
  const [canvas, setCanvas] = useState<string | null>(null);

  // 선택 캔버스 복원 — 없거나 삭제됐으면 첫 캔버스로 폴백.
  useEffect(() => {
    void (async () => {
      const saved = window.localStorage.getItem(LS_KEY);
      const list = await fetch("/api/canvases")
        .then((r) => r.json())
        .then((j) => (j.canvases ?? []) as { id: string }[])
        .catch(() => [] as { id: string }[]);
      const pick = list.find((c) => c.id === saved)?.id ?? list[0]?.id ?? "default";
      setApiCanvas(pick);
      setCanvas(pick);
    })();
  }, []);

  const switchCanvas = useCallback((id: string) => {
    window.localStorage.setItem(LS_KEY, id);
    setApiCanvas(id);
    setCanvas(id); // key 변경 → Workbench 리마운트 = 소프트 리셋
  }, []);

  if (!canvas) return null; // 캔버스 확정 전에는 렌더하지 않는다

  return (
    <Workbench key={`${canvas}:${resetKey}`} canvas={canvas} onSwitchCanvas={switchCanvas} onReset={reset} />
  );
}
