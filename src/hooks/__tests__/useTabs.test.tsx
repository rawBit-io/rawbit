import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowNode } from "@/types";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { useTabs } from "../useTabs";
import { compressToUTF16, decompressFromUTF16 } from "lz-string";
import { buildFlowNode } from "@/test-utils/types";

const makeNode = (id: string): FlowNode =>
  buildFlowNode({
    id,
    type: "calculation",
    position: { x: 0, y: 0 },
    data: { functionName: "identity" },
  });

const TABS_STORAGE_KEY = "rawbit.flow.tabs";
const ACTIVE_TAB_STORAGE_KEY = "rawbit.flow.activeTab";
const TAB_ARCHIVE_PREFIX = "rawbit.flow.tab.";

const encodeStored = (value: unknown) =>
  `lzjson:${compressToUTF16(JSON.stringify(value))}`;

const decodeStoredPayload = <T,>(stored: string): T =>
  JSON.parse(decompressFromUTF16(stored.slice("lzjson:".length)) ?? "{}") as T;

const decodeStoredArchive = (stored: string) =>
  decodeStoredPayload<{
    nodes?: FlowNode[];
    edges?: Edge[];
  }>(stored);

describe("useTabs", () => {
  let nodesState: FlowNode[];
  let edgesState: Edge[];
  let graphRevRef: React.MutableRefObject<number>;
  let baseSetNodes: ReturnType<typeof vi.fn>;
  let baseSetEdges: ReturnType<typeof vi.fn>;
  let initializeTabHistory: ReturnType<typeof vi.fn>;
  let removeTabHistory: ReturnType<typeof vi.fn>;
  let refreshBanner: ReturnType<typeof vi.fn>;
  let setActiveTabCtx: ReturnType<typeof vi.fn>;
  let getFlowInstance: () => ReactFlowInstance | null;
  let viewportState: { x: number; y: number; zoom: number };
  let setViewport: ReturnType<typeof vi.fn>;
  let fitView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    nodesState = [makeNode("existing")];
    edgesState = [];
    graphRevRef = { current: 0 };
    window.localStorage.clear();
    baseSetNodes = vi.fn((next: FlowNode[] | ((current: FlowNode[]) => FlowNode[])) => {
      nodesState = typeof next === "function" ? next(nodesState) : next;
    });
    baseSetEdges = vi.fn((next: Edge[] | ((current: Edge[]) => Edge[])) => {
      edgesState = typeof next === "function" ? next(edgesState) : next;
    });
    initializeTabHistory = vi.fn();
    removeTabHistory = vi.fn();
    refreshBanner = vi.fn();
    setActiveTabCtx = vi.fn();
    viewportState = { x: 0, y: 0, zoom: 1 };
    setViewport = vi.fn();
    fitView = vi.fn();
    getFlowInstance = () => ({
      getViewport: vi.fn(() => viewportState),
      setViewport,
      fitView,
    } as unknown as ReactFlowInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const getNodes = () => nodesState;
  const getEdges = () => edgesState;

  const renderTabs = () =>
    renderHook(() =>
      useTabs({
        getNodes,
        getEdges,
        baseSetNodes,
        baseSetEdges,
        graphRevRef,
        refreshBanner,
        getFlowInstance,
        initializeTabHistory,
        setActiveTabCtx,
        removeTabHistory,
      })
    );

  it("adds a new tab and initialises history", () => {
    const { result } = renderTabs();

    act(() => {
      result.current.addTab();
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).toBe("tab-2");
    expect(initializeTabHistory).toHaveBeenCalledWith("tab-2", [], []);
    expect(setActiveTabCtx).toHaveBeenCalledWith("tab-2");

    const sawNewTab = refreshBanner.mock.calls.some(
      ([, tabId]) => tabId === "tab-2"
    );
    expect(sawNewTab).toBe(true);
  });

  it("selects another tab and restores state", () => {
    const { result } = renderTabs();

    act(() => {
      result.current.addTab();
    });

    nodesState = [makeNode("changed")];
    edgesState = [];
    graphRevRef.current = 2;

    act(() => {
      result.current.saveTabData("tab-2");
    });

    act(() => {
      result.current.selectTab("tab-1");
    });

    expect(baseSetNodes).toHaveBeenCalled();
    expect(setActiveTabCtx).toHaveBeenLastCalledWith("tab-1");

    const sawTabOne = refreshBanner.mock.calls.some(
      ([, tabId]) => tabId === "tab-1"
    );
    expect(sawTabOne).toBe(true);
  });

  it("persists selection-only updates when switching tabs", async () => {
    const { result } = renderTabs();

    await waitFor(() => expect(result.current.initialHydrationDone).toBe(true));

    const selectedNode = { ...makeNode("persist-node"), selected: true };

    act(() => {
      nodesState = [selectedNode];
      graphRevRef.current = 1;
      result.current.saveTabData("tab-1");
    });

    await waitFor(() => {
      const tab = result.current.tabs.find((t) => t.id === "tab-1");
      expect(tab?.version).toBe(1);
    });

    act(() => {
      nodesState = [{ ...selectedNode, selected: false }];
      result.current.addTab();
    });

    baseSetNodes.mockClear();

    act(() => {
      result.current.selectTab("tab-1");
    });

    const restoredNodes = baseSetNodes.mock.calls.at(-1)?.[0] as
      | FlowNode[]
      | undefined;
    expect(Array.isArray(restoredNodes)).toBe(true);
    expect(restoredNodes?.[0]?.selected).toBe(false);
  });

  it("does not restore selected edge state when switching tabs", async () => {
    const { result } = renderTabs();

    await waitFor(() => expect(result.current.initialHydrationDone).toBe(true));

    act(() => {
      nodesState = [makeNode("source"), makeNode("target")];
      edgesState = [
        {
          id: "edge-selected",
          source: "source",
          target: "target",
          selected: true,
        },
      ];
      graphRevRef.current = 1;
      result.current.saveTabData("tab-1");
    });

    await waitFor(() => {
      const tab = result.current.tabs.find((t) => t.id === "tab-1");
      expect(tab?.version).toBe(1);
    });

    act(() => {
      result.current.addTab();
    });

    baseSetEdges.mockClear();

    act(() => {
      result.current.selectTab("tab-1");
    });

    const restoredEdges = baseSetEdges.mock.calls.at(-1)?.[0] as
      | Edge[]
      | undefined;
    expect(Array.isArray(restoredEdges)).toBe(true);
    expect(restoredEdges?.[0]?.selected).toBe(false);
  });

  it("requests and confirms close", () => {
    const { result } = renderTabs();

    act(() => {
      result.current.addTab();
      result.current.requestCloseTab("tab-2");
    });

    expect(result.current.closeDialog).toEqual({ tabId: "tab-2", open: true });

    act(() => {
      result.current.confirmCloseTab();
    });

    expect(result.current.tabs.find((t) => t.id === "tab-2")).toBeUndefined();
    expect(removeTabHistory).toHaveBeenCalledWith("tab-2");

    const sawTabOne = refreshBanner.mock.calls.some(
      ([, tabId]) => tabId === "tab-1"
    );
    expect(sawTabOne).toBe(true);
  });

  it("persists closed tab metadata immediately and removes its archive", () => {
    const { result } = renderTabs();

    act(() => {
      result.current.addTab();
    });
    act(() => {
      result.current.requestCloseTab("tab-2");
    });
    act(() => {
      result.current.confirmCloseTab();
    });

    const metaRaw = window.localStorage.getItem(TABS_STORAGE_KEY);
    expect(metaRaw).toBeTruthy();
    const meta = decodeStoredPayload<{ tabs: Array<{ id: string }> }>(
      metaRaw as string
    );
    expect(meta.tabs.map((tab) => tab.id)).toEqual(["tab-1"]);
    expect(
      window.localStorage.getItem(`${TAB_ARCHIVE_PREFIX}tab-2`)
    ).toBeNull();
  });

  it("closes all tabs into a fresh empty workspace tab", async () => {
    const { result } = renderTabs();

    await waitFor(() => expect(result.current.initialHydrationDone).toBe(true));

    act(() => {
      result.current.addTab();
    });
    act(() => {
      nodesState = [makeNode("dirty")];
      edgesState = [];
      graphRevRef.current = 5;
      result.current.closeAllTabs();
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(["tab-1"]);
    expect(result.current.activeTabId).toBe("tab-1");
    expect(nodesState).toEqual([]);
    expect(edgesState).toEqual([]);
    expect(result.current.tabCounter).toBe(1);
    expect(
      window.localStorage.getItem(`${TAB_ARCHIVE_PREFIX}tab-2`)
    ).toBeNull();

    const metaRaw = window.localStorage.getItem(TABS_STORAGE_KEY);
    expect(metaRaw).toBeTruthy();
    const meta = decodeStoredPayload<{ tabs: Array<{ id: string }> }>(
      metaRaw as string
    );
    expect(meta.tabs.map((tab) => tab.id)).toEqual(["tab-1"]);
    expect(initializeTabHistory).toHaveBeenCalledWith("tab-1", [], []);
  });

  it("closes all tabs except the tab selected in the close dialog", async () => {
    const keptNode = makeNode("kept-node");
    const { result } = renderTabs();

    await waitFor(() => expect(result.current.initialHydrationDone).toBe(true));

    act(() => {
      result.current.addTab();
    });
    act(() => {
      nodesState = [keptNode];
      edgesState = [];
      graphRevRef.current = 2;
    });
    act(() => {
      result.current.addTab();
    });
    act(() => {
      result.current.requestCloseTab("tab-2");
    });
    act(() => {
      result.current.closeOtherTabs();
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(["tab-2"]);
    expect(result.current.activeTabId).toBe("tab-2");
    expect(nodesState.map((node) => node.id)).toEqual(["kept-node"]);
    expect(
      window.localStorage.getItem(`${TAB_ARCHIVE_PREFIX}tab-1`)
    ).toBeNull();
    expect(
      window.localStorage.getItem(`${TAB_ARCHIVE_PREFIX}tab-3`)
    ).toBeNull();
    expect(removeTabHistory).toHaveBeenCalledWith("tab-1");
    expect(removeTabHistory).toHaveBeenCalledWith("tab-3");

    const metaRaw = window.localStorage.getItem(TABS_STORAGE_KEY);
    expect(metaRaw).toBeTruthy();
    const meta = decodeStoredPayload<{ tabs: Array<{ id: string }> }>(
      metaRaw as string
    );
    expect(meta.tabs.map((tab) => tab.id)).toEqual(["tab-2"]);
  });

  it("updates tooltip and transform", () => {
    const { result } = renderTabs();

    act(() => {
      result.current.setTabTooltip("tab-1", "Shared: 123");
      result.current.setTabTransform("tab-1", { x: 10, y: 20, zoom: 2 });
    });

    const tab = result.current.tabs.find((t) => t.id === "tab-1");
    expect(tab?.tooltip).toBe("Shared: 123");
    expect(tab?.transform).toEqual({ x: 10, y: 20, zoom: 2 });
  });

  it("captures the live viewport before leaving a tab", () => {
    const { result } = renderTabs();

    viewportState = { x: 120, y: -80, zoom: 1.25 };

    act(() => {
      result.current.addTab();
    });

    expect(result.current.tabs.find((t) => t.id === "tab-1")?.transform).toEqual(
      viewportState
    );

    viewportState = { x: -30, y: 45, zoom: 0.75 };

    act(() => {
      result.current.selectTab("tab-1");
    });

    expect(result.current.tabs.find((t) => t.id === "tab-2")?.transform).toEqual(
      viewportState
    );
  });

  it("renames a tab with trimmed and truncated title", () => {
    const { result } = renderTabs();

    act(() => {
      result.current.renameTab(
        "tab-1",
        "   Example Flow Title That Is Quite Long And Should Be Cut Off After Forty Characters   "
      );
    });

    const tab = result.current.tabs.find((t) => t.id === "tab-1");
    expect(tab?.title).toBe("Example Flow Title That Is Quite Long An");
  });

  it("skips renaming when tab is not empty and onlyIfEmpty flag is set", async () => {
    const { result } = renderTabs();

    await waitFor(() => expect(result.current.initialHydrationDone).toBe(true));

    act(() => {
      nodesState = [makeNode("existing")];
      graphRevRef.current = 1;
      result.current.saveTabData("tab-1");
    });

    await waitFor(() => {
      const tab = result.current.tabs.find((t) => t.id === "tab-1");
      expect(tab?.version).toBe(1);
    });

    act(() => {
      result.current.renameTab("tab-1", "Custom Title");
    });

    act(() => {
      result.current.renameTab("tab-1", "Should Not Apply", { onlyIfEmpty: true });
    });

    const tab = result.current.tabs.find((t) => t.id === "tab-1");
    expect(tab?.title).toBe("Custom Title");
  });

  it("persists metadata and archive payloads separately", async () => {
    vi.useFakeTimers();
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        return originalSetItem.call(this, key, value);
      });

    try {
      const { result } = renderTabs();

      await act(async () => {
        await Promise.resolve();
      });

      const metaPayloadCall = setItemSpy.mock.calls
        .filter(([key]) => key === TABS_STORAGE_KEY)
        .at(-1);
      expect(metaPayloadCall).toBeDefined();

      const metaPayload = metaPayloadCall?.[1];
      expect(metaPayload).toBeDefined();
      const metaString = metaPayload as string;
      expect(metaString.startsWith("lzjson:")).toBe(true);
      const decodedMeta = decompressFromUTF16(metaString.slice("lzjson:".length));
      expect(decodedMeta).toBeTruthy();
      const metaJson = JSON.parse(decodedMeta ?? "{}");
      expect(metaJson.tabs).toHaveLength(1);
      expect(metaJson.tabs[0]).not.toHaveProperty("nodes");

      setItemSpy.mockClear();

      await act(async () => {
        result.current.addTab();
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
      });

      expect(
        setItemSpy.mock.calls.some(([key]) => key === TABS_STORAGE_KEY)
      ).toBe(true);
      const archiveCalls = setItemSpy.mock.calls.filter(([key]) =>
        key.startsWith(TAB_ARCHIVE_PREFIX)
      );
      expect(archiveCalls.map(([key]) => key)).toEqual(
        expect.arrayContaining([`${TAB_ARCHIVE_PREFIX}tab-2`])
      );

      const storedValue = archiveCalls.find(
        ([key]) => key === `${TAB_ARCHIVE_PREFIX}tab-2`
      )?.[1] as string | undefined;
      expect(storedValue).toBeDefined();
      const storedString = storedValue as string;
      expect(storedString.startsWith("lzjson:")).toBe(true);
      const decoded = JSON.parse(
        decompressFromUTF16(storedString.slice("lzjson:".length))!
      );
      expect(Array.isArray(decoded.nodes)).toBe(true);
    } finally {
      vi.useRealTimers();
      setItemSpy.mockRestore();
    }
  });

  it("persists explicit immediate data for a newly queued tab", async () => {
    const { result } = renderTabs();

    await waitFor(() => expect(result.current.initialHydrationDone).toBe(true));

    const sharedNode = makeNode("shared-import");
    let newTabId = "";

    act(() => {
      newTabId = result.current.addTab();
      result.current.saveTabData(newTabId, {
        force: true,
        immediate: true,
        data: {
          nodes: [sharedNode],
          edges: [],
        },
      });
    });

    const storedValue = window.localStorage.getItem(
      `${TAB_ARCHIVE_PREFIX}${newTabId}`
    );
    expect(storedValue).toBeTruthy();
    const storedString = storedValue as string;
    expect(storedString.startsWith("lzjson:")).toBe(true);

    const decoded = JSON.parse(
      decompressFromUTF16(storedString.slice("lzjson:".length))!
    );
    expect(decoded.nodes.map((node: FlowNode) => node.id)).toEqual([
      "shared-import",
    ]);
  });

  it("hydrates tabs from legacy compressed storage payload", () => {
    const storedTabs = [
      {
        id: "tab-99",
        title: "Restored flow",
        nodes: [makeNode("hydrated")],
        edges: [],
        version: 3,
        transform: { x: 5, y: 10, zoom: 1.5 },
      },
    ];
    const payload = encodeStored(storedTabs);
    window.localStorage.setItem(TABS_STORAGE_KEY, payload);
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, "tab-99");

    const { result } = renderTabs();

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe("tab-99");
    expect(result.current.activeTabId).toBe("tab-99");
    expect(baseSetNodes).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "hydrated" })])
    );
    expect(refreshBanner).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "hydrated" })]),
      "tab-99"
    );
  });

  it("hydrates tabs from new storage payload", () => {
    const metaPayload = {
      version: 2,
      tabs: [
        { id: "tab-50", title: "Stored meta", version: 4, tooltip: "info" },
      ],
    };
    const singleArchive = encodeStored({
      nodes: [makeNode("archived")],
      edges: [],
      scriptSteps: [["archived", null]],
    });
    window.localStorage.setItem(
      TABS_STORAGE_KEY,
      encodeStored(metaPayload)
    );
    window.localStorage.setItem(
      `${TAB_ARCHIVE_PREFIX}tab-50`,
      singleArchive
    );
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, "tab-50");

    renderTabs();

    expect(baseSetNodes).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "archived" })])
    );
    expect(refreshBanner).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "archived" })]),
      "tab-50"
    );
  });

  it("normalizes handles and removes exact duplicate edges from hydrated archives", () => {
    const source = makeNode("source");
    const target = makeNode("target");
    window.localStorage.setItem(
      TABS_STORAGE_KEY,
      encodeStored({
        version: 2,
        tabs: [{ id: "tab-50", title: "Stored meta", version: 4 }],
      })
    );
    window.localStorage.setItem(
      `${TAB_ARCHIVE_PREFIX}tab-50`,
      encodeStored({
        nodes: [source, target],
        edges: [
          {
            id: "edge-a",
            source: "source",
            target: "target",
            sourceHandle: " output-0 ",
            targetHandle: " input-0 ",
          },
          {
            id: "edge-b",
            source: "source",
            target: "target",
            sourceHandle: "output-0",
            targetHandle: "input-0",
          },
        ],
      })
    );
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, "tab-50");

    renderTabs();

    expect(baseSetEdges).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "edge-a",
        sourceHandle: "output-0",
        targetHandle: "input-0",
      }),
    ]);
  });

  it("skips malformed archive entries without discarding the whole tab", () => {
    const source = makeNode("source");
    const target = makeNode("target");
    window.localStorage.setItem(
      TABS_STORAGE_KEY,
      encodeStored({
        version: 2,
        tabs: [{ id: "tab-50", title: "Stored meta", version: 4 }],
      })
    );
    window.localStorage.setItem(
      `${TAB_ARCHIVE_PREFIX}tab-50`,
      encodeStored({
        nodes: [source, target, { position: { x: 0, y: 0 } }],
        edges: [
          { source: "source", target: "target" },
          { id: "edge-a", source: "source", target: "target" },
        ],
      })
    );
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, "tab-50");

    renderTabs();

    expect(baseSetNodes).toHaveBeenCalledWith([source, target]);
    expect(baseSetEdges).toHaveBeenCalledWith([
      expect.objectContaining({ id: "edge-a" }),
    ]);
  });

  it("fits an offscreen identity-viewport archive on initial hydration", async () => {
    const offscreenA = buildFlowNode({
      id: "offscreen-a",
      type: "calculation",
      position: { x: 24_000, y: 3_000 },
      data: { functionName: "identity" },
    });
    const offscreenB = buildFlowNode({
      id: "offscreen-b",
      type: "calculation",
      position: { x: 24_600, y: 3_200 },
      data: { functionName: "identity" },
    });

    window.localStorage.setItem(
      TABS_STORAGE_KEY,
      encodeStored({
        version: 2,
        tabs: [
          {
            id: "tab-large",
            title: "Large flow",
            version: 3,
            transform: { x: 0, y: 0, zoom: 1 },
          },
        ],
      })
    );
    window.localStorage.setItem(
      `${TAB_ARCHIVE_PREFIX}tab-large`,
      encodeStored({
        nodes: [offscreenA, offscreenB],
        edges: [{ id: "edge-large", source: "offscreen-a", target: "offscreen-b" }],
      })
    );
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, "tab-large");

    const { result } = renderTabs();

    await waitFor(() => expect(result.current.initialHydrationDone).toBe(true));
    await waitFor(() =>
      expect(fitView).toHaveBeenCalledWith(
        expect.objectContaining({
          minZoom: 0.2,
          duration: 0,
        })
      )
    );
  });

  it("recovers archive-backed tabs when tab metadata is corrupted", () => {
    window.localStorage.setItem(TABS_STORAGE_KEY, "not-json");
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, "tab-77");
    window.localStorage.setItem(
      `${TAB_ARCHIVE_PREFIX}tab-77`,
      encodeStored({
        nodes: [makeNode("recovered")],
        edges: [],
      })
    );

    const { result } = renderTabs();

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(["tab-77"]);
    expect(result.current.activeTabId).toBe("tab-77");
    expect(baseSetNodes).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "recovered" })])
    );
    expect(refreshBanner).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "recovered" })]),
      "tab-77"
    );
  });

  it("ignores stale tab metadata when its archive has already been removed", async () => {
    const liveNode = makeNode("live-node");
    window.localStorage.setItem(
      TABS_STORAGE_KEY,
      encodeStored({
        version: 2,
        tabs: [
          { id: "tab-1", title: "Live tab", version: 1 },
          { id: "tab-closed", title: "Closed tab", version: 9 },
        ],
      })
    );
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, "tab-closed");
    window.localStorage.setItem(
      `${TAB_ARCHIVE_PREFIX}tab-1`,
      encodeStored({ nodes: [liveNode], edges: [] })
    );

    const { result } = renderTabs();

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(["tab-1"]);
    expect(result.current.activeTabId).toBe("tab-1");
    await waitFor(() => {
      const metaRaw = window.localStorage.getItem(TABS_STORAGE_KEY);
      expect(metaRaw).toBeTruthy();
      const meta = decodeStoredPayload<{ tabs: Array<{ id: string }> }>(
        metaRaw as string
      );
      expect(meta.tabs.map((tab) => tab.id)).toEqual(["tab-1"]);
    });
  });

  it("hydrates corrupted tab archives as empty graphs", () => {
    window.localStorage.setItem(
      TABS_STORAGE_KEY,
      encodeStored({
        version: 2,
        tabs: [{ id: "tab-bad", title: "Bad archive", version: 2 }],
      })
    );
    window.localStorage.setItem(
      `${TAB_ARCHIVE_PREFIX}tab-bad`,
      "lzjson:broken"
    );
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, "tab-bad");

    const { result } = renderTabs();

    expect(result.current.tabs.map((tab) => tab.id)).toEqual(["tab-bad"]);
    expect(result.current.activeTabId).toBe("tab-bad");
    expect(baseSetNodes).toHaveBeenCalledWith([]);
    expect(baseSetEdges).toHaveBeenCalledWith([]);
  });

  it("falls back to the default tab when storage reads are blocked", () => {
    const getSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });

    try {
      const { result } = renderTabs();

      expect(result.current.tabs.map((tab) => tab.id)).toEqual(["tab-1"]);
      expect(result.current.activeTabId).toBe("tab-1");
    } finally {
      getSpy.mockRestore();
    }
  });

  it("does not persist dangling edges into tab archives", async () => {
    const { result } = renderTabs();

    await waitFor(() => expect(result.current.initialHydrationDone).toBe(true));

    nodesState = [makeNode("fresh-node")];
    edgesState = [
      {
        id: "old-edge",
        source: "old-node",
        target: "fresh-node",
      } as Edge,
    ];
    graphRevRef.current = 1;

    act(() => {
      result.current.saveTabData("tab-1", { force: true, immediate: true });
    });

    const storedValue = window.localStorage.getItem(
      `${TAB_ARCHIVE_PREFIX}tab-1`
    );
    expect(storedValue).toBeTruthy();
    const decoded = decodeStoredArchive(storedValue as string);
    expect(decoded.nodes?.map((node) => node.id)).toEqual(["fresh-node"]);
    expect(decoded.edges).toEqual([]);
  });

  it("skips persisting when quota is exceeded and retries after shrink", async () => {
    const originalSetItem = Storage.prototype.setItem;
    let failNext = false;
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (failNext && key === TABS_STORAGE_KEY) {
          failNext = false;
          const quotaError = new Error("quota exceeded") as Error & { name: string; code: number };
          quotaError.name = "QuotaExceededError";
          quotaError.code = 22;
          throw quotaError;
        }
        return originalSetItem.call(this, key, value);
      });

    try {
      const { result } = renderTabs();

      await waitFor(() => {
        const tabCalls = setItemSpy.mock.calls.filter(
          ([key]) => key === TABS_STORAGE_KEY
        );
        expect(tabCalls.length).toBeGreaterThan(0);
      });

      setItemSpy.mockClear();
      failNext = true;

      await act(async () => {
        result.current.addTab();
      });

      const tabCallsAfterFailure = setItemSpy.mock.calls.filter(
        ([key]) => key === TABS_STORAGE_KEY
      );
      expect(tabCallsAfterFailure).toHaveLength(1);

      setItemSpy.mockClear();

      await act(async () => {
        result.current.setTabTooltip(result.current.activeTabId, "extra");
      });

      await act(async () => {
        await Promise.resolve();
      });

      const tabCallsWhileDisabled = setItemSpy.mock.calls.filter(
        ([key]) => key === TABS_STORAGE_KEY
      );
      expect(tabCallsWhileDisabled).toHaveLength(0);

      setItemSpy.mockClear();

      await act(async () => {
        result.current.requestCloseTab("tab-2");
      });

      await act(async () => {
        result.current.confirmCloseTab();
      });

      await waitFor(() => {
        const tabCallsAfterShrink = setItemSpy.mock.calls.filter(
          ([key]) => key === TABS_STORAGE_KEY
        );
        expect(tabCallsAfterShrink).toHaveLength(1);
      });
    } finally {
      setItemSpy.mockRestore();
    }
  });
});
