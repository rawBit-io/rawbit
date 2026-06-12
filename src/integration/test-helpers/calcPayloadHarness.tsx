/* eslint-disable react-refresh/only-export-components */
// Shared harness for the calculation-behavior regression suite.
//
// Fidelity goal: every interaction flows through REAL production code.
//   user gesture → CalculationNodeView controls → useCalcNodeMutations /
//   useGroupInstances / useNodeCalculationLogic → useReactFlow().setNodes
//   (real @xyflow/react BatchProvider diffing) → useFlowInteractions →
//   useNodeOperations state → useGlobalCalculationLogic (real debounce /
//   version guard) → recalculateGraph fetch → MSW-captured /bulk_calculate
//   request payload (the oracle).
//
// What is real: CalculationNode + CalculationNodeView (checkboxes, +/-
// buttons, selects, node menu), useCalcNodeMutations, useGroupInstances,
// useNodeCalculationLogic, useGlobalCalculationLogic, graphUtils
// (recalculateGraph/getAffectedSubgraph/merge), useNodeOperations,
// useFlowInteractions (dirty marking for edge ops), useCopyPaste,
// useFileOperations, UndoRedoProvider, ReactFlowProvider store + queue,
// scriptStepsCache, and the lesson import pipeline.
//
// What is stubbed: the ReactFlow CANVAS itself is not mounted (no
// drag/zoom DOM); nodes/edges live in the same controlled React state the
// app uses, synced into the real ReactFlow store via the same
// onNodesChange/onEdgesChange contract <ReactFlow> would use. Snapshot
// scheduling is a no-op unless a test opts into pushing undo history.

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { act, render, waitFor, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { expect } from "vitest";
import { http, HttpResponse } from "msw";
import fs from "node:fs";
import path from "node:path";

import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import type { Connection, Edge, EdgeChange, NodeChange } from "@xyflow/react";

import CalculationNode from "@/components/nodes/CalculationNode";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { CanonicalGraphContext } from "@/contexts/canonical-graph";
import { SnapshotProvider } from "@/contexts/SnapshotContext";
import { UndoRedoProvider } from "@/contexts/UndoRedoContext";
import type { GraphSnapshot } from "@/contexts/undo-redo";
import { useGlobalCalculationLogic } from "@/hooks/useCalculation";
import { useCopyPaste } from "@/hooks/useCopyPaste";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useFlowInteractions } from "@/hooks/useFlowInteractions";
import { useLimitErrorRecovery } from "@/hooks/useLimitErrorRecovery";
import { useNodeOperations } from "@/hooks/useNodeOperations";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { isCalculableNode } from "@/lib/flow/nonCalculableNodes";
import { FLOW_SCHEMA_VERSION } from "@/lib/flow/schema";
import { validateFlowData } from "@/lib/flow/validate";
import { importWithFreshIds } from "@/lib/idUtils";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";
import {
  ingestScriptSteps,
  restoreScriptSteps,
} from "@/lib/share/scriptStepsCache";
import { server } from "@/test/msw/server";
import { createSnapshotScheduler } from "@/test-utils/snapshot";
import { buildNodeProps } from "@/test-utils/types";
import type { CalcError, FlowData, FlowNode, NodeData } from "@/types";

/* ────────────────────────────────────────────────────────────────────────
 * Intro-flow fixture (loaded once per test file, deep-cloned per harness)
 * ──────────────────────────────────────────────────────────────────────── */

export const INTRO = {
  /** concat_all "Preimage" with grouped INPUTS[] keys [0, 100] */
  preimageConcat: "node_Xoq2K65O",
  /** script_verification node carrying the "__EMPTY__" sentinel at index 5 */
  scriptVerify: "node_o6vul7a",
  /** dynamic extract_tx_field node (txid, vout.scriptPubKey) */
  txExtract: "node_kzcs3gx",
  /** hash160_to_p2pkh_address with selectedNetwork "testnet" */
  address: "node_GJptZvmY",
  /** sighash_type_to_le4 feeding preimageConcat input-100 */
  sighashLe4: "node_p0kp4lg",
  /** identity "Sequence" input node */
  sequence: "node_v7K1rBTw",
  /** identity "Version" input node */
  version: "node_8QSOHj19",
  /** raw funding-tx edge into txExtract input-2 manual-value holder */
  finalTxConcat: "node_qMmh8Zrk",
} as const;

