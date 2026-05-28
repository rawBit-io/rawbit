import type { FlowNode } from "@/types";

export interface ExpandedExportNodeSelection {
  selectedCount: number;
  totalCount: number;
  nodesToSave: FlowNode[];
}

export const getExpandedExportNodeSelection = (
  nodes: FlowNode[]
): ExpandedExportNodeSelection => {
  const selectedNodes = nodes.filter((n) => n.selected);
  if (selectedNodes.length === 0) {
    return {
      selectedCount: 0,
      totalCount: nodes.length,
      nodesToSave: nodes,
    };
  }

  const nodeIdsToSave = new Set(selectedNodes.map((n) => n.id));
  const selectedGroupIds = new Set(
    selectedNodes.filter((n) => n.type === "shadcnGroup").map((n) => n.id)
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!node.parentId || !selectedGroupIds.has(node.parentId)) continue;
      if (nodeIdsToSave.has(node.id)) continue;
      nodeIdsToSave.add(node.id);
      if (node.type === "shadcnGroup") {
        selectedGroupIds.add(node.id);
      }
      changed = true;
    }
  }

  return {
    selectedCount: selectedNodes.length,
    totalCount: nodes.length,
    nodesToSave: nodes.filter((n) => nodeIdsToSave.has(n.id)),
  };
};
