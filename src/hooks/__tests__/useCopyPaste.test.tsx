import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCopyPaste } from "../useCopyPaste";
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