let introGraphCache: { nodes: FlowNode[]; edges: Edge[] } | null = null;

/**
 * Mirrors handleFileSelect's normalization order on an EMPTY canvas
 * (same pipeline as src/lib/__tests__/calcGraphCanonical.test.ts):
 * validate → importWithFreshIds(collision) → ingestScriptSteps →
 * stripLegacyFlowMapNodeData → orphan-edge filter. With an empty canvas
 * the collision rename mode keeps the lesson's original node ids.
 */
export function loadIntroFlowGraph(): { nodes: FlowNode[]; edges: Edge[] } {
  if (!introGraphCache) {
    const fullPath = path.resolve(
      process.cwd(),
      "src/my_tx_flows/p0_Intro_P2PKH.json"
    );
    const flow = JSON.parse(fs.readFileSync(fullPath, "utf8")) as FlowData;
    if (flow.schemaVersion === undefined) {
      flow.schemaVersion = FLOW_SCHEMA_VERSION;
    }
    const validation = validateFlowData(flow);
    if (!validation.ok) {
      throw new Error(
        `intro flow failed validation: ${JSON.stringify(validation.errors)}`
      );
    }

    const { nodes: mergedNodes, edges: mergedEdges } = importWithFreshIds<
      FlowNode,
      Edge
    >({
      currentNodes: [],
      currentEdges: [],
      importNodes: stripLegacyFlowMapNodeData(flow.nodes),
      importEdges: flow.edges,
      dedupeEdges: true,
      renameMode: "collision",
      remapGroupBundleOffsets: true,
    });

    const sanitizedNodes = stripLegacyFlowMapNodeData(
      ingestScriptSteps(mergedNodes)
    ).map((node) => ({ ...node, selected: false }));
    const nodeIds = new Set(sanitizedNodes.map((node) => node.id));
    const safeEdges = mergedEdges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );

    introGraphCache = { nodes: sanitizedNodes, edges: safeEdges };
  }

  return structuredClone(introGraphCache);
}

/* ────────────────────────────────────────────────────────────────────────
 * MSW capture for /bulk_calculate
 * ──────────────────────────────────────────────────────────────────────── */

export interface CapturedCalcNode {
  id: string;
  type?: string;
  parentId?: string;
  data: NodeData & Record<string, unknown>;
  [key: string]: unknown;
}

export interface CapturedCalcBody {
  nodes: CapturedCalcNode[];
  edges: Edge[];
  version: number;
}

export interface CalcCapture {
  bodies: CapturedCalcBody[];
}

type CalcResponder = (
  body: CapturedCalcBody
) => Response | Promise<Response>;

export const echoCalcResponse = (body: CapturedCalcBody): Response =>
  HttpResponse.json({ nodes: body.nodes, version: body.version, errors: [] });

/**
 * Installs a capturing /bulk_calculate handler. Default behavior echoes the
 * request nodes back (committed results survive untouched). Pass a custom
 * responder for error/result-application scenarios.
 */
export function installCalcCapture(respond?: CalcResponder): CalcCapture {
  const capture: CalcCapture = { bodies: [] };
  server.use(
    http.post("*/bulk_calculate", async ({ request }) => {
      const body = (await request.json()) as CapturedCalcBody;
      capture.bodies.push(body);
      return respond ? respond(body) : echoCalcResponse(body);
    })
  );
  return capture;
}

export function payloadNode(
  body: CapturedCalcBody,
  nodeId: string
): CapturedCalcNode {
  const node = body.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(
      `node ${nodeId} not present in captured payload (got ${body.nodes
        .map((n) => n.id)
        .join(", ")})`
    );
  }
  return node;
}

export const payloadHasNode = (body: CapturedCalcBody, nodeId: string) =>
  body.nodes.some((candidate) => candidate.id === nodeId);

export const payloadEdgesMatching = (
  body: CapturedCalcBody,
  predicate: (edge: Edge) => boolean
) => body.edges.filter(predicate);

/* ────────────────────────────────────────────────────────────────────────
 * Calc-relevant projection (mirrors calcGraphCanonical.test.ts but is
 * applied to the wire payload). Excludes version + render-only fields so
 * baseline comparisons fail only when calculation inputs change.
 * ──────────────────────────────────────────────────────────────────────── */

