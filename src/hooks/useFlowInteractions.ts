import { useCallback, useEffect, useRef } from "react";
import type { DragEvent } from "react";
import type {
  Connection,
  Edge,
  EdgeChange,
  NodeChange,
  NodePositionChange,
  OnNodeDrag,
} from "@xyflow/react";
import { reconnectEdge } from "@xyflow/react";
import type { FlowNode } from "@/types";
import { isSafariBrowser } from "@/lib/device";

const LARGE_DRAG_THRESHOLD = 30;
const DRAG_FPS_BANDS = [
  { upto: 30, fps: 45 },
  { upto: 80, fps: 20 },
  { upto: Infinity, fps: 12 },
] as const;

const fpsForCount = (count: number) => {
  for (const band of DRAG_FPS_BANDS) {
    if (count <= band.upto) {
      return band.fps;
    }
  }
  return DRAG_FPS_BANDS[DRAG_FPS_BANDS.length - 1].fps;
};

const nowMs = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

interface DragStartInfo {
  x: number;
  y: number;
  parentId?: string | null;
}

const removedNodeIdsFromChanges = (
  changes: NodeChange<FlowNode>[]
): Set<string> => {
  const removedIds = new Set<string>();
  for (const change of changes) {
    if (change.type === "remove") {
      removedIds.add(change.id);
    }
  }
  return removedIds;
};

const expandRemovedNodeIdsWithDescendants = (
  removedIds: Set<string>,
  nodes: FlowNode[]
): Set<string> => {
  if (!removedIds.size) return removedIds;

  const expanded = new Set(removedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!node.parentId || !expanded.has(node.parentId)) continue;
      if (expanded.has(node.id)) continue;
      expanded.add(node.id);
      changed = true;
    }
  }

  return expanded;
};

const edgeTouchesRemovedNode = (
  edge: Edge,
  removedNodeIds: ReadonlySet<string>
): boolean =>
  removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target);

const addEdgeEndpointNodeIds = (ids: Set<string>, edge?: Edge | null) => {
  if (!edge) return;
  ids.add(edge.source);
  ids.add(edge.target);
};

const edgeConnectionChanged = (previous: Edge, next: Edge): boolean =>
  previous.source !== next.source ||
  previous.target !== next.target ||
  (previous.sourceHandle ?? null) !== (next.sourceHandle ?? null) ||
  (previous.targetHandle ?? null) !== (next.targetHandle ?? null);

const dirtyNodeIdsFromEdgeChanges = (
  changes: EdgeChange[],
  edges: Edge[]
): Set<string> => {
  const byId = new Map(edges.map((edge) => [edge.id, edge]));
  const dirtyIds = new Set<string>();

  for (const change of changes) {
    if (change.type === "add") {
      addEdgeEndpointNodeIds(dirtyIds, change.item);
    } else if (change.type === "remove") {
      const previous = byId.get(change.id);
      addEdgeEndpointNodeIds(dirtyIds, previous);
    } else if (change.type === "replace") {
      const previous = byId.get(change.id);
      if (previous && edgeConnectionChanged(previous, change.item)) {
        addEdgeEndpointNodeIds(dirtyIds, previous);
        addEdgeEndpointNodeIds(dirtyIds, change.item);
      }
    }
  }

  return dirtyIds;
};

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const groupBundlePortOffsetsChanged = (
  before: FlowNode | undefined,
  after: FlowNode | undefined
): boolean => {
  const beforeData = before?.data as Record<string, unknown> | undefined;
  const afterData = after?.data as Record<string, unknown> | undefined;
  const beforeHasOffsets = beforeData
    ? hasOwn(beforeData, "groupBundlePortOffsets")
    : false;
  const afterHasOffsets = afterData
    ? hasOwn(afterData, "groupBundlePortOffsets")
    : false;

  if (!beforeHasOffsets && !afterHasOffsets) return false;

  return (
    JSON.stringify(beforeData?.groupBundlePortOffsets ?? null) !==
    JSON.stringify(afterData?.groupBundlePortOffsets ?? null)
  );
};

const hasUndoableCleanNodeReplacement = (
  changes: NodeChange<FlowNode>[],
  beforeNodes: FlowNode[]
): boolean => {
  const beforeById = new Map(beforeNodes.map((node) => [node.id, node]));

  return changes.some(
    (change) =>
      change.type === "replace" &&
      groupBundlePortOffsetsChanged(beforeById.get(change.id), change.item)
  );
};

