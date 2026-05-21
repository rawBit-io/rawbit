import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Edge, ReactFlowInstance } from "@xyflow/react";

import Flow from "@/components/Flow";
import type { FlowData, FlowNode } from "@/types";

const FIRST_RUN_STORAGE_KEY = "rawbit.ui.welcomeSeen";

type FirstRunDialogMockProps = {
  open: boolean;
  flows: { id: string; label: string }[];
  onStartEmpty: () => void;
  onLoadExample: (id: string) => void;
};

type FileImportCallbacks = {
  onTooltip?: (filename?: string) => void;
  onError?: (message: string, details?: unknown[]) => void;
};

type SharedFlowLoaderMockOptions = {
  replaceGraph?: (graph: {
    nodes: FlowNode[];
    edges: Edge[];
    tabId?: string;
  }) => void;
  ensureShareImportTab?: () => string | null | Promise<string | null>;
};

const firstRunDialogProps = {
  current: null as FirstRunDialogMockProps | null,
};

const latestFileImportOptions: {
  current?: FileImportCallbacks;
} = {};
const flowCanvasProps = {
  current: null as
    | ({
        nodes: FlowNode[];
        edges: Edge[];
        isReadOnly?: boolean;
      } & Record<string, unknown>)
    | null,
};
const sharedFlowLoaderOptions = {
  current: null as SharedFlowLoaderMockOptions | null,
};

const flowNodesState = { current: [] as FlowNode[] };
const flowEdgesState = { current: [] as Edge[] };
const setNodesMock = vi.fn();
const setEdgesMock = vi.fn();
const onDropMock = vi.fn();
const setTabTooltipMock = vi.fn();
const renameTabMock = vi.fn();
const saveTabDataMock = vi.fn();
const scheduleSnapshotMock = vi.fn();
const setInfoDialogMock = vi.fn();
const scriptStepMocks = vi.hoisted(() => ({
  ingestScriptSteps: vi.fn((nodes: FlowNode[]) => nodes),
  restoreScriptSteps: vi.fn(),
}));
const ingestScriptStepsMock = scriptStepMocks.ingestScriptSteps;
const restoreScriptStepsMock = scriptStepMocks.restoreScriptSteps;
const fitViewMock = vi.fn();
const setViewportMock = vi.fn();

const reactFlowInstanceMock = {
  fitView: fitViewMock,
  setViewport: setViewportMock,
} as unknown as ReactFlowInstance;

const originalStructuredClone = globalThis.structuredClone;
const originalWebdriverDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  "webdriver"
);

function setNavigatorWebdriver(value: boolean) {
  Object.defineProperty(window.navigator, "webdriver", {
    configurable: true,
    get: () => value,
  });
}

vi.mock("@/components/nodes/CalculationNode", () => ({
  default: () => null,
}));
vi.mock("@/components/nodes/GroupNode", () => ({
  default: () => null,
}));
vi.mock("@/components/nodes/TextInfoNode", () => ({
  default: () => null,
}));
vi.mock("@/components/nodes/OpCodeNode", () => ({
  default: () => null,
}));

vi.mock("@/components/layout/TopBar", () => ({
  TopBar: ({
    onToggleSidebar,
    onToggleInfoNodes,
    showInfoNodes,
    hasInfoNodes,
  }: {
    onToggleSidebar?: () => void;
    onToggleInfoNodes?: () => void;
    showInfoNodes?: boolean;
    hasInfoNodes?: boolean;
  }) => (
    <>
      <button data-testid="topbar" onClick={onToggleSidebar}>
        topbar
      </button>
      <button
        data-testid="toggle-info-nodes"
        disabled={!hasInfoNodes}
        onClick={onToggleInfoNodes}
      >
        {showInfoNodes ? "hide info" : "show info"}
      </button>
    </>
  ),
}));

vi.mock("@/components/layout/Sidebar", () => ({
  Sidebar: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="sidebar">{isOpen ? "open" : "closed"}</div>
  ),
}));

vi.mock("@/components/ui/ColorPalette", () => ({
  ColorPalette: () => <div data-testid="color-palette" />,
}));

