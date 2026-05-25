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
  minX: number;
  minY: number;
};

type UseCopyPasteOptions = {
  getClipboardNodes?: () => FlowNode[];
  getClipboardEdges?: () => Edge[];
};

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

const copiedNodeGroupEndpoint = (
  nodeId: string,
  copiedLookup: Map<string, CopiedNodeInfo>
): string | undefined => {
  const node = copiedLookup.get(nodeId);
  if (!node) return undefined;
  if (node.type === "shadcnGroup") return node.id;
  const parent = node.parentId ? copiedLookup.get(node.parentId) : undefined;
  return parent?.type === "shadcnGroup" ? parent.id : undefined;
};

const buildCopiedGroupBundleIdMap = (
  copiedLookup: Map<string, CopiedNodeInfo>,
  copiedEdges: Edge[],
  idMap: Map<string, string>
): Map<string, string> => {
  const bundleIdMap = new Map<string, string>();

  copiedEdges.forEach((edge) => {
    const sourceGroupId = copiedNodeGroupEndpoint(edge.source, copiedLookup);
    const targetGroupId = copiedNodeGroupEndpoint(edge.target, copiedLookup);
    if (!sourceGroupId || !targetGroupId || sourceGroupId === targetGroupId) {
      return;
    }

    const nextSourceGroupId = idMap.get(sourceGroupId);
    const nextTargetGroupId = idMap.get(targetGroupId);
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
  idMap: Map<string, string>
): FlowNode[] => {
  const bundleIdMap = buildCopiedGroupBundleIdMap(
    copiedLookup,
    copiedEdges,
    idMap
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

    const idSet = new Set(finalNodes.map((n) => n.id));
    const relevantEdges = allEdges.filter(
      (e) => idSet.has(e.source) && idSet.has(e.target)
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

    setCopiedContent({ nodes: nodeInfos, edges: relevantEdges, minX, minY });
    log("copyPaste", "Copied selection", {
      nodes: nodeInfos.length,
      edges: relevantEdges.length,
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
    (pos?: XYPosition) => {
      if (!copiedContent) {
        log("copyPaste", "Nothing in clipboard");
        return;
      }

      const { nodes: copied, edges: copiedEdges, minX, minY } = copiedContent;

      // Base cursor position (or last mouse move) for top-level placement
      const base = pos ?? mousePosRef.current;

      // Quick lookup: was a node's parent included in the copied set?
      const copiedLookup = new Map(copied.map((c) => [c.id, c]));

      // 1) Build "raw" nodes in their final positions but with ORIGINAL IDs.
      //    The utility will remap ids/parentId and edges in one pass.
      const rawNodes: FlowNode[] = copied.map((c) => {
        const parentIncluded = !!(c.parentId && copiedLookup.has(c.parentId));
        const position = parentIncluded
          ? // child of a copied group: position relative to parent
            (() => {
              const p = copiedLookup.get(c.parentId!)!;
              return { x: c.absX - p.absX, y: c.absY - p.absY };
            })()
          : // top-level: translate to base cursor with same offset as during copy
            { x: base.x + (c.absX - minX), y: base.y + (c.absY - minY) };

        return {
          id: c.id, // keep original for now; will be renamed as a batch
          type: c.type as FlowNode["type"],
          data: c.data,
          width: c.width,
          height: c.height,
          parentId: parentIncluded ? c.parentId : undefined,
          extent: parentIncluded ? "parent" : undefined,
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
        currentNodes: (getClipboardNodes?.() ?? getNodes()) as FlowNode[],
        currentEdges: sanitizeGroupBundleRenderEdgesForState(
          (getClipboardEdges?.() ?? getEdges()) as Edge[]
        ),
        importNodes: rawNodes,
        importEdges: copiedEdges as Edge[],
        dedupeEdges: true,
        renameMode: "collision",
      });
      const remappedNewNodes = remapGroupBundlePortOffsetsInNodes(
        newNodes,
        copiedLookup,
        copiedEdges,
        idMap
      );

      // Defensive: ensure we only keep edges that connect within the pasted set.
      const newNodeIdSet = new Set(remappedNewNodes.map((n) => n.id));
      const filteredEdges = newEdges.filter(
        (e) => newNodeIdSet.has(e.source) && newNodeIdSet.has(e.target)
      );

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
      setNodes((existing) => [
        ...existing.map((n) => ({ ...n, selected: false })),
        ...ordered,
      ]);
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
