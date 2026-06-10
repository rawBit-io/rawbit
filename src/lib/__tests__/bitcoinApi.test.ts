import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCommandLine, sendBitcoinCommand } from "@/lib/bitcoin/api";

describe("parseCommandLine", () => {
  it("parses a bare method", () => {
    expect(parseCommandLine("getblockchaininfo")).toEqual({
      method: "getblockchaininfo",
      params: [],
    });
  });

  it("returns null for empty input", () => {
    expect(parseCommandLine("")).toBeNull();
    expect(parseCommandLine("   ")).toBeNull();
  });

  it("coerces numeric and boolean params", () => {
    expect(parseCommandLine("getblockhash 0")).toEqual({
      method: "getblockhash",
      params: [0],
    });
    expect(parseCommandLine("getrawtransaction abc123 true")).toEqual({
      method: "getrawtransaction",
      params: ["abc123", true],
    });
    expect(parseCommandLine("sendtoaddress bcrt1qxyz 0.5")).toEqual({
      method: "sendtoaddress",
      params: ["bcrt1qxyz", 0.5],
    });
  });

  it("keeps quoted strings intact", () => {
    expect(parseCommandLine('createwallet "my wallet"')).toEqual({
      method: "createwallet",
      params: ["my wallet"],
    });
  });

  it("parses quoted JSON arguments", () => {
    expect(
      parseCommandLine(
        `createrawtransaction '[{"txid":"ab","vout":0}]' '{"bcrt1q":0.1}'`,
      ),
    ).toEqual({
      method: "createrawtransaction",
      params: [[{ txid: "ab", vout: 0 }], { bcrt1q: 0.1 }],
    });
  });

  it("strips a pasted bitcoin-cli prefix and its flags", () => {
    expect(
      parseCommandLine("bitcoin-cli -regtest -rpcwallet=dev getbalance"),
    ).toEqual({ method: "getbalance", params: [] });
  });

  it("keeps leading-zero hex tokens as strings", () => {
    expect(parseCommandLine("decoderawtransaction 0200000001ab")).toEqual({
      method: "decoderawtransaction",
      params: ["0200000001ab"],
    });
  });

  it("keeps quoted digit strings as strings", () => {
    expect(parseCommandLine('createwallet "12345"')).toEqual({
      method: "createwallet",
      params: ["12345"],
    });
  });

  it("keeps oversized integers as strings instead of losing precision", () => {
    expect(parseCommandLine("x 123456789012345678901")).toEqual({
      method: "x",
      params: ["123456789012345678901"],
    });
  });

  it("does not treat a quoted -flag as a bitcoin-cli flag", () => {
    expect(parseCommandLine('bitcoin-cli "-weird-arg"')).toEqual({
      method: "-weird-arg",
      params: [],
    });
  });
});

describe("sendBitcoinCommand error normalization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns a flat string backend error into a readable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: "rate_limited" }),
      })),
    );
    const reply = await sendBitcoinCommand("getblockcount", []);
    expect(reply.error?.message).toMatch(/slow down/i);
  });

  it("passes through a structured bitcoind error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ error: { code: -8, message: "out of range" } }),
      })),
    );
    const reply = await sendBitcoinCommand("getblockhash", [999999]);
    expect(reply.error).toEqual({ code: -8, message: "out of range" });
  });
});
