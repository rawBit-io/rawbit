import { Position, type Edge } from "@xyflow/react";

import type { FlowNode, NodeData } from "@/types";

export const GROUP_BUNDLE_EDGE_TYPE = "groupBundle";
export const GROUP_BUNDLE_EDGE_ID_PREFIX = "__group_bundle__:";

const DEFAULT_GROUP_WIDTH = 380;
const DEFAULT_GROUP_HEIGHT = 220;
const DEFAULT_NODE_WIDTH = 260;
const DEFAULT_NODE_HEIGHT = 120;
const BUNDLE_BOUNDARY_OFFSET = 12;
const BUNDLE_BOUNDARY_INSET = 10;
const MIN_BUNDLE_EDGE_COUNT = 2;

interface Point {
  x: number;
  y: number;
}

interface GroupRect {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NodeRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BundleAccumulator {
  sourceGroupId: string;
  targetGroupId: string;
  representativeSourceNodeId: string;
  representativeTargetNodeId: string;
  representativeSourceHandle?: string | null;
  representativeTargetHandle?: string | null;
  edgeIds: string[];
  endpointNodeIds: Set<string>;
  sourceNodeIds: Set<string>;
  targetNodeIds: Set<string>;
  selected: boolean;
}

export interface GroupBundleTerminal {
  nodeId: string;
  point: Point;
}

export interface GroupBundleEdgeData extends Record<string, unknown> {
  bundledEdgeIds: string[];
  endpointNodeIds: string[];
  count: number;
  sourceGroupId: string;
  targetGroupId: string;
  sourceLabel: string;
  targetLabel: string;
  sourcePoint: Point;
  targetPoint: Point;
  sourceBoundaryPoint: Point;
  targetBoundaryPoint: Point;
  sourceInsidePoint: Point;
  targetInsidePoint: Point;
  sourceTerminals: GroupBundleTerminal[];
  targetTerminals: GroupBundleTerminal[];
  renderSourcePort: boolean;
  renderTargetPort: boolean;
  sourcePosition: Position;
  targetPosition: Position;
}

const asFiniteNumber = (value: unknown): number | undefined => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const groupLabel = (node: FlowNode): string =>
  asString((node.data as NodeData | undefined)?.title) ?? node.id;

const groupRect = (node: FlowNode): GroupRect => {
  const data = node.data as NodeData | undefined;
  return {
    id: node.id,
    label: groupLabel(node),
    x: node.positionAbsolute?.x ?? node.position.x,
    y: node.positionAbsolute?.y ?? node.position.y,
    width:
      asFiniteNumber(data?.width) ??
      asFiniteNumber(node.width) ??
      asFiniteNumber(node.measured?.width) ??
      DEFAULT_GROUP_WIDTH,
    height:
      asFiniteNumber(data?.height) ??
      asFiniteNumber(node.height) ??
      asFiniteNumber(node.measured?.height) ??
      DEFAULT_GROUP_HEIGHT,
  };
};

const nodeRect = (
  node: FlowNode,
  groupRects: Map<string, GroupRect>
): NodeRect => {
  const data = node.data as NodeData | undefined;
  const parentRect = node.parentId ? groupRects.get(node.parentId) : undefined;
  return {
    id: node.id,
    x:
      node.positionAbsolute?.x ??
      (parentRect ? parentRect.x + node.position.x : node.position.x),
    y:
      node.positionAbsolute?.y ??
      (parentRect ? parentRect.y + node.position.y : node.position.y),
    width:
      asFiniteNumber(data?.width) ??
      asFiniteNumber(node.width) ??
      asFiniteNumber(node.measured?.width) ??
      DEFAULT_NODE_WIDTH,
    height:
      asFiniteNumber(data?.height) ??
      asFiniteNumber(node.height) ??
      asFiniteNumber(node.measured?.height) ??
      DEFAULT_NODE_HEIGHT,
  };
};

const outwardVector = (side: Position): Point => {
  switch (side) {
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Bottom:
      return { x: 0, y: 1 };
    default:
      return { x: 1, y: 0 };
  }
};

const centerOf = (rect: GroupRect): Point => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

const boundaryAnchor = (
  rect: GroupRect,
  position: Position
): {
  boundaryPoint: Point;
  insidePoint: Point;
  outsidePoint: Point;
  position: Position;
} => {
  const center = centerOf(rect);
  const boundaryPoint = (() => {
    switch (position) {
      case Position.Left:
        return {
          x: rect.x,
          y: center.y,
        };
      case Position.Right:
        return {
          x: rect.x + rect.width,
          y: center.y,
        };
      case Position.Top:
        return {
          x: center.x,
          y: rect.y,
        };
      case Position.Bottom:
        return {
          x: center.x,
          y: rect.y + rect.height,
        };
      default:
        return {
          x: rect.x + rect.width,
          y: center.y,
        };
    }
  })();
  const outward = outwardVector(position);

  return {
    boundaryPoint,
    insidePoint: {
      x: boundaryPoint.x - outward.x * BUNDLE_BOUNDARY_INSET,
      y: boundaryPoint.y - outward.y * BUNDLE_BOUNDARY_INSET,
    },
    outsidePoint: {
      x: boundaryPoint.x + outward.x * BUNDLE_BOUNDARY_OFFSET,
      y: boundaryPoint.y + outward.y * BUNDLE_BOUNDARY_OFFSET,
    },
    position,
  };
};

const nodeBoundaryPoint = (rect: NodeRect, side: Position): Point => {
  switch (side) {
    case Position.Left:
      return { x: rect.x, y: rect.y + rect.height / 2 };
    case Position.Right:
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    case Position.Top:
      return { x: rect.x + rect.width / 2, y: rect.y };
    case Position.Bottom:
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    default:
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  }
};

const edgeFallbackId = (edge: Edge): string =>
  `${edge.source}:${edge.sourceHandle ?? ""}->${edge.target}:${
    edge.targetHandle ?? ""
  }`;

export const isGroupBundleEdgeId = (edgeId: string): boolean =>
  edgeId.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX);

