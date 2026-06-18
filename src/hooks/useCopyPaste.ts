// rawbit-shadcn/src/hooks/useCopyPaste.ts
//---------------------------------------------------------------
// 100% "new-format" copy & paste - no legacy helper, no utils file
// Optimized: cursor position is stored in a ref (no re-renders)
//---------------------------------------------------------------

import { useCallback, useRef, useState } from "react";
import { Edge, useReactFlow, XYPosition } from "@xyflow/react";
import { log } from "@/lib/logConfig";
import type {
  FlowNode,
  GroupBundlePortOffsets,
  NodeData,
  ScriptExecutionResult,
} from "@/types";
import { importWithFreshIds } from "@/lib/idUtils";
import {
  getScriptSteps,
  setScriptSteps,
} from "@/lib/share/scriptStepsCache";
import {
  sanitizeGroupBundleRenderEdgesForState,
  stripGroupBundlePortNodes,
} from "@/lib/flow/groupEdgeBundling";

/* ----------------------------------------------------------------
   LOCAL types
------------------------------------------------------------------ */
type CopiedNodeInfo = {
  id: string;
  type: string | undefined;
  parentId?: string;
  data: FlowNode["data"];
  width?: number;
  height?: number;
  absX: number;
  absY: number;
  dragHandle?: string;
  scriptSteps?: ScriptExecutionResult;
};

type CopiedContent = {
  nodes: CopiedNodeInfo[];
  edges: Edge[];
  incomingEdges: Edge[];
  minX: number;
  minY: number;
};

export type PasteNodesOptions = {
  includeIncomingConnections?: boolean;
};

type UseCopyPasteOptions = {
  getClipboardNodes?: () => FlowNode[];
  getClipboardEdges?: () => Edge[];
};

const GROUP_PADDING = 32;

const cloneScriptSteps = (
  steps: ScriptExecutionResult | undefined
): ScriptExecutionResult | undefined => {
  if (!steps) return undefined;
  if (typeof structuredClone === "function") return structuredClone(steps);
  return JSON.parse(JSON.stringify(steps)) as ScriptExecutionResult;
};

const getRenderedSelectedNodeIds = (): Set<string> => {
  const selectedIds = new Set<string>();
  if (typeof document === "undefined") return selectedIds;

  document
    .querySelectorAll<HTMLElement>(".react-flow__node.selected[data-id]")
    .forEach((element) => {
      const id = element.getAttribute("data-id");
      if (id) selectedIds.add(id);
    });

  return selectedIds;
};

const asFiniteNumber = (value: unknown): number | undefined => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const getNodeDimension = (
  node: FlowNode,
  axis: "width" | "height",
  fallback: number
): number =>
  Math.max(
    asFiniteNumber(node.data?.[axis]) ?? 0,
    asFiniteNumber(node[axis]) ?? 0,
    asFiniteNumber(node.measured?.[axis]) ?? 0,
    fallback
  );

const getAbsoluteNodePosition = (
  node: FlowNode,
  lookup: Map<string, FlowNode>
): XYPosition => {
  let x = node.position.x;
  let y = node.position.y;
  const seen = new Set<string>([node.id]);
  let parentId = node.parentId;

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = lookup.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }

  return { x, y };
};

const findGroupAtPoint = (
  point: XYPosition,
  nodes: FlowNode[]
): { node: FlowNode; abs: XYPosition } | null => {
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  const candidates = nodes
    .filter((node) => node.type === "shadcnGroup")
    .map((node) => {
      const abs = node.positionAbsolute ?? getAbsoluteNodePosition(node, lookup);
      const width = getNodeDimension(node, "width", 300);
      const height = getNodeDimension(node, "height", 200);
      return { node, abs, width, height };
    })
    .filter(({ abs, width, height }) => {
      return (
        point.x >= abs.x &&
        point.x <= abs.x + width &&
        point.y >= abs.y &&
        point.y <= abs.y + height
      );
    });

  if (!candidates.length) return null;

  const best = candidates.reduce((winner, candidate) => {
    const bestArea = winner.width * winner.height;
    const candidateArea = candidate.width * candidate.height;
    return candidateArea < bestArea ? candidate : winner;
  });

  return { node: best.node, abs: best.abs };
};

