import type { OutputPortDefinition } from "@/types";

export const TX_FIELD_EXTRACT_OPTIONS = [
  "txid",
  "version",
  "locktime",
  "input_count",
  "output_count",
  "vin.txid",
  "vin.vout",
  "vin.scriptSig",
  "vin.sequence",
  "vout.value",
  "vout.scriptPubKey",
  "op_return.data",
  "raw_no_witness",
] as const;

export const DEFAULT_TX_FIELD_EXTRACT_FIELDS = [
  "txid",
  "vout.scriptPubKey",
] as const;

export const TX_FIELD_EXTRACT_MAX_OUTPUTS = 12;

export function normalizeTxFieldExtractFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_TX_FIELD_EXTRACT_FIELDS];

  const fields = value
    .map((field) => String(field ?? "").trim())
    .filter((field) => field.length > 0);

  return fields.length ? fields : [...DEFAULT_TX_FIELD_EXTRACT_FIELDS];
}

export function nextTxFieldExtractField(currentCount: number): string {
  const defaults = [
    ...DEFAULT_TX_FIELD_EXTRACT_FIELDS,
    "vout.value",
    "op_return.data",
    "vin.txid",
    "vin.vout",
    "input_count",
    "output_count",
  ];
  return defaults[currentCount] ?? "txid";
}

export function buildTxFieldExtractOutputPorts(
  fields: string[]
): OutputPortDefinition[] {
  return fields.map((field, index) => ({
    label: field || `field ${index + 1}`,
    handleId: `output-${index}`,
    showLabel: false,
  }));
}
