import {
  Position,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import {
  useCallback,
  useMemo,
  type MouseEvent,
} from "react";

import {
  isGroupBundleEdgeId,
  type GroupBundleEdgeData,
} from "@/lib/flow/groupEdgeBundling";
import { cn } from "@/lib/utils";
import type { FlowNode } from "@/types";

const fallbackPoint = { x: 0, y: 0 };

const oppositePosition = (position: Position): Position => {
  switch (position) {
    case Position.Left:
      return Position.Right;
    case Position.Right:
      return Position.Left;
    case Position.Top:
      return Position.Bottom;
    case Position.Bottom:
      return Position.Top;
    default:
      return Position.Left;
  }
};

export function GroupBundleEdge({
  id,
  data,
  selected,
}: EdgeProps): JSX.Element | null {
  const bundle = data as GroupBundleEdgeData | undefined;
  const reactFlow = useReactFlow<FlowNode>();
  const bundledEdgeIds = bundle?.bundledEdgeIds;
  const edgeIds = useMemo(
    () => bundledEdgeIds ?? [],
    [bundledEdgeIds]
  );

  const sourcePoint = bundle?.sourcePoint ?? fallbackPoint;
  const targetPoint = bundle?.targetPoint ?? fallbackPoint;
  const sourceBoundaryPoint = bundle?.sourceBoundaryPoint ?? sourcePoint;
  const targetBoundaryPoint = bundle?.targetBoundaryPoint ?? targetPoint;
  const sourceInsidePoint = bundle?.sourceInsidePoint ?? sourceBoundaryPoint;
  const targetInsidePoint = bundle?.targetInsidePoint ?? targetBoundaryPoint;
  const sourcePosition = bundle?.sourcePosition ?? Position.Right;
  const targetPosition = bundle?.targetPosition ?? Position.Left;
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    sourcePosition,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    targetPosition,
  });

  const selectBundledEdges = useCallback(
    (event: MouseEvent<SVGPathElement | SVGGElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const selectedEdgeIds = new Set(edgeIds);

      reactFlow.setNodes((currentNodes) => {
        let changed = false;
        const next = currentNodes.map((node) => {
          if (!node.selected) return node;
          changed = true;
          return { ...node, selected: false };
        });
        return changed ? next : currentNodes;
      });

      reactFlow.setEdges((currentEdges) => {
        let changed = false;
        const next = currentEdges.map((edge) => {
          const shouldSelect =
            !isGroupBundleEdgeId(edge.id) && selectedEdgeIds.has(edge.id);
          if (edge.selected === shouldSelect) return edge;
          changed = true;
          return { ...edge, selected: shouldSelect };
        });
        return changed ? next : currentEdges;
      });
    },
    [edgeIds, reactFlow]
  );

  if (!bundle) return null;

  const sourceTerminalPaths = bundle.sourceTerminals.map((terminal) => ({
    nodeId: terminal.nodeId,
    path: getBezierPath({
      sourceX: terminal.point.x,
      sourceY: terminal.point.y,
      sourcePosition,
      targetX: sourceInsidePoint.x,
      targetY: sourceInsidePoint.y,
      targetPosition: oppositePosition(sourcePosition),
    })[0],
  }));
  const targetTerminalPaths = bundle.targetTerminals.map((terminal) => ({
    nodeId: terminal.nodeId,
    path: getBezierPath({
      sourceX: targetInsidePoint.x,
      sourceY: targetInsidePoint.y,
      sourcePosition: oppositePosition(targetPosition),
      targetX: terminal.point.x,
      targetY: terminal.point.y,
      targetPosition,
    })[0],
  }));
  const count = bundle.count ?? edgeIds.length;
  const isSelected = selected === true;
  const strokeWidth = isSelected
    ? 4.8
    : Math.min(4, 2.2 + Math.log2(Math.max(1, count)) * 0.45);
  const title = `${bundle.sourceLabel} -> ${bundle.targetLabel}: ${count} edge${
    count === 1 ? "" : "s"
  }`;
  const countLabel = `x${count}`;
  const labelWidth = 10 + countLabel.length * 6;
  const labelHeight = 14;

  return (
    <>
      {sourceTerminalPaths.map((terminal) => (
        <path
          key={`source-${terminal.nodeId}`}
          d={terminal.path}
          fill="none"
          stroke="hsl(var(--foreground))"
          strokeLinecap="round"
          strokeWidth={isSelected ? 1.7 : 1.2}
          className={cn(
            "group-bundle-stub-path pointer-events-none",
            isSelected && "group-bundle-edge-path-selected"
          )}
        />
      ))}
      {targetTerminalPaths.map((terminal) => (
        <path
          key={`target-${terminal.nodeId}`}
          d={terminal.path}
          fill="none"
          stroke="hsl(var(--foreground))"
          strokeLinecap="round"
          strokeWidth={isSelected ? 1.7 : 1.2}
          className={cn(
            "group-bundle-stub-path pointer-events-none",
            isSelected && "group-bundle-edge-path-selected"
          )}
        />
      ))}
      <path
        d={`M ${sourceInsidePoint.x} ${sourceInsidePoint.y} L ${sourcePoint.x} ${sourcePoint.y}`}
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeLinecap="round"
        strokeWidth={isSelected ? 2.2 : 1.4}
        className={cn(
          "group-bundle-stub-path pointer-events-none",
          isSelected && "group-bundle-edge-path-selected"
        )}
      />
      <path
        d={`M ${targetPoint.x} ${targetPoint.y} L ${targetInsidePoint.x} ${targetInsidePoint.y}`}
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeLinecap="round"
        strokeWidth={isSelected ? 2.2 : 1.4}
        className={cn(
          "group-bundle-stub-path pointer-events-none",
          isSelected && "group-bundle-edge-path-selected"
        )}
      />
      <path
        id={id}
        d={path}
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeLinecap="round"
        strokeWidth={strokeWidth}
        className={cn(
          "group-bundle-edge-path pointer-events-none",
          isSelected && "group-bundle-edge-path-selected"
        )}
      />
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeLinecap="round"
        strokeWidth={18}
        className="cursor-pointer"
        onClick={selectBundledEdges}
      >
        <title>{title}</title>
      </path>
      {count > 1 && (
        <g
          transform={`translate(${labelX} ${labelY})`}
          className="cursor-pointer"
          onClick={selectBundledEdges}
        >
          <title>{title}</title>
          <rect
            x={-labelWidth / 2}
            y={-labelHeight / 2}
            width={labelWidth}
            height={labelHeight}
            rx={3}
            fill="hsl(var(--background))"
            fillOpacity={0.92}
            stroke={isSelected ? "hsl(var(--primary))" : "hsl(var(--border))"}
            strokeWidth={1}
          />
          <text
            y={3.5}
            textAnchor="middle"
            fill={isSelected ? "hsl(var(--primary))" : "hsl(var(--foreground))"}
            fontFamily="monospace"
            fontSize={10}
            className="select-none"
          >
            {countLabel}
          </text>
        </g>
      )}
      {bundle.renderSourcePort && (
        <circle
          cx={sourceBoundaryPoint.x}
          cy={sourceBoundaryPoint.y}
          r={isSelected ? 4.2 : 3.2}
          fill="hsl(var(--background))"
          stroke="hsl(var(--foreground))"
          strokeWidth={isSelected ? 1.8 : 1.2}
          className={cn(
            "group-bundle-port pointer-events-none",
            isSelected && "group-bundle-edge-path-selected"
          )}
        />
      )}
      {bundle.renderTargetPort && (
        <circle
          cx={targetBoundaryPoint.x}
          cy={targetBoundaryPoint.y}
          r={isSelected ? 4.2 : 3.2}
          fill="hsl(var(--background))"
          stroke="hsl(var(--foreground))"
          strokeWidth={isSelected ? 1.8 : 1.2}
          className={cn(
            "group-bundle-port pointer-events-none",
            isSelected && "group-bundle-edge-path-selected"
          )}
        />
      )}
    </>
  );
}
