import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { useSharedFlowLoader } from "@/hooks/useSharedFlowLoader";
import type { SnapshotOptions } from "@/hooks/useSnapshotScheduler";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import type { FlowData, FlowNode } from "@/types";
import { MAX_FLOW_BYTES, formatBytes } from "@/lib/flow/schema";
import type { FlowValidationResult } from "@/lib/flow/validate";
import {
  applyEdgeChanges,
  applyNodeChanges,
  makeFlowData,
  makeFlowNode,
} from "@/integration/test-helpers/flowFixtures";

const loadSharedMock = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<FlowData>>(async () => makeFlowData())
);
const importWithFreshIdsMock = vi.hoisted(() =>
  vi.fn(
    ({ importNodes, importEdges }: { importNodes: FlowNode[]; importEdges: Edge[] }) => ({
      nodes: importNodes,
      edges: importEdges,
    })
  )
);
const measureFlowBytesMock = vi.hoisted(() =>
  vi.fn<(payload: string | number) => number>(() => 42)
);
const validateFlowDataMock = vi.hoisted(() =>
  vi.fn<() => FlowValidationResult>(() => ({
    ok: true,
    schemaVersion: 1,
    issues: [],
    errors: [],
    warnings: [],
  }))
);
const ingestScriptStepsMock = vi.hoisted(() =>
  vi.fn<(nodes: FlowNode[]) => FlowNode[]>((nodes) => nodes)
);

vi.mock("@/lib/share", () => ({
  loadShared: loadSharedMock,
  getShareJsonUrl: (id: string) => `https://share.local/s/${id}`,
}));

vi.mock("@/lib/idUtils", async (orig) => {
  const actual = await orig<typeof import("@/lib/idUtils")>();
  return {
    ...actual,
    importWithFreshIds: importWithFreshIdsMock,
  };
});

vi.mock("@/lib/flow/schema", async (orig) => {
  const actual = await orig<typeof import("@/lib/flow/schema")>();
  return {
    ...actual,
    measureFlowBytes: measureFlowBytesMock,
  };
});

vi.mock("@/lib/flow/validate", async (orig) => {
  const actual = await orig<typeof import("@/lib/flow/validate")>();
  return {
    ...actual,
    validateFlowData: validateFlowDataMock,
  };
});

vi.mock("@/lib/share/scriptStepsCache", async (orig) => {
  const actual = await orig<typeof import("@/lib/share/scriptStepsCache")>();
  return {
    ...actual,
    ingestScriptSteps: ingestScriptStepsMock,
  };
});

type InfoDialogState = { open: boolean; message: string } | null;

type ScheduleCall = [string, SnapshotOptions | undefined];

interface HarnessSnapshot {
  nodes: FlowNode[];
  edges: Edge[];
  tooltip: string | null;
  infoDialog: InfoDialogState;
  scheduleCalls: ScheduleCall[];
  fitViewCallCount: number;
}

interface SharedLoaderHarnessHandles {
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  getSnapshot: () => HarnessSnapshot;
  scheduleSnapshot: ReturnType<typeof vi.fn>;
  setTabTooltip: ReturnType<typeof vi.fn>;
  setInfoDialogSpy: ReturnType<typeof vi.fn>;
  fitViewSpy: ReturnType<typeof vi.fn>;
  renameTab: ReturnType<typeof vi.fn>;
}

interface SharedLoaderHarnessProps {
  initialNodes?: FlowNode[];
  initialEdges?: Edge[];
  activeTabId?: string;
  replaceGraph?: boolean;
  ensureImportTab?: boolean;
  onReady?: (handles: SharedLoaderHarnessHandles) => void;
}

