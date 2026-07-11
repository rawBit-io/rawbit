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
  /** Absent on validator steps — they are not instructions. */
  opcode?: number;
  opcode_name: string;
  stack_before: string[];
  stack_after: string[];
  failed?: boolean;
  error?: string;
  phase?:
    | "scriptSig"
    | "scriptPubKey"
    | "redeemScript"
    | "witness"
    | "witnessScript"
    | string;
  /**
   * "opcode" (default when absent) = executed by the script engine;
   * "validator" = consensus rule applied by the validation engine
   * (BIP141 witness deserialization, BIP143 scriptCode derivation, …).
   */
  kind?: "opcode" | "validator";
  /** Machine name of a validator step, e.g. "witness_load", "scriptcode_derive". */
  step?: string;
  /** Inner script surfaced by the tracer (scriptCode / witnessScript / redeemScript). */
  script_hex?: string;
  /** witness_load: zero-based index of the item being deserialized. */
  witness_index?: number;
  /** witness_load: total number of witness items. */
  witness_total?: number;
  /** Witness program bytes from the scriptPubKey (pattern-match / derive / check steps). */
  program_hex?: string;
  /** witness_script_check: SHA256 of the candidate witnessScript. */
  sha256_hex?: string;
}

export interface ScriptExecutionResult {
  scriptSig?: string;
  scriptPubKey?: string;
  redeemScript?: string;
  witnessScript?: string;
  /** P2WPKH: implied P2PKH template (BIP143 scriptCode) — derived, never transmitted. */
  scriptCode?: string;
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
