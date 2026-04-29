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
  edge: Edge;
  index: number;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface GroupBundleEdgeData extends Record<string, unknown> {
  bundledEdgeIds: string[];
  selectedEdgeIds: string[];
  representedEdges?: GroupBundleRepresentedEdge[];
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

interface GroupBundleRepresentedEdge {
  index: number;
  edge: Edge;
}

interface GroupBundleSegmentAccumulator {
  nodeId: string;
  handle?: string | null;
  edgeIds: string[];
  selectedEdgeIds: Set<string>;
  order: number;
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

interface GroupBundleCanonicalElements {
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

const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

export const isGroupBundleEdgeId = (edgeId: string): boolean =>
  edgeId.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX);

export const isGroupBundlePortNodeId = (nodeId: string): boolean =>
  nodeId.startsWith(GROUP_BUNDLE_PORT_NODE_ID_PREFIX);

export const isGroupBundleSegmentEdgeId = (edgeId: string): boolean =>
  edgeId.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX);

export const isGroupBundleVisualEdgeId = (edgeId: string): boolean =>
  isGroupBundleEdgeId(edgeId) || isGroupBundleSegmentEdgeId(edgeId);

export const stripGroupBundlePortNodes = <T extends { id: string }>(
  nodes: T[]
): T[] =>
  nodes.some((node) => isGroupBundlePortNodeId(node.id))
    ? nodes.filter((node) => !isGroupBundlePortNodeId(node.id))
    : nodes;

export const stripGroupBundleVisualEdges = <T extends { id: string }>(
  edges: T[]
): T[] =>
  edges.some((edge) => isGroupBundleVisualEdgeId(edge.id))
    ? edges.filter((edge) => !isGroupBundleVisualEdgeId(edge.id))
    : edges;

export const sanitizeGroupBundleRenderEdgesForState = (
  edges: Edge[]
): Edge[] => {
  const recoveredEdges = new Map<string, GroupBundleRepresentedEdge>();
  for (const edge of edges) {
    if (!isGroupBundleEdgeId(edge.id)) continue;
    const representedEdges = (edge.data as GroupBundleEdgeData | undefined)
      ?.representedEdges;
    if (!Array.isArray(representedEdges)) continue;
    for (const representedEdge of representedEdges) {
      if (
        typeof representedEdge?.index !== "number" ||
        !representedEdge.edge ||
        typeof representedEdge.edge !== "object"
      ) {
        continue;
      }
      const represented = representedEdge.edge;
      recoveredEdges.set(represented.id || edgeFallbackId(represented), {
        index: representedEdge.index,
        edge: represented,
      });
    }
  }

  const sourceEdges = stripGroupBundleVisualEdges(edges);
  let changed = sourceEdges !== edges;
  const sanitizedEdges = sourceEdges.map((edge) => {
    if (edge.hidden !== true) return edge;
    changed = true;
    const nextEdge = { ...edge };
    delete nextEdge.hidden;
    return nextEdge;
  });

  const existingEdgeIds = new Set(
    sanitizedEdges.map((edge) => edge.id || edgeFallbackId(edge))
  );
  const restoredEdges = Array.from(recoveredEdges.values())
    .filter(({ edge }) => !existingEdgeIds.has(edge.id || edgeFallbackId(edge)))
    .sort((a, b) => a.index - b.index)
    .map(({ edge }) => ({ ...edge }));

  if (restoredEdges.length === 0) return changed ? sanitizedEdges : edges;

  const restoredByIndex = new Map<number, Edge[]>();
  for (const edge of restoredEdges) {
    const index = recoveredEdges.get(edge.id || edgeFallbackId(edge))?.index;
    if (typeof index !== "number") continue;
    const edgesAtIndex = restoredByIndex.get(index);
    if (edgesAtIndex) {
      edgesAtIndex.push(edge);
    } else {
      restoredByIndex.set(index, [edge]);
    }
  }

  const mergedEdges: Edge[] = [];
  const placedRestoredEdges = new Set<Edge>();
  let sourceEdgeIndex = 0;
  const targetLength = sanitizedEdges.length + restoredEdges.length;
  for (let index = 0; index < targetLength; index += 1) {
    const recoveredAtIndex = restoredByIndex.get(index);
    if (recoveredAtIndex) {
      mergedEdges.push(...recoveredAtIndex);
      recoveredAtIndex.forEach((edge) => placedRestoredEdges.add(edge));
      continue;
    }
    if (sourceEdgeIndex < sanitizedEdges.length) {
      mergedEdges.push(sanitizedEdges[sourceEdgeIndex]);
      sourceEdgeIndex += 1;
    }
  }
  if (sourceEdgeIndex < sanitizedEdges.length) {
    mergedEdges.push(...sanitizedEdges.slice(sourceEdgeIndex));
  }
  const unplacedRestoredEdges = restoredEdges.filter(
    (edge) => !placedRestoredEdges.has(edge)
  );
  if (unplacedRestoredEdges.length > 0) {
    mergedEdges.push(...unplacedRestoredEdges);
  }

  return mergedEdges;
};

export const sanitizeGroupBundleVisualElementsForState = ({
  nodes,
  edges,
}: {
  nodes: FlowNode[];
  edges: Edge[];
}): GroupBundleCanonicalElements => ({
  nodes: stripGroupBundlePortNodes(nodes),
  edges: sanitizeGroupBundleRenderEdgesForState(edges),
});

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
  nodeId: string,
  handle?: string | null
): string =>
  `${GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX}${side}:${bundleId}:${nodeId}:${
    handle ?? ""
  }`;

