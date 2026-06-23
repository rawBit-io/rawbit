import type { Edge, Viewport } from "@xyflow/react";

import type { FlowData, FlowNode } from "@/types";
import {
  stripEphemeralEdgeUiState,
  stripEphemeralNodeUiState,
} from "@/lib/flow/ephemeralState";

export const FLOW_TEMPLATE_DROP_ZOOM = 0.5;

export function placeFlowDataAtPosition(
  flowData: FlowData,
  dropX: number,
  dropY: number,
): {
  nodes: FlowNode[];
  edges: Edge[];
  anchorPosition: { x: number; y: number } | null;
} {
  if (!flowData.nodes.length) {
    return { nodes: [], edges: [], anchorPosition: null };
  }

  const EPS = 4;
  const topLevelNodes = flowData.nodes.filter((node) => !node.parentId);
  const hasTopLevel = topLevelNodes.length > 0;
  const nodesToConsider = hasTopLevel ? topLevelNodes : flowData.nodes;

  const minY = Math.min(...nodesToConsider.map((node) => node.position.y));
  const anchor = nodesToConsider
    .filter((node) => Math.abs(node.position.y - minY) < EPS)
    .reduce((left, node) =>
      node.position.x < left.position.x ? node : left
    );

  const dx = dropX - anchor.position.x;
  const dy = dropY - anchor.position.y;

  const translated = flowData.nodes.map((old) => {
    const position =
      !old.parentId || !hasTopLevel
        ? { x: old.position.x + dx, y: old.position.y + dy }
        : old.position;
    return { ...old, position, selected: true };
  });

  return {
    nodes: stripEphemeralNodeUiState(translated, true),
    edges: stripEphemeralEdgeUiState(
      flowData.edges.map((edge) => ({
        ...edge,
        ...(edge.data ? { data: { ...edge.data } } : {}),
      }))
    ),
    anchorPosition: { x: dropX, y: dropY },
  };
}

export function getFlowTemplateViewport(
  dropPoint: { x: number; y: number },
  anchorPosition: { x: number; y: number },
  zoom = FLOW_TEMPLATE_DROP_ZOOM
): Viewport {
  return {
    x: dropPoint.x - anchorPosition.x * zoom,
    y: dropPoint.y - anchorPosition.y * zoom,
    zoom,
  };
}
