import React from "react";
import { renderHook, act } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowNode, ProtocolDiagramLayout } from "@/types";
import {
  buildFlowData,
  buildFlowNode,
  buildScriptExecutionResult,
} from "@/test-utils/types";
import {
  getScriptSteps,
  restoreScriptSteps,
} from "@/lib/share/scriptStepsCache";
import { useNodeOperations } from "../useNodeOperations";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ReactFlowProvider>{children}</ReactFlowProvider>
);

describe("useNodeOperations", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    restoreScriptSteps([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

const createMockInstance = (
  result: { current: ReturnType<typeof useNodeOperations> }
): ReactFlowInstance<FlowNode, Edge> => {
  const instance: Partial<ReactFlowInstance<FlowNode, Edge>> & {
    updateNodeInternals?: (id: string) => void;
  } = {
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    getNodes: () => result.current.nodes,
    getEdges: () => result.current.edges,
    getNodesBounds: (
      nodesParam: Parameters<ReactFlowInstance<FlowNode, Edge>["getNodesBounds"]>[0]
    ) => {
      const concreteNodes = nodesParam as FlowNode[];
      const xs = concreteNodes.map((n) => n.position.x);
      const ys = concreteNodes.map((n) => n.position.y);
      if (!xs.length) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
      };
    },
    getIntersectingNodes: () => [] as FlowNode[],
    updateNodeInternals: vi.fn(),
  };

  return instance as ReactFlowInstance<FlowNode, Edge>;
};

  it("drops flow templates onto the canvas", () => {
    const { result } = renderHook(() => useNodeOperations(), { wrapper });
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.onInit(mockRf);
    });

    const flowData = buildFlowData({
      nodes: [
        buildFlowNode({
          id: "template-node",
          type: "calculation",
          position: { x: 10, y: 20 },
          data: { functionName: "identity" },
        }),
      ],
      edges: [],
    });

    const event = {
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: (type: string) =>
          type === "application/reactflow"
            ? JSON.stringify({
                functionName: "flow_template",
                nodeData: { flowData },
              })
            : "",
      },
      clientX: 50,
      clientY: 60,
    } as unknown as React.DragEvent<HTMLDivElement>;

    act(() => {
      result.current.onDrop(event);
    });

    expect(result.current.nodes.some((n) => n.id === "template-node")).toBe(true);
  });

  it("keeps script steps for remapped ids when dropped template collides", () => {
    const { result } = renderHook(() => useNodeOperations(), { wrapper });
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.onInit(mockRf);
    });

    act(() => {
      result.current.setNodes(() => [
        buildFlowNode({
          id: "template-node",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: { functionName: "identity" },
        }),
      ]);
    });

    const scriptResult = buildScriptExecutionResult({
      steps: [],
      isValid: true,
    });
    const flowData = buildFlowData({
      nodes: [
        buildFlowNode({
          id: "template-node",
          type: "calculation",
          position: { x: 10, y: 20 },
          data: {
            functionName: "script_verification",
            scriptDebugSteps: scriptResult,
          },
        }),
      ],
      edges: [],
    });

    const event = {
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: (type: string) =>
          type === "application/reactflow"
            ? JSON.stringify({
                functionName: "flow_template",
                nodeData: { flowData },
              })
            : "",
      },
      clientX: 50,
      clientY: 60,
    } as unknown as React.DragEvent<HTMLDivElement>;

    act(() => {
      result.current.onDrop(event);
    });

    const importedVerifyNode = result.current.nodes.find(
      (node) =>
        node.data?.functionName === "script_verification" &&
        node.id !== "template-node"
    );

    expect(importedVerifyNode).toBeDefined();
    expect(importedVerifyNode?.data?.scriptDebugSteps).toBeUndefined();
    expect(getScriptSteps(importedVerifyNode!.id)).toEqual(scriptResult);
  });

  it("imports protocol diagram layout when dropping flow templates", () => {
    let protocolDiagramLayout: ProtocolDiagramLayout | undefined;
    const setProtocolDiagramLayout = vi.fn(
      (layout: ProtocolDiagramLayout | undefined) => {
        protocolDiagramLayout = layout;
      }
    );

    const { result } = renderHook(
      () =>
        useNodeOperations({
          getProtocolDiagramLayout: () => protocolDiagramLayout,
          setProtocolDiagramLayout,
        }),
      { wrapper }
    );
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.onInit(mockRf);
    });

    const flowData = buildFlowData({
      nodes: [
        buildFlowNode({
          id: "group-template",
          type: "shadcnGroup",
          position: { x: 20, y: 20 },
          data: {
            title: "Template Group",
            width: 320,
            height: 220,
            isGroup: true,
          },
        }),
        buildFlowNode({
          id: "child-template",
          type: "calculation",
          parentId: "group-template",
          extent: "parent",
          position: { x: 40, y: 40 },
          data: { functionName: "identity" },
        }),
      ],
      edges: [],
      protocolDiagramLayout: {
        groupOffsets: {
          "group-template": {
            dx: 111,
            dy: -42,
          },
        },
      },
    });

    const event = {
      preventDefault: vi.fn(),
      dataTransfer: {
        getData: (type: string) =>
          type === "application/reactflow"
            ? JSON.stringify({
                functionName: "flow_template",
                nodeData: { flowData },
              })
            : "",
      },
      clientX: 100,
      clientY: 120,
    } as unknown as React.DragEvent<HTMLDivElement>;

    act(() => {
      result.current.onDrop(event);
    });

    const importedGroup = result.current.nodes.find(
      (node) =>
        node.type === "shadcnGroup" &&
        node.data?.title === "Template Group"
    );
    expect(importedGroup).toBeDefined();
    expect(setProtocolDiagramLayout).toHaveBeenCalled();
    expect(protocolDiagramLayout?.groupOffsets?.[importedGroup!.id]).toEqual({
      dx: 111,
      dy: -42,
    });
  });

  it("groups selected nodes into a new group", () => {
    const { result } = renderHook(() => useNodeOperations(), { wrapper });
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.onInit(mockRf);
    });

    act(() => {
      result.current.setNodes(() => [
        buildFlowNode({
          id: "a",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: { functionName: "identity" },
          selected: true,
        }),
        buildFlowNode({
          id: "b",
          type: "calculation",
          position: { x: 100, y: 0 },
          data: { functionName: "identity" },
          selected: true,
        }),
      ]);
    });

    act(() => {
      // ensure getNodes sees latest state
      mockRf.getNodes = () => result.current.nodes;
      mockRf.getNodesBounds = () => ({
        x: 0,
        y: 0,
        width: 100,
        height: 40,
      });
      result.current.groupSelectedNodes();
    });

    const group = result.current.nodes.find((n) => n.type === "shadcnGroup");
    expect(group).toBeDefined();
    expect(result.current.nodes.filter((n) => n.parentId === group?.id)).toHaveLength(2);
  });

  it("ungroups only selected children when selected nodes are inside a group", () => {
    const { result } = renderHook(() => useNodeOperations(), { wrapper });
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.onInit(mockRf);
    });

    act(() => {
      result.current.setNodes(() => [
        buildFlowNode({
          id: "group-1",
          type: "shadcnGroup",
          position: { x: 100, y: 200 },
          data: {
            isGroup: true,
            width: 320,
            height: 220,
            title: "Group Node",
          },
        }),
        buildFlowNode({
          id: "child-a",
          type: "calculation",
          parentId: "group-1",
          extent: "parent",
          position: { x: 10, y: 20 },
          selected: true,
          data: { functionName: "identity" },
        }),
        buildFlowNode({
          id: "child-b",
          type: "calculation",
          parentId: "group-1",
          extent: "parent",
          position: { x: 40, y: 50 },
          selected: true,
          data: { functionName: "identity" },
        }),
        buildFlowNode({
          id: "child-c",
          type: "calculation",
          parentId: "group-1",
          extent: "parent",
          position: { x: 70, y: 80 },
          selected: false,
          data: { functionName: "identity" },
        }),
      ]);
    });

    let didUngroup = false;
    act(() => {
      mockRf.getNodes = () => result.current.nodes;
      didUngroup = result.current.ungroupSelectedNodes();
    });

    expect(didUngroup).toBe(true);
    expect(result.current.nodes.find((n) => n.id === "group-1")).toBeDefined();

    const childA = result.current.nodes.find((n) => n.id === "child-a");
    const childB = result.current.nodes.find((n) => n.id === "child-b");
    const childC = result.current.nodes.find((n) => n.id === "child-c");

    expect(childA?.parentId).toBeUndefined();
    expect(childB?.parentId).toBeUndefined();
    expect(childC?.parentId).toBe("group-1");
    expect(childA?.position).toEqual({ x: 110, y: 220 });
    expect(childB?.position).toEqual({ x: 140, y: 250 });
  });

  it("ungroups the only group as fallback when nothing is selected", () => {
    const { result } = renderHook(() => useNodeOperations(), { wrapper });
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.onInit(mockRf);
    });

    act(() => {
      result.current.setNodes(() => [
        buildFlowNode({
          id: "group-1",
          type: "shadcnGroup",
          position: { x: 50, y: 60 },
          data: {
            isGroup: true,
            width: 320,
            height: 220,
            title: "Group Node",
          },
          selected: false,
        }),
        buildFlowNode({
          id: "child-a",
          type: "calculation",
          parentId: "group-1",
          extent: "parent",
          position: { x: 5, y: 7 },
          selected: false,
          data: { functionName: "identity" },
        }),
      ]);
    });

    let didUngroup = false;
    act(() => {
      mockRf.getNodes = () => result.current.nodes;
      didUngroup = result.current.ungroupSelectedNodes();
    });

    expect(didUngroup).toBe(true);
    expect(result.current.nodes.find((n) => n.id === "group-1")).toBeUndefined();

    const childA = result.current.nodes.find((n) => n.id === "child-a");
    expect(childA?.parentId).toBeUndefined();
    expect(childA?.position).toEqual({ x: 55, y: 67 });
  });
});
