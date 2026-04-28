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
  GraphSnapshot,
  SnapshotCalcState,
  UndoRedoContextValue,
} from "@/contexts/undo-redo";

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

    const clonedNodes = ingestScriptSteps(cloneValue(nodes));
    const initialSnapshot: GraphSnapshot = {
      nodes: clonedNodes,
      edges: cloneValue(edges),
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
    const clonedNodes = ingestScriptSteps(cloneValue(nodes));
    const options =
      typeof labelOrOptions === "string"
        ? { label: labelOrOptions }
        : labelOrOptions ?? {};
    const label =
      options.label ?? `Snapshot #${history.length + 1}`;
    const newSnap: GraphSnapshot = {
      nodes: clonedNodes,
      edges: cloneValue(edges),
      label,
      scriptSteps: snapshotScriptSteps(),
      calcState: cloneCalcState(options.calcState),
    };

    /* -------------------------------------------------------------- *
     * 1️⃣  Keep only the branch we’re on (discard “future” snapshots) *
     * -------------------------------------------------------------- */
    const next = [...history.slice(0, pointer + 1)];
    const trimmedFuture = Math.max(history.length - (pointer + 1), 0);

    /* -------------------------------------------------------------- *
     * 2️⃣  Ring-buffer: if full, drop the oldest                      *
     *     (pointer can only be at the end after the slice)           *
     * -------------------------------------------------------------- */
    let evictedLabel: string | null = null;
    if (next.length === MAX_HISTORY) {
      evictedLabel = next[0]?.label ?? null;
      next.shift();
    }

    /* -------------------------------------------------------------- *
     * 3️⃣  Append the fresh snapshot and move pointer to it           *
     * -------------------------------------------------------------- */
    next.push(newSnap);
    const newPointer = next.length - 1;

    const debugParts = [
      `tab=${activeTabId}`,
      `label='${newSnap.label}'`,
      `nodes=${newSnap.nodes.length}`,
      `edges=${newSnap.edges.length}`,
      `pointer ${pointer}->${newPointer}`,
      `size ${history.length}->${next.length}`,
    ];
    if (trimmedFuture > 0) debugParts.push(`trimmedFuture=${trimmedFuture}`);
    if (evictedLabel) debugParts.push(`evicted='${evictedLabel}'`);
    log("snapshots", `[pushState] ${debugParts.join(" ")}`);

    setTabHistories((prev) => ({
      ...prev,
      [activeTabId]: { history: next, pointer: newPointer },
    }));
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
