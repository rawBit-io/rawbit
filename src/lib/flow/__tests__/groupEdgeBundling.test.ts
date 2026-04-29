import { describe, expect, it } from "vitest";
import { Position, type Edge } from "@xyflow/react";

import {
  buildGroupBundledEdges,
  GROUP_BUNDLE_EDGE_ID_PREFIX,
  GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX,
  type GroupBundleEdgeData,
} from "@/lib/flow/groupEdgeBundling";
import p14MuSig2 from "@/my_tx_flows/p14_MuSig2.json";
import { buildEdge, buildFlowNode } from "@/test-utils/types";
import type { FlowNode } from "@/types";

describe("buildGroupBundledEdges", () => {
  it("hides repeated cross-group edges and adds one bundle edge", () => {
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

    expect(rendered).toHaveLength(8);
    expect(rendered.find((edge) => edge.id === "e1")).toMatchObject({
      hidden: true,
    });
    expect(rendered.find((edge) => edge.id === "e2")).toMatchObject({
      hidden: true,
    });
    expect(rendered.find((edge) => edge.id === "internal")?.hidden).toBe(
      undefined
    );
    expect(
      rendered.filter((edge) =>
        edge.id.startsWith(GROUP_BUNDLE_SEGMENT_EDGE_ID_PREFIX)
      )
    ).toHaveLength(4);
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
        sourceInsidePoint: { x: 288, y: 100 },
        sourcePoint: { x: 328, y: 100 },
        targetBoundaryPoint: { x: 500, y: 100 },
        targetInsidePoint: { x: 512, y: 100 },
        targetPoint: { x: 472, y: 100 },
      },
    });
    const data = bundle?.data as GroupBundleEdgeData | undefined;
    expect(data?.sourceTerminals).toHaveLength(2);
    expect(data?.targetTerminals).toHaveLength(2);
    expect(data?.sourceTerminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: "a1", edgeIds: ["e1"] }),
        expect.objectContaining({ nodeId: "a2", edgeIds: ["e2"] }),
      ])
    );
    expect(data?.targetTerminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: "b1", edgeIds: ["e1"] }),
        expect.objectContaining({ nodeId: "b2", edgeIds: ["e2"] }),
      ])
    );
  });

  it("leaves single cross-group edges as normal detailed edges", () => {
    const nodes: FlowNode[] = [
      buildFlowNode({ id: "group-a", type: "shadcnGroup" }),
      buildFlowNode({ id: "group-b", type: "shadcnGroup" }),
      buildFlowNode({ id: "a1", parentId: "group-a" }),
      buildFlowNode({ id: "b1", parentId: "group-b" }),
    ];
    const edges = [buildEdge({ id: "e1", source: "a1", target: "b1" })];

    expect(buildGroupBundledEdges({ nodes, edges })).toBe(edges);
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
      buildEdge({ id: "e1", source: "a1", target: "b1" }),
      buildEdge({ id: "e2", source: "a2", target: "b1" }),
    ];

    const bundle = buildGroupBundledEdges({ nodes, edges }).find((edge) =>
      edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX)
    );

    expect(bundle).toMatchObject({
      data: {
        sourceBoundaryPoint: { x: 300, y: 100 },
        sourceInsidePoint: { x: 288, y: 100 },
        sourcePoint: { x: 328, y: 100 },
        targetBoundaryPoint: { x: 0, y: 600 },
        targetInsidePoint: { x: 12, y: 600 },
        targetPoint: { x: -28, y: 600 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
    });
  });

  it("collapses p14 MuSig2 cross-group traffic from 63 raw edges to 10 bundles", () => {
    const nodes = p14MuSig2.nodes as FlowNode[];
    const edges = p14MuSig2.edges as Edge[];
    const rendered = buildGroupBundledEdges({ nodes, edges });
    const hiddenCrossEdges = rendered.filter((edge) => edge.hidden);
    const bundleEdges = rendered.filter((edge) =>
      edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX)
    );

    expect(edges).toHaveLength(151);
    expect(hiddenCrossEdges).toHaveLength(63);
    expect(bundleEdges).toHaveLength(10);
  });
});
