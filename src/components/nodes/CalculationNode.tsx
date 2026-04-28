import React, { useCallback, useEffect, useMemo } from "react";

import { NodeProps, useReactFlow, useStore } from "@xyflow/react";

import { useNodeCalculationLogic } from "@/hooks/useCalculation";
import { useCalcNodeDerived } from "@/hooks/nodes/useCalcNodeDerived";
import { useCalcNodeMutations } from "@/hooks/nodes/useCalcNodeMutations";
import { useClipboardLite } from "@/hooks/nodes/useClipboardLite";
import { useGroupInstances } from "@/hooks/nodes/useGroupInstances";
import { CalculationNodeView } from "./calculation/CalculationNodeView";
import { getScriptSteps } from "@/lib/share/scriptStepsCache";
import type { FlowNode, NodeData } from "@/types";
import { useSnapshotSchedulerContext } from "@/hooks/useSnapshotSchedulerContext";
import { getVal, INSTANCE_STRIDE } from "@/lib/utils";
import type { Edge } from "@xyflow/react";
import { isCalculableNode } from "@/lib/flow/nonCalculableNodes";
import {
  SENTINEL_EMPTY,
  SENTINEL_FORCE00,
  SENTINEL_NULL,
} from "@/lib/nodes/constants";

function CalculationNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { setNodes, setEdges, getEdges } = useReactFlow<FlowNode>();
  const snapshotScheduler = useSnapshotSchedulerContext();

  const derived = useCalcNodeDerived(id, data as NodeData, setNodes);
  const connectedInputMeta = useStore(
    React.useCallback(
      (state: { edges: Edge[]; nodes: FlowNode[] }) => {
        const meta = new Map<
          number,
          { value: unknown; error: boolean; message?: string }
        >();
        if (!state.edges.length) return meta;

        const nodesById = new Map(state.nodes.map((node) => [node.id, node]));
        state.edges.forEach((edge) => {
          if (edge.target !== id || !edge.targetHandle) return;
          if (!edge.targetHandle.startsWith("input-")) return;
          const index = parseInt(
            edge.targetHandle.replace("input-", ""),
            10
          );
          if (!Number.isFinite(index)) return;
          const sourceNode = nodesById.get(edge.source);
          if (!sourceNode) return;
          const sourceHandle = edge.sourceHandle ?? "";
          const outputValues = sourceNode.data?.outputValues;
          const hasCustomOutput =
            sourceHandle &&
            outputValues &&
            typeof outputValues === "object" &&
            sourceHandle in outputValues;
          meta.set(index, {
            value: hasCustomOutput
              ? (outputValues as Record<string, unknown>)[sourceHandle]
              : sourceHandle
              ? undefined
              : sourceNode.data?.result,
            error: Boolean(sourceNode.data?.error),
            message:
              typeof sourceNode.data?.extendedError === "string"
                ? sourceNode.data.extendedError
                : undefined,
          });
        });

        return meta;
      },
      [id]
    )
  );
  const group = useGroupInstances(
    id,
    data as NodeData,
    setNodes,
    setEdges,
    {
      lockEdgeSnapshotSkip: snapshotScheduler.lockEdgeSnapshotSkip,
      releaseEdgeSnapshotSkip: snapshotScheduler.releaseEdgeSnapshotSkip,
    }
  );
  const mut = useCalcNodeMutations(id, setNodes, setEdges, {
    lockEdgeSnapshotSkip: snapshotScheduler.lockEdgeSnapshotSkip,
    releaseEdgeSnapshotSkip: snapshotScheduler.releaseEdgeSnapshotSkip,
    scheduleSnapshot: snapshotScheduler.scheduleSnapshot,
  });

  const { numInputs, value, result, error, handleChange } = useNodeCalculationLogic({
    id,
    data: data as NodeData,
    setNodes,
  });

  const rawTitle = (data as NodeData).title ?? (data as NodeData).functionName ?? "N/A";

  const clip = useClipboardLite({
    result,
    rawTitle,
    id,
    extendedError: (data as NodeData).extendedError as string | undefined,
  });

  const hasRegenerate = (data as NodeData).hasRegenerate === true;
  const hardwareAction = (data as NodeData).hardwareAction as string | undefined;
  const showComment = (data as NodeData).showComment === true;
  const comment = (data as NodeData).comment ?? "";
  const showField = (data as NodeData).showField === true;
  const showHandle = !derived.isMultiVal && numInputs > 0 && !hasRegenerate;

  const isInputConnected = useCallback(
    (index: number) => derived.wiredHandles.has(`input-${index}`),
    [derived.wiredHandles]
  );
  const getInputMeta = useCallback(
    (index: number) => connectedInputMeta.get(index),
    [connectedInputMeta]
  );

  const singleValue = useMemo(() => {
    if (derived.isMultiVal) return undefined;
    return {
      showField,
      showHandle,
      value: typeof value === "string" ? value : undefined,
      onChange: handleChange,
    };
  }, [derived.isMultiVal, handleChange, showField, showHandle, value]);

  const scriptResult = getScriptSteps(id);
  const script = {
    isScriptVerification: (data as NodeData).functionName === "script_verification",
    scriptResult,
    scriptSigInputHex: (data as NodeData).inputs?.vals?.[0] || "",
    scriptPubKeyInputHex: (data as NodeData).inputs?.vals?.[1] || "",
  };

  const hardwareInputIndices = useMemo(() => {
    if (!hardwareAction) return [];
    const nodeData = data as NodeData;
    const indices = new Set<number>();
    nodeData.inputStructure?.ungrouped?.forEach((field) => {
      indices.add(field.index);
    });
    nodeData.inputStructure?.afterGroups?.forEach((field) => {
      indices.add(field.index);
    });
    Object.values(nodeData.inputStructure?.betweenGroups ?? {}).forEach(
      (fields) => {
        fields.forEach((field) => indices.add(field.index));
      }
    );
    nodeData.inputStructure?.groups?.forEach((groupDef) => {
      const bases =
        nodeData.groupInstanceKeys?.[groupDef.title] ??
        Array.from(
          { length: nodeData.groupInstances?.[groupDef.title] ?? 0 },
          (_, index) => groupDef.baseIndex + index * INSTANCE_STRIDE
        );
      bases.forEach((base) => {
        groupDef.fields.forEach((field) => {
          indices.add(base + field.index);
        });
      });
    });

    if (indices.size === 0 && typeof nodeData.numInputs === "number") {
      for (let index = 0; index < nodeData.numInputs; index += 1) {
        indices.add(index);
      }
    }

    return Array.from(indices).sort((left, right) => left - right);
  }, [data, hardwareAction]);

  useEffect(() => {
    const nodeData = data as NodeData;
    const nextTitle =
      nodeData.functionName === "build_trezor_sign_transaction_params" &&
      nodeData.title === "Trezor Sign Transaction"
        ? "Trezor Sign Params"
        : nodeData.functionName === "trezor_sign_transaction" &&
          nodeData.title === "Trezor Sign Transaction"
        ? "Trezor Sign"
        : undefined;

    if (!nextTitle) return;

    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...(node.data as NodeData), title: nextTitle } }
          : node
      )
    );
  }, [data, id, setNodes]);

  useEffect(() => {
    const nodeData = data as NodeData;
    if (
      nodeData.functionName !== "trezor_get_address" &&
      nodeData.functionName !== "trezor_sign_transaction"
    ) {
      return;
    }

    const label =
      nodeData.functionName === "trezor_get_address" ? "address" : "signed tx";
    const hasLegacyExtraPort =
      Array.isArray(nodeData.outputPorts) &&
      nodeData.outputPorts.some((port) => port.handleId !== "");
    const hasLegacyExtraValue =
      nodeData.outputValues &&
      typeof nodeData.outputValues === "object" &&
      Object.keys(nodeData.outputValues).length > 0;

    if (!hasLegacyExtraPort && !hasLegacyExtraValue) return;

    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== id) return node;
        const nextData: NodeData = {
          ...(node.data as NodeData),
          outputPorts: [
            {
              label,
              handleId: "",
              handleTop: "50%",
              showLabel: false,
            },
          ],
        };
        delete nextData.outputValues;
        return { ...node, data: nextData };
      })
    );
  }, [data, id, setNodes]);

  const readHardwareInput = useCallback(
    (index: number) => {
      const meta = connectedInputMeta.get(index);
      if (isInputConnected(index)) {
        const upstreamValue = meta?.value;
        if (upstreamValue === undefined || upstreamValue === null) return "";
        return String(upstreamValue);
      }

      const nodeData = data as NodeData;
      const explicit = getVal(nodeData.inputs?.vals, index);
      if (explicit === SENTINEL_EMPTY) return "";
      if (explicit === SENTINEL_FORCE00) return "00";
      if (explicit === SENTINEL_NULL) return "";

      return explicit ?? "";
    },
    [connectedInputMeta, data, isInputConnected]
  );

  const readRequiredHardwareInput = useCallback(
    (index: number, label: string) => {
      const meta = connectedInputMeta.get(index);
      if (isInputConnected(index) && meta?.error) {
        throw new Error(meta.message || `${label} has an upstream error`);
      }
      const value = readHardwareInput(index);
      if (!value.trim()) {
        throw new Error(`${label} is required`);
      }
      return value;
    },
    [connectedInputMeta, isInputConnected, readHardwareInput]
  );

  const hardwareInputSnapshot = useMemo(() => {
    if (!hardwareAction) return "";
    return JSON.stringify(
      hardwareInputIndices.map((index) => [index, readHardwareInput(index)])
    );
  }, [hardwareAction, hardwareInputIndices, readHardwareInput]);

  const downstreamNodeIds = useCallback(() => {
    const edges = getEdges();
    const forward = new Map<string, string[]>();
    edges.forEach((edge) => {
      const existing = forward.get(edge.source) ?? [];
      existing.push(edge.target);
      forward.set(edge.source, existing);
    });

    const seen = new Set<string>();
    const queue = [...(forward.get(id) ?? [])];
    while (queue.length) {
      const next = queue.shift();
      if (!next || seen.has(next)) continue;
      seen.add(next);
      queue.push(...(forward.get(next) ?? []));
    }
    return seen;
  }, [getEdges, id]);

  useEffect(() => {
    if (!hardwareAction) return;
    const nodeData = data as NodeData;
    const currentResult = nodeData.result;
    const hasResult =
      currentResult !== undefined &&
      currentResult !== null &&
      String(currentResult) !== "";
    if (!hasResult) return;

    const lastSnapshot =
      typeof nodeData.hardwareInputSnapshot === "string"
        ? nodeData.hardwareInputSnapshot
        : "";
    if (lastSnapshot && lastSnapshot === hardwareInputSnapshot) return;

    const dirtyDownstream = downstreamNodeIds();
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...(node.data as NodeData),
              result: "",
              outputValues: undefined,
              hardwareInputSnapshot: undefined,
              hardwareStatus: "idle",
              hardwareStatusText:
                hardwareAction === "trezor_get_address"
                  ? "Inputs changed. Press Get Address again."
                  : "Inputs changed. Press Sign again.",
              dirty: false,
              error: false,
              extendedError: undefined,
            },
          };
        }

        if (dirtyDownstream.has(node.id) && isCalculableNode(node)) {
          return {
            ...node,
            data: {
              ...(node.data as NodeData),
              dirty: true,
              error: false,
              extendedError: undefined,
            },
          };
        }

        return node;
      })
    );
  }, [
    data,
    downstreamNodeIds,
    hardwareAction,
    hardwareInputSnapshot,
    id,
    setNodes,
  ]);

  const handleHardwareAction = useCallback(async () => {
    if (!hardwareAction) return;

    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...(node.data as NodeData),
                hardwareStatus: "running",
                hardwareStatusText:
                  hardwareAction === "trezor_get_address"
                    ? "Waiting for Trezor address confirmation..."
                    : "Waiting for Trezor transaction signing...",
                error: false,
                extendedError: undefined,
              },
            }
          : node
      )
    );

    try {
      let result = "";
      let outputValues: Record<string, unknown> | undefined;
      let statusText = "";
      const inputSnapshot = hardwareInputSnapshot;
      const trezor = await import("@/lib/trezor/connect");

      if (hardwareAction === "trezor_get_address") {
        const path = readRequiredHardwareInput(0, "Derivation path").trim();
        const coin = readRequiredHardwareInput(1, "Coin").trim();
        const scriptType = readRequiredHardwareInput(2, "Script type").trim();
        const showOnTrezor = trezor.parseTrezorBoolean(
          readRequiredHardwareInput(3, "Show on Trezor"),
          true
        );

        const payload = await trezor.getTrezorAddress({
          path,
          coin,
          scriptType,
          showOnTrezor,
        });

        result = payload.address;
        outputValues = undefined;
        statusText = "Address received from Trezor.";
      } else if (hardwareAction === "trezor_sign_transaction") {
        const payload = await trezor.signTrezorTransaction(
          readRequiredHardwareInput(0, "signTransaction params JSON")
        );
        result = payload.serializedTx;
        outputValues = undefined;
        statusText = "Transaction signed by Trezor.";
      } else {
        throw new Error(`Unknown hardware action '${hardwareAction}'`);
      }

      const dirtyDownstream = downstreamNodeIds();
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...(node.data as NodeData),
                result,
                outputValues,
                hardwareInputSnapshot: inputSnapshot,
                hardwareStatus: "success",
                hardwareStatusText: statusText,
                dirty: false,
                error: false,
                extendedError: undefined,
              },
            };
          }

          if (dirtyDownstream.has(node.id) && isCalculableNode(node)) {
            return {
              ...node,
              data: {
                ...(node.data as NodeData),
                dirty: true,
                error: false,
                extendedError: undefined,
              },
            };
          }

          return node;
        })
      );
      snapshotScheduler.scheduleSnapshot?.("Run Trezor Action");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...(node.data as NodeData),
                  result: "",
                  outputValues: undefined,
                  hardwareInputSnapshot: undefined,
                  hardwareStatus: "error",
                  hardwareStatusText: message,
                  dirty: false,
                  error: true,
                  extendedError: message,
                },
              }
            : node
        )
      );
    }
  }, [
    downstreamNodeIds,
    hardwareAction,
    hardwareInputSnapshot,
    id,
    readRequiredHardwareInput,
    setNodes,
    snapshotScheduler,
  ]);

  useEffect(() => {
    const nodeData = data as NodeData;
    if (nodeData.outputLayout !== "taproot_tree_builder") return;

    const groupTitle = "LEAF_HASHES[]";
    const group = nodeData.inputStructure?.groups?.find(
      (entry) => entry.title === groupTitle
    );
    if (!group || group.fields.length === 0) return;

    const bases = nodeData.groupInstanceKeys?.[groupTitle]?.length
      ? nodeData.groupInstanceKeys?.[groupTitle] ?? []
      : Array.from(
          { length: nodeData.groupInstances?.[groupTitle] ?? 0 },
          (_, index) => group.baseIndex + index * INSTANCE_STRIDE
        );

    if (!bases.length) return;

    const nextLabels = { ...(nodeData.customFieldLabels ?? {}) };
    let changed = false;

    const labelForIndex = (index: number) => {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      let label = "";
      let n = index;
      while (true) {
        const rem = n % 26;
        label = alphabet[rem] + label;
        n = Math.floor(n / 26);
        if (n === 0) break;
        n -= 1;
      }
      return `Leaf ${label}`;
    };

    bases.forEach((base, orderIndex) => {
      const fieldIndex = base + group.fields[0].index;
      if (!nextLabels[fieldIndex]) {
        nextLabels[fieldIndex] = labelForIndex(orderIndex);
        changed = true;
      }
    });

    if (!changed) return;

    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...(node.data as NodeData),
                customFieldLabels: nextLabels,
              },
            }
          : node
      )
    );
  }, [data, id, setNodes]);

  return (
    <CalculationNodeView
      selected={!!selected}
      data={data as NodeData}
      rawTitle={rawTitle}
      derived={{
        isMultiVal: derived.isMultiVal,
        nodeWidth: derived.nodeWidth,
        minHeight: derived.minHeight,
        connectionStatus: derived.connectionStatus,
      }}
      isInputConnected={isInputConnected}
      getInputMeta={getInputMeta}
      mut={mut}
      group={group}
      clip={clip}
      singleValue={singleValue}
      result={result}
      error={!!error}
      hasRegenerate={hasRegenerate}
      hardwareAction={hardwareAction}
      onHardwareAction={handleHardwareAction}
      showComment={showComment}
      comment={comment}
      script={script}
    />
  );
}

export default React.memo(CalculationNode, (prev, next) => {
  return (
    prev.id === next.id &&
    prev.selected === next.selected &&
    prev.data === next.data
  );
});
