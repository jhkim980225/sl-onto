"use client";

// 상단바 캔버스 드롭다운 스위처 — 빠른 전환 + 새 캔버스 생성.
// 전체 관리(이름변경·삭제·휴지통)는 좌측 드로어 CanvasPanel 이 담당한다.
// 데이터는 /api/canvases 에서 온다(골든 룰 4). 캔버스 관리 API 는 ?canvas= 를 받지 않아 생 fetch.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasSummary } from "@/lib/canvases";
import { reasonOf } from "./apiError";

interface Props {
  current: string;
  onSwitch: (id: string) => void;
}

export default function CanvasSwitcher({ current, onSwitch }: Props) {
  const [items, setItems] = useState<CanvasSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/canvases").then((r) => r.json());
    setItems(j.canvases ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 바깥 클릭·Esc 로 닫기.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = items.find((c) => c.id === current);

  function pick(id: string) {
    setOpen(false);
    if (id !== current) onSwitch(id);
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setErr(null);
    const r = await fetch("/api/canvases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      setErr(await reasonOf(r, "생성 실패"));
      return;
    }
    const { canvas } = await r.json();
    setNewName("");
    await load();
    pick(canvas.id); // 만든 캔버스로 바로 이동
  }

  return (
    <div className="cvs" ref={rootRef}>
      <button className={"cvs-btn" + (open ? " open" : "")} onClick={() => setOpen((v) => !v)}>
        <span className="cvs-dot" />
        <span className="cvs-cur">{active?.name ?? current}</span>
        <svg className="cvs-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="cvs-dd">
          <ul className="cvs-list">
            {items.map((c) => (
              <li key={c.id}>
                <button className={"cvs-row" + (c.id === current ? " active" : "")} onClick={() => pick(c.id)}>
                  <span className="cvs-row-name">{c.name}</span>
                  <span className="cvs-row-meta">
                    문서 {c.docCount} · 노드 {c.nodeCount}
                  </span>
                  {c.id === current && (
                    <svg className="cvs-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {err && <p className="cvs-err">{err}</p>}
          <div className="cvs-new">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              placeholder="새 캔버스 이름"
              maxLength={60}
            />
            <button onClick={() => void create()} disabled={!newName.trim()}>
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
