import { renderWithProviders } from "@/test-utils/render";
import type { SnapshotScheduler } from "@/hooks/useSnapshotScheduler";
import type { FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clipboardHook = vi.fn();
const pushStateMock = vi.fn();

vi.mock("@/hooks/nodes/useClipboardLite", () => ({
  useClipboardLite: (...args: unknown[]) => clipboardHook(...args),
}));

vi.mock("@/hooks/useUndoRedo", () => ({
  useUndoRedo: () => ({
    pushState: pushStateMock,
    undo: vi.fn(),
    redo: vi.fn(),
    jumpTo: vi.fn(),
    setActiveTab: vi.fn(),
    initializeTabHistory: vi.fn(),
    removeTabHistory: vi.fn(),
    history: [],
    pointer: 0,
    canUndo: false,
    canRedo: false,
  }),
  UndoRedoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let setNodesMock: ReturnType<typeof vi.fn>;
let setEdgesMock: ReturnType<typeof vi.fn>;
let nodesState: FlowNode[];
let edgesState: Edge[];
let scheduler: SnapshotScheduler;
const resizeHandlers: { onResize?: (event: unknown, size: { width: number; height: number }) => void; onResizeEnd?: () => void } = {};

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({
      setNodes: (updater: (nodes: FlowNode[]) => FlowNode[]) => setNodesMock(updater),
      setEdges: (updater: (edges: Edge[]) => Edge[]) => setEdgesMock(updater),
      getNodes: () => nodesState,
      getEdges: () => edgesState,
    }),
    NodeResizer: ({ onResize, onResizeEnd }: { onResize: (event: unknown, size: { width: number; height: number }) => void; onResizeEnd: () => void }) => {
      resizeHandlers.onResize = onResize;
      resizeHandlers.onResizeEnd = onResizeEnd;
      return <div data-testid="node-resizer" />;
    },
  };
});

import TextInfoNode from "../TextInfoNode";

describe("TextInfoNode", () => {
  beforeEach(() => {
    nodesState = [
      {
        id: "text-1",
        type: "text",
        position: { x: 0, y: 0 },
        data: {
          title: "Info",
          content: "## Welcome\n\nSome **bold** notes.",
          fontSize: 16,
          borderColor: undefined,
        },
        height: 140,
        width: 360,
        selected: false,
        dragging: false,
        zIndex: 0,
      } as FlowNode,
    ];

    edgesState = [
      {
        id: "edge-text",
        source: "text-1",
        target: "node-2",
      } as Edge,
    ];

    setNodesMock = vi.fn((updater) => {
      nodesState = updater(nodesState);
      return nodesState;
    });

    setEdgesMock = vi.fn((updater) => {
      edgesState = updater(edgesState);
      return edgesState;
    });

    scheduler = {
      pushCleanState: vi.fn(),
      scheduleSnapshot: vi.fn(),
      pendingSnapshotRef: { current: false },
      skipNextEdgeSnapshotRef: { current: false },
      skipNextNodeRemovalRef: { current: false },
      markPendingAfterDirtyChange: vi.fn(),
      clearPendingAfterCalc: vi.fn(),
      lockEdgeSnapshotSkip: vi.fn(),
      releaseEdgeSnapshotSkip: vi.fn(),
      lockNodeRemovalSnapshotSkip: vi.fn(),
      releaseNodeRemovalSnapshotSkip: vi.fn(),
    };

    clipboardHook.mockReset();
    pushStateMock.mockReset();
    resizeHandlers.onResize = undefined;
    resizeHandlers.onResizeEnd = undefined;
  });

  it("renders markdown preview and commits textarea edits", async () => {
    const clipboardMock = {
      prettyResult: "",
      copyResult: vi.fn(),
      copyError: vi.fn(),
      copyId: vi.fn(),
      resultCopied: false,
      errorCopied: false,
      idCopied: false,
    };
    clipboardHook.mockReturnValue(clipboardMock);

    const user = userEvent.setup();

    const { container } = renderWithProviders(
      <TextInfoNode
        id="text-1"
        data={nodesState[0].data}
        selected={false}
        type="text"
        dragging={false}
        zIndex={0}
        width={nodesState[0].width}
        height={nodesState[0].height}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
      { snapshotScheduler: scheduler }
    );

    const display = container.querySelector(".text-info-markdown") as HTMLElement;
    expect(display).not.toHaveClass("nodrag");
    expect(display).toHaveClass("cursor-pointer");
    await user.click(display);

    const textarea = await screen.findByPlaceholderText("Type markdown here…");
    await user.type(textarea, " Updated");
    await user.tab();

    await waitFor(() => expect(pushStateMock).toHaveBeenCalled());

    expect(nodesState[0].data.content).toContain("Updated");
  });

  it("adjusts font size and propagates resize events", async () => {
    const clipboardMock = {
      prettyResult: "",
      copyResult: vi.fn(),
      copyError: vi.fn(),
      copyId: vi.fn(),
      resultCopied: false,
      errorCopied: false,
      idCopied: false,
    };
    clipboardHook.mockReturnValue(clipboardMock);

    const user = userEvent.setup();

    renderWithProviders(
      <TextInfoNode
        id="text-1"
        data={nodesState[0].data}
        selected={true}
        type="text"
        dragging={false}
        zIndex={0}
        width={nodesState[0].width}
        height={nodesState[0].height}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
      { snapshotScheduler: scheduler }
    );

    await user.click(screen.getByTitle("Larger font"));

    expect(nodesState[0].data.fontSize).toBe(18);
    await waitFor(() => expect(pushStateMock).toHaveBeenCalled());
    pushStateMock.mockClear();

    resizeHandlers.onResize?.(null, { width: 420, height: 200 });
    expect(nodesState[0].data.width).toBe(420);
    expect(nodesState[0].data.height).toBe(200);

    resizeHandlers.onResizeEnd?.();
    await waitFor(() => expect(pushStateMock).toHaveBeenCalled());
  });

  it("uses theme fallback fill until a palette color is selected", () => {
    const clipboardMock = {
      prettyResult: "",
      copyResult: vi.fn(),
      copyError: vi.fn(),
      copyId: vi.fn(),
      resultCopied: false,
      errorCopied: false,
      idCopied: false,
    };
    clipboardHook.mockReturnValue(clipboardMock);

    renderWithProviders(
      <TextInfoNode
        id="text-1"
        data={nodesState[0].data}
        selected={false}
        type="text"
        dragging={false}
        zIndex={0}
        width={nodesState[0].width}
        height={nodesState[0].height}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
      { snapshotScheduler: scheduler }
    );

    const fill = screen.getByTestId("text-info-fill");
    expect(fill).toHaveClass("text-info-fill");
    expect(fill).not.toHaveClass("has-palette-fill");
    expect(fill.getAttribute("style") ?? "").not.toContain("#eab308");
    expect(screen.queryByTestId("text-info-header")).toBeNull();
    expect(screen.queryByTitle("Larger font")).toBeNull();
    expect(screen.queryByTitle("Double-click to rename")).toBeNull();
    expect(screen.queryByText("Info")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /text node menu/i })
    ).toBeNull();
  });

  it("does not use the theme fallback fill after explicit palette none", () => {
    const clipboardMock = {
      prettyResult: "",
      copyResult: vi.fn(),
      copyError: vi.fn(),
      copyId: vi.fn(),
      resultCopied: false,
      errorCopied: false,
      idCopied: false,
    };
    clipboardHook.mockReturnValue(clipboardMock);
    nodesState[0].data.borderColor = undefined;
    nodesState[0].data.textInfoFill = "none";

    renderWithProviders(
      <TextInfoNode
        id="text-1"
        data={nodesState[0].data}
        selected={false}
        type="text"
        dragging={false}
        zIndex={0}
        width={nodesState[0].width}
        height={nodesState[0].height}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
      { snapshotScheduler: scheduler }
    );

    const fill = screen.getByTestId("text-info-fill");
    expect(fill).toHaveClass("text-info-fill", "no-text-info-fill");
    expect(fill).not.toHaveClass("has-palette-fill");
  });

  it("uses the palette color for the group-style fill", () => {
    const clipboardMock = {
      prettyResult: "",
      copyResult: vi.fn(),
      copyError: vi.fn(),
      copyId: vi.fn(),
      resultCopied: false,
      errorCopied: false,
      idCopied: false,
    };
    clipboardHook.mockReturnValue(clipboardMock);
    nodesState[0].data.borderColor = "#0d9488";

    renderWithProviders(
      <TextInfoNode
        id="text-1"
        data={nodesState[0].data}
        selected={true}
        type="text"
        dragging={false}
        zIndex={0}
        width={nodesState[0].width}
        height={nodesState[0].height}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
      { snapshotScheduler: scheduler }
    );

    const fill = screen.getByTestId("text-info-fill");
    expect(fill).toHaveStyle({ backgroundColor: "#0d9488" });
    expect(fill).toHaveClass(
      "text-info-fill",
      "has-palette-fill",
      "pointer-events-none"
    );
  });

  it("copies the node id and deletes via the portaled menu", async () => {
    const clipboardMock = {
      prettyResult: "",
      copyResult: vi.fn(),
      copyError: vi.fn(),
      copyId: vi.fn(),
      resultCopied: false,
      errorCopied: false,
      idCopied: false,
    };
    clipboardHook.mockReturnValue(clipboardMock);

    const user = userEvent.setup();

    renderWithProviders(
      <TextInfoNode
        id="text-1"
        data={nodesState[0].data}
        selected={true}
        type="text"
        dragging={false}
        zIndex={0}
        width={nodesState[0].width}
        height={nodesState[0].height}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
      { snapshotScheduler: scheduler }
    );

    const menuButton = screen.getByRole("button", { name: /text node menu/i });

    await user.click(menuButton);
    await user.click(screen.getByRole("menuitem", { name: /copy id/i }));
    expect(clipboardMock.copyId).toHaveBeenCalledTimes(1);

    await user.click(menuButton);
    await user.click(screen.getByRole("menuitem", { name: /delete node/i }));

    expect(nodesState).toHaveLength(0);
    expect(edgesState).toEqual([]);
    expect(scheduler.lockEdgeSnapshotSkip).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(scheduler.scheduleSnapshot).toHaveBeenCalledWith("Node(s) removed", { refresh: true })
    );
  });

  it("closes the portaled menu when clicking outside the node", async () => {
    const clipboardMock = {
      prettyResult: "",
      copyResult: vi.fn(),
      copyError: vi.fn(),
      copyId: vi.fn(),
      resultCopied: false,
      errorCopied: false,
      idCopied: false,
    };
    clipboardHook.mockReturnValue(clipboardMock);

    const user = userEvent.setup();

    renderWithProviders(
      <TextInfoNode
        id="text-1"
        data={nodesState[0].data}
        selected={true}
        type="text"
        dragging={false}
        zIndex={0}
        width={nodesState[0].width}
        height={nodesState[0].height}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
      { snapshotScheduler: scheduler }
    );

    const menuButton = screen.getByRole("button", { name: /text node menu/i });

    await user.click(menuButton);
    expect(screen.getByRole("menuitem", { name: /copy id/i })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: /copy id/i })).toBeNull();
    });
  });
});
