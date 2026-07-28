import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCopyPaste, fitGroupToChildrenInNodes } from "../useCopyPaste";
import {
  buildGroupBundledElements,
  GROUP_BUNDLE_PORT_NODE_ID_PREFIX,
} from "@/lib/flow/groupEdgeBundling";
import {
  getScriptSteps,
  restoreScriptSteps,
  setScriptSteps,
} from "@/lib/share/scriptStepsCache";
import type { Edge } from "@xyflow/react";
import type { FlowNode, ScriptExecutionResult, StepData } from "@/types";
import { buildFlowNode } from "@/test-utils/types";

const state: {
  nodes: FlowNode[];
  edges: Edge[];
} = {
  nodes: [],
  edges: [],
};

vi.mock("@xyflow/react", () => ({
  Position: {
    Left: "left",
    Right: "right",
    Top: "top",
    Bottom: "bottom",
  },
  useReactFlow: () => ({
    getNodes: () => state.nodes,
    getEdges: () => state.edges,
    setNodes: (updater: FlowNode[] | ((prev: FlowNode[]) => FlowNode[])) => {
      state.nodes =
        typeof updater === "function" ? updater(state.nodes) : updater;
    },
    setEdges: (updater: Edge[] | ((prev: Edge[]) => Edge[])) => {
      state.edges =
        typeof updater === "function" ? updater(state.edges) : updater;
    },
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  }),
}));

