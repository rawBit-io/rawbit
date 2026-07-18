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
import { makeEdgeIsLive } from "@/lib/flow/pruneDanglingEdges";
import { fitGroupToChildrenInNodes } from "@/hooks/useCopyPaste";
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
  isRadioFunctionName,
  normalizeRadioChannel,
  radioChannelFromData,
  radioTitleForFunction,
} from "@/lib/graphUtils";

/* ------------------------------------------------------------------ */
/*  Types & tiny utils                                                */
/* ------------------------------------------------------------------ */
type RF = ReactFlowInstance<FlowNode, Edge> & {
  updateNodeInternals?: (id: string) => void;
};
const randomId = () => Math.random().toString(36).slice(2, 9);
const MAX_RADIO_CHANNEL = 99;

type PaletteDragData = {
  type?: string;
  functionName?: string;
  nodeData?: Record<string, unknown> & {
    flowData?: FlowData;
  };
};

type DropParentTarget = {
  id: string;
  position: { x: number; y: number };
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

function nextRadioChannel(nodes: FlowNode[]) {
  const highest = nodes.reduce((max, node) => {
    const fnName = node.data?.functionName;
    if (fnName !== "radio_send" && fnName !== "radio_receive") return max;
    const channel = Number.parseInt(radioChannelFromData(node.data), 10);
    return Number.isFinite(channel) ? Math.max(max, channel) : max;
  }, 0);
  return normalizeRadioChannel(String(Math.min(highest + 1, MAX_RADIO_CHANNEL)));
}

function unmatchedRadioReceiveChannel(nodes: FlowNode[]) {
  const senderChannels = new Set<string>();
  nodes.forEach((node) => {
    if (node.data?.functionName === "radio_send") {
      senderChannels.add(radioChannelFromData(node.data));
    }
  });

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node?.data?.functionName !== "radio_receive") continue;
    const channel = radioChannelFromData(node.data);
    if (!senderChannels.has(channel)) return channel;
  }

  return undefined;
}

function latestRadioSendChannel(nodes: FlowNode[]) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node?.data?.functionName === "radio_send") {
      return radioChannelFromData(node.data);
    }
  }
  return "1";
}

