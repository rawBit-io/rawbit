import React from "react";
import { renderHook, act } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import type { Edge, NodeChange, ReactFlowInstance } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowNode } from "@/types";
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
    setViewport: vi.fn(),
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
    expect(result.current.nodes.find((n) => n.id === "template-node")?.position).toEqual({
      x: 50,
      y: 60,
    });
    expect(result.current.nodes.filter((n) => n.type === "shadcnTextInfo")).toHaveLength(0);
    expect(mockRf.setViewport).toHaveBeenCalledWith(
      { x: 25, y: 30, zoom: 0.5 },
      { duration: 0 }
    );
  });

  it("remaps group bundle offset keys when a re-dropped template renames colliding ids", () => {
    // Regression for the RB-59 follow-up: template drops also go through
    // importWithFreshIds and must remap data.groupBundlePortOffsets keys.
    const { result } = renderHook(() => useNodeOperations(), { wrapper });
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.onInit(mockRf);
    });

    const flowData = buildFlowData({
      nodes: [
        buildFlowNode({
          id: "group-a",
          type: "shadcnGroup",
          position: { x: 0, y: 0 },
          data: {
            groupBundlePortOffsets: {
              sourceByBundle: { "group-a->group-b": 0.7 },
            },
          },
        }),
        buildFlowNode({
          id: "group-b",
          type: "shadcnGroup",
          position: { x: 400, y: 0 },
          data: {},
        }),
      ],
      edges: [],
    });

    const makeDropEvent = () =>
      ({
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
      }) as unknown as React.DragEvent<HTMLDivElement>;

    act(() => {
      result.current.onDrop(makeDropEvent());
    });
    act(() => {
      result.current.onDrop(makeDropEvent());
    });

    const groups = result.current.nodes.filter(
      (n) => n.type === "shadcnGroup"
    );
    expect(groups).toHaveLength(4);

    const renamed = groups.filter(
      (n) => n.id !== "group-a" && n.id !== "group-b"
    );
    expect(renamed).toHaveLength(2);

    const renamedWithOffsets = renamed.find(
      (n) =>
        (n.data as { groupBundlePortOffsets?: unknown }).groupBundlePortOffsets
    );
    expect(renamedWithOffsets).toBeDefined();
    const otherRenamed = renamed.find((n) => n !== renamedWithOffsets)!;
    const offsets = (
      renamedWithOffsets!.data as {
        groupBundlePortOffsets: { sourceByBundle: Record<string, number> };
      }
    ).groupBundlePortOffsets;
    expect(offsets.sourceByBundle).toEqual({
      [`${renamedWithOffsets!.id}->${otherRenamed.id}`]: 0.7,
    });
  });

  it("anchors dropped flow templates by left-most then top-most node", () => {
    const { result } = renderHook(() => useNodeOperations(), { wrapper });
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.onInit(mockRf);
    });

    const flowData = buildFlowData({
      nodes: [
        buildFlowNode({
          id: "left-lower",
          type: "calculation",
          position: { x: 0, y: 100 },
          data: { functionName: "identity" },
        }),
        buildFlowNode({
          id: "top-right",
          type: "calculation",
          position: { x: 10, y: 0 },
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
      currentTarget: {
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      },
    } as unknown as React.DragEvent<HTMLDivElement>;

    act(() => {
      result.current.onDrop(event);
    });

    expect(result.current.nodes.find((n) => n.id === "left-lower")?.position).toEqual({
      x: 50,
      y: 60,
    });
    expect(result.current.nodes.find((n) => n.id === "top-right")?.position).toEqual({
      x: 60,
      y: -40,
    });
    expect(mockRf.setViewport).toHaveBeenCalledWith(
      { x: 25, y: 30, zoom: 0.5 },
      { duration: 0 }
    );
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
    expect(group?.data.fontSize).toBe(44);
    expect(result.current.nodes.filter((n) => n.parentId === group?.id)).toHaveLength(2);
  });

  it("expands a group to fit a large dragged-in child", () => {
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
          position: { x: 100, y: 100 },
          data: {
            isGroup: true,
            width: 300,
            height: 200,
            title: "Group Node",
          },
        }),
        buildFlowNode({
          id: "large-info",
          type: "shadcnTextInfo",
          position: { x: 80, y: 70 },
          selected: true,
          measured: { width: 250, height: 150 },
          data: {
            title: "Large Info",
            width: 800,
            height: 600,
          },
        }),
      ]);
    });

    act(() => {
      mockRf.getNodes = () => result.current.nodes;
      result.current.onNodeDragStop({
        clientX: 140,
        clientY: 140,
      } as React.MouseEvent);
    });

    const child = result.current.nodes.find((node) => node.id === "large-info");
    const group = result.current.nodes.find((node) => node.id === "group-1");

    expect(child?.parentId).toBe("group-1");
    expect(child?.position).toEqual({ x: 32, y: 32 });
    expect(group?.width).toBe(864);
    expect(group?.height).toBe(664);
    expect(group?.measured).toEqual({ width: 864, height: 664 });
    expect(group?.data.width).toBe(864);
    expect(group?.data.height).toBe(664);
  });

  it("refits a parent group when a child grows after initial render", () => {
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
          position: { x: 0, y: 0 },
          data: {
            isGroup: true,
            width: 300,
            height: 200,
            title: "Group Node",
          },
        }),
        buildFlowNode({
          id: "tx-template",
          type: "calculation",
          parentId: "group-1",
          extent: "parent",
          position: { x: 40, y: 50 },
          measured: { width: 250, height: 150 },
          data: {
            functionName: "tx_template",
            width: 900,
            height: 700,
          },
        }),
      ]);
    });

    act(() => {
      mockRf.getNodes = () => result.current.nodes;
      result.current.onNodesChange([
        {
          id: "tx-template",
          type: "dimensions",
          dimensions: { width: 900, height: 700 },
        } as NodeChange<FlowNode>,
      ]);
    });

    const group = result.current.nodes.find((node) => node.id === "group-1");

    expect(group?.width).toBe(972);
    expect(group?.height).toBe(782);
    expect(group?.measured).toEqual({ width: 972, height: 782 });
    expect(group?.data.width).toBe(972);
    expect(group?.data.height).toBe(782);
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

  it("lifts children of a nested group by the full ancestor offset when ungrouping", () => {
    const { result } = renderHook(() => useNodeOperations(), { wrapper });
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.onInit(mockRf);
    });

    act(() => {
      result.current.setNodes(() => [
        buildFlowNode({
          id: "outer",
          type: "shadcnGroup",
          position: { x: 100, y: 100 },
          data: { isGroup: true, width: 600, height: 500, title: "Outer" },
        }),
        buildFlowNode({
          id: "inner",
          type: "shadcnGroup",
          parentId: "outer",
          position: { x: 50, y: 60 },
          selected: true,
          data: { isGroup: true, width: 300, height: 200, title: "Inner" },
        }),
        buildFlowNode({
          id: "child",
          type: "calculation",
          parentId: "inner",
          extent: "parent",
          position: { x: 10, y: 20 },
          data: { functionName: "identity" },
        }),
      ]);
    });

    act(() => {
      mockRf.getNodes = () => result.current.nodes;
      result.current.ungroupSelectedNodes();
    });

    const child = result.current.nodes.find((n) => n.id === "child");
    expect(result.current.nodes.find((n) => n.id === "inner")).toBeUndefined();
    expect(child?.parentId).toBeUndefined();
    // outer (100,100) + inner (50,60) + child (10,20) — not just one level
    expect(child?.position).toEqual({ x: 160, y: 180 });
  });

  it("lifts a partially ungrouped child of a nested group to its absolute position", () => {
    const { result } = renderHook(() => useNodeOperations(), { wrapper });
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.onInit(mockRf);
    });

    act(() => {
      result.current.setNodes(() => [
        buildFlowNode({
          id: "outer",
          type: "shadcnGroup",
          position: { x: 100, y: 100 },
          data: { isGroup: true, width: 600, height: 500, title: "Outer" },
        }),
        buildFlowNode({
          id: "inner",
          type: "shadcnGroup",
          parentId: "outer",
          position: { x: 50, y: 60 },
          data: { isGroup: true, width: 300, height: 200, title: "Inner" },
        }),
        buildFlowNode({
          id: "child",
          type: "calculation",
          parentId: "inner",
          extent: "parent",
          position: { x: 10, y: 20 },
          selected: true,
          data: { functionName: "identity" },
        }),
      ]);
    });

    act(() => {
      mockRf.getNodes = () => result.current.nodes;
      result.current.ungroupSelectedNodes();
    });

    const child = result.current.nodes.find((n) => n.id === "child");
    expect(child?.parentId).toBeUndefined();
    expect(child?.position).toEqual({ x: 160, y: 180 });
  });

  it("does not re-queue persisted top-level nodes for group adoption on init", () => {
    const { result } = renderHook(() => useNodeOperations(), { wrapper });
    const mockRf = createMockInstance(result);

    act(() => {
      result.current.setNodes(() => [
        buildFlowNode({
          id: "group-1",
          type: "shadcnGroup",
          position: { x: 0, y: 0 },
          data: {
            isGroup: true,
            width: 400,
            height: 300,
            title: "Group Node",
          },
        }),
        // Explicitly ungrouped before save: still overlaps the group rect.
        buildFlowNode({
          id: "ungrouped",
          type: "calculation",
          position: { x: 40, y: 50 },
          measured: { width: 250, height: 150 },
          data: { functionName: "identity" },
        }),
      ]);
    });

    act(() => {
      mockRf.getNodes = () => result.current.nodes;
      mockRf.getIntersectingNodes = () =>
        result.current.nodes.filter((n) => n.type === "shadcnGroup");
      result.current.onInit(mockRf);
    });

    act(() => {
      result.current.onNodesChange([
        {
          id: "ungrouped",
          type: "dimensions",
          dimensions: { width: 250, height: 150 },
        } as NodeChange<FlowNode>,
      ]);
    });

    expect(
      result.current.nodes.find((n) => n.id === "ungrouped")?.parentId
    ).toBeUndefined();
  });

  it("does not ungroup the only group when nothing is selected", () => {
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

    expect(didUngroup).toBe(false);
    expect(result.current.nodes.find((n) => n.id === "group-1")).toBeDefined();

    const childA = result.current.nodes.find((n) => n.id === "child-a");
    expect(childA?.parentId).toBe("group-1");
    expect(childA?.position).toEqual({ x: 5, y: 7 });
    expect(result.current.canUngroupSelectedNodes()).toBe(false);
  });
});
