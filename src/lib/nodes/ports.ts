import type { NodePorts, PortInfo } from "@/lib/nodes/connectActions";
import type { FlowNode, InputStructure, FieldDefinition } from "@/types";
import { isCalculableNode } from "@/lib/flow/nonCalculableNodes";
import { INSTANCE_STRIDE } from "@/lib/utils";
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
  const isMultiVal = (data.paramExtraction ?? "single_val") === "multi_val";

  // Dropdown (options) fields and unconnectable fields render no handle, so
  // they must never be offered as connect targets.
  const isConnectableField = (field: FieldDefinition) =>
    !field.unconnectable && !field.options?.length;

  const ungrouped = inputStructure?.ungrouped ?? [];
  ungrouped.forEach((field) => {
    if (isConnectableField(field)) registerHandle(field.index, field.label);
  });

  const groups = inputStructure?.groups ?? [];
  const instanceKeys = data.groupInstanceKeys ?? {};

  groups.forEach((group) => {
    // Fall back to the groupInstances COUNT when groupInstanceKeys is absent,
    // mirroring the renderer (CalculationNodeView) and fieldUtils. Otherwise a
    // legacy/un-migrated node renders handles the Connect dialog can't offer as
    // targets (NB-03).
    const keys = instanceKeys[group.title];
    const bases =
      keys && keys.length
        ? keys
        : Array.from(
            { length: data.groupInstances?.[group.title] ?? 0 },
            (_, i) => group.baseIndex + i * INSTANCE_STRIDE
          );
    bases.forEach((base) => {
      group.fields.forEach((field) => {
        if (isConnectableField(field)) {
          registerHandle(base + field.index, field.label);
        }
      });
    });

    const helpers: FieldDefinition[] =
      inputStructure?.betweenGroups?.[group.title] ?? [];
    helpers.forEach((field) => {
      if (isConnectableField(field)) registerHandle(field.index, field.label);
    });
  });

  const afterGroups = inputStructure?.afterGroups ?? [];
  afterGroups.forEach((field) => {
    if (isConnectableField(field)) registerHandle(field.index, field.label);
  });

  // Contiguous numInputs fallback only applies to legacy nodes without an
  // inputStructure; structured nodes use sparse field indices, so the
  // fallback would invent phantom ports that no rendered handle backs.
  // The iteration count is capped because numInputs can come from imported
  // (untrusted) JSON — validateFlowData rejects out-of-range values, but
  // buildPorts must not freeze the tab even if called before validation.
  if (hasExplicitNumInputs && (numInputs as number) > 0 && !inputStructure) {
    const boundedNumInputs = Math.min(numInputs as number, 4096);
    for (let i = 0; i < boundedNumInputs; i += 1) {
      if (!handleLabels.has(`input-${i}`)) {
        registerHandle(i);
      }
    }
  }

  // The read-only Script Viewer always exposes exactly one input handle,
  // independent of its data shape, so the renderer, validator, edge-prune and
  // Connect dialog can never disagree about whether input-0 exists.
  if (n.type === "scriptViewer" && !handleLabels.has("input-0")) {
    registerHandle(0, "SCRIPT HEX:");
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

  // Single-val nodes that declare zero inputs (e.g. identity 'Input',
  // 'Random 32 Bytes') render no target handle at all.
  const acceptsNoInputs = hasExplicitNumInputs && numInputs === 0 && !isMultiVal;

  const inputs: PortInfo[] = acceptsNoInputs
    ? []
    : Array.from(handleLabels.entries()).map(([handleId, lbl]) => ({
        label: lbl,
        handleId,
      }));

  return {
    id: n.id,
    label,
    functionName: data.functionName,
    outputs,
    inputs,
  };
}
