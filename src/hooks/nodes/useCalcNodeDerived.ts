import { useCallback, useEffect, useMemo } from "react";

import { Edge, useStore } from "@xyflow/react";

import { useCanonicalGraph } from "@/contexts/canonical-graph";
import { countVisibleInputs } from "@/lib/nodes/fieldUtils";
import {
  SENTINEL_EMPTY,
  SENTINEL_FORCE00,
  SENTINEL_NULL,
} from "@/lib/nodes/constants";
import { INSTANCE_STRIDE, getVal } from "@/lib/utils";
import type { FlowNode, NodeData } from "@/types";

export interface ConnectionStatus {
  connected: number;
  total: number;
  shouldShow: boolean;
}

export interface UseCalcNodeDerivedResult {
  isMultiVal: boolean;
  nodeWidth: number;
  minHeight: number;
  visibleInputs: number;
  wiredHandles: Set<string>;
  connectionStatus: ConnectionStatus;
}

const HANDLE_SPACING = 30;
const SINGLE_BASE_HEIGHT = 100;
const MULTI_BASE_HEIGHT = 200;

const edgesShallowEqual = (a: Edge[], b: Edge[]) =>
  a.length === b.length && a.every((edge, index) => edge === b[index]);

export function useCalcNodeDerived(
  id: string,
  data: NodeData,
  setNodes: (updater: (nodes: FlowNode[]) => FlowNode[]) => void
): UseCalcNodeDerivedResult {
  const canonicalGraph = useCanonicalGraph();
  const selectIncomingEdges = useCallback(
    (state: { edges: Edge[] }) => state.edges.filter((edge) => edge.target === id),
    [id]
  );

  const storeIncomingEdges = useStore(selectIncomingEdges, edgesShallowEqual);
  const incomingEdges = useMemo(
    () =>
      canonicalGraph
        ? canonicalGraph.edges.filter((edge) => edge.target === id)
        : storeIncomingEdges,
    [canonicalGraph, id, storeIncomingEdges]
  );

  const wiredHandles = useMemo(() => {
    const handles = new Set<string>();
    incomingEdges.forEach((edge) => {
      if (edge.targetHandle) {
        handles.add(edge.targetHandle);
      }
    });
    return handles;
  }, [incomingEdges]);

  const isMultiVal = (data.paramExtraction ?? "single_val") === "multi_val";

  const visibleInputs = useMemo(
    () => (isMultiVal ? countVisibleInputs(data) : 0),
    [data, isMultiVal]
  );

  const nodeWidth = isMultiVal ? 400 : 250;
  const baseHeight = isMultiVal ? MULTI_BASE_HEIGHT : SINGLE_BASE_HEIGHT;
  const minHeight = baseHeight + visibleInputs * HANDLE_SPACING;

  const connectionStatus = useMemo<ConnectionStatus>(() => {
    if (!isMultiVal) {
      return { connected: 0, total: 0, shouldShow: false };
    }

    let total = 0;
    let connected = 0;

    const hasSentinelValue = (index: number) => {
      const value = getVal(data.inputs?.vals, index);
      return (
        value === SENTINEL_FORCE00 ||
        value === SENTINEL_EMPTY ||
        value === SENTINEL_NULL
      );
    };

    const consider = (
      index: number | undefined,
      field?: { unconnectable?: boolean; options?: string[] }
    ) => {
      if (index === undefined || field?.unconnectable || field?.options?.length) {
        return;
      }
      total += 1;
      if (wiredHandles.has(`input-${index}`) || hasSentinelValue(index)) {
        connected += 1;
      }
    };

    data.inputStructure?.ungrouped?.forEach((field) =>
      consider(field.index, field)
    );

    data.inputStructure?.groups?.forEach((group) => {
      const keys = data.groupInstanceKeys?.[group.title];
      if (keys?.length) {
        keys.forEach((offset) => {
          group.fields.forEach((field) =>
            consider(offset + field.index, field)
          );
        });
        return;
      }

      const instanceCount = data.groupInstances?.[group.title] ?? 0;
      for (let i = 0; i < instanceCount; i += 1) {
        const offset = group.baseIndex + i * INSTANCE_STRIDE;
        group.fields.forEach((field) =>
          consider(offset + field.index, field)
        );
      }
    });

    Object.values(data.inputStructure?.betweenGroups ?? {}).forEach((fields) =>
      fields.forEach((field) => consider(field.index, field))
    );

    data.inputStructure?.afterGroups?.forEach((field) =>
      consider(field.index, field)
    );

    return { connected, total, shouldShow: true };
  }, [data, isMultiVal, wiredHandles]);

  const unwired = Math.max(connectionStatus.total - connectionStatus.connected, 0);

  useEffect(() => {
    if (!isMultiVal) return;

    setNodes((nodes) => {
      const index = nodes.findIndex((node) => node.id === id);
      if (index === -1) return nodes;

      const current = nodes[index].data as NodeData;
      if (
        current.totalInputs === connectionStatus.total &&
        current.unwiredCount === unwired
      ) {
        return nodes;
      }

      const next = [...nodes];
      next[index] = {
        ...nodes[index],
        data: {
          ...current,
          totalInputs: connectionStatus.total,
          unwiredCount: unwired,
        },
      };
      return next;
    });
  }, [
    id,
    isMultiVal,
    connectionStatus.total,
    unwired,
    setNodes,
  ]);

  return {
    isMultiVal,
    nodeWidth,
    minHeight,
    visibleInputs,
    wiredHandles,
    connectionStatus,
  };
}