describe("useCopyPaste", () => {
  beforeEach(() => {
    restoreScriptSteps([]);
    state.nodes = [];
    state.edges = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves script verification steps across multiple pastes", () => {
    const originalSteps: ScriptExecutionResult = {
      isValid: true,
      steps: [
        {
          pc: 0,
          opcode: 118,
          opcode_name: "OP_DUP",
          stack_before: [],
          stack_after: ["01"],
        } satisfies StepData,
      ],
    };

    const baseNode = buildFlowNode({
      id: "node_original",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: { functionName: "script_verification" },
      selected: true,
    });

    state.nodes = [baseNode];
    setScriptSteps(baseNode.id, originalSteps);

    const { result } = renderHook(() => useCopyPaste());

    act(() => {
      result.current.copyNodes();
    });

    act(() => {
      result.current.pasteNodes();
    });

    const firstPaste = state.nodes.find((n) => n.id !== baseNode.id);
    expect(firstPaste).toBeTruthy();
    if (!firstPaste) throw new Error("First pasted node not found");
    expect(getScriptSteps(firstPaste.id)).toEqual(originalSteps);

    act(() => {
      result.current.pasteNodes();
    });

    const pastedIds = new Set([baseNode.id, firstPaste.id]);
    const secondPaste = state.nodes.find((n) => !pastedIds.has(n.id));
    expect(secondPaste).toBeTruthy();
    if (!secondPaste) throw new Error("Second pasted node not found");
    expect(getScriptSteps(secondPaste.id)).toEqual(originalSteps);
  });

  it("preserves pasted radio pair channels and clears the pasted sender value", () => {
    const send = buildFlowNode({
      id: "radio-send-1",
      type: "radioNode",
      position: { x: 0, y: 0 },
      data: {
        functionName: "radio_send",
        title: "Radio Send 1",
        radioChannel: "1",
        inputs: { vals: { 0: "copied payload" } },
        result: "copied payload",
        error: true,
        extendedError: "Stale sender error",
        outputPorts: [
          { label: "1", handleId: "", showHandle: false, showLabel: false },
        ],
      },
      selected: true,
    });
    const receive = buildFlowNode({
      id: "radio-receive-1",
      type: "radioNode",
      position: { x: 140, y: 0 },
      data: {
        functionName: "radio_receive",
        title: "Radio Receive 1",
        radioChannel: "1",
        outputPorts: [{ label: "1", handleId: "", showLabel: false }],
      },
      selected: true,
    });
    state.nodes = [send, receive];

    const { result } = renderHook(() => useCopyPaste());

    act(() => {
      result.current.copyNodes();
    });

    act(() => {
      result.current.pasteNodes({ x: 300, y: 0 });
    });

    const pastedSend = state.nodes.find(
      (node) =>
        node.id !== send.id && node.data?.functionName === "radio_send",
    );
    const pastedReceive = state.nodes.find(
      (node) =>
        node.id !== receive.id &&
        node.data?.functionName === "radio_receive",
    );

    expect(state.nodes.find((node) => node.id === send.id)?.data.dirty).toBe(
      true,
    );
    expect(
      state.nodes.find((node) => node.id === receive.id)?.data.dirty,
    ).toBe(true);
    expect(pastedSend?.data.radioChannel).toBe("1");
    expect(pastedSend?.data.title).toBe("Radio Send 1");
    expect(pastedSend?.data.outputPorts?.[0]?.label).toBe("1");
    expect(pastedSend?.data.inputs?.vals).toEqual({ 0: "" });
    expect(pastedSend?.data.result).toBe("");
    expect(pastedSend?.data.error).toBeUndefined();
    expect(pastedSend?.data.extendedError).toBeUndefined();
    expect(pastedSend?.data.dirty).toBe(true);
    expect(send.data.inputs?.vals).toEqual({ 0: "copied payload" });
    expect(send.data.result).toBe("copied payload");
    expect(pastedReceive?.data.radioChannel).toBe("1");
    expect(pastedReceive?.data.title).toBe("Radio Receive 1");
    expect(pastedReceive?.data.outputPorts?.[0]?.label).toBe("1");
    expect(pastedReceive?.data.dirty).toBe(true);
  });

  it.each([
    {
      functionName: "radio_send",
      title: "Radio Send 7",
      nodeId: "radio-send-7",
    },
    {
      functionName: "radio_receive",
      title: "Radio Receive 7",
      nodeId: "radio-receive-7",
    },
  ])(
    "preserves the channel when pasting one $functionName node",
    ({ functionName, title, nodeId }) => {
      const original = buildFlowNode({
        id: nodeId,
        type: "radioNode",
        position: { x: 0, y: 0 },
        data: {
          functionName,
          title,
          radioChannel: "7",
          ...(functionName === "radio_send"
            ? {
                inputs: { vals: { 0: "copied payload" } },
                result: "copied payload",
              }
            : {}),
          outputPorts: [{ label: "7", handleId: "", showLabel: false }],
        },
        selected: true,
      });
      state.nodes = [original];

      const { result } = renderHook(() => useCopyPaste());

      act(() => {
        result.current.copyNodes();
      });
      act(() => {
        result.current.pasteNodes({ x: 300, y: 0 });
      });

      const pasted = state.nodes.find((node) => node.id !== original.id);
      expect(pasted?.data.functionName).toBe(functionName);
      expect(pasted?.data.radioChannel).toBe("7");
      expect(pasted?.data.title).toBe(title);
      expect(pasted?.data.outputPorts?.[0]?.label).toBe("7");
      expect(pasted?.data.dirty).toBe(true);
      if (functionName === "radio_send") {
        expect(pasted?.data.inputs?.vals).toEqual({ 0: "" });
        expect(pasted?.data.result).toBe("");
      }
    },
  );

  it("copies canonical edges between selected groups from rendered bundle edges", () => {
    const canonicalNodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
        selected: true,
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
        selected: true,
      }),
      buildFlowNode({
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: { title: "A1" },
      }),
      buildFlowNode({
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: { title: "B1" },
      }),
    ];
    const canonicalEdges: Edge[] = [
      { id: "edge-a-b", source: "a1", target: "b1" },
    ];
    const visual = buildGroupBundledElements({
      nodes: canonicalNodes,
      edges: canonicalEdges,
    });
    state.nodes = visual.nodes;
    state.edges = visual.edges;

    const { result } = renderHook(() => useCopyPaste());

    act(() => {
      result.current.copyNodes();
    });

    act(() => {
      result.current.pasteNodes({ x: 1000, y: 1000 });
    });

    const pastedGroups = state.nodes.filter(
      (node) =>
        node.type === "shadcnGroup" &&
        node.id !== "group-a" &&
        node.id !== "group-b"
    );
    const pastedGroupIds = new Set(pastedGroups.map((node) => node.id));
    const pastedChildren = state.nodes.filter(
      (node) => node.parentId && pastedGroupIds.has(node.parentId)
    );
    const pastedChildIds = new Set(pastedChildren.map((node) => node.id));
    const pastedEdges = state.edges.filter(
      (edge) =>
        pastedChildIds.has(edge.source) && pastedChildIds.has(edge.target)
    );

    expect(pastedGroups).toHaveLength(2);
    expect(pastedChildren).toHaveLength(2);
    expect(pastedEdges).toHaveLength(1);
    expect(pastedEdges[0].id).not.toBe("edge-a-b");
    expect(pastedEdges[0]).toMatchObject({
      source: expect.not.stringContaining(GROUP_BUNDLE_PORT_NODE_ID_PREFIX),
      target: expect.not.stringContaining(GROUP_BUNDLE_PORT_NODE_ID_PREFIX),
    });
  });

  it("remaps copied group bundle handle offsets to pasted group ids", () => {
    const canonicalNodes: FlowNode[] = [
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
              "group-a->group-b": 42,
              "group-a->group-c": -24,
              "group-a->group-x": 99,
            },
          },
        },
        selected: true,
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: {
          title: "B",
          width: 300,
          height: 200,
          groupBundlePortOffsets: {
            targetByBundle: { "group-a->group-b": 17 },
          },
        },
        selected: true,
      }),
      buildFlowNode({
        id: "group-c",
        type: "shadcnGroup",
        position: { x: 1000, y: 0 },
        data: {
          title: "C",
          width: 300,
          height: 200,
          groupBundlePortOffsets: {
            targetByBundle: { "group-a->group-c": -33 },
          },
        },
        selected: true,
      }),
      buildFlowNode({
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: { title: "A1" },
      }),
      buildFlowNode({
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: { title: "B1" },
      }),
      buildFlowNode({
        id: "c1",
        type: "calculation",
        parentId: "group-c",
        position: { x: 40, y: 40 },
        data: { title: "C1" },
      }),
    ];
    const canonicalEdges: Edge[] = [
      { id: "edge-a-b", source: "a1", target: "b1" },
      { id: "edge-a-c", source: "a1", target: "c1" },
    ];
    const visual = buildGroupBundledElements({
      nodes: canonicalNodes,
      edges: canonicalEdges,
    });
    state.nodes = visual.nodes;
    state.edges = visual.edges;

    const { result } = renderHook(() => useCopyPaste());

    act(() => {
      result.current.copyNodes();
    });

    act(() => {
      result.current.pasteNodes({ x: 1000, y: 1000 });
    });

    const pastedGroups = state.nodes.filter(
      (node) =>
        node.type === "shadcnGroup" &&
        !["group-a", "group-b", "group-c"].includes(node.id)
    );
    const byTitle = new Map(
      pastedGroups.map((node) => [String(node.data.title), node])
    );
    const pastedA = byTitle.get("A");
    const pastedB = byTitle.get("B");
    const pastedC = byTitle.get("C");

    expect(pastedA).toBeTruthy();
    expect(pastedB).toBeTruthy();
    expect(pastedC).toBeTruthy();
    if (!pastedA || !pastedB || !pastedC) {
      throw new Error("Expected pasted groups");
    }

    const nextAB = `${pastedA.id}->${pastedB.id}`;
    const nextAC = `${pastedA.id}->${pastedC.id}`;
    expect(pastedA.data.groupBundlePortOffsets?.sourceByBundle).toEqual({
      [nextAB]: 42,
      [nextAC]: -24,
    });
    expect(pastedB.data.groupBundlePortOffsets?.targetByBundle).toEqual({
      [nextAB]: 17,
    });
    expect(pastedC.data.groupBundlePortOffsets?.targetByBundle).toEqual({
      [nextAC]: -33,
    });
  });

  it("copies canonical edges between selected child nodes in different groups", () => {
    const canonicalNodes: FlowNode[] = [
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
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: { title: "A1" },
        selected: true,
      }),
      buildFlowNode({
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: { title: "B1" },
        selected: true,
      }),
    ];
    const canonicalEdges: Edge[] = [
      { id: "edge-a-b", source: "a1", target: "b1" },
    ];
    const visual = buildGroupBundledElements({
      nodes: canonicalNodes,
      edges: canonicalEdges,
    });
    state.nodes = visual.nodes;
    state.edges = visual.edges;

    const { result } = renderHook(() => useCopyPaste());

    act(() => {
      result.current.copyNodes();
    });

    act(() => {
      result.current.pasteNodes({ x: 1000, y: 1000 });
    });

    const originalNodeIds = new Set(visual.nodes.map((node) => node.id));
    const pastedNodes = state.nodes.filter((node) => !originalNodeIds.has(node.id));
    const pastedNodeIds = new Set(pastedNodes.map((node) => node.id));
    const pastedEdges = state.edges.filter(
      (edge) => pastedNodeIds.has(edge.source) && pastedNodeIds.has(edge.target)
    );

    expect(pastedNodes).toHaveLength(2);
    expect(pastedNodes.every((node) => !node.parentId)).toBe(true);
    expect(pastedEdges).toHaveLength(1);
    expect(pastedEdges[0].id).not.toBe("edge-a-b");
    expect(pastedEdges[0]).toMatchObject({
      source: expect.not.stringContaining(GROUP_BUNDLE_PORT_NODE_ID_PREFIX),
      target: expect.not.stringContaining(GROUP_BUNDLE_PORT_NODE_ID_PREFIX),
    });
  });

  it("parents pasted top-level nodes to the group under the paste point", () => {
    state.nodes = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 100, y: 100 },
        width: 400,
        height: 300,
        data: { title: "A", width: 400, height: 300 },
      }),
      buildFlowNode({
        id: "source",
        type: "calculation",
        position: { x: 0, y: 0 },
        width: 120,
        height: 80,
        data: { title: "Source" },
        selected: true,
      }),
    ];

    const { result } = renderHook(() => useCopyPaste());

    act(() => {
      result.current.copyNodes();
    });

    act(() => {
      result.current.pasteNodes({ x: 160, y: 180 });
    });

    const pasted = state.nodes.find(
      (node) => !["group-a", "source"].includes(node.id)
    );
    expect(pasted).toBeTruthy();
    if (!pasted) throw new Error("Expected pasted node");

    expect(pasted.parentId).toBe("group-a");
    expect(pasted.extent).toBe("parent");
    expect(pasted.position).toEqual({ x: 60, y: 80 });
  });

  it("preserves pasted spacing when multiple nodes are pasted into a group", () => {
    state.nodes = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 100, y: 100 },
        width: 500,
        height: 300,
        data: { title: "A", width: 500, height: 300 },
      }),
      buildFlowNode({
        id: "left",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: { title: "Left" },
        selected: true,
      }),
      buildFlowNode({
        id: "right",
        type: "calculation",
        position: { x: 240, y: 40 },
        data: { title: "Right" },
        selected: true,
      }),
    ];

    const { result } = renderHook(() => useCopyPaste());

    act(() => {
      result.current.copyNodes();
    });

    act(() => {
      result.current.pasteNodes({ x: 180, y: 150 });
    });

    const pasted = state.nodes.filter(
      (node) => !["group-a", "left", "right"].includes(node.id)
    );
    const byTitle = new Map(pasted.map((node) => [String(node.data.title), node]));
    const pastedLeft = byTitle.get("Left");
    const pastedRight = byTitle.get("Right");

    expect(pastedLeft).toBeTruthy();
    expect(pastedRight).toBeTruthy();
    if (!pastedLeft || !pastedRight) {
      throw new Error("Expected pasted nodes");
    }

    expect(pastedLeft).toMatchObject({
      parentId: "group-a",
      extent: "parent",
      position: { x: 80, y: 50 },
    });
    expect(pastedRight).toMatchObject({
      parentId: "group-a",
      extent: "parent",
      position: { x: 320, y: 90 },
    });
  });

  it("can paste selected nodes with incoming connections from existing nodes", () => {
    state.nodes = [
      buildFlowNode({
        id: "source",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: { title: "Source" },
      }),
      buildFlowNode({
        id: "target",
        type: "calculation",
        position: { x: 300, y: 0 },
        data: { title: "Target" },
        selected: true,
      }),
    ];
    state.edges = [
      {
        id: "edge-source-target",
        source: "source",
        target: "target",
        sourceHandle: "out",
        targetHandle: "in",
      },
    ];

    const { result } = renderHook(() => useCopyPaste());

    act(() => {
      result.current.copyNodes();
    });

    act(() => {
      result.current.pasteNodes({ x: 600, y: 0 });
    });

    const defaultPaste = state.nodes.find(
      (node) => !["source", "target"].includes(node.id)
    );
    expect(defaultPaste).toBeTruthy();
    if (!defaultPaste) throw new Error("Expected default paste");
    expect(
      state.edges.some(
        (edge) => edge.source === "source" && edge.target === defaultPaste.id
      )
    ).toBe(false);

    act(() => {
      result.current.pasteNodes(
        { x: 900, y: 0 },
        { includeIncomingConnections: true }
      );
    });

    const incomingPaste = state.nodes.find(
      (node) =>
        !["source", "target", defaultPaste.id].includes(node.id) &&
        node.data.title === "Target"
    );
    expect(incomingPaste).toBeTruthy();
    if (!incomingPaste) throw new Error("Expected incoming paste");

    expect(
      state.edges.find(
        (edge) => edge.source === "source" && edge.target === incomingPaste.id
      )
    ).toMatchObject({
      id: expect.not.stringContaining("edge-source-target"),
      sourceHandle: "out",
      targetHandle: "in",
    });
  });
});

