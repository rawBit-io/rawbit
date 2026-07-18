import type { Edge } from "@xyflow/react";

import { normalizeHandle } from "@/lib/flow/edgeNormalization";
import {
  renderedInputHandleIds,
  renderedOutputHandleIds,
} from "@/lib/nodes/renderedHandles";
import type { FlowNode } from "@/types";

export interface PruneDanglingEdgesResult {
  edges: Edge[];
  removed: Edge[];
}

/**
 * Drop edges that reference a handle which no longer exists on the connected
 * node.
 *
 * This happens when a grouped node (e.g. a transaction template) is shrunk so
 * that a group instance's handles disappear, but an edge to one of those
 * handles is left behind — the classic case being "copy-paste a 2-output
 * transaction, then reduce the template to one output". React Flow cannot
 * anchor such an edge to a missing handle, so it renders the edge against the
 * node origin (looking like a spurious connection straight to the group) and
 * the node lights up whenever the edge participates in selection.
 *
 * Handle validity is derived from {@link buildPorts} — the same source of truth
 * the renderer and the Connect dialog use — so a pruned edge is one that
 * genuinely has no handle to attach to and carries no data. We never drop an
 * edge we cannot prove is dangling: edges whose handle is absent/empty (the
 * legacy default handle) are kept, as are edges on nodes whose ports cannot be
 * enumerated.
 */
/**
 * Resolves rendered handle ids per node with memoisation. Shared by
 * {@link pruneDanglingEdges} and {@link makeEdgeIsLive} so every dangling-edge
 * decision — pruning AND input-occupancy — uses one definition of "live".
 */
export function makeHandleResolver(nodes: FlowNode[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const inputHandleCache = new Map<string, Set<string>>();
  const outputHandleCache = new Map<string, Set<string>>();

  const handlesFor = (nodeId: string, kind: "input" | "output"): Set<string> => {
    const cache = kind === "input" ? inputHandleCache : outputHandleCache;
    const cached = cache.get(nodeId);
    if (cached) return cached;

    const node = nodeById.get(nodeId);
    const handles = node
      ? kind === "input"
        ? renderedInputHandleIds(node)
        : renderedOutputHandleIds(node)
      : new Set<string>();
    cache.set(nodeId, handles);
    return handles;
  };

  return { nodeById, handlesFor };
}

/**
 * True when neither endpoint of the edge is dangling — i.e. the render
 * projection would draw it. An edge is dead when a node it references exists
 * but the specific handle it targets no longer does. Mirrors
 * {@link pruneDanglingEdges}'s per-edge test exactly; conservative in the same
 * way (empty/legacy handles and un-enumerable ports are treated as live).
 */
export function edgeIsLive(
  edge: Edge,
  nodeById: Map<string, FlowNode>,
  handlesFor: (nodeId: string, kind: "input" | "output") => Set<string>
): boolean {
  const targetHandle = normalizeHandle(edge.targetHandle);
  if (targetHandle !== undefined && nodeById.has(edge.target)) {
    const valid = handlesFor(edge.target, "input");
    if (valid.size > 0 && !valid.has(targetHandle)) return false;
  }

  const sourceHandle = normalizeHandle(edge.sourceHandle);
  if (sourceHandle !== undefined && nodeById.has(edge.source)) {
    const valid = handlesFor(edge.source, "output");
    if (valid.size > 0 && !valid.has(sourceHandle)) return false;
  }

  return true;
}

/**
 * Build an `edgeIsLive(edge)` predicate bound to a node set — the occupancy
 * checks' entry point. One resolver is shared across every edge tested.
 */
export function makeEdgeIsLive(nodes: FlowNode[]): (edge: Edge) => boolean {
  const { nodeById, handlesFor } = makeHandleResolver(nodes);
  return (edge: Edge) => edgeIsLive(edge, nodeById, handlesFor);
}

export function pruneDanglingEdges(
  nodes: FlowNode[],
  edges: Edge[]
): PruneDanglingEdgesResult {
  if (!edges.length) return { edges, removed: [] };

  const { nodeById, handlesFor } = makeHandleResolver(nodes);

  const removed: Edge[] = [];
  const kept = edges.filter((edge) => {
    if (edgeIsLive(edge, nodeById, handlesFor)) return true;
    removed.push(edge);
    return false;
  });

  return removed.length ? { edges: kept, removed } : { edges, removed: [] };
}