vi.mock("@/components/FlowCanvas", () => ({
  FlowCanvas: ({
    nodes,
    edges,
    isReadOnly,
    onInit,
  }: {
    nodes: FlowNode[];
    edges: Edge[];
    isReadOnly?: boolean;
    onInit?: (instance: ReactFlowInstance) => void;
  }) => {
    flowCanvasProps.current = { nodes, edges, isReadOnly };
    React.useEffect(() => {
      onInit?.(reactFlowInstanceMock);
    }, [onInit]);
    return <div data-testid="flow-canvas" />;
  },
}));

vi.mock("@/components/FlowDialogLayer", () => ({
  FlowDialogLayer: () => <div data-testid="flow-dialog-layer" />,
}));

vi.mock("@/components/FlowPanels", () => ({
  FlowPanels: () => <div data-testid="flow-panels" />,
}));

vi.mock("@/components/dialog/FirstRunDialog", () => ({
  FirstRunDialog: (props: FirstRunDialogMockProps) => {
    firstRunDialogProps.current = props;
    return (
      <div data-testid="first-run-dialog">{props.open ? "open" : "closed"}</div>
    );
  },
}));

vi.mock("@/hooks/useNodeOperations", () => ({
  useNodeOperations: () => ({
    nodes: flowNodesState.current,
    setNodes: setNodesMock,
    edges: flowEdgesState.current,
    setEdges: setEdgesMock,
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onConnect: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: onDropMock,
    onNodeDragStop: vi.fn(),
    onInit: vi.fn(),
    groupSelectedNodes: vi.fn(),
    ungroupSelectedNodes: vi.fn(),
    canGroupSelectedNodes: () => false,
    canUngroupSelectedNodes: () => false,
  }),
}));

vi.mock("@/hooks/useCopyPaste", () => ({
  useCopyPaste: () => ({
    copyNodes: vi.fn(),
    pasteNodes: vi.fn(),
    handleMouseMove: vi.fn(),
    getTopLeftPosition: vi.fn(() => ({ x: 0, y: 0 })),
    hasCopiedNodes: false,
  }),
}));

vi.mock("@/lib/share/scriptStepsCache", () => scriptStepMocks);