export const fitGroupToChildrenInNodes = (
  nodes: FlowNode[],
  groupId: string
): FlowNode[] => {
  const group = nodes.find(
    (node) => node.id === groupId && node.type === "shadcnGroup"
  );
  if (!group) return nodes;

  const children = nodes.filter((node) => node.parentId === groupId);
  if (!children.length) return nodes;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  children.forEach((child) => {
    const width = getNodeDimension(child, "width", 250);
    const height = getNodeDimension(child, "height", 150);
    minX = Math.min(minX, child.position.x);
    minY = Math.min(minY, child.position.y);
    maxX = Math.max(maxX, child.position.x + width);
    maxY = Math.max(maxY, child.position.y + height);
  });

  const shiftX = Math.max(0, GROUP_PADDING - minX);
  const shiftY = Math.max(0, GROUP_PADDING - minY);
  const currentWidth = getNodeDimension(group, "width", 300);
  const currentHeight = getNodeDimension(group, "height", 200);
  const nextWidth = Math.max(currentWidth, maxX + shiftX + GROUP_PADDING);
  const nextHeight = Math.max(currentHeight, maxY + shiftY + GROUP_PADDING);

  if (
    shiftX === 0 &&
    shiftY === 0 &&
    nextWidth === currentWidth &&
    nextHeight === currentHeight
  ) {
    return nodes;
  }

  return nodes.map((node) => {
    if (node.id === groupId) {
      return {
        ...node,
        // Compensate the group origin for the child shift so EXISTING children
        // keep their absolute screen position — the frame just grows on the
        // top-left side to make room for the pasted node, instead of jolting
        // every untouched child down-right (NB-05). Origin is relative to the
        // group's own parent, so this is safe for nested groups too.
        ...(shiftX !== 0 || shiftY !== 0
          ? {
              position: {
                x: node.position.x - shiftX,
                y: node.position.y - shiftY,
              },
            }
          : {}),
        width: nextWidth,
        height: nextHeight,
        measured: {
          ...node.measured,
          width: nextWidth,
          height: nextHeight,
        },
        data: { ...node.data, width: nextWidth, height: nextHeight },
      };
    }

    if (node.parentId === groupId) {
      return {
        ...node,
        position: {
          x: node.position.x + shiftX,
          y: node.position.y + shiftY,
        },
      };
    }

    return node;
  });
};

type GroupEndpointNodeInfo = {
  id: string;
  type?: string;
  parentId?: string;
};

const nodeGroupEndpoint = (
  nodeId: string,
  nodeLookup: Map<string, GroupEndpointNodeInfo>
): string | undefined => {
  const node = nodeLookup.get(nodeId);
  if (!node) return undefined;
  if (node.type === "shadcnGroup") return node.id;
  const parent = node.parentId ? nodeLookup.get(node.parentId) : undefined;
  return parent?.type === "shadcnGroup" ? parent.id : undefined;
};

const buildCopiedGroupBundleIdMap = (
  copiedLookup: Map<string, CopiedNodeInfo>,
  copiedEdges: Edge[],
  idMap: Map<string, string>,
  externalLookup: Map<string, GroupEndpointNodeInfo> = new Map()
): Map<string, string> => {
  const bundleIdMap = new Map<string, string>();

  copiedEdges.forEach((edge) => {
    const sourceGroupId =
      nodeGroupEndpoint(edge.source, copiedLookup) ??
      nodeGroupEndpoint(edge.source, externalLookup);
    const targetGroupId =
      nodeGroupEndpoint(edge.target, copiedLookup) ??
      nodeGroupEndpoint(edge.target, externalLookup);
    if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) {
      return;
    }

    if (!idMap.has(sourceGroupId) && !idMap.has(targetGroupId)) return;

    const nextSourceGroupId = idMap.get(sourceGroupId) ?? sourceGroupId;
    const nextTargetGroupId = idMap.get(targetGroupId) ?? targetGroupId;
    if (!nextSourceGroupId || !nextTargetGroupId) return;

    bundleIdMap.set(
      `${sourceGroupId}->${targetGroupId}`,
      `${nextSourceGroupId}->${nextTargetGroupId}`
    );
  });

  return bundleIdMap;
};

