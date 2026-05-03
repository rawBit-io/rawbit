import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DiagramInnerNode, ProtocolDiagramModel } from "@/lib/protocolDiagram/types";
import {
  getDefaultProtocolPanelWidth,
  MAX_PROTOCOL_PANEL_WIDTH,
  MIN_PROTOCOL_PANEL_WIDTH,
} from "@/lib/protocolDiagram/panelSizing";
import type { ProtocolDiagramGroupOffsets } from "@/types";

export interface ProtocolDiagramPanelProps {
  isOpen: boolean;
  model: ProtocolDiagramModel;
  hasVisibleTabs?: boolean;
  onClose?: () => void;
  onSelectNode?: (nodeId: string) => void;
  onSelectGroup?: (groupId: string) => void;
  onSelectConnection?: (edgeIds: string[], nodeIds: string[]) => void;
  canvasSelectedEdgeIds?: string[];
  committedOffsets?: ProtocolDiagramGroupOffsets;
  onCommittedOffsetsChange?: (offsets: ProtocolDiagramGroupOffsets) => void;
  onPanelWidthChange?: (width: number) => void;
  onUpdateGroupComment?: (groupId: string, comment: string) => void;
  style?: CSSProperties;
}

type Side = "left" | "right";
type BoundaryNodeRole =
  | "root-left"
  | "entry-left"
  | "dual-left"
  | "output-right"
  | "sink-right"
  | "hidden";

interface BoundaryChip {
  id: string;
  label: string;
  title: string;
  nodeIds: string[];
  sortX: number;
  sortY: number;
  isVirtual: boolean;
  interactive: boolean;
  isMainOutput: boolean;
  side: Side;
}

interface BoundaryLink {
  sourceChipId: string;
  targetChipId: string;
  count: number;
}

interface BoundaryGroupView {
  id: string;
  title: string;
  comment?: string;
  color?: string;
  nodeCount: number;
  headerHeight: number;
  commentBodyHeight: number;
  commentSectionHeight: number;
  leftChips: BoundaryChip[];
  rightChips: BoundaryChip[];
  rowCount: number;
  rowHeights: number[];
  rowOffsets: number[];
  left: number;
  top: number;
  width: number;
  height: number;
  rowsTop: number;
  rowAreaHeight: number;
  internalLinks: BoundaryLink[];
}

interface BoundaryGroupContext {
  view: BoundaryGroupView;
  leftNodeToChipId: Map<string, string>;
  rightNodeToChipId: Map<string, string>;
  leftChipIndex: Map<string, number>;
  rightChipIndex: Map<string, number>;
  outboundNodeToAnchor: Map<string, string>;
  inboundNodeToAnchor: Map<string, string>;
}

interface BoundaryConnectionView {
  id: string;
  sourceGroupId: string;
  targetGroupId: string;
  sourceChipId: string;
  targetChipId: string;
  path: string;
  sourcePortX: number;
  sourcePortY: number;
  targetPortX: number;
  targetPortY: number;
  edgeIds: string[];
  endpointNodeIds: string[];
}

interface BoundaryLayout {
  groups: BoundaryGroupView[];
  connections: BoundaryConnectionView[];
  width: number;
  height: number;
}

const MIN_SCALE = 0.2; // Allow more zoom out to fit all content
const MAX_SCALE = 2.4;
const ZOOM_STEP = 1.04; // Toolbar button zoom step
const WHEEL_ZOOM_SENSITIVITY = 0.0014;
const WHEEL_SUPPRESS_MS_AFTER_DRAG = 120;

const GROUP_WIDTH = 290;
const HEADER_HEIGHT = 40;
const CONTENT_TOP_PADDING = 4;
const CONTENT_INNER_PAD = 5;          // content div py-1 (4px) + border (1px)
const IO_HEAD_HEIGHT = 18;
const ROW_HEIGHT = 26;
const GROUP_TITLE_FONT_SIZE = 16;
const GROUP_TITLE_LINE_HEIGHT = 20;
const COMMENT_SECTION_EXPANDED_GAP = 6;
const COMMENT_MIN_HEIGHT = 28;
const COMMENT_LINE_HEIGHT = 16;
const COMMENT_CHARS_PER_LINE = 42;
const GROUP_FOOTER_PADDING = 8;
const GROUP_OUTER_PAD = 2;           // group div border-2 (2px), no inner padding
const GROUP_GAP_Y = 22;
const COLUMN_GAP_X = 110;
const CANVAS_MARGIN = 12;
const MAX_INTERNAL_LINKS = 24;
const MAX_LEFT_BOUNDARY_NODES = 16;
const MAX_RIGHT_BOUNDARY_NODES = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const toRgba = (hex: string, alpha: number): string | undefined => {
  const normalized = hex.replace("#", "").trim();
  const asSix =
    normalized.length === 3
      ? normalized.split("").map((c) => `${c}${c}`).join("")
      : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(asSix)) return undefined;
  const r = parseInt(asSix.slice(0, 2), 16);
  const g = parseInt(asSix.slice(2, 4), 16);
  const b = parseInt(asSix.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const normalizeNodeLabel = (node: DiagramInnerNode | undefined, fallbackId: string): string => {
  const source = (node?.title ?? fallbackId).replace(/\s+/g, " ").trim();
  return source || fallbackId;
};

const sortByCanvasPosition = (
  a: { id: string; position: { x: number; y: number } },
  b: { id: string; position: { x: number; y: number } }
): number => {
  if (a.position.x !== b.position.x) return a.position.x - b.position.x;
  if (a.position.y !== b.position.y) return a.position.y - b.position.y;
  return a.id.localeCompare(b.id);
};

const sortChips = (a: BoundaryChip, b: BoundaryChip): number => {
  if (a.sortY !== b.sortY) return a.sortY - b.sortY;
  if (a.sortX !== b.sortX) return a.sortX - b.sortX;
  return a.id.localeCompare(b.id);
};

const sortRightChips = (a: BoundaryChip, b: BoundaryChip): number => {
  if (a.isMainOutput !== b.isMainOutput) {
    return a.isMainOutput ? -1 : 1;
  }
  return sortChips(a, b);
};

const addDirectedEdge = (map: Map<string, string[]>, from: string, to: string) => {
  const list = map.get(from) ?? [];
  list.push(to);
  map.set(from, list);
};

const dedupeAndSortAdjacency = (map: Map<string, string[]>) => {
  for (const [key, list] of map.entries()) {
    const uniq = Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
    map.set(key, uniq);
  }
};

const bfsNearestCandidate = (
  startNodeId: string,
  candidateIds: Set<string>,
  adjacency: Map<string, string[]>
): string | undefined => {
  if (candidateIds.has(startNodeId)) return startNodeId;

  const queue: string[] = [startNodeId];
  const visited = new Set<string>([startNodeId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const nextIds = adjacency.get(current) ?? [];
    for (const next of nextIds) {
      if (visited.has(next)) continue;
      if (candidateIds.has(next)) return next;
      visited.add(next);
      queue.push(next);
    }
  }

  return undefined;
};

const collectReachable = (
  startNodeId: string,
  adjacency: Map<string, string[]>
): Set<string> => {
  const visited = new Set<string>([startNodeId]);
  const queue: string[] = [startNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const nextIds = adjacency.get(current) ?? [];
    for (const next of nextIds) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  return visited;
};

const computeLevels = (model: ProtocolDiagramModel): Map<string, number> => {
  const groupsSorted = [...model.groups].sort(sortByCanvasPosition);
  const groupIdSet = new Set(groupsSorted.map((group) => group.id));

  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  for (const group of groupsSorted) {
    outgoing.set(group.id, new Set());
    incoming.set(group.id, new Set());
    indegree.set(group.id, 0);
  }

  for (const bundle of model.bundles) {
    if (!groupIdSet.has(bundle.sourceGroupId) || !groupIdSet.has(bundle.targetGroupId)) continue;
    if (bundle.sourceGroupId === bundle.targetGroupId) continue;

    const out = outgoing.get(bundle.sourceGroupId);
    const ins = incoming.get(bundle.targetGroupId);
    if (!out || !ins || out.has(bundle.targetGroupId)) continue;

    out.add(bundle.targetGroupId);
    ins.add(bundle.sourceGroupId);
    indegree.set(bundle.targetGroupId, (indegree.get(bundle.targetGroupId) ?? 0) + 1);
  }

  const orderKey = new Map(groupsSorted.map((group, index) => [group.id, index] as const));
  const sortIds = (ids: string[]) =>
    ids.sort((a, b) => (orderKey.get(a) ?? 0) - (orderKey.get(b) ?? 0));

  const queue = sortIds(
    groupsSorted
      .map((group) => group.id)
      .filter((groupId) => (indegree.get(groupId) ?? 0) === 0)
  );

  const levels = new Map<string, number>();
  for (const group of groupsSorted) {
    levels.set(group.id, 0);
  }

  const processed = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || processed.has(current)) continue;

    processed.add(current);
    const currentLevel = levels.get(current) ?? 0;
    for (const next of Array.from(outgoing.get(current) ?? [])) {
      levels.set(next, Math.max(levels.get(next) ?? 0, currentLevel + 1));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) queue.push(next);
    }
    sortIds(queue);
  }

  const unresolvedGroups = groupsSorted.filter((group) => !processed.has(group.id));
  if (unresolvedGroups.length > 0) {
    const maxResolved = Math.max(0, ...Array.from(levels.values()));
    const minX = Math.min(...unresolvedGroups.map((group) => group.position.x));
    const maxX = Math.max(...unresolvedGroups.map((group) => group.position.x));
    const rangeX = Math.max(1, maxX - minX);

    for (const group of unresolvedGroups) {
      const xRatio = (group.position.x - minX) / rangeX;
      const xLevel = Math.round(xRatio * Math.max(1, maxResolved + 1));
      const deps = Array.from(incoming.get(group.id) ?? []).map(
        (sourceId) => (levels.get(sourceId) ?? 0) + 1
      );
      const depLevel = deps.length > 0 ? Math.max(...deps) : 0;
      levels.set(group.id, Math.max(xLevel, depLevel));
    }
  }

  return levels;
};

