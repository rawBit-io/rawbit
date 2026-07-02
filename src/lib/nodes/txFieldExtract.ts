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

/** Field options for the self-parsing TX Parser node (all tx types). */
export const TX_PARSE_FIELD_OPTIONS = [
  "txid",
  "wtxid",
  "version",
  "marker_flag",
  "locktime",
  "input_count",
  "output_count",
  "size",
  "vsize",
  "weight",
  "vin.txid",
  "vin.vout",
  "vin.scriptSig",
  "vin.sequence",
  "vin.witness",
  "vin.witness_count",
  "vin.witness.item0",
  "vin.witness.item1",
  "vin.witness.item2",
  "vin.witness.item3",
  "vin.witness.last",
  "vout.value",
  "vout.scriptPubKey",
  "op_return.data",
  "raw_no_witness",
] as const;

export const DEFAULT_TX_FIELD_EXTRACT_FIELDS = [
  "txid",
  "vout.scriptPubKey",
] as const;

export const DEFAULT_TX_PARSE_FIELDS = [
  "txid",
  "wtxid",
  "vin.witness",
] as const;

export const TX_FIELD_EXTRACT_MAX_OUTPUTS = 12;

/**
 * Sentinel dropdown value for the TX Parser's "advanced" row: selecting it
 * reveals a free-text field so power users can type any field the backend
 * accepts (e.g. a deep witness item `vin.witness.item7`) without needing a
 * dedicated dropdown entry. Not a real field name.
 */
export const TX_EXTRACT_CUSTOM_FIELD = "__custom__";

/** True when `field` is not one of the node's enumerated dropdown options. */
export function isCustomTxExtractField(
  field: string,
  functionName?: string
): boolean {
  if (functionName !== "parse_tx_field") return false;
  return !TX_PARSE_FIELD_OPTIONS.includes(
    field as (typeof TX_PARSE_FIELD_OPTIONS)[number]
  );
}

/**
 * Both dynamic TX extractors (legacy-field extract_tx_field and the
 * self-parsing parse_tx_field) share the txExtractFields / output-N /
 * outputValues plumbing.
 */
export function isDynamicTxExtractFunction(functionName?: string): boolean {
  return (
    functionName === "extract_tx_field" || functionName === "parse_tx_field"
  );
}

export function txExtractOptionsForFunction(
  functionName?: string
): readonly string[] {
  return functionName === "parse_tx_field"
    ? TX_PARSE_FIELD_OPTIONS
    : TX_FIELD_EXTRACT_OPTIONS;
}

function defaultTxExtractFieldsFor(functionName?: string): readonly string[] {
  return functionName === "parse_tx_field"
    ? DEFAULT_TX_PARSE_FIELDS
    : DEFAULT_TX_FIELD_EXTRACT_FIELDS;
}

export function normalizeTxFieldExtractFields(
  value: unknown,
  functionName?: string
): string[] {
  const defaults = defaultTxExtractFieldsFor(functionName);
  if (!Array.isArray(value)) return [...defaults];

  const fields = value
    .map((field) => String(field ?? "").trim())
    .filter((field) => field.length > 0);

  return fields.length ? fields : [...defaults];
}

export function nextTxFieldExtractField(
  currentCount: number,
  functionName?: string
): string {
  const defaults =
    functionName === "parse_tx_field"
      ? [
          ...DEFAULT_TX_PARSE_FIELDS,
          "vin.witness_count",
          "vin.witness.item0",
          "vin.witness.last",
          "vout.scriptPubKey",
          "vout.value",
          "weight",
        ]
      : [
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
