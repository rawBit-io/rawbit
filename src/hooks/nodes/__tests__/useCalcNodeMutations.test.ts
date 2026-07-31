import { act, renderHook } from "@testing-library/react";
import type { Edge } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SENTINEL_EMPTY, SENTINEL_FORCE00 } from "@/lib/nodes/constants";
import type { FlowNode } from "@/types";

vi.mock("@/lib/share/scriptStepsCache", () => ({
  removeScriptSteps: vi.fn(),
}));

import { useCalcNodeMutations } from "../useCalcNodeMutations";
import { removeScriptSteps } from "@/lib/share/scriptStepsCache";

describe("useCalcNodeMutations", () => {
  const nodeId = "node-1";

  let nodes: FlowNode[];
  let edges: Edge[];
  let setNodes: ReturnType<typeof vi.fn>;
  let setEdges: ReturnType<typeof vi.fn>;

  const baseNode = (): FlowNode => ({
    id: nodeId,
    type: "calculation",
    position: { x: 0, y: 0 },
    data: {
      functionName: "identity",
      inputs: { vals: ["aa", "bb"] },
      showComment: false,
    },
    selected: false,
  });

  beforeEach(() => {
    nodes = [baseNode()];
    edges = [
      {
        id: "e-1",
        source: nodeId,
        target: "node-2",
        targetHandle: "output-0",
      },
    ];

    setNodes = vi.fn((updater) => {
      nodes = updater(nodes);
      return nodes;
    });

    setEdges = vi.fn((updater) => {
      edges = updater(edges);
      return edges;
    });

    vi.clearAllMocks();
  });

  it("allows sentinel values to overwrite connected inputs", () => {
    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, nodes[0].data, setNodes, setEdges)
    );

    act(() => {
      result.current.setFieldValue(0, "11", true, false);
    });
    expect(setNodes).not.toHaveBeenCalled();
    expect(nodes[0].data.inputs?.vals?.[0]).toBe("aa");

    act(() => {
      result.current.setFieldValue(0, SENTINEL_FORCE00, true, true);
    });

    expect(setNodes).toHaveBeenCalledTimes(1);
    expect(nodes[0].data.inputs?.vals?.[0]).toBe(SENTINEL_FORCE00);
    expect(nodes[0].data.dirty).toBe(true);
    expect(nodes[0].data.error).toBe(false);

    act(() => {
      result.current.setFieldValue(1, SENTINEL_EMPTY, true, true);
    });

    expect(nodes[0].data.inputs?.vals?.[1]).toBe(SENTINEL_EMPTY);
  });

  it("advances a decimal field through the normal dirty recalculation path", () => {
    nodes = [
      {
        ...baseNode(),
        data: {
          functionName: "mine_nonce_range",
          inputs: { vals: { 1: "200", 2: "100" } },
          dirty: false,
          error: true,
          extendedError: "old error",
        },
      },
    ];

    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, nodes[0].data, setNodes, setEdges)
    );

    act(() => {
      result.current.advanceFieldValue(1, 2, false);
    });

    expect(nodes[0].data.inputs?.vals?.[1]).toBe("300");
    expect(nodes[0].data.dirty).toBe(true);
    expect(nodes[0].data.error).toBe(false);
    expect(nodes[0].data.extendedError).toBeUndefined();
  });

  it("advances by a literal step when no step field is configured", () => {
    nodes = [
      {
        ...baseNode(),
        data: {
          functionName: "counter",
          inputs: { vals: { 0: "442" } },
          dirty: false,
        },
      },
    ];

    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, nodes[0].data, setNodes, setEdges)
    );

    act(() => {
      result.current.advanceFieldValue(0, undefined, false, undefined, 1);
    });

    expect(nodes[0].data.inputs?.vals?.[0]).toBe("443");
    expect(nodes[0].data.dirty).toBe(true);

    // Without either a step field or a literal step the click is a no-op.
    nodes[0].data.dirty = false;
    act(() => {
      result.current.advanceFieldValue(0, undefined, false, undefined);
    });
    expect(nodes[0].data.inputs?.vals?.[0]).toBe("443");
  });

  it("accepts only one advance while recalculation is pending", () => {
    nodes = [
      {
        ...baseNode(),
        data: {
          functionName: "mine_nonce_range",
          inputs: { vals: { 1: "0", 2: "200000" } },
          outputValues: { "output-2": "100" },
          dirty: false,
        },
      },
    ];

    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, nodes[0].data, setNodes, setEdges)
    );

    act(() => {
      result.current.advanceFieldValue(1, 2, false, "output-2");
      result.current.advanceFieldValue(1, 2, false, "output-2");
    });

    expect(nodes[0].data.inputs?.vals?.[1]).toBe("100");
    expect(nodes[0].data.dirty).toBe(true);
  });

  it("clears a mining solution and restarts from nonce zero", () => {
    nodes = [
      {
        ...baseNode(),
        data: {
          functionName: "mine_nonce_range",
          inputs: {
            vals: {
              0: "header",
              1: "400",
              2: "100",
              3: "target",
            },
          },
          result: "found: true",
          outputValues: {
            "output-0": "ba010000",
            "output-1": "true",
            "output-2": "443",
          },
          outputErrors: { "output-0": "old error" },
          dirty: false,
          error: true,
          extendedError: "old error",
        },
      },
    ];

    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, nodes[0].data, setNodes, setEdges)
    );

    act(() => {
      result.current.clearMiningSolution(1, "0");
    });

    expect(nodes[0].data.inputs?.vals).toEqual({
      0: "header",
      1: "0",
      2: "100",
      3: "target",
    });
    expect(nodes[0].data.result).toBe("");
    expect(nodes[0].data.outputValues).toEqual({});
    expect(nodes[0].data.outputErrors).toEqual({});
    expect(nodes[0].data.dirty).toBe(true);
    expect(nodes[0].data.error).toBe(false);
    expect(nodes[0].data.extendedError).toBeUndefined();
  });

  it("updates dynamic TX extract outputs and removes edges from deleted outputs", () => {
    nodes = [
      {
        ...baseNode(),
        data: {
          functionName: "extract_tx_field",
          txFieldExtractMode: "dynamic",
          txExtractFields: ["txid", "vout.scriptPubKey"],
          outputPorts: [
            { label: "txid", handleId: "output-0" },
            { label: "vout.scriptPubKey", handleId: "output-1" },
          ],
          outputValues: {
            "output-0": "tx",
            "output-1": "script",
          },
        },
      },
    ];
    edges = [
      {
        id: "e-keep",
        source: nodeId,
        sourceHandle: "output-0",
        target: "node-2",
      },
      {
        id: "e-remove",
        source: nodeId,
        sourceHandle: "output-1",
        target: "node-3",
      },
    ];

    const { result, rerender } = renderHook(
      ({ data }: { data: FlowNode["data"] }) =>
        useCalcNodeMutations(nodeId, data, setNodes, setEdges),
      { initialProps: { data: nodes[0].data } }
    );

    act(() => {
      result.current.setTxFieldExtractField(0, "vin.txid");
    });

    expect(nodes[0].data.txExtractFields).toEqual([
      "vin.txid",
      "vout.scriptPubKey",
    ]);
    expect(nodes[0].data.outputPorts?.[0]).toMatchObject({
      label: "vin.txid",
      handleId: "output-0",
    });
    expect(nodes[0].data.dirty).toBe(true);
    // NB-04: changing the field type clears that output's stale cached value so
    // it can't be read mislabeled as the new field before recalc.
    expect(nodes[0].data.outputValues).toEqual({ "output-1": "script" });

    rerender({ data: nodes[0].data });

    act(() => {
      result.current.resizeTxFieldExtractFields(false);
    });

    expect(nodes[0].data.txExtractFields).toEqual(["vin.txid"]);
    // output-0 was cleared by the field change above; output-1 by the resize.
    expect(nodes[0].data.outputValues).toEqual({});
    expect(edges.map((edge) => edge.id)).toEqual(["e-keep"]);
  });

  it("removes edges for deleted outputs even when setNodes defers updaters", () => {
    // Regression for RB-09: useReactFlow's setNodes only queues updaters,
    // so the removed handle must be derived before the queue is drained.
    nodes = [
      {
        ...baseNode(),
        data: {
          functionName: "extract_tx_field",
          txFieldExtractMode: "dynamic",
          txExtractFields: ["txid", "vout.scriptPubKey"],
          outputPorts: [
            { label: "txid", handleId: "output-0" },
            { label: "vout.scriptPubKey", handleId: "output-1" },
          ],
        },
      },
    ];
    edges = [
      {
        id: "e-keep",
        source: nodeId,
        sourceHandle: "output-0",
        target: "node-2",
      },
      {
        id: "e-remove",
        source: nodeId,
        sourceHandle: "output-1",
        target: "node-3",
      },
    ];

    const nodeQueue: Array<(current: FlowNode[]) => FlowNode[]> = [];
    const queuedSetNodes = vi.fn((updater) => {
      nodeQueue.push(updater);
    });

    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, nodes[0].data, queuedSetNodes, setEdges)
    );

    act(() => {
      result.current.resizeTxFieldExtractFields(false);
    });

    // Edge cleanup must not depend on the queued node updater having run.
    expect(edges.map((edge) => edge.id)).toEqual(["e-keep"]);

    // Draining the queue afterwards still shrinks the output list.
    nodeQueue.forEach((updater) => {
      nodes = updater(nodes);
    });
    expect(nodes[0].data.txExtractFields).toEqual(["txid"]);
  });

  it("removes a node and attached edges with one node-removal snapshot", () => {
    const scheduleSnapshot = vi.fn();

    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, nodes[0].data, setNodes, setEdges, {
        scheduleSnapshot,
      })
    );

    act(() => {
      result.current.deleteNode();
    });

    expect(removeScriptSteps).toHaveBeenCalledWith(nodeId);
    expect(setEdges).toHaveBeenCalledTimes(1);
    expect(edges).toEqual([]);
    expect(setNodes).toHaveBeenCalledTimes(1);
    expect(nodes).toEqual([]);
    expect(scheduleSnapshot).toHaveBeenCalledWith("Node(s) removed", {
      refresh: true,
      coalesceFollowingCalc: true,
    });
  });

  it("removes a node when no attached edges exist", () => {
    edges = [];

    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, nodes[0].data, setNodes, setEdges)
    );

    act(() => {
      result.current.deleteNode();
    });

    expect(setEdges).toHaveBeenCalledTimes(1);
    expect(edges).toEqual([]);
    expect(setNodes).toHaveBeenCalledTimes(1);
    expect(nodes).toEqual([]);
  });

  it("normalises empty titles and comment toggles", () => {
    const scheduleSnapshot = vi.fn();
    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, nodes[0].data, setNodes, setEdges, {
        scheduleSnapshot,
      })
    );

    act(() => {
      result.current.handleTitleUpdate("");
    });
    expect(nodes[0].data.title).toBe("N/A");

    act(() => {
      result.current.toggleComment();
    });
    expect(nodes[0].data.showComment).toBe(true);

    act(() => {
      result.current.handleCommentChange("hello");
    });
    expect(nodes[0].data.comment).toBe("hello");

    act(() => {
      result.current.handleCommentChange("hello world");
    });

    act(() => {
      result.current.commitCommentOnBlur("hello", "hello world");
    });

    expect(scheduleSnapshot).toHaveBeenCalledWith("Update Node Comment");

    scheduleSnapshot.mockClear();
    act(() => {
      result.current.commitCommentOnBlur("hello world", "hello world");
    });
    expect(scheduleSnapshot).not.toHaveBeenCalled();

    act(() => {
      result.current.handleCommentChange("   ");
      result.current.commitCommentOnBlur("hello world", "   ");
    });
    expect(nodes[0].data.comment).toBeUndefined();
    expect(scheduleSnapshot).toHaveBeenCalledWith("Update Node Comment");
  });
});
