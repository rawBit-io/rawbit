import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import ShadcnGroupNode from "@/components/nodes/GroupNode";
import type { CalculationNodeData, FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";
import { buildEdge, buildFlowNode, buildNodeProps } from "@/test-utils/types";

vi.mock("react-dom", () => ({
  createPortal: (node: React.ReactNode) => node,
}));

const clipboardMock = { copyId: vi.fn(), idCopied: false };
vi.mock("@/hooks/nodes/useClipboardLite", () => ({
  useClipboardLite: () => clipboardMock,
}));

const snapshotMock = {
  lockEdgeSnapshotSkip: vi.fn(),
  releaseEdgeSnapshotSkip: vi.fn(),
  scheduleSnapshot: vi.fn(),
  lockNodeRemovalSnapshotSkip: vi.fn(),
  releaseNodeRemovalSnapshotSkip: vi.fn(),
  skipNextNodeRemovalRef: { current: false },
};
vi.mock("@/hooks/useSnapshotSchedulerContext", () => ({
  useSnapshotSchedulerContext: () => snapshotMock,
}));

const flowActionsMock = {
  groupWithUndo: vi.fn(),
  ungroupWithUndo: vi.fn(),
};
vi.mock("@/hooks/useFlowActions", () => ({
  useFlowActions: () => flowActionsMock,
}));

const pushState = vi.fn();
vi.mock("@/hooks/useUndoRedo", () => ({
  useUndoRedo: () => ({ pushState }),
}));

const reactFlowInstance = {
  setNodes: vi.fn<(updater: FlowNode[] | ((current: FlowNode[]) => FlowNode[])) => void>(),
  setEdges: vi.fn<(updater: Edge[] | ((current: Edge[]) => Edge[])) => void>(),
  getNodes: vi.fn<() => FlowNode[]>(),
  getEdges: vi.fn<() => Edge[]>(),
  getViewport: vi.fn<() => { x: number; y: number; zoom: number }>(),
  setViewport: vi.fn<(viewport: { x: number; y: number; zoom: number }) => void>(),
};

type NodeResizerSpyProps = {
  onResize?: (event: unknown, params: { width: number; height: number; x: number; y: number }) => void;
  onResizeEnd?: () => void;
  [key: string]: unknown;
};

let nodeResizerProps: NodeResizerSpyProps | null = null;

vi.mock("@xyflow/react", () => ({
  NodeResizer: (props: NodeResizerSpyProps) => {
    nodeResizerProps = props;
    return <div data-testid="resizer" />;
  },
  useReactFlow: () => reactFlowInstance,
}));

vi.mock("@/hooks/nodes/useGroupInstances", () => ({
  useGroupInstances: () => ({}),
}));

vi.mock("@/hooks/nodes/useNodePortalMenu", () => ({
  useNodePortalMenu: () => ({
    containerRef: { current: null },
    position: { x: 0, y: 0 },
  }),
}));

let nodes: FlowNode[] = [];
let edges: Edge[] = [];

const createNode = (
  dataOverrides: Partial<CalculationNodeData> = {},
  nodeOverrides: Partial<FlowNode> = {}
): FlowNode =>
  buildFlowNode({
    id: "group-1",
    type: "shadcnGroup",
    position: { x: 0, y: 0 },
    parentId: undefined,
    selected: true,
    data: {
      title: "Group Node",
      fontSize: 44,
      width: 600,
      height: 360,
      ...dataOverrides,
    },
    ...nodeOverrides,
  });

const setupNodes = (customNodes: FlowNode[], customEdges: Edge[] = []) => {
  nodes = customNodes;
  edges = customEdges;
  reactFlowInstance.getNodes.mockImplementation(() => nodes);
  reactFlowInstance.getEdges.mockImplementation(() => edges);
};

const renderGroupNode = (
  overrides: Partial<CalculationNodeData> = {},
  nodeOverrides: Partial<FlowNode> = {}
) => {
  const node = createNode(overrides, nodeOverrides);
  setupNodes([node], []);

  render(<ShadcnGroupNode {...buildNodeProps(node)} />);

  return node;
};

const revealGroupControls = () => {
  fireEvent.click(screen.getByRole("button", { name: "Group Node" }));
};

const openGroupMenu = () => {
  revealGroupControls();
  fireEvent.click(screen.getByTitle("More"));
};

type PointerHandlerEvent = PointerEventInit & {
  pointerId: number;
  target?: EventTarget | null;
  currentTarget?: EventTarget | null;
  stopPropagation?: () => void;
  preventDefault?: () => void;
};

const getReactHandlers = (
  element: HTMLElement
): Partial<Record<string, (event: PointerHandlerEvent) => void>> => {
  const reactKey = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$")
  );
  return reactKey
    ? ((element as unknown as Record<string, unknown>)[reactKey] as Partial<
        Record<string, (event: PointerHandlerEvent) => void>
      >)
    : {};
};

