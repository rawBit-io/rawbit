import { act, render, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  DragEvent as ReactDragEvent,
} from "react";

import { useFlowInteractions } from "@/hooks/useFlowInteractions";
import type { Connection, Edge, EdgeChange, NodeChange } from "@xyflow/react";
import type { FlowNode } from "@/types";

interface FlowInteractionsHarnessHandles {
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  getNodes: () => FlowNode[];
  getEdges: () => Edge[];
  flowInteractions: ReturnType<typeof useFlowInteractions>;
  scheduleSnapshot: ReturnType<typeof vi.fn>;
  markPendingAfterDirtyChange: ReturnType<typeof vi.fn>;
  updatePaletteEligibility: ReturnType<typeof vi.fn>;
  setTabTooltip: ReturnType<typeof vi.fn>;
  pushCleanState: ReturnType<typeof vi.fn>;
  clearHighlights: ReturnType<typeof vi.fn>;
  setIsSearchHighlight: ReturnType<typeof vi.fn>;
  incRev: ReturnType<typeof vi.fn>;
  pasteNodes: ReturnType<typeof vi.fn>;
  renameTab: ReturnType<typeof vi.fn>;
  onDrop: ReturnType<typeof vi.fn>;
  groupSelectedNodes: ReturnType<typeof vi.fn>;
  ungroupSelectedNodes: ReturnType<typeof vi.fn>;
  loadingUndoRef: MutableRefObject<boolean>;
  isPastingRef: MutableRefObject<boolean>;
  pendingSnapshotRef: MutableRefObject<boolean>;
  skipNextEdgeSnapshotRef: MutableRefObject<boolean>;
  skipNextNodeRemovalRef: MutableRefObject<boolean>;
  releaseNodeRemovalSnapshotSkip: ReturnType<typeof vi.fn>;
  getTopLeftPosition: ReturnType<typeof vi.fn>;
}

interface FlowInteractionsHarnessProps {
  initialNodes?: FlowNode[];
  initialEdges?: Edge[];
  isSidebarOpen?: boolean;
  groupResult?: boolean;
  ungroupResult?: boolean;
  onReady?: (handles: FlowInteractionsHarnessHandles) => void;
}

function applyNodeChanges(nodes: FlowNode[], changes: NodeChange<FlowNode>[]): FlowNode[] {
  return changes.reduce<FlowNode[]>((acc, change) => {
    switch (change.type) {
      case "add":
        return [...acc, change.item];
      case "remove":
        return acc.filter((node) => node.id !== change.id);
      case "select":
        return acc.map((node) =>
          node.id === change.id ? { ...node, selected: change.selected ?? false } : node
        );
      case "replace":
        return acc.map((node) => (node.id === change.id ? change.item : node));
      case "position":
        return acc.map((node) =>
          node.id === change.id
            ? {
                ...node,
                position: change.position ?? node.position,
                positionAbsolute: change.positionAbsolute ?? node.positionAbsolute,
              }
            : node
        );
      default:
        return acc;
    }
  }, nodes);
}

function applyEdgeChanges(edges: Edge[], changes: EdgeChange[]): Edge[] {
  return changes.reduce<Edge[]>((acc, change) => {
    switch (change.type) {
      case "add":
        return [...acc, change.item];
      case "remove":
        return acc.filter((edge) => edge.id !== change.id);
      case "select":
        return acc.map((edge) =>
          edge.id === change.id ? { ...edge, selected: change.selected ?? false } : edge
        );
      default:
        return acc;
    }
  }, edges);
}

const DEFAULT_NODE: FlowNode = {
  id: "calc-node",
  type: "calculation",
  position: { x: 0, y: 0 },
  data: { functionName: "identity", dirty: false },
};

const createDragEvent = (data: string): ReactDragEvent<HTMLDivElement> =>
  ({
    dataTransfer: {
      getData: vi.fn(() => data),
    },
  }) as unknown as ReactDragEvent<HTMLDivElement>;

