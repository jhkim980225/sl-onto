"use client";

// 계층(택소노미) 뷰 — 온톨로지→타입→서브타입→개체를 위→아래로 펼치는 하드롤 SVG 노드-링크.
// 포스 그래프(Graph.tsx)와 완전 독립(줌/팬 자체 구현, 새 의존성 없음). 구조·카운트는
// lib/taxonomy.buildTaxonomy(순수 함수)에서, 한글 라벨·색은 여기서 입힌다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node, ObjType } from "@/lib/types";
import { buildTaxonomy, type TaxNode } from "@/lib/taxonomy";
import { TYPES, TYPE_NAMES } from "./typeStyles";

interface SubtypeDef { type_id: string; st_id: string; label_ko: string }

const BOX_W = 156;
const BOX_H = 34;
const X_GAP = 176; // 리프 슬롯 간격(BOX_W보다 넓게 → 가로 겹침 방지)
const LEVEL_GAP = 96; // depth당 세로 간격

interface Placed { node: TaxNode; x: number; y: number }
interface Link { x1: number; y1: number; x2: number; y2: number }

// tidy-tree 1차 배치: 펼쳐진 서브트리만 대상. 리프를 균등 x 배치 후 부모 x=자식 중앙. 순수 계산.
function layout(root: TaxNode, expanded: Set<string>) {
  const boxes: Placed[] = [];
  const links: Link[] = [];
  let leaf = 0;
  const shown = (n: TaxNode): TaxNode[] =>
    n.kind === "root" || expanded.has(n.key) ? n.children : [];
  function walk(n: TaxNode, depth: number): Placed {
    const y = depth * LEVEL_GAP;
    const kids = shown(n);
    let x: number;
    if (kids.length === 0) {
      x = leaf * X_GAP;
      leaf++;
    } else {
      const pk = kids.map((k) => walk(k, depth + 1));
      x = (pk[0].x + pk[pk.length - 1].x) / 2;
      for (const c of pk) links.push({ x1: x, y1: y + BOX_H / 2, x2: c.x, y2: c.y - BOX_H / 2 });
    }
    const placed = { node: n, x, y };
    boxes.push(placed);
    return placed;
  }
  walk(root, 0);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x - BOX_W / 2);
    maxX = Math.max(maxX, b.x + BOX_W / 2);
    minY = Math.min(minY, b.y - BOX_H / 2);
    maxY = Math.max(maxY, b.y + BOX_H / 2);
  }
  return { boxes, links, bounds: { minX, maxX, minY, maxY } };
}

const trunc = (s: string, n = 12) => (s.length > n ? s.slice(0, n) + "…" : s);

