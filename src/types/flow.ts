import type { Edge, Node, XYPosition } from "@xyflow/react";

import type { ScriptExecutionResult } from "./calc";

/* ------------------------------------------------------------------ */
/*  Input-structure definitions                                       */
/* ------------------------------------------------------------------ */

export interface FieldDefinition {
  label: string;
  index: number; // absolute offset inside the instance
  placeholder?: string;
  small?: boolean;
  rows?: number;
  autoResizeMaxRows?: number;
  allowEmpty00?: boolean;
  allowEmptyBlank?: boolean;
  allowNull?: boolean;
  emptyLabel?: string;
  nullLabel?: string;
  unconnectable?: boolean;
  comment?: string;
  options?: string[];
  value?: string;
  fileInput?: "image-hex";
  fileInputLabel?: string;
  accept?: string;
  maxFileBytes?: number;
}

export interface GroupDefinition {
  title: string;
  baseIndex: number; // absolute offset of the first instance
  fields: FieldDefinition[];
  expandable?: boolean;
  fieldCountToAdd?: number; // how many fields one click should add
  minInstances?: number;
  maxInstances?: number;
  instanceLabelPrefix?: string; // optional per-instance header label (e.g., "Input")
}

export interface InputStructure {
  ungrouped?: FieldDefinition[];
  groups?: GroupDefinition[];
  betweenGroups?: Record<string, FieldDefinition[]>;
  afterGroups?: FieldDefinition[];
  helpText?: string;
}

export type OutputLayoutMode =
  | "default"
  | "taproot_tree_builder"
  | "taproot_tweak_xonly_pubkey"
  | "musig2_nonce_gen";

export interface OutputPortDefinition {
  label: string;
  handleId: string;
  showHandle?: boolean;
  showLabel?: boolean;
  handleTop?: string;
  handleTopSource?: string;
}

export interface GroupBundlePortOffsets {
  source?: number;
  target?: number;
  sourceByBundle?: Record<string, number>;
  targetByBundle?: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/*  Calculation-node-specific data                                    */
/* ------------------------------------------------------------------ */

export interface CalculationNodeData extends Record<string, unknown> {
  /** core */
  functionName?: string;
  dirty?: boolean;
  version?: number;
  error?: boolean;
  result?: unknown;

  /** geometry / layout */
  baseHeight?: number;
  width?: number;
  height?: number;

  /** single-value mode */
  value?: string;

  /** multi-value mode */
  inputs?: {
    vals?: Record<number, string> | string[];
    val?: string | number;
    [key: string]: unknown;
  };
  inputStructure?: InputStructure;
  numInputs?: number;
  groupInstances?: Record<string, number>;
  groupInstanceKeys?: Record<string, number[]>;

  /** UX helpers */
  networkDependent?: boolean;
  selectedNetwork?: "regtest" | "signet" | "testnet" | "mainnet";
  extendedError?: string;
  comment?: string;
  showComment?: boolean;
  title?: string; // editable display name
  customFieldLabels?: Record<number, string>;
  customGroupTitles?: Record<string, string>;
  hasRegenerate?: boolean;
  forceRegenerate?: boolean;
  showField?: boolean;
  paramExtraction?: "single_val" | "multi_val";
  radioChannel?: string;
  channel?: string;
  isGroup?: boolean;
  groupFlash?: boolean;
  borderColor?: string;
  locked?: boolean;
  groupBundlePortOffsets?: GroupBundlePortOffsets;
  isHighlighted?: boolean;
  isConcatAll?: boolean;
  compactConcatInputs?: boolean;
  searchMark?: {
    term: string;
    ts: number;
  };

  /** TextInfoNode */
  content?: string;
  fontSize?: number;
  textAlign?: "left" | "center";
  textInfoFill?: "none";

  totalInputs?: number; // how many input handles the node *should* render
  unwiredCount?: number; // how many of those handles are currently *unwired*
  scriptDebugSteps?: ScriptExecutionResult | null;
  scriptSteps?: ScriptExecutionResult | null;
  taprootTree?: Record<string, unknown> | null;
  taprootLeafIndex?: number;
  outputLayout?: OutputLayoutMode;
  outputPorts?: OutputPortDefinition[];
  outputValues?: Record<string, unknown>;
  txFieldExtractMode?: "dynamic";
  txExtractFields?: string[];
  banner?: unknown;
  tooltip?: unknown;
}

export type NodeData = CalculationNodeData;

/**
 * Rich Flow node wrapper used across the app.
 * Supports overriding the embedded `data` shape when a caller has
 * narrowed/calculated a more specific interface.
 */
export type FlowNode<TData extends CalculationNodeData = CalculationNodeData> =
  Node<TData> & {
    /**
     * Absolute canvas coordinates emitted by React Flow position change events.
     * Optional because it's only populated during drags or by tests.
     */
    positionAbsolute?: XYPosition;
    dragHandle?: string;
    dragging?: boolean;
    measured?: {
      width?: number;
      height?: number;
    };
  };

export type FlowNodes<TData extends CalculationNodeData = CalculationNodeData> =
  FlowNode<TData>[];

export type FlowGraph<
  TNode extends FlowNode = FlowNode,
  TEdge extends Edge = Edge
> = {
  nodes: TNode[];
  edges: TEdge[];
};

export interface VirtualEdge {
  id: string;
  kind: "radio";
  channel: string;
  source: string;
  target: string;
  targetHandle?: string;
  sourceFunction: "radio_send";
  targetFunction: "radio_receive";
}

export interface VirtualEdgeIssue {
  kind: "radio";
  channel: string;
  nodeId?: string;
  message: string;
}

/* ------------------------------------------------------------------ */
/*  Flow & persistent-storage                                         */
/* ------------------------------------------------------------------ */

export interface FlowData<
  TNode extends FlowNode = FlowNode,
  TEdge extends Edge = Edge
> {
  nodes: TNode[];
  edges: TEdge[];
  name?: string;
  schemaVersion?: number;
  virtualEdges?: VirtualEdge[];
  virtualEdgeIssues?: VirtualEdgeIssue[];
}

/* ------------------------------------------------------------------ */
/*  Compact node/edge export used by simplified + LLM snapshots       */
/* ------------------------------------------------------------------ */

export interface SimplifiedNode {
  id: string;
  name?: string; // node.data.title OR id fallback
  functionName?: string; // node.data.functionName
  value?: unknown; // node.data.result OR node.data.value
}

export interface SimplifiedEdge {
  id: string;
  source: string;
  target: string;
}
