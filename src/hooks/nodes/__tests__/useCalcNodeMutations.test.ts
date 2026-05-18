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
      useCalcNodeMutations(nodeId, setNodes, setEdges)
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

    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, setNodes, setEdges)
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

    act(() => {
      result.current.resizeTxFieldExtractFields(false);
    });

    expect(nodes[0].data.txExtractFields).toEqual(["vin.txid"]);
    expect(nodes[0].data.outputValues).toEqual({ "output-0": "tx" });
    expect(edges.map((edge) => edge.id)).toEqual(["e-keep"]);
  });

  it("removes a node and attached edges with one node-removal snapshot", () => {
    const scheduleSnapshot = vi.fn();

    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, setNodes, setEdges, {
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
    expect(scheduleSnapshot).toHaveBeenCalledWith("Node(s) removed", { refresh: true });
  });

  it("removes a node when no attached edges exist", () => {
    edges = [];

    const { result } = renderHook(() =>
      useCalcNodeMutations(nodeId, setNodes, setEdges)
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
      useCalcNodeMutations(nodeId, setNodes, setEdges, { scheduleSnapshot })
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
