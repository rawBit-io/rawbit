import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { TopBarProps, ExtraTopBarProps } from "@/components/layout/TopBar";
import type { FlowNode } from "@/types";
import type { Edge, ReactFlowInstance, Viewport } from "@xyflow/react";

import Flow from "@/components/Flow";
import type { NodePorts } from "@/components/dialog/ConnectDialog";
import { buildGroupBundledElements } from "@/lib/flow/groupEdgeBundling";
import { useSharedFlowLoader } from "@/hooks/useSharedFlowLoader";
import { buildEdge, buildFlowNode } from "@/test-utils/types";

type FileImportCallbacks = {
  onTooltip?: (filename?: string) => void;
  onError?: (message: string, details?: unknown[]) => void;
};

const topBarProps = {
  current: null as (TopBarProps & ExtraTopBarProps) | null,
};

const flowCanvasProps = {
  current: null as Record<string, unknown> | null,
};
const shareFlowOptions = {
  current: null as
    | {
        getNodes: () => FlowNode[];
        getEdges: () => Edge[];
      }
    | null,
};

const getCanvasCallbacks = () =>
  (flowCanvasProps.current ?? {}) as {
    onPaneClick?: (event: unknown) => void;
    onMoveEnd?: (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void;
  };

const setNodesMock = vi.fn();
const setEdgesMock = vi.fn();
const setTabTransformMock = vi.fn();
const saveTabDataMock = vi.fn();
const scheduleSnapshotMock = vi.fn();
const setIsSearchHighlightMock = vi.fn();
const clearHighlightsMock = vi.fn();
const setInfoDialogMock = vi.fn();
const setTabTooltipMock = vi.fn();
const renameTabMock = vi.fn();
const addTabMock = vi.fn(() => "tab-2");
const markPendingAfterDirtyChangeMock = vi.fn();
const saveLlmExportMock = vi.fn();
const saveSimplifiedFlowMock = vi.fn();
const saveConfirmationHookCalls: {
  saveFn: () => void | Promise<void>;
  promptSave: ReturnType<typeof vi.fn>;
}[] = [];

const mockNodesState: { current: FlowNode[] } = {
  current: [],
};
const mockEdgesState: { current: Edge[] } = {
  current: [],
};
const reactFlowNodesState: { current: FlowNode[] | null } = {
  current: null,
};
const reactFlowEdgesState: { current: Edge[] | null } = {
  current: null,
};

const tabsState: {
  current: Array<{ id: string; title: string; tooltip?: string }>;
  activeTabId: string;
} = {
  current: [{ id: "tab-1", title: "Flow 1" }],
  activeTabId: "tab-1",
};

const fileImportOptions: { current?: FileImportCallbacks } = {};

const skipLoadRef = { current: false };
type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };

const colorPaletteState = {
  isOpen: false,
  position: { x: 0, y: 0 },
  canApply: false,
  open: vi.fn(),
  close: vi.fn(),
  apply: vi.fn(),
  updateEligibility: vi.fn(),
};

const connectDialogState: NodePorts & {
  allPorts: NodePorts[];
  existingEdges: Edge[];
  handleApply: ReturnType<typeof vi.fn>;
  sourcePorts: NodePorts | null;
  targetPorts: NodePorts | null;
  canConnect: boolean;
} = {
  id: "",
  label: "",
  inputs: [],
  outputs: [],
  allPorts: [],
  existingEdges: [],
  handleApply: vi.fn(),
  sourcePorts: null,
  targetPorts: null,
  canConnect: false,
};

const store = {
  nodes: [] as FlowNode[],
  edges: [] as Edge[],
  panZoom: { setClickDistance: vi.fn() },
  resetSelectedElements: vi.fn(),
  unselectNodesAndEdges: vi.fn(),
};

const reactFlowInstanceMock = {
  fitView: vi.fn(),
  setViewport: vi.fn(),
} as unknown as ReactFlowInstance;

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
  TopBar: (props: TopBarProps & ExtraTopBarProps) => {
    topBarProps.current = props;
    return <div data-testid="topbar" />;
  },
}));

vi.mock("@/components/layout/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock("@/components/ui/ColorPalette", () => ({
  ColorPalette: () => <div data-testid="color-palette" />,
}));

