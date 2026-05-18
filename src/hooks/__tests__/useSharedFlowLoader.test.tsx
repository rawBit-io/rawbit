import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyNodeChanges, applyEdgeChanges } from "@xyflow/react";
import type { Edge, NodeChange, EdgeChange, ReactFlowInstance } from "@xyflow/react";

import { useSharedFlowLoader } from "../useSharedFlowLoader";
import type { FlowData, FlowNode } from "@/types";
import { buildFlowData, buildFlowNode } from "@/test-utils/types";
import type { FlowValidationResult } from "@/lib/flow/validate";

const loadSharedMock = vi.fn<(id: string) => Promise<FlowData>>();
vi.mock("@/lib/share", () => ({
  loadShared: (id: string) => loadSharedMock(id),
  shareFlow: vi.fn(),
  getShareJsonUrl: (id: string) => `https://share.local/s/${id}`,
}));

const importWithFreshIdsMock = vi.fn<
  ({
    importNodes,
    importEdges,
  }: {
    importNodes: FlowNode[];
    importEdges: Edge[];
  }) => { nodes: FlowNode[]; edges: Edge[] }
>();
vi.mock("@/lib/idUtils", () => ({
  importWithFreshIds: (args: {
    importNodes: FlowNode[];
    importEdges: Edge[];
  }) => importWithFreshIdsMock(args),
}));

const validateFlowDataMock = vi.fn<(flow: FlowData) => FlowValidationResult>();
vi.mock("@/lib/flow/validate", () => ({
  validateFlowData: (flow: FlowData) => validateFlowDataMock(flow),
}));