function withAutoRadioChannel(
  dragData: PaletteDragData,
  currentNodes: FlowNode[],
): PaletteDragData {
  const fnName = dragData.nodeData?.functionName ?? dragData.functionName;
  if (!isRadioFunctionName(fnName)) return dragData;

  const channel =
    fnName === "radio_send"
      ? (unmatchedRadioReceiveChannel(currentNodes) ??
        nextRadioChannel(currentNodes))
      : latestRadioSendChannel(currentNodes);
  const nodeData: NonNullable<PaletteDragData["nodeData"]> = {
    ...(dragData.nodeData ?? {}),
    title: radioTitleForFunction(fnName, channel),
    radioChannel: channel,
    // A dropped radio node forms its virtual link at drop time (channel
    // auto-pairing) with no edge to dirty the endpoints — mark it dirty so
    // the pairing is actually calculated (DA-07).
    dirty: true,
  };

  if (Array.isArray(dragData.nodeData?.outputPorts)) {
    nodeData.outputPorts = dragData.nodeData.outputPorts.map((port) =>
      isRecord(port) ? { ...port, label: channel } : port,
    );
  }

  return {
    ...dragData,
    nodeData,
  };
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

function findDropParentTarget(
  nodes: FlowNode[],
  childType: string,
  point: { x: number; y: number },
): DropParentTarget | null {
  if (childType === "shadcnGroup") return null;

  const candidates = nodes
    .filter((node) => node.type === "shadcnGroup")
    .map((node) => {
      const position = getAbsoluteNodePosition(node, nodes);
      const width = getNodeDimension(node, "width", 300);
      const height = getNodeDimension(node, "height", 200);
      const contains =
        point.x >= position.x &&
        point.x <= position.x + width &&
        point.y >= position.y &&
        point.y <= position.y + height;

      if (!contains) return null;

      return {
        id: node.id,
        position,
        dist: Math.hypot(
          point.x - (position.x + width / 2),
          point.y - (position.y + height / 2),
        ),
      };
    })
    .filter(
      (
        candidate,
      ): candidate is DropParentTarget & {
        dist: number;
      } => candidate !== null,
    );

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  return { id: best.id, position: best.position };
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
 * Enlarges a "shadcnGroup" so all children fit. Delegates to the single shared
 * geometry pass ({@link fitGroupToChildrenInNodes}) — the two used to be
 * byte-for-byte siblings that drifted (DA-21), so there is now one
 * implementation, which also carries the NB-05 origin compensation and the
 * nested-group clamp handling.
 */
/* ------------------------------------------------------------------ */
function fitGroupToChildren(
  groupId: string,
  rf: RF | null,
  setNodes: (fn: (n: FlowNode[]) => FlowNode[]) => void,
) {
  if (!rf) return;
  setNodes((nodes) => fitGroupToChildrenInNodes(nodes, groupId));
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
      if (!child || child.type === "shadcnGroup") return;

      if (child.parentId) return;

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

      const groups = (rf.getIntersectingNodes(bbox) as FlowNode[]).filter(
        (g) =>
          g.type === "shadcnGroup" &&
          g.id !== child.id &&
          !selectedGroupIds.has(g.id),
      );

      if (!groups.length) return;

      const childCenter = {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2,
      };

      const best = groups.reduce<{ node: FlowNode; dist: number } | null>(
        (winner, candidate) => {
          const width = getNodeDimension(candidate, "width", 300);
          const height = getNodeDimension(candidate, "height", 200);
          const candidateAbs = candidate.positionAbsolute ?? candidate.position;
          const cx = candidateAbs.x + width / 2;
          const cy = candidateAbs.y + height / 2;
          const dist = Math.hypot(childCenter.x - cx, childCenter.y - cy);
          if (!winner || dist < winner.dist) {
            return { node: candidate, dist };
          }
          return winner;
        },
        null,
      );

      const group = best?.node;
      if (!group) return;
      if (child.parentId === group.id) return; // already in this group

      // ---- ABSOLUTE → RELATIVE TRANSFORM (prevents "jumping") ----
      let absX = childAbs.x;
      let absY = childAbs.y;
      if (child.parentId) {
        const oldParent = all.find((p) => p.id === child.parentId);
        if (oldParent) {
          const oldParentAbs = oldParent.positionAbsolute ?? oldParent.position;
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
            : n,
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
      parentTarget?: DropParentTarget | null,
    ) => {
      const newId = `node_${randomId()}`;
      const nodeDefaults = {
        ...(dragData.nodeData ?? {}),
      };
      delete (nodeDefaults as { flowData?: unknown }).flowData;
      const initialWidth = finiteNumber(nodeDefaults.width);
      const initialHeight = finiteNumber(nodeDefaults.height);
      const relativePosition = parentTarget
        ? {
            x: pos.x - parentTarget.position.x,
            y: pos.y - parentTarget.position.y,
          }
        : pos;

      const newNode: FlowNode = {
        id: newId,
        type,
        position: relativePosition,
        data: nodeDefaults as CalculationNodeData,
        selected: true,
        ...(parentTarget
          ? { parentId: parentTarget.id, extent: "parent" as const }
          : {}),
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

      if (!parentTarget) pendingIds.current.add(newId);
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
      // Occupancy is judged against edges the projection draws: a dangling
      // edge (source/target handle removed) is hidden on canvas and must not
      // block the visibly-free input (DA-11). Same buildPorts liveness the
      // renderer and dialog use.
      const isLive = rf
        ? makeEdgeIsLive(rf.getNodes() as FlowNode[])
        : () => true;
      const occupiesTarget = (e: Edge) =>
        e.target === c.target && e.targetHandle === c.targetHandle;
      const duplicate = edges.some((e) => occupiesTarget(e) && isLive(e));
      if (duplicate) return;

      setEdges((eds) => [
        // Drop any DEAD edge already parked on this handle before adding the
        // new one — otherwise it would revive into a second edge on a
        // single-input handle when its missing handle reappears.
        ...eds.filter((e) => !(occupiesTarget(e) && !isLive(e))),
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
    [edges, rf, setEdges, setNodes],
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

        const sanitizedSub = stripLegacyFlowMapNodeData(ingestScriptSteps(sub));

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
        const currentNodes = stripGroupBundlePortNodes(
          rf.getNodes() as FlowNode[],
        );
        const parentTarget = findDropParentTarget(
          currentNodes,
          data.type,
          pos,
        );
        const droppedNode = createNode(
          data.type,
          withAutoRadioChannel(data, currentNodes),
          pos,
          parentTarget,
        );

        // A dropped radio node can complete (or break) a pairing on its OWN
        // channel without any edge change; dirty just that channel's peers so
        // they recalculate. Scoped to the channel (not every radio node) so a
        // drop can't snowball into a canvas-wide recalc via the affected-
        // subgraph channel expansion (DA-07).
        const droppedFn = data.nodeData?.functionName ?? data.functionName;
        if (isRadioFunctionName(droppedFn)) {
          const droppedChannel = radioChannelFromData(droppedNode.data);
          setNodes((nds) =>
            nds.map((node) =>
              node.id !== droppedNode.id &&
              isRadioFunctionName(node.data?.functionName) &&
              radioChannelFromData(node.data) === droppedChannel
                ? { ...node, data: { ...node.data, dirty: true } }
                : node,
            ),
          );
        }

        if (parentTarget) {
          requestAnimationFrame(() => {
            rf.updateNodeInternals?.(droppedNode.id);
            rf.updateNodeInternals?.(parentTarget.id);
            requestAnimationFrame(() =>
              fitGroupToChildren(parentTarget.id, rf, setNodes),
            );
          });
        }
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

      const adoptable = selected.filter(
        (n) => n.type !== "shadcnGroup" && !n.parentId,
      );
      const selectedGroupIds = new Set(
        selected.filter((n) => n.type === "shadcnGroup").map((n) => n.id),
      );
      const adoptedNodeIds = new Set<string>();

      if (adoptable.length) {
        const pointer = rf.screenToFlowPosition({
          x: evt.clientX,
          y: evt.clientY,
        });

        const pointerGroup = allNodes.find((node) => {
          if (node.type !== "shadcnGroup" || selectedGroupIds.has(node.id)) {
            return false;
          }
          const width = getNodeDimension(node, "width", 300);
          const height = getNodeDimension(node, "height", 200);
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
            relativePositions.forEach((_, nodeId) => {
              adoptedNodeIds.add(nodeId);
            });
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
              }),
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
  const groupSelectedNodes = useCallback(() => {
    if (!rf) return false;

    const all = rf.getNodes() as FlowNode[];
    const sel = all.filter(
      (n) => n.selected && !n.parentId && n.type !== "shadcnGroup",
    );
    if (sel.length < 1) return false;

    const bounds = rf.getNodesBounds(sel);
    const margin = 60;
    const groupId = `group_${randomId()}`;

    log(
      "nodeOperations",
      `Creating group ${groupId} for ${sel.length} selected nodes`,
    );

    const groupNode: FlowNode = {
      id: groupId,
      type: "shadcnGroup",
      position: { x: bounds.x - margin, y: bounds.y - margin },
      width: bounds.width + margin * 2,
      height: bounds.height + margin * 2,
      measured: {
        width: bounds.width + margin * 2,
        height: bounds.height + margin * 2,
      },
      dragHandle: "[data-drag-handle]",
      data: {
        isGroup: true,
        width: bounds.width + margin * 2,
        height: bounds.height + margin * 2,
        title: "Group Node",
        fontSize: 44,
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

      log("nodeOperations", `Ungrouping ${groups.length} groups`, {
        groupIds: Array.from(gidSet),
      });

      setNodes((nds) =>
        nds.flatMap((n) => {
          /* remove the group node itself */
          if (gidSet.has(n.id)) return [];

          /* lift every child of any selected group */
          if (n.parentId && gidSet.has(n.parentId)) {
            const absPos = getAbsoluteNodePosition(n, all);

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

          return {
            ...n,
            parentId: undefined,
            extent: undefined,
            position: absPos,
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
        ? rf
            .getNodes()
            .filter(
              (n) => n.selected && !n.parentId && n.type !== "shadcnGroup",
            ).length >= 1
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
