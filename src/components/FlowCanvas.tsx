import type {
  Connection,
  Edge,
  EdgeChange,
  NodeChange,
  Node as ReactFlowNode,
  OnConnect,
  OnEdgesChange,
  OnInit,
  OnNodesChange,
  OnReconnect,
  ReactFlowProps,
  Viewport,
} from "@xyflow/react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
} from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { FlowNode } from "@/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  GroupBundleEdge,
  GroupBundleEdgeSelectionProvider,
} from "@/components/edges/GroupBundleEdge";
import { GroupBundleSegmentEdge } from "@/components/edges/GroupBundleSegmentEdge";
import { CanonicalGraphContext } from "@/contexts/canonical-graph";
import {
  buildGroupBundledElements,
  getGroupBundleSegmentEdgeIds,
  GROUP_BUNDLE_EDGE_TYPE,
  GROUP_BUNDLE_SEGMENT_EDGE_TYPE,
  type GroupBundleEdgeData,
  type GroupBundleSegmentEdgeData,
  isGroupBundleEdgeId,
  isGroupBundlePortNodeId,
  isGroupBundleSegmentEdgeId,
  isGroupBundleVisualEdgeId,
} from "@/lib/flow/groupEdgeBundling";

interface FlowCanvasProps {
  nodeTypes: ReactFlowProps<FlowNode>["nodeTypes"];
  nodes: FlowNode[];
  edges: Edge[];
  showMiniMap: boolean;
  miniMapSize: { w: number; h: number };
  miniMapOffset: number;
  isDark: boolean;
  nodeClassName: (node: ReactFlowNode) => string;
  onInit?: OnInit<FlowNode>;
  onNodesChange?: OnNodesChange<FlowNode>;
  onEdgesChange?: OnEdgesChange;
  onConnect?: OnConnect;
  onReconnect?: OnReconnect;
  onDelete?: ReactFlowProps<FlowNode>["onDelete"];
  onDrop?: ReactFlowProps<FlowNode>["onDrop"];
  onDragOver?: (event: DragEvent) => void;
  onNodeDragStop?: ReactFlowProps<FlowNode>["onNodeDragStop"];
  onPaneClick?: ReactFlowProps<FlowNode>["onPaneClick"];
  onBundleEdgesSelect?: (edgeIds: string[]) => void;
  onMoveEnd?: (
    event: MouseEvent | TouchEvent | null,
    viewport: Viewport
  ) => void;
  isPastePlacementActive?: boolean;
  isSelectionModeActive?: boolean;
  isReadOnly?: boolean;
  onlyRenderVisibleElements?: boolean;
}

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 10;
const MOBILE_MIN_ZOOM = 0.21;
const MOBILE_MAX_ZOOM = 4;
const PRO_OPTIONS = { hideAttribution: true } as const;
const CLEAR_BUNDLE_EDGE_SELECTION_EVENT = "rawbit:clear-bundle-edge-selection";
const edgeTypes = {
  [GROUP_BUNDLE_EDGE_TYPE]: GroupBundleEdge,
  [GROUP_BUNDLE_SEGMENT_EDGE_TYPE]: GroupBundleSegmentEdge,
} satisfies ReactFlowProps<FlowNode>["edgeTypes"];
const GROUP_CURVE_OFFSET_RESET_STORAGE_KEY =
  "rawbit.flow.groupCurveOffsetsReset.2026-06-11";

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select"
  );
};

// Non-numbers must fall through the ?? fallback chains (null/""/false would
// coerce to a finite 0 via Number() and break height fallbacks).
const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const nodeAbsoluteY = (node: FlowNode): number =>
  node.positionAbsolute?.y ?? node.position.y;

const nodeHeight = (node: FlowNode): number =>
  asFiniteNumber(node.data?.height) ??
  asFiniteNumber(node.height) ??
  asFiniteNumber(node.measured?.height) ??
  0;

const portRole = (node: FlowNode): "source" | "target" | undefined =>
  node.data?.role === "source" || node.data?.role === "target"
    ? node.data.role
    : undefined;

const portBundleId = (node: FlowNode): string | undefined =>
  typeof node.data?.bundleId === "string" && node.data.bundleId.trim()
    ? node.data.bundleId
    : undefined;

