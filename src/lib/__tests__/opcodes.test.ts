import { describe, expect, it } from "vitest";
import { OP_CODES } from "@/lib/opcodes";

const findOpcode = (name: string) =>
  Object.values(OP_CODES)
    .flat()
    .filter((opcode) => opcode.name === name);

describe("opcode catalog descriptions", () => {
  it("describes OP_WITHIN with the correct x/min/max relation", () => {
    expect(findOpcode("OP_WITHIN")).toEqual([
      expect.objectContaining({
        description: "Checks x in range min <= x < max",
      }),
    ]);
  });

  it("does not describe OP_RETURN as invalidating the whole transaction", () => {
    for (const opcode of findOpcode("OP_RETURN")) {
      expect(opcode.description).toMatch(/Fails the script|unspendable/i);
      expect(opcode.description).not.toMatch(/transaction invalid/i);
    }
  });
});