export const buildGroupBundledEdges = ({
  nodes,
  edges,
}: {
  nodes: FlowNode[];
  edges: Edge[];
}): Edge[] => {
  const groupRects = new Map<string, GroupRect>();
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const nodeToGroup = new Map<string, string>();

  for (const node of nodes) {
    if (node.type === "shadcnGroup") {
      groupRects.set(node.id, groupRect(node));
      nodeToGroup.set(node.id, node.id);
    }
  }

  for (const node of nodes) {
    if (!node.parentId || !groupRects.has(node.parentId)) continue;
    nodeToGroup.set(node.id, node.parentId);
  }

  if (groupRects.size < 2) return edges;

  const bundlesByPair = new Map<string, BundleAccumulator>();

  for (const edge of edges) {
    if (isGroupBundleEdgeId(edge.id)) continue;
    const sourceGroupId = nodeToGroup.get(edge.source);
    const targetGroupId = nodeToGroup.get(edge.target);
    if (!sourceGroupId || !targetGroupId) continue;
    if (sourceGroupId === targetGroupId) continue;

    const key = `${sourceGroupId}->${targetGroupId}`;
    const existing = bundlesByPair.get(key);
    const edgeId = edge.id || edgeFallbackId(edge);
    if (existing) {
      existing.edgeIds.push(edgeId);
      existing.endpointNodeIds.add(edge.source);
      existing.endpointNodeIds.add(edge.target);
      existing.sourceNodeIds.add(edge.source);
      existing.targetNodeIds.add(edge.target);
      existing.selected = existing.selected || edge.selected === true;
      continue;
    }

    bundlesByPair.set(key, {
      sourceGroupId,
      targetGroupId,
      representativeSourceNodeId: edge.source,
      representativeTargetNodeId: edge.target,
      representativeSourceHandle: edge.sourceHandle,
      representativeTargetHandle: edge.targetHandle,
      edgeIds: [edgeId],
      endpointNodeIds: new Set([edge.source, edge.target]),
      sourceNodeIds: new Set([edge.source]),
      targetNodeIds: new Set([edge.target]),
      selected: edge.selected === true,
    });
  }

  const bundledEdgeIds = new Set<string>();
  const bundleEdges: Edge<GroupBundleEdgeData>[] = [];

  for (const bundle of bundlesByPair.values()) {
    if (bundle.edgeIds.length < MIN_BUNDLE_EDGE_COUNT) continue;

    const sourceRect = groupRects.get(bundle.sourceGroupId);
    const targetRect = groupRects.get(bundle.targetGroupId);
    if (!sourceRect || !targetRect) continue;

    bundle.edgeIds.forEach((edgeId) => bundledEdgeIds.add(edgeId));
    const sourceAnchor = boundaryAnchor(sourceRect, Position.Right);
    const targetAnchor = boundaryAnchor(targetRect, Position.Left);
    const sourceTerminals = Array.from(bundle.sourceNodeIds)
      .sort((a, b) => a.localeCompare(b))
      .map((nodeId) => {
        const sourceNode = nodeById.get(nodeId);
        if (!sourceNode) return null;
        return {
          nodeId,
          point: nodeBoundaryPoint(
            nodeRect(sourceNode, groupRects),
            sourceAnchor.position
          ),
        } satisfies GroupBundleTerminal;
      })
      .filter((terminal): terminal is GroupBundleTerminal =>
        Boolean(terminal)
      );
    const targetTerminals = Array.from(bundle.targetNodeIds)
      .sort((a, b) => a.localeCompare(b))
      .map((nodeId) => {
        const targetNode = nodeById.get(nodeId);
        if (!targetNode) return null;
        return {
          nodeId,
          point: nodeBoundaryPoint(
            nodeRect(targetNode, groupRects),
            targetAnchor.position
          ),
        } satisfies GroupBundleTerminal;
      })
      .filter((terminal): terminal is GroupBundleTerminal =>
        Boolean(terminal)
      );

    bundleEdges.push({
      id: `${GROUP_BUNDLE_EDGE_ID_PREFIX}${bundle.sourceGroupId}->${bundle.targetGroupId}`,
      type: GROUP_BUNDLE_EDGE_TYPE,
      source: bundle.representativeSourceNodeId,
      target: bundle.representativeTargetNodeId,
      sourceHandle: bundle.representativeSourceHandle,
      targetHandle: bundle.representativeTargetHandle,
      selectable: false,
      deletable: false,
      reconnectable: false,
      focusable: false,
      selected: bundle.selected,
      data: {
        bundledEdgeIds: bundle.edgeIds,
        endpointNodeIds: Array.from(bundle.endpointNodeIds).sort((a, b) =>
          a.localeCompare(b)
        ),
        count: bundle.edgeIds.length,
        sourceGroupId: bundle.sourceGroupId,
        targetGroupId: bundle.targetGroupId,
        sourceLabel: sourceRect.label,
        targetLabel: targetRect.label,
        sourcePoint: sourceAnchor.outsidePoint,
        targetPoint: targetAnchor.outsidePoint,
        sourceBoundaryPoint: sourceAnchor.boundaryPoint,
        targetBoundaryPoint: targetAnchor.boundaryPoint,
        sourceInsidePoint: sourceAnchor.insidePoint,
        targetInsidePoint: targetAnchor.insidePoint,
        sourceTerminals,
        targetTerminals,
        renderSourcePort: true,
        renderTargetPort: true,
        sourcePosition: sourceAnchor.position,
        targetPosition: targetAnchor.position,
      },
    });
  }

  if (bundleEdges.length === 0) return edges;

  const renderedEdges = edges.map((edge) =>
    bundledEdgeIds.has(edge.id || edgeFallbackId(edge))
      ? { ...edge, hidden: true }
      : edge
  );

  const renderedSourcePortGroups = new Set<string>();
  const renderedTargetPortGroups = new Set<string>();
  const sortedBundleEdges = bundleEdges
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((edge) => {
      const data = edge.data;
      if (!data) return edge;
      const renderSourcePort =
        edge.selected === true ||
        !renderedSourcePortGroups.has(data.sourceGroupId);
      const renderTargetPort =
        edge.selected === true ||
        !renderedTargetPortGroups.has(data.targetGroupId);
      renderedSourcePortGroups.add(data.sourceGroupId);
      renderedTargetPortGroups.add(data.targetGroupId);
      return {
        ...edge,
        data: {
          ...data,
          renderSourcePort,
          renderTargetPort,
        },
      };
    });

  return [...renderedEdges, ...sortedBundleEdges];
};