function FlowInteractionsHarness({
  initialNodes = [DEFAULT_NODE],
  initialEdges = [],
  isSidebarOpen = true,
  groupResult = true,
  ungroupResult = true,
  onReady,
}: FlowInteractionsHarnessProps) {
  const [nodes, setNodes] = useState<FlowNode[]>(() => initialNodes);
  const [edges, setEdges] = useState<Edge[]>(() => initialEdges);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const scheduleSnapshot = useRef(vi.fn());
  const markPendingAfterDirtyChange = useRef(vi.fn());
  const updatePaletteEligibility = useRef(vi.fn());
  const setTabTooltip = useRef(vi.fn());
  const pushCleanState = useRef(vi.fn());
  const clearHighlights = useRef(vi.fn());
  const setIsSearchHighlight = useRef(vi.fn());
  const incRev = useRef(vi.fn(() => 1));
  const pasteNodes = useRef(vi.fn());
  const renameTab = useRef(vi.fn());
  const onDrop = useRef(vi.fn());
  const groupSelectedNodes = useRef(vi.fn(() => groupResult));
  const ungroupSelectedNodes = useRef(vi.fn(() => ungroupResult));
  const getTopLeftPosition = useRef(vi.fn(() => ({ x: 0, y: 0 })));

  const pendingSnapshotRef = useRef(false);
  const skipNextEdgeSnapshotRef = useRef(false);
  const skipNextNodeRemovalRef = useRef(false);
  const loadingUndoRef = useRef(false);
  const isPastingRef = useRef(false);
  const releaseNodeRemovalSnapshotSkip = useRef(vi.fn());

  const rawOnNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((prev) => applyNodeChanges(prev, changes));
    },
    []
  );

  const rawOnEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((prev) => applyEdgeChanges(prev, changes));
  }, []);

  const flowInteractions = useFlowInteractions({
    rawOnNodesChange,
    rawOnEdgesChange,
    onConnect: () => undefined,
    onDrop: (evt) => onDrop.current(evt),
    onNodeDragStop: () => undefined,
    getNodes: () => nodesRef.current,
    getEdges: () => edgesRef.current,
    setNodes,
    setEdges,
    scheduleSnapshot: scheduleSnapshot.current,
    pendingSnapshotRef,
    skipNextEdgeSnapshotRef,
    skipNextNodeRemovalRef,
    markPendingAfterDirtyChange: markPendingAfterDirtyChange.current,
    releaseNodeRemovalSnapshotSkip: releaseNodeRemovalSnapshotSkip.current,
    loadingUndoRef,
    isPastingRef,
    getTopLeftPosition: () => getTopLeftPosition.current(),
    pasteNodes: (position) => pasteNodes.current(position),
    isSidebarOpen,
    setTabTooltip: (tabId, tooltip) => setTabTooltip.current(tabId, tooltip),
    activeTabId: "tab-1",
    groupSelectedNodes: () => groupSelectedNodes.current(),
    ungroupSelectedNodes: () => ungroupSelectedNodes.current(),
    clearHighlights: () => clearHighlights.current(),
    setIsSearchHighlight: (value) => setIsSearchHighlight.current(value),
    incRev: () => incRev.current(),
    pushCleanState: (nextNodes, nextEdges, label) =>
      pushCleanState.current(nextNodes, nextEdges, label),
    updatePaletteEligibility: () => updatePaletteEligibility.current(),
    renameTab: (tabId, title, options) =>
      renameTab.current(tabId, title, options),
  });

  useEffect(() => {
    onReady?.({
      setNodes,
      setEdges,
      getNodes: () => nodesRef.current,
      getEdges: () => edgesRef.current,
      flowInteractions,
      scheduleSnapshot: scheduleSnapshot.current,
      markPendingAfterDirtyChange: markPendingAfterDirtyChange.current,
      updatePaletteEligibility: updatePaletteEligibility.current,
      setTabTooltip: setTabTooltip.current,
      pushCleanState: pushCleanState.current,
      clearHighlights: clearHighlights.current,
      setIsSearchHighlight: setIsSearchHighlight.current,
      incRev: incRev.current,
      pasteNodes: pasteNodes.current,
      renameTab: renameTab.current,
      onDrop: onDrop.current,
      groupSelectedNodes: groupSelectedNodes.current,
      ungroupSelectedNodes: ungroupSelectedNodes.current,
      loadingUndoRef,
      isPastingRef,
      pendingSnapshotRef,
      skipNextEdgeSnapshotRef,
      skipNextNodeRemovalRef,
      releaseNodeRemovalSnapshotSkip: releaseNodeRemovalSnapshotSkip.current,
      getTopLeftPosition: getTopLeftPosition.current,
    });
  }, [flowInteractions, onReady]);

  return null;
}

