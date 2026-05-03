import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import type { Edge, ReactFlowState } from "@xyflow/react";
import * as ReactFlow from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CanonicalGraphContext } from "@/contexts/canonical-graph";
import { SENTINEL_EMPTY, SENTINEL_FORCE00 } from "@/lib/nodes/constants";
import type { FlowNode, NodeData } from "@/types";

import { useCalcNodeDerived } from "../useCalcNodeDerived";

type StoreSubset = Pick<ReactFlowState, "edges"> & Partial<ReactFlowState>;

describe("useCalcNodeDerived", () => {
  const nodeId = "calc-1";
  const storeState: StoreSubset = { edges: [] };

  let nodes: FlowNode[];
  let data: NodeData;
  let setNodes: ReturnType<typeof vi.fn>;

  const makeNode = (overrides: Partial<NodeData> = {}): FlowNode => ({
    id: nodeId,
    type: "calculation",
    position: { x: 0, y: 0 },
    data: {
      functionName: "identity",
      paramExtraction: "multi_val",
      inputs: { vals: [] },
      groupInstances: {},
      groupInstanceKeys: {},
      inputStructure: {},
      ...(overrides ?? {}),
    },
    selected: false,
  });

  beforeEach(() => {
    nodes = [
      makeNode({
        paramExtraction: "multi_val",
        inputs: { vals: [SENTINEL_FORCE00, "abc", "def", SENTINEL_EMPTY, "ghi"] },
        inputStructure: {
          ungrouped: [
            { label: "Ungrouped-0", index: 0, allowEmptyBlank: true },
            { label: "Ungrouped-1", index: 1, allowEmptyBlank: true },
          ],
          groups: [
            {
              title: "Bucket",
              baseIndex: 200,
              fields: [
                { label: "G0", index: 0, allowEmptyBlank: true },
                { label: "G1", index: 1, allowEmptyBlank: true },
              ],
            },
          ],
          afterGroups: [
            { label: "Tail", index: 500, allowEmptyBlank: true },
          ],
        },
        groupInstances: { Bucket: 1 },
        groupInstanceKeys: { Bucket: [200] },
      }),
    ];

    data = nodes[0].data as NodeData;
    storeState.edges = [];

    setNodes = vi.fn((updater) => {
      nodes = updater(nodes);
      return nodes;
    });

    vi.spyOn(ReactFlow, "useStore").mockImplementation(<TSelected>(
      selector: (state: ReactFlowState) => TSelected
    ) => selector(storeState as ReactFlowState));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("derives multi-value geometry and connection status", async () => {
    storeState.edges = [
      { id: "e-1", source: "src-1", target: nodeId, targetHandle: "input-1" },
      { id: "e-2", source: "src-2", target: nodeId, targetHandle: "input-200" },
    ];

    const { result } = renderHook(() => useCalcNodeDerived(nodeId, data, setNodes));

    expect(result.current.isMultiVal).toBe(true);
    expect(result.current.nodeWidth).toBe(400);
    expect(result.current.visibleInputs).toBe(5);
    expect(result.current.minHeight).toBe(200 + 5 * 30);
    expect(Array.from(result.current.wiredHandles)).toEqual([
      "input-1",
      "input-200",
    ]);
    expect(result.current.connectionStatus).toEqual({
      connected: 3,
      total: 5,
      shouldShow: true,
    });

    await waitFor(() => {
      expect(nodes[0].data.totalInputs).toBe(5);
      expect(nodes[0].data.unwiredCount).toBe(2);
    });
  });

  it("does not count dropdown fields in connection status", async () => {
    nodes = [
      makeNode({
        paramExtraction: "multi_val",
        inputs: {
          vals: {
            0: "connected-value",
            10: "manual-option",
            20: SENTINEL_FORCE00,
            30: SENTINEL_EMPTY,
          },
        },
        inputStructure: {
          ungrouped: [
            { label: "Connected", index: 0 },
            { label: "Dropdown", index: 10, options: ["manual-option"] },
            { label: "Forced 00", index: 20, allowEmpty00: true },
            { label: "Empty", index: 30, allowEmptyBlank: true },
          ],
        },
      }),
    ];
    data = nodes[0].data as NodeData;
    storeState.edges = [
      { id: "e-1", source: "src-1", target: nodeId, targetHandle: "input-0" },
    ];

    const { result } = renderHook(() => useCalcNodeDerived(nodeId, data, setNodes));

    expect(result.current.visibleInputs).toBe(4);
    expect(result.current.connectionStatus).toEqual({
      connected: 3,
      total: 3,
      shouldShow: true,
    });

    await waitFor(() => {
      expect(nodes[0].data.totalInputs).toBe(3);
      expect(nodes[0].data.unwiredCount).toBe(0);
    });
  });

  it("uses canonical edges instead of rendered bundle edges", () => {
    storeState.edges = [
      {
        id: "visual-segment",
        source: "__group_bundle_port__:target:group-a->group-b",
        target: nodeId,
        targetHandle: "input-500",
      },
    ];
    const canonicalEdges: Edge[] = [
      { id: "raw-edge", source: "src-1", target: nodeId, targetHandle: "input-1" },
    ];
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        CanonicalGraphContext.Provider,
        { value: { nodes, edges: canonicalEdges } },
        children
      );

    const { result } = renderHook(
      () => useCalcNodeDerived(nodeId, data, setNodes),
      { wrapper }
    );

    expect(Array.from(result.current.wiredHandles)).toEqual(["input-1"]);
  });

  it("ignores wiring bookkeeping for single-value nodes", async () => {
    nodes = [
      makeNode({
        paramExtraction: "single_val",
        inputs: { vals: ["value"] },
        inputStructure: {
          ungrouped: [{ label: "Only", index: 0, allowEmptyBlank: true }],
        },
      }),
    ];
    data = nodes[0].data as NodeData;

    const { result } = renderHook(() => useCalcNodeDerived(nodeId, data, setNodes));

    expect(result.current.isMultiVal).toBe(false);
    expect(result.current.nodeWidth).toBe(250);
    expect(result.current.minHeight).toBe(100);
    expect(result.current.connectionStatus.shouldShow).toBe(false);
    expect(setNodes).not.toHaveBeenCalled();
  });
});
