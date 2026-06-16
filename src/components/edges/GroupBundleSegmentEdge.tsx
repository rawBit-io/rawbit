import { Position, type EdgeProps } from "@xyflow/react";
import { useMemo } from "react";

import type { GroupBundleSegmentEdgeData } from "@/lib/flow/groupEdgeBundling";
import { cn } from "@/lib/utils";

type Point = {
  x: number;
  y: number;
};

const DEFAULT_CURVATURE = 0.25;
const REGULAR_DASH_LENGTH = 6;
const REGULAR_DASH_GAP = 5;
const SELECTED_DASH_LENGTH = 7;
const SELECTED_DASH_GAP = 5;
const BEZIER_SAMPLE_COUNT = 72;

const calculateControlOffset = (distance: number, curvature: number): number =>
  distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);

const getControlWithCurvature = ({
  position,
  x1,
  y1,
  x2,
  y2,
  curvature,
}: {
  position: Position;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  curvature: number;
}): Point => {
  switch (position) {
    case Position.Left:
      return { x: x1 - calculateControlOffset(x1 - x2, curvature), y: y1 };
    case Position.Right:
      return { x: x1 + calculateControlOffset(x2 - x1, curvature), y: y1 };
    case Position.Top:
      return { x: x1, y: y1 - calculateControlOffset(y1 - y2, curvature) };
    case Position.Bottom:
    default:
      return { x: x1, y: y1 + calculateControlOffset(y2 - y1, curvature) };
  }
};

const cubicBezierPoint = (
  t: number,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point
): Point => {
  const inv = 1 - t;
  const inv2 = inv * inv;
  const t2 = t * t;
  return {
    x:
      inv2 * inv * p0.x +
      3 * inv2 * t * p1.x +
      3 * inv * t2 * p2.x +
      t2 * t * p3.x,
    y:
      inv2 * inv * p0.y +
      3 * inv2 * t * p1.y +
      3 * inv * t2 * p2.y +
      t2 * t * p3.y,
  };
};

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

type Sample = Point & {
  length: number;
};

const buildBezierSamples = (
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point
): Sample[] => {
  const samples: Sample[] = [{ ...p0, length: 0 }];
  let previous = p0;
  let total = 0;

  for (let index = 1; index <= BEZIER_SAMPLE_COUNT; index += 1) {
    const point = cubicBezierPoint(index / BEZIER_SAMPLE_COUNT, p0, p1, p2, p3);
    total += distance(previous, point);
    samples.push({ ...point, length: total });
    previous = point;
  }

  return samples;
};

const pointAtLength = (samples: Sample[], targetLength: number): Point => {
  if (targetLength <= 0) return samples[0] ?? { x: 0, y: 0 };
  const lastSample = samples[samples.length - 1];
  if (!lastSample || targetLength >= lastSample.length) {
    return lastSample ?? { x: 0, y: 0 };
  }

  let low = 1;
  let high = samples.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const sample = samples[mid];
    if (!sample || sample.length < targetLength) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const sample = samples[low];
  const previous = samples[low - 1];
  if (!sample || !previous) return lastSample;
  const segmentLength = sample.length - previous.length;
  if (segmentLength <= 0) return sample;
  const ratio = (targetLength - previous.length) / segmentLength;
  return {
    x: previous.x + (sample.x - previous.x) * ratio,
    y: previous.y + (sample.y - previous.y) * ratio,
  };
};

const formatPoint = ({ x, y }: Point): string =>
  `${Number(x.toFixed(2))} ${Number(y.toFixed(2))}`;

const buildSolidDashPath = (
  samples: Sample[],
  dashLength: number,
  gapLength: number
): string => {
  const totalLength = samples[samples.length - 1]?.length ?? 0;
  if (totalLength <= 0) return "";

  const commands: string[] = [];
  const step = dashLength + gapLength;
  for (let start = 0; start < totalLength; start += step) {
    const end = Math.min(start + dashLength, totalLength);
    if (end - start < 0.5) continue;
    commands.push(
      `M ${formatPoint(pointAtLength(samples, start))} L ${formatPoint(
        pointAtLength(samples, end)
      )}`
    );
  }

  return commands.join(" ");
};

export function GroupBundleSegmentEdge({
  id,
  data,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Bottom,
  targetPosition = Position.Top,
  pathOptions,
  interactionWidth = 18,
}: EdgeProps): JSX.Element {
  const segmentData = data as GroupBundleSegmentEdgeData | undefined;
  const hasSelectedPath =
    selected === true || (segmentData?.selectedEdgeIds?.length ?? 0) > 0;
  const curvature =
    typeof pathOptions?.curvature === "number"
      ? pathOptions.curvature
      : DEFAULT_CURVATURE;
  const { fullPath, dashPath } = useMemo(() => {
    const source = { x: sourceX, y: sourceY };
    const target = { x: targetX, y: targetY };
    const sourceControl = getControlWithCurvature({
      position: sourcePosition,
      x1: sourceX,
      y1: sourceY,
      x2: targetX,
      y2: targetY,
      curvature,
    });
    const targetControl = getControlWithCurvature({
      position: targetPosition,
      x1: targetX,
      y1: targetY,
      x2: sourceX,
      y2: sourceY,
      curvature,
    });
    return {
      fullPath: `M ${formatPoint(source)} C ${formatPoint(
        sourceControl
      )} ${formatPoint(targetControl)} ${formatPoint(target)}`,
      dashPath: buildSolidDashPath(
        buildBezierSamples(source, sourceControl, targetControl, target),
        hasSelectedPath ? SELECTED_DASH_LENGTH : REGULAR_DASH_LENGTH,
        hasSelectedPath ? SELECTED_DASH_GAP : REGULAR_DASH_GAP
      ),
    };
  }, [
    curvature,
    hasSelectedPath,
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  ]);

  return (
    <>
      <path
        id={id}
        d={dashPath}
        fill="none"
        stroke="hsl(var(--muted-foreground))"
        strokeLinecap="round"
        className={cn(
          "react-flow__edge-path group-bundle-segment-dash-piece pointer-events-none",
          hasSelectedPath && "group-bundle-edge-path-selected"
        )}
      />
      <path
        d={fullPath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={interactionWidth}
        className="react-flow__edge-interaction"
      />
    </>
  );
}
