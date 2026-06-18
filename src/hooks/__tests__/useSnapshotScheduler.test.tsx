import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";
import { useSnapshotScheduler } from "../useSnapshotScheduler";

const makeState = () => ({
  nodes: [
    {
      id: "n1",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: { functionName: "identity", dirty: true },
    },
  ] as FlowNode[],
  edges: [] as Edge[],
});

describe("useSnapshotScheduler", () => {
  let storeState: ReturnType<typeof makeState>;
  let pushState: ReturnType<typeof vi.fn>;
  let replaceState: ReturnType<typeof vi.fn>;
  let incrementGraphRev: ReturnType<typeof vi.fn>;
  let skipLoadRef: React.MutableRefObject<boolean>;
  let refreshBanner: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    storeState = makeState();
    pushState = vi.fn();
    replaceState = vi.fn();
    incrementGraphRev = vi.fn(() => 7);
    skipLoadRef = { current: false };
    refreshBanner = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderScheduler = (
    autoAfterCalc?: Parameters<typeof useSnapshotScheduler>[0]["autoAfterCalc"],
    getCalcSnapshot?: Parameters<typeof useSnapshotScheduler>[0]["getCalcSnapshot"]
  ) =>
    renderHook(
      ({ calc }: { calc?: typeof autoAfterCalc }) =>
        useSnapshotScheduler({
          storeApi: { getState: () => storeState },
          pushState,
          replaceState,
          incrementGraphRev,
          skipLoadRef,
          refreshBanner,
          autoAfterCalc: calc,
          getCalcSnapshot,
        }),
      { initialProps: { calc: autoAfterCalc } }
    );

  it("captures snapshots and clears dirty flags", () => {
    const { result } = renderScheduler();

    act(() => {
      result.current.scheduleSnapshot("Manual snapshot");
    });

    expect(incrementGraphRev).toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ dirty: false }),
        }),
      ]),
      storeState.edges,
      expect.objectContaining({ label: "Manual snapshot" })
    );
  });

  it("respects refresh flag and before guard", () => {
    const { result } = renderScheduler();
    const guard = vi.fn(() => false);

    act(() => {
      result.current.scheduleSnapshot("Needs refresh", { refresh: true, before: guard });
    });

    expect(refreshBanner).toHaveBeenCalledWith(storeState.nodes, undefined, {
      sticky: false,
      immediate: true,
    });
    expect(guard).toHaveBeenCalled();
  });

  it("targets refresh and undo history snapshots at an explicit tab", () => {
    const { result } = renderScheduler();

    act(() => {
      result.current.scheduleSnapshot("Shared import", {
        refresh: true,
        tabId: "tab-shared",
      });
    });

    expect(refreshBanner).toHaveBeenCalledWith(storeState.nodes, "tab-shared", {
      sticky: false,
      immediate: true,
    });
    expect(pushState).toHaveBeenCalledWith(
      expect.any(Array),
      storeState.edges,
      expect.objectContaining({
        label: "Shared import",
        tabId: "tab-shared",
      })
    );
  });

  it("does not cancel pending snapshots for different target tabs", () => {
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const cancelAnimationFrameMock = vi.fn((id: number) => {
      queuedFrames.delete(id);
    });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      queuedFrames.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);

    const { result } = renderScheduler();

    act(() => {
      result.current.scheduleSnapshot("Shared import A", {
        tabId: "tab-a",
      });
      result.current.scheduleSnapshot("Shared import B", {
        tabId: "tab-b",
      });
    });

    expect(cancelAnimationFrameMock).not.toHaveBeenCalled();

    act(() => {
      for (const cb of [...queuedFrames.values()]) {
        cb(0);
      }
    });

    expect(pushState).toHaveBeenCalledTimes(2);
    expect(pushState).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      storeState.edges,
      expect.objectContaining({
        label: "Shared import A",
        tabId: "tab-a",
      })
    );
    expect(pushState).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      storeState.edges,
      expect.objectContaining({
        label: "Shared import B",
        tabId: "tab-b",
      })
    );
  });

  it("uses explicit snapshot state for each target tab instead of later store state", () => {
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      queuedFrames.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      queuedFrames.delete(id);
    });

    const sharedA = {
      nodes: [{ ...makeState().nodes[0], id: "shared-a" }],
      edges: [] as Edge[],
    };
    const sharedB = {
      nodes: [{ ...makeState().nodes[0], id: "shared-b" }],
      edges: [] as Edge[],
    };
    const { result } = renderScheduler();

    act(() => {
      result.current.scheduleSnapshot("Shared import A", {
        tabId: "tab-a",
        state: sharedA,
      });
      storeState = sharedB;
      result.current.scheduleSnapshot("Shared import B", {
        tabId: "tab-b",
        state: sharedB,
      });
    });

    act(() => {
      for (const cb of [...queuedFrames.values()]) {
        cb(0);
      }
    });

    expect(pushState).toHaveBeenCalledTimes(2);
    expect(pushState).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ id: "shared-a" })]),
      sharedA.edges,
      expect.objectContaining({ tabId: "tab-a" })
    );
    expect(pushState).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.objectContaining({ id: "shared-b" })]),
      sharedB.edges,
      expect.objectContaining({ tabId: "tab-b" })
    );
  });

  it("captures immediate explicit snapshots before later snapshots can cancel them", () => {
    const queuedFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const cancelAnimationFrameMock = vi.fn((id: number) => {
      queuedFrames.delete(id);
    });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      queuedFrames.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);

    const loadedFlow = {
      nodes: [{ ...makeState().nodes[0], id: "loaded-flow-node" }],
      edges: [] as Edge[],
    };
    const movedFlow = {
      nodes: [
        {
          ...makeState().nodes[0],
          id: "loaded-flow-node",
          position: { x: 25, y: 25 },
        },
      ],
      edges: [] as Edge[],
    };
    const { result } = renderScheduler();

    act(() => {
      result.current.scheduleSnapshot("Load example", {
        immediate: true,
        tabId: "tab-1",
        state: loadedFlow,
      });
      result.current.scheduleSnapshot("Node moved", {
        tabId: "tab-1",
        state: movedFlow,
      });
    });

    expect(cancelAnimationFrameMock).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "loaded-flow-node" }),
      ]),
      loadedFlow.edges,
      expect.objectContaining({ label: "Load example", tabId: "tab-1" })
    );

    act(() => {
      for (const cb of [...queuedFrames.values()]) {
        cb(0);
      }
    });

    expect(pushState).toHaveBeenCalledTimes(2);
    expect(pushState).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        expect.objectContaining({
          id: "loaded-flow-node",
          position: { x: 25, y: 25 },
        }),
      ]),
      movedFlow.edges,
      expect.objectContaining({ label: "Node moved", tabId: "tab-1" })
    );
  });

  it("passes calc state metadata when capturing snapshots", () => {
    const calcSnapshot = {
      status: "ERROR" as const,
      errors: [{ nodeId: "n1", error: "boom" }],
    };
    const { result } = renderScheduler(undefined, () => calcSnapshot);

    act(() => {
      result.current.scheduleSnapshot("With calc state");
    });

    expect(pushState).toHaveBeenCalledWith(
      expect.any(Array),
      storeState.edges,
      expect.objectContaining({
        label: "With calc state",
        calcState: expect.objectContaining({
          status: "ERROR",
          errors: [expect.objectContaining({ nodeId: "n1", error: "boom" })],
        }),
      })
    );
  });

  it("marks and clears pending snapshot flags", () => {
    const { result } = renderScheduler();

    act(() => {
      result.current.markPendingAfterDirtyChange();
    });

    expect(result.current.pendingSnapshotRef.current).toBe(true);

    act(() => {
      result.current.clearPendingAfterCalc();
    });

    expect(result.current.pendingSnapshotRef.current).toBe(false);
    expect(result.current.skipNextEdgeSnapshotRef.current).toBe(false);
  });

  // Deferred-frame rAF so the real ordering holds: the structural snapshot is
  // queued, markPending runs synchronously (edge removal), THEN the frame fires
  // and arms coalescing — exactly the key-delete sequence in production.
  const useDeferredFrames = () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextId;
      nextId += 1;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    return () =>
      act(() => {
        for (const cb of [...frames.values()]) cb(0);
        frames.clear();
      });
  };

  it("coalesces the after-calc snapshot into a structural entry (one undo step)", () => {
    const loadingUndoRef = { current: false };
    const flushFrames = useDeferredFrames();
    const { result, rerender } = renderScheduler();

    // Key-delete sequence: queue structural snapshot, edge removal arms pending,
    // then the frame fires.
    act(() => {
      result.current.scheduleSnapshot("Node(s) removed", {
        coalesceFollowingCalc: true,
      });
      result.current.markPendingAfterDirtyChange();
    });
    flushFrames();

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledWith(
      expect.any(Array),
      storeState.edges,
      expect.objectContaining({ label: "Node(s) removed" })
    );

    // Recalc settles: the after-calc must FOLD IN (replaceState), not append.
    storeState = makeState();
    storeState.nodes[0].data.dirty = false;
    act(() => {
      rerender({ calc: { calcStatus: "OK", loadingUndoRef } });
    });

    expect(pushState).toHaveBeenCalledTimes(1); // no second history entry
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ dirty: false }) }),
      ]),
      storeState.edges,
      expect.objectContaining({ coalesceFromLabel: "Node(s) removed" })
    );
  });

  it("coalesces via armAfterCalcCoalesce (the delete handler's path)", () => {
    // onDelete arms the coalesce AFTER markPending (its token may differ from
    // the structural snapshot's frame-time token), so the delete handler calls
    // armAfterCalcCoalesce to capture the correct token.
    const loadingUndoRef = { current: false };
    const { result, rerender } = renderScheduler();

    act(() => {
      result.current.scheduleSnapshot("Node(s) removed");
      result.current.markPendingAfterDirtyChange();
      result.current.armAfterCalcCoalesce("Node(s) removed");
    });
    expect(pushState).toHaveBeenCalledTimes(1);

    storeState = makeState();
    storeState.nodes[0].data.dirty = false;
    act(() => {
      rerender({ calc: { calcStatus: "OK", loadingUndoRef } });
    });

    expect(pushState).toHaveBeenCalledTimes(1); // no second entry
    expect(replaceState).toHaveBeenCalledWith(
      expect.any(Array),
      storeState.edges,
      expect.objectContaining({ coalesceFromLabel: "Node(s) removed" })
    );
  });

  it("keeps each tab's pending after-calc isolated across tab switches (NB-01)", () => {
    const loadingUndoRef = { current: false };
    let activeTab = "tab-a";
    const { result, rerender } = renderHook(
      ({ calc }: { calc?: Parameters<typeof useSnapshotScheduler>[0]["autoAfterCalc"] }) =>
        useSnapshotScheduler({
          storeApi: { getState: () => storeState },
          pushState,
          replaceState,
          incrementGraphRev,
          skipLoadRef,
          refreshBanner,
          autoAfterCalc: calc,
          getActiveTabId: () => activeTab,
        }),
      { initialProps: { calc: undefined as Parameters<typeof useSnapshotScheduler>[0]["autoAfterCalc"] } }
    );

    // Tab A: structural delete pushes its entry and arms coalescing for tab-a.
    act(() => {
      result.current.scheduleSnapshot("Node(s) removed");
      result.current.markPendingAfterDirtyChange();
      result.current.armAfterCalcCoalesce("Node(s) removed");
    });
    expect(pushState).toHaveBeenCalledTimes(1);

    // Within tab A's recalc window, switch to tab B and edit there. This must
    // NOT touch tab A's pending entry (the NB-01 collision).
    activeTab = "tab-b";
    act(() => {
      result.current.markPendingAfterDirtyChange();
    });

    // Tab B's recalc settles while tab B is active → tab B captures its own
    // plain "After calc"; tab A's coalesce has not fired.
    storeState = makeState();
    storeState.nodes[0].data.dirty = false;
    act(() => {
      rerender({ calc: { calcStatus: "OK", loadingUndoRef } });
    });
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(pushState).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      storeState.edges,
      expect.objectContaining({ label: "After calc", tabId: "tab-b" })
    );
    expect(replaceState).not.toHaveBeenCalled();

    // Return to tab A; its recalc settles → its after-calc now folds into the
    // "Node(s) removed" structural entry (the step that used to be lost).
    activeTab = "tab-a";
    storeState = makeState();
    storeState.nodes[0].data.dirty = false;
    act(() => {
      rerender({ calc: { calcStatus: "OK", loadingUndoRef } });
    });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(
      expect.any(Array),
      storeState.edges,
      expect.objectContaining({
        coalesceFromLabel: "Node(s) removed",
        tabId: "tab-a",
      })
    );
  });

  it("does not coalesce a plain edit's after-calc (no structural entry to fold into)", () => {
    const loadingUndoRef = { current: false };
    const { result, rerender } = renderScheduler();

    // A field edit arms pending without any structural snapshot.
    act(() => {
      result.current.markPendingAfterDirtyChange();
    });

    storeState = makeState();
    storeState.nodes[0].data.dirty = false;
    act(() => {
      rerender({ calc: { calcStatus: "OK", loadingUndoRef } });
    });

    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledWith(
      expect.any(Array),
      storeState.edges,
      expect.objectContaining({ label: "After calc" })
    );
  });

  it("does not coalesce when the after-calc belongs to a later, unrelated edit", () => {
    const loadingUndoRef = { current: false };
    const flushFrames = useDeferredFrames();
    const { result, rerender } = renderScheduler();

    // Structural action that triggers NO recalc (e.g. deleting an isolated
    // node): its frame arms coalescing for the current token...
    act(() => {
      result.current.scheduleSnapshot("Node(s) removed", {
        coalesceFollowingCalc: true,
      });
    });
    flushFrames();
    expect(pushState).toHaveBeenCalledTimes(1);

    // ...then a LATER unrelated field edit arms a new token and recalcs.
    act(() => {
      result.current.markPendingAfterDirtyChange();
    });
    storeState = makeState();
    storeState.nodes[0].data.dirty = false;
    act(() => {
      rerender({ calc: { calcStatus: "OK", loadingUndoRef } });
    });

    // That after-calc must append, never fold into the stale structural entry.
    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(pushState).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      storeState.edges,
      expect.objectContaining({ label: "After calc" })
    );
  });

  it("locks and releases node removal snapshot skip", () => {
    const { result } = renderScheduler();

    act(() => {
      result.current.lockNodeRemovalSnapshotSkip();
    });
    expect(result.current.skipNextNodeRemovalRef.current).toBe(true);

    act(() => {
      result.current.releaseNodeRemovalSnapshotSkip();
    });
    expect(result.current.skipNextNodeRemovalRef.current).toBe(false);
  });
});
