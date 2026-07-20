"use client";

// 좌측 드로어 — 캔버스 목록·전환·생성·이름변경·소프트삭제·휴지통(복구/영구삭제).
// 데이터는 전부 /api/canvases 에서 온다(골든 룰 4 — UI 하드코딩 금지).
// 캔버스 관리 API 는 ?canvas= 를 받지 않으므로 apiFetch 가 아니라 생 fetch 를 쓴다.
import { useCallback, useEffect, useState } from "react";
import type { CanvasSummary } from "@/lib/canvases"; // 타입만 — 번들에 lib/canvases 런타임이 들어가지 않는다
import { reasonOf } from "./apiError";

interface Props {
  current: string;
  onSwitch: (id: string) => void;
}

export default function CanvasPanel({ current, onSwitch }: Props) {
  const [items, setItems] = useState<CanvasSummary[]>([]);
  const [trash, setTrash] = useState<CanvasSummary[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, t] = await Promise.all([
      fetch("/api/canvases").then((r) => r.json()),
      fetch("/api/canvases?trash=1").then((r) => r.json()),
    ]);
    setItems(a.canvases ?? []);
    setTrash(t.canvases ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    onSwitch(canvas.id); // 만든 캔버스로 바로 이동
  }

  async function rename(c: CanvasSummary) {
    const name = window.prompt("새 표시명", c.name);
    if (!name || name === c.name) return;
    setErr(null);
    const r = await fetch(`/api/canvases/${encodeURIComponent(c.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) {
      setErr(await reasonOf(r, "이름 변경 실패"));
      return;
    }
    await load();
  }

  async function remove(c: CanvasSummary) {
    const ok = window.confirm(
      `"${c.name}" 캔버스를 휴지통으로 보냅니다.\n\n문서 ${c.docCount}개 · 노드 ${c.nodeCount}개가 함께 숨겨집니다.\n휴지통에서 복구할 수 있습니다.`
    );
    if (!ok) return;
    setErr(null);
    const r = await fetch(`/api/canvases/${encodeURIComponent(c.id)}`, { method: "DELETE" });
    if (!r.ok) {
      // 409 = 마지막 캔버스 등 — 서버가 준 한국어 사유를 그대로 보여준다.
      setErr(await reasonOf(r, "삭제 실패"));
      return;
    }
    await load();
    if (c.id === current) {
      // 지금 보고 있던 캔버스를 지웠다 — 남은 첫 캔버스로 이동.
      const rest = (await fetch("/api/canvases").then((x) => x.json())).canvases as CanvasSummary[];
      if (rest[0]) onSwitch(rest[0].id);
    }
  }

  async function restore(c: CanvasSummary) {
    setErr(null);
    const r = await fetch(`/api/canvases/${encodeURIComponent(c.id)}/restore`, { method: "POST" });
    if (!r.ok) {
      setErr(await reasonOf(r, "복구 실패"));
      return;
    }
    await load();
  }

  async function purge(c: CanvasSummary) {
    // 되돌릴 수 없으므로 이름 타이핑 확인.
    const typed = window.prompt(`영구 삭제하려면 캔버스 이름 "${c.name}" 을 그대로 입력하세요.\n되돌릴 수 없습니다.`);
    if (typed !== c.name) return;
    setErr(null);
    const r = await fetch(`/api/canvases/${encodeURIComponent(c.id)}?purge=1`, { method: "DELETE" });
    if (!r.ok) {
      setErr(await reasonOf(r, "영구 삭제 실패"));
      return;
    }
    await load();
  }

  return (
    <div className="cv-panel">
      {err && <p className="cv-err">{err}</p>}

      <ul className="cv-list">
        {items.map((c) => (
          <li key={c.id} className={"cv-item" + (c.id === current ? " active" : "")}>
            <button className="cv-pick" onClick={() => onSwitch(c.id)} title={c.description ?? c.name}>
              <span className="cv-name">{c.name}</span>
              <span className="cv-meta">
                문서 {c.docCount} · 노드 {c.nodeCount}
              </span>
            </button>
            <button className="cv-act" title="이름 변경" onClick={() => void rename(c)}>
              ✎
            </button>
            <button
              className="cv-act"
              title={items.length <= 1 ? "마지막 캔버스는 삭제할 수 없습니다" : "휴지통으로"}
              onClick={() => void remove(c)}
              disabled={items.length <= 1}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="cv-new">
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
          + 만들기
        </button>
      </div>

      <button className="cv-trash-toggle" onClick={() => setShowTrash((v) => !v)}>
        🗑 휴지통 ({trash.length})
      </button>
      {showTrash && (
        <ul className="cv-list cv-trash">
          {trash.length === 0 && <li className="cv-empty">비어 있습니다</li>}
          {trash.map((c) => (
            <li key={c.id} className="cv-item">
              <span className="cv-name">{c.name}</span>
              <button className="cv-act" title="복구" onClick={() => void restore(c)}>
                ↩
              </button>
              <button className="cv-act" title="영구 삭제" onClick={() => void purge(c)}>
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
