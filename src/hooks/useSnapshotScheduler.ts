import { useCallback, useEffect, useRef } from "react";
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
  const pendingSnapshotRef = useRef(false);
  const skipNextEdgeSnapshotRef = useRef(false);
  const skipNextNodeRemovalRef = useRef(false);
  const pendingTokenRef = useRef(0);
  const lastSnapshotTokenRef = useRef(0);
  // When a structural snapshot opts into coalescing, remember its label and the
  // pending-recalc token at push time. The next "After calc" for that same token
  // folds into the structural entry instead of appending a second undo step.
  const coalesceLabelRef = useRef<string | null>(null);
  const coalesceTokenRef = useRef<number | null>(null);
  // Tab the pending after-calc snapshot belongs to: the marker is set by an
  // edit on a specific tab, but the deferred snapshot reads the live canvas,
  // so it must never fire while another tab is active.
  const pendingTabIdRef = useRef<string | null>(null);
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
          // The recalc this action triggers already armed pendingTokenRef
          // (synchronously, before this frame). Remember it so the matching
          // "After calc" folds into this structural entry.
          coalesceLabelRef.current = label;
          coalesceTokenRef.current = pendingTokenRef.current;
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
    [getActiveTabId, getSnapshotState, pushCleanState, refreshBanner, storeApi]
  );

  const markPendingAfterDirtyChange = useCallback(() => {
    pendingTokenRef.current += 1;
    pendingSnapshotRef.current = true;
    pendingTabIdRef.current = getActiveTabId?.() ?? null;
    log(
      "snapshots",
      `[dirtyChange] pendingSnapshotRef -> true token=${pendingTokenRef.current}`
    );
  }, [getActiveTabId]);

  const armAfterCalcCoalesce = useCallback((label: string) => {
    coalesceLabelRef.current = label;
    coalesceTokenRef.current = pendingTokenRef.current;
    log(
      "snapshots",
      `[armCoalesce] label='${label}' token=${pendingTokenRef.current}`
    );
  }, []);

  const clearPendingAfterCalc = useCallback(() => {
    pendingSnapshotRef.current = false;
    skipNextEdgeSnapshotRef.current = false;
    lastSnapshotTokenRef.current = pendingTokenRef.current;
    log("snapshots", `[afterCalc] cleared pending snapshot flags`);
  }, []);

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

    if (!pendingSnapshotRef.current) return;
    if (calcStatus === "CALC") {
      log("snapshots", `[afterCalc] calc still running; waiting`);
      return;
    }

    const pendingTabId = pendingTabIdRef.current;
    const currentTabId = getActiveTabId?.();
    if (
      pendingTabId !== null &&
      currentTabId !== undefined &&
      currentTabId !== pendingTabId
    ) {
      // The pending edit belongs to another tab; the live canvas now holds
      // this tab's graph. Keep the token pending — the snapshot fires with
      // the right content when the user returns to that tab.
      log(
        "snapshots",
        `[afterCalc] skip auto snapshot (active tab '${currentTabId}' != pending '${pendingTabId}')`
      );
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

    const token = pendingTokenRef.current;
    if (token === lastSnapshotTokenRef.current) {
      log(
        "snapshots",
        `[afterCalc] skip auto snapshot (token already captured)`
      );
      pendingSnapshotRef.current = false;
      return;
    }

    skipLoadRef.current = true;
    const labelForSnapshot =
      calcStatus === "OK" ? "After calc" : "After calc (errors)";

    // If this recalc is the consequence of a structural action (delete/add/
    // paste) that armed coalescing for this exact token, fold into that
    // structural entry instead of appending a second undo step.
    const coalesceInto =
      coalesceTokenRef.current === token ? coalesceLabelRef.current : null;
    coalesceLabelRef.current = null;
    coalesceTokenRef.current = null;

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
        pendingTabId ?? undefined
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
        pendingTabId ?? undefined
      );
    }
    pendingSnapshotRef.current = false;
    lastSnapshotTokenRef.current = token;
    skipNextEdgeSnapshotRef.current = false;
    log("snapshots", `[afterCalc] pendingSnapshotRef -> false`);
  }, [
    autoAfterCalc,
    getActiveTabId,
    getSnapshotState,
    pushCleanState,
    replaceCleanState,
    skipLoadRef,
    storeApi,
  ]);

  return {
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
  };
}
