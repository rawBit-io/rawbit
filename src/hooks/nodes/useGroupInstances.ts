import { useCallback, useEffect } from "react";

import type { Edge } from "@xyflow/react";

import {
  canGrowGroup,
  collectReservedIndices,
  getNextGapIndex,
} from "@/lib/nodes/fieldUtils";
import { INSTANCE_STRIDE } from "@/lib/utils";
import type { FlowNode, GroupDefinition, NodeData } from "@/types";

export interface UseGroupInstancesResult {
  handleGroupSize: (title: string, group: GroupDefinition, increment: boolean) => void;
}

export function useGroupInstances(
  id: string,
  data: NodeData,
  setNodes: (updater: (nodes: FlowNode[]) => FlowNode[]) => void,
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void
): UseGroupInstancesResult {
  useEffect(() => {
    setNodes((nodes) => {
      let mutated = false;

      const next = nodes.map((node) => {
        if (node.id !== id) return node;

        const nodeData = node.data as NodeData;
        const keys: Record<string, number[]> = {
          ...(nodeData.groupInstanceKeys ?? {}),
        };

        nodeData.inputStructure?.groups?.forEach((group) => {
          if (nodeData.groupInstances?.[group.title] && !keys[group.title]?.length) {
            const count = nodeData.groupInstances[group.title];
            keys[group.title] = Array.from(
              { length: count },
              (_, index) => group.baseIndex + index * INSTANCE_STRIDE
            );
            mutated = true;
          }
        });

        return mutated
          ? { ...node, data: { ...nodeData, groupInstanceKeys: keys } }
          : node;
      });

      return mutated ? next : nodes;
    });
  }, [
    id,
    setNodes,
    data.inputStructure,
    data.groupInstances,
  ]);

  const handleGroupSize = useCallback(
    (title: string, group: GroupDefinition, increment: boolean) => {
      const nodeData = data as NodeData;
      const currentCount = nodeData.groupInstances?.[title] ?? 0;
      const keys = [...(nodeData.groupInstanceKeys?.[title] ?? [])];
      let removedOffset: number | undefined;

      if (increment) {
        if (!canGrowGroup(group.baseIndex, keys, group.fields)) return;
        const nextBase = getNextGapIndex(keys, group.baseIndex);
        const reserved = collectReservedIndices(nodeData, title);
        const overlaps = group.fields.some((field) =>
          reserved.has(nextBase + field.index)
        );
        if (overlaps) return;
        keys.push(nextBase);
      } else {
        if (!keys.length) return;
        removedOffset = keys.pop();
      }

      const nextCount = increment ? currentCount + 1 : currentCount - 1;
      if (nextCount < (group.minInstances ?? 1)) return;

      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...(node.data as NodeData),
                  groupInstances: {
                    ...(node.data.groupInstances ?? {}),
                    [title]: nextCount,
                  },
                  groupInstanceKeys: {
                    ...(node.data.groupInstanceKeys ?? {}),
                    [title]: keys,
                  },
                  dirty: true,
                },
              }
            : node
        )
      );

      if (!increment && removedOffset !== undefined) {
        const handlesToRemove = new Set(
          group.fields.map((field) => `input-${removedOffset! + field.index}`)
        );

        setEdges((edges) => {
          if (!edges.length) return edges;
          let removedEdge = false;
          const filtered = edges.filter((edge) => {
            const shouldRemove =
              edge.target === id && handlesToRemove.has(edge.targetHandle ?? "")
            if (shouldRemove) removedEdge = true;
            return !shouldRemove;
          });
          return removedEdge ? filtered : edges;
        });
      }
    },
    [
      data,
      id,
      setEdges,
      setNodes,
    ]
  );

  return { handleGroupSize };
}