interface UseFlowInteractionsOptions {
  rawOnNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  rawOnEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onNodeDragStop: OnNodeDrag<FlowNode>;
  getNodes: () => FlowNode[];
  getEdges: () => Edge[];
  setNodes: (updater: (nodes: FlowNode[]) => FlowNode[]) => void;
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void;
  scheduleSnapshot: (
    label: string,
    options?: {
      refresh?: boolean;
      before?: () => boolean;
      coalesceFollowingCalc?: boolean;
    }
  ) => void;
  pendingSnapshotRef: React.MutableRefObject<boolean>;
  skipNextEdgeSnapshotRef: React.MutableRefObject<boolean>;
  markPendingAfterDirtyChange: () => void;
  skipNextNodeRemovalRef: React.MutableRefObject<boolean>;
  releaseNodeRemovalSnapshotSkip: () => void;
  loadingUndoRef: React.MutableRefObject<boolean>;
  isPastingRef: React.MutableRefObject<boolean>;
  getTopLeftPosition: (
    isSidebarOpen: boolean
  ) => { x: number; y: number } | undefined;
  pasteNodes: (position?: { x: number; y: number }) => void;
  isSidebarOpen: boolean;
  setTabTooltip: (tabId: string, tooltip: string) => void;
  renameTab: (
    tabId: string,
    title: string,
    options?: { onlyIfEmpty?: boolean }
  ) => void;
  activeTabId: string;
  groupSelectedNodes: () => boolean;
  ungroupSelectedNodes: () => boolean;
  clearHighlights: () => void;
  setIsSearchHighlight: React.Dispatch<React.SetStateAction<boolean>>;
  incRev: () => number;
  pushCleanState: (nodes: FlowNode[], edges: Edge[], label: string) => void;
  updatePaletteEligibility: () => void;
  isSelectionModeActive?: boolean;
}