const remapBundleOffsetRecord = (
  record: Record<string, number> | undefined,
  bundleIdMap: Map<string, string>
): Record<string, number> | undefined => {
  if (!record) return undefined;
  const next: Record<string, number> = {};

  Object.entries(record).forEach(([bundleId, value]) => {
    const nextBundleId = bundleIdMap.get(bundleId);
    const numeric = asFiniteNumber(value);
    if (!nextBundleId || numeric === undefined) return;
    next[nextBundleId] = numeric;
  });

  return Object.keys(next).length ? next : undefined;
};

const remapGroupBundlePortOffsets = (
  offsets: GroupBundlePortOffsets | undefined,
  bundleIdMap: Map<string, string>
): GroupBundlePortOffsets | undefined => {
  if (!offsets) return undefined;

  const next: GroupBundlePortOffsets = {};
  const source = asFiniteNumber(offsets.source);
  const target = asFiniteNumber(offsets.target);
  const sourceByBundle = remapBundleOffsetRecord(
    offsets.sourceByBundle,
    bundleIdMap
  );
  const targetByBundle = remapBundleOffsetRecord(
    offsets.targetByBundle,
    bundleIdMap
  );

  if (source !== undefined) next.source = source;
  if (target !== undefined) next.target = target;
  if (sourceByBundle) next.sourceByBundle = sourceByBundle;
  if (targetByBundle) next.targetByBundle = targetByBundle;

  return Object.keys(next).length ? next : undefined;
};

const remapGroupBundlePortOffsetsInNodes = (
  nodes: FlowNode[],
  copiedLookup: Map<string, CopiedNodeInfo>,
  copiedEdges: Edge[],
  idMap: Map<string, string>,
  externalLookup?: Map<string, GroupEndpointNodeInfo>
): FlowNode[] => {
  const bundleIdMap = buildCopiedGroupBundleIdMap(
    copiedLookup,
    copiedEdges,
    idMap,
    externalLookup
  );

  return nodes.map((node) => {
    if (node.type !== "shadcnGroup") return node;
    const data = node.data as NodeData | undefined;
    if (!data?.groupBundlePortOffsets) return node;

    const nextOffsets = remapGroupBundlePortOffsets(
      data.groupBundlePortOffsets,
      bundleIdMap
    );
    const nextData = { ...data };
    if (nextOffsets) {
      nextData.groupBundlePortOffsets = nextOffsets;
    } else {
      delete nextData.groupBundlePortOffsets;
    }

    return {
      ...node,
      data: nextData,
    };
  });
};