async function renderFlowInteractionsHarness(
  props: Omit<FlowInteractionsHarnessProps, "onReady"> = {}
): Promise<{
  rerender: (nextProps?: Omit<FlowInteractionsHarnessProps, "onReady">) => void;
  getHandles: () => FlowInteractionsHarnessHandles;
}> {
  const handlesRef: { current: FlowInteractionsHarnessHandles | null } = {
    current: null,
  };

  const view = render(
    <ReactFlowProvider>
      <FlowInteractionsHarness
        {...props}
        onReady={(handles) => {
          handlesRef.current = handles;
        }}
      />
    </ReactFlowProvider>
  );

  await waitFor(() => expect(handlesRef.current).not.toBeNull());

  return {
    rerender: (nextProps = {}) => {
      view.rerender(
        <ReactFlowProvider>
          <FlowInteractionsHarness
            {...nextProps}
            onReady={(handles) => {
              handlesRef.current = handles;
            }}
          />
        </ReactFlowProvider>
      );
    },
    getHandles: () => handlesRef.current as FlowInteractionsHarnessHandles,
  };
}

const createPositionChange = (
  id: string,
  position: { x: number; y: number },
  dragging: boolean
): NodeChange<FlowNode> => ({
  id,
  type: "position",
  dragging,
  position,
  positionAbsolute: position,
});

