import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Edge } from "@xyflow/react";
import { log } from "@/lib/logConfig";
import type { CalcStatus, CalcError, FlowNode } from "@/types";
import type {
  PushStateOptions,
  ReplaceStateOptions,
} from "@/contexts/undo-redo";

interface CalcSnapshot {
  status: CalcStatus;
  errors: CalcError[];
}

// Per-tab after-calc bookkeeping. Keying this by tab (instead of a single set
// of globals) prevents an edit on one tab from abandoning another tab's still
// pending after-calc snapshot during the recalc window (NB-01).
interface PendingEntry {
  pending: boolean;
  token: number;
  lastToken: number;
  coalesceLabel: string | null;
  coalesceToken: number | null;
}

interface UseSnapshotSchedulerArgs {
  storeApi: {
    getState: () => { nodes: FlowNode[]; edges: Edge[] };
  };
  getSnapshotState?: () => { nodes: FlowNode[]; edges: Edge[] };
  pushState: (
    nodes: FlowNode[],
    edges: Edge[],
    labelOrOptions?: string | PushStateOptions
  ) => void;
  replaceState?: (
    nodes: FlowNode[],
    edges: Edge[],
    options: ReplaceStateOptions
  ) => void;
  incrementGraphRev: () => number;
  skipLoadRef: React.MutableRefObject<boolean>;
  refreshBanner?: (
    nodes: FlowNode[],
    tabId?: string,
    options?: { sticky?: boolean; immediate?: boolean }
  ) => void;
  autoAfterCalc?: {
    calcStatus: CalcStatus;
    loadingUndoRef: React.MutableRefObject<boolean>;
  };
  getCalcSnapshot?: () => CalcSnapshot;
  getActiveTabId?: () => string;
}

export interface SnapshotOptions {
  refresh?: boolean;
  immediate?: boolean;
  before?: () => boolean;
  tabId?: string;
  state?: {
    nodes: FlowNode[];
    edges: Edge[];
  };
  /**
   * Mark this as a structural snapshot whose follow-up "After calc" snapshot
   * (from the recalc this action triggers) should coalesce into it instead of
   * appending a second history entry. One user action stays one undo step.
   */
  coalesceFollowingCalc?: boolean;
}

export interface SnapshotScheduler {
  pushCleanState: (
    nodes: FlowNode[],
    edges: Edge[],
    label: string,
    tabId?: string
  ) => void;
  scheduleSnapshot: (label: string, options?: SnapshotOptions) => void;
  pendingSnapshotRef: React.MutableRefObject<boolean>;
  skipNextEdgeSnapshotRef: React.MutableRefObject<boolean>;
  skipNextNodeRemovalRef: React.MutableRefObject<boolean>;
  markPendingAfterDirtyChange: () => void;
  /**
   * Arm the next "After calc" (for the current pending token) to coalesce into
   * the structural entry labelled `label`. Called by the delete handler right
   * after markPendingAfterDirtyChange so the captured token matches the recalc
   * the deletion triggers — robust to onDelete firing after the structural
   * snapshot's frame.
   */
  armAfterCalcCoalesce: (label: string) => void;
  clearPendingAfterCalc: () => void;
  lockNodeRemovalSnapshotSkip: () => void;
  releaseNodeRemovalSnapshotSkip: () => void;
}

