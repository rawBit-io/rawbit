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
import type { FlowNode, FlowData, CalculationNodeData } from "@/types";
import { log } from "@/lib/logConfig";
import { importWithFreshIds } from "@/lib/idUtils";
import {
  ingestScriptSteps,
  removeScriptSteps,
} from "@/lib/share/scriptStepsCache";
import { isFlowFileCandidate, isRecord } from "@/lib/flow/guards";
import { isCalculableNode } from "@/lib/flow/nonCalculableNodes";
import {
  sanitizeGroupBundleRenderEdgesForState,
  sanitizeGroupBundleVisualElementsForState,
  stripGroupBundlePortNodes,
} from "@/lib/flow/groupEdgeBundling";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";
import {
  FLOW_TEMPLATE_DROP_ZOOM,
  getFlowTemplateViewport,
  placeFlowDataAtPosition,
} from "@/lib/flow/placeFlowTemplate";
import {
  absolutePositionOf,
  buildGroupMaps,
  isDescendantOf,
  nestingDepthOf,
  orderNodesParentsFirst,
} from "@/lib/flow/groupNesting";
import { fitGroupAndAncestorsInNodes } from "@/lib/flow/groupSizing";

/* ------------------------------------------------------------------ */
/*  Types & tiny utils                                                */
/* ------------------------------------------------------------------ */
type RF = ReactFlowInstance<FlowNode, Edge> & {
  updateNodeInternals?: (id: string) => void;
};
const randomId = () => Math.random().toString(36).slice(2, 9);

type PaletteDragData = {
  type?: string;
  functionName?: string;
  nodeData?: Record<string, unknown> & {
    flowData?: FlowData;
  };
};