vi.mock("@/contexts/UndoRedoContext", () => ({
  UndoRedoProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useUndoRedo", () => ({
  useUndoRedo: () => ({
    pushState: vi.fn(),
    history: [],
    pointer: 0,
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    setActiveTab: vi.fn(),
    initializeTabHistory: vi.fn(),
    removeTabHistory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCalculation", () => ({
  useGlobalCalculationLogic: vi.fn(),
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light" }),
}));

vi.mock("@/my_tx_flows/customFlows", () => ({
  customFlows: [
    {
      id: "example-flow",
      label: "Example flow",
      section: "top-level",
      data: {
        nodes: [
          {
            id: "overview-node",
            type: "shadcnTextInfo",
            position: { x: 375, y: 225 },
            data: {
              content: "# Overview\n\nIntro text",
              width: 875,
              height: 836,
            },
          } as FlowNode,
          {
            id: "calc-node",
            type: "calculation",
            position: { x: 10, y: 20 },
            data: { functionName: "identity", numInputs: 1 },
          } as FlowNode,
          {
            id: "group-node",
            type: "shadcnGroup",
            position: { x: 30, y: 40 },
            data: { title: "Group" },
          } as FlowNode,
        ],
        edges: [
          {
            id: "edge-1",
            source: "calc-node",
            target: "group-node",
          } as Edge,
        ],
        schemaVersion: 1,
        name: "Example flow data",
      } as FlowData,
    },
    {
      id: "older-flow",
      label: "Older flow",
      section: "legacy-foundations",
      data: {
        nodes: [
          {
            id: "older-node",
            type: "calculation",
            position: { x: 0, y: 0 },
            data: { functionName: "identity", numInputs: 1 },
          } as FlowNode,
        ],
        edges: [],
        schemaVersion: 1,
        name: "Older flow data",
      } as FlowData,
    },
  ],
}));

vi.mock("@/hooks/useTabs", () => ({
  useTabs: () => ({
    tabs: [{ id: "tab-1", title: "Flow 1" }],
    activeTabId: "tab-1",
    skipLoadRef: { current: false },
    initialHydrationDone: true,
    closeDialog: { open: false, tabId: null },
    selectTab: vi.fn(),
    addTab: vi.fn(() => "tab-2"),
    requestCloseTab: vi.fn(),
    confirmCloseTab: vi.fn(),
    cancelCloseTab: vi.fn(),
    closeAllTabs: vi.fn(),
    closeOtherTabs: vi.fn(),
    setTabTransform: vi.fn(),
    setTabTooltip: setTabTooltipMock,
    renameTab: renameTabMock,
    saveTabData: saveTabDataMock,
  }),
}));

vi.mock("@/contexts/SnapshotContext", () => ({
  SnapshotProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/useSnapshotScheduler", () => ({
  useSnapshotScheduler: () => ({
    pushCleanState: vi.fn(),
    scheduleSnapshot: scheduleSnapshotMock,
    pendingSnapshotRef: { current: false },
    skipNextEdgeSnapshotRef: { current: false },
    skipNextNodeRemovalRef: { current: false },
    markPendingAfterDirtyChange: vi.fn(),
    lockNodeRemovalSnapshotSkip: vi.fn(),
    releaseNodeRemovalSnapshotSkip: vi.fn(),
  }),
}));

vi.mock("@/hooks/useHighlight", () => ({
  useHighlight: () => [
    { highlightedNodes: new Set<string>(), isSearchHighlight: false },
    {
      highlightAndFit: vi.fn(),
      setIsSearchHighlight: vi.fn(),
      clearHighlights: vi.fn(),
    },
  ],
}));

vi.mock("@/hooks/useShareFlow", () => ({
  useShareFlow: () => ({
    shareDialogOpen: false,
    openShareDialog: vi.fn(),
    closeShareDialog: vi.fn(),
    shareCreatedId: null,
    requestShare: vi.fn(),
    softGateOpen: false,
    closeSoftGate: vi.fn(),
    verifyTurnstile: vi.fn(),
    infoDialog: { open: false, message: "" },
    setInfoDialog: setInfoDialogMock,
    closeInfoDialog: vi.fn(),
  }),
}));

vi.mock("@/hooks/useColorPalette", () => ({
  useColorPalette: () => ({
    isOpen: false,
    position: { x: 0, y: 0 },
    canApply: false,
    open: vi.fn(),
    close: vi.fn(),
    apply: vi.fn(),
    updateEligibility: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMiniMapSize", () => ({
  useMiniMapSize: () => ({ w: 100, h: 80 }),
}));

vi.mock("@/hooks/usePanelAutoClose", () => ({
  usePanelAutoClose: vi.fn(),
}));

vi.mock("@/hooks/useFlowInteractions", () => ({
  useFlowInteractions: () => ({
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onConnectWithUndo: vi.fn(),
    onReconnectWithUndo: vi.fn(),
    onDropWithUndo: vi.fn(),
    groupWithUndo: vi.fn(),
    ungroupWithUndo: vi.fn(),
    onNodeDragStopWithUndo: vi.fn(),
    handlePaste: vi.fn(),
  }),
}));

vi.mock("@/hooks/useFlowHotkeys", () => ({
  useFlowHotkeys: vi.fn(),
}));

vi.mock("@/hooks/useSharedFlowLoader", () => ({
  useSharedFlowLoader: vi.fn((options: SharedFlowLoaderMockOptions) => {
    sharedFlowLoaderOptions.current = options;
  }),
}));

vi.mock("@/hooks/useSimplifiedSave", () => ({
  useSimplifiedSave: () => ({
    showConfirmation: false,
    confirmationMessage: "",
    promptSave: vi.fn(),
    confirmSave: vi.fn(),
    cancelSave: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSearchHighlights", () => ({
  useSearchHighlights: () => ({
    focusSearchHit: vi.fn(),
  }),
}));

vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: (
    _nodes: FlowNode[],
    _edges: Edge[],
    _onNodesChange: unknown,
    _onEdgesChange: unknown,
    options?: FileImportCallbacks & Record<string, unknown>
  ) => {
    latestFileImportOptions.current = {
      onTooltip: options?.onTooltip,
      onError: options?.onError,
    };
    return {
      fileInputRef: { current: null },
      saveFlow: vi.fn(),
      saveLlmExport: vi.fn(),
      saveSimplifiedFlow: vi.fn(),
      openFileDialog: vi.fn(),
      handleFileSelect: vi.fn(),
    };
  },
}));

vi.mock("@/hooks/useConnectPorts", () => ({
  useConnectDialog: () => ({
    allPorts: [],
    sourcePorts: null,
    targetPorts: null,
    existingEdges: [],
    handleApply: vi.fn(),
  }),
}));

const renderFlow = () => render(<Flow />);

beforeEach(() => {
  vi.clearAllMocks();
  firstRunDialogProps.current = null;
  flowCanvasProps.current = null;
  sharedFlowLoaderOptions.current = null;
  latestFileImportOptions.current = undefined;
  flowNodesState.current = [];
  flowEdgesState.current = [];
  setNodesMock.mockImplementation(
    (updater: FlowNode[] | ((nodes: FlowNode[]) => FlowNode[])) => {
      flowNodesState.current =
        typeof updater === "function"
          ? updater(flowNodesState.current)
          : updater;
    }
  );
  setEdgesMock.mockImplementation(
    (updater: Edge[] | ((edges: Edge[]) => Edge[])) => {
      flowEdgesState.current =
        typeof updater === "function"
          ? updater(flowEdgesState.current)
          : updater;
    }
  );
  onDropMock.mockImplementation((event: React.DragEvent<HTMLDivElement>) => {
    const raw = event.dataTransfer.getData("application/reactflow");
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      nodeData?: {
        flowData?: FlowData;
      };
    };
    const flowData = parsed.nodeData?.flowData;
    if (!flowData) return;
    setNodesMock((currentNodes: FlowNode[]) => [
      ...currentNodes.map((node) => ({ ...node, selected: false })),
      ...flowData.nodes.map((node) => ({ ...node, selected: false })),
    ]);
    setEdgesMock((currentEdges: Edge[]) => [
      ...currentEdges,
      ...flowData.edges,
    ]);
  });
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  document.body.innerHTML = "";
  delete document.body.dataset.flowSelectionMode;
  setNavigatorWebdriver(false);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1024,
  });
});