const toBundleEdgeRef = (
  edge: Edge,
  edgeId: string,
  index: number
): GroupBundleEdgeRef => ({
  edgeId,
  edge,
  index,
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
  const sourceNodes = stripGroupBundlePortNodes(nodes);
  const sourceEdges = sanitizeGroupBundleRenderEdgesForState(edges);
  const groupRects = new Map<string, GroupRect>();
  const nodeToGroup = new Map<string, string>();

  for (const node of sourceNodes) {
    if (node.type === "shadcnGroup") {
      groupRects.set(node.id, groupRect(node));
      nodeToGroup.set(node.id, node.id);
    }
  }

  for (const node of sourceNodes) {
    if (!node.parentId || !groupRects.has(node.parentId)) continue;
    nodeToGroup.set(node.id, node.parentId);
  }

  if (groupRects.size < 2) return { nodes: sourceNodes, edges: sourceEdges };

  const bundlesByPair = new Map<string, BundleAccumulator>();

  for (const [edgeIndex, edge] of sourceEdges.entries()) {
    const sourceGroupId = nodeToGroup.get(edge.source);
    const targetGroupId = nodeToGroup.get(edge.target);
    if (!sourceGroupId || !targetGroupId) continue;
    if (sourceGroupId === targetGroupId) continue;

    const key = `${sourceGroupId}->${targetGroupId}`;
    const existing = bundlesByPair.get(key);
    const edgeId = edge.id || edgeFallbackId(edge);
    if (existing) {
      existing.edgeIds.push(edgeId);
      existing.edgeRefs.push(toBundleEdgeRef(edge, edgeId, edgeIndex));
      if (edge.selected === true) existing.selectedEdgeIds.add(edgeId);
      existing.selected = existing.selected || edge.selected === true;
      continue;
    }

    bundlesByPair.set(key, {
      sourceGroupId,
      targetGroupId,
      edgeIds: [edgeId],
      edgeRefs: [toBundleEdgeRef(edge, edgeId, edgeIndex)],
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
          compareStrings(a, b)
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

    const sourceSegmentAccumulators = new Map<
      string,
      GroupBundleSegmentAccumulator
    >();
    const targetSegmentAccumulators = new Map<
      string,
      GroupBundleSegmentAccumulator
    >();
    const getSegmentAccumulator = (
      map: Map<string, GroupBundleSegmentAccumulator>,
      nodeId: string,
      handle: string | null | undefined,
      order: number
    ) => {
      const key = `${nodeId}\u0000${handle ?? ""}`;
      const existing = map.get(key);
      if (existing) return existing;
      const next: GroupBundleSegmentAccumulator = {
        nodeId,
        handle,
        edgeIds: [],
        selectedEdgeIds: new Set<string>(),
        order,
      };
      map.set(key, next);
      return next;
    };

    for (const edgeRef of bundle.edgeRefs) {
      const isSelected = bundle.selectedEdgeIds.has(edgeRef.edgeId);
      const sourceSegment = getSegmentAccumulator(
        sourceSegmentAccumulators,
        edgeRef.source,
        edgeRef.sourceHandle,
        edgeIdOrder.get(edgeRef.edgeId) ?? Number.MAX_SAFE_INTEGER
      );
      const targetSegment = getSegmentAccumulator(
        targetSegmentAccumulators,
        edgeRef.target,
        edgeRef.targetHandle,
        edgeIdOrder.get(edgeRef.edgeId) ?? Number.MAX_SAFE_INTEGER
      );
      sourceSegment.edgeIds.push(edgeRef.edgeId);
      targetSegment.edgeIds.push(edgeRef.edgeId);
      if (isSelected) {
        sourceSegment.selectedEdgeIds.add(edgeRef.edgeId);
        targetSegment.selectedEdgeIds.add(edgeRef.edgeId);
      }
    }

    for (const sourceSegment of Array.from(
      sourceSegmentAccumulators.values()
    ).sort((a, b) => a.order - b.order || compareStrings(a.nodeId, b.nodeId))) {
      const sourceSegmentEdgeIds = sortEdgeIds(sourceSegment.edgeIds);
      const sourceSelectedEdgeIds = sortEdgeIds(sourceSegment.selectedEdgeIds);
      segmentEdges.push({
        id: groupBundleSegmentEdgeId(
          "source",
          bundleId,
          sourceSegment.nodeId,
          sourceSegment.handle
        ),
        source: sourceSegment.nodeId,
        sourceHandle: sourceSegment.handle,
        target: sourcePortId,
        targetHandle: GROUP_BUNDLE_PORT_TARGET_HANDLE,
        selectable: false,
        deletable: false,
        reconnectable: false,
        focusable: false,
        selected: sourceSelectedEdgeIds.length > 0,
        data: {
          bundledEdgeIds: sourceSegmentEdgeIds,
          selectedEdgeIds: sourceSelectedEdgeIds,
        },
        className: "group-bundle-segment-edge",
        interactionWidth: 18,
      });
    }

    for (const targetSegment of Array.from(
      targetSegmentAccumulators.values()
    ).sort((a, b) => a.order - b.order || compareStrings(a.nodeId, b.nodeId))) {
      const targetSegmentEdgeIds = sortEdgeIds(targetSegment.edgeIds);
      const targetSelectedEdgeIds = sortEdgeIds(targetSegment.selectedEdgeIds);
      segmentEdges.push({
        id: groupBundleSegmentEdgeId(
          "target",
          bundleId,
          targetSegment.nodeId,
          targetSegment.handle
        ),
        source: targetPortId,
        sourceHandle: GROUP_BUNDLE_PORT_SOURCE_HANDLE,
        target: targetSegment.nodeId,
        targetHandle: targetSegment.handle,
        selectable: false,
        deletable: false,
        reconnectable: false,
        focusable: false,
        selected: targetSelectedEdgeIds.length > 0,
        data: {
          bundledEdgeIds: targetSegmentEdgeIds,
          selectedEdgeIds: targetSelectedEdgeIds,
        },
        className: "group-bundle-segment-edge",
        interactionWidth: 18,
      });
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
        representedEdges: bundle.edgeRefs.map((edgeRef) => ({
          index: edgeRef.index,
          edge: edgeRef.edge,
        })),
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

  if (bundleEdges.length === 0) return { nodes: sourceNodes, edges: sourceEdges };

  const renderedEdges = sourceEdges.filter(
    (edge) => !bundledEdgeIds.has(edge.id || edgeFallbackId(edge))
  );

  const renderedSourcePortGroups = new Set<string>();
  const renderedTargetPortGroups = new Set<string>();
  const sortedBundleEdgeSeeds = bundleEdges.sort((a, b) =>
    compareStrings(a.id, b.id)
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
    nodes: [...sourceNodes, ...portNodes],
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
