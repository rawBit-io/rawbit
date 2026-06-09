/**
 * idUtils.ts — smart import with collision-only renaming option
 * - "always" mode: always generate new IDs (default, for backward compatibility)
 * - "collision" mode: only rename IDs that actually conflict
 * - Properly remaps all references (parentId, edges, etc.)
 */

import { normalizeHandle } from "@/lib/flow/edgeNormalization";

export type NodeLike = {
  id: string;
  parentId?: string;
  parentNode?: string;
  /** Some sources use "group" for parenting; we'll remap that too if present. */
  group?: string;
} & Record<string, unknown>;

export type EdgeLike = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
} & Record<string, unknown>;

export type ImportArgs<
  N extends NodeLike,
  E extends EdgeLike
> = {
  currentNodes: readonly N[];
  currentEdges?: readonly E[];
  importNodes: readonly N[];
  importEdges: readonly E[];
  /** Skip adding an edge if an identical (src/handle/target/handle) already exists. */
  dedupeEdges?: boolean; // default: true
  /** Controls how imported IDs are handled */
  renameMode?: "always" | "collision"; // default: "always"
};

export type ImportResult<N extends NodeLike, E extends EdgeLike> = {
  nodes: N[];
  edges: E[];
  /** Old node ID -> new node ID mapping (useful for post-processing). */
  idMap: Map<string, string>;
};

/* ---------- helpers ---------- */

const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomId(len = 8): string {
  const arr = new Uint8Array(len);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.getRandomValues(arr);
  } else {
    // Fallback for non-browser runtimes
    for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[arr[i] % ALPHABET.length];
  return s;
}

function uniqueId(prefix: string, used: Set<string>, len = 8): string {
  let id = `${prefix}${randomId(len)}`;
  while (used.has(id)) id = `${prefix}${randomId(len)}`;
  used.add(id);
  return id;
}

const normHandle = normalizeHandle;

const structureKey = (
  src: string,
  sH: string | undefined,
  tgt: string,
  tH: string | undefined
) => `${src}|${sH ?? ""}|${tgt}|${tH ?? ""}`;

/* ---------- main ---------- */

export function importWithFreshIds<N extends NodeLike, E extends EdgeLike>({
  currentNodes,
  currentEdges = [],
  importNodes,
  importEdges,
  dedupeEdges = true,
  renameMode = "always",
}: ImportArgs<N, E>): ImportResult<N, E> {
  // Nodes
  const usedNodeIds = new Set<string>(currentNodes.map((n) => n.id));
  const idMap = new Map<string, string>();

  for (const n of importNodes) {
    const keep = renameMode === "collision" && !usedNodeIds.has(n.id);
    const newId = keep ? n.id : uniqueId("node_", usedNodeIds, 8);
    if (keep) usedNodeIds.add(newId); // reserve kept id, too
    idMap.set(n.id, newId);
  }

  const nodes: N[] = importNodes.map((n) => {
    const id = idMap.get(n.id)!;
    const out: Record<string, unknown> = { ...n, id };
    // Remap all parent references
    if (n.parentId) out.parentId = idMap.get(n.parentId) ?? n.parentId;
    if (n.parentNode) out.parentNode = idMap.get(n.parentNode) ?? n.parentNode;
    if (n.group) out.group = idMap.get(n.group) ?? n.group;
    return out as N;
  });

  // Edges
  const usedEdgeIds = new Set<string>(currentEdges.map((e) => e.id));
  const seenStructs = new Set<string>();
  if (dedupeEdges) {
    for (const e of currentEdges) {
      seenStructs.add(
        structureKey(
          e.source,
          normHandle(e.sourceHandle),
          e.target,
          normHandle(e.targetHandle)
        )
      );
    }
  }

  const edges: E[] = [];
  for (const e of importEdges) {
    const src = idMap.get(e.source) ?? e.source;
    const tgt = idMap.get(e.target) ?? e.target;
    const srcH = normHandle(e.sourceHandle);
    const tgtH = normHandle(e.targetHandle);
    const key = structureKey(src, srcH, tgt, tgtH);

    if (dedupeEdges && seenStructs.has(key)) continue;

    const keepEdge = renameMode === "collision" && !usedEdgeIds.has(e.id);
    const id = keepEdge ? e.id : uniqueId("edge_", usedEdgeIds, 8);
    if (keepEdge) usedEdgeIds.add(id);
    seenStructs.add(key);

    const out: Record<string, unknown> = { ...e, id, source: src, target: tgt };
    if (srcH !== undefined) out.sourceHandle = srcH;
    else delete out.sourceHandle;
    if (tgtH !== undefined) out.targetHandle = tgtH;
    else delete out.targetHandle;
    edges.push(out as E);
  }

  return { nodes, edges, idMap };
}
