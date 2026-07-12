"use client";

// Workbench는 SVG 포스 그래프·랜덤 배치·matchMedia 등 브라우저 전용 로직을 담고 있어
// SSR 시 하이드레이션 불일치가 발생한다. 클라이언트 전용으로만 마운트한다.
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

const Workbench = dynamic(() => import("./Workbench"), { ssr: false });

export default function WorkbenchLoader() {
  // "처음부터" = 소프트 리셋. key 를 바꿔 Workbench 를 리마운트하면 모든 useState 가 초기값으로
  // 돌아가고 이펙트가 재실행된다 — 하드 리프레시(location.reload) 없이 클라이언트에서 전체 초기화.
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => setResetKey((k) => k + 1), []);
  return <Workbench key={resetKey} onReset={reset} />;
}