const hasCurveControlPointOffset = (edge: Edge): boolean =>
  Boolean(
    edge.data &&
      Object.prototype.hasOwnProperty.call(
        edge.data,
        "curveControlPointOffset"
      )
  );

const segmentReconnectSide = (
  edge: Edge
): "source" | "target" | undefined => {
  const side = (edge.data as GroupBundleSegmentEdgeData | undefined)?.side;
  return side === "source" || side === "target" ? side : undefined;
};

const buildClearCurveOffsetChange = (edge: Edge): EdgeChange => {
  const data = {
    ...(edge.data as Record<string, unknown> | undefined),
  };
  delete data.curveControlPointOffset;
  return {
    id: edge.id,
    type: "replace",
    item: {
      ...edge,
      data,
    },
  };
};

const buildGroupPortOffsetChange = ({
  change,
  portNode,
  groupNode,
}: {
  change: NodeChange<FlowNode>;
  portNode: FlowNode;
  groupNode: FlowNode;
}): NodeChange<FlowNode> | null => {
  if (change.type !== "position") return null;
  const role = portRole(portNode);
  if (!role) return null;

  const nextPosition = change.positionAbsolute ?? change.position;
  if (!nextPosition) return null;

  const groupY = nodeAbsoluteY(groupNode);
  const groupH = nodeHeight(groupNode);
  if (groupH <= 0) return null;

  const portH =
    asFiniteNumber(portNode.data?.height) ??
    asFiniteNumber(portNode.height) ??
    asFiniteNumber(portNode.measured?.height) ??
    0;
  const portCenterY = nextPosition.y + portH / 2;
  const groupCenterY = groupY + groupH / 2;
  const minCenterY = groupY + portH / 2;
  const maxCenterY = groupY + groupH - portH / 2;
  const clampedCenterY =
    minCenterY <= maxCenterY
      ? Math.min(Math.max(portCenterY, minCenterY), maxCenterY)
      : groupCenterY;
  const nextOffset = Math.round((clampedCenterY - groupCenterY) * 100) / 100;
  const currentOffsets = groupNode.data?.groupBundlePortOffsets ?? {};
  const bundleId = portBundleId(portNode);
  if (bundleId) {
    const byBundleKey =
      role === "source" ? "sourceByBundle" : "targetByBundle";
    const currentBundleOffsets = currentOffsets[byBundleKey] ?? {};
    const currentOffset = currentBundleOffsets[bundleId] ?? currentOffsets[role];
    if (currentOffset === nextOffset) return null;

    return {
      id: groupNode.id,
      type: "replace",
      item: {
        ...groupNode,
        data: {
          ...groupNode.data,
          groupBundlePortOffsets: {
            ...currentOffsets,
            [byBundleKey]: {
              ...currentBundleOffsets,
              [bundleId]: nextOffset,
            },
          },
        },
      },
    };
  }

  if (currentOffsets[role] === nextOffset) return null;

  return {
    id: groupNode.id,
    type: "replace",
    item: {
      ...groupNode,
      data: {
        ...groupNode.data,
        groupBundlePortOffsets: {
          ...currentOffsets,
          [role]: nextOffset,
        },
      },
    },
  };
};