const CALC_NODE_DATA_KEYS = [
  "functionName",
  "numInputs",
  "inputs",
  "value",
  "inputStructure",
  "groupInstanceKeys",
  "paramExtraction",
  "selectedNetwork",
  "showField",
  "groupInstances",
  "hasRegenerate",
  "forceRegenerate",
  "opSequenceNames",
  "outputValues",
  "outputPorts",
  "txFieldExtractMode",
  "txExtractFields",
  "taprootLeafIndex",
  "result",
] as const;

export function projectCalcPayload(body: CapturedCalcBody) {
  return {
    nodes: [...body.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => {
        const data: Record<string, unknown> = {};
        for (const key of CALC_NODE_DATA_KEYS) {
          const value = node.data?.[key];
          if (value !== undefined) data[key] = value;
        }
        return {
          id: node.id,
          type: node.type,
          parentId: node.parentId ?? null,
          data,
        };
      }),
    edges: [...body.edges]
      .map((edge) => ({
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? null,
        target: edge.target,
        targetHandle: edge.targetHandle ?? null,
      }))
      .sort((a, b) =>
        `${a.source}|${a.sourceHandle}|${a.target}|${a.targetHandle}`.localeCompare(
          `${b.source}|${b.sourceHandle}|${b.target}|${b.targetHandle}`
        )
      ),
  };
}

/** nodes+edges bytes only — the request `version` counter always increments. */
export const payloadBytesWithoutVersion = (body: CapturedCalcBody) =>
  JSON.stringify({ nodes: body.nodes, edges: body.edges });

/* ────────────────────────────────────────────────────────────────────────
 * Harness component
 * ──────────────────────────────────────────────────────────────────────── */

export interface CalcHarnessHandles {
  getNodes: () => FlowNode[];
  getEdges: () => Edge[];
  getNode: (id: string) => FlowNode;
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  /** production interaction paths (what <ReactFlow> would invoke) */
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  connect: (connection: Connection) => void;
  /** real useLimitErrorRecovery — "retry all": marks every calculable node dirty */
  recalcAll: () => void;
  status: () => string;
  errors: () => CalcError[];
  copyNodes: () => void;
  pasteNodes: (pos: { x: number; y: number }) => void;
  saveFlow: () => void;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** real UndoRedoProvider history */
  initializeHistory: () => void;
  pushHistory: (label: string) => void;
  undo: () => void;
  redo: () => void;
  setRenderIds: (ids: string[]) => void;
}

interface HarnessCoreProps {
  initialNodes: FlowNode[];
  initialEdges: Edge[];
  initialRenderIds: string[];
  debounceMs: number;
  onReady: (handles: CalcHarnessHandles) => void;
}

/**
 * Mimics <ReactFlow>'s StoreUpdater contract on the real provider store:
 * keeps store nodes/edges in sync with the controlled React state and
 * registers onNodesChange/onEdgesChange so useReactFlow().setNodes /
 * setEdges (used by every node mutation hook and by the calc merge) flow
 * through the real BatchProvider diffing back into the controlled state.
 */
function ReactFlowStoreBridge({
  nodes,
  edges,
  onNodesChangeRef,
  onEdgesChangeRef,
}: {
  nodes: FlowNode[];
  edges: Edge[];
  onNodesChangeRef: React.MutableRefObject<
    (changes: NodeChange<FlowNode>[]) => void
  >;
  onEdgesChangeRef: React.MutableRefObject<(changes: EdgeChange[]) => void>;
}) {
  const store = useStoreApi<FlowNode>();

  useEffect(() => {
    store.setState({
      onNodesChange: (changes) =>
        onNodesChangeRef.current(changes as NodeChange<FlowNode>[]),
      onEdgesChange: (changes) => onEdgesChangeRef.current(changes),
    });
  }, [store, onNodesChangeRef, onEdgesChangeRef]);

  useEffect(() => {
    store.getState().setNodes(nodes);
  }, [store, nodes]);

  useEffect(() => {
    store.getState().setEdges(edges);
  }, [store, edges]);

  return null;
}

const noop = () => undefined;