const dispatchWindowPointerEvent = (
  type: string,
  overrides: PointerEventInit & { pointerId: number }
) => {
  const event = Object.assign(
    new Event(type, { bubbles: true, cancelable: true }),
    overrides
  );
  window.dispatchEvent(event);
};

beforeEach(() => {
  vi.useFakeTimers();
  nodeResizerProps = null;
  clipboardMock.copyId.mockClear();
  flowActionsMock.groupWithUndo.mockClear();
  flowActionsMock.ungroupWithUndo.mockClear();
  pushState.mockClear();
  snapshotMock.lockEdgeSnapshotSkip.mockClear();
  snapshotMock.releaseEdgeSnapshotSkip.mockClear();
  snapshotMock.scheduleSnapshot.mockClear();

  reactFlowInstance.setNodes.mockImplementation((updater) => {
    nodes = typeof updater === "function" ? updater(nodes) : updater;
  });
  reactFlowInstance.setEdges.mockImplementation((updater) => {
    edges = typeof updater === "function" ? updater(edges) : updater;
  });
  reactFlowInstance.getNodes.mockImplementation(() => nodes);
  reactFlowInstance.getEdges.mockImplementation(() => edges);
  reactFlowInstance.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  reactFlowInstance.setViewport.mockClear();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("GroupNode interactions", () => {
  it("opens menu and copies id", () => {
    renderGroupNode();

    expect(screen.queryByTitle("More")).not.toBeInTheDocument();
    revealGroupControls();
    expect(screen.getByTitle("More")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("More"));
    fireEvent.click(screen.getByText(/Copy ID/i));

    expect(clipboardMock.copyId).toHaveBeenCalledTimes(1);
  });

  it("shows controls after clicking the title on an unselected group", () => {
    renderGroupNode({}, { selected: false });

    expect(screen.queryByTitle("More")).not.toBeInTheDocument();
    revealGroupControls();

    expect(screen.getByTitle("More")).toBeInTheDocument();
  });

  it("reveals title controls on pointer release instead of pointer down", () => {
    renderGroupNode({}, { selected: false });

    const header = screen.getByTestId("group-header");
    const handlers = getReactHandlers(header);

    act(() => {
      handlers.onPointerDownCapture?.({
        button: 0,
        buttons: 1,
        pointerId: 11,
        clientX: 100,
        clientY: 100,
        target: header,
        currentTarget: header,
        stopPropagation: vi.fn(),
      });
    });

    expect(screen.queryByTitle("More")).not.toBeInTheDocument();

    act(() => {
      dispatchWindowPointerEvent("pointerup", {
        pointerId: 11,
        clientX: 101,
        clientY: 100,
      });
    });

    expect(screen.getByTitle("More")).toBeInTheDocument();
  });

  it("starts title editing on the second title press after the first click reveals controls", () => {
    renderGroupNode();

    const header = screen.getByTestId("group-header");
    const handlers = getReactHandlers(header);

    act(() => {
      handlers.onPointerDownCapture?.({
        button: 0,
        buttons: 1,
        pointerId: 21,
        clientX: 100,
        clientY: 100,
        target: header,
        currentTarget: header,
        stopPropagation: vi.fn(),
      });
    });

    act(() => {
      dispatchWindowPointerEvent("pointerup", {
        pointerId: 21,
        clientX: 100,
        clientY: 100,
      });
    });

    const moreButton = screen.getByTitle("More");
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    act(() => {
      handlers.onPointerDownCapture?.({
        button: 0,
        buttons: 1,
        pointerId: 22,
        clientX: 100,
        clientY: 100,
        target: moreButton,
        currentTarget: header,
        preventDefault,
        stopPropagation,
      });
    });

    expect(screen.getByDisplayValue("Group Node")).toBeInTheDocument();
    expect(screen.queryByTitle("More")).not.toBeInTheDocument();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("keeps title controls hidden after dragging from the title", () => {
    renderGroupNode();

    const header = screen.getByTestId("group-header");
    const handlers = getReactHandlers(header);
    expect(screen.queryByTitle("More")).not.toBeInTheDocument();

    act(() => {
      handlers.onPointerDownCapture?.({
        button: 0,
        buttons: 1,
        pointerId: 12,
        clientX: 100,
        clientY: 100,
        target: header,
        currentTarget: header,
        stopPropagation: vi.fn(),
      });
    });

    expect(screen.queryByTitle("More")).not.toBeInTheDocument();

    act(() => {
      dispatchWindowPointerEvent("pointermove", {
        pointerId: 12,
        clientX: 120,
        clientY: 100,
      });
      dispatchWindowPointerEvent("pointerup", {
        pointerId: 12,
        clientX: 120,
        clientY: 100,
      });
    });

    expect(screen.queryByTitle("More")).not.toBeInTheDocument();
  });

  it("keeps legacy group comment data but does not show a comment editor", () => {
    renderGroupNode({ comment: "Saved in an older flow." });

    openGroupMenu();

    expect(screen.queryByLabelText("Group Comment")).not.toBeInTheDocument();
    expect(nodes[0].data.comment).toBe("Saved in an older flow.");
  });

  it("commits title edits and records undo state", () => {
    renderGroupNode();

    fireEvent.doubleClick(screen.getByRole("button", { name: "Group Node" }));
    const input = screen.getByDisplayValue("Group Node");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    act(() => {
      vi.runAllTimers();
    });

    expect(nodes[0].data.title).toBe("Renamed");
    expect(pushState).toHaveBeenCalledWith(nodes, edges, "Change Group Title");
  });

  it("starts title editing when double-clicking the title area outside the text button", () => {
    renderGroupNode();

    fireEvent.doubleClick(screen.getByTestId("group-title-area"));

    expect(screen.getByDisplayValue("Group Node")).toBeInTheDocument();
  });

  it("resizes the title pill while editing the title draft", () => {
    renderGroupNode();

    const header = screen.getByTestId("group-header");
    const initialWidth = parseInt(header.style.width, 10);

    fireEvent.doubleClick(screen.getByRole("button", { name: "Group Node" }));
    const input = screen.getByDisplayValue("Group Node");

    fireEvent.change(input, {
      target: { value: "A much longer group label while editing" },
    });
    const expandedWidth = parseInt(header.style.width, 10);

    fireEvent.change(input, { target: { value: "A" } });
    const compactWidth = parseInt(header.style.width, 10);

    expect(expandedWidth).toBeGreaterThan(initialWidth);
    expect(compactWidth).toBeLessThan(expandedWidth);
    expect(compactWidth).toBeLessThan(initialWidth);
  });

  it("preserves leading spaces when committing title", () => {
    renderGroupNode();

    fireEvent.doubleClick(screen.getByRole("button", { name: "Group Node" }));
    const input = screen.getByDisplayValue("Group Node");
    fireEvent.change(input, { target: { value: "   Centered" } });
    fireEvent.keyDown(input, { key: "Enter" });

    act(() => {
      vi.runAllTimers();
    });

    expect(nodes[0].data.title).toBe("   Centered");
  });

  it("cancels title edit on escape", () => {
    renderGroupNode();

    fireEvent.doubleClick(screen.getByRole("button", { name: "Group Node" }));
    const input = screen.getByDisplayValue("Group Node");
    fireEvent.change(input, { target: { value: "Should Not Save" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(nodes[0].data.title).toBe("Group Node");
    act(() => {
      vi.runAllTimers();
    });
    expect(pushState).not.toHaveBeenCalled();
  });

  it("increases font size with dynamic step", () => {
    renderGroupNode({ fontSize: 32 });

    revealGroupControls();
    fireEvent.click(screen.getByRole("button", { name: "Increase font size" }));

    act(() => {
      vi.runAllTimers();
    });

    expect(nodes[0].data.fontSize).toBe(36); // step 4 because >= 32
    expect(pushState).toHaveBeenCalledWith(nodes, edges, "Increase Font Size");
  });

  it("renders a top title pill without reducing body height", () => {
    renderGroupNode({ fontSize: 48, height: 360 });
    revealGroupControls();

    const header = screen.getByTestId("group-header");
    const body = screen.getByTestId("group-body");

    const headerHeight = parseInt(header.style.height, 10);
    const headerWidth = parseInt(header.style.width, 10);
    const fontSizeValue = screen.getByText("48");
    const moreIcon = screen.getByTitle("More").querySelector("svg");

    expect(headerHeight).toBeGreaterThan(70);
    expect(headerWidth).toBeGreaterThan(240);
    expect(fontSizeValue.style.fontSize).toBe("48px");
    expect(moreIcon?.getAttribute("style")).toContain("width: 48px");
    expect(moreIcon?.getAttribute("style")).toContain("height: 48px");
    expect(header.className).toContain("-translate-y-1/2");
    expect(header.className).not.toContain("border-b");
    expect(body.className).toContain("inset-0");
  });

  it("decreases font size respecting minimum", () => {
    renderGroupNode({ fontSize: 12 });

    revealGroupControls();
    fireEvent.click(screen.getByRole("button", { name: "Decrease font size" }));

    act(() => {
      vi.runAllTimers();
    });

    expect(nodes[0].data.fontSize).toBe(12); // already at minimum
    expect(pushState).not.toHaveBeenCalled();
  });

  it("applies resize changes and records undo state", () => {
    renderGroupNode();

    expect(nodeResizerProps).toBeTruthy();
    const resizer = nodeResizerProps as NodeResizerSpyProps;
    act(() => {
      resizer.onResize?.(null, {
        width: 800,
        height: 420,
        x: 15,
        y: 25,
      });
    });

    expect(nodes[0].data.width).toBe(800);
    expect(nodes[0].data.height).toBe(420);
    expect(nodes[0].position).toEqual({ x: 15, y: 25 });

    act(() => {
      resizer.onResizeEnd?.();
      vi.runAllTimers();
    });

    expect(pushState).toHaveBeenCalledWith(nodes, edges, "Resize Group");
  });

  it("pans the viewport when dragging inside the body", () => {
    renderGroupNode();

    const body = screen.getByTestId("group-body") as HTMLElement & {
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
    };
    body.setPointerCapture = vi.fn();
    body.releasePointerCapture = vi.fn();

    const reactKey = Object.keys(body).find((key) =>
      key.startsWith("__reactProps$")
    );
    const propsRecord = reactKey
      ? (body as unknown as Record<string, unknown>)[reactKey]
      : undefined;
    const handlers = (propsRecord as
      | Partial<Record<string, (event: PointerEventInit & { pointerId: number }) => void>>
      | undefined) ?? {};

    const makeEvent = (overrides: Partial<PointerEventInit> = {}) => ({
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 120,
      pointerType: "mouse",
      buttons: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: body,
      currentTarget: body,
      ...overrides,
    });

    handlers.onPointerDownCapture?.(makeEvent());
    handlers.onPointerMoveCapture?.(makeEvent({ clientX: 140, clientY: 180 }));
    handlers.onPointerUpCapture?.(makeEvent({ pointerId: 1 }));

    expect(reactFlowInstance.setViewport).toHaveBeenCalledWith({
      x: 40,
      y: 60,
      zoom: 1,
    });
    expect(body.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("clears selected edges when clicking inside the group body", () => {
    const groupNode = createNode();
    const selectedEdge = buildEdge({
      id: "edge-selected",
      source: "node-a",
      target: "node-b",
      selected: true,
    });
    const untouchedEdge = buildEdge({
      id: "edge-untouched",
      source: "node-b",
      target: "node-c",
      selected: false,
    });

    setupNodes([groupNode], [selectedEdge, untouchedEdge]);
    render(<ShadcnGroupNode {...buildNodeProps(groupNode)} />);

    const body = screen.getByTestId("group-body") as HTMLElement & {
      setPointerCapture: (pointerId: number) => void;
    };
    body.setPointerCapture = vi.fn();

    const reactKey = Object.keys(body).find((key) =>
      key.startsWith("__reactProps$")
    );
    const propsRecord = reactKey
      ? (body as unknown as Record<string, unknown>)[reactKey]
      : undefined;
    const handlers = (propsRecord as
      | Partial<Record<string, (event: PointerEventInit & { pointerId: number }) => void>>
      | undefined) ?? {};

    const makeEvent = (overrides: Partial<PointerEventInit> = {}) => ({
      button: 0,
      pointerId: 2,
      clientX: 10,
      clientY: 10,
      pointerType: "mouse",
      buttons: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: body,
      currentTarget: body,
      ...overrides,
    });

    handlers.onPointerDownCapture?.(makeEvent());

    expect(edges.find((edge) => edge.id === "edge-selected")?.selected).toBe(
      false
    );
    expect(edges.find((edge) => edge.id === "edge-untouched")?.selected).toBe(
      false
    );
  });

  it("blurs active inline editors when clicking inside the group body", () => {
    renderGroupNode();

    const body = screen.getByTestId("group-body") as HTMLElement & {
      setPointerCapture: (pointerId: number) => void;
    };
    body.setPointerCapture = vi.fn();

    const editor = document.createElement("input");
    document.body.appendChild(editor);
    editor.focus();
    const blurSpy = vi.spyOn(editor, "blur");

    const reactKey = Object.keys(body).find((key) =>
      key.startsWith("__reactProps$")
    );
    const propsRecord = reactKey
      ? (body as unknown as Record<string, unknown>)[reactKey]
      : undefined;
    const handlers = (propsRecord as
      | Partial<Record<string, (event: PointerEventInit & { pointerId: number }) => void>>
      | undefined) ?? {};

    const makeEvent = (overrides: Partial<PointerEventInit> = {}) => ({
      button: 0,
      pointerId: 3,
      clientX: 30,
      clientY: 30,
      pointerType: "mouse",
      buttons: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: body,
      currentTarget: body,
      ...overrides,
    });

    handlers.onPointerDownCapture?.(makeEvent());

    expect(blurSpy).toHaveBeenCalledTimes(1);

    blurSpy.mockRestore();
    editor.remove();
  });

  it("calls shared ungroup action from menu", () => {
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    renderGroupNode({}, { selected: false });

    openGroupMenu();
    fireEvent.click(screen.getByText(/Ungroup/i));

    expect(flowActionsMock.ungroupWithUndo).toHaveBeenCalledTimes(1);
    expect(nodes[0].selected).toBe(true);

    raf.mockRestore();
  });

  it("deletes group, descendants, and related edges", () => {
    const parent = createNode();
    const child = buildFlowNode({
      id: "child-1",
      type: "calculation",
      position: { x: 0, y: 0 },
      parentId: parent.id,
      selected: false,
      data: {},
    });
    const removedEdge = buildEdge({ id: "edge-1", source: parent.id, target: child.id });
    const preservedEdge = buildEdge({ id: "edge-2", source: "other", target: "external" });

    setupNodes([parent, child], [removedEdge, preservedEdge]);

    render(<ShadcnGroupNode {...buildNodeProps(parent)} />);

    openGroupMenu();
    fireEvent.click(screen.getByText(/Delete Node/i));

    expect(nodes).toEqual([]);
    expect(edges).toEqual([
      expect.objectContaining({
        id: preservedEdge.id,
        source: preservedEdge.source,
        target: preservedEdge.target,
      }),
    ]);
    expect(snapshotMock.lockEdgeSnapshotSkip).toHaveBeenCalledTimes(1);
    expect(snapshotMock.releaseEdgeSnapshotSkip).not.toHaveBeenCalled();
    expect(snapshotMock.scheduleSnapshot).toHaveBeenCalledWith("Node(s) removed", {
      refresh: true,
    });
  });

  it("renders interior fill when borderColor is set", () => {
    renderGroupNode({ borderColor: "#ffaa00" });

    const fill = screen.getByTestId("group-fill");
    expect(fill).toBeInTheDocument();
    expect(fill).toHaveStyle({ backgroundColor: "#ffaa00" });
    expect(fill.style.opacity).toBe("");

    const bodyContent = screen.getByTestId("group-body-content");
    expect(bodyContent.className).toContain("z-10");
    expect(fill.className).toContain("group-fill");
    expect(fill.className).toContain("pointer-events-none");
  });
});