describe("Flow interactions integration", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not mark a pending calc snapshot when a drag only moves the node", async () => {
    const { getHandles } = await renderFlowInteractionsHarness();
    const handles = getHandles();

    handles.scheduleSnapshot.mockClear();
    handles.markPendingAfterDirtyChange.mockClear();

    act(() => {
      handles.flowInteractions.onNodesChange([
        createPositionChange("calc-node", { x: 0, y: 0 }, true),
      ]);
    });

    act(() => {
      handles.setNodes((prev) =>
        prev.map((node) =>
          node.id === "calc-node"
            ? { ...node, position: { x: 40, y: 0 } }
            : node
        )
      );
    });

    act(() => {
      handles.flowInteractions.onNodesChange([
        createPositionChange("calc-node", { x: 40, y: 0 }, false),
      ]);
    });

    expect(handles.scheduleSnapshot).not.toHaveBeenCalled();
    expect(handles.markPendingAfterDirtyChange).not.toHaveBeenCalled();
  });

  it("schedules refresh snapshots for node removals", async () => {
    const { getHandles } = await renderFlowInteractionsHarness({
      initialNodes: [
        DEFAULT_NODE,
        {
          ...DEFAULT_NODE,
          id: "to-remove",
          position: { x: 10, y: 0 },
        },
      ],
    });
    const handles = getHandles();

    act(() => {
      handles.flowInteractions.onNodesChange([
        { id: "to-remove", type: "remove" } as NodeChange<FlowNode>,
      ]);
    });

    expect(handles.scheduleSnapshot).toHaveBeenCalledWith(
      "Node(s) removed",
      expect.objectContaining({ refresh: true })
    );
  });

  it("flags skip-next-edge snapshot when typing on dirty nodes", async () => {
    const { getHandles } = await renderFlowInteractionsHarness();
    const handles = getHandles();

    act(() => {
      handles.setNodes((prev) =>
        prev.map((node) =>
          node.id === "calc-node"
            ? { ...node, data: { ...node.data, dirty: true } }
            : node
        )
      );
    });

    handles.markPendingAfterDirtyChange.mockClear();

    act(() => {
      handles.flowInteractions.onNodesChange([
        {
          id: "calc-node",
          type: "replace",
          item: {
            ...handles.getNodes()[0],
            data: { ...handles.getNodes()[0].data, label: "changed" },
          },
        } as NodeChange<FlowNode>,
      ]);
    });

    expect(handles.markPendingAfterDirtyChange).toHaveBeenCalledTimes(1);
    expect(handles.skipNextEdgeSnapshotRef.current).toBe(true);
  });

  it("defers selection-only updates to palette eligibility", async () => {
    const { getHandles } = await renderFlowInteractionsHarness();
    const handles = getHandles();

    act(() => {
      handles.flowInteractions.onNodesChange([
        { id: "calc-node", type: "select", selected: true } as NodeChange<FlowNode>,
      ]);
    });

    expect(handles.updatePaletteEligibility).toHaveBeenCalledTimes(1);
    expect(handles.getNodes()[0]?.selected).toBe(true);
  });

  it("marks edge additions dirty and waits for the after-calc snapshot", async () => {
    const { getHandles } = await renderFlowInteractionsHarness({
      initialNodes: [
        {
          ...DEFAULT_NODE,
          id: "a",
        },
        {
          ...DEFAULT_NODE,
          id: "b",
        },
      ],
    });
    const handles = getHandles();

    act(() => {
      handles.flowInteractions.onEdgesChange([
        {
          type: "add",
          item: { id: "edge-1", source: "a", target: "b" },
        },
      ]);
    });

    expect(handles.getNodes().find((node) => node.id === "a")?.data?.dirty).toBe(true);
    expect(handles.getNodes().find((node) => node.id === "b")?.data?.dirty).toBe(true);
    expect(handles.markPendingAfterDirtyChange).toHaveBeenCalledTimes(1);
    expect(handles.scheduleSnapshot).not.toHaveBeenCalled();
  });

  it("marks edge removals dirty and leaves skip guards for after-calc cleanup", async () => {
    const { getHandles } = await renderFlowInteractionsHarness({
      initialNodes: [
        {
          ...DEFAULT_NODE,
          id: "a",
        },
        {
          ...DEFAULT_NODE,
          id: "b",
        },
      ],
      initialEdges: [{ id: "edge-1", source: "a", target: "b" } as Edge],
    });
    const handles = getHandles();

    handles.skipNextEdgeSnapshotRef.current = true;

    act(() => {
      handles.flowInteractions.onEdgesChange([
        { id: "edge-1", type: "remove" },
      ]);
    });

    expect(handles.getNodes().find((node) => node.id === "a")?.data?.dirty).toBe(true);
    expect(handles.getNodes().find((node) => node.id === "b")?.data?.dirty).toBe(true);
    expect(handles.markPendingAfterDirtyChange).toHaveBeenCalledTimes(1);
    expect(handles.scheduleSnapshot).not.toHaveBeenCalled();
    expect(handles.skipNextEdgeSnapshotRef.current).toBe(true);
  });

  it("marks connected nodes dirty when connecting with undo", async () => {
    const { getHandles } = await renderFlowInteractionsHarness({
      initialNodes: [
        {
          ...DEFAULT_NODE,
          id: "source",
        },
        {
          ...DEFAULT_NODE,
          id: "target",
        },
      ],
    });
    const handles = getHandles();

    handles.markPendingAfterDirtyChange.mockClear();

    act(() => {
      const connection: Connection = {
        source: "source",
        target: "target",
        sourceHandle: null,
        targetHandle: null,
      };
      handles.flowInteractions.onConnectWithUndo(connection);
    });

    const nodes = handles.getNodes();
    expect(nodes.find((node) => node.id === "source")?.data?.dirty).toBe(true);
    expect(nodes.find((node) => node.id === "target")?.data?.dirty).toBe(true);
    expect(handles.markPendingAfterDirtyChange).toHaveBeenCalledTimes(1);
  });

  it("reconnects edges and marks both old and new endpoints dirty", async () => {
    const { getHandles } = await renderFlowInteractionsHarness({
      initialNodes: [
        { ...DEFAULT_NODE, id: "a" },
        { ...DEFAULT_NODE, id: "b" },
        { ...DEFAULT_NODE, id: "c" },
      ],
      initialEdges: [{ id: "edge-1", source: "a", target: "b", sourceHandle: null, targetHandle: null } as Edge],
    });
    const handles = getHandles();

    handles.markPendingAfterDirtyChange.mockClear();

    act(() => {
      handles.flowInteractions.onReconnectWithUndo(
        { id: "edge-1", source: "a", target: "b" } as Edge,
        { source: "a", target: "c", sourceHandle: null, targetHandle: null } satisfies Connection
      );
    });

    const edges = handles.getEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual(expect.objectContaining({ source: "a", target: "c" }));

    const nodes = handles.getNodes();
    ["a", "b", "c"].forEach((id) =>
      expect(nodes.find((node) => node.id === id)?.data?.dirty).toBe(true)
    );
    expect(handles.markPendingAfterDirtyChange).toHaveBeenCalledTimes(1);
  });

  it("clears selection state and schedules a snapshot on drop", async () => {
    const { getHandles } = await renderFlowInteractionsHarness({
      initialNodes: [
        { ...DEFAULT_NODE, id: "selected", selected: true },
      ],
    });
    const handles = getHandles();

    const event = createDragEvent("{}");

    act(() => {
      handles.flowInteractions.onDropWithUndo(event);
    });

    expect(handles.getNodes().every((node) => !node.selected)).toBe(true);
    expect(handles.scheduleSnapshot).toHaveBeenCalledWith("Node(s) dropped");
    expect(handles.setTabTooltip).not.toHaveBeenCalled();
  });

  it("updates tooltip when dropping a workflow into an empty canvas", async () => {
    const { getHandles } = await renderFlowInteractionsHarness({
      initialNodes: [],
    });
    const handles = getHandles();

    handles.onDrop.mockImplementation(() => {
      handles.setNodes((prev) => [
        {
          ...DEFAULT_NODE,
          id: "new-node",
          selected: true,
        },
        ...prev,
      ]);
    });

    const event = createDragEvent(
      JSON.stringify({
        functionName: "flow_template",
        nodeData: { flowLabel: "Example Flow" },
      })
    );

    act(() => {
      handles.flowInteractions.onDropWithUndo(event);
    });

    expect(handles.setTabTooltip).toHaveBeenCalledWith("tab-1", "Workflow: Example Flow");
    expect(handles.scheduleSnapshot).toHaveBeenCalledWith("Node(s) dropped");
    expect(handles.getNodes().every((node) => !node.selected)).toBe(true);
    expect(handles.renameTab).toHaveBeenCalledWith("tab-1", "Example Flow", {
      onlyIfEmpty: true,
    });
  });

  it("groups selected nodes and clears highlights", async () => {
    const { getHandles } = await renderFlowInteractionsHarness({
      initialNodes: [
        { ...DEFAULT_NODE, id: "n1", selected: true },
        { ...DEFAULT_NODE, id: "n2", selected: true },
      ],
      initialEdges: [
        { id: "e1", source: "n1", target: "n2", selected: true } as Edge,
      ],
    });
    const handles = getHandles();

    handles.clearHighlights.mockClear();
    handles.setIsSearchHighlight.mockClear();

    act(() => {
      handles.flowInteractions.groupWithUndo();
    });

    expect(handles.clearHighlights).toHaveBeenCalled();
    expect(handles.setIsSearchHighlight).toHaveBeenCalledWith(false);
    expect(handles.getNodes().every((node) => !node.selected)).toBe(true);
    expect(handles.getEdges().every((edge) => !edge.selected)).toBe(true);
    expect(handles.scheduleSnapshot).toHaveBeenCalledWith(
      "Group nodes",
      expect.objectContaining({ refresh: true })
    );
  });

  it("ungroups selected nodes and bumps revision", async () => {
    const { getHandles } = await renderFlowInteractionsHarness();
    const handles = getHandles();

    handles.incRev.mockImplementationOnce(() => 2);

    act(() => {
      handles.flowInteractions.ungroupWithUndo();
    });

    expect(handles.incRev).toHaveBeenCalledTimes(1);
    expect(handles.scheduleSnapshot).toHaveBeenCalledWith(
      "Ungroup nodes",
      expect.objectContaining({ refresh: true })
    );
  });

  it("pushes clean state after drag stop when nodes moved", async () => {
    const { getHandles } = await renderFlowInteractionsHarness();
    const handles = getHandles();

    handles.pushCleanState.mockClear();
    handles.incRev.mockClear();

    act(() => {
      handles.flowInteractions.onNodesChange([
        createPositionChange("calc-node", { x: 0, y: 0 }, true),
      ]);
    });

    act(() => {
      handles.setNodes((prev) =>
        prev.map((node) =>
          node.id === "calc-node"
            ? { ...node, position: { x: 25, y: 10 } }
            : node
        )
      );
    });

    act(() => {
      handles.flowInteractions.onNodesChange([
        createPositionChange("calc-node", { x: 25, y: 10 }, false),
      ]);
    });

    handles.pendingSnapshotRef.current = true;

    act(() => {
      const mouseEvent = new MouseEvent("mouseup");
      handles.flowInteractions.onNodeDragStopWithUndo(
        mouseEvent as unknown as ReactMouseEvent<Element>,
        handles.getNodes()[0],
        handles.getNodes()
      );
    });

    await waitFor(() => expect(handles.pushCleanState).toHaveBeenCalled());
    expect(handles.incRev).toHaveBeenCalled();
    expect(handles.pendingSnapshotRef.current).toBe(false);
    const [nodesArg, edgesArg, label] = handles.pushCleanState.mock.calls.at(-1) ?? [];
    expect(label).toBe("Node(s) moved");
    expect(nodesArg[0]?.position).toEqual({ x: 25, y: 10 });
    expect(edgesArg).toEqual(handles.getEdges());
  });

  it("handles paste with offsets and resets the pasting flag", async () => {
    const { getHandles } = await renderFlowInteractionsHarness({
      isSidebarOpen: true,
    });
    const handles = getHandles();

    handles.getTopLeftPosition.mockReturnValueOnce({ x: 12, y: 34 });

    act(() => {
      handles.flowInteractions.handlePaste();
    });

    expect(handles.pasteNodes).toHaveBeenCalledWith({ x: 12, y: 34 });
    expect(handles.scheduleSnapshot).toHaveBeenCalledWith(
      "Pasted nodes",
      expect.objectContaining({ refresh: true })
    );

    await waitFor(() => expect(handles.isPastingRef.current).toBe(false));

    handles.pasteNodes.mockClear();

    act(() => {
      handles.flowInteractions.handlePaste(false);
    });

    expect(handles.pasteNodes).toHaveBeenCalledWith(undefined);
  });
});
