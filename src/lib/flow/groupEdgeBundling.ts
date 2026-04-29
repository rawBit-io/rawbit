import { Position, type Edge } from "@xyflow/react";

import type { FlowNode, NodeData } from "@/types";

export const GROUP_BUNDLE_EDGE_TYPE = "groupBundle";
export const GROUP_BUNDLE_EDGE_ID_PREFIX = "__group_bundle__:";
export const GROUP_BUNDLE_PORT_NODE_TYPE = "groupBundlePort";
export const GROUP_BUNDLE_PORT_NODE_ID_PREFIX = "__group_bundle_port__:";
export const GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX = "__group_bundle_segment__:";
export const GROUP_BUNDLE_PORT_SOURCE_HANDLE = "out";
export const GROUP_BUNDLE_PORT_TARGET_HANDLE = "in";

const DEFAULT_GROUP_WIDTH = 380;
const DEFAULT_GROUP_HEIGHT = 220;
const MIN_BUNDLE_EDGE_COUNT = 2;
const BUNDLE_PORT_NODE_SIZE = 12;

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

interface BundleAccumulator {
  sourceGroupId: string;
  targetGroupId: string;
  edgeIds: string[];
  edgeRefs: GroupBundleEdgeRef[];
  selectedEdgeIds: Set<string>;
  selected: boolean;
}

interface GroupBundleEdgeRef {
  edgeId: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface GroupBundleEdgeData extends Record<string, unknown> {
  bundledEdgeIds: string[];
  selectedEdgeIds: string[];
  count: number;
  sourceGroupId: string;
  targetGroupId: string;
  sourceLabel: string;
  targetLabel: string;
  sourceBoundaryPoint: Point;
  targetBoundaryPoint: Point;
  renderSourcePort: boolean;
  renderTargetPort: boolean;
  sourcePosition: Position;
  targetPosition: Position;
}

export interface GroupBundleSegmentEdgeData extends Record<string, unknown> {
  bundledEdgeIds: string[];
  selectedEdgeIds: string[];
}

interface GroupBundlePortNodeData extends NodeData {
  bundledEdgeIds: string[];
  selectedEdgeIds: string[];
  groupId: string;
  role: "source" | "target";
}

interface GroupBundledElements {
  nodes: FlowNode[];
  edges: Edge[];
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

const centerOf = (rect: GroupRect): Point => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

const boundaryAnchor = (
  rect: GroupRect,
  position: Position
): {
  boundaryPoint: Point;
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

  return {
    boundaryPoint,
    position,
  };
};

const edgeFallbackId = (edge: Edge): string =>
  `${edge.source}:${edge.sourceHandle ?? ""}->${edge.target}:${
    edge.targetHandle ?? ""
  }`;

export const isGroupBundleEdgeId = (edgeId: string): boolean =>
  edgeId.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX);

export const isGroupBundlePortNodeId = (nodeId: string): boolean =>
  nodeId.startsWith(GROUP_BUNDLE_PORT_NODE_ID_PREFIX);

export const isGroupBundleSegmentEdgeId = (edgeId: string): boolean =>
  edgeId.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX);

export const isGroupBundleVisualEdgeId = (edgeId: string): boolean =>
  isGroupBundleEdgeId(edgeId) || isGroupBundleSegmentEdgeId(edgeId);

export const getGroupBundleSegmentEdgeIds = (edge: Edge): string[] => {
  const bundledEdgeIds = (edge.data as GroupBundleSegmentEdgeData | undefined)
    ?.bundledEdgeIds;
  return Array.isArray(bundledEdgeIds) &&
    bundledEdgeIds.every((edgeId) => typeof edgeId === "string")
    ? bundledEdgeIds
    : [];
};

const groupBundlePortNodeId = (
  role: "source" | "target",
  sourceGroupId: string,
  targetGroupId: string
): string =>
  `${GROUP_BUNDLE_PORT_NODE_ID_PREFIX}${role}:${sourceGroupId}->${targetGroupId}`;

const groupBundleSegmentEdgeId = (
  side: "source" | "target",
  bundleId: string,
  edgeId: string
): string => `${GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX}${side}:${bundleId}:${edgeId}`;

const toBundleEdgeRef = (edge: Edge, edgeId: string): GroupBundleEdgeRef => ({
  edgeId,
  source: edge.source,
  target: edge.target,
  sourceHandle: edge.sourceHandle,
  targetHandle: edge.targetHandle,
});