export function useSnapshotScheduler({
  storeApi,
  getSnapshotState,
  pushState,
  replaceState,
  incrementGraphRev,
  skipLoadRef,
  refreshBanner,
  autoAfterCalc,
  getCalcSnapshot,
  getActiveTabId,
}: UseSnapshotSchedulerArgs): SnapshotScheduler {
  const skipNextEdgeSnapshotRef = useRef(false);
  const skipNextNodeRemovalRef = useRef(false);

  // After-calc bookkeeping (pending flag, token, last-captured token, and the
  // coalesce label/token) is keyed PER TAB. The old design used a single set of
  // global refs, so an edit on tab B inside tab A's recalc window overwrote tab
  // A's pending token/owner — tab A's coalesced "After calc" never fired and its
  // structural entry kept stale post-edit results (NB-01). The effect only ever
  // flushes the entry for the currently active tab, so other tabs' pending
  // entries survive untouched until the user returns to them.
  const pendingByTabRef = useRef<Map<string, PendingEntry>>(new Map());
  const getActiveTabIdRef = useRef(getActiveTabId);
  getActiveTabIdRef.current = getActiveTabId;
  const resolveTabKey = useCallback(
    () => getActiveTabIdRef.current?.() ?? "__active__",
    []
  );
  const getPendingEntry = useCallback((key: string): PendingEntry => {
    let entry = pendingByTabRef.current.get(key);
    if (!entry) {
      entry = {
        pending: false,
        token: 0,
        lastToken: 0,
        coalesceLabel: null,
        coalesceToken: null,
      };
      pendingByTabRef.current.set(key, entry);
    }
    return entry;
  }, []);

  // Backward-compatible façade for the public pendingSnapshotRef. External
  // callers (drag-stop, history-load) read/write `.current` in the context of
  // the active tab, so proxy it to that tab's entry. Built once so the object
  // identity stays stable across renders.
  const pendingSnapshotFacadeRef = useRef<React.MutableRefObject<boolean> | null>(
    null
  );
  if (pendingSnapshotFacadeRef.current === null) {
    pendingSnapshotFacadeRef.current = {
      get current() {
        return getPendingEntry(resolveTabKey()).pending;
      },
      set current(value: boolean) {
        getPendingEntry(resolveTabKey()).pending = value;
      },
    } as React.MutableRefObject<boolean>;
  }
  const pendingSnapshotRef = pendingSnapshotFacadeRef.current;
  const snapshotFramesRef = useRef<Map<string, number>>(new Map());

  const pushCleanState = useCallback(
    (nodes: FlowNode[], edges: Edge[], label: string, tabId?: string) => {
      const rev = incrementGraphRev();
      skipLoadRef.current = true;
      const cleanNodes = nodes.map((n) => ({
        ...n,
        data: { ...n.data, dirty: false },
      }));
      log(
        "snapshots",
        `[pushCleanState] rev=${rev} label='${label}' nodes=${nodes.length} edges=${edges.length}`
      );
      const calcState = getCalcSnapshot?.();
      pushState(cleanNodes, edges, {
        label,
        ...(tabId ? { tabId } : {}),
        calcState: calcState
          ? {
              status: calcState.status,
              errors: calcState.errors.map((err) => ({ ...err })),
            }
          : undefined,
      });
    },
    [getCalcSnapshot, incrementGraphRev, pushState, skipLoadRef]
  );

  // Like pushCleanState, but folds into the structural entry labelled
  // `coalesceFromLabel` when it is still the top of history; otherwise appends
  // under `label`. Falls back to pushCleanState when no replaceState is wired.
  const replaceCleanState = useCallback(
    (
      nodes: FlowNode[],
      edges: Edge[],
      label: string,
      coalesceFromLabel: string,
      tabId?: string
    ) => {
      if (!replaceState) {
        pushCleanState(nodes, edges, label, tabId);
        return;
      }
      const rev = incrementGraphRev();
      skipLoadRef.current = true;
      const cleanNodes = nodes.map((n) => ({
        ...n,
        data: { ...n.data, dirty: false },
      }));
      log(
        "snapshots",
        `[replaceCleanState] rev=${rev} coalesceInto='${coalesceFromLabel}' nodes=${nodes.length} edges=${edges.length}`
      );
      const calcState = getCalcSnapshot?.();
      replaceState(cleanNodes, edges, {
        label,
        coalesceFromLabel,
        ...(tabId ? { tabId } : {}),
        calcState: calcState
          ? {
              status: calcState.status,
              errors: calcState.errors.map((err) => ({ ...err })),
            }
          : undefined,
      });
    },
    [getCalcSnapshot, incrementGraphRev, pushCleanState, replaceState, skipLoadRef]
  );

  const scheduleSnapshot = useCallback(
    (label: string, options?: SnapshotOptions) => {
      // Resolve the target tab now, not at frame time: the rAF callback may
      // fire after a tab switch, and pushing through a stale closure would
      // write the new tab's live graph into the old tab's history.
      const resolvedTabId = options?.tabId ?? getActiveTabId?.();
      const snapshotKey = resolvedTabId ?? "__active__";
      log(
        "snapshots",
        `[scheduleSnapshot] request label='${label}' refresh=${Boolean(
          options?.refresh
        )} hasBefore=${Boolean(options?.before)} key='${snapshotKey}'`
      );
      const pendingFrame = snapshotFramesRef.current.get(snapshotKey);
      if (pendingFrame !== undefined) {
        const prevFrame = pendingFrame;
        cancelAnimationFrame(prevFrame);
        snapshotFramesRef.current.delete(snapshotKey);
        log(
          "snapshots",
          `[scheduleSnapshot] canceled pending frame id=${prevFrame} key='${snapshotKey}' before queuing '${label}'`
        );
      }

      let frameId = 0;
      let executedSynchronously = false;
      const runSnapshot = () => {
        executedSynchronously = frameId === 0;
        if (snapshotFramesRef.current.get(snapshotKey) !== frameId) {
          if (!executedSynchronously) return;
        }
        snapshotFramesRef.current.delete(snapshotKey);
        if (options?.before && options.before()) {
          log(
            "snapshots",
            `[scheduleSnapshot] guard blocked label='${label}'`
          );
          return;
        }

        if (
          !options?.state &&
          resolvedTabId !== undefined &&
          getActiveTabId &&
          getActiveTabId() !== resolvedTabId
        ) {
          // No explicit state and the live canvas belongs to another tab now
          // — capturing it would snapshot the wrong graph.
          log(
            "snapshots",
            `[scheduleSnapshot] dropped label='${label}' (tab switched away from '${resolvedTabId}')`
          );
          return;
        }
        const state = options?.state ?? getSnapshotState?.() ?? storeApi.getState();
        log(
          "snapshots",
          `[scheduleSnapshot] executing label='${label}' nodes=${state.nodes.length} edges=${state.edges.length}`
        );
        if (options?.refresh && refreshBanner) {
          log("snapshots", `[scheduleSnapshot] refreshing banner for '${label}'`);
          refreshBanner(state.nodes, resolvedTabId, {
            sticky: false,
            immediate: true,
          });
        }
        pushCleanState(state.nodes, state.edges, label, resolvedTabId);

        if (options?.coalesceFollowingCalc) {
          // The recalc this action triggers already bumped this tab's pending
          // token (synchronously, before this frame). Remember it so the
          // matching "After calc" folds into this structural entry.
          const entry = getPendingEntry(snapshotKey);
          entry.coalesceLabel = label;
          entry.coalesceToken = entry.token;
        }
      };

      if (options?.immediate) {
        runSnapshot();
        log(
          "snapshots",
          `[scheduleSnapshot] executed immediately key='${snapshotKey}' label='${label}'`
        );
        return;
      }

      frameId = requestAnimationFrame(runSnapshot);
      if (!executedSynchronously) {
        snapshotFramesRef.current.set(snapshotKey, frameId);
      }
      log(
        "snapshots",
        `[scheduleSnapshot] queued frame id=${frameId} key='${snapshotKey}' label='${label}'`
      );
    },
    [getActiveTabId, getPendingEntry, getSnapshotState, pushCleanState, refreshBanner, storeApi]
  );

  const markPendingAfterDirtyChange = useCallback(() => {
    const entry = getPendingEntry(resolveTabKey());
    entry.token += 1;
    entry.pending = true;
    log(
      "snapshots",
      `[dirtyChange] pendingSnapshotRef -> true token=${entry.token}`
    );
  }, [getPendingEntry, resolveTabKey]);

  const armAfterCalcCoalesce = useCallback(
    (label: string) => {
      const entry = getPendingEntry(resolveTabKey());
      entry.coalesceLabel = label;
      entry.coalesceToken = entry.token;
      log("snapshots", `[armCoalesce] label='${label}' token=${entry.token}`);
    },
    [getPendingEntry, resolveTabKey]
  );

  const clearPendingAfterCalc = useCallback(() => {
    const entry = getPendingEntry(resolveTabKey());
    entry.pending = false;
    entry.lastToken = entry.token;
    skipNextEdgeSnapshotRef.current = false;
    log("snapshots", `[afterCalc] cleared pending snapshot flags`);
  }, [getPendingEntry, resolveTabKey]);

  const lockNodeRemovalSnapshotSkip = useCallback(() => {
    skipNextNodeRemovalRef.current = true;
  }, []);

  const releaseNodeRemovalSnapshotSkip = useCallback(() => {
    skipNextNodeRemovalRef.current = false;
  }, []);

  useEffect(() => {
    const snapshotFrames = snapshotFramesRef.current;
    return () => {
      for (const [snapshotKey, frameId] of snapshotFrames) {
        cancelAnimationFrame(frameId);
        log(
          "snapshots",
          `[scheduleSnapshot] cleanup canceled frame id=${frameId} key='${snapshotKey}'`
        );
      }
      snapshotFrames.clear();
    };
  }, []);

  useEffect(() => {
    if (!autoAfterCalc) return;
    const { calcStatus, loadingUndoRef } = autoAfterCalc;
    if (loadingUndoRef.current) {
      log("snapshots", `[afterCalc] skip auto snapshot (loadingUndoRef)`);
      return;
    }

    // Only ever consider the currently active tab's pending entry. Another
    // tab's pending snapshot stays armed in its own entry until the user
    // returns to it and that tab's recalc settles (this per-tab keying is what
    // replaces the old cross-tab guard).
    const tabKey = resolveTabKey();
    const entry = getPendingEntry(tabKey);
    if (!entry.pending) return;
    if (calcStatus === "CALC") {
      log("snapshots", `[afterCalc] calc still running; waiting`);
      return;
    }

    const state = getSnapshotState?.() ?? storeApi.getState();
    const hasDirty = state.nodes.some((node) => node.data?.dirty);
    if (hasDirty) {
      log(
        "snapshots",
        `[afterCalc] aborted status=${calcStatus} due to dirty nodes`
      );
      return;
    }

    const token = entry.token;
    if (token === entry.lastToken) {
      log(
        "snapshots",
        `[afterCalc] skip auto snapshot (token already captured)`
      );
      entry.pending = false;
      return;
    }

    skipLoadRef.current = true;
    const labelForSnapshot =
      calcStatus === "OK" ? "After calc" : "After calc (errors)";

    // If this recalc is the consequence of a structural action (delete/add/
    // paste) that armed coalescing for this exact token, fold into that
    // structural entry instead of appending a second undo step.
    const coalesceInto =
      entry.coalesceToken === token ? entry.coalesceLabel : null;
    entry.coalesceLabel = null;
    entry.coalesceToken = null;

    const tabIdForSnapshot = getActiveTabIdRef.current?.();
    if (coalesceInto) {
      log(
        "snapshots",
        `[afterCalc] coalescing into '${coalesceInto}' status=${calcStatus}`
      );
      replaceCleanState(
        state.nodes,
        state.edges,
        labelForSnapshot,
        coalesceInto,
        tabIdForSnapshot
      );
    } else {
      log(
        "snapshots",
        `[afterCalc] capturing label='${labelForSnapshot}' status=${calcStatus}`
      );
      pushCleanState(
        state.nodes,
        state.edges,
        labelForSnapshot,
        tabIdForSnapshot
      );
    }
    entry.pending = false;
    entry.lastToken = token;
    skipNextEdgeSnapshotRef.current = false;
    log("snapshots", `[afterCalc] pendingSnapshotRef -> false`);
  }, [
    autoAfterCalc,
    getActiveTabId,
    getPendingEntry,
    getSnapshotState,
    pushCleanState,
    replaceCleanState,
    resolveTabKey,
    skipLoadRef,
    storeApi,
  ]);

  // Stable object identity so the SnapshotContext value doesn't change every
  // render and re-render all node consumers mid-drag (NB-17). Refs are omitted
  // from deps (their identity is already stable).
  return useMemo(
    () => ({
      pushCleanState,
      scheduleSnapshot,
      pendingSnapshotRef,
      skipNextEdgeSnapshotRef,
      skipNextNodeRemovalRef,
      markPendingAfterDirtyChange,
      armAfterCalcCoalesce,
      clearPendingAfterCalc,
      lockNodeRemovalSnapshotSkip,
      releaseNodeRemovalSnapshotSkip,
    }),
    [
      pushCleanState,
      scheduleSnapshot,
      pendingSnapshotRef,
      skipNextEdgeSnapshotRef,
      skipNextNodeRemovalRef,
      markPendingAfterDirtyChange,
      armAfterCalcCoalesce,
      clearPendingAfterCalc,
      lockNodeRemovalSnapshotSkip,
      releaseNodeRemovalSnapshotSkip,
    ]
  );
}
