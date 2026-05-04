import type {
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
import { CanonicalGraphContext } from "@/contexts/canonical-graph";
import {
  buildGroupBundledElements,
  getGroupBundleSegmentEdgeIds,
  GROUP_BUNDLE_EDGE_TYPE,
  type GroupBundleEdgeData,
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
  onDrop?: ReactFlowProps<FlowNode>["onDrop"];
  onDragOver?: (event: DragEvent) => void;
  onNodeDragStop?: ReactFlowProps<FlowNode>["onNodeDragStop"];
  onPaneClick?: ReactFlowProps<FlowNode>["onPaneClick"];
  onBundleEdgesSelect?: (edgeIds: string[]) => void;
  onMoveEnd?: (
    event: MouseEvent | TouchEvent | null,
    viewport: Viewport
  ) => void;
  isSelectionModeActive?: boolean;
  isReadOnly?: boolean;
  onlyRenderVisibleElements?: boolean;
}

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 10;
const MOBILE_MIN_ZOOM = 0.21;
const MOBILE_MAX_ZOOM = 4;
const PRO_OPTIONS = { hideAttribution: true } as const;
const edgeTypes = {
  [GROUP_BUNDLE_EDGE_TYPE]: GroupBundleEdge,
} satisfies ReactFlowProps<FlowNode>["edgeTypes"];
const GROUP_CURVE_OFFSET_RESET_STORAGE_KEY =
  "rawbit.flow.groupCurveOffsetsReset.2026-05-03";

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

const asFiniteNumber = (value: unknown): number | undefined => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

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
  onDrop,
  onDragOver,
  onNodeDragStop,
  onPaneClick,
  onBundleEdgesSelect,
  onMoveEnd,
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
    [isReadOnly, nodes, onNodesChange, visualElements.nodes]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!onEdgesChange) return;
      if (changes.some((change) => change.type === "select")) {
        setBundleSelectedEdgeIds([]);
      }
      const filtered = changes.filter(
        (change) => !("id" in change) || !isGroupBundleVisualEdgeId(change.id)
      );
      if (filtered.length === 0) return;
      onEdgesChange(filtered);
    },
    [onEdgesChange]
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
          className={cn(selectionEnabled ? "cursor-crosshair" : "cursor-grab")}
          style={{ cursor: selectionEnabled ? "crosshair" : undefined }}
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
          onReconnect={onReconnect}
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