const buildGroupContext = (
  group: ProtocolDiagramModel["groups"][number],
  inboundCrossNodeIds: Set<string>,
  outboundCrossNodeIds: Set<string>,
  outboundCrossEdgeCountsByNode: Map<string, number>,
  commentOverride?: string
): BoundaryGroupContext => {
  const nodeById = new Map(group.nodes.map((node) => [node.id, node] as const));

  const inInternal = new Map<string, number>();
  const outInternal = new Map<string, number>();
  const forwardAdj = new Map<string, string[]>();
  const reverseAdj = new Map<string, string[]>();
  const undirectedAdj = new Map<string, string[]>();

  for (const node of group.nodes) {
    inInternal.set(node.id, 0);
    outInternal.set(node.id, 0);
    forwardAdj.set(node.id, []);
    reverseAdj.set(node.id, []);
    undirectedAdj.set(node.id, []);
  }

  for (const edge of group.edges) {
    if (!nodeById.has(edge.sourceNodeId) || !nodeById.has(edge.targetNodeId)) continue;
    outInternal.set(edge.sourceNodeId, (outInternal.get(edge.sourceNodeId) ?? 0) + 1);
    inInternal.set(edge.targetNodeId, (inInternal.get(edge.targetNodeId) ?? 0) + 1);

    addDirectedEdge(forwardAdj, edge.sourceNodeId, edge.targetNodeId);
    addDirectedEdge(reverseAdj, edge.targetNodeId, edge.sourceNodeId);
    addDirectedEdge(undirectedAdj, edge.sourceNodeId, edge.targetNodeId);
    addDirectedEdge(undirectedAdj, edge.targetNodeId, edge.sourceNodeId);
  }

  dedupeAndSortAdjacency(forwardAdj);
  dedupeAndSortAdjacency(reverseAdj);
  dedupeAndSortAdjacency(undirectedAdj);

  const leftBoundaryCandidates: DiagramInnerNode[] = [];
  const rightBoundaryCandidates: DiagramInnerNode[] = [];

  const sortedNodes = [...group.nodes].sort((a, b) => {
    if (a.localPosition.y !== b.localPosition.y) {
      return a.localPosition.y - b.localPosition.y;
    }
    if (a.localPosition.x !== b.localPosition.x) {
      return a.localPosition.x - b.localPosition.x;
    }
    return a.id.localeCompare(b.id);
  });

  const roleByNodeId = new Map<string, BoundaryNodeRole>();

  for (const node of sortedNodes) {
    const inInt = inInternal.get(node.id) ?? 0;
    const outInt = outInternal.get(node.id) ?? 0;
    const inCross = inboundCrossNodeIds.has(node.id);
    const outCross = outboundCrossNodeIds.has(node.id);

    // Rule 1: ROOT -> LEFT
    if (inInt === 0 && !inCross) {
      roleByNodeId.set(node.id, "root-left");
      continue;
    }

    // Rule 2: SINK -> RIGHT
    if (outInt === 0 && !outCross) {
      roleByNodeId.set(node.id, "sink-right");
      continue;
    }

    // Rule 3: OUTPUT -> RIGHT
    if (outCross && !inCross) {
      roleByNodeId.set(node.id, "output-right");
      continue;
    }

    // Rule 4: ENTRY -> LEFT
    if (inCross && !outCross) {
      roleByNodeId.set(node.id, "entry-left");
      continue;
    }

    // Rule 5: DUAL -> LEFT
    if (inCross && outCross) {
      roleByNodeId.set(node.id, "dual-left");
      continue;
    }

    // Rule 6: HIDDEN
    roleByNodeId.set(node.id, "hidden");
  }

  for (const node of sortedNodes) {
    const role = roleByNodeId.get(node.id) ?? "hidden";
    if (role === "root-left" || role === "entry-left" || role === "dual-left") {
      leftBoundaryCandidates.push(node);
      continue;
    }
    if (role === "output-right" || role === "sink-right") {
      rightBoundaryCandidates.push(node);
      continue;
    }
  }

  // Empty-right recovery: if a group has no right nodes, promote the strongest
  // dual node (highest cross-group out-degree) from left to right.
  if (rightBoundaryCandidates.length === 0) {
    const promotableDuals = sortedNodes.filter(
      (node) => roleByNodeId.get(node.id) === "dual-left"
    );
    if (promotableDuals.length > 0) {
      const promoted = [...promotableDuals].sort((a, b) => {
        const degreeA = outboundCrossEdgeCountsByNode.get(a.id) ?? 0;
        const degreeB = outboundCrossEdgeCountsByNode.get(b.id) ?? 0;
        if (degreeA !== degreeB) return degreeB - degreeA;
        if (a.localPosition.y !== b.localPosition.y) {
          return a.localPosition.y - b.localPosition.y;
        }
        if (a.localPosition.x !== b.localPosition.x) {
          return a.localPosition.x - b.localPosition.x;
        }
        return a.id.localeCompare(b.id);
      })[0];

      if (promoted) {
        roleByNodeId.set(promoted.id, "output-right");
        const leftIndex = leftBoundaryCandidates.findIndex(
          (node) => node.id === promoted.id
        );
        if (leftIndex >= 0) {
          leftBoundaryCandidates.splice(leftIndex, 1);
        }
        rightBoundaryCandidates.push(promoted);
      }
    }
  }

  const sortBoundaryNodes = (a: DiagramInnerNode, b: DiagramInnerNode): number => {
    if (a.localPosition.y !== b.localPosition.y) {
      return a.localPosition.y - b.localPosition.y;
    }
    if (a.localPosition.x !== b.localPosition.x) {
      return a.localPosition.x - b.localPosition.x;
    }
    return a.id.localeCompare(b.id);
  };

  const sortedLeftCandidates = [...leftBoundaryCandidates].sort(sortBoundaryNodes);
  const sortedRightCandidates = [...rightBoundaryCandidates].sort(sortBoundaryNodes);

  const leftVisibleNodes = sortedLeftCandidates.slice(0, MAX_LEFT_BOUNDARY_NODES);
  const rightVisibleNodes = sortedRightCandidates.slice(0, MAX_RIGHT_BOUNDARY_NODES);
  const leftVisibleIds = new Set(leftVisibleNodes.map((node) => node.id));
  const rightVisibleIds = new Set(rightVisibleNodes.map((node) => node.id));

  const outboundNodeToAnchor = new Map<string, string>();
  const inboundNodeToAnchor = new Map<string, string>();
  const mapToOutboundAnchor = (nodeId: string): string | undefined => {
    if (rightVisibleIds.has(nodeId)) return nodeId;
    const directed = bfsNearestCandidate(nodeId, rightVisibleIds, forwardAdj);
    if (directed) return directed;
    const undirected = bfsNearestCandidate(nodeId, rightVisibleIds, undirectedAdj);
    if (undirected) return undirected;
    return undefined;
  };

  const mapToInboundAnchor = (nodeId: string): string | undefined => {
    if (leftVisibleIds.has(nodeId)) return nodeId;
    const directed = bfsNearestCandidate(nodeId, leftVisibleIds, reverseAdj);
    if (directed) return directed;
    const undirected = bfsNearestCandidate(nodeId, leftVisibleIds, undirectedAdj);
    if (undirected) return undirected;
    return undefined;
  };

  for (const nodeId of outboundCrossNodeIds) {
    if (!nodeById.has(nodeId)) continue;
    const anchor = mapToOutboundAnchor(nodeId);
    if (anchor) {
      outboundNodeToAnchor.set(nodeId, anchor);
    }
  }

  for (const nodeId of inboundCrossNodeIds) {
    if (!nodeById.has(nodeId)) continue;
    const anchor = mapToInboundAnchor(nodeId);
    if (anchor) {
      inboundNodeToAnchor.set(nodeId, anchor);
    }
  }

  let leftChips: BoundaryChip[] = leftVisibleNodes.map((node) => ({
    id: node.id,
    label: normalizeNodeLabel(node, node.id),
    title: node.title,
    nodeIds: [node.id],
    sortX: node.localPosition.x,
    sortY: node.localPosition.y,
    isVirtual: false,
    interactive: true,
    isMainOutput: false,
    side: "left",
  }));

  const mainOutputNodeId = [...rightVisibleNodes]
    .sort((a, b) => {
      if (a.localPosition.x !== b.localPosition.x) {
        return b.localPosition.x - a.localPosition.x;
      }
      if (a.localPosition.y !== b.localPosition.y) {
        return a.localPosition.y - b.localPosition.y;
      }
      return a.id.localeCompare(b.id);
    })
    .at(0)?.id;

  let rightChips: BoundaryChip[] = rightVisibleNodes.map((node) => ({
    id: node.id,
    label: normalizeNodeLabel(node, node.id),
    title: node.title,
    nodeIds: [node.id],
    sortX: node.localPosition.x,
    sortY: node.localPosition.y,
    isVirtual: false,
    interactive: true,
    isMainOutput: node.id === mainOutputNodeId,
    side: "right",
  }));

  const leftOverflow = sortedLeftCandidates.length - leftVisibleNodes.length;
  if (leftOverflow > 0) {
    leftChips.push({
      id: `${group.id}::left-overflow`,
      label: `+ ${leftOverflow} more`,
      title: `${leftOverflow} additional inputs hidden`,
      nodeIds: [],
      sortX: Number.POSITIVE_INFINITY,
      sortY: Number.POSITIVE_INFINITY,
      isVirtual: true,
      interactive: false,
      isMainOutput: false,
      side: "left",
    });
  }

  const rightOverflow = sortedRightCandidates.length - rightVisibleNodes.length;
  if (rightOverflow > 0) {
    rightChips.push({
      id: `${group.id}::right-overflow`,
      label: `+ ${rightOverflow} more`,
      title: `${rightOverflow} additional outputs hidden`,
      nodeIds: [],
      sortX: Number.POSITIVE_INFINITY,
      sortY: Number.POSITIVE_INFINITY,
      isVirtual: true,
      interactive: false,
      isMainOutput: false,
      side: "right",
    });
  }

  leftChips = leftChips.sort(sortChips);
  rightChips = rightChips.sort(sortRightChips);

  const leftNodeToChipId = new Map<string, string>();
  for (const chip of leftChips) {
    for (const nodeId of chip.nodeIds) {
      if (!leftNodeToChipId.has(nodeId)) {
        leftNodeToChipId.set(nodeId, chip.id);
      }
    }
  }

  const rightNodeToChipId = new Map<string, string>();
  for (const chip of rightChips) {
    for (const nodeId of chip.nodeIds) {
      if (!rightNodeToChipId.has(nodeId)) {
        rightNodeToChipId.set(nodeId, chip.id);
      }
    }
  }

  const linkCounts = new Map<string, number>();
  for (const leftNode of leftVisibleNodes) {
    const reachable = collectReachable(leftNode.id, forwardAdj);
    for (const rightNode of rightVisibleNodes) {
      if (leftNode.id === rightNode.id) continue;
      if (!reachable.has(rightNode.id)) continue;

      const sourceChipId = leftNodeToChipId.get(leftNode.id);
      const targetChipId = rightNodeToChipId.get(rightNode.id);
      if (!sourceChipId || !targetChipId) continue;

      const key = `${sourceChipId}->${targetChipId}`;
      linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
    }
  }

  const internalLinks = Array.from(linkCounts.entries())
    .map(([key, count]) => {
      const [sourceChipId, targetChipId] = key.split("->");
      if (!sourceChipId || !targetChipId) return null;
      return { sourceChipId, targetChipId, count } satisfies BoundaryLink;
    })
    .filter((link): link is BoundaryLink => Boolean(link))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      if (a.sourceChipId !== b.sourceChipId) {
        return a.sourceChipId.localeCompare(b.sourceChipId);
      }
      return a.targetChipId.localeCompare(b.targetChipId);
    })
    .slice(0, MAX_INTERNAL_LINKS);

  const estimateRowLines = (chip?: BoundaryChip) => {
    if (!chip) return 1;
    const approxCharsPerLine = 16;
    return Math.max(1, Math.ceil(chip.label.length / approxCharsPerLine));
  };

  const hasOverride = commentOverride !== undefined;
  const commentValue = hasOverride ? commentOverride : group.comment ?? "";
  const comment = commentValue.trim();
  const headerHeight = HEADER_HEIGHT;
  const hasCommentSection = true;
  const commentLineCount =
    hasCommentSection
      ? comment.split(/\r?\n/).reduce((total, line) => {
          const len = line.length;
          return total + Math.max(1, Math.ceil(len / COMMENT_CHARS_PER_LINE));
        }, 0)
      : 0;
  const commentBodyHeight =
    hasCommentSection
      ? Math.max(
          COMMENT_MIN_HEIGHT,
          10 + (Math.max(1, commentLineCount) + 1) * COMMENT_LINE_HEIGHT
        )
      : 0;
  const commentSectionHeight =
    hasCommentSection
      ? COMMENT_SECTION_EXPANDED_GAP + commentBodyHeight
      : 0;
  const rowCount = Math.max(leftChips.length, rightChips.length, 1);
  const rowHeights: number[] = Array.from({ length: rowCount }).map((_, index) => {
    const leftLines = estimateRowLines(leftChips[index]);
    const rightLines = estimateRowLines(rightChips[index]);
    const lines = Math.max(leftLines, rightLines);
    return Math.max(ROW_HEIGHT, 14 + lines * 12);
  });
  const rowOffsets: number[] = [];
  let rowAreaHeight = 0;
  for (const height of rowHeights) {
    rowOffsets.push(rowAreaHeight);
    rowAreaHeight += height;
  }
  const rowsTop = headerHeight + CONTENT_TOP_PADDING + IO_HEAD_HEIGHT;
  const height =
    GROUP_OUTER_PAD * 2 +
    rowsTop +
    rowAreaHeight +
    commentSectionHeight +
    GROUP_FOOTER_PADDING;

  const leftChipIndex = new Map(leftChips.map((chip, index) => [chip.id, index] as const));
  const rightChipIndex = new Map(rightChips.map((chip, index) => [chip.id, index] as const));

  return {
    view: {
      id: group.id,
      title: group.title,
      comment,
      color: group.color,
      nodeCount: group.nodeCount,
      headerHeight,
      commentBodyHeight,
      commentSectionHeight,
      leftChips,
      rightChips,
      rowCount,
      rowHeights,
      rowOffsets,
      left: 0,
      top: 0,
      width: GROUP_WIDTH,
      height,
      rowsTop,
      rowAreaHeight,
      internalLinks,
    },
    leftNodeToChipId,
    rightNodeToChipId,
    leftChipIndex,
    rightChipIndex,
    outboundNodeToAnchor,
    inboundNodeToAnchor,
  };
};