export function FlowCanvas({
  nodeTypes,
  nodes,
  edges,
  showMiniMap,
  miniMapSize,
  miniMapOffset,
  isDark,
  nodeClassName,
  onInit,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onReconnect,
  onDelete,
  onDrop,
  onDragOver,
  onNodeDragStop,
  onPaneClick,
  onBundleEdgesSelect,
  onMoveEnd,
  isPastePlacementActive = false,
  isSelectionModeActive = false,
  isReadOnly = false,
  onlyRenderVisibleElements = true,
}: FlowCanvasProps) {
  const selectionEnabled = !isReadOnly && isSelectionModeActive;
  const minZoom = isReadOnly ? MOBILE_MIN_ZOOM : MIN_ZOOM;
  const maxZoom = isReadOnly ? MOBILE_MAX_ZOOM : MAX_ZOOM;
  const hasRunGroupCurveOffsetResetRef = useRef(false);
  const [bundleSelectedEdgeIds, setBundleSelectedEdgeIds] = useState<string[]>(
    []
  );
  const bundleSelectedEdgeIdSet = useMemo(
    () => new Set(bundleSelectedEdgeIds),
    [bundleSelectedEdgeIds]
  );
  const visualElements = useMemo(() => {
    const baseElements = buildGroupBundledElements({ nodes, edges });
    if (bundleSelectedEdgeIdSet.size === 0) return baseElements;

    return {
      nodes: baseElements.nodes.map((node) => {
        if (!isGroupBundlePortNodeId(node.id)) return node;
        const bundledEdgeIds = node.data.bundledEdgeIds;
        if (!Array.isArray(bundledEdgeIds)) return node;
        const selectedEdgeIds = bundledEdgeIds.filter(
          (edgeId): edgeId is string =>
            typeof edgeId === "string" && bundleSelectedEdgeIdSet.has(edgeId)
        );
        return {
          ...node,
          data: {
            ...node.data,
            selectedEdgeIds,
          },
        };
      }),
      edges: baseElements.edges.map((edge) => {
        if (isGroupBundleSegmentEdgeId(edge.id)) {
          const selectedEdgeIds = getGroupBundleSegmentEdgeIds(edge).filter(
            (edgeId) => bundleSelectedEdgeIdSet.has(edgeId)
          );
          return {
            ...edge,
            selected: selectedEdgeIds.length > 0,
            data: {
              ...edge.data,
              selectedEdgeIds,
            },
            className: cn(
              edge.className,
              selectedEdgeIds.length > 0 && "group-bundle-edge-path-selected"
            ),
          };
        }

        if (!isGroupBundleEdgeId(edge.id)) return edge;
        const data = edge.data as GroupBundleEdgeData | undefined;
        if (!data) return edge;
        const selectedEdgeIds = data.bundledEdgeIds.filter((edgeId) =>
          bundleSelectedEdgeIdSet.has(edgeId)
        );
        return {
          ...edge,
          selected: selectedEdgeIds.length > 0,
          data: {
            ...data,
            selectedEdgeIds,
            renderSourcePort:
              selectedEdgeIds.length > 0 ? true : data.renderSourcePort,
            renderTargetPort:
              selectedEdgeIds.length > 0 ? true : data.renderTargetPort,
          },
        };
      }),
    };
  }, [bundleSelectedEdgeIdSet, edges, nodes]);
  const selectedNonRenderedEdgeIds = useMemo(() => {
    const renderedEdgeIds = new Set(
      visualElements.edges.map((edge) => edge.id)
    );
    return edges
      .filter((edge) => edge.selected === true && !renderedEdgeIds.has(edge.id))
      .map((edge) => edge.id);
  }, [edges, visualElements.edges]);

  useEffect(() => {
    if (isReadOnly || !onEdgesChange || hasRunGroupCurveOffsetResetRef.current) {
      return;
    }
    // The first commit renders the pre-hydration default flow (no edges yet);
    // latching the one-time marker against it would permanently skip the
    // migration for the persisted graph that hydrates afterwards.
    if (edges.length === 0) {
      return;
    }
    hasRunGroupCurveOffsetResetRef.current = true;

    if (typeof window !== "undefined") {
      try {
        if (
          window.localStorage.getItem(GROUP_CURVE_OFFSET_RESET_STORAGE_KEY) ===
          "1"
        ) {
          return;
        }
      } catch (error) {
        console.warn("Failed to read group curve reset marker", error);
      }
    }

    const bundledGroupEdgeIds = new Set<string>();
    for (const edge of visualElements.edges) {
      if (!isGroupBundleEdgeId(edge.id)) continue;
      const data = edge.data as GroupBundleEdgeData | undefined;
      if (!data?.sourceGroupId || !data.targetGroupId) continue;
      for (const bundledEdgeId of data.bundledEdgeIds) {
        bundledGroupEdgeIds.add(bundledEdgeId);
      }
    }

    const changes = edges
      .filter(
        (edge) =>
          bundledGroupEdgeIds.has(edge.id) && hasCurveControlPointOffset(edge)
      )
      .map(buildClearCurveOffsetChange);

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(GROUP_CURVE_OFFSET_RESET_STORAGE_KEY, "1");
      } catch (error) {
        console.warn("Failed to persist group curve reset marker", error);
      }
    }

    if (changes.length > 0) {
      onEdgesChange(changes);
    }
  }, [edges, isReadOnly, onEdgesChange, visualElements.edges]);

  useEffect(() => {
    if (isReadOnly || !onEdgesChange || selectedNonRenderedEdgeIds.length === 0) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      setBundleSelectedEdgeIds([]);
      onEdgesChange(
        selectedNonRenderedEdgeIds.map((id) => ({
          id,
          type: "remove",
        }))
      );
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [isReadOnly, onEdgesChange, selectedNonRenderedEdgeIds]);

  const handleBundleEdgeSelect = useCallback(
    (edgeIdsToSelect: string[]) => {
      setBundleSelectedEdgeIds(edgeIdsToSelect);

      if (onBundleEdgesSelect) {
        onBundleEdgesSelect(edgeIdsToSelect);
        return;
      }

      const selectedEdgeIds = new Set(edgeIdsToSelect);

      if (onNodesChange) {
        const nodeChanges: NodeChange<FlowNode>[] = nodes
          .filter((node) => node.selected === true)
          .map((node) => ({
            id: node.id,
            type: "select",
            selected: false,
          }));
        if (nodeChanges.length > 0) onNodesChange(nodeChanges);
      }

      if (!onEdgesChange) return;

      const edgeChanges: EdgeChange[] = [];
      for (const edge of edges) {
        const selected = selectedEdgeIds.has(edge.id);
        if ((edge.selected === true) === selected) continue;
        edgeChanges.push({
          id: edge.id,
          type: "select",
          selected,
        });
      }

      if (edgeChanges.length > 0) onEdgesChange(edgeChanges);
    },
    [edges, nodes, onBundleEdgesSelect, onEdgesChange, onNodesChange]
  );

  const clearBundleEdgeSelection = useCallback(() => {
    setBundleSelectedEdgeIds([]);
    if (!onEdgesChange) return;

    const edgeChanges: EdgeChange[] = edges
      .filter((edge) => edge.selected === true)
      .map((edge) => ({
        id: edge.id,
        type: "select",
        selected: false,
      }));

    if (edgeChanges.length > 0) {
      onEdgesChange(edgeChanges);
    }
  }, [edges, onEdgesChange]);

  useEffect(() => {
    if (isReadOnly) return;
    window.addEventListener(
      CLEAR_BUNDLE_EDGE_SELECTION_EVENT,
      clearBundleEdgeSelection
    );
    return () => {
      window.removeEventListener(
        CLEAR_BUNDLE_EDGE_SELECTION_EVENT,
        clearBundleEdgeSelection
      );
    };
  }, [clearBundleEdgeSelection, isReadOnly]);

  const renderedEdges = useMemo(() => {
    if (!selectionEnabled) return visualElements.edges;
    return visualElements.edges.map((edge) =>
      edge.selectable === false
        ? edge
        : { ...edge, selectable: false, selected: false }
    );
  }, [selectionEnabled, visualElements.edges]);
  const canonicalGraph = useMemo(() => ({ nodes, edges }), [edges, nodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const shouldClearSelectedBundleEdges = changes.some(
        (change) =>
          change.type === "select" &&
          change.selected === true &&
          "id" in change &&
          !isGroupBundlePortNodeId(change.id)
      );

      if (shouldClearSelectedBundleEdges) {
        setBundleSelectedEdgeIds([]);
        if (onEdgesChange) {
          const selectedEdgeChanges: EdgeChange[] = edges
            .filter((edge) => edge.selected === true)
            .map((edge) => ({
              id: edge.id,
              type: "select",
              selected: false,
            }));
          if (selectedEdgeChanges.length > 0) {
            onEdgesChange(selectedEdgeChanges);
          }
        }
      }

      if (!onNodesChange) return;
      const visualNodeById = new Map(
        visualElements.nodes.map((node) => [node.id, node])
      );
      const canonicalNodeById = new Map(nodes.map((node) => [node.id, node]));
      const forwarded: NodeChange<FlowNode>[] = [];

      for (const change of changes) {
        if (!("id" in change) || !isGroupBundlePortNodeId(change.id)) {
          forwarded.push(change);
          continue;
        }

        if (isReadOnly) continue;

        const portNode = visualNodeById.get(change.id);
        const groupId = portNode?.data?.groupId;
        const groupNode =
          typeof groupId === "string" ? canonicalNodeById.get(groupId) : undefined;
        if (!portNode || !groupNode) continue;

        const offsetChange = buildGroupPortOffsetChange({
          change,
          portNode,
          groupNode,
        });
        if (offsetChange) forwarded.push(offsetChange);
      }

      if (forwarded.length === 0) return;
      onNodesChange(forwarded);
    },
    [edges, isReadOnly, nodes, onEdgesChange, onNodesChange, visualElements.nodes]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!onEdgesChange) return;
      if (changes.some((change) => change.type === "select")) {
        setBundleSelectedEdgeIds([]);
      }

      const visualEdgeById = new Map(
        visualElements.edges.map((edge) => [edge.id, edge])
      );
      const deselectedBundledEdgeIds = new Set<string>();

      for (const change of changes) {
        if (
          change.type !== "select" ||
          change.selected !== false ||
          !("id" in change) ||
          !isGroupBundleVisualEdgeId(change.id)
        ) {
          continue;
        }

        const visualEdge = visualEdgeById.get(change.id);
        if (!visualEdge) continue;

        if (isGroupBundleSegmentEdgeId(visualEdge.id)) {
          const selectedEdgeIds =
            Array.isArray(visualEdge.data?.selectedEdgeIds) &&
            visualEdge.data.selectedEdgeIds.length > 0
              ? visualEdge.data.selectedEdgeIds.filter(
                  (edgeId): edgeId is string => typeof edgeId === "string"
                )
              : visualEdge.selected === true
                ? getGroupBundleSegmentEdgeIds(visualEdge)
                : [];
          selectedEdgeIds.forEach((edgeId) =>
            deselectedBundledEdgeIds.add(edgeId)
          );
          continue;
        }

        if (isGroupBundleEdgeId(visualEdge.id)) {
          const data = visualEdge.data as GroupBundleEdgeData | undefined;
          const selectedEdgeIds =
            data?.selectedEdgeIds && data.selectedEdgeIds.length > 0
              ? data.selectedEdgeIds
              : visualEdge.selected === true
                ? data?.bundledEdgeIds ?? []
                : [];
          selectedEdgeIds.forEach((edgeId) =>
            deselectedBundledEdgeIds.add(edgeId)
          );
        }
      }

      const filtered = changes.filter(
        (change) => !("id" in change) || !isGroupBundleVisualEdgeId(change.id)
      );

      const translatedDeselections: EdgeChange[] = edges
        .filter(
          (edge) =>
            edge.selected === true && deselectedBundledEdgeIds.has(edge.id)
        )
        .map((edge) => ({
          id: edge.id,
          type: "select",
          selected: false,
        }));

      const forwarded = [...filtered, ...translatedDeselections];
      if (forwarded.length === 0) return;
      onEdgesChange(forwarded);
    },
    [edges, onEdgesChange, visualElements.edges]
  );

  const handleReconnect = useCallback<OnReconnect>(
    (oldEdge, newConnection) => {
      if (!isGroupBundleSegmentEdgeId(oldEdge.id)) {
        onReconnect?.(oldEdge, newConnection);
        return;
      }

      const segmentEdgeIds = getGroupBundleSegmentEdgeIds(oldEdge);
      const [canonicalEdgeId] = segmentEdgeIds;
      if (!canonicalEdgeId || segmentEdgeIds.length !== 1) {
        return;
      }

      const canonicalEdge = edges.find((edge) => edge.id === canonicalEdgeId);
      const side = segmentReconnectSide(oldEdge);
      if (!canonicalEdge || !side) return;

      let translatedConnection: Connection | undefined;
      if (side === "source" && newConnection.source) {
        translatedConnection = {
          source: newConnection.source,
          sourceHandle: newConnection.sourceHandle,
          target: canonicalEdge.target,
          targetHandle: canonicalEdge.targetHandle ?? null,
        };
      }
      if (side === "target" && newConnection.target) {
        translatedConnection = {
          source: canonicalEdge.source,
          sourceHandle: canonicalEdge.sourceHandle ?? null,
          target: newConnection.target,
          targetHandle: newConnection.targetHandle,
        };
      }

      if (!translatedConnection) return;
      setBundleSelectedEdgeIds([]);
      onReconnect?.(canonicalEdge, translatedConnection);
    },
    [edges, onReconnect]
  );

  const handleEdgeClick = useCallback<
    NonNullable<ReactFlowProps<FlowNode>["onEdgeClick"]>
  >(
    (event, edge) => {
      if (!isGroupBundleSegmentEdgeId(edge.id)) return;
      const edgeIdsToSelect = getGroupBundleSegmentEdgeIds(edge);
      if (edgeIdsToSelect.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      handleBundleEdgeSelect(edgeIdsToSelect);
    },
    [handleBundleEdgeSelect]
  );
  const handlePaneClick = useCallback<
    NonNullable<ReactFlowProps<FlowNode>["onPaneClick"]>
  >(
    (event) => {
      setBundleSelectedEdgeIds([]);
      onPaneClick?.(event);
    },
    [onPaneClick]
  );

  return (
    <CanonicalGraphContext.Provider value={canonicalGraph}>
      <GroupBundleEdgeSelectionProvider onSelectEdgeIds={handleBundleEdgeSelect}>
        <ReactFlow
          className={cn(
            isPastePlacementActive
              ? "cursor-default"
              : selectionEnabled
              ? "cursor-crosshair"
              : "cursor-grab"
          )}
          style={{
            cursor: isPastePlacementActive
              ? "default"
              : selectionEnabled
              ? "crosshair"
              : undefined,
          }}
          onlyRenderVisibleElements={onlyRenderVisibleElements}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodes={visualElements.nodes}
          edges={renderedEdges}
          onInit={onInit}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onEdgeClick={handleEdgeClick}
          onConnect={onConnect}
          onReconnect={handleReconnect}
          onDelete={onDelete}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={handlePaneClick}
          onMoveEnd={onMoveEnd}
          minZoom={minZoom}
          maxZoom={maxZoom}
          proOptions={PRO_OPTIONS}
          connectOnClick={!isReadOnly}
          edgesReconnectable={!isReadOnly}
          deleteKeyCode={isReadOnly ? [] : ["Backspace", "Delete"]}
          selectionMode={SelectionMode.Full}
          selectionOnDrag={selectionEnabled}
          selectionKeyCode="s"
          multiSelectionKeyCode={["Meta", "Control"]}
          panOnDrag={selectionEnabled ? [1] : [0, 1]}
          selectNodesOnDrag={selectionEnabled}
          nodesDraggable={!isReadOnly}
          nodesConnectable={!isReadOnly}
          elementsSelectable={!isReadOnly}
          disableKeyboardA11y
        >
          <Background />
          {showMiniMap && (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              style={{
                position: "fixed",
                bottom: "-0.2rem",
                right: miniMapOffset,
                width: miniMapSize.w,
                height: miniMapSize.h,
                borderRadius: "0.75rem",
                zIndex: 2_147_483_647,
              }}
              className={cn(
                "rounded-lg overflow-hidden cursor-move ring-1 ring-border bg-background shadow-sm"
              )}
              bgColor="hsl(var(--background))"
              nodeColor={() => "hsl(var(--foreground))"}
              nodeStrokeColor={() => "transparent"}
              nodeClassName={nodeClassName}
              maskColor={isDark ? "rgba(0,0,0,0.35)" : "transparent"}
              maskStrokeColor="#ff0000"
              maskStrokeWidth={1}
            />
          )}
          {!isReadOnly && (
            <Controls
              className="custom-flow-controls"
              position="bottom-right"
              showZoom
              showFitView
              showInteractive={false}
              style={{ zIndex: 9999, right: "0.1rem", bottom: "0.1rem" }}
            />
          )}
        </ReactFlow>
      </GroupBundleEdgeSelectionProvider>
    </CanonicalGraphContext.Provider>
  );
}
