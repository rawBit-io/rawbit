import { buildPorts } from "@/lib/nodes/ports";
import { INSTANCE_STRIDE } from "@/lib/utils";
import type { FieldDefinition, FlowNode, GroupDefinition } from "@/types";

const isConnectableField = (field: FieldDefinition) =>
  !field.unconnectable && !(field.options && field.options.length > 0);

// Handle ids depend only on node.data (+ node.type, which is stable), so cache by
// data reference. Position-only drags reuse the same data object, so the bundling
// guard pays nothing per drag frame; a group resize swaps data and recomputes.
const inputHandleCacheByData = new WeakMap<object, Set<string>>();
const outputHandleCacheByData = new WeakMap<object, Set<string>>();

/**
 * Input handle ids the node actually RENDERS.
 *
 * This mirrors the renderer (CalculationNodeView): group-instance handles come
 * from `groupInstanceKeys`, falling back to the `groupInstances` count when keys
 * are absent. `buildPorts` omits that count fallback (see NB-03), so we union the
 * fallback handles back in — otherwise a handle the user can see and connect to
 * would be treated as missing and its edge wrongly pruned.
 *
 * Returns an empty set if ports cannot be enumerated; callers must treat an empty
 * set as "unknown" and never prune/hide an edge they cannot prove is dangling.
 */
export function renderedInputHandleIds(node: FlowNode): Set<string> {
  const dataKey = node.data as object | undefined;
  if (dataKey) {
    const cached = inputHandleCacheByData.get(dataKey);
    if (cached) return cached;
  }

  const handles = new Set<string>();
  try {
    buildPorts(node).inputs.forEach((port) => {
      if (port.handleId) handles.add(port.handleId);
    });
  } catch {
    return new Set<string>();
  }

  const data = node.data ?? {};
  const groups = (data.inputStructure?.groups ?? []) as GroupDefinition[];
  for (const group of groups) {
    const keys = data.groupInstanceKeys?.[group.title];
    if (keys && keys.length) continue; // buildPorts already enumerated these
    const count = data.groupInstances?.[group.title] ?? 0;
    for (let instance = 0; instance < count; instance += 1) {
      const base = group.baseIndex + instance * INSTANCE_STRIDE;
      for (const field of group.fields) {
        if (isConnectableField(field)) {
          handles.add(`input-${base + field.index}`);
        }
      }
    }
  }
  if (dataKey) inputHandleCacheByData.set(dataKey, handles);
  return handles;
}

/**
 * Output handle ids the node actually renders (explicit/dynamic output ports).
 * Empty set means "unknown / single default output" — callers must not prune.
 */
export function renderedOutputHandleIds(node: FlowNode): Set<string> {
  const dataKey = node.data as object | undefined;
  if (dataKey) {
    const cached = outputHandleCacheByData.get(dataKey);
    if (cached) return cached;
  }

  const handles = new Set<string>();
  try {
    buildPorts(node).outputs.forEach((port) => {
      if (port.handleId) handles.add(port.handleId);
    });
  } catch {
    return new Set<string>();
  }
  if (dataKey) outputHandleCacheByData.set(dataKey, handles);
  return handles;
}