function SharedLoaderHarness({
  initialNodes = [],
  initialEdges = [],
  activeTabId = "tab-1",
  replaceGraph = false,
  ensureImportTab = false,
  onReady,
}: SharedLoaderHarnessProps) {
  const [nodes, setNodes] = useState<FlowNode[]>(() => initialNodes);
  const [edges, setEdges] = useState<Edge[]>(() => initialEdges);
  const [currentActiveTabId, setCurrentActiveTabId] = useState(activeTabId);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const scheduleSnapshot = useRef(vi.fn());
  const setTabTooltip = useRef(vi.fn());
  const infoDialogRef = useRef<InfoDialogState>(null);
  const setInfoDialogSpy = useRef(
    vi.fn((state: InfoDialogState) => {
      infoDialogRef.current = state;
    })
  );
  const renameTab = useRef(vi.fn());
  const handleRenameTab = useCallback(
    (
      tabId: string,
      title: string,
      options?: { onlyIfEmpty?: boolean }
    ) => {
      renameTab.current(tabId, title, options);
    },
    []
  );

  const fitViewSpy = useRef(vi.fn());
  const flowInstanceRef = useMemo<MutableRefObject<ReactFlowInstance | null>>(
    () => ({
      current: {
        fitView: (...args: Parameters<ReactFlowInstance["fitView"]>) => {
          fitViewSpy.current(...args);
        },
      } as ReactFlowInstance,
    }),
    []
  );

  const replaceGraphHandler = useMemo(() => {
    if (!replaceGraph) return undefined;
    return ({
      nodes: nextNodes,
      edges: nextEdges,
    }: {
      nodes: FlowNode[];
      edges: Edge[];
    }) => {
      setNodes(nextNodes);
      setEdges(nextEdges);
    };
  }, [replaceGraph]);

  const ensureShareImportTab = useCallback(async () => {
    if (!ensureImportTab) return null;
    const nextTabId = "tab-shared-import";
    setNodes([]);
    setEdges([]);
    setCurrentActiveTabId(nextTabId);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    return nextTabId;
  }, [ensureImportTab]);

  useSharedFlowLoader({
    getNodes: () => nodes,
    getEdges: () => edges,
    replaceGraph: replaceGraphHandler,
    onNodesChange: (changes) => {
      setNodes((prev) => applyNodeChanges(prev, changes));
    },
    onEdgesChange: (changes) => {
      setEdges((prev) => applyEdgeChanges(prev, changes));
    },
    scheduleSnapshot: (label, options) => {
      scheduleSnapshot.current(label, options);
    },
    setTabTooltip: (_tabId, tooltip) => {
      setTabTooltip.current(_tabId, tooltip);
    },
    renameTab: handleRenameTab,
    activeTabId: currentActiveTabId,
    setInfoDialog: (state) => {
      setInfoDialogSpy.current(state);
    },
    flowInstanceRef,
    ensureShareImportTab: ensureImportTab ? ensureShareImportTab : undefined,
  });

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const getSnapshot = useCallback((): HarnessSnapshot => ({
    nodes: nodesRef.current,
    edges: edgesRef.current,
    tooltip: setTabTooltip.current.mock.calls.at(-1)?.[1] ?? null,
    infoDialog: infoDialogRef.current,
    scheduleCalls: scheduleSnapshot.current.mock.calls as ScheduleCall[],
    fitViewCallCount: fitViewSpy.current.mock.calls.length,
  }), []);

  useEffect(() => {
    if (!onReady) return;
    onReady({
      setNodes,
      setEdges,
      scheduleSnapshot: scheduleSnapshot.current,
      setTabTooltip: setTabTooltip.current,
      setInfoDialogSpy: setInfoDialogSpy.current,
      fitViewSpy: fitViewSpy.current,
      renameTab: renameTab.current,
      getSnapshot,
    });
  }, [getSnapshot, handleRenameTab, onReady]);

  return null;
}

async function renderSharedLoaderHarness(
  props: Omit<SharedLoaderHarnessProps, "onReady"> = {}
): Promise<{
  rerender: (nextProps?: Omit<SharedLoaderHarnessProps, "onReady">) => void;
  unmount: () => void;
  getHandles: () => SharedLoaderHarnessHandles;
}> {
  const handlesRef: { current: SharedLoaderHarnessHandles | null } = { current: null };
  const view = render(
    <SharedLoaderHarness
      {...props}
      onReady={(handles) => {
        handlesRef.current = handles;
      }}
    />
  );

  await waitFor(() => expect(handlesRef.current).not.toBeNull());

  return {
    rerender: (nextProps = {}) => {
      view.rerender(
        <SharedLoaderHarness
          {...nextProps}
          onReady={(handles) => {
            handlesRef.current = handles;
          }}
        />
      );
    },
    unmount: () => view.unmount(),
    getHandles: () => handlesRef.current as SharedLoaderHarnessHandles,
  };
}

