// src/hooks/useNodeOperations.ts
// ════════════════════════════════════════════════════════════════════════
// Single hook that owns ALL local editing behaviour for the flow canvas.
//
// 1.  STATE  – nodes / edges (React-Flow controlled), RF instance, misc refs.
// 2.  PURE HELPERS
//        • randomId                → short random string
//        • placeFlowDataAtPosition → drop full template at mouse position
//        • attemptToParentNode     → handle "locked" group ↔ child relation
//        • fitGroupToChildren      → auto-resize groups to fit their children
// 3.  CALLBACKS grouped roughly by feature
//        • createNode               (Drag-in palette node)
//        • onConnect                (new cable)
//        • DnD: onDrop, onNodeDragStop
//        • grouping helpers         (group / ungroup)
//        • onNodes/Edges change     (wrap RF callbacks)
// 4.  HOOK RETURN: everything the UI layer needs.
//
// Behaviour notes ---------------------------------------------------------
// • A node gains `parentId` when created/dropped _inside_ a "shadcnGroup".
//   That link stays until the user explicitly ungroups; geometry checks
//   that used to auto-eject the child were removed → "locked" groups.
// • `extent: 'parent' as const`  keeps TS happy (`'parent'` literal type).
// • Groups automatically expand to fit their children (never shrink).
// ════════════════════════════════════════════════════════════════════════

import { useState, useCallback, useRef, useMemo } from "react";
import {
  useNodesState,
  useEdgesState,
  ReactFlowInstance,
  Connection,
  NodeChange,
  EdgeChange,
  NodeRemoveChange,
  Edge,
} from "@xyflow/react";

import { defaultNodes, defaultEdges } from "@/components/initial-nodes";
import type {
  FlowNode,
  FlowData,
  CalculationNodeData,
  ProtocolDiagramLayout,
} from "@/types";
import { log } from "@/lib/logConfig";
import { importWithFreshIds } from "@/lib/idUtils";
import { ingestScriptSteps, removeScriptSteps } from "@/lib/share/scriptStepsCache";
import { isFlowFileCandidate, isRecord } from "@/lib/flow/guards";
import {
  collectGroupNodeIds,
  mergeProtocolDiagramLayout,
  protocolDiagramLayoutEquals,
  remapProtocolDiagramLayout,
  sanitizeProtocolDiagramLayout,
} from "@/lib/protocolDiagram/layoutPersistence";

/* ------------------------------------------------------------------ */
/*  Types & tiny utils                                                */
/* ------------------------------------------------------------------ */
type RF = ReactFlowInstance<FlowNode, Edge> & {
  updateNodeInternals?: (id: string) => void;
};
const randomId = () => Math.random().toString(36).slice(2, 9);
const GROUP_PADDING = 32;

type PaletteDragData = {
  type?: string;
  functionName?: string;
  nodeData?: Record<string, unknown> & {
    flowData?: FlowData;
  };
};

/* ------------------------------------------------------------------ */
/*  Helper – drop a whole template flow at mouse position             */
/* ------------------------------------------------------------------ */
function placeFlowDataAtPosition(
  flowData: FlowData,
  dropX: number,
  dropY: number
) {
  if (!flowData.nodes.length) return { nodes: [], edges: [] };

  // 1) Find the “anchor” (top-left among top-level nodes if they exist)
  const EPS = 4;
  const topLevelNodes = flowData.nodes.filter((n) => !n.parentId);
  const hasTopLevel = topLevelNodes.length > 0;
  const nodesToConsider = hasTopLevel ? topLevelNodes : flowData.nodes;

  const minY = Math.min(...nodesToConsider.map((n) => n.position.y));
  const anchor = nodesToConsider
    .filter((n) => Math.abs(n.position.y - minY) < EPS)
    .reduce((left, n) => (n.position.x < left.position.x ? n : left));

  const dx = dropX - anchor.position.x;
  const dy = dropY - anchor.position.y;

  // 2) Translate positions ONLY (keep original IDs)
  const translated = flowData.nodes.map((old) => {
    const pos =
      !old.parentId || !hasTopLevel
        ? { x: old.position.x + dx, y: old.position.y + dy }
        : old.position;
    return { ...old, position: pos, selected: true };
  });

  // 3) Edges unchanged (IDs unchanged here; we’ll rewrite IDs later if needed)
  return { nodes: translated, edges: flowData.edges };
}

