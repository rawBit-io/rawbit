import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Connection, Edge, EdgeChange, NodeChange } from "@xyflow/react";
import type { FlowNode } from "@/types";
import { useFlowInteractions } from "../useFlowInteractions";

describe("useFlowInteractions", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const baseDeps = () => {
    const pendingSnapshotRef = { current: false };
    const skipNextEdgeSnapshotRef = { current: false };
    const skipNextNodeRemovalRef = { current: false };
    const loadingUndoRef = { current: false };
    const isPastingRef = { current: false };

    const rawOnNodesChange = vi.fn<(changes: NodeChange<FlowNode>[]) => void>();
    const rawOnEdgesChange = vi.fn();
    const onConnect = vi.fn();
    const onDrop = vi.fn();
    const onNodeDragStop = vi.fn();
    const scheduleSnapshot = vi.fn();
    const markPendingAfterDirtyChange = vi.fn();
    const releaseEdgeSnapshotSkip = vi.fn();
    const releaseNodeRemovalSnapshotSkip = vi.fn();
    const getTopLeftPosition = vi.fn(() => ({ x: 0, y: 0 }));
    const pasteNodes = vi.fn();
    const setTabTooltip = vi.fn();
    const renameTab = vi.fn();
    const groupSelectedNodes = vi.fn(() => false);
    const ungroupSelectedNodes = vi.fn(() => false);
    const clearHighlights = vi.fn();
    const setIsSearchHighlight = vi.fn();
    const incRev = vi.fn(() => 1);
    const pushCleanState = vi.fn();
    const updatePaletteEligibility = vi.fn();

    return {
      rawOnNodesChange,
      rawOnEdgesChange,
      onConnect,
      onDrop,
      onNodeDragStop,
      scheduleSnapshot,
      pendingSnapshotRef,
      skipNextEdgeSnapshotRef,
      skipNextNodeRemovalRef,
      markPendingAfterDirtyChange,
      releaseEdgeSnapshotSkip,
      releaseNodeRemovalSnapshotSkip,
      loadingUndoRef,
      isPastingRef,
      getTopLeftPosition,
      pasteNodes,
      setTabTooltip,
      groupSelectedNodes,
      ungroupSelectedNodes,
      clearHighlights,
      setIsSearchHighlight,
      incRev,
      pushCleanState,
      updatePaletteEligibility,
      renameTab,
    } as const;
  };

  it("reconnects edges and marks touched nodes dirty", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [
      {
        id: "source",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: { dirty: false },
      } as FlowNode,
      {
        id: "target",
        type: "calculation",
        position: { x: 200, y: 0 },
        data: { dirty: false },
      } as FlowNode,
      {
        id: "replacement",
        type: "calculation",
        position: { x: 250, y: 120 },
        data: { dirty: false },
      } as FlowNode,
    ];
    let edgesState: Edge[] = [
      {
        id: "edge-1",
        source: "source",
        target: "target",
        sourceHandle: "out",
        targetHandle: "in",
      } as Edge,
    ];

    const getNodes = () => nodesState;
    const getEdges = () => edgesState;
    const setNodes = (updater: (nodes: FlowNode[]) => FlowNode[]) => {
      nodesState = updater(nodesState);
    };
    const setEdges = (updater: (edges: Edge[]) => Edge[]) => {
      edgesState = updater(edgesState);
    };

    const { result } = renderHook(() =>
      useFlowInteractions({
        ...deps,
        rawOnNodesChange: deps.rawOnNodesChange,
        rawOnEdgesChange: deps.rawOnEdgesChange,
        onConnect: deps.onConnect,
        onDrop: deps.onDrop,
        onNodeDragStop: deps.onNodeDragStop,
        getNodes,
        getEdges,
        setNodes,
        setEdges,
        getTopLeftPosition: deps.getTopLeftPosition,
        pasteNodes: deps.pasteNodes,
        isSidebarOpen: false,
        setTabTooltip: deps.setTabTooltip,
        renameTab: deps.renameTab,
        activeTabId: "tab-1",
        groupSelectedNodes: deps.groupSelectedNodes,
        ungroupSelectedNodes: deps.ungroupSelectedNodes,
        clearHighlights: deps.clearHighlights,
        setIsSearchHighlight: deps.setIsSearchHighlight,
        incRev: deps.incRev,
        pushCleanState: deps.pushCleanState,
        updatePaletteEligibility: deps.updatePaletteEligibility,
        skipNextNodeRemovalRef: deps.skipNextNodeRemovalRef,
        releaseNodeRemovalSnapshotSkip: deps.releaseNodeRemovalSnapshotSkip,
      })
    );

    const oldEdge = { ...edgesState[0] } as Edge;
    const newConnection: Connection = {
      source: "source",
      target: "replacement",
      sourceHandle: "out",
      targetHandle: "next",
    };

    act(() => {
      result.current.onReconnectWithUndo(oldEdge, newConnection);
    });

    expect(edgesState[0].target).toBe("replacement");
    expect(edgesState[0].targetHandle).toBe("next");
    const dirtyIds = nodesState
      .filter((node) => node.data?.dirty)
      .map((node) => node.id);
    expect(dirtyIds.sort()).toEqual(["replacement", "source", "target"]);
    expect(deps.markPendingAfterDirtyChange).toHaveBeenCalledTimes(1);
  });

  it("records undo snapshot after node drag", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [
      {
        id: "node-a",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: { dirty: false },
      } as FlowNode,
    ];
    let edgesState: Edge[] = [
      {
        id: "edge-1",
        source: "node-a",
        target: "node-a",
      } as Edge,
    ];

    const getNodes = () => nodesState;
    const getEdges = () => edgesState;
    const setNodes = (updater: (nodes: FlowNode[]) => FlowNode[]) => {
      nodesState = updater(nodesState);
    };
    const setEdges = (updater: (edges: Edge[]) => Edge[]) => {
      edgesState = updater(edgesState);
    };

    const { result } = renderHook(() =>
      useFlowInteractions({
        ...deps,
        rawOnNodesChange: deps.rawOnNodesChange,
        rawOnEdgesChange: deps.rawOnEdgesChange,
        onConnect: deps.onConnect,
        onDrop: deps.onDrop,
        onNodeDragStop: deps.onNodeDragStop,
        getNodes,
        getEdges,
        setNodes,
        setEdges,
        getTopLeftPosition: deps.getTopLeftPosition,
        pasteNodes: deps.pasteNodes,
        isSidebarOpen: false,
        setTabTooltip: deps.setTabTooltip,
        renameTab: deps.renameTab,
        activeTabId: "tab-1",
        groupSelectedNodes: deps.groupSelectedNodes,
        ungroupSelectedNodes: deps.ungroupSelectedNodes,
        clearHighlights: deps.clearHighlights,
        setIsSearchHighlight: deps.setIsSearchHighlight,
        incRev: deps.incRev,
        pushCleanState: deps.pushCleanState,
        updatePaletteEligibility: deps.updatePaletteEligibility,
        skipNextNodeRemovalRef: deps.skipNextNodeRemovalRef,
        releaseNodeRemovalSnapshotSkip: deps.releaseNodeRemovalSnapshotSkip,
      })
    );

    const startChange = {
      id: "node-a",
      type: "position",
      dragging: true,
    } as NodeChange<FlowNode>;

    act(() => {
      result.current.onNodesChange([startChange]);
    });

    nodesState = nodesState.map((node) =>
      node.id === "node-a"
        ? { ...node, position: { x: 80, y: 40 } }
        : node
    );

    const endChange = {
      id: "node-a",
      type: "position",
      dragging: false,
    } as NodeChange<FlowNode>;

    act(() => {
      result.current.onNodesChange([endChange]);
    });

    deps.pendingSnapshotRef.current = true;

    const mouseEvent = new MouseEvent("mouseup") as unknown as ReactMouseEvent<Element>;

    act(() => {
      result.current.onNodeDragStopWithUndo(mouseEvent, nodesState[0], nodesState);
    });

    expect(deps.markPendingAfterDirtyChange).toHaveBeenCalled();
    expect(deps.incRev).toHaveBeenCalled();
    expect(deps.pushCleanState).toHaveBeenCalledWith(
      nodesState,
      edgesState,
      "Node(s) moved"
    );
    expect(deps.pendingSnapshotRef.current).toBe(false);
  });

  it("renames the tab when a flow template is dropped into an empty canvas", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [];
    let edgesState: Edge[] = [];

    const getNodes = () => nodesState;
    const getEdges = () => edgesState;
    const setNodes = (updater: (nodes: FlowNode[]) => FlowNode[]) => {
      nodesState = updater(nodesState);
    };
    const setEdges = (updater: (edges: Edge[]) => Edge[]) => {
      edgesState = updater(edgesState);
    };

    const { result } = renderHook(() =>
      useFlowInteractions({
        ...deps,
        rawOnNodesChange: deps.rawOnNodesChange,
        rawOnEdgesChange: deps.rawOnEdgesChange,
        onConnect: deps.onConnect,
        onDrop: deps.onDrop,
        onNodeDragStop: deps.onNodeDragStop,
        getNodes,
        getEdges,
        setNodes,
        setEdges,
        getTopLeftPosition: deps.getTopLeftPosition,
        pasteNodes: deps.pasteNodes,
        isSidebarOpen: false,
        setTabTooltip: deps.setTabTooltip,
        renameTab: deps.renameTab,
        activeTabId: "tab-1",
        groupSelectedNodes: deps.groupSelectedNodes,
        ungroupSelectedNodes: deps.ungroupSelectedNodes,
        clearHighlights: deps.clearHighlights,
        setIsSearchHighlight: deps.setIsSearchHighlight,
        incRev: deps.incRev,
        pushCleanState: deps.pushCleanState,
        updatePaletteEligibility: deps.updatePaletteEligibility,
        skipNextNodeRemovalRef: deps.skipNextNodeRemovalRef,
        releaseNodeRemovalSnapshotSkip: deps.releaseNodeRemovalSnapshotSkip,
      })
    );

    const payload = {
      functionName: "flow_template",
      nodeData: { flowLabel: "Example Flow" },
    };

    const dropEvent = {
      dataTransfer: {
        getData: vi.fn((type: string) =>
          type === "application/reactflow" ? JSON.stringify(payload) : ""
        ),
        setData: vi.fn(),
        effectAllowed: "move",
      },
    } as unknown as React.DragEvent<HTMLDivElement>;

    act(() => {
      result.current.onDropWithUndo(dropEvent);
    });

    expect(deps.renameTab).toHaveBeenCalledWith("tab-1", "Example Flow", {
      onlyIfEmpty: true,
    });
    expect(deps.setTabTooltip).toHaveBeenCalledWith(
      "tab-1",
      "Workflow: Example Flow"
    );
  });

  it("ignores edge select=true changes from node marquee selection mode", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [];
    let edgesState: Edge[] = [];

    const getNodes = () => nodesState;
    const getEdges = () => edgesState;
    const setNodes = (updater: (nodes: FlowNode[]) => FlowNode[]) => {
      nodesState = updater(nodesState);
    };
    const setEdges = (updater: (edges: Edge[]) => Edge[]) => {
      edgesState = updater(edgesState);
    };

    const { result } = renderHook(() =>
      useFlowInteractions({
        ...deps,
        rawOnNodesChange: deps.rawOnNodesChange,
        rawOnEdgesChange: deps.rawOnEdgesChange,
        onConnect: deps.onConnect,
        onDrop: deps.onDrop,
        onNodeDragStop: deps.onNodeDragStop,
        getNodes,
        getEdges,
        setNodes,
        setEdges,
        getTopLeftPosition: deps.getTopLeftPosition,
        pasteNodes: deps.pasteNodes,
        isSidebarOpen: false,
        setTabTooltip: deps.setTabTooltip,
        renameTab: deps.renameTab,
        activeTabId: "tab-1",
        groupSelectedNodes: deps.groupSelectedNodes,
        ungroupSelectedNodes: deps.ungroupSelectedNodes,
        clearHighlights: deps.clearHighlights,
        setIsSearchHighlight: deps.setIsSearchHighlight,
        incRev: deps.incRev,
        pushCleanState: deps.pushCleanState,
        updatePaletteEligibility: deps.updatePaletteEligibility,
        isSelectionModeActive: true,
        skipNextNodeRemovalRef: deps.skipNextNodeRemovalRef,
        releaseNodeRemovalSnapshotSkip: deps.releaseNodeRemovalSnapshotSkip,
      })
    );

    act(() => {
      result.current.onEdgesChange([
        { id: "edge-1", type: "select", selected: true } as EdgeChange,
      ]);
    });

    expect(deps.rawOnEdgesChange).not.toHaveBeenCalled();

    act(() => {
      result.current.onEdgesChange([
        { id: "edge-1", type: "select", selected: false } as EdgeChange,
      ]);
    });

    expect(deps.rawOnEdgesChange).toHaveBeenCalledWith([
      { id: "edge-1", type: "select", selected: false },
    ]);
  });

  it("forwards edge select=true changes in normal mode", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [];
    let edgesState: Edge[] = [];

    const getNodes = () => nodesState;
    const getEdges = () => edgesState;
    const setNodes = (updater: (nodes: FlowNode[]) => FlowNode[]) => {
      nodesState = updater(nodesState);
    };
    const setEdges = (updater: (edges: Edge[]) => Edge[]) => {
      edgesState = updater(edgesState);
    };

    const { result } = renderHook(() =>
      useFlowInteractions({
        ...deps,
        rawOnNodesChange: deps.rawOnNodesChange,
        rawOnEdgesChange: deps.rawOnEdgesChange,
        onConnect: deps.onConnect,
        onDrop: deps.onDrop,
        onNodeDragStop: deps.onNodeDragStop,
        getNodes,
        getEdges,
        setNodes,
        setEdges,
        getTopLeftPosition: deps.getTopLeftPosition,
        pasteNodes: deps.pasteNodes,
        isSidebarOpen: false,
        setTabTooltip: deps.setTabTooltip,
        renameTab: deps.renameTab,
        activeTabId: "tab-1",
        groupSelectedNodes: deps.groupSelectedNodes,
        ungroupSelectedNodes: deps.ungroupSelectedNodes,
        clearHighlights: deps.clearHighlights,
        setIsSearchHighlight: deps.setIsSearchHighlight,
        incRev: deps.incRev,
        pushCleanState: deps.pushCleanState,
        updatePaletteEligibility: deps.updatePaletteEligibility,
        skipNextNodeRemovalRef: deps.skipNextNodeRemovalRef,
        releaseNodeRemovalSnapshotSkip: deps.releaseNodeRemovalSnapshotSkip,
      })
    );

    act(() => {
      result.current.onEdgesChange([
        { id: "edge-1", type: "select", selected: true } as EdgeChange,
      ]);
    });

    expect(deps.rawOnEdgesChange).toHaveBeenCalledWith([
      { id: "edge-1", type: "select", selected: true },
    ]);
  });

  it("schedules a snapshot for edge shape replacements", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [];
    let edgesState: Edge[] = [];

    const getNodes = () => nodesState;
    const getEdges = () => edgesState;
    const setNodes = (updater: (nodes: FlowNode[]) => FlowNode[]) => {
      nodesState = updater(nodesState);
    };
    const setEdges = (updater: (edges: Edge[]) => Edge[]) => {
      edgesState = updater(edgesState);
    };
    const replacement = {
      id: "edge-1",
      source: "source",
      target: "target",
      data: { curveControlPointOffset: { x: 20, y: 20 } },
    } as Edge;
    const change = {
      id: "edge-1",
      type: "replace",
      item: replacement,
    } as EdgeChange;

    const { result } = renderHook(() =>
      useFlowInteractions({
        ...deps,
        rawOnNodesChange: deps.rawOnNodesChange,
        rawOnEdgesChange: deps.rawOnEdgesChange,
        onConnect: deps.onConnect,
        onDrop: deps.onDrop,
        onNodeDragStop: deps.onNodeDragStop,
        getNodes,
        getEdges,
        setNodes,
        setEdges,
        getTopLeftPosition: deps.getTopLeftPosition,
        pasteNodes: deps.pasteNodes,
        isSidebarOpen: false,
        setTabTooltip: deps.setTabTooltip,
        renameTab: deps.renameTab,
        activeTabId: "tab-1",
        groupSelectedNodes: deps.groupSelectedNodes,
        ungroupSelectedNodes: deps.ungroupSelectedNodes,
        clearHighlights: deps.clearHighlights,
        setIsSearchHighlight: deps.setIsSearchHighlight,
        incRev: deps.incRev,
        pushCleanState: deps.pushCleanState,
        updatePaletteEligibility: deps.updatePaletteEligibility,
        skipNextNodeRemovalRef: deps.skipNextNodeRemovalRef,
        releaseNodeRemovalSnapshotSkip: deps.releaseNodeRemovalSnapshotSkip,
      })
    );

    act(() => {
      result.current.onEdgesChange([change]);
    });

    expect(deps.rawOnEdgesChange).toHaveBeenCalledWith([change]);
    expect(deps.scheduleSnapshot).toHaveBeenCalledWith(
      "Edge shape changed",
      expect.objectContaining({ before: expect.any(Function) })
    );
  });
});
