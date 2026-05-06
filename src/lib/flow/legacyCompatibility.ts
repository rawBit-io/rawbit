import type { FlowNode } from "@/types";
import { normalizeOpcodeNodeData } from "@/lib/opcodeNodeData";

const LEGACY_FLOW_MAP_NODE_DATA_KEYS = ["excludeFromFlowMap"] as const;

export const omitEphemeralOrLegacyNodeData = (
  key: string,
  value: unknown
) =>
  key === "isHighlighted" ||
  key === "searchMark" ||
  LEGACY_FLOW_MAP_NODE_DATA_KEYS.includes(
    key as (typeof LEGACY_FLOW_MAP_NODE_DATA_KEYS)[number]
  )
    ? undefined
    : value;

export function stripLegacyFlowMapNodeData<TNode extends FlowNode>(
  nodes: TNode[]
): TNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (!node.data) return node;

    let nextData: Record<string, unknown> | undefined;
    const isOpcodeNode =
      node.type === "opCodeNode" || node.data.functionName === "op_code_select";
    if (isOpcodeNode) {
      nextData = normalizeOpcodeNodeData(node.data);
    }

    for (const key of LEGACY_FLOW_MAP_NODE_DATA_KEYS) {
      if (!(key in node.data)) continue;
      nextData ??= { ...node.data };
      delete nextData[key];
    }

    if (!nextData) return node;
    changed = true;
    return { ...node, data: nextData } as TNode;
  });

  return changed ? nextNodes : nodes;
}
