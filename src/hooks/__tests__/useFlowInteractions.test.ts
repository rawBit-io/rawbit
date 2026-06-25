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
    delete document.body.dataset.largeDrag;
    delete document.body.dataset.safariNodeDrag;
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
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"
    );

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

    expect(document.body.dataset.safariNodeDrag).toBe("true");

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

    expect(document.body.dataset.safariNodeDrag).toBeUndefined();

    const mouseEvent = new MouseEvent("mouseup") as unknown as ReactMouseEvent<Element>;

    act(() => {
      result.current.onNodeDragStopWithUndo(mouseEvent, nodesState[0], nodesState);
    });

    expect(deps.markPendingAfterDirtyChange).not.toHaveBeenCalled();
    expect(deps.incRev).toHaveBeenCalled();
    expect(deps.pushCleanState).toHaveBeenCalledWith(
      nodesState,
      edgesState,
      "Node(s) moved"
    );
    expect(deps.pendingSnapshotRef.current).toBe(false);
  });

  it("removes edges attached to a removed node", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: {},
      } as FlowNode,
      {
        id: "deleted",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "target",
        type: "calculation",
        position: { x: 240, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "other",
        type: "calculation",
        position: { x: 440, y: 40 },
        data: {},
      } as FlowNode,
    ];
    let edgesState: Edge[] = [
      { id: "edge-deleted-out", source: "deleted", target: "target" } as Edge,
      { id: "edge-deleted-in", source: "other", target: "deleted" } as Edge,
      { id: "edge-kept", source: "other", target: "target" } as Edge,
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

    const removeChange = { id: "deleted", type: "remove" } as NodeChange<FlowNode>;

    act(() => {
      result.current.onNodesChange([removeChange]);
    });

    expect(edgesState.map((edge) => edge.id)).toEqual(["edge-kept"]);
    expect(deps.rawOnNodesChange).toHaveBeenCalledWith([removeChange]);
    expect(deps.scheduleSnapshot).toHaveBeenCalledWith(
      "Node(s) removed",
      expect.objectContaining({ refresh: true })
    );
  });

  it("applies remove changes synchronously when a large selection is throttled", () => {
    // Regression for RB-10: queue rAF callbacks instead of running them so
    // a deferred (torn) remove path would be observable.
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const deps = baseDeps();
    let nodesState: FlowNode[] = Array.from({ length: 30 }, (_, index) => ({
      id: `node-${index}`,
      type: "calculation",
      position: { x: index * 10, y: 0 },
      data: {},
      selected: true,
    })) as FlowNode[];
    let edgesState: Edge[] = [
      { id: "edge-0-1", source: "node-0", target: "node-1" } as Edge,
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

    const removeChanges = nodesState.map(
      (node) => ({ id: node.id, type: "remove" }) as NodeChange<FlowNode>
    );

    act(() => {
      result.current.onNodesChange(removeChanges);
    });

    // Structural changes must reach React Flow synchronously (not on the
    // next frame) so the "Node(s) removed" snapshot captures nodes and
    // edges from the same post-delete state.
    expect(deps.rawOnNodesChange).toHaveBeenCalledWith(removeChanges);
    expect(edgesState).toEqual([]);
    expect(deps.scheduleSnapshot).toHaveBeenCalledWith(
      "Node(s) removed",
      expect.objectContaining({ refresh: true })
    );
  });

  it("removes child edges when a group is removed", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: {},
      } as FlowNode,
      {
        id: "child-a",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "outside",
        type: "calculation",
        position: { x: 240, y: 40 },
        data: {},
      } as FlowNode,
    ];
    let edgesState: Edge[] = [
      { id: "edge-child", source: "child-a", target: "outside" } as Edge,
      { id: "edge-group", source: "group-a", target: "outside" } as Edge,
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

    act(() => {
      result.current.onNodesChange([
        { id: "group-a", type: "remove" } as NodeChange<FlowNode>,
      ]);
    });

    expect(edgesState).toEqual([]);
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

  it("marks removed edge endpoints dirty so stale cycle errors can recalculate", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [
      {
        id: "source",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: {
          dirty: false,
          error: true,
          extendedError: "Cycle detected in this sub-graph – calculation aborted.",
        },
      } as FlowNode,
      {
        id: "target",
        type: "calculation",
        position: { x: 200, y: 0 },
        data: {
          dirty: false,
          error: true,
          extendedError: "Cycle detected in this sub-graph – calculation aborted.",
        },
      } as FlowNode,
      {
        id: "unrelated",
        type: "calculation",
        position: { x: 400, y: 0 },
        data: { dirty: false },
      } as FlowNode,
    ];
    let edgesState: Edge[] = [
      {
        id: "cycle-edge",
        source: "source",
        target: "target",
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

    const removeChange = { id: "cycle-edge", type: "remove" } as EdgeChange;

    act(() => {
      result.current.onEdgesChange([removeChange]);
    });

    expect(deps.rawOnEdgesChange).toHaveBeenCalledWith([removeChange]);
    expect(nodesState.find((node) => node.id === "source")?.data?.dirty).toBe(true);
    expect(nodesState.find((node) => node.id === "target")?.data?.dirty).toBe(true);
    expect(nodesState.find((node) => node.id === "unrelated")?.data?.dirty).toBe(false);
    expect(deps.markPendingAfterDirtyChange).toHaveBeenCalledTimes(1);
    expect(deps.scheduleSnapshot).not.toHaveBeenCalled();
  });

  it("marks added edge endpoints dirty and waits for the after-calc snapshot", () => {
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
    ];
    let edgesState: Edge[] = [];

    const getNodes = () => nodesState;
    const getEdges = () => edgesState;
    const setNodes = (updater: (nodes: FlowNode[]) => FlowNode[]) => {
      nodesState = updater(nodesState);
    };
    const setEdges = (updater: (edges: Edge[]) => Edge[]) => {
      edgesState = updater(edgesState);
    };
    const addedEdge = {
      id: "edge-1",
      source: "source",
      target: "target",
    } as Edge;
    const change = {
      type: "add",
      item: addedEdge,
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
    expect(nodesState.find((node) => node.id === "source")?.data?.dirty).toBe(true);
    expect(nodesState.find((node) => node.id === "target")?.data?.dirty).toBe(true);
    expect(deps.markPendingAfterDirtyChange).toHaveBeenCalledTimes(1);
    expect(deps.scheduleSnapshot).not.toHaveBeenCalled();
  });

  it("marks reconnected edge endpoints dirty and waits for the after-calc snapshot", () => {
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
        position: { x: 400, y: 0 },
        data: { dirty: false },
      } as FlowNode,
      {
        id: "unrelated",
        type: "calculation",
        position: { x: 600, y: 0 },
        data: { dirty: false },
      } as FlowNode,
    ];
    let edgesState: Edge[] = [
      {
        id: "edge-1",
        source: "source",
        target: "target",
        sourceHandle: "out",
        targetHandle: "old",
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
    const change = {
      id: "edge-1",
      type: "replace",
      item: {
        id: "edge-1",
        source: "source",
        target: "replacement",
        sourceHandle: "out",
        targetHandle: "new",
      } as Edge,
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
    expect(nodesState.find((node) => node.id === "source")?.data?.dirty).toBe(true);
    expect(nodesState.find((node) => node.id === "target")?.data?.dirty).toBe(true);
    expect(nodesState.find((node) => node.id === "replacement")?.data?.dirty).toBe(true);
    expect(nodesState.find((node) => node.id === "unrelated")?.data?.dirty).toBe(false);
    expect(deps.markPendingAfterDirtyChange).toHaveBeenCalledTimes(1);
    expect(deps.scheduleSnapshot).not.toHaveBeenCalled();
  });

  it("keeps immediate undo snapshots for visual-only edge shape replacements", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [];
    let edgesState: Edge[] = [
      {
        id: "edge-1",
        source: "source",
        target: "target",
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
    const change = {
      id: "edge-1",
      type: "replace",
      item: {
        ...edgesState[0],
        data: { curveControlPointOffset: { x: 20, y: 20 } },
      } as Edge,
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
    expect(deps.markPendingAfterDirtyChange).not.toHaveBeenCalled();
    expect(deps.scheduleSnapshot).toHaveBeenCalledWith("Edge shape changed");
  });

  it("records non-dirty node replacements for autosave and undo", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: {
          title: "Group A",
          groupBundlePortOffsets: {
            sourceByBundle: {
              "group-a->group-b": 12,
            },
          },
        },
      } as FlowNode,
    ];
    const edgesState: Edge[] = [];

    const getNodes = () => nodesState;
    const getEdges = () => edgesState;
    const setNodes = (updater: (nodes: FlowNode[]) => FlowNode[]) => {
      nodesState = updater(nodesState);
    };
    const setEdges = vi.fn<(updater: (edges: Edge[]) => Edge[]) => void>();
    const change = {
      id: "group-a",
      type: "replace",
      item: {
        ...nodesState[0],
        data: {
          ...nodesState[0].data,
          groupBundlePortOffsets: {
            sourceByBundle: {
              "group-a->group-b": 64,
            },
          },
        },
      },
    } as NodeChange<FlowNode>;

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
      result.current.onNodesChange([change]);
    });

    expect(deps.rawOnNodesChange).toHaveBeenCalledWith([change]);
    expect(deps.incRev).toHaveBeenCalledTimes(1);
    expect(deps.markPendingAfterDirtyChange).not.toHaveBeenCalled();
    expect(deps.scheduleSnapshot).toHaveBeenCalledWith("Node data changed", {
      refresh: true,
    });
  });

  it("does not bump the after-calc token for dirty replacements while one is already pending", () => {
    const deps = baseDeps();
    deps.pendingSnapshotRef.current = true;
    let nodesState: FlowNode[] = [
      {
        id: "node-a",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: {
          dirty: true,
          value: "old result",
        },
      } as FlowNode,
    ];
    const edgesState: Edge[] = [];

    const getNodes = () => nodesState;
    const getEdges = () => edgesState;
    const setNodes = (updater: (nodes: FlowNode[]) => FlowNode[]) => {
      nodesState = updater(nodesState);
    };
    const setEdges = vi.fn<(updater: (edges: Edge[]) => Edge[]) => void>();
    const change = {
      id: "node-a",
      type: "replace",
      item: {
        ...nodesState[0],
        data: {
          ...nodesState[0].data,
          value: "new result",
        },
      },
    } as NodeChange<FlowNode>;

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
      result.current.onNodesChange([change]);
    });

    expect(deps.rawOnNodesChange).toHaveBeenCalledWith([change]);
    expect(deps.incRev).toHaveBeenCalledTimes(1);
    expect(deps.markPendingAfterDirtyChange).not.toHaveBeenCalled();
    expect(deps.scheduleSnapshot).not.toHaveBeenCalled();
    expect(deps.skipNextEdgeSnapshotRef.current).toBe(true);
  });

  it("does not record clean calculation result replacements as undo snapshots", () => {
    const deps = baseDeps();
    let nodesState: FlowNode[] = [
      {
        id: "node-a",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: {
          dirty: false,
          result: "old result",
        },
      } as FlowNode,
    ];
    const edgesState: Edge[] = [];

    const getNodes = () => nodesState;
    const getEdges = () => edgesState;
    const setNodes = (updater: (nodes: FlowNode[]) => FlowNode[]) => {
      nodesState = updater(nodesState);
    };
    const setEdges = vi.fn<(updater: (edges: Edge[]) => Edge[]) => void>();
    const change = {
      id: "node-a",
      type: "replace",
      item: {
        ...nodesState[0],
        data: {
          ...nodesState[0].data,
          result: "new result",
        },
      },
    } as NodeChange<FlowNode>;

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
      result.current.onNodesChange([change]);
    });

    expect(deps.rawOnNodesChange).toHaveBeenCalledWith([change]);
    expect(deps.incRev).toHaveBeenCalledTimes(1);
    expect(deps.markPendingAfterDirtyChange).not.toHaveBeenCalled();
    expect(deps.scheduleSnapshot).not.toHaveBeenCalled();
  });
});
