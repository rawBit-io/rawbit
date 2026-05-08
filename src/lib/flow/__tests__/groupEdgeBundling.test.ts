import { describe, expect, it } from "vitest";
import { Position, type Edge } from "@xyflow/react";

import {
  buildGroupBundledElements,
  buildGroupBundledEdges,
  GROUP_BUNDLE_EDGE_ID_PREFIX,
  GROUP_BUNDLE_PORT_NODE_ID_PREFIX,
  GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX,
  sanitizeGroupBundleVisualElementsForState,
} from "@/lib/flow/groupEdgeBundling";
import p14MuSig2 from "@/my_tx_flows/p14_MuSig2.json";
import { buildEdge, buildFlowNode } from "@/test-utils/types";
import type { FlowNode } from "@/types";

describe("buildGroupBundledEdges", () => {
  it("replaces repeated cross-group edges with segments and one bundle edge", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "Inputs", width: 300, height: 200 },
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "Outputs", width: 300, height: 200 },
      }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({ id: "a2", parentId: "group-a" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
      buildFlowNode({ id: "b2", parentId: "group-b" }),
    ];
    const edges: Edge[] = [
      buildEdge({ id: "e1", source: "a1", target: "b1" }),
      buildEdge({ id: "e2", source: "a2", target: "b2", selected: true }),
      buildEdge({ id: "internal", source: "a1", target: "a2" }),
    ];

    const rendered = buildGroupBundledEdges({ nodes, edges });
    const bundle = rendered.find((edge) =>
      edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX)
    );

    expect(rendered).toHaveLength(6);
    expect(rendered.find((edge) => edge.id === "e1")).toBeUndefined();
    expect(rendered.find((edge) => edge.id === "e2")).toBeUndefined();
    expect(rendered.find((edge) => edge.id === "internal")?.hidden).toBe(
      undefined
    );
    expect(
      rendered.filter((edge) =>
        edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX)
      )
    ).toHaveLength(4);
    expect(
      rendered
        .filter((edge) =>
          edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX)
        )
        .every(
          (edge) =>
            edge.reconnectable === "source" || edge.reconnectable === "target"
        )
    ).toBe(true);
    expect(bundle).toMatchObject({
      id: "__group_bundle__:group-a->group-b",
      type: "groupBundle",
      source: "__group_bundle_port__:source:group-a->group-b",
      target: "__group_bundle_port__:target:group-a->group-b",
      selected: true,
      data: {
        bundledEdgeIds: ["e1", "e2"],
        selectedEdgeIds: ["e2"],
        count: 2,
        sourceGroupId: "group-a",
        targetGroupId: "group-b",
        sourceLabel: "Inputs",
        targetLabel: "Outputs",
        sourceBoundaryPoint: { x: 300, y: 100 },
        targetBoundaryPoint: { x: 500, y: 100 },
      },
    });
  });

  it("routes single cross-group edges through boundary ports", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({ id: "group-a", type: "shadcnGroup" }),
      buildFlowNode({ id: "group-b", type: "shadcnGroup" }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
    ];
    const edges = [buildEdge({ id: "e1", source: "a1", target: "b1" })];

    const visual = buildGroupBundledElements({ nodes, edges });
    const rendered = visual.edges;
    const bundle = rendered.find((edge) =>
      edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX)
    );

    expect(visual.nodes).toHaveLength(nodes.length + 2);
    expect(
      visual.nodes.filter((node) =>
        node.id.startsWith(GROUP_BUNDLE_PORT_NODE_ID_PREFIX)
      )
    ).toHaveLength(2);
    expect(rendered.find((edge) => edge.id === "e1")).toBeUndefined();
    expect(
      rendered.filter((edge) =>
        edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX)
      )
    ).toHaveLength(2);
    expect(
      rendered.find(
        (edge) =>
          edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX) &&
          edge.data?.side === "source"
      )
    ).toMatchObject({
      reconnectable: "source",
      data: {
        bundledEdgeIds: ["e1"],
        side: "source",
      },
    });
    expect(
      rendered.find(
        (edge) =>
          edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX) &&
          edge.data?.side === "target"
      )
    ).toMatchObject({
      reconnectable: "target",
      data: {
        bundledEdgeIds: ["e1"],
        side: "target",
      },
    });
    expect(bundle).toMatchObject({
      id: "__group_bundle__:group-a->group-b",
      data: {
        bundledEdgeIds: ["e1"],
        count: 1,
      },
    });
    expect(sanitizeGroupBundleVisualElementsForState(visual)).toEqual({
      nodes,
      edges,
    });
  });

  it("does not render bundle artifacts for stale edges with missing nodes", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({ id: "group-a", type: "shadcnGroup" }),
      buildFlowNode({ id: "group-b", type: "shadcnGroup" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
    ];
    const edges = [
      buildEdge({ id: "stale", source: "deleted-node", target: "b1" }),
    ];

    const visual = buildGroupBundledElements({ nodes, edges });

    expect(visual.edges).toEqual([]);
    expect(
      visual.nodes.some((node) =>
        node.id.startsWith(GROUP_BUNDLE_PORT_NODE_ID_PREFIX)
      )
    ).toBe(false);
  });

  it("keeps grouped source edges to ungrouped targets direct", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "Inputs", width: 300, height: 200 },
      }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({
        id: "outside",
        position: { x: 500, y: 40 },
        data: { title: "Outside" },
      }),
    ];
    const edges = [
      buildEdge({
        id: "e1",
        source: "a1",
        target: "outside",
        targetHandle: "in",
      }),
    ];

    const visual = buildGroupBundledElements({ nodes, edges });

    expect(visual.nodes).toEqual(nodes);
    expect(visual.edges).toEqual(edges);
    expect(
      visual.nodes.some((node) =>
        node.id.startsWith(GROUP_BUNDLE_PORT_NODE_ID_PREFIX)
      )
    ).toBe(false);
    expect(
      visual.edges.some(
        (edge) =>
          edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX) ||
          edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX)
      )
    ).toBe(false);
  });

  it("keeps ungrouped source edges to grouped targets direct", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({
        id: "outside",
        position: { x: 0, y: 40 },
        data: { title: "Outside" },
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "Outputs", width: 300, height: 200 },
      }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
    ];
    const edges = [
      buildEdge({
        id: "e1",
        source: "outside",
        sourceHandle: "out",
        target: "b1",
      }),
    ];

    const visual = buildGroupBundledElements({ nodes, edges });

    expect(visual.nodes).toEqual(nodes);
    expect(visual.edges).toEqual(edges);
    expect(
      visual.nodes.some((node) =>
        node.id.startsWith(GROUP_BUNDLE_PORT_NODE_ID_PREFIX)
      )
    ).toBe(false);
    expect(
      visual.edges.some(
        (edge) =>
          edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX) ||
          edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX)
      )
    ).toBe(false);
  });

  it("does not bundle direct edges between grouped child nodes and group nodes", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
    ];
    const edges: Edge[] = [
      buildEdge({ id: "child-to-group", source: "a1", target: "group-b" }),
      buildEdge({ id: "group-to-child", source: "group-a", target: "b1" }),
    ];

    const visual = buildGroupBundledElements({ nodes, edges });

    expect(visual.nodes).toEqual(nodes);
    expect(visual.edges).toEqual(edges);
    expect(
      visual.nodes.some((node) =>
        node.id.startsWith(GROUP_BUNDLE_PORT_NODE_ID_PREFIX)
      )
    ).toBe(false);
    expect(
      visual.edges.some(
        (edge) =>
          edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX) ||
          edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX)
      )
    ).toBe(false);
  });

  it("uses one fixed right output port and one fixed left input port per group", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 0, y: 500 },
        data: { title: "B", width: 300, height: 200 },
      }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({ id: "a2", parentId: "group-a" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
    ];
    const edges: Edge[] = [
      buildEdge({ id: "before", source: "a1", target: "a2" }),
      buildEdge({ id: "e1", source: "a1", target: "b1" }),
      buildEdge({ id: "between", source: "a2", target: "a1" }),
      buildEdge({ id: "e2", source: "a2", target: "b1" }),
    ];

    const bundle = buildGroupBundledEdges({ nodes, edges }).find((edge) =>
      edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX)
    );

    expect(bundle).toMatchObject({
      data: {
        sourceBoundaryPoint: { x: 300, y: 100 },
        targetBoundaryPoint: { x: 0, y: 600 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
    });
  });

  it("applies persisted vertical port offsets", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: {
          title: "A",
          width: 300,
          height: 200,
          groupBundlePortOffsets: { source: 40 },
        },
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: {
          title: "B",
          width: 300,
          height: 200,
          groupBundlePortOffsets: { target: -30 },
        },
      }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
    ];
    const edges: Edge[] = [buildEdge({ id: "e1", source: "a1", target: "b1" })];

    const bundle = buildGroupBundledEdges({ nodes, edges }).find((edge) =>
      edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX)
    );

    expect(bundle).toMatchObject({
      data: {
        sourceBoundaryPoint: { x: 300, y: 140 },
        targetBoundaryPoint: { x: 500, y: 70 },
      },
    });
  });

  it("spaces multiple unmoved ports on the same group side", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      }),
      buildFlowNode({
        id: "group-c",
        type: "shadcnGroup",
        position: { x: 500, y: 300 },
        data: { title: "C", width: 300, height: 200 },
      }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({ id: "a2", parentId: "group-a" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
      buildFlowNode({ id: "c1", parentId: "group-c" }),
    ];
    const edges: Edge[] = [
      buildEdge({ id: "e1", source: "a1", target: "b1" }),
      buildEdge({ id: "e2", source: "a2", target: "c1" }),
    ];

    const rendered = buildGroupBundledEdges({ nodes, edges });
    const bundleToB = rendered.find(
      (edge) => edge.id === "__group_bundle__:group-a->group-b"
    );
    const bundleToC = rendered.find(
      (edge) => edge.id === "__group_bundle__:group-a->group-c"
    );

    expect(bundleToB).toMatchObject({
      data: {
        sourceBoundaryPoint: { x: 300, y: 91 },
      },
    });
    expect(bundleToC).toMatchObject({
      data: {
        sourceBoundaryPoint: { x: 300, y: 109 },
      },
    });
  });

  it("applies per-bundle vertical port offsets independently", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: {
          title: "A",
          width: 300,
          height: 200,
          groupBundlePortOffsets: {
            sourceByBundle: {
              "group-a->group-b": 40,
            },
          },
        },
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      }),
      buildFlowNode({
        id: "group-c",
        type: "shadcnGroup",
        position: { x: 500, y: 300 },
        data: { title: "C", width: 300, height: 200 },
      }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({ id: "a2", parentId: "group-a" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
      buildFlowNode({ id: "c1", parentId: "group-c" }),
    ];
    const edges: Edge[] = [
      buildEdge({ id: "e1", source: "a1", target: "b1" }),
      buildEdge({ id: "e2", source: "a2", target: "c1" }),
    ];

    const rendered = buildGroupBundledEdges({ nodes, edges });
    const bundleToB = rendered.find(
      (edge) => edge.id === "__group_bundle__:group-a->group-b"
    );
    const bundleToC = rendered.find(
      (edge) => edge.id === "__group_bundle__:group-a->group-c"
    );

    expect(bundleToB).toMatchObject({
      data: {
        sourceBoundaryPoint: { x: 300, y: 140 },
      },
    });
    expect(bundleToC).toMatchObject({
      data: {
        sourceBoundaryPoint: { x: 300, y: 100 },
      },
    });
  });

  it("collapses p14 MuSig2 cross-group traffic from 63 raw edges to 10 bundles", () => {
    const nodes = p14MuSig2.nodes as FlowNode[];
    const edges = p14MuSig2.edges as Edge[];
    const rendered = buildGroupBundledEdges({ nodes, edges });
    const bundleEdges = rendered.filter((edge) =>
      edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX)
    );
    const segmentEdges = rendered.filter((edge) =>
      edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX)
    );

    expect(edges).toHaveLength(151);
    expect(rendered).toHaveLength(194);
    expect(rendered.filter((edge) => edge.hidden)).toHaveLength(0);
    expect(bundleEdges).toHaveLength(10);
    expect(segmentEdges).toHaveLength(96);
  });

  it("is idempotent when given an already projected visual graph", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({ id: "a2", parentId: "group-a" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
    ];
    const edges: Edge[] = [
      buildEdge({ id: "e1", source: "a1", target: "b1" }),
      buildEdge({ id: "e2", source: "a2", target: "b1" }),
    ];

    const once = buildGroupBundledElements({ nodes, edges });
    const twice = buildGroupBundledElements(once);

    expect(twice.nodes).toHaveLength(once.nodes.length);
    expect(twice.edges).toHaveLength(once.edges.length);
    expect(new Set(twice.nodes.map((node) => node.id)).size).toBe(
      twice.nodes.length
    );
    expect(new Set(twice.edges.map((edge) => edge.id)).size).toBe(
      twice.edges.length
    );
    expect(twice.nodes.map((node) => node.id)).toEqual(
      once.nodes.map((node) => node.id)
    );
    expect(twice.edges.map((edge) => edge.id)).toEqual(
      once.edges.map((edge) => edge.id)
    );
  });

  it("sanitizes generated bundle elements back to canonical graph state", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({ id: "a2", parentId: "group-a" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
    ];
    const edges: Edge[] = [
      buildEdge({ id: "before", source: "a1", target: "a2" }),
      buildEdge({ id: "e1", source: "a1", target: "b1" }),
      buildEdge({ id: "between", source: "a2", target: "a1" }),
      buildEdge({ id: "e2", source: "a2", target: "b1" }),
    ];

    const visual = buildGroupBundledElements({ nodes, edges });
    const canonical = sanitizeGroupBundleVisualElementsForState(visual);

    expect(canonical.nodes).toEqual(nodes);
    expect(canonical.edges).toEqual(edges);
    expect(
      canonical.nodes.some((node) =>
        node.id.startsWith(GROUP_BUNDLE_PORT_NODE_ID_PREFIX)
      )
    ).toBe(false);
    expect(
      canonical.edges.some(
        (edge) =>
          edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX) ||
          edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX) ||
          edge.hidden === true
      )
    ).toBe(false);
  });
});