const buildPortNode = ({
  id,
  point,
  groupId,
  role,
  bundledEdgeIds,
  selectedEdgeIds,
}: {
  id: string;
  point: Point;
  groupId: string;
  role: "source" | "target";
  bundledEdgeIds: string[];
  selectedEdgeIds: string[];
}): FlowNode<GroupBundlePortNodeData> => ({
  id,
  type: GROUP_BUNDLE_PORT_NODE_TYPE,
  position: {
    x: point.x - BUNDLE_PORT_NODE_SIZE / 2,
    y: point.y - BUNDLE_PORT_NODE_SIZE / 2,
  },
  width: BUNDLE_PORT_NODE_SIZE,
  height: BUNDLE_PORT_NODE_SIZE,
  measured: {
    width: BUNDLE_PORT_NODE_SIZE,
    height: BUNDLE_PORT_NODE_SIZE,
  },
  data: {
    title:
      role === "source"
        ? "Group output bundle port"
        : "Group input bundle port",
    width: BUNDLE_PORT_NODE_SIZE,
    height: BUNDLE_PORT_NODE_SIZE,
    bundledEdgeIds,
    selectedEdgeIds,
    groupId,
    role,
  },
  draggable: false,
  selectable: false,
  connectable: false,
  deletable: false,
  focusable: false,
  zIndex: 3,
});

