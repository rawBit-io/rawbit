import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
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

const firstRunDialogProps = {
  current: null as FirstRunDialogMockProps | null,
};

const latestFileImportOptions: {
  current?: FileImportCallbacks;
} = {};

const setNodesMock = vi.fn();
const setEdgesMock = vi.fn();
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

const reactFlowInstanceMock = {
  fitView: fitViewMock,
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
  TopBar: ({ onToggleSidebar }: { onToggleSidebar?: () => void }) => (
    <button data-testid="topbar" onClick={onToggleSidebar}>
      topbar
    </button>
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
    onInit,
  }: {
    onInit?: (instance: ReactFlowInstance) => void;
  }) => {
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
    nodes: [],
    setNodes: setNodesMock,
    edges: [],
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
      data: {
        nodes: [
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
    releaseEdgeSnapshotSkip: vi.fn(),
    lockEdgeSnapshotSkip: vi.fn(),
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
  useSharedFlowLoader: vi.fn(),
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
  latestFileImportOptions.current = undefined;
  localStorage.clear();
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

describe("Flow first-run dialog", () => {
  it("opens the welcome dialog when no stored data exists", async () => {
    renderFlow();

    await waitFor(() => {
      expect(firstRunDialogProps.current?.open).toBe(true);
    });
  });

  it("resets the canvas and marks onboarding complete when starting empty", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderFlow();
    await waitFor(() => {
      expect(firstRunDialogProps.current?.open).toBe(true);
    });

    restoreScriptStepsMock.mockClear();
    setNodesMock.mockClear();
    setEdgesMock.mockClear();
    scheduleSnapshotMock.mockClear();
    setTabTooltipMock.mockClear();

    act(() => {
      firstRunDialogProps.current?.onStartEmpty();
    });

    await waitFor(() => {
      expect(firstRunDialogProps.current?.open).toBe(false);
    });

    expect(restoreScriptStepsMock).toHaveBeenCalledWith([]);
    expect(setNodesMock).toHaveBeenCalledTimes(1);
    expect(setEdgesMock).toHaveBeenCalledTimes(1);
    expect(scheduleSnapshotMock).toHaveBeenCalledWith("Start empty canvas", {
      refresh: true,
    });
    expect(setTabTooltipMock).toHaveBeenCalledWith("tab-1", "Empty canvas");
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
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

    renderFlow();
    await waitFor(() => {
      expect(firstRunDialogProps.current?.open).toBe(true);
    });

    restoreScriptStepsMock.mockClear();
    ingestScriptStepsMock.mockClear();
    setNodesMock.mockClear();
    setEdgesMock.mockClear();
    scheduleSnapshotMock.mockClear();
    setTabTooltipMock.mockClear();
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
    expect(scheduleSnapshotMock).toHaveBeenCalledWith("Load example: Example flow", {
      refresh: true,
    });
    expect(setTabTooltipMock).toHaveBeenCalledWith(
      "tab-1",
      "Example: Example flow"
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
    const throwingClone = vi.fn(() => {
      throw new Error("fail");
    });
    globalThis.structuredClone = throwingClone as typeof structuredClone;

    renderFlow();
    await waitFor(() => {
      expect(firstRunDialogProps.current?.open).toBe(true);
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
