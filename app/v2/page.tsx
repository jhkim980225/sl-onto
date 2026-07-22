"use client";

// v2 워크벤치 — 캔버스 생성/선택, 그래프 뷰, 인제스천, 질문(GraphRAG), 엔티티 수동 추가.
// v1의 lib/api-client(canvas 스코핑 헬퍼)는 쓰지 않는다 — v2 캔버스는 Neo4j pod 자체라 v1과 별개 배선.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphView } from "@/lib/neo4j/types";

const OntologyGraph = dynamic(() => import("@/components/OntologyGraph"), { ssr: false });

const NAVY = "#14243f";
const CYAN = "#00a2e5";
const STORAGE_KEY = "sl-onto-v2-canvas";

const EMPTY_GRAPH: GraphView = { entities: [], relations: [] };

async function parseJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function V2Page() {
  const [canvasId, setCanvasId] = useState("");
  const [canvasInput, setCanvasInput] = useState("");
  const [graph, setGraph] = useState<GraphView>(EMPTY_GRAPH);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved) {
      setCanvasId(saved);
      setCanvasInput(saved);
    }
  }, []);

  useEffect(() => {
    if (canvasId) void loadGraph(canvasId);
  }, [canvasId]);

  async function loadGraph(id: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/graph?canvas=${encodeURIComponent(id)}`);
      const body = await parseJson(res);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `그래프 조회 실패 (${res.status})`);
      setGraph({ entities: body.entities ?? [], relations: body.relations ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function createCanvas() {
    const id = canvasInput.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/v2/canvases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await parseJson(res);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `캔버스 생성 실패 (${res.status})`);
      localStorage.setItem(STORAGE_KEY, id);
      setCanvasId(id);
      setInfo(`캔버스 "${id}" 생성 완료`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function selectExisting() {
    const id = canvasInput.trim();
    if (!id) return;
    localStorage.setItem(STORAGE_KEY, id);
    setError(null);
    setInfo(null);
    setCanvasId(id);
  }

  async function handleIngest(file: File) {
    if (!canvasId) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/v2/ingest?canvas=${encodeURIComponent(canvasId)}`, {
        method: "POST",
        body: form,
      });
      const body = await parseJson(res);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `업로드 실패 (${res.status})`);
      setInfo(
        body.skipped
          ? `건너뜀: ${body.skipped}`
          : `적재 완료 — 엔티티 ${body.entities}건, 관계 ${body.relations}건`
      );
      await loadGraph(canvasId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleAsk() {
    const q = question.trim();
    if (!canvasId || !q) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch(`/api/v2/ask?canvas=${encodeURIComponent(canvasId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const body = await parseJson(res);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `질문 실패 (${res.status})`);
      setAnswer(body.answer);
      setGraph({ entities: body.entities ?? [], relations: body.relations ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleAddEntity() {
    if (!canvasId || !newId.trim() || !newName.trim() || !newType.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/entity?canvas=${encodeURIComponent(canvasId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newId.trim(), name: newName.trim(), type: newType.trim() }),
      });
      const body = await parseJson(res);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `엔티티 생성 실패 (${res.status})`);
      setNewId("");
      setNewName("");
      setNewType("");
      await loadGraph(canvasId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteEntity(id: string) {
    if (!canvasId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v2/entity?canvas=${encodeURIComponent(canvasId)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const body = await parseJson(res);
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `삭제 실패 (${res.status})`);
      await loadGraph(canvasId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#fff", color: NAVY, fontFamily: "sans-serif" }}>
      <header style={{ padding: "10px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ color: NAVY }}>SL OntoGround v2</strong>
        <input
          value={canvasInput}
          onChange={(e) => setCanvasInput(e.target.value)}
          placeholder="캔버스 id"
          style={{ padding: "6px 8px", border: "1px solid #a0acc0", borderRadius: 4 }}
        />
        <button onClick={createCanvas} disabled={loading || !canvasInput.trim()} style={btnStyle(CYAN)}>
          캔버스 생성
        </button>
        <button onClick={selectExisting} disabled={loading || !canvasInput.trim()} style={btnStyle(NAVY)}>
          기존 캔버스 선택
        </button>
        {canvasId && <span style={{ color: "#8291a8", fontSize: 13 }}>현재 캔버스: {canvasId}</span>}
        {loading && <span style={{ color: CYAN, fontSize: 13 }}>처리 중…</span>}
      </header>

      {error && (
        <div style={{ padding: "8px 16px", background: "#FFEAEA", color: "#c0304a", fontSize: 13 }}>{error}</div>
      )}
      {info && !error && (
        <div style={{ padding: "8px 16px", background: "#EAF7FF", color: NAVY, fontSize: 13 }}>{info}</div>
      )}

      {!canvasId ? (
        <div style={{ padding: 24, color: "#8291a8" }}>캔버스를 생성하거나 선택하세요.</div>
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <OntologyGraph data={graph} onDeleteEntity={handleDeleteEntity} />
          </div>

          <aside style={{ width: 320, borderLeft: "1px solid #e2e8f0", padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
            <section>
              <h3 style={sectionTitle}>업로드</h3>
              <input
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleIngest(f);
                  e.target.value = "";
                }}
                disabled={loading}
              />
            </section>

            <section>
              <h3 style={sectionTitle}>질문</h3>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="질문을 입력하세요"
                rows={3}
                style={{ width: "100%", padding: 6, border: "1px solid #a0acc0", borderRadius: 4, resize: "vertical" }}
              />
              <button onClick={handleAsk} disabled={loading || !question.trim()} style={{ ...btnStyle(CYAN), marginTop: 6 }}>
                질문
              </button>
              {answer && (
                <div style={{ marginTop: 8, padding: 8, background: "#f4f7fb", borderRadius: 4, fontSize: 13, whiteSpace: "pre-wrap" }}>
                  {answer}
                </div>
              )}
            </section>

            <section>
              <h3 style={sectionTitle}>엔티티 추가</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="id" style={inputStyle} />
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="name" style={inputStyle} />
                <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="type" style={inputStyle} />
                <button
                  onClick={handleAddEntity}
                  disabled={loading || !newId.trim() || !newName.trim() || !newType.trim()}
                  style={btnStyle(NAVY)}
                >
                  추가
                </button>
              </div>
            </section>

            <section style={{ fontSize: 12, color: "#8291a8" }}>
              엔티티 {graph.entities.length}건 · 관계 {graph.relations.length}건
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: 13, color: NAVY, marginBottom: 8 };
const inputStyle: React.CSSProperties = { padding: "6px 8px", border: "1px solid #a0acc0", borderRadius: 4 };

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: "6px 12px",
    background: bg,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 13,
  };
}
