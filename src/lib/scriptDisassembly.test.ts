import { describe, it, expect } from "vitest";
import {
  parseScriptDisassembly,
  OPCODE_NAME_BY_BYTE,
} from "./scriptDisassembly";
import opcodeNameByByte from "./__fixtures__/opcodeNameByByte.json";

const seq = (r: ReturnType<typeof parseScriptDisassembly>) =>
  r.lines.map((l) => [l.text, l.depth] as const);

describe("parseScriptDisassembly", () => {
  it("disassembles an HTLC redeemScript with correct IF/ELSE indentation", () => {
    const hash32 = "aa".repeat(32);
    const pk33 = "02" + "bb".repeat(32);
    const lock4 = "a721316a";
    // OP_IF OP_SHA256 <32> OP_EQUALVERIFY <33> OP_CHECKSIG
    //   OP_ELSE <4> OP_CHECKLOCKTIMEVERIFY OP_DROP <33> OP_CHECKSIG OP_ENDIF
    const hex =
      "63" + "a8" + "20" + hash32 + "88" + "21" + pk33 + "ac" +
      "67" + "04" + lock4 + "b1" + "75" + "21" + pk33 + "ac" + "68";

    const r = parseScriptDisassembly(hex);
    expect(r.ok).toBe(true);
    expect(seq(r)).toEqual([
      ["OP_IF", 0],
      ["OP_SHA256", 1],
      [hash32, 1],
      ["OP_EQUALVERIFY", 1],
      [pk33, 1],
      ["OP_CHECKSIG", 1],
      ["OP_ELSE", 0],
      [lock4, 1],
      ["OP_CHECKLOCKTIMEVERIFY", 1],
      ["OP_DROP", 1],
      [pk33, 1],
      ["OP_CHECKSIG", 1],
      ["OP_ENDIF", 0],
    ]);
  });

  it("renders small integers with canonical names", () => {
    const r = parseScriptDisassembly("005152600069");
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.text)).toEqual([
      "OP_0",
      "OP_1",
      "OP_2",
      "OP_16",
      "OP_0",
      "OP_VERIFY",
    ]);
  });

  it("handles nested IF and dedents ELSE/ENDIF to their opener", () => {
    // OP_IF OP_IF OP_1 OP_ELSE OP_2 OP_ENDIF OP_ENDIF
    const r = parseScriptDisassembly("6363516752" + "68" + "68");
    expect(seq(r)).toEqual([
      ["OP_IF", 0],
      ["OP_IF", 1],
      ["OP_1", 2],
      ["OP_ELSE", 1],
      ["OP_2", 2],
      ["OP_ENDIF", 1],
      ["OP_ENDIF", 0],
    ]);
  });

  it("does not throw on OP_ENDIF without a matching OP_IF (clamps depth)", () => {
    const r = parseScriptDisassembly("68");
    expect(r.ok).toBe(true);
    expect(seq(r)).toEqual([["OP_ENDIF", 0]]);
  });

  it("decodes OP_PUSHDATA1 and shows the real bytes", () => {
    const r = parseScriptDisassembly("4c04deadbeef");
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual([
      { depth: 0, text: "deadbeef", kind: "push", hex: "deadbeef" },
    ]);
  });

  it("decodes OP_PUSHDATA1 of a 32-byte blob as its hex", () => {
    const r = parseScriptDisassembly("4c20" + "cc".repeat(32));
    expect(r.ok).toBe(true);
    expect(r.lines[0].text).toBe("cc".repeat(32));
    expect(r.lines[0].hex).toBe("cc".repeat(32));
  });

  it("decodes OP_PUSHDATA2 with little-endian length", () => {
    const r = parseScriptDisassembly("4d0200dead");
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual([
      { depth: 0, text: "dead", kind: "push", hex: "dead" },
    ]);
  });

  it("flags non-hex input", () => {
    expect(parseScriptDisassembly("zz").ok).toBe(false);
    expect(parseScriptDisassembly("zz").error).toMatch(/valid hex/i);
  });

  it("flags odd-length hex", () => {
    const r = parseScriptDisassembly("abc");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/odd-length/i);
  });

  it("flags a truncated push", () => {
    const r = parseScriptDisassembly("0401"); // says 4 bytes, only 1 present
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/truncated/i);
  });

  it("surfaces unknown opcode bytes without aborting", () => {
    const r = parseScriptDisassembly("51ff52");
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => [l.text, l.kind])).toEqual([
      ["OP_1", "opcode"],
      ["UNKNOWN_0xff", "unknown"],
      ["OP_2", "opcode"],
    ]);
  });

  it("treats empty input as an empty (valid) script", () => {
    const r = parseScriptDisassembly("");
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual([]);
  });

  it("flags a truncated OP_PUSHDATA length prefix (no 'undefined' in message)", () => {
    const r = parseScriptDisassembly("4c"); // PUSHDATA1 with no length byte
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Truncated OP_PUSHDATA1 length prefix.");
    expect(r.error).not.toMatch(/undefined/);
  });

  it("flags truncated OP_PUSHDATA data (no 'undefined' in message)", () => {
    const r = parseScriptDisassembly("4d0400dead"); // wants 4 bytes, 2 present
    expect(r.ok).toBe(false);
    expect(r.error).toContain("OP_PUSHDATA2");
    expect(r.error).not.toMatch(/undefined/);
  });

  it("decodes OP_PUSHDATA4 with little-endian length", () => {
    const r = parseScriptDisassembly("4e04000000deadbeef");
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual([
      { depth: 0, text: "deadbeef", kind: "push", hex: "deadbeef" },
    ]);
  });

  it("renders zero-length pushes as (empty)", () => {
    expect(parseScriptDisassembly("4c00").lines[0].text).toBe("(empty)");
    expect(parseScriptDisassembly("4d0000").lines[0].text).toBe("(empty)");
  });

  it("normalizes whitespace and uppercase", () => {
    const r = parseScriptDisassembly(" 63\n A8\t68 ");
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.text)).toEqual(["OP_IF", "OP_SHA256", "OP_ENDIF"]);
  });

  it("handles consensus-legal consecutive OP_ELSE", () => {
    // OP_IF OP_1 OP_ELSE OP_2 OP_ELSE OP_3 OP_ENDIF
    const r = parseScriptDisassembly("635167526753" + "68");
    expect(r.ok).toBe(true);
    expect(seq(r)).toEqual([
      ["OP_IF", 0],
      ["OP_1", 1],
      ["OP_ELSE", 0],
      ["OP_2", 1],
      ["OP_ELSE", 0],
      ["OP_3", 1],
      ["OP_ENDIF", 0],
    ]);
  });

  it("keeps best-effort partial lines on a truncation error", () => {
    // OP_SHA256, then a direct push that is truncated
    const r = parseScriptDisassembly("a80401");
    expect(r.ok).toBe(false);
    expect(r.lines.map((l) => l.text)).toEqual(["OP_SHA256"]);
    expect(r.byteLength).toBe(3);
  });

  it("warns on unbalanced OP_IF (missing OP_ENDIF)", () => {
    const r = parseScriptDisassembly("6351");
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/missing OP_ENDIF/);
  });

  it("warns on OP_ENDIF without a matching OP_IF", () => {
    const r = parseScriptDisassembly("68");
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/without a matching OP_IF/);
  });

  it("names disabled/reserved opcodes instead of UNKNOWN", () => {
    const names = parseScriptDisassembly("7e95628450").lines.map((l) => l.text);
    expect(names).toEqual([
      "OP_CAT",
      "OP_MUL",
      "OP_VER",
      "OP_AND",
      "OP_RESERVED",
    ]);
  });

  it("still marks genuinely unassigned bytes as UNKNOWN", () => {
    // 0xbb is unassigned (below OP_SUCCESS range, above CHECKSIGADD)
    const r = parseScriptDisassembly("bb");
    expect(r.lines).toEqual([
      { depth: 0, text: "UNKNOWN_0xbb", kind: "unknown" },
    ]);
  });

  it("matches the shared byte->name parity fixture (locks TS/Python drift)", () => {
    const tsMap: Record<string, string> = {};
    for (const [byte, name] of OPCODE_NAME_BY_BYTE) {
      tsMap[byte.toString(16).padStart(2, "0")] = name;
    }
    expect(tsMap).toEqual(opcodeNameByByte);
  });
});