function HarnessCore({
  initialNodes,
  initialEdges,
  initialRenderIds,
  debounceMs,
  onReady,
}: HarnessCoreProps) {
  const ops = useNodeOperations();
  const { nodes, setNodes, edges, setEdges } = ops;
  const [renderIds, setRenderIds] = useState<string[]>(initialRenderIds);
  const [seeded, setSeeded] = useState(false);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const statusRef = useRef<string>("OK");
  const errorsRef = useRef<CalcError[]>([]);

  /* seed the graph once (state-level load, like tab restore) */
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSeeded(true);
    // intentionally run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── real undo/redo history ─────────────────────────────────────── */
  const undoRedo = useUndoRedo();
  const undoRedoRef = useRef(undoRedo);
  undoRedoRef.current = undoRedo;
  const skipNextHistoryLoadRef = useRef(false);
  const lastLoadedPtrRef = useRef(undoRedo.pointer);

  useEffect(() => {
    const { pointer, history } = undoRedo;
    if (lastLoadedPtrRef.current === pointer) return;
    lastLoadedPtrRef.current = pointer;
    if (skipNextHistoryLoadRef.current) {
      skipNextHistoryLoadRef.current = false;
      return;
    }
    if (pointer < 0 || pointer >= history.length) return;

    // Mirrors Flow.tsx's history-restore effect: snapshots restore with
    // dirty cleared (undo/redo must not trigger a recalc by itself).
    const snap: GraphSnapshot = history[pointer];
    restoreScriptSteps(snap.scriptSteps ?? []);
    setNodes(
      snap.nodes.map((node) => ({
        ...node,
        data: { ...node.data, dirty: false },
      }))
    );
    setEdges(snap.edges);
  }, [undoRedo, setNodes, setEdges]);

  /* ── refs the interaction hook needs ────────────────────────────── */
  const pendingSnapshotRef = useRef(false);
  const skipNextEdgeSnapshotRef = useRef(false);
  const skipNextNodeRemovalRef = useRef(false);
  const loadingUndoRef = useRef(false);
  const isPastingRef = useRef(false);

  const copyPaste = useCopyPaste({
    getClipboardNodes: () => nodesRef.current,
    getClipboardEdges: () => edgesRef.current,
  });

  const interactions = useFlowInteractions({
    rawOnNodesChange: ops.onNodesChange,
    rawOnEdgesChange: ops.onEdgesChange,
    onConnect: ops.onConnect,
    onDrop: ops.onDrop,
    onNodeDragStop: ops.onNodeDragStop,
    getNodes: () => nodesRef.current,
    getEdges: () => edgesRef.current,
    setNodes: (updater) => setNodes(updater),
    setEdges: (updater) => setEdges(updater),
    scheduleSnapshot: noop,
    pendingSnapshotRef,
    skipNextEdgeSnapshotRef,
    markPendingAfterDirtyChange: noop,
    skipNextNodeRemovalRef,
    releaseNodeRemovalSnapshotSkip: noop,
    loadingUndoRef,
    isPastingRef,
    getTopLeftPosition: () => ({ x: 0, y: 0 }),
    pasteNodes: copyPaste.pasteNodes,
    isSidebarOpen: false,
    setTabTooltip: noop,
    renameTab: noop,
    activeTabId: "tab-1",
    groupSelectedNodes: ops.groupSelectedNodes,
    ungroupSelectedNodes: ops.ungroupSelectedNodes,
    clearHighlights: noop,
    setIsSearchHighlight: noop,
    incRev: () => 1,
    pushCleanState: noop,
    updatePaletteEligibility: noop,
  });

  const interactionsRef = useRef(interactions);
  interactionsRef.current = interactions;

  const onNodesChangeRef = useRef<(changes: NodeChange<FlowNode>[]) => void>(
    () => undefined
  );
  onNodesChangeRef.current = interactions.onNodesChange;
  const onEdgesChangeRef = useRef<(changes: EdgeChange[]) => void>(
    () => undefined
  );
  onEdgesChangeRef.current = interactions.onEdgesChange;

  const fileOps = useFileOperations(
    nodes,
    edges,
    ops.onNodesChange,
    ops.onEdgesChange,
    {
      getNodes: () => nodesRef.current,
      getEdges: () => edgesRef.current,
      getActiveTabTitle: () => "calc-harness",
    }
  );
  const fileOpsRef = useRef(fileOps);
  fileOpsRef.current = fileOps;
  const copyPasteRef = useRef(copyPaste);
  copyPasteRef.current = copyPaste;

  const recalcAll = useLimitErrorRecovery(true, setNodes);
  const recalcAllRef = useRef(recalcAll);
  recalcAllRef.current = recalcAll;

  /* ── the real global calculation engine ─────────────────────────── */
  useGlobalCalculationLogic({
    nodes: seeded ? nodes : [],
    edges: seeded ? edges : [],
    debounceMs,
    onStatusChange: (status, calcErrors = []) => {
      statusRef.current = status;
      errorsRef.current = calcErrors;
    },
  });

  /* ── handles for the test ───────────────────────────────────────── */
  useEffect(() => {
    onReady({
      getNodes: () => nodesRef.current,
      getEdges: () => edgesRef.current,
      getNode: (id: string) => {
        const node = nodesRef.current.find((candidate) => candidate.id === id);
        if (!node) throw new Error(`node ${id} not found in harness state`);
        return node;
      },
      setNodes,
      setEdges,
      onNodesChange: (changes) => interactionsRef.current.onNodesChange(changes),
      onEdgesChange: (changes) => interactionsRef.current.onEdgesChange(changes),
      connect: (connection) =>
        interactionsRef.current.onConnectWithUndo(connection),
      recalcAll: () => recalcAllRef.current(),
      status: () => statusRef.current,
      errors: () => errorsRef.current,
      copyNodes: () => copyPasteRef.current.copyNodes(),
      pasteNodes: (pos) => copyPasteRef.current.pasteNodes(pos),
      saveFlow: () => fileOpsRef.current.saveFlow(),
      handleFileSelect: (event) => fileOpsRef.current.handleFileSelect(event),
      initializeHistory: () => {
        skipNextHistoryLoadRef.current = true;
        undoRedoRef.current.initializeTabHistory(
          "tab-1",
          nodesRef.current,
          edgesRef.current
        );
      },
      pushHistory: (label) => {
        skipNextHistoryLoadRef.current = true;
        undoRedoRef.current.pushState(nodesRef.current, edgesRef.current, label);
      },
      undo: () => undoRedoRef.current.undo(),
      redo: () => undoRedoRef.current.redo(),
      setRenderIds,
    });
  }, [onReady, setNodes, setEdges]);

  const canonicalGraph = { nodes, edges };

  return (
    <CanonicalGraphContext.Provider value={canonicalGraph}>
      <ReactFlowStoreBridge
        nodes={nodes}
        edges={edges}
        onNodesChangeRef={onNodesChangeRef}
        onEdgesChangeRef={onEdgesChangeRef}
      />
      {renderIds.map((id) => {
        const node = nodes.find((candidate) => candidate.id === id);
        if (!node) return null;
        return (
          <div key={id} data-testid={`node-host-${id}`}>
            <CalculationNode {...buildNodeProps(node)} />
          </div>
        );
      })}
    </CanonicalGraphContext.Provider>
  );
}

