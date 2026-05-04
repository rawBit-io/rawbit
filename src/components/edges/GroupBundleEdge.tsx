import {
  Position,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  isGroupBundleEdgeId,
  type GroupBundleEdgeData,
} from "@/lib/flow/groupEdgeBundling";
import { cn } from "@/lib/utils";
import type { FlowNode } from "@/types";

const fallbackPoint = { x: 0, y: 0 };
const COUNT_LABEL_SCALE = 4.25;
const COUNT_LABEL_FONT_SIZE = 9 * COUNT_LABEL_SCALE;
const COUNT_LABEL_HEIGHT = 13 * COUNT_LABEL_SCALE;
const COUNT_LABEL_HORIZONTAL_PADDING = 9 * COUNT_LABEL_SCALE;
const BUNDLE_CURVE_LABEL_GAP = 14;
const GroupBundleEdgeSelectionContext = createContext<
  ((edgeIds: string[]) => void) | null
>(null);

interface Point {
  x: number;
  y: number;
}

export function GroupBundleEdgeSelectionProvider({
  children,
  onSelectEdgeIds,
}: {
  children: ReactNode;
  onSelectEdgeIds: (edgeIds: string[]) => void;
}) {
  return (
    <GroupBundleEdgeSelectionContext.Provider value={onSelectEdgeIds}>
      {children}
    </GroupBundleEdgeSelectionContext.Provider>
  );
}

const pointFromEdgeCoordinates = (
  x: number | undefined,
  y: number | undefined,
  fallback: Point
): Point =>
  Number.isFinite(x) && Number.isFinite(y)
    ? { x: x as number, y: y as number }
    : fallback;

