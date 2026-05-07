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
    expect(pastedEdges[0]).toMatchObject({
      source: expect.not.stringContaining(GROUP_BUNDLE_PORT_NODE_ID_PREFIX),
      target: expect.not.stringContaining(GROUP_BUNDLE_PORT_NODE_ID_PREFIX),
    });
  });
});
