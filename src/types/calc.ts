import type { Edge } from "@xyflow/react";

import type { FlowGraph, FlowNode } from "./flow";

/* ------------------------------------------------------------------ */
/*  Global calculation status & errors                                */
/* ------------------------------------------------------------------ */

export type CalcStatus = "OK" | "CALC" | "ERROR";

export interface CalcError {
  nodeId: string;
  error: string;
}

/** Slice of state returned by useCalculation() that the UI cares about */
export interface CalculationState {
  status: "IDLE" | "RUNNING" | "SUCCESS" | "ERROR";
  errorInfo: CalcError[];
  // ...extend as needed (results, timestamps, etc.)
}

/* ------------------------------------------------------------------ */
/*  Hooks API props                                                   */
/* ------------------------------------------------------------------ */

export type FlowNodeSetter<TNode extends FlowNode = FlowNode> = (
  updater: (nodes: TNode[]) => TNode[]
) => void;

export interface UseNodeCalculationLogicProps<
  TNode extends FlowNode = FlowNode
> {
  id: string;
  data: TNode["data"];
  setNodes: FlowNodeSetter<TNode>;
}

export interface UseGlobalCalculationLogicProps<
  TNode extends FlowNode = FlowNode,
  TEdge extends Edge = Edge
> {
  nodes: TNode[];
  edges: TEdge[];
  debounceMs?: number;
  onStatusChange?: (status: CalcStatus, errorInfo?: CalcError[]) => void;
}

/* ------------------------------------------------------------------ */
/*  Re-calculation API                                                */
/* ------------------------------------------------------------------ */

export interface RecalcResponse {
  nodes: FlowNode[];
  version: number;
  errors?: CalcError[];
}

export interface CalcContext<
  TNode extends FlowNode = FlowNode,
  TEdge extends Edge = Edge,
  TState extends CalculationState = CalculationState
> extends FlowGraph<TNode, TEdge> {
  state: TState;
}

/* ------------------------------------------------------------------ */
/*  Script-verification dialog                                        */
/* ------------------------------------------------------------------ */

export interface StepData {
  pc: number;
  opcode: number;
  opcode_name: string;
  stack_before: string[];
  stack_after: string[];
  failed?: boolean;
  error?: string;
  phase?: "scriptSig" | "scriptPubKey" | "redeemScript" | "witnessScript" | string;
}

export interface ScriptExecutionResult {
  scriptSig?: string;
  scriptPubKey?: string;
  redeemScript?: string;
  witnessScript?: string;
  /** Raw witness stack items as supplied (Taproot key-path, etc.) */
  witnessStack?: string[];
  isValid?: boolean;
  usesWitness?: boolean;
  witnessRulesEnabled?: boolean;
  amountUsed?: number;
  steps?: StepData[];
  error?: string;
}

export interface ScriptExecutionStepsProps {
  open: boolean;
  onClose: () => void;
  scriptResult: ScriptExecutionResult | null;
  scriptSigInputHex?: string;
  scriptPubKeyInputHex?: string;
}

export interface RenderHighlightedScriptProps {
  scriptHex: string;
  offset: number;
  pc: number;
  opcodeName: string;
  label: string;
  isInScriptPubKey: boolean;
}
