// src/lib/flow/groupNesting.ts
// ---------------------------------------------------------------------
// Shared helpers for nested group nodes ("shadcnGroup" inside "shadcnGroup").
//
// Nodes reference their group via `parentId`; chains may be arbitrarily
// deep. All walks are cycle-guarded so a corrupt file can never hang the
// UI. Positions of children are RELATIVE to their parent, so any absolute
// geometry must accumulate the whole ancestor chain.
// ---------------------------------------------------------------------

export interface ParentChainNode {
  id: string;
  type?: string;
  parentId?: string;
  position?: { x: number; y: number };
}

export interface GroupMaps {
  byId: Map<string, ParentChainNode>;
  /** direct parent id per node id (only entries that exist in byId) */
  parentOf: Map<string, string>;
  /** ids of nodes with type "shadcnGroup" */
  groupIds: Set<string>;
}

export const buildGroupMaps = (nodes: ParentChainNode[]): GroupMaps => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentOf = new Map<string, string>();
  const groupIds = new Set<string>();
  for (const node of nodes) {
    if (node.type === "shadcnGroup") groupIds.add(node.id);
    if (node.parentId && node.parentId !== node.id && byId.has(node.parentId)) {
      parentOf.set(node.id, node.parentId);
    }
  }
  return { byId, parentOf, groupIds };
};

/**
 * Ancestor GROUP chain of a node, innermost first. If the node itself is a
 * group it is included as the first entry (a group is its own innermost
 * bundling context — mirrors the flat behaviour where a group mapped to
 * itself in nodeToGroup).
 */
export const ancestorGroupChain = (
  nodeId: string,
  maps: GroupMaps
): string[] => {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = nodeId;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (maps.groupIds.has(current)) chain.push(current);
    current = maps.parentOf.get(current);
  }
  return chain;
};

/**
 * Bundle-endpoint resolution for an edge, generalized to nested groups:
 * each endpoint resolves to the OUTERMOST ancestor group that does not
 * contain the other endpoint. Edges bundle only when both endpoints
 * resolve (necessarily to different groups); every flat-group behaviour
 * (same group → direct, group↔plain node → direct, group↔own child →
 * direct) falls out of this rule unchanged.
 */
export const resolveBundleEndpointGroups = (
  sourceId: string,
  targetId: string,
  maps: GroupMaps
): { sourceGroupId?: string; targetGroupId?: string } => {
  const sourceChain = ancestorGroupChain(sourceId, maps);
  const targetChain = ancestorGroupChain(targetId, maps);
  const sourceSet = new Set(sourceChain);
  const targetSet = new Set(targetChain);

  let sourceGroupId: string | undefined;
  for (const groupId of sourceChain) {
    if (targetSet.has(groupId)) break;
    sourceGroupId = groupId; // keep walking outward
  }
  let targetGroupId: string | undefined;
  for (const groupId of targetChain) {
    if (sourceSet.has(groupId)) break;
    targetGroupId = groupId;
  }
  return { sourceGroupId, targetGroupId };
};

/** Absolute canvas position accumulated over the whole parent chain. */
export const absolutePositionOf = (
  nodeId: string,
  maps: GroupMaps
): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  const seen = new Set<string>();
  let current: string | undefined = nodeId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = maps.byId.get(current);
    if (!node) break;
    x += node.position?.x ?? 0;
    y += node.position?.y ?? 0;
    current = maps.parentOf.get(current);
  }
  return { x, y };
};

/** True when `nodeId` sits anywhere inside `ancestorId`'s subtree. */
export const isDescendantOf = (
  nodeId: string,
  ancestorId: string,
  maps: GroupMaps
): boolean => {
  const seen = new Set<string>();
  let current = maps.parentOf.get(nodeId);
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = maps.parentOf.get(current);
  }
  return false;
};

/** Nesting depth: 0 for top-level nodes, +1 per ancestor. */
export const nestingDepthOf = (nodeId: string, maps: GroupMaps): number => {
  let depth = 0;
  const seen = new Set<string>();
  let current = maps.parentOf.get(nodeId);
  while (current && !seen.has(current)) {
    depth += 1;
    seen.add(current);
    current = maps.parentOf.get(current);
  }
  return depth;
};

/**
 * Stable re-order so every parent precedes its children (React Flow
 * requires it). Nodes keep their relative order within the constraint;
 * orphaned/cyclic parent references are treated as top-level. Returns the
 * input array when it is already correctly ordered.
 */
export const orderNodesParentsFirst = <T extends ParentChainNode>(
  nodes: T[]
): T[] => {
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]));
  let alreadyOrdered = true;
  for (const node of nodes) {
    if (!node.parentId) continue;
    const parentIndex = indexOf.get(node.parentId);
    if (parentIndex !== undefined && parentIndex > indexOf.get(node.id)!) {
      alreadyOrdered = false;
      break;
    }
  }
  if (alreadyOrdered) return nodes;

  const byParent = new Map<string | undefined, T[]>();
  for (const node of nodes) {
    const parentKey =
      node.parentId && indexOf.has(node.parentId) && node.parentId !== node.id
        ? node.parentId
        : undefined;
    const bucket = byParent.get(parentKey);
    if (bucket) bucket.push(node);
    else byParent.set(parentKey, [node]);
  }

  const ordered: T[] = [];
  const emitted = new Set<string>();
  const emit = (node: T) => {
    if (emitted.has(node.id)) return;
    emitted.add(node.id);
    ordered.push(node);
    const children = byParent.get(node.id);
    if (children) children.forEach(emit);
  };
  (byParent.get(undefined) ?? []).forEach(emit);
  // Cyclic leftovers (no reachable root) — append in original order.
  for (const node of nodes) {
    if (!emitted.has(node.id)) {
      emitted.add(node.id);
      ordered.push(node);
    }
  }
  return ordered;
};
