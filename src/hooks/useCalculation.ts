// src/hooks/useCalculation.ts
// ════════════════════════════════════════════════════════════════════════
// Responsibilities
// ----------------------------------------------------------------------
//   • GLOBAL hook  –  watches the *entire* flow for `data.dirty` flags,
//                    debounces, sends only the affected sub-graph to the
//                    backend, merges results, updates status banner.
//   • NODE hook    –  tiny helper for the node UI.  Right now it only
//                    does something special for
//                       – identity   (single editable value)
//                       – concat_all (multi-value read-only display)
//                    All logic is UI-side; no network calls here.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";

import {
  CALCULATION_REQUEST_TIMEOUT_MESSAGE,
  recalculateGraph,
  getAffectedSubgraph,
  mergePartialResultsIntoFullGraph,
  checkForCyclesAndMarkErrors,
} from "@/lib/graphUtils";
import { isCalculableNode } from "@/lib/flow/nonCalculableNodes";
import { normalizeAndDedupeEdgeConnections } from "@/lib/flow/edgeNormalization";
import { log } from "@/lib/logConfig";
import type {
  UseNodeCalculationLogicProps,
  UseGlobalCalculationLogicProps,
  FlowNode,
  CalcError,
} from "@/types";

/* ────────────────────────────────────────────────────────────
   1.  GLOBAL CALCULATION HOOK
   ─   Debounce + partial-recalc pipeline (backend round-trip)
   ─────────────────────────────────────────────────────────── */
