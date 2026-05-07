import type { NodeData } from "@/types";

export const OPCODE_INPUT_INDEX_STEP = 100;

const readOpcodeNamesFromVals = (
  vals: NodeData["inputs"] extends { vals?: infer TVals } ? TVals : unknown
): string[] => {
  if (Array.isArray(vals)) {
    return vals
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  }

  if (vals && typeof vals === "object") {
    return Object.entries(vals as Record<string, unknown>)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, value]) => String(value ?? "").trim())
      .filter(Boolean);
  }

  return [];
};

export function getOpcodeInputNames(data: Partial<NodeData>): string[] {
  const namesFromVals = readOpcodeNamesFromVals(data.inputs?.vals);
  if (namesFromVals.length > 0) return namesFromVals;

  const legacyNames = data.opSequenceNames;
  return Array.isArray(legacyNames)
    ? legacyNames
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    : [];
}

export function buildOpcodeInputState(names: string[]): Pick<
  NodeData,
  "functionName" | "paramExtraction" | "inputs" | "inputStructure" | "numInputs" | "groupInstances" | "groupInstanceKeys"
> {
  const cleanNames = names.map((name) => name.trim()).filter(Boolean);

  return {
    functionName: "op_code_select",
    paramExtraction: "multi_val",
    inputs: {
      vals: Object.fromEntries(
        cleanNames.map((name, index) => [
          index * OPCODE_INPUT_INDEX_STEP,
          name,
        ])
      ),
    },
    inputStructure: {
      ungrouped: cleanNames.map((_, index) => ({
        index: index * OPCODE_INPUT_INDEX_STEP,
        label: "Opcode:",
        rows: 1,
        unconnectable: true,
      })),
      groups: [],
      betweenGroups: {},
      afterGroups: [],
    },
    numInputs: cleanNames.length,
    groupInstances: {},
    groupInstanceKeys: {},
  };
}

export function normalizeOpcodeNodeData(data: NodeData): NodeData {
  const names = getOpcodeInputNames(data);
  const rest = { ...data };
  delete rest.opSequenceNames;
  delete rest.value;

  return {
    ...rest,
    ...buildOpcodeInputState(names),
    result: typeof data.result === "string" ? data.result : "",
  };
}
