import { createContext } from "react";
import type { Edge } from "@xyflow/react";

import type { FlowNode, CalcStatus, CalcError } from "@/types";
import type { ScriptStepsEntry } from "@/lib/share/scriptStepsCache";

export type SnapshotCalcState = {
  status: CalcStatus;
  errors: CalcError[];
};

export interface GraphSnapshot {
  nodes: FlowNode[];
  edges: Edge[];
  label: string;
  scriptSteps: ScriptStepsEntry[];
  calcState?: SnapshotCalcState;
}

export type PushStateOptions = {
  label?: string;
  calcState?: SnapshotCalcState;
  tabId?: string;
};

export type ReplaceStateOptions = PushStateOptions & {
  /**
   * Coalesce into the top history entry instead of appending, but only when
   * that entry is still the newest and its label matches. Lets an "After calc"
   * snapshot fold into the structural snapshot of the same user action (e.g.
   * "Node(s) removed") so one action is one undo. Falls back to an append
   * (using `label`) when the top entry is no longer the expected one.
   */
  coalesceFromLabel?: string;
};

export interface UndoRedoContextValue {
  history: GraphSnapshot[];
  pointer: number;
  canUndo: boolean;
  canRedo: boolean;
  pushState: (
    nodes: FlowNode[],
    edges: Edge[],
    labelOrOptions?: string | PushStateOptions
  ) => void;
  replaceState: (
    nodes: FlowNode[],
    edges: Edge[],
    options: ReplaceStateOptions
  ) => void;
  undo: () => void;
  redo: () => void;
  jumpTo: (index: number) => void;
  setActiveTab: (tabId: string) => void;
  initializeTabHistory: (
    tabId: string,
    nodes?: FlowNode[],
    edges?: Edge[]
  ) => void;
  removeTabHistory: (tabId: string) => void;
}

export const UndoRedoContext = createContext<UndoRedoContextValue | null>(null);
