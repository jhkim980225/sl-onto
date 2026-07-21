"use client";

// 우측 패널 — 캔버스 문서 원문에 자유 질문(RAG). 객체 선택이 필요 없다.
// 답변의 [C n] 인용에 대응하는 청크(파일명·블록·원문)를 아래에 그대로 노출한다(골든 룰 1).
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { reasonOf } from "./apiError";
import PanelHeader from "./PanelHeader";

interface ChunkHit {
  n: number;
  file: string;
  block: string;
  text: string;
}

interface Props {
  onOpenDoc: (file: string) => void;
  onClose: () => void;
}

export default function DocAskPanel({ onOpenDoc, onClose }: Props) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [cited, setCited] = useState<number[]>([]);
  const [chunks, setChunks] = useState<ChunkHit[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    const question = q.trim();
    if (question.length < 2 || loading) return;
    setLoading(true);
    setErr(null);
    setAnswer(null);
    setChunks([]);
    try {
      const r = await apiFetch("/api/doc-ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!r.ok) {
        setErr(await reasonOf(r, "문서 질문 실패"));
        return;
      }
      const d = await r.json();
      setAnswer(d.answer ?? "");
      setCited(d.citedChunks ?? []);
      setChunks(d.chunks ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="da-panel">
      <PanelHeader title="📖 문서 질문" onClose={onClose} />
      <p className="da-hint">문서 원문에 직접 묻습니다. 객체를 고르지 않아도 됩니다.</p>
      <div className="da-input">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask();
          }}
          placeholder="예: 안정성시험 45도 3개월 pH 값은?"
          maxLength={500}
          disabled={loading}
        />
        <button onClick={() => void ask()} disabled={loading || q.trim().length < 2}>
          {loading ? "찾는 중…" : "질문"}
        </button>
      </div>

      {err && <p className="da-err">{err}</p>}

      {answer && (
        <>
          <div className="da-answer">{answer}</div>
          <h4 className="da-h">근거 청크 ({chunks.length})</h4>
          <ul className="da-chunks">
            {chunks.map((c) => (
              <li key={c.n} className={"da-chunk" + (cited.includes(c.n) ? " cited" : "")}>
                <button className="da-src" onClick={() => onOpenDoc(c.file)} title="원문 열기">
                  [C{c.n}] {c.file} · {c.block}
                </button>
                <pre className="da-text">{c.text}</pre>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
