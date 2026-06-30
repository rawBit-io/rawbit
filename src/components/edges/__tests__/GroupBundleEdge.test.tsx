import { fireEvent, render } from "@testing-library/react";
import { Position, type EdgeProps } from "@xyflow/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";

import {
  GroupBundleEdge,
  GroupBundleEdgeSelectionProvider,
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
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    setEdges,
    setNodes,
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  }),
}));

const bundleId = "__group_bundle__:group-a->group-b";

const bundleData: GroupBundleEdgeData = {
  bundledEdgeIds: ["e1", "e2", "e3"],
  selectedEdgeIds: [],
  count: 3,
  sourceGroupId: "group-a",
  targetGroupId: "group-b",
  sourceLabel: "A",
  targetLabel: "B",
  sourceBoundaryPoint: { x: 100, y: 50 },
  targetBoundaryPoint: { x: 400, y: 50 },
  renderSourcePort: true,
  renderTargetPort: true,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
};

const renderEdge = (
  data = bundleData,
  onSelectEdgeIds: (edgeIds: string[]) => void = vi.fn()
) => ({
  ...render(
    <GroupBundleEdgeSelectionProvider onSelectEdgeIds={onSelectEdgeIds}>
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
    </GroupBundleEdgeSelectionProvider>
  ),
  onSelectEdgeIds,
});

describe("GroupBundleEdge", () => {
  beforeEach(() => {
    setEdges.mockReset();
    setNodes.mockReset();
  });

  it("emits every represented path from the outside bundle", () => {
    const onSelectEdgeIds = vi.fn();
    const { container } = renderEdge(bundleData, onSelectEdgeIds);
    const outsideBundleHit = container.querySelector(
      '[data-bundle-hit="outside-bundle"]'
    );

    expect(outsideBundleHit).not.toBeNull();
    fireEvent.click(outsideBundleHit as Element);

    expect(onSelectEdgeIds).toHaveBeenCalledWith(["e1", "e2", "e3"]);
  });

  it("renders the default bundle curve", () => {
    const { container } = renderEdge(bundleData);
    const outsidePath = container.querySelector(
      ".group-bundle-outside-path"
    );

    expect(outsidePath).toHaveAttribute("d", "M 100 50 L 400 50");
  });
});
