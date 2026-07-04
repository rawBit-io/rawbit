import { describe, expect, it } from "vitest";

import {
  fitGroupAndAncestorsInNodes,
  fitGroupToChildrenInNodes,
} from "@/lib/flow/groupSizing";
import { buildFlowNode } from "@/test-utils/types";
import type { FlowNode } from "@/types";

const group = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string
): FlowNode =>
  buildFlowNode({
    id,
    type: "shadcnGroup",
    position: { x, y },
    ...(parentId ? { parentId } : {}),
    width,
    height,
    data: { width, height },
  });

describe("fitGroupAndAncestorsInNodes", () => {
  it("returns the input array when everything already fits", () => {
    // Child dimensions resolve through a 250x150 minimum fallback — size the
    // groups generously so nothing needs to grow.
    const nodes: FlowNode[] = [
      group("outer", 0, 0, 600, 500),
      group("inner", 40, 60, 400, 300, "outer"),
      buildFlowNode({
        id: "x",
        parentId: "inner",
        position: { x: 40, y: 40 },
        width: 100,
        height: 50,
      }),
    ];
    expect(fitGroupAndAncestorsInNodes(nodes, "inner")).toBe(nodes);
  });

  it("cascades growth of an inner group up to its parent", () => {
    const nodes: FlowNode[] = [
      group("outer", 0, 0, 400, 300),
      group("inner", 40, 60, 300, 200, "outer"),
      // child overflows inner to the right: 250 + 300 + padding 32 = 582 wide
      buildFlowNode({
        id: "x",
        parentId: "inner",
        position: { x: 250, y: 40 },
        width: 300,
        height: 50,
      }),
    ];

    const fitted = fitGroupAndAncestorsInNodes(nodes, "inner");
    expect(fitted).not.toBe(nodes);

    const inner = fitted.find((n) => n.id === "inner")!;
    const outer = fitted.find((n) => n.id === "outer")!;
    // inner grew to fit x…
    expect(inner.width).toBe(582);
    // …and outer grew to fit the now-larger inner (40 + 582 + 32 padding)
    expect(outer.width).toBe(654);
  });

  it("single-level fit compensates the origin so children keep absolute position (NB-05)", () => {
    const nodes: FlowNode[] = [
      group("g", 100, 100, 300, 200),
      buildFlowNode({
        id: "kid",
        parentId: "g",
        // left/above the 32px padding origin → group must grow top-left
        position: { x: -20, y: 10 },
        width: 100,
        height: 50,
      }),
    ];

    const fitted = fitGroupToChildrenInNodes(nodes, "g");
    const g = fitted.find((n) => n.id === "g")!;
    const kid = fitted.find((n) => n.id === "kid")!;
    // origin shifted by the same delta the children were shifted
    expect(g.position).toEqual({ x: 100 - 52, y: 100 - 22 });
    expect(kid.position).toEqual({ x: 32, y: 32 });
    // absolute position of the child is unchanged
    expect(g.position.x + kid.position.x).toBe(100 + -20);
    expect(g.position.y + kid.position.y).toBe(100 + 10);
  });
});
