import { useCallback } from "react";

import type { Edge } from "@xyflow/react";

import {
  SENTINEL_EMPTY,
  SENTINEL_FORCE00,
  SENTINEL_NULL,
} from "@/lib/nodes/constants";
import type { SnapshotOptions } from "@/hooks/useSnapshotScheduler";
import { setVal } from "@/lib/utils";
import { removeScriptSteps } from "@/lib/share/scriptStepsCache";
import {
  TX_FIELD_EXTRACT_MAX_OUTPUTS,
  buildTxFieldExtractOutputPorts,
  nextTxFieldExtractField,
  normalizeTxFieldExtractFields,
} from "@/lib/nodes/txFieldExtract";
import type { FlowNode, NodeData } from "@/types";

export interface UseCalcNodeMutationsResult {
  setFieldValue: (
    fieldIndex: number,
    value: string,
    isConnected: boolean,
    allowEmpty: boolean
  ) => void;
  setTaprootLeafIndex: (index: number) => void;
  setTxFieldExtractField: (index: number, field: string) => void;
  resizeTxFieldExtractFields: (increment: boolean) => void;
  updateFieldLabel: (fieldIndex: number, label: string) => void;
  updateGroupTitle: (group: string, title: string) => void;
  handleNetworkChange: (network: string) => void;
  handleTitleUpdate: (title: string) => void;
  handleRegenerate: () => void;
  toggleComment: () => void;
  handleCommentChange: (value: string) => void;
  commitCommentOnBlur: (previousValue: string, nextValue: string) => void;
  deleteNode: () => void;
}