export function useGlobalCalculationLogic({
  nodes,
  edges,
  debounceMs = 500,
  onStatusChange,
}: UseGlobalCalculationLogicProps) {
  const { setNodes } = useReactFlow<FlowNode>();

  /* refs that outlive renders */
  const timeoutRef = useRef<number | null>(null);
  const versionRef = useRef<number>(0); // optimistic concurrency
  const prevDirtyRef = useRef<boolean>(false);
  const onStatusChangeRef = useRef(onStatusChange);
  const effectRunRef = useRef(0);
  onStatusChangeRef.current = onStatusChange; // keep fresh

  /* helper: merge backend + local errors */
  const buildErrorArray = (bErrors: CalcError[] = [], n: FlowNode[]) => {
    const localErrors: CalcError[] = n
      .filter((nd) => nd.data?.extendedError || nd.data?.error)
      .map((nd) => ({
        nodeId: nd.id,
        error: String(
          nd.data?.extendedError ?? nd.data?.error ?? "Unknown error"
        ),
      }));

    return [
      ...bErrors,
      ...localErrors.filter(
        (le) => !bErrors.some((be) => be.nodeId === le.nodeId)
      ),
    ];
  };

  /* watch nodes/edges every render */
  useEffect(() => {
    const runId = ++effectRunRef.current;
    let cancelled = false;
    const isCurrentRun = () => !cancelled && runId === effectRunRef.current;

    const dirtyNodes = nodes.filter(
      (n) => n.data?.dirty && isCalculableNode(n)
    );
    const anyDirty = dirtyNodes.length > 0;
    log("debounce", `dirtyNodes? ${anyDirty}`);

    if (!anyDirty) {
      if (prevDirtyRef.current) {
        const mergedErrors = buildErrorArray([], nodes);
        onStatusChangeRef.current?.(
          mergedErrors.length ? "ERROR" : "OK",
          mergedErrors
        );
        prevDirtyRef.current = false;
      }
      return;
    }

    const eligibleIds = new Set(dirtyNodes.map((node) => node.id));

    if (!prevDirtyRef.current) onStatusChangeRef.current?.("CALC");
    prevDirtyRef.current = true;

    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);

    timeoutRef.current = window.setTimeout(async () => {
      if (!isCurrentRun()) return;
      log("debounce", "Debounce elapsed, preparing partial recalc…");
      const myVersion = ++versionRef.current;

      /* 1) which sub-graph changed? */
      const subgraphOptions = { eligibleNodeIds: eligibleIds };
      const { affectedNodes, affectedEdges: rawAffectedEdges } =
        getAffectedSubgraph(nodes, edges, subgraphOptions);
      // The persisted graph is always deduped (saveTabData), but the live edge
      // state can transiently hold a structural duplicate — e.g. Safari's
      // shared-import store-resync repair re-applying edges mid-recalc. Sending
      // those to the backend yields "Multiple cables connected to input N",
      // which keeps the nodes dirty and re-fires the recalc (the long "CALC").
      // Dedupe by connection here, exactly as the save path does.
      const affectedEdges = normalizeAndDedupeEdgeConnections(rawAffectedEdges);
      if (affectedNodes.length === 0) {
        if (!isCurrentRun()) return;
        const mergedErrors = buildErrorArray([], nodes);
        onStatusChangeRef.current?.(
          mergedErrors.length ? "ERROR" : "OK",
          mergedErrors
        );
        prevDirtyRef.current = false;
        return;
      }

      /* 2) client-side cycle detection (fast fail) */
      const hasCycle = checkForCyclesAndMarkErrors(
        affectedNodes,
        affectedEdges
      );
      if (hasCycle) {
        log("debounce", "Cycle detected → mark subgraph as error");
        if (!isCurrentRun()) return;
        const cycleMessage =
          "Cycle detected in this sub-graph – calculation aborted.";
        const affectedIds = new Set(affectedNodes.map((n) => n.id));
        setNodes((nds) =>
          nds.map((n) =>
            affectedIds.has(n.id)
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    error: true,
                    dirty: false,
                    extendedError: cycleMessage,
                  },
                }
              : n
          )
        );
        const existingErrors = buildErrorArray([], nodes).filter(
          (err) => !affectedIds.has(err.nodeId)
        );
        const cycleErrors = affectedNodes.map((n) => ({
          nodeId: n.id,
          error: cycleMessage,
        }));
        const mergedErrors = [...existingErrors, ...cycleErrors];
        onStatusChangeRef.current?.("ERROR", mergedErrors);
        prevDirtyRef.current = false;
        return;
      }

      /* 3) backend round-trip */
      try {
        const {
          nodes: recalcNodes,
          version,
          errors: backendErrors = [],
        } = await recalculateGraph(affectedNodes, affectedEdges, myVersion);

        if (!isCurrentRun()) return;

        /* stale response? ignore */
        if (version !== versionRef.current) {
          log(
            "debounce",
            `Ignoring outdated results (client ${versionRef.current} vs resp ${version})`
          );
          const mergedErrors = buildErrorArray([], nodes);
          onStatusChangeRef.current?.(
            mergedErrors.length ? "ERROR" : "OK",
            mergedErrors
          );
          prevDirtyRef.current = false;
          return;
        }

        /* merge partial update into full graph */
        const merged = mergePartialResultsIntoFullGraph(
          nodes,
          recalcNodes,
          backendErrors
        );
        setNodes(merged);

        const allErrors = buildErrorArray(backendErrors, merged);
        onStatusChangeRef.current?.(
          allErrors.length ? "ERROR" : "OK",
          allErrors
        );
        prevDirtyRef.current = false;
      } catch (err: unknown) {
        if (!isCurrentRun()) return;

        /* network / unexpected error → mark dirty nodes as error */
        log("debounce", "Unknown error in recalc", { err });
        const isAbort =
          typeof err === "object" &&
          err !== null &&
          "name" in err &&
          (err as { name?: unknown }).name === "AbortError";
        const fallbackMessage = isAbort
          ? CALCULATION_REQUEST_TIMEOUT_MESSAGE
          : "Calculation failed. Adjust the flow and try again.";

        const dirtyIds = new Set(
          nodes.filter((n) => n.data?.dirty).map((n) => n.id)
        );

        const nextNodes = nodes.map((n) => {
          if (!dirtyIds.has(n.id)) return n;
          return {
            ...n,
            data: {
              ...n.data,
              error: true,
              dirty: false,
              extendedError: fallbackMessage,
            },
          };
        });

        setNodes(nextNodes);

        const mergedErrors = buildErrorArray([], nextNodes);
        if (mergedErrors.length === 0) {
          mergedErrors.push({ nodeId: "__flow__", error: fallbackMessage });
        }

        onStatusChangeRef.current?.("ERROR", mergedErrors);
        prevDirtyRef.current = false;
      }
    }, debounceMs);

    /* cleanup if deps change or component unmounts */
    return () => {
      cancelled = true;
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [nodes, edges, setNodes, debounceMs]);
}

/* ────────────────────────────────────────────────────────────
   2.  NODE-LEVEL HOOK
   ─   Returns UI helpers for a single node (identity / concat_all)
   ─────────────────────────────────────────────────────────── */
export function useNodeCalculationLogic({
  id,
  data,
  setNodes,
}: UseNodeCalculationLogicProps) {
  /* identity nodes are editable, everything else read-only */
  const isIdentity = data.functionName === "identity";
  const isConcatAll = data.isConcatAll === true;
  const numInputs = data.numInputs ?? 1;

  /* When a cable is attached we store upstream value in inputs.val.
     Keep showing that value even if the user later deletes the cable */
  const upstreamVal =
    typeof data.inputs?.val === "string"
      ? (data.inputs.val as string)
      : undefined;

  const displayValue = upstreamVal ?? (data.value as string) ?? "";

  /* user edits the single input field on an identity node */
  const handleChange = (newValue: string) => {
    if (!isIdentity) return;

    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                value: newValue,
                inputs: { ...(node.data.inputs || {}), val: newValue },
                dirty: true, // recalc needed
                error: false, // clear existing error while typing
              },
            }
          : node
      )
    );
  };

  /* expose to node components */
  return {
    isIdentity,
    isConcatAll,
    numInputs,
    value: displayValue,
    result: data.result,
    error: data.error,
    handleChange,
  };
}
