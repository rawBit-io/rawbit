import { useCallback, useEffect, useRef } from "react";
import type { Edge } from "@xyflow/react";
import { log } from "@/lib/logConfig";
import type { CalcStatus, CalcError, FlowNode } from "@/types";
import type { PushStateOptions } from "@/contexts/undo-redo";

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
}

export interface SnapshotOptions {
  refresh?: boolean;
  before?: () => boolean;
}

export interface SnapshotScheduler {
  pushCleanState: (nodes: FlowNode[], edges: Edge[], label: string) => void;
  scheduleSnapshot: (label: string, options?: SnapshotOptions) => void;
  pendingSnapshotRef: React.MutableRefObject<boolean>;
  skipNextEdgeSnapshotRef: React.MutableRefObject<boolean>;
  skipNextNodeRemovalRef: React.MutableRefObject<boolean>;
  markPendingAfterDirtyChange: () => void;
  clearPendingAfterCalc: () => void;
  lockEdgeSnapshotSkip: () => void;
  releaseEdgeSnapshotSkip: () => void;
  lockNodeRemovalSnapshotSkip: () => void;
  releaseNodeRemovalSnapshotSkip: () => void;
}

export function useSnapshotScheduler({
  storeApi,
  getSnapshotState,
  pushState,
  incrementGraphRev,
  skipLoadRef,
  refreshBanner,
  autoAfterCalc,
  getCalcSnapshot,
}: UseSnapshotSchedulerArgs): SnapshotScheduler {
  const pendingSnapshotRef = useRef(false);
  const skipNextEdgeSnapshotRef = useRef(false);
  const skipNextNodeRemovalRef = useRef(false);
  const edgeSkipLockedRef = useRef(false);
  const pendingTokenRef = useRef(0);
  const lastSnapshotTokenRef = useRef(0);
  const snapshotFrameRef = useRef<number | null>(null);

  const pushCleanState = useCallback(
    (nodes: FlowNode[], edges: Edge[], label: string) => {
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

  const scheduleSnapshot = useCallback(
    (label: string, options?: SnapshotOptions) => {
      log(
        "snapshots",
        `[scheduleSnapshot] request label='${label}' refresh=${Boolean(
          options?.refresh
        )} hasBefore=${Boolean(options?.before)}`
      );
      if (snapshotFrameRef.current !== null) {
        const prevFrame = snapshotFrameRef.current;
        cancelAnimationFrame(prevFrame);
        log(
          "snapshots",
          `[scheduleSnapshot] canceled pending frame id=${prevFrame} before queuing '${label}'`
        );
      }

      const frameId = requestAnimationFrame(() => {
        snapshotFrameRef.current = null;
        if (options?.before && options.before()) {
          log(
            "snapshots",
            `[scheduleSnapshot] guard blocked label='${label}'`
          );
          return;
        }

        const state = getSnapshotState?.() ?? storeApi.getState();
        log(
          "snapshots",
          `[scheduleSnapshot] executing label='${label}' nodes=${state.nodes.length} edges=${state.edges.length}`
        );
        if (options?.refresh && refreshBanner) {
          log("snapshots", `[scheduleSnapshot] refreshing banner for '${label}'`);
          refreshBanner(state.nodes, undefined, { sticky: false, immediate: true });
        }
        pushCleanState(state.nodes, state.edges, label);
      });
      snapshotFrameRef.current = frameId;
      log(
        "snapshots",
        `[scheduleSnapshot] queued frame id=${frameId} label='${label}'`
      );
    },
    [getSnapshotState, pushCleanState, refreshBanner, storeApi]
  );

  const markPendingAfterDirtyChange = useCallback(() => {
    pendingTokenRef.current += 1;
    pendingSnapshotRef.current = true;
    log(
      "snapshots",
      `[dirtyChange] pendingSnapshotRef -> true token=${pendingTokenRef.current}`
    );
  }, []);

  const clearPendingAfterCalc = useCallback(() => {
    pendingSnapshotRef.current = false;
    skipNextEdgeSnapshotRef.current = false;
    lastSnapshotTokenRef.current = pendingTokenRef.current;
    log("snapshots", `[afterCalc] cleared pending snapshot flags`);
  }, []);

  const lockEdgeSnapshotSkip = useCallback(() => {
    skipNextEdgeSnapshotRef.current = true;
    edgeSkipLockedRef.current = true;
  }, []);

  const releaseEdgeSnapshotSkip = useCallback(() => {
    edgeSkipLockedRef.current = false;
    skipNextEdgeSnapshotRef.current = false;
  }, []);

  const lockNodeRemovalSnapshotSkip = useCallback(() => {
    skipNextNodeRemovalRef.current = true;
  }, []);

  const releaseNodeRemovalSnapshotSkip = useCallback(() => {
    skipNextNodeRemovalRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      if (snapshotFrameRef.current !== null) {
        const frameId = snapshotFrameRef.current;
        cancelAnimationFrame(frameId);
        log(
          "snapshots",
          `[scheduleSnapshot] cleanup canceled frame id=${frameId}`
        );
      }
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
    log(
      "snapshots",
      `[afterCalc] capturing label='${labelForSnapshot}' status=${calcStatus}`
    );
    pushCleanState(state.nodes, state.edges, labelForSnapshot);
    pendingSnapshotRef.current = false;
    lastSnapshotTokenRef.current = token;
    if (!edgeSkipLockedRef.current) {
      skipNextEdgeSnapshotRef.current = false;
    }
    log("snapshots", `[afterCalc] pendingSnapshotRef -> false`);
  }, [autoAfterCalc, getSnapshotState, pushCleanState, skipLoadRef, storeApi]);

  return {
    pushCleanState,
    scheduleSnapshot,
    pendingSnapshotRef,
    skipNextEdgeSnapshotRef,
    skipNextNodeRemovalRef,
    markPendingAfterDirtyChange,
    clearPendingAfterCalc,
    lockEdgeSnapshotSkip,
    releaseEdgeSnapshotSkip,
    lockNodeRemovalSnapshotSkip,
    releaseNodeRemovalSnapshotSkip,
  };
}