describe("Shared flow loader integration", () => {
  beforeEach(() => {
    loadSharedMock.mockReset();
    importWithFreshIdsMock.mockReset();
    measureFlowBytesMock.mockReset();
    validateFlowDataMock.mockReset();
    ingestScriptStepsMock.mockReset();

    loadSharedMock.mockResolvedValue(
      makeFlowData({
        schemaVersion: 1,
        name: "shared-import",
        nodes: [
          makeFlowNode({
            id: "import-a",
            position: { x: 10, y: 10 },
          }),
        ],
        edges: [],
      })
    );
    importWithFreshIdsMock.mockImplementation(({ importNodes, importEdges }) => ({
      nodes: importNodes,
      edges: importEdges,
    }));
    measureFlowBytesMock.mockImplementation((payload: string | number) =>
      typeof payload === "string" ? payload.length : Number(payload)
    );
    validateFlowDataMock.mockImplementation(() => ({
      ok: true,
      schemaVersion: 1,
      issues: [],
      errors: [],
      warnings: [],
    }));
    ingestScriptStepsMock.mockImplementation((nodes: FlowNode[]) => nodes);

    window.history.replaceState({}, "", "?s=import-me");

    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("imports shared flows and fits view once", async () => {
    const { getHandles } = await renderSharedLoaderHarness();

    const handles = getHandles();

    await waitFor(() =>
      expect(handles.scheduleSnapshot).toHaveBeenCalledWith(
        expect.stringContaining("import-me"),
        expect.objectContaining({ refresh: true })
      )
    );

    const snapshot = handles.getSnapshot();

    expect(snapshot.nodes.some((node) => node.id === "import-a")).toBe(true);
    expect(snapshot.edges.length).toBe(0);
    expect(snapshot.fitViewCallCount).toBe(1);
    expect(snapshot.tooltip).toBe("Shared: import-me");
    expect(loadSharedMock).toHaveBeenCalledTimes(1);
    expect(handles.renameTab).toHaveBeenCalledWith("tab-1", "share_import_me", {
      onlyIfEmpty: true,
    });
    expect(handles.renameTab).toHaveBeenCalledTimes(1);
  });

  it("surfaces load errors via dialog without scheduling snapshots", async () => {
    loadSharedMock.mockRejectedValueOnce(new Error("boom"));

    const { getHandles } = await renderSharedLoaderHarness();
    const handles = getHandles();

    await waitFor(() =>
      expect(handles.getSnapshot().infoDialog).toEqual({
        open: true,
        message: "Could not load shared flow: boom",
      })
    );

    expect(handles.scheduleSnapshot).not.toHaveBeenCalled();
    expect(handles.getSnapshot().tooltip).toBeNull();
  });

  it("rejects oversized imports and shows the limit in the dialog", async () => {
    const bytes = MAX_FLOW_BYTES + 123;
    measureFlowBytesMock.mockReturnValueOnce(bytes);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getHandles } = await renderSharedLoaderHarness();
    const handles = getHandles();

    await waitFor(() =>
      expect(handles.getSnapshot().infoDialog).toEqual({
        open: true,
        message: `Shared flow is ${formatBytes(bytes)}, over the ${formatBytes(MAX_FLOW_BYTES)} limit.`,
      })
    );

    expect(errorSpy).toHaveBeenCalledWith(
      `Shared flow is ${formatBytes(bytes)}, over the ${formatBytes(MAX_FLOW_BYTES)} limit.`
    );
    expect(handles.scheduleSnapshot).not.toHaveBeenCalled();
    expect(handles.getSnapshot().tooltip).toBeNull();
  });

  it("shows validation failures and aborts import", async () => {
    validateFlowDataMock.mockReturnValueOnce({
      ok: false,
      schemaVersion: 1,
      issues: [{ level: "error", code: "TEST", message: "bad flow" }],
      errors: [{ level: "error", code: "TEST", message: "bad flow" }],
      warnings: [],
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { getHandles } = await renderSharedLoaderHarness();
    const handles = getHandles();

    await waitFor(() =>
      expect(handles.getSnapshot().infoDialog).toEqual({
        open: true,
        message: "bad flow",
      })
    );

    expect(errorSpy).toHaveBeenCalledWith("Shared flow validation failed", [
      { level: "error", code: "TEST", message: "bad flow" },
    ]);
    expect(handles.scheduleSnapshot).not.toHaveBeenCalled();
    expect(handles.getSnapshot().nodes.length).toBe(0);
  });

  it("logs validation warnings but still imports the flow", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    validateFlowDataMock.mockReturnValueOnce({
      ok: true,
      schemaVersion: 1,
      issues: [
        {
          level: "warning",
          code: "TEST",
          nodeId: "nodes[0]",
          message: "minor issue",
        },
      ],
      errors: [],
      warnings: [
        {
          level: "warning",
          code: "TEST",
          nodeId: "nodes[0]",
          message: "minor issue",
        },
      ],
    });

    const { getHandles } = await renderSharedLoaderHarness();
    const handles = getHandles();

    await waitFor(() => expect(handles.scheduleSnapshot).toHaveBeenCalled());

    expect(warnSpy).toHaveBeenCalledWith("Shared flow validation warnings", [
      {
        level: "warning",
        code: "TEST",
        nodeId: "nodes[0]",
        message: "minor issue",
      },
    ]);
    expect(handles.getSnapshot().nodes.length).toBeGreaterThan(0);
  });

  it("deselects existing nodes and selects imported nodes", async () => {
    const preselectedNode: FlowNode = {
      id: "existing",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: { functionName: "identity" },
      selected: true,
    };

    const { getHandles } = await renderSharedLoaderHarness({
      initialNodes: [preselectedNode],
    });
    const handles = getHandles();

    await waitFor(() => expect(handles.scheduleSnapshot).toHaveBeenCalled());

    const { nodes } = handles.getSnapshot();
    const original = nodes.find((node) => node.id === "existing");
    const imported = nodes.find((node) => node.id === "import-a");

    expect(original?.selected).toBe(false);
    expect(imported?.selected).toBe(true);
  });

  it("can replace the target graph instead of appending into it", async () => {
    const existingNode: FlowNode = {
      id: "existing",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: { functionName: "identity" },
      selected: true,
    };

    const { getHandles } = await renderSharedLoaderHarness({
      initialNodes: [existingNode],
      replaceGraph: true,
    });
    const handles = getHandles();

    await waitFor(() => expect(handles.scheduleSnapshot).toHaveBeenCalled());

    const { nodes } = handles.getSnapshot();
    expect(nodes.map((node) => node.id)).toEqual(["import-a"]);
    expect(nodes[0]?.selected).toBe(false);
  });

  it("keeps one in-flight load when creating a share import tab", async () => {
    const existingNode: FlowNode = {
      id: "existing",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: { functionName: "identity" },
    };

    const { getHandles } = await renderSharedLoaderHarness({
      initialNodes: [existingNode],
      replaceGraph: true,
      ensureImportTab: true,
    });
    const handles = getHandles();

    await waitFor(() => expect(handles.scheduleSnapshot).toHaveBeenCalled());

    expect(loadSharedMock).toHaveBeenCalledTimes(1);
    expect(handles.getSnapshot().nodes.map((node) => node.id)).toEqual([
      "import-a",
    ]);
    expect(handles.setTabTooltip).toHaveBeenCalledWith(
      "tab-shared-import",
      "Shared: import-me"
    );
    expect(handles.renameTab).toHaveBeenCalledWith(
      "tab-shared-import",
      "share_import_me",
      { onlyIfEmpty: true }
    );
  });

  it("uses the current tab when importing into an empty graph", async () => {
    const { getHandles } = await renderSharedLoaderHarness({
      replaceGraph: true,
      ensureImportTab: true,
    });
    const handles = getHandles();

    await waitFor(() => expect(handles.scheduleSnapshot).toHaveBeenCalled());

    expect(loadSharedMock).toHaveBeenCalledTimes(1);
    expect(handles.setTabTooltip).toHaveBeenCalledWith(
      "tab-1",
      "Shared: import-me"
    );
    expect(handles.renameTab).toHaveBeenCalledWith(
      "tab-1",
      "share_import_me",
      { onlyIfEmpty: true }
    );
  });

  it("filters dangling edges that reference missing nodes", async () => {
    loadSharedMock.mockResolvedValueOnce({
      schemaVersion: 1,
      name: "dangling",
      nodes: [],
      edges: [
        { id: "e-1", source: "missing", target: "kept" },
        { id: "e-2", source: "import-a", target: "import-b" },
      ],
    });

    importWithFreshIdsMock.mockReturnValueOnce({
      nodes: [
        {
          id: "import-a",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: "import-b",
          type: "calculation",
          position: { x: 10, y: 0 },
          data: {},
        },
      ],
      edges: [
        { id: "e-1", source: "missing", target: "kept" },
        { id: "e-2", source: "import-a", target: "import-b" },
      ],
    });

    const { getHandles } = await renderSharedLoaderHarness();
    const handles = getHandles();

    await waitFor(() => expect(handles.scheduleSnapshot).toHaveBeenCalled());

    expect(handles.getSnapshot().edges).toEqual([
      { id: "e-2", source: "import-a", target: "import-b" },
    ]);
  });

  it("applies script-step sanitation before adding nodes", async () => {
    ingestScriptStepsMock.mockImplementationOnce((nodes: FlowNode[]) =>
      nodes.map((node) => ({ ...node, data: { ...node.data, sanitized: true } }))
    );

    const { getHandles } = await renderSharedLoaderHarness();
    const handles = getHandles();

    await waitFor(() => expect(handles.scheduleSnapshot).toHaveBeenCalled());

    const imported = handles.getSnapshot().nodes.find((node) => node.id === "import-a");
    expect(imported?.data?.sanitized).toBe(true);
  });

  it("always schedules the snapshot with refresh true", async () => {
    const { getHandles } = await renderSharedLoaderHarness();
    const handles = getHandles();

    await waitFor(() => expect(handles.scheduleSnapshot).toHaveBeenCalled());

    const [, options] = handles.scheduleSnapshot.mock.calls.at(-1) ?? [];
    expect(options).toEqual({
      refresh: true,
      tabId: "tab-1",
      state: {
        nodes: [
          expect.objectContaining({
            id: "import-a",
          }),
        ],
        edges: [],
      },
    });
  });

  it("avoids duplicate imports for the same shared id", async () => {
    const renderer = await renderSharedLoaderHarness();
    const handles = renderer.getHandles();

    await waitFor(() => expect(handles.scheduleSnapshot).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(handles.renameTab).toHaveBeenCalledTimes(1));

    renderer.rerender();

    await waitFor(() => expect(loadSharedMock).toHaveBeenCalledTimes(1));
    expect(handles.renameTab).toHaveBeenCalledTimes(1);
  });

  it("cancels in-flight loads on unmount and resets loading refs", async () => {
    let resolve: ((value: FlowData) => void) | null = null;
    const pending = new Promise<FlowData>((res) => {
      resolve = res;
    });
    loadSharedMock.mockReturnValueOnce(pending);

    const renderer = await renderSharedLoaderHarness();
    const handles = renderer.getHandles();

    renderer.unmount();

    act(() => {
      resolve?.(makeFlowData({ nodes: [], edges: [] }));
    });

    await waitFor(() => expect(handles.scheduleSnapshot).not.toHaveBeenCalled());
    expect(handles.renameTab).not.toHaveBeenCalled();

    // Re-rendering after unmount should trigger a fresh load.
    const second = await renderSharedLoaderHarness();
    const freshHandles = second.getHandles();
    await waitFor(() => expect(freshHandles.scheduleSnapshot).toHaveBeenCalled());
    await waitFor(() => expect(freshHandles.renameTab).toHaveBeenCalledTimes(1));
    expect(loadSharedMock).toHaveBeenCalledTimes(2);
  });
});
