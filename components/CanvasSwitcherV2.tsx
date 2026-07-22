"use client";

// v2(Neo4j) 캔버스 드롭다운 스위처 — 목록 전환 + 새 캔버스 생성.
// v2 캔버스는 Neo4j pod 이라 v1 CanvasSwitcher 와 데이터 배선이 다르다(/api/v2/canvases, id 문자열 배열).
// 생성은 pod 프로비저닝(수분)이라 상위(page)의 로딩/에러 상태를 쓴다 — onCreate 콜백만 호출한다.
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  current: string; // 현재 캔버스 id ("" 면 미선택)
  busy?: boolean;
  onSwitch: (id: string) => void;
  onCreate: (id: string) => void;
}

export default function CanvasSwitcherV2({ current, busy, onSwitch, onCreate }: Props) {
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [newId, setNewId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const j = await fetch("/api/v2/canvases").then((r) => r.json());
      if (j?.ok) setItems(j.canvases ?? []);
      else setErr(j?.error ?? "목록 조회 실패");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 마운트 + 현재 캔버스 변경(생성/전환 직후) 시 목록 갱신.
  useEffect(() => {
    void load();
  }, [load, current]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(id: string) {
    setOpen(false);
    if (id !== current) onSwitch(id);
  }

  function create() {
    const id = newId.trim();
    if (!id) return;
    setNewId("");
    setOpen(false);
    onCreate(id); // 상위가 POST + 로딩/에러 처리, 완료 후 current 변경 → 목록 재조회
  }

  return (
    <div className="cvs" ref={rootRef}>
      <button className={"cvs-btn" + (open ? " open" : "")} onClick={() => setOpen((v) => !v)} disabled={busy}>
        <span className="cvs-dot" />
        <span className="cvs-cur">{current || "캔버스 선택"}</span>
        <svg className="cvs-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="cvs-dd">
          <ul className="cvs-list">
            {items.length === 0 && <li className="cvs-empty">캔버스 없음 — 아래에서 생성</li>}
            {items.map((id) => (
              <li key={id}>
                <button className={"cvs-row" + (id === current ? " active" : "")} onClick={() => pick(id)}>
                  <span className="cvs-row-name">{id}</span>
                  {id === current && (
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
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="새 캔버스 id"
              maxLength={64}
            />
            <button onClick={create} disabled={!newId.trim()}>
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
