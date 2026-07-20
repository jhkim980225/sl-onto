"use client";

// 좌측 드로어 — 캔버스 스키마(객체타입·관계타입) 편집.
// 빈 캔버스에서 여기로 타입을 정의해야 문서 인제스천이 노드를 만들 수 있다.
// 삭제 실패(409)는 서버가 준 한국어 사유를 그대로 노출한다("이 타입의 노드가 12개 남아 있어…").
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { reasonOf } from "./apiError";

interface ObjectType {
  type_id: string;
  label_ko: string;
  description: string | null;
}
interface RelationType {
  rel_id: string;
  label_ko: string;
  src_types: string[];
  dst_types: string[];
}

interface SchemaPanelProps {
  /** 스키마가 바뀌면(타입 추가·삭제) 부모가 capabilities 를 다시 조회하게 한다. */
  onChanged?: () => void;
}

export default function SchemaPanel({ onChanged }: SchemaPanelProps) {
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [rels, setRels] = useState<RelationType[]>([]);
  const [tId, setTId] = useState("");
  const [tLabel, setTLabel] = useState("");
  const [rId, setRId] = useState("");
  const [rLabel, setRLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await apiFetch("/api/schema").then((r) => r.json());
    setTypes(j.objectTypes ?? []);
    setRels(j.relationTypes ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addType() {
    setErr(null);
    const r = await apiFetch("/api/schema/object-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type_id: tId.trim(), label_ko: tLabel.trim() }),
    });
    if (!r.ok) {
      setErr(await reasonOf(r, "추가 실패"));
      return;
    }
    setTId("");
    setTLabel("");
    await load();
    onChanged?.(); // 객체타입이 바뀌면 기능 가용성(capabilities)도 바뀐다
  }

  async function delType(id: string) {
    setErr(null);
    const r = await apiFetch(`/api/schema/object-types?type_id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) {
      setErr(await reasonOf(r, "삭제 실패"));
      return;
    }
    await load();
    onChanged?.();
  }

  async function addRel() {
    setErr(null);
    const r = await apiFetch("/api/schema/relation-types", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rel_id: rId.trim().toUpperCase(), label_ko: rLabel.trim(), src_types: [], dst_types: [] }),
    });
    if (!r.ok) {
      setErr(await reasonOf(r, "추가 실패"));
      return;
    }
    setRId("");
    setRLabel("");
    await load();
  }

  async function delRel(id: string) {
    setErr(null);
    const r = await apiFetch(`/api/schema/relation-types?rel_id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) {
      setErr(await reasonOf(r, "삭제 실패"));
      return;
    }
    await load();
  }

  return (
    <div className="sc-panel">
      {err && <p className="sc-err">{err}</p>}

      <h4 className="sc-h">객체 타입 ({types.length})</h4>
      <ul className="sc-list">
        {types.length === 0 && <li className="sc-empty">타입이 없습니다 — 먼저 정의하세요</li>}
        {types.map((t) => (
          <li key={t.type_id} className="sc-item">
            <code>{t.type_id}</code>
            <span title={t.description ?? t.label_ko}>{t.label_ko}</span>
            <button className="sc-act" title="삭제" onClick={() => void delType(t.type_id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="sc-new">
        <input value={tId} onChange={(e) => setTId(e.target.value)} placeholder="id (예: item)" maxLength={31} />
        <input value={tLabel} onChange={(e) => setTLabel(e.target.value)} placeholder="표시명 (예: 부품)" maxLength={40} />
        <button onClick={() => void addType()} disabled={!tId.trim() || !tLabel.trim()}>
          + 추가
        </button>
      </div>

      <h4 className="sc-h">관계 타입 ({rels.length})</h4>
      <ul className="sc-list">
        {rels.length === 0 && <li className="sc-empty">관계가 없습니다</li>}
        {rels.map((r) => (
          <li key={r.rel_id} className="sc-item">
            <code>{r.rel_id}</code>
            <span>{r.label_ko}</span>
            <button className="sc-act" title="삭제" onClick={() => void delRel(r.rel_id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="sc-new">
        <input value={rId} onChange={(e) => setRId(e.target.value)} placeholder="id (예: HAS_FAILURE)" maxLength={31} />
        <input
          value={rLabel}
          onChange={(e) => setRLabel(e.target.value)}
          placeholder="표시명 (예: 고장모드 보유)"
          maxLength={40}
        />
        <button onClick={() => void addRel()} disabled={!rId.trim() || !rLabel.trim()}>
          + 추가
        </button>
      </div>
    </div>
  );
}
