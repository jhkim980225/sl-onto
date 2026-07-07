"use client";

// Workbench는 SVG 포스 그래프·랜덤 배치·matchMedia 등 브라우저 전용 로직을 담고 있어
// SSR 시 하이드레이션 불일치가 발생한다. 클라이언트 전용으로만 마운트한다.
import dynamic from "next/dynamic";

const Workbench = dynamic(() => import("./Workbench"), { ssr: false });

export default function WorkbenchLoader() {
  return <Workbench />;
}
