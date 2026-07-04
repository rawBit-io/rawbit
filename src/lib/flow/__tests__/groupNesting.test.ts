import { describe, expect, it } from "vitest";

import {
  absolutePositionOf,
  ancestorGroupChain,
  buildGroupMaps,
  isDescendantOf,
  nestingDepthOf,
  orderNodesParentsFirst,
  resolveBundleEndpointGroups,
  type ParentChainNode,
} from "@/lib/flow/groupNesting";

// Topology used across the tests:
//   outer  (group, top-level)
//     inner  (group, inside outer)
//       x    (node, inside inner)
//     y      (node, directly inside outer)
//   other  (group, top-level)
//     z      (node, inside other)
//   free   (plain top-level node)
const NODES: ParentChainNode[] = [
  { id: "outer", type: "shadcnGroup", position: { x: 100, y: 50 } },
  {
    id: "inner",
    type: "shadcnGroup",
    parentId: "outer",
    position: { x: 40, y: 60 },
  },
  { id: "x", parentId: "inner", position: { x: 10, y: 20 } },
  { id: "y", parentId: "outer", position: { x: 30, y: 30 } },
  { id: "other", type: "shadcnGroup", position: { x: 900, y: 0 } },
  { id: "z", parentId: "other", position: { x: 5, y: 5 } },
  { id: "free", position: { x: 700, y: 700 } },
];

const maps = buildGroupMaps(NODES);

describe("ancestorGroupChain", () => {
  it("walks innermost → outermost and includes the node itself when a group", () => {
    expect(ancestorGroupChain("x", maps)).toEqual(["inner", "outer"]);
    expect(ancestorGroupChain("inner", maps)).toEqual(["inner", "outer"]);
    expect(ancestorGroupChain("free", maps)).toEqual([]);
  });

  it("is cycle-safe", () => {
    const cyclic = buildGroupMaps([
      { id: "a", type: "shadcnGroup", parentId: "b" },
      { id: "b", type: "shadcnGroup", parentId: "a" },
    ]);
    expect(ancestorGroupChain("a", cyclic)).toEqual(["a", "b"]);
  });
});

describe("resolveBundleEndpointGroups", () => {
  it("bundles nested traffic at the OUTERMOST group not containing the other endpoint", () => {
    expect(resolveBundleEndpointGroups("x", "z", maps)).toEqual({
      sourceGroupId: "outer",
      targetGroupId: "other",
    });
  });

  it("bundles sibling sub-contexts at their own boundaries inside the shared ancestor", () => {
    const withSibling = buildGroupMaps([
      ...NODES,
      {
        id: "inner2",
        type: "shadcnGroup",
        parentId: "outer",
        position: { x: 200, y: 60 },
      },
      { id: "w", parentId: "inner2", position: { x: 1, y: 1 } },
    ]);
    expect(resolveBundleEndpointGroups("x", "w", withSibling)).toEqual({
      sourceGroupId: "inner",
      targetGroupId: "inner2",
    });
  });

  it("leaves same-context and mixed edges unbundled", () => {
    // same innermost group
    expect(resolveBundleEndpointGroups("x", "x", maps)).toEqual({
      sourceGroupId: undefined,
      targetGroupId: undefined,
    });
    // nested child ↔ node in the containing group: y's only ancestor (outer)
    // also contains x → no target endpoint → stays direct
    expect(resolveBundleEndpointGroups("x", "y", maps)).toEqual({
      sourceGroupId: "inner",
      targetGroupId: undefined,
    });
    // grouped ↔ plain top-level node
    expect(resolveBundleEndpointGroups("x", "free", maps)).toEqual({
      sourceGroupId: "outer",
      targetGroupId: undefined,
    });
  });
});

describe("absolutePositionOf / depth / descendants", () => {
  it("accumulates positions over the parent chain", () => {
    expect(absolutePositionOf("x", maps)).toEqual({ x: 150, y: 130 });
    expect(absolutePositionOf("inner", maps)).toEqual({ x: 140, y: 110 });
    expect(absolutePositionOf("free", maps)).toEqual({ x: 700, y: 700 });
  });

  it("computes nesting depth and descendant relations", () => {
    expect(nestingDepthOf("x", maps)).toBe(2);
    expect(nestingDepthOf("inner", maps)).toBe(1);
    expect(nestingDepthOf("outer", maps)).toBe(0);
    expect(isDescendantOf("x", "outer", maps)).toBe(true);
    expect(isDescendantOf("inner", "outer", maps)).toBe(true);
    expect(isDescendantOf("outer", "inner", maps)).toBe(false);
    expect(isDescendantOf("z", "outer", maps)).toBe(false);
  });
});

describe("orderNodesParentsFirst", () => {
  it("returns the same array reference when already ordered", () => {
    expect(orderNodesParentsFirst(NODES)).toBe(NODES);
  });

  it("moves parents before children across nesting levels", () => {
    const shuffled: ParentChainNode[] = [
      { id: "x", parentId: "inner" },
      { id: "inner", type: "shadcnGroup", parentId: "outer" },
      { id: "free" },
      { id: "outer", type: "shadcnGroup" },
    ];
    const ordered = orderNodesParentsFirst(shuffled).map((n) => n.id);
    expect(ordered.indexOf("outer")).toBeLessThan(ordered.indexOf("inner"));
    expect(ordered.indexOf("inner")).toBeLessThan(ordered.indexOf("x"));
    expect(ordered).toHaveLength(4);
    expect(new Set(ordered).size).toBe(4);
  });

  it("keeps cyclic/orphaned parents from being dropped", () => {
    const cyclic: ParentChainNode[] = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
      { id: "solo" },
    ];
    const ordered = orderNodesParentsFirst(cyclic);
    expect(ordered.map((n) => n.id).sort()).toEqual(["a", "b", "solo"]);
  });
});
