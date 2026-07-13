"use client";

// 결과 프레임 RAW 뷰 — 현재 뷰 {nodes, edges} JSON pretty-print + 복사 버튼.
import { useState } from "react";
import type { View } from "@/lib/view-table";

export default function RawView({ view }: { view: View }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(view, null, 2);
  const copy = () => {
    navigator.clipboard
      ?.writeText(json)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  };
  return (
    <div className="rf-view">
      <button className="rf-copy" onClick={copy}>
        {copied ? "복사됨 ✓" : "복사"}
      </button>
      <pre className="rf-raw-pre">{json}</pre>
    </div>
  );
}
