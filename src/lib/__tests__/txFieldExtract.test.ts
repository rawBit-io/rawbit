import { describe, expect, it } from "vitest";
import {
  TX_PARSE_FIELD_OPTIONS,
  isCustomTxExtractField,
  nextTxFieldExtractField,
} from "@/lib/nodes/txFieldExtract";

describe("TX Parser field options", () => {
  it("exposes legacy scriptSig stack item fields", () => {
    expect(TX_PARSE_FIELD_OPTIONS).toEqual(
      expect.arrayContaining([
        "vin.scriptSig",
        "vin.scriptSig_count",
        "vin.scriptSig.item0",
        "vin.scriptSig.item1",
        "vin.scriptSig.item2",
        "vin.scriptSig.item3",
        "vin.scriptSig.last",
      ])
    );
  });

  it("suggests scriptSig stack fields before witness stack fields", () => {
    expect(nextTxFieldExtractField(3, "parse_tx_field")).toBe(
      "vin.scriptSig_count"
    );
    expect(nextTxFieldExtractField(4, "parse_tx_field")).toBe(
      "vin.scriptSig.item0"
    );
    expect(nextTxFieldExtractField(5, "parse_tx_field")).toBe(
      "vin.scriptSig.item1"
    );
    expect(nextTxFieldExtractField(6, "parse_tx_field")).toBe(
      "vin.scriptSig.last"
    );
  });

  it("still treats deeper scriptSig item fields as custom parser fields", () => {
    expect(isCustomTxExtractField("vin.scriptSig.item7", "parse_tx_field")).toBe(
      true
    );
  });
});
