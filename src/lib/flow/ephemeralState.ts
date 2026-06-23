import type { Edge } from "@xyflow/react";

import type { FlowNode } from "@/types";

const HIGHLIGHT_CLASS_RE = /\bis-highlighted\b/g;

function stripHighlightClass(className: string | undefined) {
  return className?.replace(HIGHLIGHT_CLASS_RE, "").trim() || undefined;
}

function stripEphemeralNodeData(data: FlowNode["data"] | undefined) {
  if (!data || (!("isHighlighted" in data) && !("searchMark" in data))) {
    return data;
  }

  const next = { ...data };
  delete next.isHighlighted;
  delete next.searchMark;
  return next;
}

export function stripEphemeralNodeUiState<TNode extends FlowNode>(
  nodes: TNode[],
  selected = false
): TNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    const nextClassName = stripHighlightClass(node.className);
    const nextData = stripEphemeralNodeData(node.data);
    const needsUpdate =
      node.selected !== selected ||
      node.className !== nextClassName ||
      node.data !== nextData;

    if (!needsUpdate) return node;
    changed = true;
    return {
      ...node,
      selected,
      className: nextClassName,
      data: nextData,
    } as TNode;
  });

  return changed ? nextNodes : nodes;
}

export function stripEphemeralEdgeUiState<TEdge extends Edge>(
  edges: TEdge[]
): TEdge[] {
  let changed = false;
  const nextEdges = edges.map((edge) => {
    const data = edge.data as Record<string, unknown> | undefined;
    const hasSelectedEdgeIds = Boolean(data && "selectedEdgeIds" in data);
    const nextData = hasSelectedEdgeIds ? { ...data } : data;
    if (nextData && hasSelectedEdgeIds) {
      delete nextData.selectedEdgeIds;
    }

    if (edge.selected === false && nextData === edge.data) return edge;

    changed = true;
    return {
      ...edge,
      selected: false,
      ...(nextData ? { data: nextData } : edge.data ? { data: nextData } : {}),
    } as TEdge;
  });

  return changed ? nextEdges : edges;
}