const computeBoundaryLayout = (
  model: ProtocolDiagramModel,
  committedOffsets?: Record<string, { dx: number; dy: number }>,
  commentOverrides?: Record<string, string>,
): BoundaryLayout | null => {
  if (!model.hasGroups || model.groups.length === 0) return null;

  const groupById = new Map(model.groups.map((group) => [group.id, group] as const));

  const inboundCrossByGroup = new Map<string, Set<string>>();
  const outboundCrossByGroup = new Map<string, Set<string>>();
  const outboundCrossDegreeByGroup = new Map<string, Map<string, number>>();
  for (const group of model.groups) {
    inboundCrossByGroup.set(group.id, new Set());
    outboundCrossByGroup.set(group.id, new Set());
    outboundCrossDegreeByGroup.set(group.id, new Map<string, number>());
  }

  for (const bundle of model.bundles) {
    const outbound = outboundCrossByGroup.get(bundle.sourceGroupId);
    const inbound = inboundCrossByGroup.get(bundle.targetGroupId);
    const outboundDegree = outboundCrossDegreeByGroup.get(bundle.sourceGroupId);
    if (outbound) {
      for (const nodeId of bundle.sourceNodeIds) {
        outbound.add(nodeId);
      }
    }
    if (inbound) {
      for (const nodeId of bundle.targetNodeIds) {
        inbound.add(nodeId);
      }
    }
    if (outboundDegree) {
      for (const pair of bundle.pairs) {
        outboundDegree.set(
          pair.sourceNodeId,
          (outboundDegree.get(pair.sourceNodeId) ?? 0) + 1
        );
      }
    }
  }

  const levels = computeLevels(model);
  const groupsByLevel = new Map<number, string[]>();
  for (const group of model.groups) {
    const level = levels.get(group.id) ?? 0;
    const list = groupsByLevel.get(level) ?? [];
    list.push(group.id);
    groupsByLevel.set(level, list);
  }

  for (const [level, ids] of groupsByLevel.entries()) {
    ids.sort((a, b) => {
      const ga = groupById.get(a);
      const gb = groupById.get(b);
      if (!ga || !gb) return a.localeCompare(b);
      if (ga.position.y !== gb.position.y) return ga.position.y - gb.position.y;
      if (ga.position.x !== gb.position.x) return ga.position.x - gb.position.x;
      return ga.id.localeCompare(gb.id);
    });
    groupsByLevel.set(level, ids);
  }

  const sortedLevels = Array.from(groupsByLevel.keys()).sort((a, b) => a - b);
  const contextsByGroup = new Map<string, BoundaryGroupContext>();
  let maxColumnHeight = 0;

  for (const [columnIndex, level] of sortedLevels.entries()) {
    const groupIds = groupsByLevel.get(level) ?? [];
    let cursorY = CANVAS_MARGIN;

    for (const groupId of groupIds) {
      const group = groupById.get(groupId);
      if (!group) continue;

      const context = buildGroupContext(
        group,
        inboundCrossByGroup.get(groupId) ?? new Set<string>(),
        outboundCrossByGroup.get(groupId) ?? new Set<string>(),
        outboundCrossDegreeByGroup.get(groupId) ?? new Map<string, number>(),
        Object.prototype.hasOwnProperty.call(commentOverrides ?? {}, groupId)
          ? commentOverrides?.[groupId]
          : undefined
      );

      context.view.left = CANVAS_MARGIN + columnIndex * (GROUP_WIDTH + COLUMN_GAP_X);
      context.view.top = cursorY;

      // Apply drag offsets
      const off = committedOffsets?.[groupId];
      if (off) {
        context.view.left += off.dx;
        context.view.top += off.dy;
      }

      contextsByGroup.set(groupId, context);
      cursorY += context.view.height + GROUP_GAP_Y;
    }

    maxColumnHeight = Math.max(maxColumnHeight, cursorY);
  }

  // Compute canvas bounds from actual group positions (including drag offsets)
  let canvasRight = CANVAS_MARGIN * 2 +
    sortedLevels.length * GROUP_WIDTH +
    Math.max(0, sortedLevels.length - 1) * COLUMN_GAP_X;
  let canvasBottom = maxColumnHeight + CANVAS_MARGIN;
  for (const ctx of contextsByGroup.values()) {
    canvasRight = Math.max(canvasRight, ctx.view.left + ctx.view.width + CANVAS_MARGIN);
    canvasBottom = Math.max(canvasBottom, ctx.view.top + ctx.view.height + CANVAS_MARGIN);
  }
  const width = Math.max(480, canvasRight);
  const height = Math.max(320, canvasBottom);

  /* ── Resolve individual edge pairs to chip-to-chip connections ── */

  // Step 1: collect unique (sourceChip, targetChip) pairs across all bundles
  interface ChipPairKey {
    sourceGroupId: string;
    targetGroupId: string;
    sourceChipId: string;
    targetChipId: string;
    sourceChipIndex: number;
    targetChipIndex: number;
    edgeIds: string[];
    endpointNodeIds: Set<string>;
  }
  const chipPairMap = new Map<string, ChipPairKey>();

  for (const bundle of model.bundles) {
    const source = contextsByGroup.get(bundle.sourceGroupId);
    const target = contextsByGroup.get(bundle.targetGroupId);
    if (!source || !target) continue;

    for (const pair of bundle.pairs) {
      const srcAnchor = source.outboundNodeToAnchor.get(pair.sourceNodeId);
      if (!srcAnchor) continue;
      const srcChipId = source.rightNodeToChipId.get(srcAnchor);
      if (!srcChipId) continue;
      const srcIdx = source.rightChipIndex.get(srcChipId);
      if (srcIdx === undefined) continue;

      const tgtAnchor = target.inboundNodeToAnchor.get(pair.targetNodeId);
      if (!tgtAnchor) continue;
      const tgtChipId = target.leftNodeToChipId.get(tgtAnchor);
      if (!tgtChipId) continue;
      const tgtIdx = target.leftChipIndex.get(tgtChipId);
      if (tgtIdx === undefined) continue;

      const key = `${srcChipId}->${tgtChipId}`;
      const existing = chipPairMap.get(key);
      if (existing) {
        existing.edgeIds.push(pair.edgeId);
        existing.endpointNodeIds.add(pair.sourceNodeId);
        existing.endpointNodeIds.add(pair.targetNodeId);
      } else {
        chipPairMap.set(key, {
          sourceGroupId: bundle.sourceGroupId,
          targetGroupId: bundle.targetGroupId,
          sourceChipId: srcChipId,
          targetChipId: tgtChipId,
          sourceChipIndex: srcIdx,
          targetChipIndex: tgtIdx,
          edgeIds: [pair.edgeId],
          endpointNodeIds: new Set([pair.sourceNodeId, pair.targetNodeId]),
        });
      }
    }
  }

  // Step 2: count connections per chip for Y-offset spreading
  const sourcePortCounts = new Map<string, number>();
  const targetPortCounts = new Map<string, number>();
  for (const cp of chipPairMap.values()) {
    sourcePortCounts.set(cp.sourceChipId, (sourcePortCounts.get(cp.sourceChipId) ?? 0) + 1);
    targetPortCounts.set(cp.targetChipId, (targetPortCounts.get(cp.targetChipId) ?? 0) + 1);
  }

  // Track which slot index to use next for each chip
  const sourcePortSlot = new Map<string, number>();
  const targetPortSlot = new Map<string, number>();

  const getPortY = (
    view: BoundaryGroupView,
    chipIndex: number,
    chipId: string,
    portCounts: Map<string, number>,
    portSlot: Map<string, number>,
  ): number => {
    const offset = view.rowOffsets[chipIndex] ?? 0;
    const rowH = view.rowHeights[chipIndex] ?? ROW_HEIGHT;
    const centerY = view.top + GROUP_OUTER_PAD + view.rowsTop + CONTENT_INNER_PAD + offset + rowH / 2;
    const total = portCounts.get(chipId) ?? 1;
    if (total <= 1) return centerY;
    const slot = portSlot.get(chipId) ?? 0;
    portSlot.set(chipId, slot + 1);
    const spread = Math.min(rowH * 0.6, total * 4);
    return centerY - spread / 2 + (slot / (total - 1)) * spread;
  };

  // Step 3: sort connections to minimize crossings (top source → top target)
  const sortedPairs = Array.from(chipPairMap.values()).sort((a, b) => {
    if (a.sourceGroupId !== b.sourceGroupId) return a.sourceGroupId.localeCompare(b.sourceGroupId);
    if (a.targetGroupId !== b.targetGroupId) return a.targetGroupId.localeCompare(b.targetGroupId);
    if (a.sourceChipIndex !== b.sourceChipIndex) return a.sourceChipIndex - b.sourceChipIndex;
    return a.targetChipIndex - b.targetChipIndex;
  });

  // Step 4: generate paths
  const connections: BoundaryConnectionView[] = sortedPairs.map((cp) => {
    const source = contextsByGroup.get(cp.sourceGroupId)!;
    const target = contextsByGroup.get(cp.targetGroupId)!;

    const startX = source.view.left + source.view.width + 1;
    const startY = getPortY(source.view, cp.sourceChipIndex, cp.sourceChipId, sourcePortCounts, sourcePortSlot);
    const endX = target.view.left - 1;
    const endY = getPortY(target.view, cp.targetChipIndex, cp.targetChipId, targetPortCounts, targetPortSlot);

    const dx = endX - startX;
    const bend = Math.max(36, Math.abs(dx) * 0.32);
    const direction = dx >= 0 ? 1 : -1;
    const c1x = startX + direction * bend;
    const c2x = endX - direction * bend;
    const path = `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`;

    return {
      id: `conn:${cp.sourceChipId}->${cp.targetChipId}`,
      sourceGroupId: cp.sourceGroupId,
      targetGroupId: cp.targetGroupId,
      sourceChipId: cp.sourceChipId,
      targetChipId: cp.targetChipId,
      path,
      sourcePortX: startX,
      sourcePortY: startY,
      targetPortX: endX,
      targetPortY: endY,
      edgeIds: cp.edgeIds,
      endpointNodeIds: Array.from(cp.endpointNodeIds),
    };
  });

  return {
    groups: Array.from(contextsByGroup.values()).map((context) => context.view),
    connections,
    width,
    height,
  };
};