export function useCalcNodeMutations(
  id: string,
  setNodes: (updater: (nodes: FlowNode[]) => FlowNode[]) => void,
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void,
  snapshotHooks?: {
    lockEdgeSnapshotSkip?: () => void;
    releaseEdgeSnapshotSkip?: () => void;
    scheduleSnapshot?: (label: string, options?: SnapshotOptions) => void;
  }
): UseCalcNodeMutationsResult {
  const setFieldValue = useCallback(
    (fieldIndex: number, value: string, isConnected: boolean, allowEmpty: boolean) => {
      const canWrite =
        !isConnected ||
        (allowEmpty &&
          (value === "" ||
            value === "00" ||
            value === SENTINEL_EMPTY ||
            value === SENTINEL_FORCE00 ||
            value === SENTINEL_NULL)) ||
        value === SENTINEL_EMPTY ||
        value === SENTINEL_NULL;

      if (!canWrite) return;

      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...(node.data as NodeData),
                  inputs: {
                    ...(node.data.inputs ?? {}),
                    vals: setVal(node.data.inputs?.vals, fieldIndex, value),
                  },
                  dirty: true,
                  error: false,
                  extendedError: undefined,
                },
              }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const updateFieldLabel = useCallback(
    (fieldIndex: number, label: string) =>
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...(node.data as NodeData),
                  customFieldLabels: {
                    ...(node.data.customFieldLabels ?? {}),
                    [fieldIndex]: label,
                  },
                },
              }
            : node
        )
      ),
    [id, setNodes]
  );

  const setTaprootLeafIndex = useCallback(
    (index: number) =>
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...(node.data as NodeData),
                  taprootLeafIndex: index,
                  dirty: true,
                  error: false,
                  extendedError: undefined,
                },
              }
            : node
        )
      ),
    [id, setNodes]
  );

  const setTxFieldExtractField = useCallback(
    (index: number, field: string) =>
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id !== id) return node;

          const current = node.data as NodeData;
          const fields = normalizeTxFieldExtractFields(current.txExtractFields);
          if (index < 0 || index >= fields.length) return node;

          const nextFields = [...fields];
          nextFields[index] = field;

          return {
            ...node,
            data: {
              ...current,
              txExtractFields: nextFields,
              outputPorts: buildTxFieldExtractOutputPorts(nextFields),
              dirty: true,
              error: false,
              extendedError: undefined,
            },
          };
        })
      ),
    [id, setNodes]
  );

  const resizeTxFieldExtractFields = useCallback(
    (increment: boolean) => {
      let removedHandle: string | undefined;

      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id !== id) return node;

          const current = node.data as NodeData;
          const fields = normalizeTxFieldExtractFields(current.txExtractFields);
          let nextFields = fields;

          if (increment) {
            if (fields.length >= TX_FIELD_EXTRACT_MAX_OUTPUTS) return node;
            nextFields = [...fields, nextTxFieldExtractField(fields.length)];
          } else {
            if (fields.length <= 1) return node;
            removedHandle = `output-${fields.length - 1}`;
            nextFields = fields.slice(0, -1);
          }

          const outputValues =
            current.outputValues && typeof current.outputValues === "object"
              ? { ...current.outputValues }
              : undefined;
          if (removedHandle && outputValues) {
            delete outputValues[removedHandle];
          }

          return {
            ...node,
            data: {
              ...current,
              txExtractFields: nextFields,
              outputPorts: buildTxFieldExtractOutputPorts(nextFields),
              outputValues,
              dirty: true,
              error: false,
              extendedError: undefined,
            },
          };
        })
      );

      if (!increment && removedHandle) {
        setEdges((edges) =>
          edges.filter(
            (edge) =>
              !(edge.source === id && edge.sourceHandle === removedHandle)
          )
        );
      }
    },
    [id, setEdges, setNodes]
  );

  const updateGroupTitle = useCallback(
    (group: string, title: string) =>
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...(node.data as NodeData),
                  customGroupTitles: {
                    ...(node.data.customGroupTitles ?? {}),
                    [group]: title,
                  },
                },
              }
            : node
        )
      ),
    [id, setNodes]
  );

  const handleNetworkChange = useCallback(
    (network: string) =>
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  selectedNetwork: network as
                    | "regtest"
                    | "signet"
                    | "testnet"
                    | "mainnet",
                  dirty: true,
                },
              }
            : node
        )
      ),
    [id, setNodes]
  );

  const handleTitleUpdate = useCallback(
    (title: string) =>
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: { ...node.data, title: title || "N/A" },
              }
            : node
        )
      ),
    [id, setNodes]
  );

  const handleRegenerate = useCallback(
    () =>
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: { ...node.data, forceRegenerate: true, dirty: true },
              }
            : node
        )
      ),
    [id, setNodes]
  );

  const toggleComment = useCallback(
    () =>
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: { ...node.data, showComment: !node.data.showComment },
              }
            : node
        )
      ),
    [id, setNodes]
  );

  const handleCommentChange = useCallback(
    (value: string) =>
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, comment: value } }
            : node
        )
      ),
    [id, setNodes]
  );

  const commitCommentOnBlur = useCallback(
    (previousValue: string, nextValue: string) => {
      const normalizedPrevious = previousValue.trim();
      const normalizedNext = nextValue.trim();
      if (normalizedPrevious === normalizedNext) return;

      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id !== id) return node;
          const nextData: NodeData = { ...(node.data as NodeData) };
          if (normalizedNext) {
            nextData.comment = normalizedNext;
          } else {
            delete nextData.comment;
          }
          return { ...node, data: nextData };
        })
      );

      snapshotHooks?.scheduleSnapshot?.("Update Node Comment");
    },
    [id, setNodes, snapshotHooks]
  );

  const deleteNode = useCallback(() => {
    removeScriptSteps(id);
    const { lockEdgeSnapshotSkip, releaseEdgeSnapshotSkip, scheduleSnapshot } =
      snapshotHooks ?? {};

    if (lockEdgeSnapshotSkip) lockEdgeSnapshotSkip();
    let removedEdge = false;
    setEdges((edges) => {
      if (!edges.length) {
        if (releaseEdgeSnapshotSkip) releaseEdgeSnapshotSkip();
        return edges;
      }
      const filtered = edges.filter((edge) => {
        const shouldRemove = edge.source === id || edge.target === id;
        if (shouldRemove) removedEdge = true;
        return !shouldRemove;
      });
      if (!removedEdge && releaseEdgeSnapshotSkip) {
        releaseEdgeSnapshotSkip();
      }
      return filtered;
    });

    setNodes((nodes) => nodes.filter((node) => node.id !== id));

    if (scheduleSnapshot) {
      scheduleSnapshot("Node(s) removed", { refresh: true });
    }
  }, [id, setNodes, setEdges, snapshotHooks]);

  return {
    setFieldValue,
    setTaprootLeafIndex,
    setTxFieldExtractField,
    resizeTxFieldExtractFields,
    updateFieldLabel,
    updateGroupTitle,
    handleNetworkChange,
    handleTitleUpdate,
    handleRegenerate,
    toggleComment,
    handleCommentChange,
    commitCommentOnBlur,
    deleteNode,
  };
}
