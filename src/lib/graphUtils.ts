/****************************************************************************************
 * graph-helpers.ts
 * -----------------------------------------------------------------------------
 *  Front-end utilities for:
 *   • sending (sub-)graphs to the /bulk_calculate back-end
 *   • deriving the minimal “affected sub-graph” when a node becomes dirty
 *   • merging the back-end response back into the full client-side graph
 *   • client-side cycle detection (fast UX feedback before hitting the server)
 *
 *  NOTE: Pure refactor – all exported function *signatures* & *behaviour* are unchanged.
 *****************************************************************************************/

import { Node, Edge } from "@xyflow/react";
import { log } from "@/lib/logConfig";
import type { CalculationNodeData, RecalcResponse } from "@/types";
import { setScriptSteps } from "@/lib/share/scriptStepsCache";
import { measureFlowBytes, formatBytes } from "@/lib/flow/schema";

const DEFAULT_LOCAL_API = "http://localhost:5007";
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

type ResolvedApi = {
  baseUrl: string;
  url: URL;
  forcedLocal: boolean;
  allowRemote: boolean;
  isPageLocal: boolean;
};

function isLocalHost(hostname: string | undefined) {
  if (!hostname) return false;
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

function resolveApiBase(): ResolvedApi {
  const envBase = import.meta.env.VITE_API_BASE_URL || DEFAULT_LOCAL_API;
  const allowRemote =
    (import.meta.env.VITE_ALLOW_REMOTE_API || "")
      .toString()
      .toLowerCase() === "true";
  const isPageLocal =
    typeof window !== "undefined" && isLocalHost(window.location.hostname);

  let baseUrl = envBase;
  let forcedLocal = false;
  try {
    const envUrl = new URL(envBase);
    const isEnvLocal = isLocalHost(envUrl.hostname);
    if (import.meta.env.DEV && isPageLocal && !isEnvLocal && !allowRemote) {
      baseUrl = DEFAULT_LOCAL_API;
      forcedLocal = true;
    }
  } catch {
    baseUrl = DEFAULT_LOCAL_API;
    forcedLocal = true;
  }

  return {
    baseUrl,
    url: new URL(baseUrl),
    forcedLocal,
    allowRemote,
    isPageLocal,
  };
}

type BackendLimits = {
  maxPayloadBytes?: number;
};

const backendLimitsCache = new Map<string, Promise<BackendLimits>>();

async function loadBackendLimits(baseUrl: string): Promise<BackendLimits> {
  if (!backendLimitsCache.has(baseUrl)) {
    backendLimitsCache.set(
      baseUrl,
      (async () => {
        try {
          const res = await fetch(`${baseUrl}/healthz`, {
            headers: { accept: "application/json" },
          });
          if (!res.ok) return {};
          const json = await res.json();
          const limitsBlock = json?.limits ?? {};
          const maxPayload =
            limitsBlock?.maxPayloadBytes ?? json?.maxPayloadBytes;

          return {
            maxPayloadBytes:
              typeof maxPayload === "number" ? maxPayload : undefined,
          };
        } catch {
          return {};
        }
      })()
    );
  }
  return backendLimitsCache.get(baseUrl)!;
}
function annotateDirtyNodesWithError(
  nodes: Node<CalculationNodeData>[],
  message: string
): Node<CalculationNodeData>[] {
  return nodes.map((node) => {
    if (!node.data?.dirty) return node;
    return { ...node, data: { ...node.data, error: true, extendedError: message } };
  });
}

function stripNodeForBackend(
  node: Node<CalculationNodeData>
): Node<CalculationNodeData> {
  if (!node.data) return node;

  const dataClone: CalculationNodeData & Record<string, unknown> = {
    ...node.data,
  };

  // Remove heavy, UI-only fields that the calculation service does not need.
  delete dataClone.extendedError;
  delete dataClone.scriptDebugSteps;
  delete dataClone.scriptSteps;
  delete dataClone.taprootTree;
  delete dataClone.banner;
  delete dataClone.tooltip;
  delete dataClone.comment;
  delete dataClone.showComment;
  delete dataClone.searchMark;
  delete dataClone.groupFlash;

  return {
    ...node,
    data: dataClone,
  };
}

const PAYLOAD_LIMIT_NODE_ID = "__payload_limit__";

/* ════════════════════════════════════════════════════════════════════════
 * Section 1 – I/O: call the back-end
 * ════════════════════════════════════════════════════════════════════════*/

/**
 * POST the given (sub-)graph to the Python API and pass the response through.
 */
export async function recalculateGraph(
  nodes: Node<CalculationNodeData>[],
  edges: Edge[],
  version: number
): Promise<RecalcResponse> {
  log("flow", `Sending ${nodes.length} nodes to backend`);

  const api = resolveApiBase();
  if (api.forcedLocal) {
    log(
      "flow",
      `Overriding remote API_BASE_URL with local default (${DEFAULT_LOCAL_API})`
    );
  }

  const backendLimits = await loadBackendLimits(api.baseUrl);

  const payloadNodes = nodes.map(stripNodeForBackend);
  const payload = { nodes: payloadNodes, edges, version };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = measureFlowBytes(payloadJson);

  const { maxPayloadBytes } = backendLimits;
  if (maxPayloadBytes && payloadBytes > maxPayloadBytes) {
    const limitMessage = `Request is ${formatBytes(
      payloadBytes
    )}, over the server limit (${formatBytes(maxPayloadBytes)}).`;
    return {
      nodes: annotateDirtyNodesWithError(nodes, limitMessage),
      version,
      errors: [{ nodeId: PAYLOAD_LIMIT_NODE_ID, error: limitMessage }],
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${api.baseUrl}/bulk_calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payloadJson,
      signal: controller.signal,
    });

    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Invalid response from server (status: ${res.status})`);
    }

    return {
      nodes: json.nodes || nodes,
      version: json.version || version,
      errors: res.ok ? [] : json.errors ?? [],
    };
  } catch (error: unknown) {
    console.error("Backend error:", error);

    const isTimeout =
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError";
    const message = isTimeout
      ? "Calculation timed out after 5 s. Update any input in this flow to trigger another run."
      : isLocalHost(api.url.hostname)
      ? "Backend not running. Start it with: python routes.py"
      : "Cannot connect to calculation service. Please try again later.";

    return {
      nodes: annotateDirtyNodesWithError(nodes, message),
      version: version,
      errors: [], // No system error - the node errors are enough
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * Section 2 – graph traversal helpers
 * ════════════════════════════════════════════════════════════════════════*/

/** Build `source → [targets]` adjacency list. */
function buildAdjacencyForward(edges: Edge[]): Record<string, string[]> {
  const adj: Record<string, string[]> = {};
  edges.forEach((e) => {
    (adj[e.source] ??= []).push(e.target);
  });
  return adj;
}

/** Build `target → [sources]` adjacency list. */
function buildAdjacencyReverse(edges: Edge[]): Record<string, string[]> {
  const adj: Record<string, string[]> = {};
  edges.forEach((e) => {
    (adj[e.target] ??= []).push(e.source);
  });
  return adj;
}

function edgesSignature(edges: Edge[]): string {
  return edges
    .map(
      (e) =>
        `${e.source}->${e.target}:${e.sourceHandle ?? ""}:${
          e.targetHandle ?? ""
        }`
    )
    .sort()
    .join("|");
}

let cachedAdjSignature: string | null = null;
let cachedForwardAdj: Record<string, string[]> = {};
let cachedReverseAdj: Record<string, string[]> = {};

/**
 * Generic **breadth-first search**.
 * @param startIds   set of seed node-ids
 * @param adjacency  function  id → neighbours[]
 */
function bfs(
  startIds: Set<string>,
  adjacency: Record<string, string[]>
): Set<string> {
  const visited = new Set<string>(startIds);
  const queue = [...startIds];

  while (queue.length) {
    const curr = queue.shift()!;
    for (const neigh of adjacency[curr] ?? []) {
      if (!visited.has(neigh)) {
        visited.add(neigh);
        queue.push(neigh);
      }
    }
  }
  return visited;
}

/* ════════════════════════════════════════════════════════════════════════
 * Section 3 – derive minimal sub-graph that needs recalculation
 * ════════════════════════════════════════════════════════════════════════*/

/**
 * Returns the smallest set of nodes/edges required so the back-end can
 * safely recalculate every node whose `.data.dirty === true` (optionally
 * restricted to a provided subset of node IDs).
 *
 *  – downstream of dirty → required (they use the new result)
 *  – upstream of dirty   → required (so every input is present)
 *  – special-case `concat_all`: it needs *all* its inputs, even if only
 *    one branch changed, therefore we expand once more until complete.
 */
export function getAffectedSubgraph(
  fullNodes: Node<CalculationNodeData>[],
  fullEdges: Edge[],
  options?: { eligibleNodeIds?: Set<string> }
): { affectedNodes: Node<CalculationNodeData>[]; affectedEdges: Edge[] } {
  const { eligibleNodeIds } = options ?? {};
  const dirtyNodes = fullNodes.filter(
    (n) =>
      n.data?.dirty && (!eligibleNodeIds || eligibleNodeIds.has(n.id))
  );
  if (!dirtyNodes.length) return { affectedNodes: [], affectedEdges: [] };

  /* ---- one-time adjacency maps ------------------------------------------------ */
  const signature = edgesSignature(fullEdges);
  if (signature !== cachedAdjSignature) {
    cachedForwardAdj = buildAdjacencyForward(fullEdges);
    cachedReverseAdj = buildAdjacencyReverse(fullEdges);
    cachedAdjSignature = signature;
  }
  const forward = cachedForwardAdj;
  const reverse = cachedReverseAdj;

  /* ---- helper that unions upstream + downstream -------------------------------- */
  // NOTE: `eligibleNodeIds` only limits the initial dirty seeds. Once seeded we must
  // traverse the *full* forward adjacency so downstream dependants get recomputed.
  const buildClosure = (seeds: Set<string>) => {
    const up = bfs(seeds, reverse);
    const down = bfs(seeds, forward);
    return new Set([...up, ...down]);
  };

  /* ---- main expansion loop ----------------------------------------------------- */
  const seedIds = new Set(dirtyNodes.map((n) => n.id));
  let affected = buildClosure(seedIds);
  let changed = true;

  while (changed) {
    changed = false;

    // any concat_all inside current set?
    const concatNodes = fullNodes.filter(
      (n) =>
        affected.has(n.id) &&
        (n.data?.functionName ?? "").toLowerCase() === "concat_all"
    );

    for (const node of concatNodes) {
      // make sure *every* of its inputs is part of the seed set
      fullEdges
        .filter((e) => e.target === node.id)
        .forEach((e) => {
          if (!affected.has(e.source)) {
            seedIds.add(e.source);
            changed = true;
          }
        });
    }

    if (changed) affected = buildClosure(seedIds);
  }

  /* ---- slice the original graph objects back out ------------------------------ */
  const affectedNodes = fullNodes.filter((n) => affected.has(n.id));
  const affectedEdges = fullEdges.filter(
    (e) => affected.has(e.source) && affected.has(e.target)
  );

  return { affectedNodes, affectedEdges };
}

/* ════════════════════════════════════════════════════════════════════════
 * Section 4 – merge back-end results back into the client graph
 * ════════════════════════════════════════════════════════════════════════*/

/**
 * Integrate the nodes returned by /bulk_calculate into the full
 * client-side graph, clearing `.dirty` flags and propagating errors.
 */
export function mergePartialResultsIntoFullGraph(
  fullNodes: Node<CalculationNodeData>[],
  updatedNodes: Node<CalculationNodeData>[],
  errors?: { nodeId: string; error: string }[]
) {
  const updatedMap = new Map(updatedNodes.map((n) => [n.id, n]));
  const errorMap = new Map(errors?.map((e) => [e.nodeId, e.error]));

  return fullNodes.map((old) => {
    const fresh = updatedMap.get(old.id);
    if (!fresh) return old;

    const mergedError = errorMap.has(old.id) || Boolean(fresh.data.error);
    const mergedExtendedError =
      errorMap.get(old.id) ?? fresh.data.extendedError;
    const isScriptVerificationNode =
      old.data?.functionName === "script_verification";

    const merged = {
      ...old,
      data: {
        ...old.data, // ← existing keys
        ...fresh.data, // ← new data from API (may *lack* some keys)
        dirty: false,
        error: mergedError,
        extendedError: mergedExtendedError,
      },
    };

    /* --- make the flag one-shot --- */
    delete merged.data.forceRegenerate;
    const freshSteps = fresh.data?.scriptDebugSteps;
    if (freshSteps !== undefined) {
      setScriptSteps(old.id, freshSteps);
    } else if (isScriptVerificationNode && mergedError) {
      setScriptSteps(old.id, null);
    }
    if (merged.data) {
      delete merged.data.scriptDebugSteps;
      delete merged.data.scriptSteps;
      if (isScriptVerificationNode && mergedError) {
        delete merged.data.result;
      }
    }

    return merged;
  });
}

/* ════════════════════════════════════════════════════════════════════════
 * Section 5 – client-side cycle check (UX nicety)
 * ════════════════════════════════════════════════════════════════════════*/

/**
 * Lightweight topological-sort check on the *affected* sub-graph.
 * Flags cycles instantly so the user doesn’t have to wait for the API
 * to complain.
 *
 * @returns `true` if a cycle was found (and nodes were marked with errors)
 */
export function checkForCyclesAndMarkErrors(
  affectedNodes: Node<CalculationNodeData>[],
  affectedEdges: Edge[]
): boolean {
  /* --- build adjacency / in-degree ------------------------------------------- */
  const adj: Record<string, string[]> = {};
  const inDeg: Record<string, number> = {};

  for (const n of affectedNodes) {
    adj[n.id] = [];
    inDeg[n.id] = 0;
  }
  for (const e of affectedEdges) {
    adj[e.source].push(e.target);
    inDeg[e.target] = (inDeg[e.target] ?? 0) + 1;
  }

  /* --- Kahn’s algorithm ------------------------------------------------------- */
  const queue = Object.keys(inDeg).filter((id) => inDeg[id] === 0);
  let processed = 0;

  while (queue.length) {
    const curr = queue.shift()!;
    processed++;
    for (const nb of adj[curr]) {
      if (--inDeg[nb] === 0) queue.push(nb);
    }
  }

  /* --- mark error if not all processed --------------------------------------- */
  const hasCycle = processed !== affectedNodes.length;
  if (hasCycle) {
    affectedNodes.forEach((n) => {
      n.data.error = true;
      n.data.extendedError =
        "Cycle detected in this sub-graph – calculation aborted.";
    });
  }
  return hasCycle;
}
