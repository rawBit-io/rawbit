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
const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 80;
const MIN_BUNDLE_EDGE_COUNT = 1;
const BUNDLE_PORT_NODE_SIZE = 18;
const BUNDLE_PORT_NODE_MARGIN = BUNDLE_PORT_NODE_SIZE / 2;
const BUNDLE_PORT_DEFAULT_SPACING = 18;

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
  data?: NodeData;
}

type BundleEndpoint =
  | {
      kind: "group";
      groupId: string;
    }
  | {
      kind: "node";
      nodeId: string;
      handle?: string | null;
    };

interface BundleAccumulator {
  sourceEndpoint: BundleEndpoint;
  targetEndpoint: BundleEndpoint;
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
  curveControlPointOffset?: Point | null;
  count: number;
  sourceGroupId?: string;
  targetGroupId?: string;
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
  bundleId: string;
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

const pointFromData = (value: unknown): Point | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<Point>;
  const x = asFiniteNumber(candidate.x);
  const y = asFiniteNumber(candidate.y);
  return x === undefined || y === undefined ? undefined : { x, y };
};

const edgeCurveControlPointOffset = (edge: Edge): Point | undefined =>
  pointFromData(
    (edge.data as { curveControlPointOffset?: unknown } | undefined)
      ?.curveControlPointOffset
  );

const bundleCurveControlPointOffset = (
  edgeRefs: GroupBundleEdgeRef[]
): Point | undefined => {
  for (const edgeRef of edgeRefs) {
    const offset = edgeCurveControlPointOffset(edgeRef.edge);
    if (offset) return offset;
  }
  return undefined;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const groupLabel = (node: FlowNode): string =>
  asString((node.data as NodeData | undefined)?.title) ?? node.id;

const nodeLabel = (node: FlowNode | undefined, fallbackId: string): string =>
  node ? groupLabel(node) : fallbackId;

const groupBundlePortOffset = (
  data: NodeData | undefined,
  role: "source" | "target",
  bundleId: string,
  defaultOffset = 0
): number =>
  asFiniteNumber(
    role === "source"
      ? data?.groupBundlePortOffsets?.sourceByBundle?.[bundleId]
      : data?.groupBundlePortOffsets?.targetByBundle?.[bundleId]
  ) ??
  asFiniteNumber(data?.groupBundlePortOffsets?.[role]) ??
  defaultOffset;

const hasPersistedGroupBundlePortOffset = (
  data: NodeData | undefined,
  role: "source" | "target",
  bundleId: string
): boolean =>
  asFiniteNumber(
    role === "source"
      ? data?.groupBundlePortOffsets?.sourceByBundle?.[bundleId]
      : data?.groupBundlePortOffsets?.targetByBundle?.[bundleId]
  ) !== undefined ||
  asFiniteNumber(data?.groupBundlePortOffsets?.[role]) !== undefined;

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
    data,
  };
};

const centerOf = (rect: GroupRect): Point => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

const centerOfNode = (node: FlowNode | undefined): Point => {
  if (!node) return { x: 0, y: 0 };
  const data = node.data as NodeData | undefined;
  return {
    x:
      (node.positionAbsolute?.x ?? node.position.x) +
      (asFiniteNumber(data?.width) ??
        asFiniteNumber(node.width) ??
        asFiniteNumber(node.measured?.width) ??
        DEFAULT_NODE_WIDTH) /
        2,
    y:
      (node.positionAbsolute?.y ?? node.position.y) +
      (asFiniteNumber(data?.height) ??
        asFiniteNumber(node.height) ??
        asFiniteNumber(node.measured?.height) ??
        DEFAULT_NODE_HEIGHT) /
        2,
  };
};