export function ProtocolDiagramPanel({
  isOpen,
  model,
  hasVisibleTabs = false,
  onClose,
  onSelectNode,
  onSelectGroup,
  onSelectConnection,
  canvasSelectedEdgeIds,
  committedOffsets: controlledCommittedOffsets,
  onCommittedOffsetsChange,
  onPanelWidthChange,
  onUpdateGroupComment,
  style = {},
}: ProtocolDiagramPanelProps) {
  const [editingCommentByGroup, setEditingCommentByGroup] = useState<
    Record<string, boolean>
  >({});
  const [commentDraftByGroup, setCommentDraftByGroup] = useState<
    Record<string, string>
  >({});
  const [localCommittedOffsets, setLocalCommittedOffsets] =
    useState<ProtocolDiagramGroupOffsets>({});
  const committedOffsets = controlledCommittedOffsets ?? localCommittedOffsets;
  const setCommittedOffsets = (next: ProtocolDiagramGroupOffsets) => {
    if (onCommittedOffsetsChange) {
      onCommittedOffsetsChange(next);
      return;
    }
    setLocalCommittedOffsets(next);
  };
  const activeCommentOverrides = useMemo(() => {
    const next: Record<string, string> = {};
    for (const group of model.groups) {
      if (!editingCommentByGroup[group.id]) continue;
      next[group.id] = commentDraftByGroup[group.id] ?? group.comment ?? "";
    }
    return next;
  }, [commentDraftByGroup, editingCommentByGroup, model.groups]);
  const baseLayout = useMemo(
    () =>
      computeBoundaryLayout(
        model,
        committedOffsets,
        activeCommentOverrides
      ),
    [model, committedOffsets, activeCommentOverrides]
  );

  // Live drag state — stored in a ref so per-frame moves don't trigger full layout recomputation.
  // A render-tick counter forces a lightweight re-render to apply the CSS translate + shifted connections.
  const liveDragRef = useRef<{ groupId: string; dx: number; dy: number } | null>(null);
  const [dragTick, setDragTick] = useState(0);

  // Derive the displayed layout by applying the live drag delta (cheap per-frame shifts)
  const layout = useMemo(() => {
    const drag = liveDragRef.current;
    if (!baseLayout || !drag) return baseLayout;

    const { groupId, dx, dy } = drag;

    const groups = baseLayout.groups.map((g) =>
      g.id === groupId ? { ...g, left: g.left + dx, top: g.top + dy } : g,
    );

    const connections = baseLayout.connections.map((c) => {
      const shiftSrc = c.sourceGroupId === groupId;
      const shiftTgt = c.targetGroupId === groupId;
      if (!shiftSrc && !shiftTgt) return c;

      const sx = shiftSrc ? dx : 0;
      const sy = shiftSrc ? dy : 0;
      const tx = shiftTgt ? dx : 0;
      const ty = shiftTgt ? dy : 0;

      const startX = c.sourcePortX + sx;
      const startY = c.sourcePortY + sy;
      const endX = c.targetPortX + tx;
      const endY = c.targetPortY + ty;
      const cdx = endX - startX;
      const bend = Math.max(36, Math.abs(cdx) * 0.32);
      const direction = cdx >= 0 ? 1 : -1;
      const c1x = startX + direction * bend;
      const c2x = endX - direction * bend;
      const path = `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${endY}, ${endX} ${endY}`;

      return { ...c, path, sourcePortX: startX, sourcePortY: startY, targetPortX: endX, targetPortY: endY };
    });

    // Recompute canvas bounds to include shifted group
    let canvasRight = baseLayout.width;
    let canvasBottom = baseLayout.height;
    for (const g of groups) {
      canvasRight = Math.max(canvasRight, g.left + g.width + CANVAS_MARGIN);
      canvasBottom = Math.max(canvasBottom, g.top + g.height + CANVAS_MARGIN);
    }

    return { groups, connections, width: Math.max(baseLayout.width, canvasRight), height: Math.max(baseLayout.height, canvasBottom) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLayout, dragTick]);

  const panelContainerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    hasMoved: boolean;
    target: Element;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const groupDragRef = useRef<{
    groupId: string;
    pointerId: number;
    startX: number;
    startY: number;
    originDx: number;
    originDy: number;
    target: HTMLElement;
    hasMoved: boolean;
  } | null>(null);

  const [panelWidth, setPanelWidth] = useState(() => {
    const defaultWidth = getDefaultProtocolPanelWidth();
    const width = style.width;
    if (typeof width === "number") {
      return clamp(width, MIN_PROTOCOL_PANEL_WIDTH, MAX_PROTOCOL_PANEL_WIDTH);
    }
    if (typeof width === "string") {
      const parsed = parseInt(width, 10);
      if (Number.isFinite(parsed)) {
        return clamp(parsed, MIN_PROTOCOL_PANEL_WIDTH, MAX_PROTOCOL_PANEL_WIDTH);
      }
    }
    return defaultWidth;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isDraggingGroup, setIsDraggingGroup] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const selectedConnRef = useRef<string | null>(null);
  selectedConnRef.current = selectedConnectionId;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [view, setView] = useState({ x: 8, y: 16, scale: 1 });
  const suppressWheelUntilRef = useRef(0);

  const resetTransientInteractions = useCallback(
    ({ resetWheelSuppression = false }: { resetWheelSuppression?: boolean } = {}) => {
      panRef.current = null;
      resizeRef.current = null;
      groupDragRef.current = null;
      liveDragRef.current = null;
      if (resetWheelSuppression) {
        suppressWheelUntilRef.current = 0;
      }
      setIsPanning(false);
      setIsResizing(false);
      setIsDraggingGroup(false);
      document.body.style.userSelect = "";
    },
    []
  );

  const suppressWheelTemporarily = () => {
    suppressWheelUntilRef.current = Date.now() + WHEEL_SUPPRESS_MS_AFTER_DRAG;
  };

  // Reset transient interaction state when panel content disappears.
  useEffect(() => {
    if (isOpen && model.hasGroups) return;
    resetTransientInteractions({ resetWheelSuppression: true });
  }, [isOpen, model.hasGroups, resetTransientInteractions]);

  // Fail-safe: if pointer lifecycle is interrupted (e.g. lost pointerup), clear
  // interaction locks so wheel zoom cannot get stuck.
  useEffect(() => {
    if (!isOpen) return;

    const clearIfStuck = () => {
      if (!panRef.current && !resizeRef.current && !groupDragRef.current) return;
      resetTransientInteractions();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearIfStuck();
      }
    };

    window.addEventListener("pointerup", clearIfStuck);
    window.addEventListener("pointercancel", clearIfStuck);
    window.addEventListener("blur", clearIfStuck);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointerup", clearIfStuck);
      window.removeEventListener("pointercancel", clearIfStuck);
      window.removeEventListener("blur", clearIfStuck);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isOpen, resetTransientInteractions]);

  useEffect(() => {
    const validGroupIds = new Set(model.groups.map((group) => group.id));
    setEditingCommentByGroup((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [groupId, isEditing] of Object.entries(prev)) {
        if (!validGroupIds.has(groupId)) {
          changed = true;
          continue;
        }
        next[groupId] = isEditing;
      }
      return changed ? next : prev;
    });
    setCommentDraftByGroup((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [groupId, draft] of Object.entries(prev)) {
        if (!validGroupIds.has(groupId)) {
          changed = true;
          continue;
        }
        next[groupId] = draft;
      }
      return changed ? next : prev;
    });
  }, [model.groups]);

  const startGroupCommentEdit = useCallback(
    (groupId: string) => {
      if (!onUpdateGroupComment) return;
      const sourceGroup = model.groups.find((group) => group.id === groupId);
      const sourceText = sourceGroup?.comment ?? "";
      setEditingCommentByGroup((prev) => ({ ...prev, [groupId]: true }));
      setCommentDraftByGroup((prev) => ({ ...prev, [groupId]: sourceText }));
    },
    [model.groups, onUpdateGroupComment]
  );

  const cancelGroupCommentEdit = useCallback((groupId: string) => {
    setEditingCommentByGroup((prev) => ({ ...prev, [groupId]: false }));
    setCommentDraftByGroup((prev) => {
      if (!(groupId in prev)) return prev;
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  }, []);

  const saveGroupCommentEdit = useCallback(
    (groupId: string) => {
      if (!onUpdateGroupComment) {
        cancelGroupCommentEdit(groupId);
        return;
      }

      const nextComment = (commentDraftByGroup[groupId] ?? "").trim();
      onUpdateGroupComment(groupId, nextComment);
      setEditingCommentByGroup((prev) => ({ ...prev, [groupId]: false }));
      setCommentDraftByGroup((prev) => {
        if (!(groupId in prev)) return prev;
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    },
    [cancelGroupCommentEdit, commentDraftByGroup, onUpdateGroupComment]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (!onUpdateGroupComment) return;

    const hasEditingComment = Object.values(editingCommentByGroup).some(Boolean);
    if (!hasEditingComment) return;

    const handleDocumentPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-group-comment='true']")) return;

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLTextAreaElement &&
        activeElement.dataset.groupCommentEditor === "true"
      ) {
        activeElement.blur();
        return;
      }

      for (const [groupId, isEditing] of Object.entries(editingCommentByGroup)) {
        if (!isEditing) continue;
        saveGroupCommentEdit(groupId);
      }
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [
    editingCommentByGroup,
    isOpen,
    onUpdateGroupComment,
    saveGroupCommentEdit,
  ]);

  const fitView = () => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return;

    const rect = viewport.getBoundingClientRect();
    const viewportWidth = rect.width;
    const viewportHeight = rect.height;

    // Add padding to ensure all content is visible (5% margins)
    const padding = 0.05;
    const paddedWidth = viewportWidth * (1 - padding * 2);
    const paddedHeight = viewportHeight * (1 - padding * 2);

    // Calculate scale to fit content
    const scaleX = paddedWidth / layout.width;
    const scaleY = paddedHeight / layout.height;
    const newScale = clamp(Math.min(scaleX, scaleY), MIN_SCALE, MAX_SCALE);

    // Center the content
    const x = (viewportWidth - layout.width * newScale) / 2;
    const y = (viewportHeight - layout.height * newScale) / 2;

    setView({ x, y, scale: newScale });
  };

  const zoomBy = (factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      setView((current) => ({
        ...current,
        scale: clamp(current.scale * factor, MIN_SCALE, MAX_SCALE),
      }));
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    setView((current) => {
      const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const worldX = (cx - current.x) / current.scale;
      const worldY = (cy - current.y) / current.scale;
      return {
        x: cx - worldX * nextScale,
        y: cy - worldY * nextScale,
        scale: nextScale,
      };
    });
  };

  // Notify parent when panel width changes
  useEffect(() => {
    if (isOpen) {
      onPanelWidthChange?.(panelWidth);
    }
  }, [panelWidth, isOpen, onPanelWidthChange]);

  // Clear connection selection when panel closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedConnectionId(null);
      onSelectConnection?.([], []);
    }
  }, [isOpen, onSelectConnection]);

  // Sync: clear panel selection when canvas edges are deselected externally.
  // Only reacts to canvasSelectedEdgeIds changes — uses refs for layout and
  // selectedConnectionId to avoid firing when the model/layout recomputes
  // (which happens whenever setNodes/setEdges runs, before the new
  // canvasSelectedEdgeIds prop has propagated).
  useEffect(() => {
    const connId = selectedConnRef.current;
    const currentLayout = layoutRef.current;
    if (!connId || !currentLayout || !canvasSelectedEdgeIds) return;
    const conn = currentLayout.connections.find((c) => c.id === connId);
    if (!conn) return;
    if (!conn.edgeIds.some((id) => canvasSelectedEdgeIds.includes(id))) {
      setSelectedConnectionId(null);
    }
  }, [canvasSelectedEdgeIds]);

  // Apply global cursor during resize
  useEffect(() => {
    if (isResizing) {
      document.body.style.cursor = "col-resize";
      return () => {
        document.body.style.cursor = "";
      };
    }
  }, [isResizing]);

  // Viewport wheel zoom handler - single source of truth
  useEffect(() => {
    const viewport = viewportRef.current;
    const panel = panelContainerRef.current;
    if (!viewport || !panel || !isOpen) return;

    const handleWheel = (event: globalThis.WheelEvent) => {
      // Prevent default scrolling, stop propagation to main canvas, and handle zoom
      event.preventDefault();
      event.stopPropagation();

      let hasInteractionLock =
        Boolean(panRef.current) ||
        Boolean(groupDragRef.current) ||
        Boolean(resizeRef.current);

      // Defensive recovery for stale locks where pointerup/pointercancel was lost.
      if (hasInteractionLock && (event.buttons ?? 0) === 0) {
        resetTransientInteractions();
        hasInteractionLock =
          Boolean(panRef.current) ||
          Boolean(groupDragRef.current) ||
          Boolean(resizeRef.current);
      }

      if (Date.now() < suppressWheelUntilRef.current || hasInteractionLock) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const deltaModeScale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const normalizedDelta = event.deltaY * deltaModeScale;
      if (Math.abs(normalizedDelta) < 0.2) return;

      setView((current) => {
        const factor = Math.exp(-normalizedDelta * WHEEL_ZOOM_SENSITIVITY);
        const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
        if (nextScale === current.scale) return current;
        const worldX = (cx - current.x) / current.scale;
        const worldY = (cy - current.y) / current.scale;
        return {
          x: cx - worldX * nextScale,
          y: cy - worldY * nextScale,
          scale: nextScale,
        };
      });
    };

    // Attach to viewport for zoom functionality
    viewport.addEventListener("wheel", handleWheel, { passive: false });

    // Also catch wheel events on entire panel to prevent main canvas zoom
    const stopPanelWheel = (event: globalThis.WheelEvent) => {
      event.stopPropagation();
    };
    panel.addEventListener("wheel", stopPanelWheel, { passive: true });

    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      panel.removeEventListener("wheel", stopPanelWheel);
    };
  }, [isOpen, model.hasGroups, resetTransientInteractions]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-diagram-interactive='true']")) return;

    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      hasMoved: false,
      target: event.target as Element,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation(); // Prevent event from reaching main canvas
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    pan.hasMoved = true;
    event.stopPropagation(); // Prevent event from reaching main canvas
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    setView((current) => ({
      ...current,
      x: pan.originX + dx,
      y: pan.originY + dy,
    }));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    if (!pan.hasMoved) {
      const connGroup = pan.target.closest<SVGGElement>("[data-connection-id]");
      if (connGroup) {
        const connId = connGroup.dataset.connectionId!;
        const conn = layout?.connections.find((c) => c.id === connId);
        if (conn) {
          setSelectedConnectionId(connId);
          onSelectConnection?.(conn.edgeIds, conn.endpointNodeIds);
        }
      } else if (selectedConnectionId) {
        setSelectedConnectionId(null);
        onSelectConnection?.([], []);
      }
    }

    // Swallow the native click event browsers fire after pointerup to prevent
    // it from reaching ReactFlow's pane handler (which would deselect edges).
    const el = event.currentTarget;
    el.addEventListener(
      "click",
      (e) => { e.stopPropagation(); e.preventDefault(); },
      { capture: true, once: true },
    );

    panRef.current = null;
    setIsPanning(false);
    suppressWheelTemporarily();
    if (el.hasPointerCapture(event.pointerId)) {
      el.releasePointerCapture(event.pointerId);
    }
  };

  // Resize handle handlers
  const handleResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidth,
    };
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();

    // Prevent text selection during resize
    document.body.style.userSelect = "none";
  };

  const handleResizeMove = (event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    event.stopPropagation();
    event.preventDefault();
    const dx = resize.startX - event.clientX; // Subtract because dragging left increases width
    const newWidth = clamp(
      resize.startWidth + dx,
      MIN_PROTOCOL_PANEL_WIDTH,
      MAX_PROTOCOL_PANEL_WIDTH
    );
    setPanelWidth(newWidth);
  };

  const handleResizeEnd = (event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    resizeRef.current = null;
    setIsResizing(false);
    suppressWheelTemporarily();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    // Re-enable text selection
    document.body.style.userSelect = "";
  };

  // Group drag handlers — unified click/drag via movement threshold
  const DRAG_THRESHOLD = 3;

  const handleGroupPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    groupId: string,
  ) => {
    if (event.button !== 0) return;

    groupDragRef.current = {
      groupId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originDx: 0,
      originDy: 0,
      target: event.target as HTMLElement,
      hasMoved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleGroupPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.stopPropagation();
    const rawDx = event.clientX - drag.startX;
    const rawDy = event.clientY - drag.startY;

    if (!drag.hasMoved) {
      if (Math.abs(rawDx) + Math.abs(rawDy) < DRAG_THRESHOLD) return;
      drag.hasMoved = true;
      setIsDraggingGroup(true);
    }

    const dx = rawDx / view.scale;
    const dy = rawDy / view.scale;
    liveDragRef.current = { groupId: drag.groupId, dx, dy };
    setDragTick((t) => t + 1);
  };

  const handleGroupPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.hasMoved) {
      // It was a click — resolve target
      const nodeEl = drag.target.closest<HTMLElement>("[data-node-id]");
      if (nodeEl?.dataset.nodeId) {
        onSelectNode?.(nodeEl.dataset.nodeId);
      } else if (drag.target.closest("[data-group-header]")) {
        onSelectGroup?.(drag.groupId);
      }
    } else {
      // Commit the drag delta into persistent offsets (triggers one full layout recomputation)
      const live = liveDragRef.current;
      if (live) {
        const existing = committedOffsets[live.groupId] ?? { dx: 0, dy: 0 };
        setCommittedOffsets({
          ...committedOffsets,
          [live.groupId]: {
            dx: existing.dx + live.dx,
            dy: existing.dy + live.dy,
          },
        });
        liveDragRef.current = null;
        setDragTick((t) => t + 1);
      }

      // Swallow the stale click event browsers fire after pointerup on buttons
      const el = event.currentTarget;
      el.addEventListener(
        "click",
        (e) => { e.stopPropagation(); e.preventDefault(); },
        { capture: true, once: true },
      );
    }

    groupDragRef.current = null;
    setIsDraggingGroup(false);
    suppressWheelTemporarily();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={panelContainerRef}
      className={cn(
        "fixed top-14 bottom-0 right-0 z-10 flex flex-col select-none border-l border-border bg-background",
        !isResizing && "transition-[width] duration-300",
        !isOpen && "overflow-hidden"
      )}
      data-testid="protocol-diagram-panel"
      style={{
        pointerEvents: isOpen ? "auto" : "none",
        ...style,
        width: isOpen ? panelWidth : 0,
      }}
    >
      {isOpen && (
        <>
          {/* Resize handle with invisible hit area */}
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-50 group"
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
          >
            <div
              className={cn(
                "absolute left-0 top-0 bottom-0 w-0 bg-transparent transition-all",
                "group-hover:w-px group-hover:bg-primary/50",
                isResizing && "w-px bg-primary"
              )}
            />
          </div>

          <div
            className={cn(
              "flex items-center justify-between px-2 border-b",
              hasVisibleTabs ? "h-10" : "pt-2 pb-1"
            )}
          >
            <span className="text-sm font-medium">Flow Map</span>
            <button
              onClick={() => onClose?.()}
              title="Close diagram"
              className="p-1 rounded hover:bg-secondary active:scale-95"
              data-diagram-interactive="true"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 p-1 text-sm">
            {!model.hasGroups ? (
              <div className="italic text-muted-foreground">No groups found in this flow.</div>
            ) : (
              <section className="h-full space-y-1 flex flex-col">
                {layout ? (
                  <div
                    ref={viewportRef}
                    data-testid="protocol-diagram-viewport"
                    className={cn(
                      "relative flex-1 overflow-hidden border-[0.5px] border-border/40 bg-background select-none touch-none",
                      isPanning ? "cursor-grabbing" : "cursor-grab"
                    )}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  >
                    {/* Zoom controls - matching main canvas style */}
                    <div className="absolute right-1.5 bottom-1.5 z-30 flex flex-col rounded border border-border bg-background shadow-sm text-muted-foreground">
                      <button
                        className="p-[5px] hover:bg-secondary transition-colors border-b border-border"
                        onClick={() => zoomBy(ZOOM_STEP)}
                        title="Zoom in"
                        data-diagram-interactive="true"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="h-3.5 w-3.5 fill-current"><path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" /></svg>
                      </button>
                      <button
                        className="p-[5px] hover:bg-secondary transition-colors border-b border-border"
                        onClick={() => zoomBy(1 / ZOOM_STEP)}
                        title="Zoom out"
                        data-diagram-interactive="true"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 5" className="h-3.5 w-3.5 fill-current"><path d="M0 0h32v4.2H0z" /></svg>
                      </button>
                      <button
                        className="p-[5px] hover:bg-secondary transition-colors"
                        onClick={fitView}
                        title="Fit view"
                        data-diagram-interactive="true"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30" className="h-3.5 w-3.5 fill-current"><path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" /></svg>
                      </button>
                    </div>

                    <div
                      data-testid="protocol-diagram-content"
                      className="absolute left-0 top-0 will-change-transform"
                      style={{
                        width: layout.width,
                        height: layout.height,
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                        transformOrigin: "0 0",
                      }}
                    >
                      <svg width={layout.width} height={layout.height} className="absolute inset-0 z-0" overflow="visible">
                        {layout.connections.map((conn) => {
                          const isSelected = selectedConnectionId === conn.id;
                          return (
                            <g
                              key={conn.id}
                              className={isSelected
                                ? "text-blue-500 dark:text-blue-400"
                                : "text-slate-400 dark:text-slate-500"
                              }
                              data-connection-id={conn.id}
                            >
                              <path
                                d={conn.path}
                                stroke="transparent"
                                strokeWidth={8}
                                fill="none"
                                className="cursor-pointer"
                              />
                              <path
                                d={conn.path}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={isSelected ? 2 : 1}
                                strokeOpacity={isSelected ? 0.9 : 0.45}
                                strokeLinecap="round"
                                className="pointer-events-none"
                              />
                              <circle
                                cx={conn.sourcePortX}
                                cy={conn.sourcePortY}
                                r={isSelected ? 3.5 : 2.5}
                                fill="currentColor"
                                fillOpacity={isSelected ? 0.9 : 0.5}
                                className="pointer-events-none"
                              />
                              <circle
                                cx={conn.targetPortX}
                                cy={conn.targetPortY}
                                r={isSelected ? 3.5 : 2.5}
                                fill="currentColor"
                                fillOpacity={isSelected ? 0.9 : 0.5}
                                className="pointer-events-none"
                              />
                            </g>
                          );
                        })}
                      </svg>

                      {layout.groups.map((group) => {
                        const accent = group.color ?? "#94a3b8";
                        const isEditingComment = Boolean(editingCommentByGroup[group.id]);
                        const draftComment = commentDraftByGroup[group.id] ?? group.comment ?? "";
                        const canEditComment = Boolean(onUpdateGroupComment);
                        return (
                          <div
                            key={group.id}
                            className={cn(
                              "absolute z-10 overflow-hidden rounded-lg border-2 bg-card shadow-md touch-none font-mono text-primary",
                              isDraggingGroup && groupDragRef.current?.groupId === group.id
                                ? "cursor-grabbing"
                                : "cursor-grab",
                            )}
                            style={{
                              left: group.left,
                              top: group.top,
                              width: group.width,
                              height: group.height,
                              borderColor: accent,
                              backfaceVisibility: "hidden",  // Safari: fix overflow-hidden + border-radius clip
                              transform: "translateZ(0)",    //         inside will-change-transform parent
                            }}
                            data-group-id={group.id}
                            onPointerDown={(e) => handleGroupPointerDown(e, group.id)}
                            onPointerMove={handleGroupPointerMove}
                            onPointerUp={handleGroupPointerUp}
                            onPointerCancel={handleGroupPointerUp}
                          >
                            <div
                              className="w-full border-b border-border/40 px-1.5 py-1 flex items-center gap-1"
                              style={{
                                backgroundColor: toRgba(accent, 0.10),
                                minHeight: group.headerHeight,
                              }}
                            >
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left hover:bg-secondary/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm px-0.5 py-0.5"
                                onClick={() => onSelectGroup?.(group.id)}
                                data-group-header="true"
                                title={
                                  group.comment
                                    ? `Focus ${group.title} on canvas\n${group.comment}`
                                    : `Focus ${group.title} on canvas`
                                }
                              >
                                <span
                                  className="block truncate font-semibold"
                                  style={{
                                    fontSize: GROUP_TITLE_FONT_SIZE,
                                    lineHeight: `${GROUP_TITLE_LINE_HEIGHT}px`,
                                  }}
                                >
                                  {"> "}{group.title}
                                </span>
                              </button>
                            </div>

                            <div
                              className="px-1 py-1 relative"
                              style={{
                                minHeight:
                                  IO_HEAD_HEIGHT +
                                  group.rowAreaHeight +
                                  group.commentSectionHeight +
                                  GROUP_FOOTER_PADDING,
                              }}
                            >
                              <div
                                className="grid grid-cols-2 gap-x-2 px-0.5 text-[10px] font-semibold leading-none text-muted-foreground"
                                style={{ height: IO_HEAD_HEIGHT }}
                              >
                                <span>IN</span>
                                <span className="text-right">OUT</span>
                              </div>

                              <div className="space-y-0">
                                {Array.from({ length: group.rowCount }).map((_, index) => {
                                  const inbound = group.leftChips[index];
                                  const outbound = group.rightChips[index];
                                  return (
                                    <div
                                      key={`${group.id}-row-${index}`}
                                      className="grid grid-cols-2 gap-x-2 items-center"
                                      style={{ minHeight: group.rowHeights[index] ?? ROW_HEIGHT }}
                                    >
                                      <div>
                                        {inbound ? (
                                          inbound.interactive && inbound.nodeIds[0] ? (
                                            <button
                                              type="button"
                                              className={cn(
                                                "inline-block max-w-full whitespace-normal break-words rounded-sm border border-border bg-card px-1.5 py-0.5 text-left text-[11px] leading-tight text-primary hover:bg-secondary/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                              )}
                                              title={inbound.title}
                                              data-node-id={inbound.nodeIds[0]}
                                              onClick={() => onSelectNode?.(inbound.nodeIds[0]!)}
                                            >
                                              {inbound.label}
                                            </button>
                                          ) : (
                                            <span
                                              className={cn(
                                                "inline-block max-w-full whitespace-normal break-words rounded-sm border border-muted-foreground/20 bg-muted/40 px-1.5 py-0.5 text-left text-[11px] leading-tight text-muted-foreground"
                                              )}
                                              title={inbound.title}
                                            >
                                              {inbound.label}
                                            </span>
                                          )
                                        ) : (
                                          <span className="inline-block h-[22px]" />
                                        )}
                                      </div>

                                      <div className="flex justify-end">
                                        {outbound ? (
                                          outbound.interactive && outbound.nodeIds[0] ? (
                                            <button
                                              type="button"
                                              className={cn(
                                                "inline-flex items-center gap-0.5 max-w-full whitespace-normal break-words rounded-sm border border-border bg-card px-1.5 py-0.5 text-left text-[11px] leading-tight text-primary hover:bg-secondary/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                                outbound.isMainOutput && "font-semibold"
                                              )}
                                              title={outbound.title}
                                              data-node-id={outbound.nodeIds[0]}
                                              data-main-output={
                                                outbound.isMainOutput
                                                  ? "true"
                                                  : undefined
                                              }
                                              onClick={() => onSelectNode?.(outbound.nodeIds[0]!)}
                                            >
                                              {outbound.label}
                                            </button>
                                          ) : (
                                            <span
                                              className={cn(
                                                "inline-flex items-center gap-0.5 max-w-full whitespace-normal break-words rounded-sm border border-muted-foreground/20 bg-muted/40 px-1.5 py-0.5 text-left text-[11px] leading-tight text-muted-foreground",
                                                outbound.isMainOutput && "font-semibold"
                                              )}
                                              title={outbound.title}
                                              data-main-output={
                                                outbound.isMainOutput
                                                  ? "true"
                                                  : undefined
                                              }
                                            >
                                              {outbound.label}
                                            </span>
                                          )
                                        ) : (
                                          <span className="inline-block h-[22px]" />
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div
                                data-group-comment="true"
                                className="mt-1.5 max-w-full overflow-auto rounded-sm border border-border/40 bg-muted/25 px-2 py-1.5 text-xs leading-snug text-foreground/90 whitespace-pre-wrap break-words"
                                style={{
                                  height: group.commentBodyHeight,
                                  maxHeight: group.commentBodyHeight,
                                  boxSizing: "border-box",
                                }}
                                onWheelCapture={(event) => event.stopPropagation()}
                                onPointerDownCapture={(event) => event.stopPropagation()}
                              >
                                {isEditingComment ? (
                                  <textarea
                                    value={draftComment}
                                    onChange={(event) => {
                                      const nextValue = event.target.value;
                                      setCommentDraftByGroup((prev) => ({
                                        ...prev,
                                        [group.id]: nextValue,
                                      }));
                                    }}
                                    className="w-full h-full resize-none rounded-sm border border-border bg-background/80 px-1.5 py-1 font-mono text-xs leading-snug text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    onBlur={() => saveGroupCommentEdit(group.id)}
                                    onKeyDown={(event) => {
                                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                        event.preventDefault();
                                        saveGroupCommentEdit(group.id);
                                      } else if (event.key === "Escape") {
                                        event.preventDefault();
                                        cancelGroupCommentEdit(group.id);
                                      }
                                    }}
                                    placeholder="Click to add note..."
                                    data-diagram-interactive="true"
                                    data-group-comment-editor="true"
                                    autoFocus
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    data-diagram-interactive="true"
                                    className={cn(
                                      "h-full w-full rounded-sm px-0.5 py-0.5 text-left text-xs leading-snug whitespace-pre-wrap break-words focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                                      canEditComment
                                        ? "cursor-text"
                                        : "cursor-default"
                                    )}
                                    onClick={() => {
                                      if (!canEditComment) return;
                                      startGroupCommentEdit(group.id);
                                    }}
                                    title={
                                      canEditComment
                                        ? "Click to edit note"
                                        : undefined
                                    }
                                  >
                                    {group.comment || (
                                      <span className="text-muted-foreground/80 italic">
                                        Click to add note...
                                      </span>
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded border border-border p-2 text-xs text-muted-foreground">
                    No diagram layout available.
                  </div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