describe("fitGroupToChildrenInNodes (NB-05)", () => {
  it("keeps existing children at their absolute position when a paste lands in the top-left padding band", () => {
    const group = buildFlowNode({
      id: "group-a",
      type: "shadcnGroup",
      position: { x: 0, y: 0 },
      data: { title: "A", width: 300, height: 200 },
    });
    const existing = buildFlowNode({
      id: "existing",
      parentId: "group-a",
      position: { x: 100, y: 100 },
    });
    // Pasted node adopted near the corner (relative < GROUP_PADDING of 32).
    const pasted = buildFlowNode({
      id: "pasted",
      parentId: "group-a",
      position: { x: 10, y: 10 },
    });

    const result = fitGroupToChildrenInNodes(
      [group, existing, pasted],
      "group-a"
    );

    const groupOut = result.find((n) => n.id === "group-a")!;
    const existingOut = result.find((n) => n.id === "existing")!;
    const shiftX = 32 - 10; // GROUP_PADDING - minX
    const shiftY = 32 - 10;

    // The group frame grew on the top-left side (origin moved by -shift)…
    expect(groupOut.position).toEqual({ x: -shiftX, y: -shiftY });
    // …and the existing child's ABSOLUTE position is unchanged:
    // group.x + child.relX  ===  (-shiftX) + (100 + shiftX)  ===  100.
    expect(groupOut.position.x + existingOut.position.x).toBe(100);
    expect(groupOut.position.y + existingOut.position.y).toBe(100);
  });

  it("does not move the group when the paste needs no shift", () => {
    const group = buildFlowNode({
      id: "group-a",
      type: "shadcnGroup",
      position: { x: 5, y: 5 },
      data: { title: "A", width: 300, height: 200 },
    });
    const child = buildFlowNode({
      id: "child",
      parentId: "group-a",
      position: { x: 80, y: 80 },
    });

    const result = fitGroupToChildrenInNodes([group, child], "group-a");
    // shift is 0 (80 > padding), so the group keeps its origin and the child
    // is untouched.
    expect(result.find((n) => n.id === "group-a")!.position).toEqual({
      x: 5,
      y: 5,
    });
    expect(result.find((n) => n.id === "child")!.position).toEqual({
      x: 80,
      y: 80,
    });
  });
});
