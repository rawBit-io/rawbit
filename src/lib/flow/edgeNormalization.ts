type EdgeLike = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: unknown;
  targetHandle?: unknown;
} & Record<string, unknown>;

export function normalizeHandle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function edgeConnectionKey(edge: EdgeLike): string {
  return [
    edge.source,
    normalizeHandle(edge.sourceHandle) ?? "",
    edge.target,
    normalizeHandle(edge.targetHandle) ?? "",
  ].join("|");
}

export function edgeIdentityKey(edge: EdgeLike): string {
  return `${edge.id}|${edgeConnectionKey(edge)}`;
}

export function edgesHaveSameIdentity(left: EdgeLike, right: EdgeLike): boolean {
  return edgeIdentityKey(left) === edgeIdentityKey(right);
}

export function normalizeEdgeHandles<T extends EdgeLike>(edge: T): T {
  const sourceHandle = normalizeHandle(edge.sourceHandle);
  const targetHandle = normalizeHandle(edge.targetHandle);
  let changed = false;
  const next: Record<string, unknown> = { ...edge };

  if (sourceHandle === undefined) {
    if ("sourceHandle" in next) {
      delete next.sourceHandle;
      changed = true;
    }
  } else if (edge.sourceHandle !== sourceHandle) {
    next.sourceHandle = sourceHandle;
    changed = true;
  }

  if (targetHandle === undefined) {
    if ("targetHandle" in next) {
      delete next.targetHandle;
      changed = true;
    }
  } else if (edge.targetHandle !== targetHandle) {
    next.targetHandle = targetHandle;
    changed = true;
  }

  return changed ? (next as T) : edge;
}

export function normalizeAndDedupeEdgeConnections<T extends EdgeLike>(
  edges: readonly T[]
): T[] {
  const seen = new Set<string>();
  const nextEdges: T[] = [];

  for (const edge of edges) {
    const normalized = normalizeEdgeHandles(edge);
    const key = edgeConnectionKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    nextEdges.push(normalized);
  }

  return nextEdges;
}