const boundaryAnchor = (
  rect: GroupRect,
  position: Position,
  yOffset = 0
): {
  boundaryPoint: Point;
  position: Position;
} => {
  const center = centerOf(rect);
  const minY = rect.y + BUNDLE_PORT_NODE_MARGIN;
  const maxY = rect.y + rect.height - BUNDLE_PORT_NODE_MARGIN;
  const sideY =
    minY <= maxY
      ? Math.min(Math.max(center.y + yOffset, minY), maxY)
      : center.y;
  const boundaryPoint = (() => {
    switch (position) {
      case Position.Left:
        return {
          x: rect.x,
          y: sideY,
        };
      case Position.Right:
        return {
          x: rect.x + rect.width,
          y: sideY,
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
  bundleId: string
): string => `${GROUP_BUNDLE_PORT_NODE_ID_PREFIX}${role}:${bundleId}`;

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

const bundleEndpointKey = (endpoint: BundleEndpoint): string =>
  endpoint.kind === "group"
    ? endpoint.groupId
    : `node:${endpoint.nodeId}:${endpoint.handle ?? ""}`;

const bundleIdFromEndpoints = (
  sourceEndpoint: BundleEndpoint,
  targetEndpoint: BundleEndpoint
): string =>
  `${bundleEndpointKey(sourceEndpoint)}->${bundleEndpointKey(targetEndpoint)}`;

const bundleEndpointGroupId = (
  endpoint: BundleEndpoint
): string | undefined =>
  endpoint.kind === "group" ? endpoint.groupId : undefined;

const bundleEndpointLabel = (
  endpoint: BundleEndpoint,
  groupRects: Map<string, GroupRect>,
  nodeById: Map<string, FlowNode>
): string =>
  endpoint.kind === "group"
    ? (groupRects.get(endpoint.groupId)?.label ?? endpoint.groupId)
    : nodeLabel(nodeById.get(endpoint.nodeId), endpoint.nodeId);

const bundleEndpointPoint = (
  endpoint: BundleEndpoint,
  nodeById: Map<string, FlowNode>
): Point =>
  endpoint.kind === "node"
    ? centerOfNode(nodeById.get(endpoint.nodeId))
    : { x: 0, y: 0 };

const bundleEndpointY = (
  endpoint: BundleEndpoint,
  groupRects: Map<string, GroupRect>,
  nodeById: Map<string, FlowNode>
): number => {
  if (endpoint.kind === "node") {
    return centerOfNode(nodeById.get(endpoint.nodeId)).y;
  }
  const rect = groupRects.get(endpoint.groupId);
  return rect ? centerOf(rect).y : 0;
};

const portOffsetKey = (role: "source" | "target", bundleId: string): string =>
  `${role}:${bundleId}`;

const buildDefaultPortOffsets = ({
  bundles,
  groupRects,
  nodeById,
}: {
  bundles: Iterable<BundleAccumulator>;
  groupRects: Map<string, GroupRect>;
  nodeById: Map<string, FlowNode>;
}): Map<string, number> => {
  const portBuckets = new Map<
    string,
    {
      role: "source" | "target";
      groupId: string;
      bundleId: string;
      oppositeY: number;
    }[]
  >();

  const addPort = ({
    role,
    groupId,
    bundleId,
    oppositeY,
  }: {
    role: "source" | "target";
    groupId: string;
    bundleId: string;
    oppositeY: number;
  }) => {
    const key = `${role}:${groupId}`;
    const ports = portBuckets.get(key);
    const port = { role, groupId, bundleId, oppositeY };
    if (ports) {
      ports.push(port);
    } else {
      portBuckets.set(key, [port]);
    }
  };

  for (const bundle of bundles) {
    if (bundle.edgeIds.length < MIN_BUNDLE_EDGE_COUNT) continue;
    const sourceGroupId = bundleEndpointGroupId(bundle.sourceEndpoint);
    const targetGroupId = bundleEndpointGroupId(bundle.targetEndpoint);
    const sourceRect = sourceGroupId ? groupRects.get(sourceGroupId) : undefined;
    const targetRect = targetGroupId ? groupRects.get(targetGroupId) : undefined;
    if ((sourceGroupId && !sourceRect) || (targetGroupId && !targetRect)) {
      continue;
    }

    const bundleId = bundleIdFromEndpoints(
      bundle.sourceEndpoint,
      bundle.targetEndpoint
    );
    if (sourceGroupId && sourceRect) {
      addPort({
        role: "source",
        groupId: sourceGroupId,
        bundleId,
        oppositeY: bundleEndpointY(bundle.targetEndpoint, groupRects, nodeById),
      });
    }
    if (targetGroupId && targetRect) {
      addPort({
        role: "target",
        groupId: targetGroupId,
        bundleId,
        oppositeY: bundleEndpointY(bundle.sourceEndpoint, groupRects, nodeById),
      });
    }
  }

  const defaultOffsets = new Map<string, number>();
  for (const ports of portBuckets.values()) {
    if (ports.length < 2) continue;
    const hasSavedOffset = ports.some((port) =>
      hasPersistedGroupBundlePortOffset(
        groupRects.get(port.groupId)?.data,
        port.role,
        port.bundleId
      )
    );
    if (hasSavedOffset) continue;

    const sortedPorts = ports.sort(
      (a, b) =>
        a.oppositeY - b.oppositeY || compareStrings(a.bundleId, b.bundleId)
    );
    const centerIndex = (sortedPorts.length - 1) / 2;
    sortedPorts.forEach((port, index) => {
      defaultOffsets.set(
        portOffsetKey(port.role, port.bundleId),
        Math.round((index - centerIndex) * BUNDLE_PORT_DEFAULT_SPACING * 100) /
          100
      );
    });
  }

  return defaultOffsets;
};

const buildPortNode = ({
  id,
  point,
  groupId,
  bundleId,
  role,
  bundledEdgeIds,
  selectedEdgeIds,
}: {
  id: string;
  point: Point;
  groupId: string;
  bundleId: string;
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
    bundleId,
    role,
  },
  draggable: true,
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
  const nodeById = new Map(sourceNodes.map((node) => [node.id, node]));
  const validSourceEdges = sourceEdges.filter(
    (edge) => nodeById.has(edge.source) && nodeById.has(edge.target)
  );
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

  if (groupRects.size < 1) return { nodes: sourceNodes, edges: validSourceEdges };

  const bundlesByPair = new Map<string, BundleAccumulator>();

  for (const [edgeIndex, edge] of validSourceEdges.entries()) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const sourceIsGroupNode = groupRects.has(edge.source);
    const targetIsGroupNode = groupRects.has(edge.target);
    const sourceIsGroupedChild = Boolean(
      sourceNode?.parentId && groupRects.has(sourceNode.parentId)
    );
    const targetIsGroupedChild = Boolean(
      targetNode?.parentId && groupRects.has(targetNode.parentId)
    );
    if (
      (sourceIsGroupNode && targetIsGroupedChild) ||
      (targetIsGroupNode && sourceIsGroupedChild)
    ) {
      continue;
    }

    const sourceGroupId = nodeToGroup.get(edge.source);
    const targetGroupId = nodeToGroup.get(edge.target);
    if (!sourceGroupId && !targetGroupId) continue;
    if (Boolean(sourceGroupId) !== Boolean(targetGroupId)) continue;
    if (sourceGroupId && targetGroupId && sourceGroupId === targetGroupId) {
      continue;
    }

    const sourceEndpoint: BundleEndpoint = sourceGroupId
      ? { kind: "group", groupId: sourceGroupId }
      : { kind: "node", nodeId: edge.source, handle: edge.sourceHandle };
    const targetEndpoint: BundleEndpoint = targetGroupId
      ? { kind: "group", groupId: targetGroupId }
      : { kind: "node", nodeId: edge.target, handle: edge.targetHandle };

    const key = `${bundleEndpointKey(sourceEndpoint)}->${bundleEndpointKey(
      targetEndpoint
    )}`;
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
      sourceEndpoint,
      targetEndpoint,
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
  const defaultPortOffsets = buildDefaultPortOffsets({
    bundles: bundlesByPair.values(),
    groupRects,
    nodeById,
  });

  for (const bundle of bundlesByPair.values()) {
    if (bundle.edgeIds.length < MIN_BUNDLE_EDGE_COUNT) continue;

    const sourceGroupId = bundleEndpointGroupId(bundle.sourceEndpoint);
    const targetGroupId = bundleEndpointGroupId(bundle.targetEndpoint);
    const sourceRect = sourceGroupId ? groupRects.get(sourceGroupId) : undefined;
    const targetRect = targetGroupId ? groupRects.get(targetGroupId) : undefined;
    if ((sourceGroupId && !sourceRect) || (targetGroupId && !targetRect)) {
      continue;
    }

    bundle.edgeIds.forEach((edgeId) => bundledEdgeIds.add(edgeId));
    const bundleId = bundleIdFromEndpoints(
      bundle.sourceEndpoint,
      bundle.targetEndpoint
    );
    const sourcePortId = sourceGroupId
      ? groupBundlePortNodeId("source", bundleId)
      : undefined;
    const targetPortId = targetGroupId
      ? groupBundlePortNodeId("target", bundleId)
      : undefined;
    const sourceAnchor = sourceRect
      ? boundaryAnchor(
          sourceRect,
          Position.Right,
          groupBundlePortOffset(
            sourceRect.data,
            "source",
            bundleId,
            defaultPortOffsets.get(portOffsetKey("source", bundleId)) ?? 0
          )
        )
      : undefined;
    const targetAnchor = targetRect
      ? boundaryAnchor(
          targetRect,
          Position.Left,
          groupBundlePortOffset(
            targetRect.data,
            "target",
            bundleId,
            defaultPortOffsets.get(portOffsetKey("target", bundleId)) ?? 0
          )
        )
      : undefined;
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
    if (sourceGroupId && sourceAnchor && sourcePortId) {
      portNodes.push(buildPortNode({
        id: sourcePortId,
        point: sourceAnchor.boundaryPoint,
        groupId: sourceGroupId,
        bundleId,
        role: "source",
        bundledEdgeIds: bundle.edgeIds,
        selectedEdgeIds,
      }));
    }
    if (targetGroupId && targetAnchor && targetPortId) {
      portNodes.push(buildPortNode({
        id: targetPortId,
        point: targetAnchor.boundaryPoint,
        groupId: targetGroupId,
        bundleId,
        role: "target",
        bundledEdgeIds: bundle.edgeIds,
        selectedEdgeIds,
      }));
    }

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
      const order = edgeIdOrder.get(edgeRef.edgeId) ?? Number.MAX_SAFE_INTEGER;
      if (sourcePortId) {
        const sourceSegment = getSegmentAccumulator(
          sourceSegmentAccumulators,
          edgeRef.source,
          edgeRef.sourceHandle,
          order
        );
        sourceSegment.edgeIds.push(edgeRef.edgeId);
        if (isSelected) sourceSegment.selectedEdgeIds.add(edgeRef.edgeId);
      }
      if (targetPortId) {
        const targetSegment = getSegmentAccumulator(
          targetSegmentAccumulators,
          edgeRef.target,
          edgeRef.targetHandle,
          order
        );
        targetSegment.edgeIds.push(edgeRef.edgeId);
        if (isSelected) targetSegment.selectedEdgeIds.add(edgeRef.edgeId);
      }
    }

    if (sourcePortId) {
      for (const sourceSegment of Array.from(
        sourceSegmentAccumulators.values()
      ).sort(
        (a, b) => a.order - b.order || compareStrings(a.nodeId, b.nodeId)
      )) {
        const sourceSegmentEdgeIds = sortEdgeIds(sourceSegment.edgeIds);
        const sourceSelectedEdgeIds = sortEdgeIds(
          sourceSegment.selectedEdgeIds
        );
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
    }

    if (targetPortId) {
      for (const targetSegment of Array.from(
        targetSegmentAccumulators.values()
      ).sort(
        (a, b) => a.order - b.order || compareStrings(a.nodeId, b.nodeId)
      )) {
        const targetSegmentEdgeIds = sortEdgeIds(targetSegment.edgeIds);
        const targetSelectedEdgeIds = sortEdgeIds(
          targetSegment.selectedEdgeIds
        );
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
    }

    const outsideSource =
      sourcePortId ??
      (bundle.sourceEndpoint.kind === "node"
        ? bundle.sourceEndpoint.nodeId
        : undefined);
    const outsideTarget =
      targetPortId ??
      (bundle.targetEndpoint.kind === "node"
        ? bundle.targetEndpoint.nodeId
        : undefined);
    if (!outsideSource || !outsideTarget) continue;

    bundleEdges.push({
      id: `${GROUP_BUNDLE_EDGE_ID_PREFIX}${bundleId}`,
      type: GROUP_BUNDLE_EDGE_TYPE,
      source: outsideSource,
      target: outsideTarget,
      sourceHandle: sourcePortId
        ? GROUP_BUNDLE_PORT_SOURCE_HANDLE
        : bundle.sourceEndpoint.kind === "node"
          ? bundle.sourceEndpoint.handle
          : undefined,
      targetHandle: targetPortId
        ? GROUP_BUNDLE_PORT_TARGET_HANDLE
        : bundle.targetEndpoint.kind === "node"
          ? bundle.targetEndpoint.handle
          : undefined,
      selectable: false,
      deletable: false,
      reconnectable: false,
      focusable: false,
      selected: bundle.selected,
      data: {
        bundledEdgeIds: bundle.edgeIds,
        selectedEdgeIds,
        curveControlPointOffset: bundleCurveControlPointOffset(
          bundle.edgeRefs
        ),
        representedEdges: bundle.edgeRefs.map((edgeRef) => ({
          index: edgeRef.index,
          edge: edgeRef.edge,
        })),
        count: bundle.edgeIds.length,
        sourceGroupId,
        targetGroupId,
        sourceLabel: bundleEndpointLabel(
          bundle.sourceEndpoint,
          groupRects,
          nodeById
        ),
        targetLabel: bundleEndpointLabel(
          bundle.targetEndpoint,
          groupRects,
          nodeById
        ),
        sourceBoundaryPoint:
          sourceAnchor?.boundaryPoint ??
          bundleEndpointPoint(bundle.sourceEndpoint, nodeById),
        targetBoundaryPoint:
          targetAnchor?.boundaryPoint ??
          bundleEndpointPoint(bundle.targetEndpoint, nodeById),
        renderSourcePort: Boolean(sourceGroupId),
        renderTargetPort: Boolean(targetGroupId),
        sourcePosition: sourceAnchor?.position ?? Position.Right,
        targetPosition: targetAnchor?.position ?? Position.Left,
      },
    });
  }

  if (bundleEdges.length === 0) {
    return { nodes: sourceNodes, edges: validSourceEdges };
  }

  const renderedEdges = validSourceEdges.filter(
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
    const sourceGroupId = data.sourceGroupId;
    const targetGroupId = data.targetGroupId;
    const renderSourcePort = sourceGroupId
      ? edge.selected === true || !renderedSourcePortGroups.has(sourceGroupId)
      : false;
    const renderTargetPort = targetGroupId
      ? edge.selected === true || !renderedTargetPortGroups.has(targetGroupId)
      : false;
    if (sourceGroupId) renderedSourcePortGroups.add(sourceGroupId);
    if (targetGroupId) renderedTargetPortGroups.add(targetGroupId);
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
