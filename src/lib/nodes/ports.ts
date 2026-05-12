import type { NodePorts, PortInfo } from "@/lib/nodes/connectActions";
import type { FlowNode, InputStructure, FieldDefinition } from "@/types";
import { isCalculableNode } from "@/lib/flow/nonCalculableNodes";
import {
  buildTxFieldExtractOutputPorts,
  normalizeTxFieldExtractFields,
} from "@/lib/nodes/txFieldExtract";

// Build the port list for a node for use by the Connect dialog.
export function buildPorts(n: FlowNode): NodePorts {
  const data = n.data ?? {};
  const inputStructure: InputStructure | undefined = data.inputStructure;
  const labelFor = (idx: number, fallback?: string) =>
    data.customFieldLabels?.[idx] ?? fallback ?? `in ${idx}`;

  const label = data.title || data.functionName || n.id;
  const dynamicTxExtractOutputs =
    data.functionName === "extract_tx_field" &&
    data.txFieldExtractMode === "dynamic"
      ? buildTxFieldExtractOutputPorts(
          normalizeTxFieldExtractFields(data.txExtractFields)
        )
      : undefined;
  const explicitOutputs =
    Array.isArray(data.outputPorts) && data.outputPorts.length > 0
      ? data.outputPorts
          .filter((port) => port.showHandle !== false)
          .map((port) => ({ label: port.label, handleId: port.handleId }))
      : undefined;
  const outputs: PortInfo[] =
    dynamicTxExtractOutputs ??
    explicitOutputs ??
    (isCalculableNode(n) ? [{ label: "out", handleId: "" }] : []);

  const handleLabels = new Map<string, string>();
  const registerHandle = (index: number, fallbackLabel?: string) => {
    if (index === undefined || Number.isNaN(index)) return;
    const handleId = `input-${index}`;
    const nextLabel = labelFor(index, fallbackLabel);
    if (!handleLabels.has(handleId)) {
      handleLabels.set(handleId, nextLabel);
      return;
    }

    const current = handleLabels.get(handleId);
    const isDefault = current === `in ${index}`;
    if (fallbackLabel && nextLabel && (isDefault || !current)) {
      handleLabels.set(handleId, nextLabel);
    }
  };

  const numInputs = data.numInputs;
  const hasExplicitNumInputs = typeof numInputs === "number";

  const ungrouped = inputStructure?.ungrouped ?? [];
  ungrouped.forEach((field) => {
    if (!field.unconnectable) registerHandle(field.index, field.label);
  });

  const groups = inputStructure?.groups ?? [];
  const instanceKeys = data.groupInstanceKeys ?? {};

  groups.forEach((group) => {
    const bases = instanceKeys[group.title] ?? [];
    bases.forEach((base) => {
      group.fields.forEach((field) => {
        registerHandle(base + field.index, field.label);
      });
    });

    const helpers: FieldDefinition[] =
      inputStructure?.betweenGroups?.[group.title] ?? [];
    helpers.forEach((field) => registerHandle(field.index, field.label));
  });

  const afterGroups = inputStructure?.afterGroups ?? [];
  afterGroups.forEach((field) => registerHandle(field.index, field.label));

  const betweenGroups = inputStructure?.betweenGroups ?? {};
  const hasGroupedStructure =
    groups.length > 0 || Object.keys(betweenGroups).length > 0;

  if (hasExplicitNumInputs && (numInputs as number) > 0 && !hasGroupedStructure) {
    for (let i = 0; i < numInputs; i += 1) {
      if (!handleLabels.has(`input-${i}`)) {
        registerHandle(i);
      }
    }
  }

  if (handleLabels.size === 0) {
    const hasInputs = Boolean(
      (typeof data.inputs?.val === "string" && data.inputs.val) ||
        (data.inputs?.vals && Object.keys(data.inputs.vals).length > 0)
    );
    const shouldDefaultSingleInput =
      (!hasExplicitNumInputs &&
        (n.type === "calculation" || n.type === "opCodeNode")) ||
      hasInputs;

    if (shouldDefaultSingleInput) registerHandle(0);
  }

  const inputs: PortInfo[] = Array.from(handleLabels.entries()).map(
    ([handleId, lbl]) => ({ label: lbl, handleId })
  );

  return {
    id: n.id,
    label,
    functionName: data.functionName,
    outputs,
    inputs,
  };
}
