import type { Edge } from "@xyflow/react";

import type { FlowNode } from "@/types";
import { isCalculableNode } from "@/lib/flow/nonCalculableNodes";

/**
 * Given the nodes and edges removed by a delete, return the ids of the
 * SURVIVING, still-calculable nodes that lose a connection and therefore must
 * recalculate — otherwise they keep a result computed from a node that no
 * longer exists. Non-calculable node types (groups/text/hardware) are excluded
 * so they can never be left permanently dirty.
 *
 * Driven by React Flow's onDelete payload (the deleted edges, endpoints intact)
 * rather than the live edge set, which is already stripped by the time our
 * change handlers run.
 */
export function survivingCalculableConsumersOnDelete(
  deletedNodes: Pick<FlowNode, "id">[],
  deletedEdges: Pick<Edge, "source" | "target">[],
  currentNodes: FlowNode[]
): Set<string> {
  const deletedNodeIds = new Set(deletedNodes.map((node) => node.id));
  const calculableById = new Map(
    currentNodes.map((node) => [node.id, isCalculableNode(node)])
  );

  const dirtyIds = new Set<string>();
  const consider = (nodeId: string | undefined | null) => {
    if (!nodeId || deletedNodeIds.has(nodeId)) return;
    if (calculableById.get(nodeId)) dirtyIds.add(nodeId);
  };

  for (const edge of deletedEdges) {
    consider(edge.source);
    consider(edge.target);
  }

  return dirtyIds;
}
