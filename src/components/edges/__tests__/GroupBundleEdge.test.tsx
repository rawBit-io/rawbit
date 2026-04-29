import { fireEvent, render } from "@testing-library/react";
import { Position, type EdgeProps } from "@xyflow/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  GROUP_BUNDLE_EDGE_SELECT_EVENT,
  GroupBundleEdge,
} from "@/components/edges/GroupBundleEdge";
import type { GroupBundleEdgeData } from "@/lib/flow/groupEdgeBundling";

const setEdges = vi.fn();
const setNodes = vi.fn();

vi.mock("@xyflow/react", () => ({
  Position: {
    Left: "left",
    Right: "right",
    Top: "top",
    Bottom: "bottom",
  },
  getBezierPath: ({
    sourceX,
    sourceY,
    targetX,
    targetY,
  }: {
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
  }) => [`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`, 50, 0],
  useReactFlow: () => ({
    setEdges,
    setNodes,
  }),
}));

const bundleId = "__group_bundle__:group-a->group-b";

const bundleData: GroupBundleEdgeData = {
  bundledEdgeIds: ["e1", "e2", "e3"],
  selectedEdgeIds: [],
  endpointNodeIds: ["a1", "a2", "b1", "b2"],
  count: 3,
  sourceGroupId: "group-a",
  targetGroupId: "group-b",
  sourceLabel: "A",
  targetLabel: "B",
  sourcePoint: { x: 110, y: 50 },
  targetPoint: { x: 390, y: 50 },
  sourceBoundaryPoint: { x: 100, y: 50 },
  targetBoundaryPoint: { x: 400, y: 50 },
  sourceInsidePoint: { x: 90, y: 50 },
  targetInsidePoint: { x: 410, y: 50 },
  sourceTerminals: [
    {
      nodeId: "a1",
      point: { x: 20, y: 25 },
      edgeIds: ["e1", "e2"],
      edges: [
        { edgeId: "e1" },
        { edgeId: "e2" },
      ],
    },
    {
      nodeId: "a2",
      point: { x: 20, y: 75 },
      edgeIds: ["e3"],
      edges: [{ edgeId: "e3" }],
    },
  ],
  targetTerminals: [
    {
      nodeId: "b1",
      point: { x: 480, y: 25 },
      edgeIds: ["e1"],
      edges: [{ edgeId: "e1", handleId: "input-0" }],
    },
    {
      nodeId: "b2",
      point: { x: 480, y: 75 },
      edgeIds: ["e2", "e3"],
      edges: [
        { edgeId: "e2", handleId: "input-0" },
        { edgeId: "e3", handleId: "input-1" },
      ],
    },
  ],
  renderSourcePort: true,
  renderTargetPort: true,
  sourceBundleLaneIndex: 0,
  sourceBundleLaneCount: 1,
  targetBundleLaneIndex: 0,
  targetBundleLaneCount: 1,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
};

const renderEdge = (data = bundleData) =>
  render(
    <svg>
      <GroupBundleEdge
        {...({
          id: bundleId,
          data,
          selected: data.selectedEdgeIds.length > 0,
          source: "a1",
          target: "b1",
          sourceX: data.sourceBoundaryPoint.x,
          sourceY: data.sourceBoundaryPoint.y,
          targetX: data.targetBoundaryPoint.x,
          targetY: data.targetBoundaryPoint.y,
          sourcePosition: data.sourcePosition,
          targetPosition: data.targetPosition,
        } as unknown as EdgeProps)}
      />
    </svg>
  );

describe("GroupBundleEdge", () => {
  beforeEach(() => {
    setEdges.mockReset();
    setNodes.mockReset();
  });

  it("emits every represented path from the outside bundle", () => {
    const { container } = renderEdge();
    let selectedEdgeIds: string[] | undefined;
    const handleSelection = (event: Event) => {
      selectedEdgeIds = (event as CustomEvent<{ edgeIds: string[] }>).detail
        .edgeIds;
    };
    window.addEventListener(GROUP_BUNDLE_EDGE_SELECT_EVENT, handleSelection);
    const outsideBundleHit = container.querySelector(
      '[data-bundle-hit="outside-bundle"]'
    );

    expect(outsideBundleHit).not.toBeNull();
    fireEvent.click(outsideBundleHit as Element);
    window.removeEventListener(GROUP_BUNDLE_EDGE_SELECT_EVENT, handleSelection);

    expect(selectedEdgeIds).toEqual(["e1", "e2", "e3"]);
  });
});
