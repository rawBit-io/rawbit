import { render } from "@testing-library/react";
import { Position, type EdgeProps } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { GroupBundleSegmentEdge } from "@/components/edges/GroupBundleSegmentEdge";
import type { GroupBundleSegmentEdgeData } from "@/lib/flow/groupEdgeBundling";

const segmentData: GroupBundleSegmentEdgeData = {
  bundledEdgeIds: ["edge-1"],
  selectedEdgeIds: [],
  side: "source",
};

const renderSegment = (
  overrides: Partial<EdgeProps> = {},
  data: GroupBundleSegmentEdgeData = segmentData
) =>
  render(
    <svg>
      <GroupBundleSegmentEdge
        {...({
          id: "__group_bundle_segment__:source:bundle:a1:out",
          data,
          selected: false,
          source: "a1",
          target: "__group_bundle_port__:bundle:source",
          sourceX: 0,
          sourceY: 0,
          targetX: 120,
          targetY: 0,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          interactionWidth: 18,
          ...overrides,
        } as unknown as EdgeProps)}
      />
    </svg>
  );

describe("GroupBundleSegmentEdge", () => {
  it("renders dashed-looking solid path pieces without stroke-dasharray", () => {
    const { container } = renderSegment();
    const dashPath = container.querySelector(".group-bundle-segment-dash-piece");

    expect(dashPath).not.toBeNull();
    expect(dashPath).toHaveClass("react-flow__edge-path");
    expect(dashPath).not.toHaveAttribute("stroke-dasharray");
    expect(dashPath?.getAttribute("d")?.match(/\bM\b/g)?.length).toBeGreaterThan(
      1
    );
  });

  it("keeps a transparent full-curve interaction path", () => {
    const { container } = renderSegment();
    const hitPath = container.querySelector(".react-flow__edge-interaction");

    expect(hitPath).not.toBeNull();
    expect(hitPath).toHaveAttribute("stroke-opacity", "0");
    expect(hitPath).toHaveAttribute("stroke-width", "18");
    expect(hitPath?.getAttribute("d")).toContain(" C ");
  });

  it("marks selected dashed pieces with the shared selected class", () => {
    const { container } = renderSegment(
      { selected: true },
      { ...segmentData, selectedEdgeIds: ["edge-1"] }
    );
    const dashPath = container.querySelector(".group-bundle-segment-dash-piece");

    expect(dashPath).toHaveClass("group-bundle-edge-path-selected");
  });
});