export default function HierarchyView({
  nodes,
  subtypeDefs,
  onSelectNode,
  active,
}: {
  nodes: Node[];
  subtypeDefs: SubtypeDef[];
  onSelectNode: (id: string) => void;
  active: boolean;
}) {
  // 기본 접힘: expanded 집합에 든 key만 자식 표시. 초기엔 타입 9개+@ 만 보임.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [vb, setVb] = useState({ x: 0, y: 0, w: 1000, h: 600 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const fittedRef = useRef(false);

  const subMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of subtypeDefs) m.set(d.type_id + ":" + d.st_id, d.label_ko);
    return m;
  }, [subtypeDefs]);

  const tree = useMemo(() => buildTaxonomy(nodes, subtypeDefs), [nodes, subtypeDefs]);
  const { boxes, links, bounds } = useMemo(() => layout(tree, expanded), [tree, expanded]);

  const label = (n: TaxNode): string => {
    if (n.kind === "root") return "온톨로지";
    if (n.kind === "type") return TYPE_NAMES[n.typeId as ObjType] ?? n.label;
    if (n.kind === "subtype") return n.stId === "__none" ? "미분류" : subMap.get(n.typeId + ":" + n.stId) ?? n.label;
    return n.label;
  };

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const aspect = r.width / r.height;
    const pad = 70;
    let w = bounds.maxX - bounds.minX + pad * 2;
    let h = bounds.maxY - bounds.minY + pad * 2;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    setVb({ x: cx - w / 2, y: cy - h / 2, w, h });
  }, [bounds]);

  // 활성화(뷰 전환) 후 첫 표시에서만 초기 fit — 이후엔 사용자 팬/줌 보존(맞춤 버튼으로 재정렬).
  useEffect(() => {
    if (active && !fittedRef.current && boxes.length) {
      fittedRef.current = true;
      requestAnimationFrame(fit);
    }
  }, [active, boxes.length, fit]);

  const zoom = useCallback((f: number, clientX?: number, clientY?: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const aspect = r.width / r.height;
    const ccx = clientX ?? r.left + r.width / 2;
    const ccy = clientY ?? r.top + r.height / 2;
    setVb((v) => {
      const px = v.x + ((ccx - r.left) / r.width) * v.w;
      const py = v.y + ((ccy - r.top) / r.height) * v.h;
      const w = Math.min(9000, Math.max(220, v.w * f));
      const h = w / aspect;
      return {
        x: px - ((ccx - r.left) / r.width) * w,
        y: py - ((ccy - r.top) / r.height) * h,
        w,
        h,
      };
    });
  }, []);

  // 휠 줌(passive:false로 preventDefault)·창 단위 팬 이동/해제 — 리스너는 마운트당 1회 등록.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.1 : 0.9, e.clientX, e.clientY);
    };
    const onMove = (e: MouseEvent) => {
      const p = panRef.current;
      if (!p) return;
      const r = svg.getBoundingClientRect();
      setVb((v) => ({
        ...v,
        x: p.vx - (e.clientX - p.sx) * (v.w / r.width),
        y: p.vy - (e.clientY - p.sy) * (v.h / r.height),
      }));
    };
    const onUp = () => {
      panRef.current = null;
      svg.classList.remove("grabbing");
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      svg.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [zoom]);

  const onBgDown = (e: React.MouseEvent) => {
    panRef.current = { sx: e.clientX, sy: e.clientY, vx: vb.x, vy: vb.y };
    svgRef.current?.classList.add("grabbing");
  };

  const onBoxClick = (n: TaxNode) => {
    if (n.kind === "instance") {
      if (n.nodeId) onSelectNode(n.nodeId);
    } else if (n.kind === "type" || n.kind === "subtype") {
      setExpanded((prev) => {
        const s = new Set(prev);
        if (s.has(n.key)) s.delete(n.key); else s.add(n.key);
        return s;
      });
    }
  };

  return (
    <div className="hv-root">
      <svg
        ref={svgRef}
        className="hv-svg"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={onBgDown}
      >
        <g>
          {links.map((l, i) => (
            <path
              key={i}
              className="hv-link"
              d={`M ${l.x1} ${l.y1} C ${l.x1} ${(l.y1 + l.y2) / 2} ${l.x2} ${(l.y1 + l.y2) / 2} ${l.x2} ${l.y2}`}
            />
          ))}
        </g>
        <g>
          {boxes.map((p) => {
            const n = p.node;
            const color = n.typeId ? TYPES[n.typeId as ObjType]?.c : undefined;
            const expandable = n.kind === "type" || n.kind === "subtype";
            const caret = expandable ? (expanded.has(n.key) ? "▾" : "▸") : "";
            const fill =
              n.kind === "root" ? "var(--ink)"
                : n.kind === "type" ? color ?? "#fff"
                  : n.kind === "subtype" ? "#fff"
                    : "#fff";
            const stroke =
              n.kind === "subtype" ? color ?? "var(--line)"
                : n.kind === "instance" ? "var(--line)"
                  : "none";
            const txt = n.count > 0 && n.kind !== "instance" && n.kind !== "root"
              ? `${trunc(label(n))}  ${n.count}`
              : trunc(label(n), 14);
            return (
              <g
                key={n.key}
                transform={`translate(${p.x},${p.y})`}
                className={"hv-box hv-" + n.kind}
                role="button"
                tabIndex={0}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onBoxClick(n)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBoxClick(n); }
                }}
              >
                <title>{label(n)}</title>
                <rect
                  x={-BOX_W / 2}
                  y={-BOX_H / 2}
                  width={BOX_W}
                  height={BOX_H}
                  rx={8}
                  style={{ fill, stroke, strokeWidth: 1.4, fillOpacity: n.kind === "subtype" ? 0.16 : 1 }}
                />
                {n.kind === "subtype" && (
                  <rect x={-BOX_W / 2} y={-BOX_H / 2} width={4} height={BOX_H} rx={2} style={{ fill: color ?? "var(--line)" }} />
                )}
                {caret && <text className="hv-caret" x={-BOX_W / 2 + 9} y={0}>{caret}</text>}
                <text className={n.kind === "root" ? "hv-rootlbl" : undefined} x={0} y={0}>{txt}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="hv-zoombar">
        <button onClick={() => zoom(0.8)} aria-label="확대">+</button>
        <button onClick={() => zoom(1.25)} aria-label="축소">−</button>
        <button onClick={fit} aria-label="맞춤" title="맞춤">⊡</button>
      </div>
      <div className="hv-hint">타입·서브타입 클릭 = 펼치기/접기 · 개체 클릭 = 그래프에서 보기</div>
    </div>
  );
}