vi.mock("@/components/FlowCanvas", () => ({
  FlowCanvas: (props: Record<string, unknown> & {
    onInit?: (instance: ReactFlowInstance) => void;
  }) => {
    flowCanvasProps.current = props;
    const init = props.onInit;
    React.useEffect(() => {
      init?.(reactFlowInstanceMock);
    }, [init]);
    return <div data-testid="flow-canvas" />;
  },
}));

vi.mock("@/components/FlowDialogLayer", () => ({
  FlowDialogLayer: () => <div data-testid="flow-dialog-layer" />,
}));

vi.mock("@/components/FlowPanels", () => ({
  FlowPanels: () => <div data-testid="flow-panels" />,
}));

vi.mock("@/hooks/useNodeOperations", () => ({
  useNodeOperations: () => ({
    nodes: mockNodesState.current,
    setNodes: setNodesMock,
    edges: mockEdgesState.current,
    setEdges: setEdgesMock,
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onConnect: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
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

vi.mock("@/hooks/useTabs", () => ({
  useTabs: () => ({
    tabs: tabsState.current,
    activeTabId: tabsState.activeTabId,
    skipLoadRef,
    initialHydrationDone: true,
    closeDialog: { open: false, tabId: null },
    selectTab: vi.fn(),
    addTab: addTabMock,
    requestCloseTab: vi.fn(),
    confirmCloseTab: vi.fn(),
    cancelCloseTab: vi.fn(),
    closeAllTabs: vi.fn(),
    closeOtherTabs: vi.fn(),
    setTabTransform: setTabTransformMock,
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
    markPendingAfterDirtyChange: markPendingAfterDirtyChangeMock,
    lockNodeRemovalSnapshotSkip: vi.fn(),
    releaseNodeRemovalSnapshotSkip: vi.fn(),
  }),
}));

vi.mock("@/hooks/useHighlight", () => ({
  useHighlight: () => [
    { highlightedNodes: new Set<string>(), isSearchHighlight: false },
    {
      highlightAndFit: vi.fn(),
      setIsSearchHighlight: setIsSearchHighlightMock,
      clearHighlights: clearHighlightsMock,
    },
  ],
}));

vi.mock("@/hooks/useShareFlow", () => ({
  useShareFlow: (options: {
    getNodes: () => FlowNode[];
    getEdges: () => Edge[];
  }) => {
    shareFlowOptions.current = options;
    return {
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
    };
  },
}));

vi.mock("@/hooks/useColorPalette", () => ({
  useColorPalette: () => colorPaletteState,
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
  useSharedFlowLoader: vi.fn(),
}));

vi.mock("@/hooks/useSimplifiedSave", () => ({
  useSimplifiedSave: ({
    saveSimplifiedFlow,
  }: {
    saveSimplifiedFlow: () => void | Promise<void>;
  }) => {
    const promptSave = vi.fn();
    saveConfirmationHookCalls.push({ saveFn: saveSimplifiedFlow, promptSave });
    return {
      showConfirmation: false,
      confirmationMessage: "",
      promptSave,
      confirmSave: vi.fn(),
      cancelSave: vi.fn(),
    };
  },
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
    options?: FileImportCallbacks
  ) => {
    fileImportOptions.current = {
      onTooltip: options?.onTooltip,
      onError: options?.onError,
    };
    return {
      fileInputRef: { current: null },
      saveFlow: vi.fn(),
      saveLlmExport: saveLlmExportMock,
      saveSimplifiedFlow: saveSimplifiedFlowMock,
      openFileDialog: vi.fn(),
      handleFileSelect: vi.fn(),
    };
  },
}));

vi.mock("@/hooks/useConnectPorts", () => ({
  useConnectDialog: () => connectDialogState,
}));

vi.mock("@/my_tx_flows/customFlows", () => ({
  customFlows: [
    {
      id: "example-flow",
      label: "Example flow",
      data: {
        nodes: [],
        edges: [],
        schemaVersion: 1,
      },
    },
  ],
}));

const rfSetNodesMock = vi.fn();
const rfSetEdgesMock = vi.fn();
const updateNodeInternalsMock = vi.fn();

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Position: {
    Bottom: "bottom",
    Left: "left",
    Right: "right",
    Top: "top",
  },
  useReactFlow: () => ({
    getNodes: () => reactFlowNodesState.current ?? mockNodesState.current,
    getEdges: () => reactFlowEdgesState.current ?? mockEdgesState.current,
    setNodes: rfSetNodesMock,
    setEdges: rfSetEdgesMock,
  }),
  useStore: <T,>(selector: (state: typeof store) => T) => selector(store),
  useStoreApi: () => ({
    getState: () => store,
    subscribe: () => () => undefined,
  }),
  useUpdateNodeInternals: () => updateNodeInternalsMock,
}));

const renderFlow = () => render(<Flow />);

beforeEach(() => {
  topBarProps.current = null;
  flowCanvasProps.current = null;
  shareFlowOptions.current = null;
  mockNodesState.current = [];
  mockEdgesState.current = [];
  reactFlowNodesState.current = null;
  reactFlowEdgesState.current = null;
  tabsState.current = [{ id: "tab-1", title: "Flow 1" }];
  tabsState.activeTabId = "tab-1";
  store.nodes = [];
  store.edges = [];
  vi.clearAllMocks();
  colorPaletteState.isOpen = false;
  colorPaletteState.canApply = false;
  colorPaletteState.open.mockClear();
  colorPaletteState.close.mockClear();
  colorPaletteState.updateEligibility.mockClear();
  connectDialogState.sourcePorts = null;
  connectDialogState.targetPorts = null;
  connectDialogState.outputs = [];
  connectDialogState.inputs = [];
  connectDialogState.allPorts = [];
  connectDialogState.canConnect = false;
  connectDialogState.handleApply.mockClear();
  saveLlmExportMock.mockClear();
  saveSimplifiedFlowMock.mockClear();
  rfSetNodesMock.mockClear();
  rfSetEdgesMock.mockClear();
  updateNodeInternalsMock.mockClear();
  addTabMock.mockClear();
  saveConfirmationHookCalls.length = 0;
  skipLoadRef.current = false;
  localStorage.clear();
  localStorage.setItem("rawbit.ui.welcomeSeen", "1");
});

afterEach(() => {
  cleanup();
});

// Tests will be added below

describe("Flow welcome dialog suppression on shared links", () => {
  afterEach(() => {
    // Restore the URL to a plain origin so other tests are unaffected
    window.history.replaceState({}, "", window.location.pathname);
  });

  it("does not show the welcome dialog when ?s= param is present on a fresh browser session", () => {
    // Simulate a fresh browser: no welcomeSeen flag, and a ?s= shared link
    localStorage.clear();
    window.history.replaceState({}, "", "?s=abc123");

    const { queryByText } = render(<Flow />);

    expect(queryByText("Pick how you would like to get started.")).not.toBeInTheDocument();
  });

  it("does not show the welcome dialog when ?share= param is present on a fresh browser session", () => {
    localStorage.clear();
    window.history.replaceState({}, "", "?share=xyz789");

    const { queryByText } = render(<Flow />);

    expect(queryByText("Pick how you would like to get started.")).not.toBeInTheDocument();
  });

});

describe("Flow autosave scheduling", () => {
  let rafSpy: MockInstance<Window["requestAnimationFrame"]>;
  let cancelRafSpy: MockInstance<Window["cancelAnimationFrame"]>;

  beforeEach(() => {
    vi.useFakeTimers();
    rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    cancelRafSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    rafSpy.mockRestore();
    cancelRafSpy.mockRestore();
  });

  it("saves tab data after raf + timeout when not guarded", () => {
    renderFlow();
    act(() => {
      vi.runAllTimers();
    });
    expect(saveTabDataMock).toHaveBeenCalledWith("tab-1");
  });

  it("reschedules when skipLoadRef is true until guard clears", () => {
    renderFlow();
    saveTabDataMock.mockClear();
    skipLoadRef.current = true;

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(saveTabDataMock).not.toHaveBeenCalled();

    skipLoadRef.current = false;
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(saveTabDataMock).toHaveBeenCalledTimes(1);
  });

  it("cancels pending frame and timeout on unmount", () => {
    const clearTimeoutSpy = vi
      .spyOn(window, "clearTimeout")
      .mockImplementation(() => undefined);
    const { unmount } = renderFlow();
    unmount();
    expect(cancelRafSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe("Flow shared import fitting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps retrying shared-flow fit above Safari edge-culling zoom", () => {
    const useSharedFlowLoaderMock = vi.mocked(useSharedFlowLoader);
    mockNodesState.current = [
      {
        id: "node-a",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: { functionName: "identity" },
      } as FlowNode,
    ];
    mockEdgesState.current = [
      { id: "edge-a", source: "node-a", target: "node-b" } as Edge,
    ];

    renderFlow();

    const sharedLoaderOptions = useSharedFlowLoaderMock.mock.calls.at(-1)?.[0] as
      | { fitView?: () => void }
      | undefined;
    expect(sharedLoaderOptions?.fitView).toBeDefined();

    const fitViewMock = reactFlowInstanceMock.fitView as unknown as ReturnType<
      typeof vi.fn
    >;
    fitViewMock.mockClear();

    act(() => {
      sharedLoaderOptions?.fitView?.();
      vi.runOnlyPendingTimers();
    });

    expect(fitViewMock.mock.calls.length).toBeGreaterThan(1);
    expect(
      fitViewMock.mock.calls.every(
        ([options]) =>
          (options as { minZoom?: number } | undefined)?.minZoom === 0.2
      )
    ).toBe(true);
  });

  it("does not use shared tab metadata to control visible-element rendering", () => {
    tabsState.current = [
      { id: "tab-1", title: "share_test_shared", tooltip: "Shared: test-shared" },
    ];

    renderFlow();

    expect(flowCanvasProps.current?.onlyRenderVisibleElements).toBe(true);
  });

  it("keeps visible-element rendering enabled for large graphs", () => {
    mockNodesState.current = Array.from({ length: 50 }, (_, index) => ({
      id: `node-${index}`,
      type: "calculation",
      position: { x: index * 300, y: index * 50 },
      data: { functionName: "identity" },
    })) as FlowNode[];

    renderFlow();

    expect(flowCanvasProps.current?.onlyRenderVisibleElements).toBe(true);
  });

  it("keeps visible-element rendering enabled for normal tabs", () => {
    renderFlow();

    expect(flowCanvasProps.current?.onlyRenderVisibleElements).toBe(true);
  });
});

describe("Flow persistence sources", () => {
  it("shares and loads from canonical React state when React Flow store edges lag", () => {
    const node = {
      id: "node-a",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: { functionName: "identity" },
    } as FlowNode;
    const edge = {
      id: "edge-a",
      source: "node-a",
      target: "node-b",
    } as Edge;
    mockNodesState.current = [node];
    mockEdgesState.current = [edge];
    reactFlowNodesState.current = [];
    reactFlowEdgesState.current = [];

    renderFlow();

    expect(shareFlowOptions.current?.getNodes()).toBe(mockNodesState.current);
    expect(shareFlowOptions.current?.getEdges()).toBe(mockEdgesState.current);

    const sharedLoaderOptions = vi.mocked(useSharedFlowLoader).mock.calls.at(-1)?.[0] as
      | {
          getNodes?: () => FlowNode[];
          getEdges?: () => Edge[];
        }
      | undefined;
    expect(sharedLoaderOptions?.getNodes?.()).toBe(mockNodesState.current);
    expect(sharedLoaderOptions?.getEdges?.()).toBe(mockEdgesState.current);
  });

  it("forces React Flow to re-measure imported nodes when a shared graph replaces the canvas", () => {
    let rafSpy: MockInstance<Window["requestAnimationFrame"]> | null = null;
    try {
      rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb: FrameRequestCallback) => {
          cb(0);
          return 1;
        });

      renderFlow();
      updateNodeInternalsMock.mockClear();

      const sharedLoaderOptions = vi.mocked(useSharedFlowLoader).mock.calls.at(-1)?.[0] as
        | {
            replaceGraph?: (next: {
              nodes: FlowNode[];
              edges: Edge[];
              tabId?: string;
            }) => void;
          }
        | undefined;

      const importedNodes = [
        {
          id: "node-a",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: { functionName: "identity" },
        } as FlowNode,
        {
          id: "node-b",
          type: "calculation",
          position: { x: 100, y: 0 },
          data: { functionName: "identity" },
        } as FlowNode,
      ];

      act(() => {
        sharedLoaderOptions?.replaceGraph?.({
          nodes: importedNodes,
          edges: [{ id: "edge-a", source: "node-a", target: "node-b" } as Edge],
          tabId: "tab-1",
        });
      });

      // After import we expect a forced re-measurement of every imported node
      // so EdgeWrapper can compute positions even when Safari drops a
      // ResizeObserver batch.
      expect(updateNodeInternalsMock).toHaveBeenCalledWith([
        "node-a",
        "node-b",
      ]);
    } finally {
      rafSpy?.mockRestore();
    }
  });

  it("repairs a same-size stale React Flow store during shared import refresh", () => {
    let rafSpy: MockInstance<Window["requestAnimationFrame"]> | null = null;
    try {
      rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb: FrameRequestCallback) => {
          cb(0);
          return 1;
        });

      store.nodes = [
        { id: "old-node-a" } as FlowNode,
        { id: "old-node-b" } as FlowNode,
      ];
      store.edges = [
        { id: "old-edge", source: "old-node-a", target: "old-node-b" } as Edge,
      ];

      renderFlow();
      rfSetNodesMock.mockClear();
      rfSetEdgesMock.mockClear();

      const sharedLoaderOptions = vi.mocked(useSharedFlowLoader).mock.calls.at(-1)?.[0] as
        | {
            replaceGraph?: (next: {
              nodes: FlowNode[];
              edges: Edge[];
              tabId?: string;
            }) => void;
          }
        | undefined;

      const importedNodes = [
        {
          id: "node-a",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: { functionName: "identity" },
        } as FlowNode,
        {
          id: "node-b",
          type: "calculation",
          position: { x: 100, y: 0 },
          data: { functionName: "identity" },
        } as FlowNode,
      ];

      act(() => {
        sharedLoaderOptions?.replaceGraph?.({
          nodes: importedNodes,
          edges: [{ id: "edge-a", source: "node-a", target: "node-b" } as Edge],
          tabId: "tab-1",
        });
      });

      expect(rfSetNodesMock).toHaveBeenCalledWith(importedNodes);
      expect(rfSetEdgesMock).toHaveBeenCalledWith([
        expect.objectContaining({ id: "edge-a" }),
      ]);
    } finally {
      rafSpy?.mockRestore();
    }
  });

  it("repairs a stale React Flow store when edge ids match but handles differ", () => {
    let rafSpy: MockInstance<Window["requestAnimationFrame"]> | null = null;
    try {
      rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb: FrameRequestCallback) => {
          cb(0);
          return 1;
        });

      const importedNodes = [
        {
          id: "node-a",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: { functionName: "identity" },
        } as FlowNode,
        {
          id: "node-b",
          type: "calculation",
          position: { x: 100, y: 0 },
          data: { functionName: "identity" },
        } as FlowNode,
      ];
      store.nodes = importedNodes;
      store.edges = [
        {
          id: "edge-a",
          source: "node-a",
          target: "node-b",
          targetHandle: "input-1",
        } as Edge,
      ];

      renderFlow();
      rfSetNodesMock.mockClear();
      rfSetEdgesMock.mockClear();

      const sharedLoaderOptions = vi.mocked(useSharedFlowLoader).mock.calls.at(-1)?.[0] as
        | {
            replaceGraph?: (next: {
              nodes: FlowNode[];
              edges: Edge[];
              tabId?: string;
            }) => void;
          }
        | undefined;

      act(() => {
        sharedLoaderOptions?.replaceGraph?.({
          nodes: importedNodes,
          edges: [
            {
              id: "edge-a",
              source: "node-a",
              target: "node-b",
              targetHandle: "input-0",
            } as Edge,
          ],
          tabId: "tab-1",
        });
      });

      expect(rfSetNodesMock).toHaveBeenCalledWith(importedNodes);
      expect(rfSetEdgesMock).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "edge-a",
          targetHandle: "input-0",
        }),
      ]);
    } finally {
      rafSpy?.mockRestore();
    }
  });

  it("does not repair a grouped visual store that matches the imported canonical graph", () => {
    let rafSpy: MockInstance<Window["requestAnimationFrame"]> | null = null;
    try {
      rafSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((cb: FrameRequestCallback) => {
          cb(0);
          return 1;
        });

      const measured = { width: 120, height: 80 };
      const nodes = [
        buildFlowNode({
          id: "group-a",
          type: "shadcnGroup",
          position: { x: 0, y: 0 },
          measured,
          data: { title: "A", width: 320, height: 220 },
        }),
        buildFlowNode({
          id: "group-b",
          type: "shadcnGroup",
          position: { x: 500, y: 0 },
          measured,
          data: { title: "B", width: 320, height: 220 },
        }),
        buildFlowNode({
          id: "a1",
          parentId: "group-a",
          measured,
        }),
        buildFlowNode({
          id: "a2",
          parentId: "group-a",
          measured,
        }),
        buildFlowNode({
          id: "b1",
          parentId: "group-b",
          measured,
        }),
      ];
      const edges = [
        buildEdge({
          id: "e1",
          source: "a1",
          target: "b1",
          sourceHandle: "output-0",
          targetHandle: "input-0",
        }),
        buildEdge({
          id: "e2",
          source: "a2",
          target: "b1",
          sourceHandle: "output-0",
          targetHandle: "input-1",
        }),
      ];
      const visual = buildGroupBundledElements({ nodes, edges });
      mockNodesState.current = nodes;
      mockEdgesState.current = edges;
      store.nodes = visual.nodes;
      store.edges = visual.edges;

      renderFlow();
      rfSetNodesMock.mockClear();
      rfSetEdgesMock.mockClear();

      const sharedLoaderOptions = vi.mocked(useSharedFlowLoader).mock.calls.at(-1)?.[0] as
        | {
            replaceGraph?: (next: {
              nodes: FlowNode[];
              edges: Edge[];
              tabId?: string;
            }) => void;
          }
        | undefined;

      act(() => {
        sharedLoaderOptions?.replaceGraph?.({
          nodes,
          edges,
          tabId: "tab-1",
        });
      });

      expect(rfSetNodesMock).not.toHaveBeenCalled();
      expect(rfSetEdgesMock).not.toHaveBeenCalled();
    } finally {
      rafSpy?.mockRestore();
    }
  });
});

