// ─────────────────────────────────────────────────────────────
//  src/contexts/UndoRedoContext.tsx
// ─────────────────────────────────────────────────────────────
import type { ReactNode } from "react";
import { useState } from "react";
import type { FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";
import { log } from "@/lib/logConfig";
import {
  ingestScriptSteps,
  snapshotScriptSteps,
  restoreScriptSteps,
} from "@/lib/share/scriptStepsCache";
import {
  UndoRedoContext,
  PushStateOptions,
  ReplaceStateOptions,
  GraphSnapshot,
  SnapshotCalcState,
  UndoRedoContextValue,
} from "@/contexts/undo-redo";
import { sanitizeGroupBundleVisualElementsForState } from "@/lib/flow/groupEdgeBundling";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface TabHistories {
  [tabId: string]: {
    history: GraphSnapshot[];
    pointer: number;
  };
}

/* ------------------------------------------------------------------ */
/* Implementation                                                      */
/* ------------------------------------------------------------------ */
const MAX_HISTORY = 50; // maximum snapshots kept per tab

const cloneValue = <T,>(value: T): T => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const cloneCalcState = (
  calcState: SnapshotCalcState | undefined
): SnapshotCalcState | undefined => {
  if (!calcState) return undefined;
  return {
    status: calcState.status,
    errors: calcState.errors.map((err) => ({ ...err })),
  };
};

type TabHistory = { history: GraphSnapshot[]; pointer: number };

/** Append a snapshot: trim the redo branch, evict the oldest when full. */
const appendSnapshot = (
  current: TabHistory,
  snap: GraphSnapshot
): { next: TabHistory; trimmedFuture: number; evictedLabel: string | null } => {
  const next = [...current.history.slice(0, current.pointer + 1)];
  const trimmedFuture = Math.max(
    current.history.length - (current.pointer + 1),
    0
  );

  let evictedLabel: string | null = null;
  if (next.length === MAX_HISTORY) {
    evictedLabel = next[0]?.label ?? null;
    next.shift();
  }

  next.push(snap);
  return {
    next: { history: next, pointer: next.length - 1 },
    trimmedFuture,
    evictedLabel,
  };
};

export function UndoRedoProvider({ children }: { children: ReactNode }) {
  const [activeTabId, setActiveTabId] = useState("tab-1");
  const [tabHistories, setTabHistories] = useState<TabHistories>({
    "tab-1": { history: [], pointer: -1 },
  });

  /* ───────── helpers ───────── */
  const getCurrentTabHistory = () => {
    if (!tabHistories[activeTabId]) {
      setTabHistories((prev) => ({
        ...prev,
        [activeTabId]: { history: [], pointer: -1 },
      }));
      return { history: [], pointer: -1 };
    }
    return tabHistories[activeTabId];
  };

  const { history, pointer } = getCurrentTabHistory();

  /* ───────── tab management ───────── */
  const setActiveTab = (tabId: string) => {
    log("snapshots", `[history] setActiveTab ${activeTabId} -> ${tabId}`);
    setActiveTabId(tabId);

    // Create a shell for brand-new tabs, leave others intact
    setTabHistories((prev) => {
      if (prev[tabId]) return prev;
      return { ...prev, [tabId]: { history: [], pointer: -1 } };
    });
  };

  const initializeTabHistory = (
    tabId: string,
    nodes: FlowNode[] = [],
    edges: Edge[] = []
  ) => {
    log(
      "snapshots",
      `[history] initialize tab=${tabId} nodes=${nodes.length} edges=${edges.length}`
    );

    const canonical = sanitizeGroupBundleVisualElementsForState({ nodes, edges });
    const clonedNodes = ingestScriptSteps(cloneValue(canonical.nodes));
    const initialSnapshot: GraphSnapshot = {
      nodes: clonedNodes,
      edges: cloneValue(canonical.edges),
      label: "Initial snapshot",
      scriptSteps: snapshotScriptSteps(),
      calcState: {
        status: "OK",
        errors: [],
      },
    };

    restoreScriptSteps(initialSnapshot.scriptSteps);

    setTabHistories((prev) => ({
      ...prev,
      [tabId]: { history: [initialSnapshot], pointer: 0 },
    }));
    setActiveTabId(tabId);
  };

  const removeTabHistory = (tabId: string) => {
    log("snapshots", `[history] remove tab=${tabId}`);
    setTabHistories((prev) => {
      const copy = { ...prev };
      delete copy[tabId];
      return copy;
    });
  };

  /* ───────── snapshot operations ───────── */
  const pushState = (
    nodes: FlowNode[],
    edges: Edge[],
    labelOrOptions?: string | PushStateOptions
  ) => {
    const canonical = sanitizeGroupBundleVisualElementsForState({ nodes, edges });
    const clonedNodes = ingestScriptSteps(cloneValue(canonical.nodes));
    const options =
      typeof labelOrOptions === "string"
        ? { label: labelOrOptions }
        : labelOrOptions ?? {};
    const targetTabId = options.tabId ?? activeTabId;
    const scriptSteps = snapshotScriptSteps();
    const clonedEdges = cloneValue(canonical.edges);
    const calcState = cloneCalcState(options.calcState);

    setTabHistories((prev) => {
      const current = prev[targetTabId] ?? { history: [], pointer: -1 };
      const currentHistory = current.history;
      const currentPointer = current.pointer;
      const label = options.label ?? `Snapshot #${currentHistory.length + 1}`;
      const newSnap: GraphSnapshot = {
        nodes: clonedNodes,
        edges: clonedEdges,
        label,
        scriptSteps,
        calcState,
      };

      const { next, trimmedFuture, evictedLabel } = appendSnapshot(
        { history: currentHistory, pointer: currentPointer },
        newSnap
      );

      const debugParts = [
        `tab=${targetTabId}`,
        `label='${newSnap.label}'`,
        `nodes=${newSnap.nodes.length}`,
        `edges=${newSnap.edges.length}`,
        `pointer ${currentPointer}->${next.pointer}`,
        `size ${currentHistory.length}->${next.history.length}`,
      ];
      if (trimmedFuture > 0) debugParts.push(`trimmedFuture=${trimmedFuture}`);
      if (evictedLabel) debugParts.push(`evicted='${evictedLabel}'`);
      log("snapshots", `[pushState] ${debugParts.join(" ")}`);

      return {
        ...prev,
        [targetTabId]: next,
      };
    });
  };

  /**
   * Replace the top history entry in place when it is still the newest and its
   * label matches `coalesceFromLabel`; otherwise append like pushState. Used to
   * fold an "After calc" snapshot into the structural snapshot of the same user
   * action so one action produces one undo step.
   */
  const replaceState = (
    nodes: FlowNode[],
    edges: Edge[],
    options: ReplaceStateOptions
  ) => {
    const canonical = sanitizeGroupBundleVisualElementsForState({ nodes, edges });
    const clonedNodes = ingestScriptSteps(cloneValue(canonical.nodes));
    const targetTabId = options.tabId ?? activeTabId;
    const scriptSteps = snapshotScriptSteps();
    const clonedEdges = cloneValue(canonical.edges);
    const calcState = cloneCalcState(options.calcState);

    setTabHistories((prev) => {
      const current = prev[targetTabId] ?? { history: [], pointer: -1 };
      const top = current.history[current.pointer];
      const atEnd = current.pointer === current.history.length - 1;
      const canCoalesce =
        options.coalesceFromLabel !== undefined &&
        atEnd &&
        top?.label === options.coalesceFromLabel;

      if (canCoalesce) {
        // Keep the structural label, refresh the captured state.
        const nextHistory = [...current.history];
        nextHistory[current.pointer] = {
          nodes: clonedNodes,
          edges: clonedEdges,
          label: top.label,
          scriptSteps,
          calcState,
        };
        log(
          "snapshots",
          `[replaceState] coalesced into '${top.label}' tab=${targetTabId} pointer=${current.pointer}`
        );
        return {
          ...prev,
          [targetTabId]: { history: nextHistory, pointer: current.pointer },
        };
      }

      const newSnap: GraphSnapshot = {
        nodes: clonedNodes,
        edges: clonedEdges,
        label:
          options.label ?? `Snapshot #${current.history.length + 1}`,
        scriptSteps,
        calcState,
      };
      const { next } = appendSnapshot(current, newSnap);
      log(
        "snapshots",
        `[replaceState] appended '${newSnap.label}' tab=${targetTabId} (no coalesce target)`
      );
      return { ...prev, [targetTabId]: next };
    });
  };

  /* ───────── undo / redo ───────── */
  const undo = () => {
    if (pointer <= 0) {
      log(
        "snapshots",
        `[undo] tab=${activeTabId} blocked pointer=${pointer} history=${history.length}`
      );
      return;
    }
    const nextPointer = pointer - 1;
    const targetSnap = history[nextPointer];
    log(
      "snapshots",
      `[undo] tab=${activeTabId} ${pointer}->${nextPointer} label='${targetSnap?.label ?? "?"}'`
    );
    setTabHistories((prev) => ({
      ...prev,
      [activeTabId]: { ...prev[activeTabId], pointer: nextPointer },
    }));
  };

  const redo = () => {
    if (pointer >= history.length - 1) {
      log(
        "snapshots",
        `[redo] tab=${activeTabId} blocked pointer=${pointer} history=${history.length}`
      );
      return;
    }
    const nextPointer = pointer + 1;
    const targetSnap = history[nextPointer];
    log(
      "snapshots",
      `[redo] tab=${activeTabId} ${pointer}->${nextPointer} label='${targetSnap?.label ?? "?"}'`
    );
    setTabHistories((prev) => ({
      ...prev,
      [activeTabId]: { ...prev[activeTabId], pointer: nextPointer },
    }));
  };

  const jumpTo = (index: number) => {
    if (index < 0 || index >= history.length) {
      log(
        "snapshots",
        `[jumpTo] tab=${activeTabId} ignored index=${index} history=${history.length}`
      );
      return;
    }
    if (index === pointer) {
      log("snapshots", `[jumpTo] tab=${activeTabId} already at index=${index}`);
      return;
    }
    log(
      "snapshots",
      `[jumpTo] tab=${activeTabId} ${pointer}->${index} label='${history[index]?.label ?? "?"}'`
    );
    setTabHistories((prev) => ({
      ...prev,
      [activeTabId]: { ...prev[activeTabId], pointer: index },
    }));
  };

  /* ───────── derived flags ───────── */
  const canUndo = pointer > 0;
  const canRedo = pointer < history.length - 1;

  /* ───────── context value ───────── */
  const ctxValue: UndoRedoContextValue = {
    history,
    pointer,
    canUndo,
    canRedo,
    pushState,
    replaceState,
    undo,
    redo,
    jumpTo,
    setActiveTab,
    initializeTabHistory,
    removeTabHistory,
  };

  return (
    <UndoRedoContext.Provider value={ctxValue}>
      {children}
    </UndoRedoContext.Provider>
  );
}
