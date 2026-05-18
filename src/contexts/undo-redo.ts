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