describe("Flow color palette controls", () => {
  it("opens the palette only when selection is eligible", () => {
    colorPaletteState.canApply = true;
    renderFlow();
    topBarProps.current?.onToggleColorPalette?.(
      new MouseEvent("click") as unknown as React.MouseEvent
    );
    expect(colorPaletteState.updateEligibility).toHaveBeenCalled();
    expect(colorPaletteState.open).toHaveBeenCalled();
  });

  it("closes the palette when already open", () => {
    colorPaletteState.isOpen = true;
    renderFlow();
    topBarProps.current?.onToggleColorPalette?.(
      new MouseEvent("click") as unknown as React.MouseEvent
    );
    expect(colorPaletteState.close).toHaveBeenCalled();
  });

  it("ignores toggle when selection is ineligible", () => {
    colorPaletteState.canApply = false;
    renderFlow();
    topBarProps.current?.onToggleColorPalette?.(
      new MouseEvent("click") as unknown as React.MouseEvent
    );
    expect(colorPaletteState.open).not.toHaveBeenCalled();
  });

  it("clears highlights and selection on pane clicks", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    store.nodes = [
      { id: "node-a", selected: true } as FlowNode,
      { id: "node-b", selected: false } as FlowNode,
    ];
    store.edges = [
      { id: "edge-a", source: "node-a", target: "node-b", selected: true } as Edge,
    ];

    await act(async () => {
      renderFlow();
    });

    await act(async () => {
      getCanvasCallbacks().onPaneClick?.(null);
    });

    expect(colorPaletteState.close).toHaveBeenCalled();
    expect(setIsSearchHighlightMock).toHaveBeenCalledWith(false);
    expect(clearHighlightsMock).toHaveBeenCalled();
    expect(store.resetSelectedElements).toHaveBeenCalled();
    expect(store.unselectNodesAndEdges).toHaveBeenCalledWith({
      nodes: expect.any(Array),
      edges: expect.any(Array),
    });
    expect(setNodesMock).toHaveBeenCalled();
    expect(setEdgesMock).toHaveBeenCalled();

    const nodeUpdater = setNodesMock.mock.calls[0]?.[0] as
      | ((nodes: FlowNode[]) => FlowNode[])
      | undefined;
    const edgeUpdater = setEdgesMock.mock.calls[0]?.[0] as
      | ((edges: Edge[]) => Edge[])
      | undefined;
    expect(nodeUpdater).toBeDefined();
    expect(edgeUpdater).toBeDefined();
    const updatedNodes = nodeUpdater!(store.nodes);
    const updatedEdges = edgeUpdater!(store.edges);
    expect(updatedNodes?.every((node) => node.selected === false)).toBe(true);
    expect(updatedEdges?.every((edge) => edge.selected === false)).toBe(true);

    rafSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

describe("Flow palette idle scheduling", () => {
  afterEach(() => {
    // @ts-expect-error clear test shim
    delete (window as Window & { requestIdleCallback?: () => number }).requestIdleCallback;
    // @ts-expect-error clear test shim
    delete (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
  });

  it("uses requestIdleCallback when available", () => {
    const cancelSpy = vi.fn();
    let idleCallback: ((deadline: IdleDeadlineLike) => void) | null = null;
    (window as Window & {
      requestIdleCallback?: (
        cb: (deadline: IdleDeadlineLike) => void,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    }).requestIdleCallback = (
      cb: (deadline: IdleDeadlineLike) => void
    ) => {
      idleCallback = cb;
      return 42;
    };
    (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback = cancelSpy;

    const { unmount } = renderFlow();

    expect(idleCallback).toBeTruthy();
    const cb = idleCallback as ((deadline: IdleDeadlineLike) => void) | null;
    if (cb) {
      cb({ didTimeout: false, timeRemaining: () => 0 });
    }
    expect(colorPaletteState.updateEligibility).toHaveBeenCalled();

    unmount();
    expect(cancelSpy).toHaveBeenCalledWith(42);
  });

  it("falls back to setTimeout when requestIdleCallback is unavailable", () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(window, "setTimeout");

    renderFlow();
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 120);

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(colorPaletteState.updateEligibility).toHaveBeenCalled();

    timeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe("Flow connect button enablement", () => {
  const makePorts = (id: string, type: "source" | "target"): NodePorts => ({
    id,
    label: id,
    inputs:
      type === "target"
        ? [{ label: `${id}-input`, handleId: `${id}-input-0` }]
        : [],
    outputs:
      type === "source"
        ? [{ label: `${id}-output`, handleId: `${id}-output-0` }]
        : [],
  });

  it("enables connect when two compatible nodes are selected", () => {
    mockNodesState.current = [
      { id: "node-a", type: "calculation", position: { x: 0, y: 0 }, data: {}, selected: true } as FlowNode,
      { id: "node-b", type: "calculation", position: { x: 0, y: 0 }, data: {}, selected: true } as FlowNode,
    ];
    connectDialogState.sourcePorts = makePorts("node-a", "source");
    connectDialogState.targetPorts = makePorts("node-b", "target");
    connectDialogState.canConnect = true;

    renderFlow();

    expect(topBarProps.current?.connectDisabled).toBe(false);
  });

  it("enables connect when the hook auto-orients a reversed selection", () => {
    mockNodesState.current = [
      { id: "node-a", type: "calculation", position: { x: 0, y: 0 }, data: {}, selected: true } as FlowNode,
      { id: "node-b", type: "calculation", position: { x: 0, y: 0 }, data: {}, selected: true } as FlowNode,
    ];
    connectDialogState.sourcePorts = makePorts("node-b", "source");
    connectDialogState.targetPorts = makePorts("node-a", "target");
    connectDialogState.canConnect = true;

    renderFlow();

    expect(topBarProps.current?.connectDisabled).toBe(false);
  });

  it("disables connect when requirements are not met", () => {
    mockNodesState.current = [
      { id: "node-a", type: "calculation", position: { x: 0, y: 0 }, data: {}, selected: true } as FlowNode,
    ];
    connectDialogState.sourcePorts = makePorts("node-a", "source");
    connectDialogState.targetPorts = makePorts("node-b", "target");

    renderFlow();

    expect(topBarProps.current?.connectDisabled).toBe(true);
  });
});

describe("Flow canvas viewport persistence", () => {
  it("forwards move events to setTabTransform", () => {
    renderFlow();
    getCanvasCallbacks().onMoveEnd?.(null, {
      x: 10,
      y: -5,
      zoom: 1.25,
    } as Viewport);
    expect(setTabTransformMock).toHaveBeenCalledWith("tab-1", {
      x: 10,
      y: -5,
      zoom: 1.25,
    });
  });
});

describe("Flow save confirmations", () => {
  it("routes both simplified and LLM save actions through confirmation prompts", () => {
    renderFlow();

    expect(saveConfirmationHookCalls).toHaveLength(2);
    const simplifiedPrompt = saveConfirmationHookCalls.find(
      (entry) => entry.saveFn === saveSimplifiedFlowMock
    );
    const llmPrompt = saveConfirmationHookCalls.find(
      (entry) => entry.saveFn === saveLlmExportMock
    );

    expect(simplifiedPrompt?.promptSave).toBeDefined();
    expect(llmPrompt?.promptSave).toBeDefined();
    expect(topBarProps.current?.onSaveSimplified).toBe(simplifiedPrompt?.promptSave);
    expect(topBarProps.current?.onSaveLlmExport).toBe(llmPrompt?.promptSave);
  });
});
