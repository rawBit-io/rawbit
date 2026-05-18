import { act, renderHook, waitFor } from "@testing-library/react";
import type { Edge } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { INSTANCE_STRIDE } from "@/lib/utils";
import type { FlowNode, GroupDefinition, NodeData } from "@/types";

import { useGroupInstances } from "../useGroupInstances";

describe("useGroupInstances", () => {
  const nodeId = "node-1";
  const groupDef: GroupDefinition = {
    title: "Outputs",
    baseIndex: 200,
    fields: [
      { label: "G0", index: 0, allowEmptyBlank: true },
      { label: "G1", index: 1, allowEmptyBlank: true },
    ],
    minInstances: 1,
  };

  let nodes: FlowNode[];
  let edges: Edge[];
  let setNodes: ReturnType<typeof vi.fn>;
  let setEdges: ReturnType<typeof vi.fn>;
  let data: NodeData;

  const makeNode = (overrides: Partial<NodeData> = {}): FlowNode => ({
    id: nodeId,
    type: "calculation",
    position: { x: 0, y: 0 },
    data: {
      functionName: "identity",
      inputStructure: {
        groups: [groupDef],
      },
      groupInstances: { Outputs: 2 },
      ...(overrides ?? {}),
    },
    selected: false,
  });

  beforeEach(() => {
    nodes = [
      makeNode({
        groupInstances: { Outputs: 2 },
        groupInstanceKeys: undefined,
      }),
    ];
    data = nodes[0].data as NodeData;

    edges = [];

    setNodes = vi.fn((updater) => {
      nodes = updater(nodes);
      return nodes;
    });

    setEdges = vi.fn((updater) => {
      edges = updater(edges);
      return edges;
    });
  });

  it("hydrates missing group instance keys on mount", async () => {
    renderHook(() =>
      useGroupInstances(nodeId, data, setNodes, setEdges)
    );

    await waitFor(() => {
      expect(nodes[0].data.groupInstanceKeys?.Outputs).toEqual([
        groupDef.baseIndex,
        groupDef.baseIndex + INSTANCE_STRIDE,
      ]);
    });
  });

  it("grows a group instance and marks the node dirty", () => {
    nodes = [
      makeNode({
        groupInstances: { Outputs: 1 },
        groupInstanceKeys: { Outputs: [groupDef.baseIndex] },
      }),
    ];
    data = nodes[0].data as NodeData;

    const { result } = renderHook(() =>
      useGroupInstances(nodeId, data, setNodes, setEdges)
    );

    act(() => {
      result.current.handleGroupSize("Outputs", groupDef, true);
    });

    expect(nodes[0].data.groupInstances?.Outputs).toBe(2);
    expect(nodes[0].data.groupInstanceKeys?.Outputs).toEqual([
      groupDef.baseIndex,
      groupDef.baseIndex + INSTANCE_STRIDE,
    ]);
    expect(nodes[0].data.dirty).toBe(true);
  });

  it("shrinks a group instance and removes matching edges", () => {
    const removedOffset = groupDef.baseIndex + INSTANCE_STRIDE;
    edges = [
      {
        id: "edge-keep",
        source: "a",
        target: nodeId,
        targetHandle: "input-1000",
      },
      {
        id: "edge-drop",
        source: "b",
        target: nodeId,
        targetHandle: `input-${removedOffset}`,
      },
    ];

    nodes = [
      makeNode({
        groupInstances: { Outputs: 2 },
        groupInstanceKeys: { Outputs: [groupDef.baseIndex, removedOffset] },
      }),
    ];
    data = nodes[0].data as NodeData;

    const { result } = renderHook(() =>
      useGroupInstances(nodeId, data, setNodes, setEdges)
    );

    act(() => {
      result.current.handleGroupSize("Outputs", groupDef, false);
    });

    expect(edges).toEqual([
      {
        id: "edge-keep",
        source: "a",
        target: nodeId,
        targetHandle: "input-1000",
      },
    ]);
    expect(nodes[0].data.groupInstances?.Outputs).toBe(1);
    expect(nodes[0].data.groupInstanceKeys?.Outputs).toEqual([groupDef.baseIndex]);
    expect(nodes[0].data.dirty).toBe(true);
  });

  it("respects minimum instance constraints when shrinking", () => {
    nodes = [
      makeNode({
        groupInstances: { Outputs: 1 },
        groupInstanceKeys: { Outputs: [groupDef.baseIndex] },
      }),
    ];
    data = nodes[0].data as NodeData;

    const { result } = renderHook(() =>
      useGroupInstances(nodeId, data, setNodes, setEdges)
    );

    const initialCallCount = setNodes.mock.calls.length;

    act(() => {
      result.current.handleGroupSize("Outputs", groupDef, false);
    });

    expect(setNodes.mock.calls.length).toBe(initialCallCount);
  });
});