afterEach(() => {
  cleanup();
  if (originalStructuredClone) {
    globalThis.structuredClone = originalStructuredClone;
  } else {
    Reflect.deleteProperty(
      globalThis as Record<string, unknown>,
      "structuredClone"
    );
  }
});

afterAll(() => {
  if (originalWebdriverDescriptor) {
    Object.defineProperty(window.navigator, "webdriver", originalWebdriverDescriptor);
  }
});

describe("Flow selection hotkey", () => {
  it("toggles selection mode dataset while the S key is held", async () => {
    renderFlow();

    expect(document.body.dataset.flowSelectionMode).toBe("false");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    });

    await waitFor(() => {
      expect(document.body.dataset.flowSelectionMode).toBe("true");
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "s" }));
    });

    await waitFor(() => {
      expect(document.body.dataset.flowSelectionMode).toBe("false");
    });
  });

  it("cleans up the dataset attribute on unmount", async () => {
    const { unmount } = renderFlow();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    });

    await waitFor(() => {
      expect(document.body.dataset.flowSelectionMode).toBe("true");
    });

    unmount();

    expect(document.body.dataset.flowSelectionMode).toBeUndefined();
  });
});

describe("Flow info node visibility", () => {
  it("keeps hidden info nodes recoverable after visible node updates", async () => {
    localStorage.setItem(FIRST_RUN_STORAGE_KEY, "1");
    flowNodesState.current = [
      {
        id: "info-node",
        type: "shadcnTextInfo",
        position: { x: 0, y: 0 },
        data: { content: "# Notes" },
      } as FlowNode,
      {
        id: "group-node",
        type: "shadcnGroup",
        position: { x: 120, y: 80 },
        data: { title: "Group", fontSize: 44 },
      } as FlowNode,
    ];
    flowEdgesState.current = [
      {
        id: "info-edge",
        source: "info-node",
        target: "group-node",
      } as Edge,
    ];

    const { getByTestId, rerender } = renderFlow();

    await waitFor(() => {
      expect(flowCanvasProps.current?.nodes.map((node) => node.id)).toEqual([
        "info-node",
        "group-node",
      ]);
    });

    act(() => {
      getByTestId("toggle-info-nodes").click();
    });

    await waitFor(() => {
      const infoNode = flowCanvasProps.current?.nodes.find(
        (node) => node.id === "info-node"
      );
      expect(infoNode).toBeDefined();
      expect(infoNode?.hidden).toBe(true);
    });
    expect(
      flowCanvasProps.current?.edges.find((edge) => edge.id === "info-edge")
        ?.hidden
    ).toBe(true);

    act(() => {
      flowNodesState.current = (flowCanvasProps.current?.nodes ?? []).map(
        (node) =>
          node.id === "group-node"
            ? { ...node, data: { ...node.data, fontSize: 48 } }
            : node
      );
    });
    rerender(<Flow />);

    await waitFor(() => {
      expect(
        flowCanvasProps.current?.nodes.some((node) => node.id === "info-node")
      ).toBe(true);
    });
    expect(
      (getByTestId("toggle-info-nodes") as HTMLButtonElement).disabled
    ).toBe(false);
    expect(
      flowCanvasProps.current?.nodes.find((node) => node.id === "info-node")
        ?.hidden
    ).toBe(true);
  });
});