function getLocalDropPoint(event: React.DragEvent) {
  const target = event.currentTarget as unknown as {
    getBoundingClientRect?: () => { left: number; top: number };
  };
  const bounds = target?.getBoundingClientRect?.();
  return {
    x: bounds ? event.clientX - bounds.left : event.clientX,
    y: bounds ? event.clientY - bounds.top : event.clientY,
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getNodeDimension(
  node: FlowNode,
  axis: "width" | "height",
  fallback: number,
): number {
  return Math.max(
    finiteNumber(node.data?.[axis]) ?? 0,
    finiteNumber(node[axis]) ?? 0,
    finiteNumber(node.measured?.[axis]) ?? 0,
    fallback,
  );
}

/**
 * Absolute canvas position of a node, accumulated over its whole parent
 * chain (a single-level offset is wrong for children of nested groups).
 */
function getAbsoluteNodePosition(node: FlowNode, all: FlowNode[]) {
  let x = node.position.x;
  let y = node.position.y;
  const seen = new Set<string>([node.id]);
  let parentId = node.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = all.find((p) => p.id === parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

function scheduleNodeInternalsUpdate(rf: RF, ids: string[]) {
  const update = rf.updateNodeInternals;
  if (!update) return;
  const run = () => ids.forEach((id) => update(id));
  if (typeof requestAnimationFrame !== "function") {
    run();
    return;
  }
  requestAnimationFrame(run);
}

/* ------------------------------------------------------------------ */
/**
 * Enlarges a "shadcnGroup" so all children fit, then cascades the fit up
 * the parent chain — a growing inner group may overflow its outer group.
 * Uses the shared origin-compensating fit (children keep their absolute
 * canvas position; the frame grows top-left, NB-05).
 */
/* ------------------------------------------------------------------ */
function fitGroupToChildren(
  groupId: string,
  rf: RF | null,
  setNodes: (fn: (n: FlowNode[]) => FlowNode[]) => void,
) {
  if (!rf) return;

  setNodes((nodes) => fitGroupAndAncestorsInNodes(nodes, groupId));

  scheduleNodeInternalsUpdate(rf, [groupId]);
}

/* ------------------------------------------------------------------ */
/*  Main hook                                                         */
/* ------------------------------------------------------------------ */
export function useNodeOperations() {
  /* ─ State / refs ──────────────────────────────────────────────── */
  const initialNodes = useMemo(
    () =>
      ingestScriptSteps(
        defaultNodes.map((node) => ({
          ...node,
          data: node.data ? { ...node.data } : node.data,
        })),
      ),
    [],
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

      const allNodes = stripGroupBundlePortNodes(inst.getNodes() as FlowNode[]);

      // Persisted top-level nodes are NOT queued for geometric group adoption
      // here: doing so silently re-grouped nodes the user had explicitly
      // ungrouped before saving. Adoption only applies to nodes created
      // in-session (createNode / onDrop populate pendingIds).

      // Resize existing groups with children
      const groups = allNodes.filter((n) => n.type === "shadcnGroup");
      groups.forEach((group) => {
        const hasChildren = allNodes.some((n) => n.parentId === group.id);
        if (hasChildren) {
          fitGroupToChildren(group.id, inst, setNodes);
        }
      });
    },
    [setNodes],
  );

  /* ────────────────────────────────────────────────────────────────────── */
  /*  attemptToParentNode – adopt single node into nearest group     */
  /* ────────────────────────────────────────────────────────────────────── */
  const attemptToParentNode = useCallback(
    (
      nodeId: string,
      rf: RF | null,
      getNodes: () => FlowNode[],
      setNodes: (fn: (n: FlowNode[]) => FlowNode[]) => void,
    ) => {
      if (!rf) return;

      const all = getNodes();
      const child = all.find((n) => n.id === nodeId);
      if (!child) return;

      if (child.parentId) return;

      const maps = buildGroupMaps(all);

      // Exclude any selected groups from being valid targets
      const selectedGroupIds = new Set(
        all
          .filter((n) => n.selected && n.type === "shadcnGroup")
          .map((n) => n.id),
      );

      // Use measured size if available, then width/height, then a sensible fallback
      const childAbs = child.positionAbsolute ?? child.position;
      const bbox = {
        x: childAbs.x,
        y: childAbs.y,
        width: getNodeDimension(child, "width", 40),
        height: getNodeDimension(child, "height", 40),
      };

      // Groups can adopt groups (nesting): the dragged node itself and its
      // own descendants are never valid targets (would create a cycle).
      const groups = (rf.getIntersectingNodes(bbox) as FlowNode[]).filter(
        (g) =>
          g.type === "shadcnGroup" &&
          g.id !== child.id &&
          !selectedGroupIds.has(g.id) &&
          !isDescendantOf(g.id, child.id, maps),
      );

      if (!groups.length) return;

      const childCenter = {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
      };

      // Prefer the INNERMOST candidate (deepest nesting), then the nearest
      // centre among equals.
      const best = groups.reduce<
        { node: FlowNode; dist: number; depth: number } | null
      >((winner, candidate) => {
        const width = getNodeDimension(candidate, "width", 300);
        const height = getNodeDimension(candidate, "height", 200);
        const candidateAbs =
          candidate.positionAbsolute ?? absolutePositionOf(candidate.id, maps);
        const cx = candidateAbs.x + width / 2;
        const cy = candidateAbs.y + height / 2;
        const dist = Math.hypot(childCenter.x - cx, childCenter.y - cy);
        const depth = nestingDepthOf(candidate.id, maps);
        if (
          !winner ||
          depth > winner.depth ||
          (depth === winner.depth && dist < winner.dist)
        ) {
          return { node: candidate, dist, depth };
        }
        return winner;
      }, null);

      const group = best?.node;
      if (!group) return;
      if (child.parentId === group.id) return; // already in this group

      // ---- ABSOLUTE → RELATIVE TRANSFORM (prevents "jumping") ----
      const absX = childAbs.x;
      const absY = childAbs.y;
      const groupAbs =
        group.positionAbsolute ?? absolutePositionOf(group.id, maps);
      const relX = absX - groupAbs.x;
      const relY = absY - groupAbs.y;

      setNodes((nds) =>
        orderNodesParentsFirst(
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  parentId: group.id,
                  extent: "parent" as const,
                  position: { x: relX, y: relY },
                }
              : n,
          ),
        ),
      );

      // Defer until state is committed & internals updated
      requestAnimationFrame(() => {
        rf.updateNodeInternals?.(nodeId);
        rf.updateNodeInternals?.(group.id);
        requestAnimationFrame(() => fitGroupToChildren(group.id, rf, setNodes));
      });
    },
    [],
  );

  /* ─────────────────────────────────────────────────────────────── */
  /* 1.  Create a single node (palette drag-in)                      */
  /* ─────────────────────────────────────────────────────────────── */
  const createNode = useCallback(
    (
      type: string,
      dragData: PaletteDragData,
      pos: { x: number; y: number },
    ) => {
      const newId = `node_${randomId()}`;
      const nodeDefaults = {
        ...(dragData.nodeData ?? {}),
      };
      delete (nodeDefaults as { flowData?: unknown }).flowData;
      const initialWidth = finiteNumber(nodeDefaults.width);
      const initialHeight = finiteNumber(nodeDefaults.height);

      const newNode: FlowNode = {
        id: newId,
        type,
        position: pos,
        data: nodeDefaults as CalculationNodeData,
        selected: true,
        ...(initialWidth !== undefined ? { width: initialWidth } : {}),
        ...(initialHeight !== undefined ? { height: initialHeight } : {}),
        ...(initialWidth !== undefined || initialHeight !== undefined
          ? {
              measured: {
                ...(initialWidth !== undefined ? { width: initialWidth } : {}),
                ...(initialHeight !== undefined ? { height: initialHeight } : {}),
              },
            }
          : {}),
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
    [setNodes],
  );

  /* ─────────────────────────────────────────────────────────────── */
  /* 2.  Cable creation                                              */
  /* ─────────────────────────────────────────────────────────────── */
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      const duplicate = edges.some(
        (e) => e.target === c.target && e.targetHandle === c.targetHandle,
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

      // mark target node dirty so backend recalculates (calculable targets only)
      setNodes((nds) =>
        nds.map((n) =>
          n.id === c.target && isCalculableNode(n)
            ? { ...n, data: { ...n.data, dirty: true } }
            : n,
        ),
      );
    },
    [edges, setEdges, setNodes],
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
          pos.y,
        );

        // ② run the stable-id merge (only rename on conflicts)
        const currentGraph = sanitizeGroupBundleVisualElementsForState({
          nodes: rf.getNodes() as FlowNode[],
          edges: rf.getEdges(),
        });
        const { nodes: sub, edges: subE } = importWithFreshIds<FlowNode, Edge>({
          currentNodes: currentGraph.nodes,
          currentEdges: currentGraph.edges,
          importNodes: stripLegacyFlowMapNodeData(translated.nodes),
          importEdges: translated.edges,
          dedupeEdges: true,
          renameMode: "collision", // preserve IDs unless there is a collision
          remapGroupBundleOffsets: true,
        });

        const sanitizedSub = orderNodesParentsFirst(
          stripLegacyFlowMapNodeData(ingestScriptSteps(sub)),
        );

        // ③ append to canvas
        setNodes((nds) => [...stripGroupBundlePortNodes(nds), ...sanitizedSub]);
        setEdges((eds) => [
          ...sanitizeGroupBundleRenderEdgesForState(eds),
          ...subE,
        ]);

        if (translated.anchorPosition) {
          const dropPoint = getLocalDropPoint(e);
          rf.setViewport(
            getFlowTemplateViewport(
              dropPoint,
              translated.anchorPosition,
              FLOW_TEMPLATE_DROP_ZOOM,
            ),
            { duration: 0 },
          );
        }

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
              fitGroupToChildren(groupId, rf, setNodes),
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
    [rf, createNode, setNodes, setEdges],
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

      // Groups are adoptable too (nesting) — top-level items only; membership
      // stays locked until an explicit ungroup.
      const adoptable = selected.filter((n) => !n.parentId);
      const selectedGroupIds = new Set(
        selected.filter((n) => n.type === "shadcnGroup").map((n) => n.id),
      );
      const adoptedNodeIds = new Set<string>();
      const maps = buildGroupMaps(allNodes);

      if (adoptable.length) {
        const pointer = rf.screenToFlowPosition({
          x: evt.clientX,
          y: evt.clientY,
        });

        // Candidates: groups under the pointer that are not being dragged and
        // not inside a dragged group (adopting into your own descendant would
        // create a parent cycle). Prefer the INNERMOST (deepest) candidate.
        const pointerGroup = allNodes.reduce<{
          node: FlowNode;
          depth: number;
        } | null>((winner, node) => {
          if (node.type !== "shadcnGroup" || selectedGroupIds.has(node.id)) {
            return winner;
          }
          for (const draggedGroupId of selectedGroupIds) {
            if (isDescendantOf(node.id, draggedGroupId, maps)) return winner;
          }
          const width = getNodeDimension(node, "width", 300);
          const height = getNodeDimension(node, "height", 200);
          const nodeAbs =
            node.positionAbsolute ?? absolutePositionOf(node.id, maps);
          const contains =
            pointer.x >= nodeAbs.x &&
            pointer.x <= nodeAbs.x + width &&
            pointer.y >= nodeAbs.y &&
            pointer.y <= nodeAbs.y + height;
          if (!contains) return winner;
          const depth = nestingDepthOf(node.id, maps);
          if (!winner || depth > winner.depth) return { node, depth };
          return winner;
        }, null)?.node;

        if (pointerGroup) {
          const groupId = pointerGroup.id;
          const groupAbs =
            pointerGroup.positionAbsolute ??
            absolutePositionOf(groupId, maps);

          const relativePositions = new Map<string, { x: number; y: number }>();
          adoptable.forEach((node) => {
            if (node.id === groupId) return;
            const nodeAbs = node.positionAbsolute ?? node.position;
            relativePositions.set(node.id, {
              x: nodeAbs.x - groupAbs.x,
              y: nodeAbs.y - groupAbs.y,
            });
          });

          if (relativePositions.size) {
            parentsNeedingResize.add(groupId);
            relativePositions.forEach((_, nodeId) => {
              adoptedNodeIds.add(nodeId);
            });
            setNodes((nodesState) =>
              orderNodesParentsFirst(
                nodesState.map((node) => {
                  const rel = relativePositions.get(node.id);
                  if (!rel) return node;
                  return {
                    ...node,
                    parentId: groupId,
                    extent: "parent" as const,
                    position: rel,
                  };
                }),
              ),
            );
          }
        }
      }

      if (!parentsNeedingResize.size) return;

      const parents = Array.from(parentsNeedingResize);
      requestAnimationFrame(() => {
        adoptedNodeIds.forEach((nodeId) => {
          rf.updateNodeInternals?.(nodeId);
        });
        parents.forEach((parentId) => {
          rf.updateNodeInternals?.(parentId);
          requestAnimationFrame(() =>
            fitGroupToChildren(parentId, rf, setNodes),
          );
        });
      });
    },
    [rf, setNodes],
  );

  /* ─────────────────────────────────────────────────────────────── */
  /* 4.  Group / ungroup helpers                                     */
  /* ─────────────────────────────────────────────────────────────── */
  /**
   * Selection "representatives" for grouping: selected nodes minus any whose
   * ancestor is also selected (those travel with the ancestor). Groupable
   * only when every representative shares the SAME parent — all top-level,
   * or all direct children of one group (→ the new group nests inside it).
   */
  const getGroupableSelection = useCallback((all: FlowNode[]) => {
    const maps = buildGroupMaps(all);
    const selectedIds = new Set(
      all.filter((n) => n.selected).map((n) => n.id),
    );
    if (!selectedIds.size) return null;

    const representatives = all.filter((n) => {
      if (!selectedIds.has(n.id)) return false;
      let parentId = n.parentId;
      const seen = new Set<string>([n.id]);
      while (parentId && !seen.has(parentId)) {
        if (selectedIds.has(parentId)) return false;
        seen.add(parentId);
        parentId = maps.byId.get(parentId)?.parentId;
      }
      return true;
    });
    if (!representatives.length) return null;

    const sharedParentId = representatives[0].parentId;
    if (!representatives.every((n) => n.parentId === sharedParentId)) {
      return null;
    }

    return { representatives, sharedParentId, maps };
  }, []);

  const groupSelectedNodes = useCallback(() => {
    if (!rf) return false;

    const all = stripGroupBundlePortNodes(rf.getNodes() as FlowNode[]);
    const groupable = getGroupableSelection(all);
    if (!groupable) return false;

    const { representatives, sharedParentId, maps } = groupable;
    const margin = 60;
    const groupId = `group_${randomId()}`;

    log(
      "nodeOperations",
      `Creating group ${groupId} for ${representatives.length} selected nodes`,
      sharedParentId ? { nestedIn: sharedParentId } : undefined,
    );

    // Absolute bounding box of the representatives (positions of nested
    // members are relative to their parent).
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const memberAbs = new Map<string, { x: number; y: number }>();
    representatives.forEach((n) => {
      const abs = absolutePositionOf(n.id, maps);
      memberAbs.set(n.id, abs);
      minX = Math.min(minX, abs.x);
      minY = Math.min(minY, abs.y);
      maxX = Math.max(maxX, abs.x + getNodeDimension(n, "width", 250));
      maxY = Math.max(maxY, abs.y + getNodeDimension(n, "height", 150));
    });

    const groupAbs = { x: minX - margin, y: minY - margin };
    const groupWidth = maxX - minX + margin * 2;
    const groupHeight = maxY - minY + margin * 2;
    const parentAbs = sharedParentId
      ? absolutePositionOf(sharedParentId, maps)
      : { x: 0, y: 0 };

    const groupNode: FlowNode = {
      id: groupId,
      type: "shadcnGroup",
      position: {
        x: groupAbs.x - parentAbs.x,
        y: groupAbs.y - parentAbs.y,
      },
      ...(sharedParentId
        ? { parentId: sharedParentId, extent: "parent" as const }
        : {}),
      width: groupWidth,
      height: groupHeight,
      measured: {
        width: groupWidth,
        height: groupHeight,
      },
      dragHandle: "[data-drag-handle]",
      data: {
        isGroup: true,
        width: groupWidth,
        height: groupHeight,
        title: "Group Node",
        fontSize: 44,
      },
      selected: false,
    };

    const memberIds = new Set(representatives.map((n) => n.id));
    setNodes((nds) =>
      orderNodesParentsFirst([
        ...nds.map((n) => {
          if (memberIds.has(n.id)) {
            const abs = memberAbs.get(n.id)!;
            return {
              ...n,
              parentId: groupId,
              extent: "parent" as const,
              position: {
                x: abs.x - groupAbs.x,
                y: abs.y - groupAbs.y,
              },
              selected: false,
            };
          }
          return { ...n, selected: false };
        }),
        groupNode,
      ]),
    );

    // The group is already correctly sized from initial creation,
    // but we'll ensure it fits in case any nodes have non-standard sizes
    requestAnimationFrame(() => fitGroupToChildren(groupId, rf, setNodes));

    return true;
  }, [rf, setNodes, getGroupableSelection]);

  /* ─────────────────────────────────────────────────────────────── */
  /*     ** UPDATED:  supports whole-group and partial ungroup **    */
  /* ─────────────────────────────────────────────────────────────── */
  const ungroupSelectedNodes = useCallback(() => {
    if (!rf) return false;

    const all = stripGroupBundlePortNodes(rf.getNodes() as FlowNode[]);
    const selected = all.filter((n) => n.selected);
    const maps = buildGroupMaps(all);

    const ungroupGroups = (groups: FlowNode[]) => {
      const gidSet = new Set(groups.map((g) => g.id));

      log("nodeOperations", `Ungrouping ${groups.length} groups`, {
        groupIds: Array.from(gidSet),
      });

      // Children lift to the nearest ancestor that is NOT being removed
      // (one level up for a nested group; top level when none survives).
      const survivingParentOf = (nodeId: string): string | undefined => {
        const seen = new Set<string>([nodeId]);
        let parentId = maps.byId.get(nodeId)?.parentId;
        while (parentId && !seen.has(parentId)) {
          if (!gidSet.has(parentId)) return parentId;
          seen.add(parentId);
          parentId = maps.byId.get(parentId)?.parentId;
        }
        return undefined;
      };

      setNodes((nds) =>
        nds.flatMap((n) => {
          /* remove the group node itself */
          if (gidSet.has(n.id)) return [];

          /* lift every child of any selected group */
          if (n.parentId && gidSet.has(n.parentId)) {
            const absPos = getAbsoluteNodePosition(n, all);
            const nextParentId = survivingParentOf(n.id);
            const nextParentAbs = nextParentId
              ? absolutePositionOf(nextParentId, maps)
              : { x: 0, y: 0 };

            return [
              {
                ...n,
                parentId: nextParentId,
                extent: nextParentId ? ("parent" as const) : undefined,
                position: {
                  x: absPos.x - nextParentAbs.x,
                  y: absPos.y - nextParentAbs.y,
                },
                selected: true,
              },
            ];
          }

          return [n];
        }),
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
        { parentIds: Array.from(parentsToResize) },
      );

      setNodes((nds) =>
        nds.map((n) => {
          if (!n.selected || !n.parentId) return n;

          const absPos = getAbsoluteNodePosition(n, all);
          // Leave ONE nesting level: re-parent to the grandparent group
          // (top level when the parent was top-level, as before).
          const nextParentId = maps.byId.get(n.parentId)?.parentId;
          const nextParentAbs = nextParentId
            ? absolutePositionOf(nextParentId, maps)
            : { x: 0, y: 0 };

          return {
            ...n,
            parentId: nextParentId,
            extent: nextParentId ? ("parent" as const) : undefined,
            position: {
              x: absPos.x - nextParentAbs.x,
              y: absPos.y - nextParentAbs.y,
            },
            selected: true,
          };
        }),
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
          const node = getNodesLocal().find((n) => n.id === c.id);
          if (node?.parentId) {
            groupsNeedingResize.add(node.parentId);
          }

          // Newly dropped nodes need one parent-adoption pass after their first
          // dimensions event. Later dimensions events still resize an existing
          // parent, which keeps groups fitting nodes that grow after render.
          if (pendingIds.current.has(c.id)) {
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
    [onNodesChange, rf, getNodesLocal, setNodes, attemptToParentNode],
  );

  const onEdgesChangeWithLogging = useCallback(
    (c: EdgeChange[]) => onEdgesChange(c),
    [onEdgesChange],
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
        ? getGroupableSelection(
            stripGroupBundlePortNodes(rf.getNodes() as FlowNode[]),
          ) !== null
        : false,
    canUngroupSelectedNodes: () =>
      rf
        ? rf
            .getNodes()
            .some(
              (n) =>
                n.selected && (n.type === "shadcnGroup" || Boolean(n.parentId)),
            )
        : false,
  };
}
