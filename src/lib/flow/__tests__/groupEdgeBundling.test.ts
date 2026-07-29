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
import p19MuSig2 from "@/my_tx_flows/p19_MuSig2.json";
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
        // dragged port keeps its persisted offset (center 100 + 40)
        sourceBoundaryPoint: { x: 300, y: 140 },
      },
    });
    expect(bundleToC).toMatchObject({
      data: {
        // NB-19: the un-dragged sibling now recovers fan-out spacing (center
        // 100 + 9) instead of collapsing to the bare center (100).
        sourceBoundaryPoint: { x: 300, y: 109 },
      },
    });
  });

  it("collapses p19 MuSig2 cross-group traffic into 13 bundles", () => {
    const nodes = p19MuSig2.nodes as FlowNode[];
    const edges = p19MuSig2.edges as Edge[];
    const rendered = buildGroupBundledEdges({ nodes, edges });
    const bundleEdges = rendered.filter((edge) =>
      edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX)
    );
    const segmentEdges = rendered.filter((edge) =>
      edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX)
    );

    expect(edges).toHaveLength(135);
    expect(rendered).toHaveLength(184);
    expect(rendered.filter((edge) => edge.hidden)).toHaveLength(0);
    expect(bundleEdges).toHaveLength(13);
    expect(segmentEdges).toHaveLength(94);
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

describe("buildGroupBundledElements dangling-handle guard", () => {
  // A transaction template inside a group, reduced to a single OUTPUTS instance
  // (keys = [3000]) so the second output's handles (3100/3110/3120) no longer
  // render. Mirrors p5's "Final Raw Transaction" builder.
  const txTemplate = (id: string) =>
    buildFlowNode({
      id,
      parentId: "group-b",
      data: {
        functionName: "concat_all",
        inputStructure: {
          ungrouped: [{ index: 0, label: "VERSION[4]:" }],
          groups: [
            {
              baseIndex: 3000,
              title: "OUTPUTS[]",
              minInstances: 1,
              maxInstances: 10,
              fields: [
                { index: 0, label: "AMOUNT[8]:" },
                { index: 10, label: "SCRIPT_PUBKEY_LENGTH:" },
                { index: 20, label: "SCRIPT_PUBKEY[]:" },
              ],
            },
          ],
        },
        groupInstanceKeys: { "OUTPUTS[]": [3000] },
      },
    });

  const sceneNodes = (): FlowNode[] => [
    buildFlowNode({
      id: "group-a",
      type: "shadcnGroup",
      position: { x: 0, y: 0 },
      data: { title: "Amounts", width: 300, height: 200 },
    }),
    buildFlowNode({
      id: "group-b",
      type: "shadcnGroup",
      position: { x: 500, y: 0 },
      data: { title: "Final TX", width: 300, height: 200 },
    }),
    txTemplate("tx"),
    buildFlowNode({ id: "sat", parentId: "group-a", data: { title: "Satoshi → LE-8" } }),
  ];

  it("excludes an edge to a removed group-instance handle (no phantom bundle to the group)", () => {
    const nodes = sceneNodes();
    const edges = [
      buildEdge({ id: "stale", source: "sat", target: "tx", targetHandle: "input-3100" }),
    ];

    const visual = buildGroupBundledElements({ nodes, edges });

    // the dangling edge must not survive as a direct edge, a bundle, or a segment
    expect(visual.edges.find((edge) => edge.id === "stale")).toBeUndefined();
    expect(
      visual.edges.some(
        (edge) =>
          edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX) ||
          edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX)
      )
    ).toBe(false);
    expect(
      visual.nodes.some((node) =>
        node.id.startsWith(GROUP_BUNDLE_PORT_NODE_ID_PREFIX)
      )
    ).toBe(false);
  });

  it("still bundles an edge to a valid handle on the same template", () => {
    const nodes = sceneNodes();
    const edges = [
      buildEdge({ id: "good", source: "sat", target: "tx", targetHandle: "input-3000" }),
    ];

    const visual = buildGroupBundledElements({ nodes, edges });

    // a valid cross-group edge is bundled (port node + bundle edge created)
    expect(
      visual.nodes.some((node) =>
        node.id.startsWith(GROUP_BUNDLE_PORT_NODE_ID_PREFIX)
      )
    ).toBe(true);
    expect(
      visual.edges.some((edge) => edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX))
    ).toBe(true);
  });
});
