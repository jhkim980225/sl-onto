"use client";

// 정적 온톨로지 그래프 UI — 떠다니는 물리 노드 아님, 결정적 레이아웃.
// 설계: docs/superpowers/specs/2026-07-22-v2-neo4j-foundation-design.md §0
import { useMemo, useState, useCallback } from "react";
import ReactFlow, {
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { GraphView, Entity } from "@/lib/neo4j/types";

interface OntologyGraphProps {
  data: GraphView;
  onSelectEntity?: (id: string) => void;
  onDeleteEntity?: (id: string) => void;
}

// 라이트 SL 브랜드 팔레트. 알려진 타입만 고정 색, 나머지는 순환 배정.
const TYPE_COLORS: Record<string, string> = {
  person: "#00a2e5",
  org: "#5EA8FF",
  product: "#FFC46B",
  email: "#8291a8",
  topic: "#B18CFF",
  문서: "#14243f",
};
const FALLBACK_COLORS = ["#5EDC9A", "#FF8A3D", "#FF5470", "#93A8FF", "#4FE0D2"];
const DEFAULT_COLOR = "#a0acc0";

function colorForType(type: string): string {
  if (TYPE_COLORS[type]) return TYPE_COLORS[type];
  if (!type) return DEFAULT_COLOR;
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

type EntityNodeData = {
  entity: Entity;
  color: string;
  selected: boolean;
  onDelete?: (id: string) => void;
};

// 온톨로지 그래프식 원형 노드 — 색=타입, 라벨은 원 아래. 문서 노드는 📄 + 조금 크게.
function EntityNode({ data }: NodeProps<EntityNodeData>) {
  const { entity, color, selected, onDelete } = data;
  const isDoc = entity.props?.kind === "document";
  const size = isDoc ? 46 : 58;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: selected ? color : `${color}26`, // 선택 시 채움, 평소 옅은 틴트
          border: `${selected ? 3 : 2.5}px solid ${color}`,
          boxShadow: selected ? `0 0 0 4px ${color}40` : "0 1px 3px rgba(0,33,87,0.14)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "box-shadow .12s, background .12s",
        }}
      >
        {isDoc && <span style={{ fontSize: 16, lineHeight: 1 }}>📄</span>}
      </div>
      <div
        style={{
          position: "absolute",
          top: size + 3,
          left: "50%",
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
          fontSize: 11,
          fontWeight: 600,
          color: "#14243f",
          textShadow: "0 1px 2px #fff,0 -1px 2px #fff,1px 0 2px #fff,-1px 0 2px #fff",
          pointerEvents: "none",
        }}
      >
        {entity.name}
      </div>
      {selected && onDelete && !isDoc && (
        <button
          type="button"
          aria-label={`${entity.name} 삭제`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(entity.id);
          }}
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: "1px solid #FF5470",
            background: "#fff",
            color: "#FF5470",
            fontSize: 11,
            lineHeight: "16px",
            padding: 0,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

const nodeTypes = { entity: EntityNode };

// 결정적 원형 레이아웃 — 물리 시뮬 없음, 인덱스 기반 배치.
function layout(data: GraphView): { nodes: Node[]; edges: Edge[] } {
  const count = data.entities.length;
  const radius = Math.max(200, count * 40);
  const nodes: Node[] = data.entities.map((entity, i) => {
    const angle = (2 * Math.PI * i) / Math.max(count, 1);
    return {
      id: entity.id,
      type: "entity",
      position: {
        x: radius * Math.cos(angle) + radius,
        y: radius * Math.sin(angle) + radius,
      },
      data: { entity, color: colorForType(entity.type), selected: false },
    };
  });

  const edges: Edge[] = data.relations.map((rel, i) => ({
    id: `${rel.src}-${rel.type}-${rel.dst}-${i}`,
    source: rel.src,
    target: rel.dst,
    label: rel.type,
    style: { stroke: "#a0acc0" },
    labelStyle: { fill: "#14243f", fontSize: 10 },
    labelBgStyle: { fill: "#fff" },
  }));

  return { nodes, edges };
}

export default function OntologyGraph({ data, onSelectEntity, onDeleteEntity }: OntologyGraphProps) {
  const { nodes: baseNodes, edges } = useMemo(() => layout(data), [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = useMemo(
    () =>
      baseNodes.map((n) => ({
        ...n,
        data: { ...n.data, selected: n.id === selectedId, onDelete: onDeleteEntity },
      })),
    [baseNodes, selectedId, onDeleteEntity]
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      setSelectedId(node.id);
      onSelectEntity?.(node.id);
    },
    [onSelectEntity]
  );

  return (
    <div style={{ width: "100%", height: "100%", background: "#fff" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e2e8f0" gap={24} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
