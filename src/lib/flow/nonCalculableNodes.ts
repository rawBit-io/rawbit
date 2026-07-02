import type { FlowNode } from "@/types";

export const NON_CALCULABLE_NODE_TYPES = new Set([
  "shadcnGroup",
  "shadcnTextInfo",
  "trezorAction",
  "scriptViewer",
]);

export const isCalculableNode = (node: Pick<FlowNode, "type">) =>
  !NON_CALCULABLE_NODE_TYPES.has(node.type ?? "");
