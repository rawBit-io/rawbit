/**
 * React Flow v12 requires a node's parent to appear BEFORE the node in the
 * nodes array. When that invariant is violated, the child's internal
 * positionAbsolute is computed from its parent-relative coordinates on the
 * first store pass, so viewport culling (onlyRenderVisibleElements) tests a
 * rect near the canvas origin instead of the node's real place — the node
 * unmounts while its group is perfectly in view and only reappears once the
 * viewport is zoomed out far enough to cover the origin region. Any nodes
 * producer that slips (paste, undo restore, group ops, hand-edited saves) can
 * introduce the violation, so the render boundary enforces the order instead
 * of trusting every producer.
 */

type ParentedNode = { id: string; parentId?: string };

/**
 * Returns the nodes reordered so every parent precedes its children, keeping
 * the original relative order otherwise. Identity-stable: when the input is
 * already ordered (the overwhelmingly common case) the SAME array reference
 * is returned, so memoized consumers pay nothing.
 */
export function ensureParentsBeforeChildren<T extends ParentedNode>(
  nodes: T[]
): T[] {
  const ids = new Set<string>();
  for (const node of nodes) ids.add(node.id);

  let violated = false;
  const seen = new Set<string>();
  for (const node of nodes) {
    if (
      node.parentId &&
      node.parentId !== node.id &&
      ids.has(node.parentId) &&
      !seen.has(node.parentId)
    ) {
      violated = true;
      break;
    }
    seen.add(node.id);
  }
  if (!violated) return nodes;

  // Stable reorder: emit nodes in original order, parking any child whose
  // parent has not been emitted yet; flush parked children (depth-first, in
  // arrival order) as soon as their parent lands.
  const emitted = new Set<string>();
  const parked = new Map<string, T[]>();
  const result: T[] = [];

  const emit = (node: T) => {
    result.push(node);
    emitted.add(node.id);
    const waiting = parked.get(node.id);
    if (!waiting) return;
    parked.delete(node.id);
    for (const child of waiting) emit(child);
  };

  for (const node of nodes) {
    if (
      node.parentId &&
      node.parentId !== node.id &&
      ids.has(node.parentId) &&
      !emitted.has(node.parentId)
    ) {
      const queue = parked.get(node.parentId);
      if (queue) queue.push(node);
      else parked.set(node.parentId, [node]);
      continue;
    }
    emit(node);
  }

  // Defensive: parents that never appeared (cycles / self-references) —
  // append their parked children in original relative order so nothing is
  // ever dropped.
  if (parked.size) {
    for (const node of nodes) {
      if (!emitted.has(node.id)) {
        result.push(node);
        emitted.add(node.id);
      }
    }
  }

  return result;
}