describe("useSharedFlowLoader", () => {
  let nodesState: FlowNode[];
  let edgesState: Edge[];
  let onNodesChangeMock: (changes: NodeChange<FlowNode>[]) => void;
  let onEdgesChangeMock: (changes: EdgeChange[]) => void;
  let scheduleSnapshot: ReturnType<typeof vi.fn>;
  let setTabTooltip: ReturnType<typeof vi.fn>;
  let renameTab: ReturnType<typeof vi.fn>;
  let setInfoDialog: ReturnType<typeof vi.fn>;
  let flowInstanceRef: { current: ReactFlowInstance | null };
  let fitViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    window.history.replaceState(null, "", "?s=test-shared");

    nodesState = [
      buildFlowNode({
        id: "existing",
        type: "calculation",
        data: { functionName: "identity" },
        position: { x: 0, y: 0 },
        selected: false,
      }),
    ];
    edgesState = [];

    onNodesChangeMock = vi.fn((changes: NodeChange<FlowNode>[]) => {
      nodesState = applyNodeChanges(changes, nodesState);
    });
    onEdgesChangeMock = vi.fn((changes: EdgeChange[]) => {
      edgesState = applyEdgeChanges(changes, edgesState);
    });

    scheduleSnapshot = vi.fn();
    setTabTooltip = vi.fn();
    renameTab = vi.fn();
    setInfoDialog = vi.fn();

    fitViewSpy = vi.fn();
    flowInstanceRef = {
      current: {
        fitView: fitViewSpy,
      } as unknown as ReactFlowInstance,
    };

    validateFlowDataMock.mockReturnValue({
      ok: true,
      schemaVersion: 1,
      issues: [],
      errors: [],
      warnings: [],
    });

    importWithFreshIdsMock.mockImplementation(({ importNodes, importEdges }) => ({
      nodes: importNodes,
      edges: importEdges,
    }));

    loadSharedMock.mockResolvedValue(
      buildFlowData({
        nodes: [
          buildFlowNode({
            id: "shared",
            type: "calculation",
            position: { x: 10, y: 20 },
            data: { functionName: "identity" },
          }),
        ],
        edges: [],
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const getNodes = () => nodesState;
  const getEdges = () => edgesState;

  const renderLoader = (
    overrides: {
      replaceGraph?: (graph: {
        nodes: FlowNode[];
        edges: Edge[];
        tabId?: string;
      }) => void;
      ensureShareImportTab?: () => string | null | Promise<string | null>;
      activeTabId?: string;
    } = {}
  ) =>
    renderHook(() =>
      useSharedFlowLoader({
        getNodes,
        getEdges,
        onNodesChange: onNodesChangeMock,
        onEdgesChange: onEdgesChangeMock,
        replaceGraph: overrides.replaceGraph,
        scheduleSnapshot,
        setTabTooltip,
        renameTab,
        activeTabId: overrides.activeTabId ?? "tab-1",
        setInfoDialog,
        flowInstanceRef,
        ensureShareImportTab: overrides.ensureShareImportTab,
      })
    );

  it("loads shared flow and updates graph", async () => {
    renderLoader();

    await waitFor(() => expect(onNodesChangeMock).toHaveBeenCalled());

    expect(loadSharedMock).toHaveBeenCalledWith("test-shared");
    expect(nodesState.some((n) => n.id === "shared")).toBe(true);
    expect(scheduleSnapshot).toHaveBeenCalledWith("Imported shared flow test-shared", {
      refresh: true,
    });
    expect(setTabTooltip).toHaveBeenCalledWith("tab-1", "Shared: test-shared");
    expect(renameTab).not.toHaveBeenCalled();
    expect(fitViewSpy).toHaveBeenCalledWith({
      padding: 0.2,
      maxZoom: 2,
      duration: 350,
    });
    expect(setInfoDialog).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("removes only shared-link params from the URL after successful import", async () => {
    window.history.replaceState(
      null,
      "",
      "?s=test-shared&share=legacy&keep=1#section"
    );

    renderLoader();

    await waitFor(() => expect(onNodesChangeMock).toHaveBeenCalled());

    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#section");
  });

  it("renames the tab when shared flow loads into an empty workspace", async () => {
    nodesState = [];
    renderLoader();

    await waitFor(() => expect(renameTab).toHaveBeenCalled());

    expect(renameTab).toHaveBeenCalledWith("tab-1", "share_test_shared", {
      onlyIfEmpty: true,
    });
  });

  it("opens a new tab before replacing a non-empty active graph", async () => {
    const ensureShareImportTab = vi.fn().mockResolvedValue("tab-shared");
    const replaceGraph = vi.fn(
      ({ nodes, edges }: { nodes: FlowNode[]; edges: Edge[] }) => {
        nodesState = nodes;
        edgesState = edges;
      }
    );

    renderLoader({ replaceGraph, ensureShareImportTab });

    await waitFor(() => expect(replaceGraph).toHaveBeenCalled());

    expect(ensureShareImportTab).toHaveBeenCalledTimes(1);
    expect(replaceGraph).toHaveBeenCalledWith({
      nodes: expect.arrayContaining([expect.objectContaining({ id: "shared" })]),
      edges: [],
      tabId: "tab-shared",
    });
    expect(onNodesChangeMock).not.toHaveBeenCalled();
    expect(setTabTooltip).toHaveBeenCalledWith(
      "tab-shared",
      "Shared: test-shared"
    );
    expect(renameTab).toHaveBeenCalledWith(
      "tab-shared",
      "share_test_shared",
      { onlyIfEmpty: true }
    );
    expect(window.location.search).toBe("");
  });

  it("uses the current tab for replace imports when the active graph is empty", async () => {
    nodesState = [];
    const ensureShareImportTab = vi.fn().mockResolvedValue("tab-shared");
    const replaceGraph = vi.fn(
      ({ nodes, edges }: { nodes: FlowNode[]; edges: Edge[] }) => {
        nodesState = nodes;
        edgesState = edges;
      }
    );

    renderLoader({ replaceGraph, ensureShareImportTab });

    await waitFor(() => expect(replaceGraph).toHaveBeenCalled());

    expect(ensureShareImportTab).not.toHaveBeenCalled();
    expect(replaceGraph).toHaveBeenCalledWith({
      nodes: expect.arrayContaining([expect.objectContaining({ id: "shared" })]),
      edges: [],
      tabId: "tab-1",
    });
  });

  it("leaves the current graph unchanged if a new tab cannot be opened", async () => {
    const ensureShareImportTab = vi.fn().mockResolvedValue(null);
    const replaceGraph = vi.fn();

    renderLoader({ replaceGraph, ensureShareImportTab });

    await waitFor(() =>
      expect(setInfoDialog).toHaveBeenCalledWith({
        open: true,
        message:
          "Could not open a new tab for the shared flow. Your current tab was left unchanged.",
      })
    );

    expect(replaceGraph).not.toHaveBeenCalled();
    expect(nodesState.map((node) => node.id)).toEqual(["existing"]);
    expect(window.location.search).toBe("?s=test-shared");
  });

  it("dedupes an in-flight shared load across remounts", async () => {
    let resolveShared!: (value: FlowData) => void;
    loadSharedMock.mockReset();
    loadSharedMock.mockReturnValue(
      new Promise<FlowData>((resolve) => {
        resolveShared = resolve;
      })
    );

    const first = renderLoader();
    first.unmount();
    renderLoader();

    expect(loadSharedMock).toHaveBeenCalledTimes(1);

    resolveShared(
      buildFlowData({
        nodes: [
          buildFlowNode({
            id: "shared",
            type: "calculation",
            position: { x: 10, y: 20 },
            data: { functionName: "identity" },
          }),
        ],
        edges: [],
      })
    );

    await waitFor(() => expect(onNodesChangeMock).toHaveBeenCalledTimes(1));
  });

  it("surfaces validation errors", async () => {
    validateFlowDataMock.mockReturnValueOnce({
      ok: false,
      schemaVersion: 1,
      issues: [],
      errors: [{ level: "error", code: "TEST_ERROR", message: "Invalid" }],
      warnings: [],
    });

    renderLoader();

    await waitFor(() => expect(setInfoDialog).toHaveBeenCalled());
    expect(onNodesChangeMock).not.toHaveBeenCalled();
  });

  it("notifies when loadShared rejects", async () => {
    loadSharedMock.mockRejectedValueOnce(new Error("boom"));

    renderLoader();

    await waitFor(() => expect(setInfoDialog).toHaveBeenCalledWith({
      open: true,
      message: "Could not load shared flow: boom",
    }));
    expect(window.location.search).toBe("?s=test-shared");
  });

  it("rejects shared payloads without nodes arrays", async () => {
    loadSharedMock.mockResolvedValueOnce({ edges: [] } as unknown as FlowData);

    renderLoader();

    await waitFor(() =>
      expect(setInfoDialog).toHaveBeenCalledWith({
        open: true,
        message: "Shared flow payload is empty or unreadable.",
      })
    );
    expect(validateFlowDataMock).not.toHaveBeenCalled();
  });

  it("rejects simplified shared snapshots", async () => {
    loadSharedMock.mockResolvedValueOnce({
      nodes: [{ id: "simple" } as unknown as FlowNode],
      edges: [],
    } as FlowData);

    renderLoader();

    await waitFor(() =>
      expect(setInfoDialog).toHaveBeenCalledWith({
        open: true,
        message:
          "Shared flow is a simplified snapshot that omits layout data and can't be loaded; request a full export instead.",
      })
    );
    expect(validateFlowDataMock).not.toHaveBeenCalled();
  });
});