export const buildGroupBundledElements = ({
  nodes,
  edges,
}: {
  nodes: FlowNode[];
  edges: Edge[];
}): GroupBundledElements => {
  const groupRects = new Map<string, GroupRect>();
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

  if (groupRects.size < 2) return { nodes, edges };

  const bundlesByPair = new Map<string, BundleAccumulator>();

  for (const edge of edges) {
    if (isGroupBundleVisualEdgeId(edge.id)) continue;
    const sourceGroupId = nodeToGroup.get(edge.source);
    const targetGroupId = nodeToGroup.get(edge.target);
    if (!sourceGroupId || !targetGroupId) continue;
    if (sourceGroupId === targetGroupId) continue;

    const key = `${sourceGroupId}->${targetGroupId}`;
    const existing = bundlesByPair.get(key);
    const edgeId = edge.id || edgeFallbackId(edge);
    if (existing) {
      existing.edgeIds.push(edgeId);
      existing.edgeRefs.push(toBundleEdgeRef(edge, edgeId));
      if (edge.selected === true) existing.selectedEdgeIds.add(edgeId);
      existing.selected = existing.selected || edge.selected === true;
      continue;
    }

    bundlesByPair.set(key, {
      sourceGroupId,
      targetGroupId,
      edgeIds: [edgeId],
      edgeRefs: [toBundleEdgeRef(edge, edgeId)],
      selectedEdgeIds: edge.selected === true ? new Set([edgeId]) : new Set(),
      selected: edge.selected === true,
    });
  }

  const bundledEdgeIds = new Set<string>();
  const bundleEdges: Edge<GroupBundleEdgeData>[] = [];
  const portNodes: FlowNode[] = [];
  const segmentEdges: Edge<GroupBundleSegmentEdgeData>[] = [];

  for (const bundle of bundlesByPair.values()) {
    if (bundle.edgeIds.length < MIN_BUNDLE_EDGE_COUNT) continue;

    const sourceRect = groupRects.get(bundle.sourceGroupId);
    const targetRect = groupRects.get(bundle.targetGroupId);
    if (!sourceRect || !targetRect) continue;

    bundle.edgeIds.forEach((edgeId) => bundledEdgeIds.add(edgeId));
    const bundleId = `${bundle.sourceGroupId}->${bundle.targetGroupId}`;
    const sourcePortId = groupBundlePortNodeId(
      "source",
      bundle.sourceGroupId,
      bundle.targetGroupId
    );
    const targetPortId = groupBundlePortNodeId(
      "target",
      bundle.sourceGroupId,
      bundle.targetGroupId
    );
    const sourceAnchor = boundaryAnchor(sourceRect, Position.Right);
    const targetAnchor = boundaryAnchor(targetRect, Position.Left);
    const edgeIdOrder = new Map(
      bundle.edgeIds.map((edgeId, index) => [edgeId, index] as const)
    );
    const sortEdgeIds = (edgeIds: Iterable<string>) =>
      Array.from(edgeIds).sort(
        (a, b) =>
          (edgeIdOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (edgeIdOrder.get(b) ?? Number.MAX_SAFE_INTEGER) ||
          a.localeCompare(b)
      );

    const selectedEdgeIds = sortEdgeIds(bundle.selectedEdgeIds);
    portNodes.push(
      buildPortNode({
        id: sourcePortId,
        point: sourceAnchor.boundaryPoint,
        groupId: bundle.sourceGroupId,
        role: "source",
        bundledEdgeIds: bundle.edgeIds,
        selectedEdgeIds,
      }),
      buildPortNode({
        id: targetPortId,
        point: targetAnchor.boundaryPoint,
        groupId: bundle.targetGroupId,
        role: "target",
        bundledEdgeIds: bundle.edgeIds,
        selectedEdgeIds,
      })
    );

    for (const edgeRef of bundle.edgeRefs) {
      const isSelected = bundle.selectedEdgeIds.has(edgeRef.edgeId);
      const segmentData: GroupBundleSegmentEdgeData = {
        bundledEdgeIds: [edgeRef.edgeId],
        selectedEdgeIds: isSelected ? [edgeRef.edgeId] : [],
      };

      segmentEdges.push(
        {
          id: groupBundleSegmentEdgeId("source", bundleId, edgeRef.edgeId),
          source: edgeRef.source,
          sourceHandle: edgeRef.sourceHandle,
          target: sourcePortId,
          targetHandle: GROUP_BUNDLE_PORT_TARGET_HANDLE,
          selectable: false,
          deletable: false,
          reconnectable: false,
          focusable: false,
          selected: isSelected,
          data: segmentData,
          className: "group-bundle-segment-edge",
          interactionWidth: 18,
        },
        {
          id: groupBundleSegmentEdgeId("target", bundleId, edgeRef.edgeId),
          source: targetPortId,
          sourceHandle: GROUP_BUNDLE_PORT_SOURCE_HANDLE,
          target: edgeRef.target,
          targetHandle: edgeRef.targetHandle,
          selectable: false,
          deletable: false,
          reconnectable: false,
          focusable: false,
          selected: isSelected,
          data: segmentData,
          className: "group-bundle-segment-edge",
          interactionWidth: 18,
        }
      );
    }

    bundleEdges.push({
      id: `${GROUP_BUNDLE_EDGE_ID_PREFIX}${bundleId}`,
      type: GROUP_BUNDLE_EDGE_TYPE,
      source: sourcePortId,
      target: targetPortId,
      sourceHandle: GROUP_BUNDLE_PORT_SOURCE_HANDLE,
      targetHandle: GROUP_BUNDLE_PORT_TARGET_HANDLE,
      selectable: false,
      deletable: false,
      reconnectable: false,
      focusable: false,
      selected: bundle.selected,
      data: {
        bundledEdgeIds: bundle.edgeIds,
        selectedEdgeIds,
        count: bundle.edgeIds.length,
        sourceGroupId: bundle.sourceGroupId,
        targetGroupId: bundle.targetGroupId,
        sourceLabel: sourceRect.label,
        targetLabel: targetRect.label,
        sourceBoundaryPoint: sourceAnchor.boundaryPoint,
        targetBoundaryPoint: targetAnchor.boundaryPoint,
        renderSourcePort: true,
        renderTargetPort: true,
        sourcePosition: sourceAnchor.position,
        targetPosition: targetAnchor.position,
      },
    });
  }

  if (bundleEdges.length === 0) return { nodes, edges };

  const renderedEdges = edges.map((edge) =>
    bundledEdgeIds.has(edge.id || edgeFallbackId(edge))
      ? { ...edge, hidden: true }
      : edge
  );

  const renderedSourcePortGroups = new Set<string>();
  const renderedTargetPortGroups = new Set<string>();
  const sortedBundleEdgeSeeds = bundleEdges.sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  const sortedBundleEdges = sortedBundleEdgeSeeds.map((edge) => {
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

  return {
    nodes: [...nodes, ...portNodes],
    edges: [...renderedEdges, ...segmentEdges, ...sortedBundleEdges],
  };
};

export const buildGroupBundledEdges = ({
  nodes,
  edges,
}: {
  nodes: FlowNode[];
  edges: Edge[];
}): Edge[] => buildGroupBundledElements({ nodes, edges }).edges;
