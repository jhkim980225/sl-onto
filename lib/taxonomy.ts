// lib/taxonomy.ts — 계층(택소노미) 뷰용 트리 빌더(순수 함수, 프레임워크 비의존).
// 타입→서브타입→개체 3레벨. 라벨 한글화·색은 컴포넌트(typeStyles/metamodel) 몫 — 여기선 구조·카운트·raw id만.
import type { Node } from "./types";

// 서브타입 정의(라벨은 컴포넌트가 입히므로 여기선 id·매핑만 필요)
export interface SubtypeDef { type_id: string; st_id: string; label_ko: string }

export type TaxKind = "root" | "type" | "subtype" | "instance";
export interface TaxNode {
  kind: TaxKind;
  key: string;          // 트리 내 고유 키("root" / "type:item" / "st:item:optics" / "inst:ILED")
  typeId?: string;      // type/subtype/instance 의 소속 타입 id
  stId?: string;        // subtype/instance 의 서브타입 id ("__none"=미분류)
  nodeId?: string;      // instance 전용 — 원본 노드 id(클릭 시 그래프 포커스용)
  label: string;        // type/subtype 는 raw id, instance 는 원본 node.label
  count: number;        // 이 서브트리에 속한 개체(instance) 총수
  children: TaxNode[];
}

// 타입 표시 순서(온톨로지 관례)
export const TYPE_ORDER: string[] = ["item", "fm", "cause", "action", "reg", "proj", "master", "spec", "doc"];

const NONE = "__none"; // 미분류 서브타입 그룹 stId

function instanceOf(n: Node): TaxNode {
  return { kind: "instance", key: "inst:" + n.id, typeId: n.type, stId: n.st, nodeId: n.id, label: n.label, count: 1, children: [] };
}

function byLabel(a: TaxNode, b: TaxNode): number {
  return a.label.localeCompare(b.label);
}

export function buildTaxonomy(nodes: Node[], subtypeDefs: SubtypeDef[]): TaxNode {
  const root: TaxNode = { kind: "root", key: "root", label: "root", count: 0, children: [] };

  // 타입별 개체 그룹
  const byType = new Map<string, Node[]>();
  for (const n of nodes) {
    const arr = byType.get(n.type);
    if (arr) arr.push(n); else byType.set(n.type, [n]);
  }

  for (const typeId of TYPE_ORDER) {
    const typeNodes = byType.get(typeId);
    if (!typeNodes || typeNodes.length === 0) continue;

    const typeNode: TaxNode = { kind: "type", key: "type:" + typeId, typeId, label: typeId, count: typeNodes.length, children: [] };
    const defs = subtypeDefs.filter((d) => d.type_id === typeId);

    if (defs.length === 0) {
      // 서브타입 정의 없는 타입 → 개체를 타입 직속
      typeNode.children = typeNodes.map(instanceOf).sort(byLabel);
    } else {
      const claimed = new Set<string>();
      for (const def of defs) {
        const members = typeNodes.filter((n) => n.st === def.st_id);
        if (members.length === 0) continue;
        members.forEach((n) => claimed.add(n.id));
        typeNode.children.push({
          kind: "subtype", key: "st:" + typeId + ":" + def.st_id, typeId, stId: def.st_id,
          label: def.st_id, count: members.length, children: members.map(instanceOf).sort(byLabel),
        });
      }
      // 미분류: st 없거나 정의에 없는 st → 마지막 그룹
      const misc = typeNodes.filter((n) => !claimed.has(n.id));
      if (misc.length > 0) {
        typeNode.children.push({
          kind: "subtype", key: "st:" + typeId + ":" + NONE, typeId, stId: NONE,
          label: "미분류", count: misc.length, children: misc.map(instanceOf).sort(byLabel),
        });
      }
    }

    root.children.push(typeNode);
    root.count += typeNode.count;
  }

  return root;
}