describe("Flow first-run dialog", () => {
  it("auto-drops the first desktop flow with the guided demo overlay", async () => {
    vi.useFakeTimers();
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    try {
      localStorage.clear();
      renderFlow();

      expect(screen.getByTestId("intro-drop-overlay")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1300);
      });

      expect(screen.getByText("Flow Examples")).toBeInTheDocument();
      expect(screen.getByText("Example flow")).toBeInTheDocument();
      expect(screen.getByText("Dropping onto canvas")).toBeInTheDocument();
      expect(setNodesMock).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(setNodesMock).toHaveBeenCalledTimes(1);
      expect(setEdgesMock).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(FIRST_RUN_STORAGE_KEY)).toBe("1");
      expect(restoreScriptStepsMock).toHaveBeenCalledWith([]);
      expect(ingestScriptStepsMock).toHaveBeenCalledTimes(1);
      expect(scheduleSnapshotMock).toHaveBeenCalledWith(
        "Load example: Example flow data",
        expect.objectContaining({
          refresh: true,
          immediate: true,
          tabId: "tab-1",
          state: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({ id: "overview-node" }),
              expect.objectContaining({ id: "calc-node" }),
              expect.objectContaining({ id: "group-node" }),
            ]),
            edges: expect.arrayContaining([
              expect.objectContaining({ id: "edge-1" }),
            ]),
          }),
        })
      );
      expect(setTabTooltipMock).toHaveBeenCalledWith(
        "tab-1",
        "Example: Example flow data"
      );
      expect(renameTabMock).toHaveBeenCalledWith(
        "tab-1",
        "Example flow data"
      );
      expect(setItemSpy).toHaveBeenCalledWith(FIRST_RUN_STORAGE_KEY, "1");

      act(() => {
        vi.advanceTimersByTime(700);
      });

      expect(setViewportMock).toHaveBeenCalledWith(
        { x: 112, y: 88, zoom: 0.27 },
        { duration: 0 }
      );
      expect(screen.getByTestId("intro-drop-overlay")).toBeInTheDocument();
      expect(screen.getByText("rawBit demo")).toBeInTheDocument();
      const videoFrame = screen.getByTitle("rawBit demo");
      expect(videoFrame).toHaveAttribute(
        "src",
        "https://www.youtube-nocookie.com/embed/6WNHYGgG9oo?rel=0"
      );

      const closeButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Close rawBit demo"]'
      );
      expect(closeButton).not.toBeNull();
      act(() => {
        closeButton?.click();
      });

      expect(screen.queryByTestId("intro-drop-overlay")).not.toBeInTheDocument();
    } finally {
      setItemSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("renders the intro flow directly in mobile read-only mode", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const { getByText, queryByText } = renderFlow();

    await waitFor(() => {
      expect(flowCanvasProps.current?.isReadOnly).toBe(true);
    });

    expect(getByText(/Mobile opens flows in\s+read-only mode/i)).toBeTruthy();
    expect(getByText("Load example flow")).toBeTruthy();
    expect(firstRunDialogProps.current?.flows.map((flow) => flow.label)).toEqual([
      "Example flow",
    ]);
    expect(queryByText("Older flow")).toBeNull();
    expect(flowCanvasProps.current?.nodes.map((node) => node.id)).toEqual([
      "overview-node",
      "calc-node",
      "group-node",
    ]);
    await waitFor(() => {
      expect(setViewportMock).toHaveBeenCalledWith(
        { x: -59, y: 105, zoom: 0.2 },
        { duration: 0 }
      );
    });
    expect(flowCanvasProps.current?.edges.map((edge) => edge.id)).toEqual([
      "edge-1",
    ]);
    expect(firstRunDialogProps.current?.open).toBe(false);
    expect(setNodesMock).not.toHaveBeenCalled();
    expect(setEdgesMock).not.toHaveBeenCalled();
  });

  it("opens the example loader on mobile and loads the selected flow", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const { getByText, rerender } = renderFlow();

    await waitFor(() => {
      expect(flowCanvasProps.current?.isReadOnly).toBe(true);
    });

    act(() => {
      getByText("Load example flow").click();
    });

    await waitFor(() => {
      expect(firstRunDialogProps.current?.open).toBe(true);
    });

    act(() => {
      firstRunDialogProps.current?.onLoadExample("example-flow");
    });
    rerender(<Flow />);

    await waitFor(() => {
      expect(flowCanvasProps.current?.nodes.map((node) => node.id)).toEqual([
        "overview-node",
        "calc-node",
        "group-node",
      ]);
    });
    expect(flowCanvasProps.current?.isReadOnly).toBe(true);
    expect(setNodesMock).toHaveBeenCalledTimes(1);
    expect(setEdgesMock).toHaveBeenCalledTimes(1);
  });

  it("replaces the mobile intro preview with shared-link imports", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const sharedNode = {
      id: "shared-node",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: { functionName: "identity" },
    } as FlowNode;
    const { rerender } = renderFlow();

    await waitFor(() => {
      expect(flowCanvasProps.current?.isReadOnly).toBe(true);
    });

    expect(sharedFlowLoaderOptions.current?.ensureShareImportTab).toEqual(
      expect.any(Function)
    );

    act(() => {
      sharedFlowLoaderOptions.current?.replaceGraph?.({
        nodes: [sharedNode],
        edges: [],
      });
    });
    rerender(<Flow />);

    await waitFor(() => {
      expect(flowCanvasProps.current?.nodes.map((node) => node.id)).toEqual([
        "shared-node",
      ]);
    });
    expect(flowCanvasProps.current?.isReadOnly).toBe(true);
    expect(saveTabDataMock).toHaveBeenCalledWith("tab-1", {
      force: true,
      immediate: true,
      data: {
        nodes: [sharedNode],
        edges: [],
      },
    });
  });

  it("does not auto-load when a hydrated graph exists", async () => {
    flowNodesState.current = [
      {
        id: "existing-node",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: { functionName: "identity" },
      } as FlowNode,
    ];
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderFlow();
    await waitFor(() => {
      expect(firstRunDialogProps.current).not.toBeNull();
    });

    expect(firstRunDialogProps.current?.open).toBe(false);
    expect(setNodesMock).not.toHaveBeenCalled();
    expect(setEdgesMock).not.toHaveBeenCalled();
    expect(setItemSpy).toHaveBeenCalledWith(FIRST_RUN_STORAGE_KEY, "1");

    setItemSpy.mockRestore();
  });

  it("suppresses the dialog in automation environments", async () => {
    setNavigatorWebdriver(true);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderFlow();
    await waitFor(() => {
      expect(firstRunDialogProps.current).not.toBeNull();
    });

    expect(firstRunDialogProps.current?.open).toBe(false);
    expect(setItemSpy).toHaveBeenCalledWith(FIRST_RUN_STORAGE_KEY, "1");
    setItemSpy.mockRestore();
  });

  it("still suppresses the dialog when storage access fails but automation is detected", async () => {
    setNavigatorWebdriver(true);
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderFlow();
    await waitFor(() => {
      expect(firstRunDialogProps.current).not.toBeNull();
    });

    expect(firstRunDialogProps.current?.open).toBe(false);
    expect(setItemSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });
});