/* ----------------------------------------------------------------
   Hook
------------------------------------------------------------------ */
export function useCopyPaste({
  getClipboardNodes,
  getClipboardEdges,
}: UseCopyPasteOptions = {}) {
  const [copiedContent, setCopiedContent] = useState<CopiedContent | null>(
    null
  );

  /** Cursor position stored in a ref to avoid state churn */
  const mousePosRef = useRef<XYPosition>({ x: 0, y: 0 });

  const { getNodes, getEdges, setNodes, setEdges, screenToFlowPosition } =
    useReactFlow<FlowNode>();

  /* ---------- mouse tracker so we can paste near cursor ---------- */
  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      /** single cheap assignment – no re‑render */
      mousePosRef.current = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
    },
    [screenToFlowPosition]
  );

  /* ---------- helpers -------------------------------------------------- */
  const addChildrenRecursively = useCallback(
    (group: FlowNode, all: FlowNode[], set: Set<FlowNode>) => {
      all.forEach((n) => {
        if (n.parentId === group.id && !set.has(n)) {
          set.add(n);
          if (n.type === "shadcnGroup") addChildrenRecursively(n, all, set);
        }
      });
    },
    []
  );

  const getAbsolutePosition = useCallback(
    (node: FlowNode, lookup: Map<string, FlowNode>) => {
      let x = node.position.x;
      let y = node.position.y;
      let p = node.parentId ? lookup.get(node.parentId) : undefined;
      while (p) {
        x += p.position.x;
        y += p.position.y;
        p = p.parentId ? lookup.get(p.parentId) : undefined;
      }
      return { x, y };
    },
    []
  );

  /* ---------- COPY ----------------------------------------------------- */
  const copyNodes = useCallback(() => {
    const flowNodes = stripGroupBundlePortNodes(getNodes() as FlowNode[]);
    const allNodes = stripGroupBundlePortNodes(
      (getClipboardNodes?.() ?? getNodes()) as FlowNode[]
    ).map((node) => ({ ...node }));
    const allEdges = sanitizeGroupBundleRenderEdgesForState(
      (getClipboardEdges?.() ?? getEdges()) as Edge[]
    );

    const selectedNodeIds = new Set<string>();
    allNodes.forEach((node) => {
      if (node.selected) selectedNodeIds.add(node.id);
    });
    flowNodes.forEach((node) => {
      if (node.selected) selectedNodeIds.add(node.id);
    });
    getRenderedSelectedNodeIds().forEach((id) => selectedNodeIds.add(id));

    allNodes.forEach((node) => {
      if (selectedNodeIds.has(node.id)) node.selected = true;
    });

    const selected = allNodes.filter((n) => n.selected);
    if (!selected.length) {
      log("copyPaste", "No nodes selected to copy");
      return;
    }

    const set = new Set<FlowNode>(selected);
    selected.forEach((n) => {
      if (n.type === "shadcnGroup") addChildrenRecursively(n, allNodes, set);
    });
    const finalNodes = Array.from(set);

    const copiedNodeIdSet = new Set(finalNodes.map((n) => n.id));
    const relevantEdges = allEdges.filter(
      (e) => copiedNodeIdSet.has(e.source) && copiedNodeIdSet.has(e.target)
    );
    const incomingEdges = allEdges.filter(
      (e) => !copiedNodeIdSet.has(e.source) && copiedNodeIdSet.has(e.target)
    );

    const lookup = new Map(allNodes.map((n) => [n.id, n]));

    let minX = Infinity,
      minY = Infinity;
    const nodeInfos: CopiedNodeInfo[] = finalNodes.map((n) => {
      const { x, y } = getAbsolutePosition(n, lookup);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      const steps = cloneScriptSteps(getScriptSteps(n.id) ?? undefined);
      return {
        id: n.id,
        type: n.type,
        parentId: n.parentId,
        data: n.data,
        width: n.width,
        height: n.height,
        absX: x,
        absY: y,
        dragHandle: n.dragHandle,
        scriptSteps: steps,
      };
    });

    setCopiedContent({
      nodes: nodeInfos,
      edges: relevantEdges,
      incomingEdges,
      minX,
      minY,
    });
    log("copyPaste", "Copied selection", {
      nodes: nodeInfos.length,
      edges: relevantEdges.length,
      incomingEdges: incomingEdges.length,
    });
  }, [
    getClipboardNodes,
    getClipboardEdges,
    getNodes,
    getEdges,
    addChildrenRecursively,
    getAbsolutePosition,
  ]);

  /* ---------- optional helper – paste to deterministic TL corner -------- */
  const getTopLeftPosition = useCallback(
    (sidebarOpen: boolean) =>
      screenToFlowPosition({ x: sidebarOpen ? 300 : 100, y: 100 }),
    [screenToFlowPosition]
  );

  /* ---------- PASTE ---------------------------------------------------- */

  const pasteNodes = useCallback(
    (pos?: XYPosition, options: PasteNodesOptions = {}) => {
      if (!copiedContent) {
        log("copyPaste", "Nothing in clipboard");
        return;
      }

      const {
        nodes: copied,
        edges: copiedEdges,
        incomingEdges,
        minX,
        minY,
      } = copiedContent;
      const includeIncomingConnections =
        options.includeIncomingConnections === true;
      const edgesToImport = includeIncomingConnections
        ? [...copiedEdges, ...incomingEdges]
        : copiedEdges;

      // Base cursor position (or last mouse move) for top-level placement
      const base = pos ?? mousePosRef.current;

      // Quick lookup: was a node's parent included in the copied set?
      const copiedLookup = new Map(copied.map((c) => [c.id, c]));
      const currentNodes = (getClipboardNodes?.() ?? getNodes()) as FlowNode[];
      const currentEdges = sanitizeGroupBundleRenderEdgesForState(
        (getClipboardEdges?.() ?? getEdges()) as Edge[]
      );
      const currentNodeIdSet = new Set(currentNodes.map((node) => node.id));
      const currentNodeLookup = new Map<string, GroupEndpointNodeInfo>(
        currentNodes.map((node) => [
          node.id,
          { id: node.id, type: node.type, parentId: node.parentId },
        ])
      );
      const pasteTargetGroup = findGroupAtPoint(base, currentNodes);

      // 1) Build "raw" nodes in their final positions but with ORIGINAL IDs.
      //    The utility will remap ids/parentId and edges in one pass.
      const rawNodes: FlowNode[] = copied.map((c) => {
        const parentIncluded = !!(c.parentId && copiedLookup.has(c.parentId));
        const adoptIntoPasteTarget =
          !!pasteTargetGroup && !parentIncluded && c.type !== "shadcnGroup";
        const absolutePosition = {
          x: base.x + (c.absX - minX),
          y: base.y + (c.absY - minY),
        };
        const position = parentIncluded
          ? // child of a copied group: position relative to parent
            (() => {
              const p = copiedLookup.get(c.parentId!)!;
              return { x: c.absX - p.absX, y: c.absY - p.absY };
            })()
          : adoptIntoPasteTarget
            ? {
                x: absolutePosition.x - pasteTargetGroup.abs.x,
                y: absolutePosition.y - pasteTargetGroup.abs.y,
              }
          : // top-level: translate to base cursor with same offset as during copy
            absolutePosition;

        return {
          id: c.id, // keep original for now; will be renamed as a batch
          type: c.type as FlowNode["type"],
          data: c.data,
          width: c.width,
          height: c.height,
          parentId: parentIncluded
            ? c.parentId
            : adoptIntoPasteTarget
              ? pasteTargetGroup.node.id
              : undefined,
          extent:
            parentIncluded || adoptIntoPasteTarget ? "parent" : undefined,
          position,
          dragHandle:
            c.dragHandle ??
            (c.type === "shadcnGroup" ? "[data-drag-handle]" : undefined),
          selected: true,
        } as FlowNode;
      });

      // 2) Stable batch-rename + edge remap (handles included); always rename on paste.
      const {
        nodes: newNodes,
        edges: newEdges,
        idMap,
      } = importWithFreshIds<
        FlowNode,
        Edge
      >({
        currentNodes,
        currentEdges,
        importNodes: rawNodes,
        importEdges: edgesToImport as Edge[],
        dedupeEdges: true,
        renameMode: "collision",
      });
      const remappedNewNodes = remapGroupBundlePortOffsetsInNodes(
        newNodes,
        copiedLookup,
        edgesToImport,
        idMap,
        currentNodeLookup
      );

      // Defensive: keep internal pasted edges, plus incoming edges only when the
      // user explicitly chooses that paste mode and the source still exists.
      const newNodeIdSet = new Set(remappedNewNodes.map((n) => n.id));
      const filteredEdges = newEdges.filter((edge) => {
        const sourceIsPasted = newNodeIdSet.has(edge.source);
        const targetIsPasted = newNodeIdSet.has(edge.target);
        if (sourceIsPasted && targetIsPasted) return true;
        return (
          includeIncomingConnections &&
          !sourceIsPasted &&
          targetIsPasted &&
          currentNodeIdSet.has(edge.source)
        );
      });

      // Copy cached script steps to freshly minted node ids
      copied.forEach((info) => {
        if (!info.scriptSteps) return;
        const mappedId = idMap.get(info.id);
        if (!mappedId) return;
        setScriptSteps(mappedId, cloneScriptSteps(info.scriptSteps));
      });

      // 3) Ensure groups come first (so children can adopt immediately)
      const ordered = [
        ...remappedNewNodes.filter((n) => n.type === "shadcnGroup"),
        ...remappedNewNodes.filter((n) => n.type !== "shadcnGroup"),
      ];

      // 4) Deselect existing, then append
      setNodes((existing) => {
        const combined = [
          ...existing.map((n) => ({ ...n, selected: false })),
          ...ordered,
        ];
        return pasteTargetGroup
          ? fitGroupToChildrenInNodes(combined, pasteTargetGroup.node.id)
          : combined;
      });
      setEdges((existing) => [...existing, ...filteredEdges]);

      log("copyPaste", "Pasted", {
        nodes: ordered.length,
        edges: filteredEdges.length,
      });
    },
    [
      copiedContent,
      getClipboardNodes,
      getClipboardEdges,
      getEdges,
      getNodes,
      setNodes,
      setEdges,
    ]
  );

  return {
    copyNodes,
    pasteNodes,
    handleMouseMove,
    /** for TopBar “Paste here” feature */
    getTopLeftPosition,
    hasCopiedNodes: !!copiedContent,
  };
}
