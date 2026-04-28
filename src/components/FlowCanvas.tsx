import type {
  Edge,
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
import { useMemo } from "react";
import type { DragEvent } from "react";

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
  onMoveEnd,
  isSelectionModeActive = false,
  isReadOnly = false,
  onlyRenderVisibleElements = true,
}: FlowCanvasProps) {
  const selectionEnabled = !isReadOnly && isSelectionModeActive;
  const minZoom = isReadOnly ? MOBILE_MIN_ZOOM : MIN_ZOOM;
  const maxZoom = isReadOnly ? MOBILE_MAX_ZOOM : MAX_ZOOM;
  const renderedEdges = useMemo(() => {
    if (!selectionEnabled) return edges;
    return edges.map((edge) =>
      edge.selectable === false && !edge.selected
        ? edge
        : { ...edge, selectable: false, selected: false }
    );
  }, [edges, selectionEnabled]);

  return (
    <ReactFlow
      className={cn(selectionEnabled ? "cursor-crosshair" : "cursor-grab")}
      style={{ cursor: selectionEnabled ? "crosshair" : undefined }}
      onlyRenderVisibleElements={onlyRenderVisibleElements}
      nodeTypes={nodeTypes}
      nodes={nodes}
      edges={renderedEdges}
      onInit={onInit}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onReconnect={onReconnect}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onNodeDragStop={onNodeDragStop}
      onPaneClick={onPaneClick}
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
            "rounded-lg overflow-hidden cursor-move ring-1 ring-border",
            isDark ? "shadow-sm backdrop-blur-sm bg-background/80" : "bg-white"
          )}
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
  );
}