describe("Flow example loading", () => {
  it("loads an example flow, schedules a snapshot, and fits the viewport", async () => {
    localStorage.setItem(FIRST_RUN_STORAGE_KEY, "1");
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

    renderFlow();
    await waitFor(() => {
      expect(firstRunDialogProps.current).not.toBeNull();
    });

    restoreScriptStepsMock.mockClear();
    ingestScriptStepsMock.mockClear();
    setNodesMock.mockClear();
    setEdgesMock.mockClear();
    scheduleSnapshotMock.mockClear();
    setTabTooltipMock.mockClear();
    renameTabMock.mockClear();
    fitViewMock.mockClear();

    act(() => {
      firstRunDialogProps.current?.onLoadExample("example-flow");
    });

    await waitFor(() => {
      expect(firstRunDialogProps.current?.open).toBe(false);
    });

    expect(restoreScriptStepsMock).toHaveBeenCalledWith([]);
    expect(ingestScriptStepsMock).toHaveBeenCalledTimes(1);
    expect(setNodesMock).toHaveBeenCalledTimes(1);
    expect(setEdgesMock).toHaveBeenCalledTimes(1);
    expect(scheduleSnapshotMock).toHaveBeenCalledWith(
      "Load example: Example flow data",
      expect.objectContaining({
        refresh: true,
        immediate: true,
        tabId: "tab-1",
        state: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: "overview-node" }),
            expect.objectContaining({ id: "calc-node" }),
            expect.objectContaining({ id: "group-node" }),
          ]),
          edges: expect.arrayContaining([
            expect.objectContaining({ id: "edge-1" }),
          ]),
        }),
      })
    );
    expect(setTabTooltipMock).toHaveBeenCalledWith(
      "tab-1",
      "Example: Example flow data"
    );
    expect(renameTabMock).toHaveBeenCalledWith(
      "tab-1",
      "Example flow data"
    );
    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalledWith({
        padding: 0.2,
        maxZoom: 2,
        duration: 350,
      });
    });

    rafSpy.mockRestore();
  });

  it("falls back to JSON cloning when structuredClone throws", async () => {
    localStorage.setItem(FIRST_RUN_STORAGE_KEY, "1");
    const throwingClone = vi.fn(() => {
      throw new Error("fail");
    });
    globalThis.structuredClone = throwingClone as typeof structuredClone;

    renderFlow();
    await waitFor(() => {
      expect(firstRunDialogProps.current).not.toBeNull();
    });

    setNodesMock.mockClear();
    setEdgesMock.mockClear();

    act(() => {
      firstRunDialogProps.current?.onLoadExample("example-flow");
    });

    await waitFor(() => {
      expect(setNodesMock).toHaveBeenCalledTimes(1);
      expect(setEdgesMock).toHaveBeenCalledTimes(1);
    });

    expect(throwingClone).toHaveBeenCalled();
  });
});

describe("Flow import callbacks", () => {
  it("updates the active tab tooltip when the import helper supplies a filename", async () => {
    renderFlow();

    await waitFor(() => {
      expect(latestFileImportOptions.current?.onTooltip).toBeDefined();
    });

    setTabTooltipMock.mockClear();
    latestFileImportOptions.current?.onTooltip?.("sample.flow.json");

    expect(setTabTooltipMock).toHaveBeenCalledWith(
      "tab-1",
      "File: sample.flow.json"
    );
  });

  it("surfaces validation errors through the info dialog", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    renderFlow();
    await waitFor(() => {
      expect(latestFileImportOptions.current?.onError).toBeDefined();
    });

    const message = "Validation failed";
    const details = [
      { level: "error", code: "TEST", message: "Bad node" },
      { level: "error", code: "EDGE", message: "Bad edge" },
    ];

    setInfoDialogMock.mockClear();
    latestFileImportOptions.current?.onError?.(message, details);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Flow import validation issues",
      details
    );
    expect(setInfoDialogMock).toHaveBeenCalledWith({ open: true, message });

    consoleErrorSpy.mockRestore();
  });
});