/* ------------------------------------------------------------------ */
/**
 * Enlarges a "shadcnGroup" so all children fit, **without moving the group**.
 * If a child is left / above the current origin we *shift all children* by the
 * same delta.  That keeps their relative geometry intact.
 */
/* ------------------------------------------------------------------ */
function fitGroupToChildren(
  groupId: string,
  rf: RF | null,
  setNodes: (fn: (n: FlowNode[]) => FlowNode[]) => void
) {
  if (!rf) return;

  setNodes((nodes) => {
    const group = nodes.find(
      (n) => n.id === groupId && n.type === "shadcnGroup"
    );
    if (!group) return nodes;

    const children = nodes.filter((n) => n.parentId === groupId);
    if (!children.length) return nodes;

    // --- 1 · bounding box of children ----------------------------
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    children.forEach((child) => {
      const w =
        child.measured?.width ?? child.width ?? child.data?.width ?? 250;
      const h =
        child.measured?.height ?? child.height ?? child.data?.height ?? 150;
      minX = Math.min(minX, child.position.x);
      minY = Math.min(minY, child.position.y);
      maxX = Math.max(maxX, child.position.x + w);
      maxY = Math.max(maxY, child.position.y + h);
    });

    // --- 2 · how much must we grow / shift? ----------------------
    const shiftX = Math.max(0, GROUP_PADDING - minX);
    const shiftY = Math.max(0, GROUP_PADDING - minY);

    const newWidth = Math.max(
      group.data?.width ?? 300,
      maxX + shiftX + GROUP_PADDING
    );
    const newHeight = Math.max(
      group.data?.height ?? 200,
      maxY + shiftY + GROUP_PADDING
    );

    if (
      shiftX === 0 &&
      shiftY === 0 &&
      newWidth === (group.data?.width ?? 300) &&
      newHeight === (group.data?.height ?? 200)
    ) {
      return nodes; // nothing to do
    }

    // --- 3 · apply ------------------------------------------------
    return nodes.map((n) => {
      if (n.id === groupId) {
        return {
          ...n,
          data: { ...n.data, width: newWidth, height: newHeight },
        };
      }
      if (n.parentId === groupId) {
        return {
          ...n,
          position: { x: n.position.x + shiftX, y: n.position.y + shiftY },
        };
      }
      return n;
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Main hook                                                         */
/* ------------------------------------------------------------------ */
interface UseNodeOperationsOptions {
  getProtocolDiagramLayout?: () => ProtocolDiagramLayout | undefined;
  setProtocolDiagramLayout?: (layout: ProtocolDiagramLayout | undefined) => void;
}

export function useNodeOperations(options: UseNodeOperationsOptions = {}) {
  const { getProtocolDiagramLayout, setProtocolDiagramLayout } = options;

  /* ─ State / refs ──────────────────────────────────────────────── */
  const initialNodes = useMemo(
    () =>
      ingestScriptSteps(
        defaultNodes.map((node) => ({
          ...node,
          data: node.data ? { ...node.data } : node.data,
        }))
      ),
    []
  );

  const [nodes, setNodes, onNodesChange] =
    useNodesState<FlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);
  const [rf, setRF] = useState<RF | null>(null);

  // node IDs waiting for first "dimensions" event
  const pendingIds = useRef<Set<string>>(new Set());
  // track which groups need resizing after operations
  const groupsToResize = useRef<Set<string>>(new Set());

  /* ─ Helpers bound to current nodes array ─────────────────────── */
  const getNodesLocal = useCallback(() => nodes, [nodes]);

  const onInit = useCallback(
    (inst: RF) => {
      setRF(inst);

      const allNodes = inst.getNodes() as FlowNode[];

      // Only mark nodes that need parent checking (not already parented, not groups)
      allNodes.forEach((node) => {
        if (!node.parentId && node.type !== "shadcnGroup") {
          pendingIds.current.add(node.id);
        }
      });

      // Resize existing groups with children
      const groups = allNodes.filter((n) => n.type === "shadcnGroup");
      groups.forEach((group) => {
        const hasChildren = allNodes.some((n) => n.parentId === group.id);
        if (hasChildren) {
          fitGroupToChildren(group.id, inst, setNodes);
        }
      });
    },
    [setNodes]
  );

  /* ────────────────────────────────────────────────────────────────────── */
  /*  attemptToParentNode – adopt single node into nearest group     */
  /* ────────────────────────────────────────────────────────────────────── */
  const attemptToParentNode = useCallback(
    (
      nodeId: string,
      rf: RF | null,
      getNodes: () => FlowNode[],
      setNodes: (fn: (n: FlowNode[]) => FlowNode[]) => void
    ) => {
      if (!rf) return;

      const all = getNodes();
      const child = all.find((n) => n.id === nodeId);
      if (!child || child.type === "shadcnGroup") return;

      if (child.parentId) return;

      // Exclude any selected groups from being valid targets
      const selectedGroupIds = new Set(
        all
          .filter((n) => n.selected && n.type === "shadcnGroup")
          .map((n) => n.id)
      );

      // Use measured size if available, then width/height, then a sensible fallback
      const childAbs = child.positionAbsolute ?? child.position;
      const bbox = {
        x: childAbs.x,
        y: childAbs.y,
        width: child.measured?.width ?? child.width ?? 40,
        height: child.measured?.height ?? child.height ?? 40,
      };

      const groups = (rf.getIntersectingNodes(bbox) as FlowNode[]).filter(
        (g) =>
          g.type === "shadcnGroup" &&
          g.id !== child.id &&
          !selectedGroupIds.has(g.id)
      );

      if (!groups.length) return;

      const childCenter = {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
      };

      const best = groups.reduce<
        { node: FlowNode; dist: number } | null
      >((winner, candidate) => {
        const width = candidate.data?.width ?? 300;
        const height = candidate.data?.height ?? 200;
        const candidateAbs = candidate.positionAbsolute ?? candidate.position;
        const cx = candidateAbs.x + width / 2;
        const cy = candidateAbs.y + height / 2;
        const dist = Math.hypot(childCenter.x - cx, childCenter.y - cy);
        if (!winner || dist < winner.dist) {
          return { node: candidate, dist };
        }
        return winner;
      }, null);

      const group = best?.node;
      if (!group) return;
      if (child.parentId === group.id) return; // already in this group

      // ---- ABSOLUTE → RELATIVE TRANSFORM (prevents "jumping") ----
      let absX = childAbs.x;
      let absY = childAbs.y;
      if (child.parentId) {
        const oldParent = all.find((p) => p.id === child.parentId);
        if (oldParent) {
          const oldParentAbs =
            oldParent.positionAbsolute ?? oldParent.position;
          absX = oldParentAbs.x + child.position.x;
          absY = oldParentAbs.y + child.position.y;
        }
      }
      const groupAbs = group.positionAbsolute ?? group.position;
      const relX = absX - groupAbs.x;
      const relY = absY - groupAbs.y;

      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId && n.type !== "shadcnGroup"
            ? {
                ...n,
                parentId: group.id,
                extent: "parent" as const,
                position: { x: relX, y: relY },
              }
            : n
        )
      );

      // Defer until state is committed & internals updated
      requestAnimationFrame(() => {
        rf.updateNodeInternals?.(group.id);
        requestAnimationFrame(() => fitGroupToChildren(group.id, rf, setNodes));
      });
    },
    []
  );

  /* ─────────────────────────────────────────────────────────────── */
  /* 1.  Create a single node (palette drag-in)                      */
  /* ─────────────────────────────────────────────────────────────── */
  const createNode = useCallback(
    (type: string, dragData: PaletteDragData, pos: { x: number; y: number }) => {
      const newId = `node_${randomId()}`;
      const nodeDefaults = {
        ...(dragData.nodeData ?? {}),
      };
      delete (nodeDefaults as { flowData?: unknown }).flowData;

      const newNode: FlowNode = {
        id: newId,
        type,
        position: pos,
        data: nodeDefaults as CalculationNodeData,
        selected: true,
        ...(type === "shadcnGroup"
          ? { dragHandle: "[data-drag-handle]" } // ★ only groups
          : {}),
      };

      const [sanitizedNode] = ingestScriptSteps([newNode]);

      setNodes((nds) => {
        const deselect = nds.map((n) => ({ ...n, selected: false }));
        return type === "shadcnGroup"
          ? [sanitizedNode, ...deselect]
          : [...deselect, sanitizedNode];
      });

      pendingIds.current.add(newId);
      return sanitizedNode;
    },
    [setNodes]
  );

  /* ─────────────────────────────────────────────────────────────── */
  /* 2.  Cable creation                                              */
  /* ─────────────────────────────────────────────────────────────── */
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      const duplicate = edges.some(
        (e) => e.target === c.target && e.targetHandle === c.targetHandle
      );
      if (duplicate) return;

      setEdges((eds) => [
        ...eds,
        {
          id: `edge_${randomId()}`,
          source: c.source,
          target: c.target,
          sourceHandle: c.sourceHandle,
          targetHandle: c.targetHandle,
        },
      ]);

      // mark target node dirty so backend recalculates
      setNodes((nds) =>
        nds.map((n) =>
          n.id === c.target ? { ...n, data: { ...n.data, dirty: true } } : n
        )
      );
    },
    [edges, setEdges, setNodes]
  );

  /* ─────────────────────────────────────────────────────────────── */
  /* 3.  Drag-&-Drop handlers (canvas)                               */
  /* ─────────────────────────────────────────────────────────────── */
  // In useNodeOperations.ts, update the onDrop function:

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!rf) return;

      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      if (!isRecord(parsed)) return;

      const data = parsed as PaletteDragData;
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });

      // Whole template flow?
      const maybeFlowData = data.nodeData?.flowData;
      if (
        data.functionName === "flow_template" &&
        maybeFlowData &&
        isFlowFileCandidate(maybeFlowData)
      ) {
        // ① translate the incoming flow to the drop position (no id changes)
        const translated = placeFlowDataAtPosition(
          maybeFlowData as FlowData,
          pos.x,
          pos.y
        );

        // ② run the stable-id merge (only rename on conflicts)
        const {
          nodes: sub,
          edges: subE,
          idMap,
        } = importWithFreshIds<FlowNode, Edge>({
          currentNodes: rf.getNodes(),
          currentEdges: rf.getEdges(),
          importNodes: translated.nodes,
          importEdges: translated.edges,
          dedupeEdges: true,
          renameMode: "collision", // preserve IDs unless there is a collision
        });

        const sanitizedSub = ingestScriptSteps(sub);

        const currentNodes = rf.getNodes() as FlowNode[];
        const nextNodes = [...currentNodes, ...sanitizedSub];
        const importedLayout = sanitizeProtocolDiagramLayout(
          (maybeFlowData as FlowData).protocolDiagramLayout,
          collectGroupNodeIds((maybeFlowData as FlowData).nodes)
        );
        const remappedLayout = remapProtocolDiagramLayout(
          importedLayout,
          idMap,
          collectGroupNodeIds(nextNodes)
        );
        const currentLayout = sanitizeProtocolDiagramLayout(
          getProtocolDiagramLayout?.(),
          collectGroupNodeIds(currentNodes)
        );
        const mergedLayout = mergeProtocolDiagramLayout(
          currentLayout,
          remappedLayout
        );
        if (!protocolDiagramLayoutEquals(currentLayout, mergedLayout)) {
          setProtocolDiagramLayout?.(mergedLayout);
        }

        // ③ append to canvas
        setNodes((nds) => [...nds, ...sanitizedSub]);
        setEdges((eds) => [...eds, ...subE]);

        // ④ downstream: adopt parenting + resize groups (unchanged)
        sanitizedSub.forEach((n) => {
          pendingIds.current.add(n.id);
          if (n.parentId) groupsToResize.current.add(n.parentId);
        });

        groupsToResize.current.forEach((groupId) => {
          // Defer until state is committed & internals updated
          requestAnimationFrame(() => {
            rf.updateNodeInternals?.(groupId);
            requestAnimationFrame(() =>
              fitGroupToChildren(groupId, rf, setNodes)
            );
          });
        });
        groupsToResize.current.clear();

        return;
      }

      // Single palette node
      if (typeof data.type === "string") {
        createNode(data.type, data, pos);
      }
    },
    [
      rf,
      createNode,
      setNodes,
      setEdges,
      getProtocolDiagramLayout,
      setProtocolDiagramLayout,
    ]
  );

  // While dragging nodes inside a group, re-evaluate parent adoption
  // inside useNodeOperations.ts

  const onNodeDragStop = useCallback(
    (evt: React.MouseEvent) => {
      if (!rf) return;

      const allNodes = rf.getNodes() as FlowNode[];
      if (!allNodes.length) return;

      const selected = allNodes.filter((n) => n.selected);
      if (!selected.length) return;

      const parentsNeedingResize = new Set<string>();
      selected.forEach((n) => {
        if (n.parentId) parentsNeedingResize.add(n.parentId);
      });

      const adoptable = selected.filter(
        (n) => n.type !== "shadcnGroup" && !n.parentId
      );
      const selectedGroupIds = new Set(
        selected.filter((n) => n.type === "shadcnGroup").map((n) => n.id)
      );

      if (adoptable.length) {
        const pointer = rf.screenToFlowPosition({
          x: evt.clientX,
          y: evt.clientY,
        });

        const pointerGroup = allNodes.find((node) => {
          if (node.type !== "shadcnGroup" || selectedGroupIds.has(node.id)) {
            return false;
          }
          const width = node.data?.width ?? 300;
          const height = node.data?.height ?? 200;
          const nodeAbs = node.positionAbsolute ?? node.position;
          return (
            pointer.x >= nodeAbs.x &&
            pointer.x <= nodeAbs.x + width &&
            pointer.y >= nodeAbs.y &&
            pointer.y <= nodeAbs.y + height
          );
        });

        if (pointerGroup) {
          const groupId = pointerGroup.id;
          const groupAbs =
            pointerGroup.positionAbsolute ?? pointerGroup.position;

          const relativePositions = new Map<string, { x: number; y: number }>();
          adoptable.forEach((node) => {
            const nodeAbs = node.positionAbsolute ?? node.position;
            relativePositions.set(node.id, {
              x: nodeAbs.x - groupAbs.x,
              y: nodeAbs.y - groupAbs.y,
            });
          });

          if (relativePositions.size) {
            parentsNeedingResize.add(groupId);
            setNodes((nodesState) =>
              nodesState.map((node) => {
                const rel = relativePositions.get(node.id);
                if (!rel) return node;
                return {
                  ...node,
                  parentId: groupId,
                  extent: "parent" as const,
                  position: rel,
                };
              })
            );
          }
        }
      }

      if (!parentsNeedingResize.size) return;

      const parents = Array.from(parentsNeedingResize);
      requestAnimationFrame(() => {
        parents.forEach((parentId) => {
          rf.updateNodeInternals?.(parentId);
          requestAnimationFrame(() =>
            fitGroupToChildren(parentId, rf, setNodes)
          );
        });
      });
    },
    [rf, setNodes]
  );

  /* ─────────────────────────────────────────────────────────────── */
  /* 4.  Group / ungroup helpers                                     */
  /* ─────────────────────────────────────────────────────────────── */
  const groupSelectedNodes = useCallback(() => {
    if (!rf) return false;

    const all = rf.getNodes() as FlowNode[];
    const sel = all.filter(
      (n) => n.selected && !n.parentId && n.type !== "shadcnGroup"
    );
    if (sel.length < 1) return false;

    const bounds = rf.getNodesBounds(sel);
    const margin = 60;
    const groupId = `group_${randomId()}`;

    log(
      "nodeOperations",
      `Creating group ${groupId} for ${sel.length} selected nodes`
    );

    const groupNode: FlowNode = {
      id: groupId,
      type: "shadcnGroup",
      position: { x: bounds.x - margin, y: bounds.y - margin },
      dragHandle: "[data-drag-handle]",
      data: {
        isGroup: true,
        width: bounds.width + margin * 2,
        height: bounds.height + margin * 2,
        title: "Group Node",
      },
      selected: false,
    };

    setNodes((nds) => [
      groupNode,
      ...nds.map((n) => {
        if (sel.some((s) => s.id === n.id)) {
          return {
            ...n,
            parentId: groupId,
            extent: "parent" as const,
            position: {
              x: n.position.x - (bounds.x - margin),
              y: n.position.y - (bounds.y - margin),
            },
            selected: false,
          };
        }
        return { ...n, selected: false };
      }),
    ]);

    // The group is already correctly sized from initial creation,
    // but we'll ensure it fits in case any nodes have non-standard sizes
    requestAnimationFrame(() => fitGroupToChildren(groupId, rf, setNodes));

    return true;
  }, [rf, setNodes]);

  /* ─────────────────────────────────────────────────────────────── */
  /*     ** UPDATED:  supports whole-group and partial ungroup **    */
  /* ─────────────────────────────────────────────────────────────── */
  const ungroupSelectedNodes = useCallback(() => {
    if (!rf) return false;

    const all = rf.getNodes() as FlowNode[];
    const selected = all.filter((n) => n.selected);

    const ungroupGroups = (groups: FlowNode[]) => {
      const gidSet = new Set(groups.map((g) => g.id));

      log(
        "nodeOperations",
        `Ungrouping ${groups.length} groups`,
        { groupIds: Array.from(gidSet) }
      );

      setNodes((nds) =>
        nds.flatMap((n) => {
          /* remove the group node itself */
          if (gidSet.has(n.id)) return [];

          /* lift every child of any selected group */
          if (n.parentId && gidSet.has(n.parentId)) {
            const parent = all.find((p) => p.id === n.parentId);
            const absPos = parent
              ? {
                  x: parent.position.x + n.position.x,
                  y: parent.position.y + n.position.y,
                }
              : n.position;

            return [
              {
                ...n,
                parentId: undefined,
                extent: undefined,
                position: absPos,
                selected: true,
              },
            ];
          }

          return [n];
        })
      );

      return true;
    };

    /* ① Whole-group ungroup for explicitly selected groups */
    const selectedGroups = selected.filter((n) => n.type === "shadcnGroup");
    if (selectedGroups.length) {
      return ungroupGroups(selectedGroups);
    }

    /* ② Partial ungroup – only selected children leave their parent */
    const childrenToUngroup = selected.filter((n) => n.parentId);
    if (childrenToUngroup.length) {
      // Track parent groups that may need resizing after ungrouping
      const parentsToResize = new Set<string>();
      childrenToUngroup.forEach((n) => {
        if (n.parentId) parentsToResize.add(n.parentId);
      });

      log(
        "nodeOperations",
        `Partial ungroup: removing ${childrenToUngroup.length} children from their parents`,
        { parentIds: Array.from(parentsToResize) }
      );

      setNodes((nds) =>
        nds.map((n) => {
          if (!n.selected || !n.parentId) return n;

          const parent = all.find((p) => p.id === n.parentId);
          const absPos = parent
            ? {
                x: parent.position.x + n.position.x,
                y: parent.position.y + n.position.y,
              }
            : n.position;

          return {
            ...n,
            parentId: undefined,
            extent: undefined,
            position: absPos,
            selected: true,
          };
        })
      );

      // Optionally resize parent groups if they still have children
      // (Though with only-expand logic, this won't shrink them)
      requestAnimationFrame(() => {
        parentsToResize.forEach((parentId) => {
          fitGroupToChildren(parentId, rf, setNodes);
        });
      });

      return true;
    }

    /* ③ Fallback whole-group ungroup when no explicit selection is present */
    let fallbackGroups: FlowNode[] = [];
    const activeEl =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    const focusedGroupId =
      activeEl?.closest(".react-flow__node-shadcnGroup")?.getAttribute("data-id") ??
      null;
    if (focusedGroupId) {
      const focusedGroup = all.find(
        (node) => node.id === focusedGroupId && node.type === "shadcnGroup"
      );
      if (focusedGroup) {
        fallbackGroups = [focusedGroup];
      }
    }

    if (!fallbackGroups.length) {
      const allGroups = all.filter((node) => node.type === "shadcnGroup");
      if (allGroups.length === 1) {
        fallbackGroups = [allGroups[0]];
      }
    }

    if (fallbackGroups.length) {
      return ungroupGroups(fallbackGroups);
    }

    return false;
  }, [rf, setNodes]);

  /* ─────────────────────────────────────────────────────────────── */
  /* 5.  Wrapped onChange handlers                                   */
  /* ─────────────────────────────────────────────────────────────────── */
  const onNodesChangeWithPending = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      onNodesChange(changes);

      const groupsNeedingResize = new Set<string>();

      changes.forEach((c) => {
        if (c.type === "dimensions") {
          // Only resize parent group when dimensions are first reported (initial creation)
          if (pendingIds.current.has(c.id)) {
            const node = getNodesLocal().find((n) => n.id === c.id);
            if (node?.parentId) {
              groupsNeedingResize.add(node.parentId);
            }
            attemptToParentNode(c.id, rf, getNodesLocal, setNodes);
            pendingIds.current.delete(c.id);
          }
        } else if (
          c.type === "position" &&
          "dragging" in c &&
          c.dragging === false
        ) {
          // Drag finished → check whether the node should now belong to a group
          attemptToParentNode(c.id, rf, getNodesLocal, setNodes);
        } else if (c.type === "remove") {
          const removedId = (c as NodeRemoveChange).id;
          pendingIds.current.delete(removedId);
          removeScriptSteps(removedId);
        }
        // Removed position change handler - we don't want to resize on drag
      });

      // Resize groups immediately (dims are already available)
      if (groupsNeedingResize.size > 0 && rf) {
        groupsNeedingResize.forEach((groupId) => {
          fitGroupToChildren(groupId, rf, setNodes);
        });
      }
    },
    [onNodesChange, rf, getNodesLocal, setNodes, attemptToParentNode]
  );

  const onEdgesChangeWithLogging = useCallback(
    (c: EdgeChange[]) => onEdgesChange(c),
    [onEdgesChange]
  );

  /* ─────────────────────────────────────────────────────────────── */
  /* 6.  Hook return                                                 */
  /* ─────────────────────────────────────────────────────────────── */
  return {
    /* state */
    nodes,
    setNodes,
    edges,
    setEdges,

    /* RF instance binding */
    onInit,

    /* canvas event handlers */
    onNodesChange: onNodesChangeWithPending,
    onEdgesChange: onEdgesChangeWithLogging,
    onConnect,
    onDrop,
    onNodeDragStop,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },

    /* grouping helpers */
    groupSelectedNodes,
    ungroupSelectedNodes,

    /* group / ungroup button enable logic (UPDATED) */
    canGroupSelectedNodes: () =>
      rf
        ? rf
            .getNodes()
            .filter(
              (n) => n.selected && !n.parentId && n.type !== "shadcnGroup"
            ).length >= 1
        : false,
    canUngroupSelectedNodes: () =>
      rf
        ? rf
            .getNodes()
            .some(
              (n) =>
                n.selected && (n.type === "shadcnGroup" || Boolean(n.parentId))
            )
          || rf.getNodes().filter((n) => n.type === "shadcnGroup").length === 1
        : false,
  };
}