export function useFlowInteractions({
  rawOnNodesChange,
  rawOnEdgesChange,
  onConnect,
  onDrop,
  onNodeDragStop,
  getNodes,
  getEdges,
  setNodes,
  setEdges,
  scheduleSnapshot,
  pendingSnapshotRef,
  skipNextEdgeSnapshotRef,
  markPendingAfterDirtyChange,
  loadingUndoRef,
  isPastingRef,
  getTopLeftPosition,
  pasteNodes,
  isSidebarOpen,
  setTabTooltip,
  renameTab,
  activeTabId,
  groupSelectedNodes,
  ungroupSelectedNodes,
  clearHighlights,
  setIsSearchHighlight,
  incRev,
  pushCleanState,
  updatePaletteEligibility,
  skipNextNodeRemovalRef,
  releaseNodeRemovalSnapshotSkip,
  isSelectionModeActive = false,
}: UseFlowInteractionsOptions) {
  const coalescedPosRef = useRef<Map<string, NodePositionChange>>(new Map());
  const pendingNonPosRef = useRef<NodeChange<FlowNode>[] | null>(null);
  const isFlushingRef = useRef(false);
  const cancelFlushRef = useRef<(() => void) | null>(null);
  const cancelNonPosRef = useRef<(() => void) | null>(null);
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | number | null>(
    null
  );
  const nextFlushAtRef = useRef(0);
  const largeDragActiveRef = useRef(false);
  const activeNodeDragIdsRef = useRef<Set<string>>(new Set());
  const dragStartPositionsRef = useRef<Map<string, DragStartInfo>>(new Map());

  const scheduleDoubleRAF = useCallback((cb: () => void) => {
    let frame1: number | null = null;
    let frame2: number | null = null;

    frame1 = requestAnimationFrame(() => {
      frame1 = null;
      frame2 = requestAnimationFrame(() => {
        frame2 = null;
        cb();
      });
    });

    return () => {
      if (frame1 !== null) cancelAnimationFrame(frame1);
      if (frame2 !== null) cancelAnimationFrame(frame2);
    };
  }, []);

  const flushPositionsNow = useCallback(() => {
    if (isFlushingRef.current) return;
    const bag = coalescedPosRef.current;
    if (!bag.size) return;

    isFlushingRef.current = true;
    const changes = new Map(bag);
    bag.clear();

    setNodes((prev) => {
      let mutated = false;

      const next = prev.map((node) => {
        const change = changes.get(node.id);
        if (!change) return node;

        const nextPos = change.position ?? node.position;
        const nextAbs =
          change.positionAbsolute ?? node.positionAbsolute;
        const hasDraggingFlag =
          Object.prototype.hasOwnProperty.call(change, "dragging") &&
          typeof change.dragging === "boolean";
        const nextDragging = hasDraggingFlag
          ? change.dragging
          : node.dragging;

        const posChanged = change.position
          ? change.position.x !== node.position.x ||
            change.position.y !== node.position.y
          : false;
        const absChanged = change.positionAbsolute
          ? change.positionAbsolute.x !==
              ((node.positionAbsolute?.x ?? node.position.x)) ||
            change.positionAbsolute.y !==
              ((node.positionAbsolute?.y ?? node.position.y))
          : false;

        // Avoid re-creating objects if nothing changed
        if (
          !posChanged &&
          !absChanged &&
          (!hasDraggingFlag || nextDragging === node.dragging)
        ) {
          return node;
        }

        mutated = true;
        const updated: FlowNode = {
          ...node,
          position: nextPos,
        };

        if (nextAbs !== undefined) {
          updated.positionAbsolute = nextAbs;
        }
        if (hasDraggingFlag) {
          updated.dragging = nextDragging;
        }

        return updated;
      });

      return mutated ? next : prev;
    });
    isFlushingRef.current = false;
  }, [setNodes]);

  const clearFlushTimer = useCallback(() => {
    if (flushTimeoutRef.current !== null) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
  }, []);

  const enterLargeDragMode = useCallback(() => {
    if (largeDragActiveRef.current) return;
    largeDragActiveRef.current = true;
    if (typeof document !== "undefined") {
      document.body.dataset.largeDrag = "true";
    }
  }, []);

  const setSafariNodeDragMode = useCallback((active: boolean) => {
    if (typeof document === "undefined") return;
    if (active && isSafariBrowser()) {
      document.body.dataset.safariNodeDrag = "true";
    } else {
      delete document.body.dataset.safariNodeDrag;
    }
  }, []);

  const exitLargeDragMode = useCallback(
    (flushImmediate = false, queuePalette = true) => {
      if (!largeDragActiveRef.current) return;
      largeDragActiveRef.current = false;
      if (typeof document !== "undefined") {
        delete document.body.dataset.largeDrag;
      }
      nextFlushAtRef.current = 0;
      clearFlushTimer();
      if (cancelFlushRef.current) {
        cancelFlushRef.current();
        cancelFlushRef.current = null;
      }
      if (flushImmediate) {
        flushPositionsNow();
      }
      if (queuePalette) {
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => updatePaletteEligibility());
        } else {
          updatePaletteEligibility();
        }
      }
    },
    [clearFlushTimer, flushPositionsNow, updatePaletteEligibility]
  );

  const scheduleFlushPositions = useCallback(
    (selectedCount: number) => {
      enterLargeDragMode();
      const fps = fpsForCount(selectedCount);
      const budgetMs = 1000 / fps;
      const now = nowMs();
      const target = nextFlushAtRef.current > 0 ? nextFlushAtRef.current : now;
      const delay = Math.max(0, target - now);

      clearFlushTimer();

      const run = () => {
        flushTimeoutRef.current = null;
        if (cancelFlushRef.current) {
          cancelFlushRef.current();
        }
        cancelFlushRef.current = scheduleDoubleRAF(() => {
          const start = nowMs();
          flushPositionsNow();
          const end = nowMs();
          const observed = end - start;
          const overshoot = Math.max(0, observed - budgetMs * 0.5);
          nextFlushAtRef.current = nowMs() + budgetMs + overshoot;
        });
      };

      if (delay <= 0) {
        nextFlushAtRef.current = now + budgetMs;
        flushTimeoutRef.current = window.setTimeout(run, 0);
      } else {
        flushTimeoutRef.current = window.setTimeout(run, delay);
      }
    },
    [clearFlushTimer, enterLargeDragMode, flushPositionsNow, scheduleDoubleRAF]
  );

  const scheduleForwardNonPos = useCallback(() => {
    if (cancelNonPosRef.current) return;

    let frame: number | null = requestAnimationFrame(() => {
      frame = null;
      const toSend = pendingNonPosRef.current;
      pendingNonPosRef.current = null;
      cancelNonPosRef.current = null;
      if (toSend?.length) {
        rawOnNodesChange(toSend);
      }
    });

    cancelNonPosRef.current = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pendingNonPosRef.current = null;
      cancelNonPosRef.current = null;
    };
  }, [rawOnNodesChange]);

  const removeEdgesForRemovedNodes = useCallback(
    (changes: NodeChange<FlowNode>[], beforeNodes: FlowNode[]) => {
      const removedIds = removedNodeIdsFromChanges(changes);
      if (!removedIds.size) return;

      const removedWithDescendants = expandRemovedNodeIdsWithDescendants(
        removedIds,
        beforeNodes
      );

      setEdges((edges) => {
        const nextEdges = edges.filter(
          (edge) => !edgeTouchesRemovedNode(edge, removedWithDescendants)
        );
        return nextEdges.length === edges.length ? edges : nextEdges;
      });
    },
    [setEdges]
  );

  useEffect(() => {
    const activeNodeDragIds = activeNodeDragIdsRef.current;

    return () => {
      exitLargeDragMode(false, false);
      activeNodeDragIds.clear();
      setSafariNodeDragMode(false);
      cancelNonPosRef.current?.();
      cancelNonPosRef.current = null;
      coalescedPosRef.current = new Map();
      pendingNonPosRef.current = null;
      isFlushingRef.current = false;
    };
  }, [exitLargeDragMode, setSafariNodeDragMode]);

  // Safari can leave the page in a stuck pointer/drag state after sleep.
  // When the tab regains focus/visibility, force-reset any throttled state.
  useEffect(() => {
    const resetInteractions = () => {
      exitLargeDragMode(true);
      activeNodeDragIdsRef.current.clear();
      setSafariNodeDragMode(false);
      cancelNonPosRef.current?.();
      cancelNonPosRef.current = null;
      coalescedPosRef.current = new Map();
      pendingNonPosRef.current = null;
      dragStartPositionsRef.current.clear();
      isFlushingRef.current = false;
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        resetInteractions();
      }
    };

    window.addEventListener("focus", resetInteractions);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", resetInteractions);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [exitLargeDragMode, setSafariNodeDragMode]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      if (isFlushingRef.current) return;

      const beforeNodes = getNodes();

      let sawFinalDrag = false;

      changes.forEach((change) => {
        if (change.type !== "position" || !("dragging" in change)) return;

        if (change.dragging) {
          activeNodeDragIdsRef.current.add(change.id);
          setSafariNodeDragMode(true);

          if (!dragStartPositionsRef.current.has(change.id)) {
            const original = beforeNodes.find((node) => node.id === change.id);
            if (original) {
              dragStartPositionsRef.current.set(change.id, {
                x: original.position.x,
                y: original.position.y,
                parentId: original.parentId ?? null,
              });
            }
          }
        } else {
          sawFinalDrag = true;
          activeNodeDragIdsRef.current.delete(change.id);
          if (!activeNodeDragIdsRef.current.size) {
            setSafariNodeDragMode(false);
          }
        }
      });

      const selectionOnly = changes.every((change) => change.type === "select");

      if (loadingUndoRef.current || isPastingRef.current) {
        rawOnNodesChange(changes);
        return;
      }

      removeEdgesForRemovedNodes(changes, beforeNodes);

      const selectedCount = beforeNodes.reduce(
        (acc, node) => (node.selected ? acc + 1 : acc),
        0
      );
      const shouldThrottle = selectedCount >= LARGE_DRAG_THRESHOLD;

      if (!shouldThrottle) {
        exitLargeDragMode(true);
        rawOnNodesChange(changes);
      } else {
        const posChanges: NodePositionChange[] = [];
        const structuralChanges: NodeChange<FlowNode>[] = [];
        const otherChanges: NodeChange<FlowNode>[] = [];

        changes.forEach((change) => {
          if (change.type === "position")
            posChanges.push(change as NodePositionChange);
          else if (change.type === "remove" || change.type === "add")
            structuralChanges.push(change);
          else otherChanges.push(change);
        });

        // Apply structural changes synchronously (like the unthrottled path)
        // so the "Node(s) removed/added" snapshot scheduled below captures
        // nodes and edges from the same post-change state. Deferring them to
        // the next frame produced torn undo entries (nodes pre-delete, edges
        // post-delete).
        if (structuralChanges.length) {
          rawOnNodesChange(structuralChanges);
        }

        if (otherChanges.length) {
          pendingNonPosRef.current = pendingNonPosRef.current
            ? pendingNonPosRef.current.concat(otherChanges)
            : otherChanges;
          scheduleForwardNonPos();
        }

        if (posChanges.length) {
          const bag = coalescedPosRef.current;
          posChanges.forEach((change) => {
            bag.set(change.id, change);
          });
          scheduleFlushPositions(selectedCount);
        }
      }

      let removed = false;
      let added = false;
      let finalDrag = sawFinalDrag;
      let typedChange = false;

      for (const change of changes) {
        if (change.type === "remove") removed = true;
        else if (change.type === "add") added = true;
        else if (
          change.type === "position" &&
          "dragging" in change &&
          change.dragging === false
        ) {
          finalDrag = true;
        } else if (change.type === "replace") {
          typedChange = true;
        }
      }

      if (selectionOnly) {
        if (
          typeof document === "undefined" ||
          document.body.dataset.largeDrag !== "true"
        ) {
          requestAnimationFrame(updatePaletteEligibility);
        }
        return;
      }

      if (removed || added) {
        const label = removed ? "Node(s) removed" : "Node(s) added";
        scheduleSnapshot(label, {
          refresh: true,
          // Removing a node dirties its surviving consumers (below), so a
          // recalc follows; fold its "After calc" into this entry so one
          // deletion is one undo step.
          coalesceFollowingCalc: true,
          before: () => {
            if (removed && skipNextNodeRemovalRef.current) {
              skipNextNodeRemovalRef.current = false;
              releaseNodeRemovalSnapshotSkip();
              return true;
            }
            return false;
          },
        });
        return;
      }

      let finalDragMoved = false;
      if (finalDrag) {
        for (const change of changes) {
          if (change.type !== "position") continue;
          const start = dragStartPositionsRef.current.get(change.id);
          if (!start) continue;
          const nextPos = change.position ?? null;
          if (!nextPos) continue;
          const dx = Math.abs(nextPos.x - start.x);
          const dy = Math.abs(nextPos.y - start.y);
          if (dx > 0.5 || dy > 0.5) {
            finalDragMoved = true;
            break;
          }
        }

        if (!finalDragMoved) {
          const afterNodes = getNodes();
          for (const [id, start] of dragStartPositionsRef.current.entries()) {
            const latest = afterNodes.find((n) => n.id === id);
            if (!latest) continue;
            const dx = Math.abs(latest.position.x - start.x);
            const dy = Math.abs(latest.position.y - start.y);
            if (dx > 0.5 || dy > 0.5) {
              finalDragMoved = true;
              break;
            }
          }
        }
      }

      if (finalDrag) {
        if (finalDragMoved) {
          requestAnimationFrame(updatePaletteEligibility);
        } else {
          dragStartPositionsRef.current.clear();
        }
      } else if (typedChange) {
        const shouldSnapshotCleanReplacement =
          hasUndoableCleanNodeReplacement(changes, beforeNodes);
        incRev();
        requestAnimationFrame(() => {
          const anyDirty = getNodes().some((node) => node.data?.dirty);
          if (anyDirty) {
            if (!pendingSnapshotRef.current) {
              markPendingAfterDirtyChange();
            }
            skipNextEdgeSnapshotRef.current = true;
          } else if (pendingSnapshotRef.current) {
            skipNextEdgeSnapshotRef.current = true;
          } else if (shouldSnapshotCleanReplacement) {
            scheduleSnapshot("Node data changed", { refresh: true });
          }
        });
      }
    },
    [
      getNodes,
      incRev,
      isPastingRef,
      loadingUndoRef,
      markPendingAfterDirtyChange,
      pendingSnapshotRef,
      rawOnNodesChange,
      scheduleSnapshot,
      skipNextEdgeSnapshotRef,
      updatePaletteEligibility,
      scheduleFlushPositions,
      scheduleForwardNonPos,
      releaseNodeRemovalSnapshotSkip,
      skipNextNodeRemovalRef,
      exitLargeDragMode,
      removeEdgesForRemovedNodes,
      setSafariNodeDragMode,
    ]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const filteredChanges = changes.filter(
        (change) =>
          !(
            isSelectionModeActive &&
            change.type === "select" &&
            change.selected
          )
      );
      if (!filteredChanges.length) return;

      if (loadingUndoRef.current || isPastingRef.current) {
        rawOnEdgesChange(filteredChanges);
        return;
      }

      const dirtyNodeIds = dirtyNodeIdsFromEdgeChanges(
        filteredChanges,
        getEdges()
      );

      rawOnEdgesChange(filteredChanges);

      if (dirtyNodeIds.size > 0) {
        setNodes((nodes) =>
          nodes.map((node) =>
            dirtyNodeIds.has(node.id)
              ? { ...node, data: { ...node.data, dirty: true } }
              : node
          )
        );
        markPendingAfterDirtyChange();
        return;
      }

      const hasShapeReplace = filteredChanges.some(
        (change) => change.type === "replace"
      );
      if (hasShapeReplace) {
        scheduleSnapshot("Edge shape changed");
      }
    },
    [
      getEdges,
      isSelectionModeActive,
      isPastingRef,
      loadingUndoRef,
      markPendingAfterDirtyChange,
      rawOnEdgesChange,
      scheduleSnapshot,
      setNodes,
    ]
  );

  const onConnectWithUndo = useCallback(
    (connection: Connection) => {
      onConnect(connection);
      if (!loadingUndoRef.current && connection.source && connection.target) {
        setNodes((nodes) =>
          nodes.map((node) =>
            node.id === connection.source || node.id === connection.target
              ? { ...node, data: { ...node.data, dirty: true } }
              : node
          )
        );
        markPendingAfterDirtyChange();
      }
    },
    [loadingUndoRef, markPendingAfterDirtyChange, onConnect, setNodes]
  );

  const onReconnectWithUndo = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((edges) => reconnectEdge(oldEdge, newConnection, edges));
      if (!loadingUndoRef.current) {
        setNodes((nodes) =>
          nodes.map((node) =>
            [
              oldEdge.source,
              oldEdge.target,
              newConnection.source,
              newConnection.target,
            ].includes(node.id)
              ? { ...node, data: { ...node.data, dirty: true } }
              : node
          )
        );
        markPendingAfterDirtyChange();
      }
    },
    [
      loadingUndoRef,
      markPendingAfterDirtyChange,
      setEdges,
      setNodes,
    ]
  );

  const onDropWithUndo = useCallback(
    (evt: React.DragEvent<HTMLDivElement>) => {
      const wasEmpty = getNodes().length === 0;

      let droppedWorkflowLabel: string | undefined;
      try {
        const payloadStr = evt.dataTransfer.getData("application/reactflow");
        if (payloadStr) {
          const payload = JSON.parse(payloadStr);
          if (payload?.functionName === "flow_template") {
            droppedWorkflowLabel =
              payload?.nodeData?.flowLabel ||
              payload?.nodeData?.flowData?.label ||
              payload?.nodeData?.flowData?.name ||
              payload?.nodeData?.flowData?.meta?.name;
          }
        }
      } catch {
        /* ignore */
      }

      onDrop(evt);

      setNodes((nodes) =>
        nodes.some((node) => node.selected)
          ? nodes.map((node) =>
              node.selected ? { ...node, selected: false } : node
            )
          : nodes
      );

      if (wasEmpty && droppedWorkflowLabel) {
        setTabTooltip(activeTabId, `Workflow: ${droppedWorkflowLabel}`);
        renameTab(activeTabId, droppedWorkflowLabel, { onlyIfEmpty: true });
      }

      scheduleSnapshot("Node(s) dropped");
    },
    [
      activeTabId,
      getNodes,
      onDrop,
      scheduleSnapshot,
      setNodes,
      setTabTooltip,
      renameTab,
    ]
  );

  const groupWithUndo = useCallback(() => {
    const changed = groupSelectedNodes();
    if (!changed) return;

    setNodes((nodes) => nodes.map((node) => ({ ...node, selected: false })));
    setEdges((edges) => edges.map((edge) => ({ ...edge, selected: false })));
    clearHighlights();
    setIsSearchHighlight(false);

    scheduleSnapshot("Group nodes", { refresh: true });
  }, [
    clearHighlights,
    groupSelectedNodes,
    scheduleSnapshot,
    setEdges,
    setIsSearchHighlight,
    setNodes,
  ]);

  const ungroupWithUndo = useCallback(() => {
    const changed = ungroupSelectedNodes();
    if (!changed) return;

    incRev();
    scheduleSnapshot("Ungroup nodes", { refresh: true });
  }, [incRev, scheduleSnapshot, ungroupSelectedNodes]);

  const labelForParentDiff = useCallback(
    (before: FlowNode[], after: FlowNode[]) => {
      const beforeMap = new Map(
        before.map((node) => [node.id, node.parentId ?? null])
      );
      const afterMap = new Map(
        after.map((node) => [node.id, node.parentId ?? null])
      );
      let adopted = 0;
      let released = 0;

      for (const [id, priorParent] of beforeMap) {
        const nextParent = afterMap.get(id) ?? null;
        if (priorParent === nextParent) continue;
        if (nextParent && !priorParent) adopted += 1;
        else if (!nextParent && priorParent) released += 1;
      }

      if (adopted > 0 && released === 0) return "Group nodes";
      if (released > 0 && adopted === 0) return "Ungroup nodes";
      return "Node(s) moved";
    },
    []
  );

  const onNodeDragStopWithUndo = useCallback<OnNodeDrag<FlowNode>>(
    (event, node, nodesArg) => {
      const beforeNodes = getNodes();
      onNodeDragStop(event, node, nodesArg ?? beforeNodes);
      exitLargeDragMode(true);
      activeNodeDragIdsRef.current.clear();
      setSafariNodeDragMode(false);

      if (loadingUndoRef.current) {
        dragStartPositionsRef.current.clear();
        return;
      }

      const commit = () => {
        const afterNodes = getNodes();
        const edges = getEdges();
        let anyMovement = false;
        let anyGrouped = false;
        let anyUngrouped = false;

        dragStartPositionsRef.current.forEach((start, id) => {
          const latest = afterNodes.find((n) => n.id === id);
          if (!latest) return;
          const dx = Math.abs(latest.position.x - start.x);
          const dy = Math.abs(latest.position.y - start.y);
          if (dx > 0.5 || dy > 0.5) anyMovement = true;

          const startParent = start.parentId ?? null;
          const latestParent = latest.parentId ?? null;
          if (startParent !== latestParent) {
            if (latestParent) anyGrouped = true;
            else anyUngrouped = true;
          }
        });

        dragStartPositionsRef.current.clear();

        if (!anyMovement && !anyGrouped && !anyUngrouped) {
          pendingSnapshotRef.current = false;
          return;
        }

        incRev();
        const label =
          anyGrouped || anyUngrouped
            ? labelForParentDiff(beforeNodes, afterNodes)
            : "Node(s) moved";
        pushCleanState(afterNodes, edges, label);
        pendingSnapshotRef.current = false;
      };

      requestAnimationFrame(() => requestAnimationFrame(commit));
    },
    [
      getEdges,
      getNodes,
      incRev,
      labelForParentDiff,
      exitLargeDragMode,
      loadingUndoRef,
      onNodeDragStop,
      pendingSnapshotRef,
      pushCleanState,
      setSafariNodeDragMode,
    ]
  );

  const handlePaste = useCallback(
    (withOffset = true) => {
      isPastingRef.current = true;
      pasteNodes(withOffset ? getTopLeftPosition(isSidebarOpen) : undefined);
      scheduleSnapshot("Pasted nodes", { refresh: true });
      requestAnimationFrame(() => {
        isPastingRef.current = false;
      });
    },
    [
      getTopLeftPosition,
      isSidebarOpen,
      pasteNodes,
      scheduleSnapshot,
      isPastingRef,
    ]
  );

  return {
    onNodesChange,
    onEdgesChange,
    onConnectWithUndo,
    onReconnectWithUndo,
    onDropWithUndo,
    groupWithUndo,
    ungroupWithUndo,
    onNodeDragStopWithUndo,
    handlePaste,
  } as const;
}