export function GroupBundleEdge({
  id,
  data,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition: edgeSourcePosition,
  targetPosition: edgeTargetPosition,
}: EdgeProps): JSX.Element | null {
  const bundle = data as GroupBundleEdgeData | undefined;
  const reactFlow = useReactFlow<FlowNode>();
  const bundledEdgeIds = bundle?.bundledEdgeIds;
  const bundledSelectedEdgeIds = bundle?.selectedEdgeIds;
  const onSelectEdgeIds = useContext(GroupBundleEdgeSelectionContext);
  const edgeIds = useMemo(
    () => bundledEdgeIds ?? [],
    [bundledEdgeIds]
  );
  const selectedEdgeIdSet = useMemo(
    () =>
      new Set(
        bundledSelectedEdgeIds && bundledSelectedEdgeIds.length > 0
          ? bundledSelectedEdgeIds
          : selected === true
            ? edgeIds
            : []
      ),
    [bundledSelectedEdgeIds, edgeIds, selected]
  );

  const sourceFallbackPoint = bundle?.sourceBoundaryPoint ?? fallbackPoint;
  const targetFallbackPoint = bundle?.targetBoundaryPoint ?? fallbackPoint;
  const sourceBoundaryPoint = pointFromEdgeCoordinates(
    sourceX,
    sourceY,
    sourceFallbackPoint
  );
  const targetBoundaryPoint = pointFromEdgeCoordinates(
    targetX,
    targetY,
    targetFallbackPoint
  );
  const sourcePosition =
    edgeSourcePosition ?? bundle?.sourcePosition ?? Position.Right;
  const targetPosition =
    edgeTargetPosition ?? bundle?.targetPosition ?? Position.Left;

  const stopBundlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>) => {
      event.stopPropagation();
    },
    []
  );

  const selectEdgeIds = useCallback(
    (event: ReactMouseEvent<SVGElement>, idsToSelect: string[]) => {
      event.preventDefault();
      event.stopPropagation();

      if (onSelectEdgeIds) {
        onSelectEdgeIds(idsToSelect);
        return;
      }

      const selectedEdgeIds = new Set(idsToSelect);

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
          if (isGroupBundleEdgeId(edge.id)) {
            const shouldSelect = edge.id === id && selectedEdgeIds.size > 0;
            const data =
              edge.id === id
                ? { ...edge.data, selectedEdgeIds: Array.from(selectedEdgeIds) }
                : { ...edge.data, selectedEdgeIds: [] };
            changed = true;
            return { ...edge, selected: shouldSelect, data };
          }

          const shouldSelect = selectedEdgeIds.has(edge.id);
          if (edge.selected === shouldSelect) return edge;
          changed = true;
          return { ...edge, selected: shouldSelect };
        });
        return changed ? next : currentEdges;
      });
    },
    [id, onSelectEdgeIds, reactFlow]
  );

  const selectBundledEdges = useCallback(
    (event: ReactMouseEvent<SVGElement>) => {
      selectEdgeIds(event, edgeIds);
    },
    [edgeIds, selectEdgeIds]
  );

  if (!bundle) return null;

  const count = bundle.count ?? edgeIds.length;
  const isGroupToGroupBundle = Boolean(bundle.sourceGroupId && bundle.targetGroupId);
  const hasSelectedPath = selected === true || selectedEdgeIdSet.size > 0;
  const [outsidePath, labelX, labelY] = getBezierPath({
    sourceX: sourceBoundaryPoint.x,
    sourceY: sourceBoundaryPoint.y,
    sourcePosition,
    targetX: targetBoundaryPoint.x,
    targetY: targetBoundaryPoint.y,
    targetPosition,
  });
  const title = `${bundle.sourceLabel} -> ${bundle.targetLabel}: ${count} edge${
    count === 1 ? "" : "s"
  }`;
  const countLabel = `x${count}`;
  const labelWidth =
    COUNT_LABEL_HORIZONTAL_PADDING + countLabel.length * COUNT_LABEL_FONT_SIZE * 0.68;
  const labelHeight = COUNT_LABEL_HEIGHT;
  const countLabelPoint = isGroupToGroupBundle
    ? {
        x: labelX,
        y: labelY - labelHeight / 2 - BUNDLE_CURVE_LABEL_GAP,
      }
    : { x: labelX, y: labelY };
  const renderedOutsidePath = outsidePath;

  const renderHitPath = (
    key: string,
    pathDefinition: string,
    hitEdgeIds: string[],
    hitKind: string
  ) => (
    <path
      key={key}
      d={pathDefinition}
      fill="none"
      stroke="transparent"
      strokeLinecap="round"
      strokeWidth={18}
      pointerEvents="stroke"
      className="group-bundle-hit-path cursor-pointer"
      data-bundle-hit={hitKind}
      onPointerDown={stopBundlePointerDown}
      onClick={(event) => selectEdgeIds(event, hitEdgeIds)}
    >
      <title>{title}</title>
    </path>
  );

  return (
    <>
      <path
        id={id}
        d={renderedOutsidePath}
        fill="none"
        stroke="hsl(var(--muted-foreground))"
        strokeLinecap="round"
        className={cn(
          "group-bundle-outside-path pointer-events-none",
          hasSelectedPath && "group-bundle-edge-path-selected"
        )}
      />
      {renderHitPath(
        "outside-hit",
        renderedOutsidePath,
        edgeIds,
        "outside-bundle"
      )}
      {count > 1 && (
        <g
          transform={`translate(${countLabelPoint.x} ${countLabelPoint.y})`}
          className="cursor-pointer"
          data-testid={`group-bundle-count-label-${id}`}
          onPointerDown={stopBundlePointerDown}
          onClick={selectBundledEdges}
        >
          <title>{title}</title>
          <rect
            x={-labelWidth / 2}
            y={-labelHeight / 2}
            width={labelWidth}
            height={labelHeight}
            rx={3 * COUNT_LABEL_SCALE}
            fill="hsl(var(--background))"
            fillOpacity={0.82}
            stroke="hsl(var(--muted-foreground) / 0.3)"
            strokeWidth={1}
          />
          <text
            y={3.2 * COUNT_LABEL_SCALE}
            textAnchor="middle"
            fill="hsl(var(--muted-foreground))"
            fillOpacity={0.76}
            fontFamily="monospace"
            fontSize={COUNT_LABEL_FONT_SIZE}
            fontWeight={700}
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
          r={hasSelectedPath ? 6 : 5}
          fill="hsl(var(--background))"
          stroke="hsl(var(--foreground))"
          strokeWidth={hasSelectedPath ? 1.8 : 1.2}
          className={cn(
            "group-bundle-port pointer-events-none",
            hasSelectedPath && "group-bundle-edge-path-selected"
          )}
        />
      )}
      {bundle.renderSourcePort && (
        <circle
          cx={sourceBoundaryPoint.x}
          cy={sourceBoundaryPoint.y}
          r={12}
          fill="transparent"
          className="cursor-pointer"
          data-bundle-hit="source-port"
          pointerEvents="fill"
          onPointerDown={stopBundlePointerDown}
          onClick={selectBundledEdges}
        >
          <title>{title}</title>
        </circle>
      )}
      {bundle.renderTargetPort && (
        <circle
          cx={targetBoundaryPoint.x}
          cy={targetBoundaryPoint.y}
          r={hasSelectedPath ? 6 : 5}
          fill="hsl(var(--background))"
          stroke="hsl(var(--foreground))"
          strokeWidth={hasSelectedPath ? 1.8 : 1.2}
          className={cn(
            "group-bundle-port pointer-events-none",
            hasSelectedPath && "group-bundle-edge-path-selected"
          )}
        />
      )}
      {bundle.renderTargetPort && (
        <circle
          cx={targetBoundaryPoint.x}
          cy={targetBoundaryPoint.y}
          r={12}
          fill="transparent"
          className="cursor-pointer"
          data-bundle-hit="target-port"
          pointerEvents="fill"
          onPointerDown={stopBundlePointerDown}
          onClick={selectBundledEdges}
        >
          <title>{title}</title>
        </circle>
      )}
    </>
  );
}
