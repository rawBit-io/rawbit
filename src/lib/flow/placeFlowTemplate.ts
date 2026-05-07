import type { Edge, Viewport } from "@xyflow/react";

import type { FlowData, FlowNode } from "@/types";

export const FLOW_TEMPLATE_DROP_ZOOM = 0.5;

const FLOW_LAYOUT_NOTICE_WIDTH = 460;
const FLOW_LAYOUT_NOTICE_HEIGHT = 230;
const FLOW_LAYOUT_NOTICE_GAP = 48;
const FLOW_LAYOUT_NOTICE_CONTENT = `## Flow layout update

Flow examples are being visually reworked with clearer groups, notes, and layout.

The flow remains usable here. The previous layout is temporarily available at [dev.rawbit.io](https://dev.rawbit.io).

Source: [github.com/rawBit-io/rawbit](https://github.com/rawBit-io/rawbit)`;

type PlaceFlowOptions = {
  includeLayoutNotice?: boolean;
  noticeIdFactory?: () => string;
};

export function placeFlowDataAtPosition(
  flowData: FlowData,
  dropX: number,
  dropY: number,
  options: PlaceFlowOptions = {}
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

  const minX = Math.min(...nodesToConsider.map((node) => node.position.x));
  const anchor = nodesToConsider
    .filter((node) => Math.abs(node.position.x - minX) < EPS)
    .reduce((top, node) =>
      node.position.y < top.position.y ? node : top
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

  if (options.includeLayoutNotice === false) {
    return {
      nodes: translated,
      edges: flowData.edges,
      anchorPosition: { x: dropX, y: dropY },
    };
  }

  const layoutNoticeNode: FlowNode = {
    id:
      options.noticeIdFactory?.() ??
      `flow-layout-notice_${Math.random().toString(36).slice(2, 9)}`,
    type: "shadcnTextInfo",
    position: {
      x: dropX,
      y: dropY - FLOW_LAYOUT_NOTICE_HEIGHT - FLOW_LAYOUT_NOTICE_GAP,
    },
    selected: true,
    data: {
      title: "Flow layout update",
      content: FLOW_LAYOUT_NOTICE_CONTENT,
      fontSize: 24,
      width: FLOW_LAYOUT_NOTICE_WIDTH,
      height: FLOW_LAYOUT_NOTICE_HEIGHT,
    },
  };

  return {
    nodes: [...translated, layoutNoticeNode],
    edges: flowData.edges,
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