function HarnessRoot(props: HarnessCoreProps) {
  return (
    <ThemeProvider defaultTheme="light">
      <UndoRedoProvider>
        <SnapshotProvider scheduler={createSnapshotScheduler()}>
          <ReactFlowProvider>
            <HarnessCore {...props} />
          </ReactFlowProvider>
        </SnapshotProvider>
      </UndoRedoProvider>
    </ThemeProvider>
  );
}

export interface CalcHarness extends CalcHarnessHandles {
  view: RenderResult;
}

export interface RenderCalcHarnessOptions {
  nodes: FlowNode[];
  edges: Edge[];
  renderIds?: string[];
  debounceMs?: number;
}

export async function renderCalcHarness({
  nodes,
  edges,
  renderIds = [],
  debounceMs = 20,
}: RenderCalcHarnessOptions): Promise<CalcHarness> {
  const handlesRef: { current: CalcHarnessHandles | null } = { current: null };

  let view!: RenderResult;
  await act(async () => {
    view = render(
      <HarnessRoot
        initialNodes={nodes}
        initialEdges={edges}
        initialRenderIds={renderIds}
        debounceMs={debounceMs}
        onReady={(handles) => {
          handlesRef.current = handles;
        }}
      />
    );
  });

  await waitFor(() => expect(handlesRef.current).not.toBeNull());
  const handles = handlesRef.current as CalcHarnessHandles;
  await waitFor(() =>
    expect(handles.getNodes().length).toBe(nodes.length)
  );

  return new Proxy({} as CalcHarness, {
    get(_target, prop) {
      if (prop === "view") return view;
      return (handlesRef.current as CalcHarnessHandles)[
        prop as keyof CalcHarnessHandles
      ];
    },
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * Settled payload capture
 * ──────────────────────────────────────────────────────────────────────── */

export const hasDirtyCalculableNodes = (harness: CalcHarnessHandles) =>
  harness
    .getNodes()
    .some((node) => isCalculableNode(node) && node.data?.dirty === true);

export async function waitForCalcIdle(harness: CalcHarnessHandles) {
  await waitFor(
    () => {
      expect(hasDirtyCalculableNodes(harness)).toBe(false);
    },
    { timeout: 8000 }
  );
  // flush trailing microtasks (merge → setNodes → effects)
  await act(async () => {});
}

/**
 * Wraps a plain (non-userEvent) state mutation in act. userEvent calls
 * must NOT be wrapped — they manage act themselves, and an outer act
 * defers the ReactFlow BatchProvider layout-effect flush.
 */
export async function mutate(fn: () => void) {
  await act(async () => {
    fn();
  });
}

/**
 * Settled capture: runs `action`, then waits until at least one NEW
 * /bulk_calculate request was issued AND the graph reached idle (no dirty
 * calculable nodes left). Returns the LAST captured request body — never
 * "first request wins".
 *
 * `action` runs UNWRAPPED: pass userEvent interactions directly; wrap raw
 * harness mutations with `mutate(...)` inside the action.
 */
export async function captureCalcPayload(
  harness: CalcHarnessHandles,
  capture: CalcCapture,
  action: () => void | Promise<void>
): Promise<CapturedCalcBody> {
  const before = capture.bodies.length;
  await action();
  await act(async () => {});
  await waitFor(
    () => {
      expect(capture.bodies.length).toBeGreaterThan(before);
      expect(hasDirtyCalculableNodes(harness)).toBe(false);
    },
    { timeout: 8000 }
  );
  await act(async () => {});
  return capture.bodies[capture.bodies.length - 1];
}

/**
 * Full-graph settled capture via the real "retry all" recovery path.
 * Used to produce comparable golden payloads (baseline vs restored state).
 */
export async function captureRecalcAllPayload(
  harness: CalcHarnessHandles,
  capture: CalcCapture
): Promise<CapturedCalcBody> {
  return captureCalcPayload(harness, capture, () =>
    mutate(() => harness.recalcAll())
  );
}

/**
 * Captures the stable full-graph baseline: one warm-up recalc round (the
 * first round normalizes error/dirty bookkeeping on freshly imported
 * nodes), then the comparable golden capture.
 */
export async function captureStableBaseline(
  harness: CalcHarnessHandles,
  capture: CalcCapture
): Promise<CapturedCalcBody> {
  await captureRecalcAllPayload(harness, capture);
  return captureRecalcAllPayload(harness, capture);
}

/* ────────────────────────────────────────────────────────────────────────
 * DOM helpers for CalculationNodeView controls
 * ──────────────────────────────────────────────────────────────────────── */

export function nodeHost(view: RenderResult, nodeId: string): HTMLElement {
  return view.getByTestId(`node-host-${nodeId}`);
}

/** EditableLabel renders labels as "> {label}". */
function findLabelElement(host: HTMLElement, label: string): HTMLElement {
  return within(host).getByText(`> ${label}`);
}

/** The textarea belonging to a labeled field (TerminalField markup). */
export function fieldTextarea(
  host: HTMLElement,
  label: string
): HTMLTextAreaElement {
  const labelEl = findLabelElement(host, label);
  const fieldRoot = labelEl.parentElement?.parentElement;
  const textarea = fieldRoot?.querySelector("textarea");
  if (!textarea) throw new Error(`no textarea found for field '${label}'`);
  return textarea as HTMLTextAreaElement;
}

/** The sentinel checkbox (00 / Ø / null) rendered next to a field label. */
export function fieldCheckbox(host: HTMLElement, label: string): HTMLElement {
  const labelEl = findLabelElement(host, label);
  const labelRow = labelEl.parentElement;
  if (!labelRow) throw new Error(`no label row for field '${label}'`);
  return within(labelRow as HTMLElement).getByRole("checkbox");
}

/** GroupSection header +/- controls (decrement rendered first). */
export function groupControls(
  host: HTMLElement,
  groupTitle: string
): { minus: HTMLButtonElement; plus: HTMLButtonElement } {
  const titleEl = findLabelElement(host, groupTitle);
  const header = titleEl.parentElement;
  if (!header) throw new Error(`no group header for '${groupTitle}'`);
  const buttons = within(header as HTMLElement).getAllByRole("button");
  if (buttons.length !== 2) {
    throw new Error(
      `expected 2 group-size buttons for '${groupTitle}', got ${buttons.length}`
    );
  }
  return {
    minus: buttons[0] as HTMLButtonElement,
    plus: buttons[1] as HTMLButtonElement,
  };
}

/** Non-readonly textareas inside a host, in DOM order. */
export function editableTextareas(host: HTMLElement): HTMLTextAreaElement[] {
  return Array.from(host.querySelectorAll("textarea")).filter(
    (textarea) => !textarea.readOnly
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Radix pointer polyfills (Select/DropdownMenu need these in jsdom)
 * ──────────────────────────────────────────────────────────────────────── */

let radixPolyfillsInstalled = false;

export function installRadixPointerPolyfills() {
  if (radixPolyfillsInstalled) return;
  radixPolyfillsInstalled = true;

  const proto = Element.prototype as Element & {
    hasPointerCapture?: (pointerId: number) => boolean;
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
    scrollIntoView?: () => void;
  };
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => undefined;
  if (!proto.releasePointerCapture) {
    proto.releasePointerCapture = () => undefined;
  }
  if (!proto.scrollIntoView) proto.scrollIntoView = () => undefined;
}

/* ────────────────────────────────────────────────────────────────────────
 * saveFlow capture (intercepts the download blob)
 * ──────────────────────────────────────────────────────────────────────── */

async function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Runs handles.saveFlow() and returns the JSON the real export produced. */
export async function captureSavedFlowJson(
  harness: CalcHarnessHandles
): Promise<string> {
  const blobs: Blob[] = [];
  const urlCtor = URL as unknown as {
    createObjectURL?: (blob: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
  const originalCreate = urlCtor.createObjectURL;
  const originalRevoke = urlCtor.revokeObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;

  urlCtor.createObjectURL = (blob: Blob) => {
    blobs.push(blob);
    return "blob:calc-harness";
  };
  urlCtor.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = function click() {
    /* suppress jsdom navigation */
  };

  try {
    await act(async () => {
      harness.saveFlow();
    });
  } finally {
    if (originalCreate) urlCtor.createObjectURL = originalCreate;
    else delete urlCtor.createObjectURL;
    if (originalRevoke) urlCtor.revokeObjectURL = originalRevoke;
    else delete urlCtor.revokeObjectURL;
    HTMLAnchorElement.prototype.click = originalClick;
  }

  if (!blobs.length) throw new Error("saveFlow did not produce a download");
  return blobToText(blobs[0]);
}

/** Feeds JSON through the real handleFileSelect import pipeline. */
export async function importFlowJson(
  harness: CalcHarnessHandles,
  json: string,
  expectedNodeCount: number
) {
  const file = new File([json], "roundtrip.json", {
    type: "application/json",
  });
  const event = {
    target: { files: [file] },
  } as unknown as React.ChangeEvent<HTMLInputElement>;

  await act(async () => {
    harness.handleFileSelect(event);
  });
  await waitFor(
    () => expect(harness.getNodes().length).toBe(expectedNodeCount),
    { timeout: 8000 }
  );
  // the import selects every imported node; deselect through the
  // production change path (what a pane click would do)
  const deselect = harness
    .getNodes()
    .filter((node) => node.selected)
    .map((node) => ({
      type: "select" as const,
      id: node.id,
      selected: false,
    }));
  if (deselect.length) {
    await act(async () => {
      harness.onNodesChange(deselect);
    });
  }
}
