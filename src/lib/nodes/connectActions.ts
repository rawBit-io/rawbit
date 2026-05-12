export interface PortInfo {
  label: string;
  handleId: string;
}

export interface NodePorts {
  id: string;
  label: string;
  functionName?: string;
  outputs: PortInfo[];
  inputs: PortInfo[];
}

export interface EdgeLike {
  id?: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
}

export type ConnectMode = "connect" | "copy";

export interface CopyInputPlan {
  ok: boolean;
  rows: EdgeLike[];
  skipped: number;
}

export interface DirectionAvailability {
  canConnectEdge: boolean;
  canCopyInputs: boolean;
  canDoAnything: boolean;
  availableModes: ConnectMode[];
  copyPlan: CopyInputPlan;
}

const uid = (base: string, used: Set<string>) => {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 1;
  let id = `${base}-${i}`;
  while (used.has(id)) id = `${base}-${++i}`;
  used.add(id);
  return id;
};

export function getOccupiedTargetHandles(
  target: NodePorts | null,
  edges: EdgeLike[]
) {
  if (!target) return new Set<string>();
  return new Set(
    edges
      .filter((edge) => edge.target === target.id && edge.targetHandle)
      .map((edge) => edge.targetHandle!)
  );
}

export function hasFreeTargetInput(
  target: NodePorts | null,
  edges: EdgeLike[]
) {
  if (!target) return false;
  const occupied = getOccupiedTargetHandles(target, edges);
  return target.inputs.some((input) => !occupied.has(input.handleId));
}

export function canConnectEdge(
  source: NodePorts | null,
  target: NodePorts | null,
  edges: EdgeLike[]
) {
  return Boolean(source?.outputs.length && hasFreeTargetInput(target, edges));
}

export function haveSameInputStructure(
  source: NodePorts | null,
  target: NodePorts | null
) {
  if (!source || !target) return false;
  if (source.inputs.length === 0 || source.inputs.length !== target.inputs.length) {
    return false;
  }
  return source.inputs.every(
    (input, index) => input.handleId === target.inputs[index]?.handleId
  );
}

export function getCopyInputPlan(
  source: NodePorts | null,
  target: NodePorts | null,
  edges: EdgeLike[]
): CopyInputPlan {
  if (!source || !target) return { ok: false, rows: [], skipped: 0 };
  if (!haveSameInputStructure(source, target)) {
    return { ok: false, rows: [], skipped: 0 };
  }

  const incoming = edges.filter((edge) => edge.target === source.id);
  if (!incoming.length) return { ok: false, rows: [], skipped: 0 };

  const targetHandles = new Set(target.inputs.map((input) => input.handleId));
  const occupied = getOccupiedTargetHandles(target, edges);
  const ids = new Set(edges.map((edge) => edge.id ?? ""));
  const orderIdx = new Map(
    target.inputs.map((input, index) => [input.handleId, index])
  );

  const rows: EdgeLike[] = [];
  let skipped = 0;

  for (const edge of incoming) {
    const handle = edge.targetHandle ?? "";
    if (!targetHandles.has(handle) || occupied.has(handle)) {
      skipped += 1;
      continue;
    }
    occupied.add(handle);
    rows.push({
      id: uid(`e${edge.source}-${target.id}-${handle || "null"}`, ids),
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: target.id,
      targetHandle: edge.targetHandle,
    });
  }

  rows.sort(
    (left, right) =>
      (orderIdx.get(left.targetHandle ?? "") ?? 999999) -
      (orderIdx.get(right.targetHandle ?? "") ?? 999999)
  );

  return { ok: rows.length > 0, rows, skipped };
}

export function getDirectionAvailability(
  source: NodePorts | null,
  target: NodePorts | null,
  edges: EdgeLike[]
): DirectionAvailability {
  const copyPlan = getCopyInputPlan(source, target, edges);
  const connectAvailable = canConnectEdge(source, target, edges);
  const availableModes: ConnectMode[] = [];

  if (connectAvailable) availableModes.push("connect");
  if (copyPlan.ok) availableModes.push("copy");

  return {
    canConnectEdge: connectAvailable,
    canCopyInputs: copyPlan.ok,
    canDoAnything: availableModes.length > 0,
    availableModes,
    copyPlan,
  };
}
