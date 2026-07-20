"use client";

// 좌측 드로어 — 이 캔버스에 적재된 문서 목록 · 교체(⟳) · 삭제(✕).
// 등록은 우측 IngestPanel 이 담당한다(설계문서 §6) — 여기는 목록/수정/삭제 전용.
// 삭제는 "이 문서만 근거로 삼는 객체"를 함께 지운다. 엣지에는 출처가 없어 양끝이 다른 문서에도
// 근거를 둔 객체는 남는다 — 서버가 준 keptNodes 를 노출해 무엇이 남았는지 드러낸다(설계문서 §2).
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { SourceInfo, SourcesResponse } from "./sourceTypes";
import { reasonOf } from "./apiError";

interface Props {
  /** 삭제·교체 성공 후 그래프·카운터를 다시 불러오게 하는 부모 콜백 */
  onChanged: () => void;
}

interface Removed {
  doc: number;
  nodes: number;
  edges: number;
}
interface MutateResult {
  removed?: Removed;
  added?: { nodes: number; edges: number };
  keptNodes?: number;
}

/** 남은 관계 안내 — 0건이면 문장을 붙이지 않는다. */
function keptNote(kept: number | undefined): string {
  return kept ? ` 객체 ${kept}개는 다른 문서에도 근거가 있어 남았습니다.` : "";
}

export default function DocumentPanel({ onChanged }: Props) {
  const [items, setItems] = useState<SourceInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 처리 중인 파일명
  const fileRef = useRef<HTMLInputElement | null>(null);
  const targetRef = useRef<string | null>(null); // ⟳ 를 누른 대상 파일명

  const load = useCallback(async () => {
    const r = await apiFetch("/api/sources");
    if (!r.ok) {
      setErr(await reasonOf(r, "문서 목록 조회 실패"));
      return;
    }
    const j = (await r.json().catch(() => null)) as SourcesResponse | null;
    setItems(j?.sources ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(s: SourceInfo) {
    const ok = window.confirm(
      `"${s.file}" 문서를 삭제합니다.\n\n` +
        `이 문서만 근거로 삼는 객체(최대 ${s.extracted.objects}개)와 그 관계가 함께 사라집니다.\n` +
        `다른 문서에도 근거가 있는 객체는 남습니다.\n\n` +
        `되돌리려면 문서를 다시 등록해야 합니다.`
    );
    if (!ok) return;
    setErr(null);
    setNote(null);
    setBusy(s.file);
    const r = await apiFetch(`/api/sources/${encodeURIComponent(s.file)}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) {
      setErr(await reasonOf(r, "삭제 실패"));
      return;
    }
    const d = ((await r.json().catch(() => null)) ?? {}) as MutateResult;
    setNote(
      `"${s.file}" 삭제 — 객체 ${d.removed?.nodes ?? 0}개 · 관계 ${d.removed?.edges ?? 0}개 제거.` +
        keptNote(d.keptNodes)
    );
    await load();
    onChanged();
  }

  async function replace(file: File) {
    const target = targetRef.current;
    if (!target) return;
    setErr(null);
    setNote(null);
    setBusy(target);
    const fd = new FormData();
    fd.append("file", file);
    const r = await apiFetch(`/api/sources/${encodeURIComponent(target)}`, { method: "PUT", body: fd });
    setBusy(null);
    if (!r.ok) {
      // 파싱 실패(400)면 서버가 원본을 유지한다 — 목록은 그대로 두고 사유만 보여준다.
      setErr(await reasonOf(r, "교체 실패"));
      return;
    }
    const d = ((await r.json().catch(() => null)) ?? {}) as MutateResult;
    setNote(
      `"${target}" 교체 — 제거 객체 ${d.removed?.nodes ?? 0}개 / 추가 객체 ${d.added?.nodes ?? 0}개 · 관계 ${
        d.added?.edges ?? 0
      }개.` + keptNote(d.keptNodes)
    );
    await load();
    onChanged();
  }

  return (
    <div className="dc-panel">
      {err && <p className="dc-err">{err}</p>}
      {note && <p className="dc-note">{note}</p>}

      <h4 className="dc-h">문서 ({items.length})</h4>
      <ul className="dc-list">
        {items.length === 0 && <li className="dc-empty">문서가 없습니다 — 📥 문서 인제스천으로 등록하세요</li>}
        {items.map((s) => (
          <li key={s.file} className="dc-item">
            <span className="dc-info">
              <span className="dc-name" title={s.file}>
                {s.file}
              </span>
              <span className="dc-meta">
                {s.extracted.objects}객체 / {s.extracted.relations}관계
              </span>
            </span>
            <button
              className="dc-act"
              title="새 파일로 교체(삭제 후 재등록)"
              disabled={busy !== null}
              onClick={() => {
                targetRef.current = s.file;
                fileRef.current?.click();
              }}
            >
              {busy === s.file ? "…" : "⟳"}
            </button>
            <button className="dc-act" title="삭제" disabled={busy !== null} onClick={() => void remove(s)}>
              ✕
            </button>
          </li>
        ))}
      </ul>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.pptx,.docx,.dxf,.pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // 같은 파일 재선택도 change 가 뜨도록
          if (f) void replace(f);
        }}
      />
    </div>
  );
}
