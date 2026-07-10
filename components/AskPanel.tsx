"use client";

// 우측 패널 · 객체 질문(Q&A) — POST /api/ask. 선택 객체의 관계·근거 컨텍스트로 LLM이 답한다.
// 골든 룰: 답변은 검토용 초안. [R n] 인용 → rels 목록의 근거 관계 칩으로 provenance를 노출.
// 대화 이력은 Workbench가 보관(패널 전환 시에도 유지) — 각 항목에 질문 대상 객체 라벨 태그.
import { useState } from "react";
import type { AskRel } from "@/lib/ask";
import { relKo } from "./relLabels";
import PanelHeader from "./PanelHeader";

export interface AskEntry {
  objectId: string;
  objectLabel: string;
  question: string;
  answer: string;
  citedRels: number[];
  rels: AskRel[];
  docs: string[];
  cached: boolean;
  generatedAt: string;
}

interface AskPanelProps {
  objectId: string | null;
  objectLabel: string | null;
  history: AskEntry[];
  onAppend: (entry: AskEntry) => void;
  /** 그래프 포커스만(패널 전환 없음) — 근거 관계 칩/[R n] 클릭용 */
  onFocusNode: (id: string) => void;
  onClose: () => void;
}

const EXAMPLES = [
  "이 부품에서 결로가 발생하는 주요 원인은?",
  "과거 어떤 프로젝트에서 문제가 있었나?",
  "어떤 조치가 효과적이었나?",
];

export default function AskPanel({ objectId, objectLabel, history, onAppend, onFocusNode, onClose }: AskPanelProps) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = !!objectId && question.trim().length >= 2 && !loading;

  async function send() {
    if (!canSend || !objectId) return;
    const q = question.trim();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectId, question: q }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(
          res.status === 503 ? "사내 LLM 미가용 — 잠시 후 다시 시도하세요" : data?.error ?? `질문 실패 (${res.status})`
        );
      }
      onAppend({
        objectId,
        objectLabel: objectLabel ?? objectId,
        question: q,
        answer: data.answer,
        citedRels: data.citedRels ?? [],
        rels: data.rels ?? [],
        docs: data.docs ?? [],
        cached: !!data.cached,
        generatedAt: data.generatedAt,
      });
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // 답변 본문의 "[R n]" 인용을 클릭 가능한 배지로 — 클릭 시 해당 관계 상대 노드로 그래프 포커스.
  function renderAnswer(text: string, rels: AskRel[]) {
    return text.split(/(\[R\s*\d+\])/g).map((part, i) => {
      const m = /^\[R\s*(\d+)\]$/.exec(part);
      if (!m) return <span key={i}>{part}</span>;
      const rel = rels.find((r) => r.no === Number(m[1]));
      return (
        <button
          key={i}
          type="button"
          className="ask-cite"
          title={rel ? `${relKo(rel.rel)} → ${rel.otherLabel} (그래프에서 보기)` : undefined}
          onClick={rel ? () => onFocusNode(rel.otherId) : undefined}
        >
          {part}
        </button>
      );
    });
  }

  return (
    <>
      <PanelHeader title="🤖 객체 질문" onClose={onClose} />

      {objectId ? (
        <div className="ask-target">
          질문 대상: <b>{objectLabel ?? objectId}</b>
        </div>
      ) : (
        <div className="insp-empty">그래프에서 객체를 선택하세요 — 선택 객체의 관계·근거를 바탕으로 답합니다.</div>
      )}

      <div className="ask-examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="ask-example" onClick={() => setQuestion(ex)}>
            {ex}
          </button>
        ))}
      </div>
      <textarea
        className="ask-input"
        placeholder="선택 객체에 대해 질문하세요 (2~500자)"
        maxLength={500}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <button className="ask-send" disabled={!canSend} onClick={() => void send()}>
        {loading ? "답변 생성 중…" : "질문 전송"}
      </button>

      {loading && (
        <div className="nls-loading">
          <span className="nls-spinner" aria-hidden="true" />
          사내 LLM이 답변을 생성하는 중 — 첫 생성은 최대 90초 걸릴 수 있습니다 (캐시된 질문은 즉시).
        </div>
      )}
      {error && <div className="opinion-card opinion-error">{error}</div>}

      {[...history].reverse().map((h, i) => {
        const cited = h.rels.filter((r) => h.citedRels.includes(r.no));
        const rest = h.rels.filter((r) => !h.citedRels.includes(r.no));
        return (
          <div className="opinion-card" key={history.length - 1 - i}>
            <div className="ask-q">
              <span className="ask-qtag">{h.objectLabel}</span>
              {h.question}
              {h.cached && <span className="ask-cached">캐시됨</span>}
            </div>
            <p className="opinion-body">{renderAnswer(h.answer, h.rels)}</p>
            {cited.length > 0 && (
              <>
                <div className="sec-label">근거 관계</div>
                <div className="ask-relchips">
                  {cited.map((r) => (
                    <button
                      key={r.no}
                      type="button"
                      className="ask-relchip"
                      title={`${r.otherLabel} 을(를) 그래프에서 포커스`}
                      onClick={() => onFocusNode(r.otherId)}
                    >
                      R{r.no} {relKo(r.rel)} → {r.otherLabel}
                    </button>
                  ))}
                </div>
              </>
            )}
            {rest.length > 0 && (
              <details className="ask-more">
                <summary>전체 관계 {h.rels.length}개 보기</summary>
                <div className="ask-relchips">
                  {rest.map((r) => (
                    <button
                      key={r.no}
                      type="button"
                      className="ask-relchip"
                      onClick={() => onFocusNode(r.otherId)}
                    >
                      R{r.no} {relKo(r.rel)} → {r.otherLabel}
                    </button>
                  ))}
                </div>
              </details>
            )}
            {h.docs.length > 0 && (
              <>
                <div className="sec-label">근거 문서</div>
                <div className="ask-relchips">
                  {h.docs.map((d) => (
                    <span key={d} className="cond-evd-chip" style={{ cursor: "default" }}>
                      {d}
                    </span>
                  ))}
                </div>
              </>
            )}
            <div className="opinion-foot">
              LLM 생성 초안 — 최종 판단은 엔지니어 · 생성 {new Date(h.generatedAt).toLocaleString("ko-KR")}
            </div>
          </div>
        );
      })}
    </>
  );
}
