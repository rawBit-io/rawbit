import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ScriptExecutionSteps from "../ScriptExecutionSteps";

const baseSteps = [
  {
    pc: 0,
    opcode: 118,
    opcode_name: "OP_DUP",
    stack_before: ["02"],
    stack_after: ["02", "02"],
    phase: "scriptSig",
  },
  {
    pc: 1,
    opcode: 136,
    opcode_name: "OP_EQUALVERIFY",
    stack_before: ["01", "01"],
    stack_after: [],
    phase: "scriptPubKey",
  },
];

const scriptResult = {
  isValid: true,
  steps: baseSteps,
};

describe("ScriptExecutionSteps", () => {
  beforeEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("navigates between steps and shows phase information", async () => {
    const user = userEvent.setup();

    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={scriptResult}
        scriptSigInputHex="76"
        scriptPubKeyInputHex="88"
      />
    );

    expect(screen.getByText(/Step 1\/2 — Phase 1/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText(/Step 2\/2 — Phase 2/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Prev/i }));
    expect(screen.getByText(/Step 1\/2 — Phase 1/i)).toBeInTheDocument();
  });

  it("shows taproot witness details even without an explicit witnessStack", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          steps: [
            {
              pc: -1,
              opcode: 0,
              opcode_name: "taproot_schnorr_verify",
              stack_before: ["aa", "bbcc"],
              stack_after: ["01"],
              phase: "taproot",
            },
          ],
        }}
      />
    );

    expect(screen.getByText(/Phase 4 \(taproot\)/i)).toBeInTheDocument();
    expect(screen.getByText(/witnessStack/i)).toBeInTheDocument();
    expect(screen.getAllByText("bbcc").length).toBeGreaterThan(0);
  });

  it("hides witnessStack when witnessScript is present (segwit/script-path)", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          witnessScript: "76a91488ac",
          witnessStack: ["aa", "bb"],
          steps: [
            {
              pc: 0,
              opcode: 0,
              opcode_name: "OP_0",
              stack_before: [],
              stack_after: ["aa", "bb"],
              phase: "witnessScript",
            },
          ],
        }}
      />
    );

    expect(screen.queryByText(/witnessStack/i)).not.toBeInTheDocument();
  });

  it("explains direct push opcodes by byte count", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          steps: [
            {
              pc: 0,
              opcode: 2,
              opcode_name: "PUSH 2 bytes",
              stack_before: [],
              stack_after: ["abcd"],
              phase: "scriptSig",
            },
          ],
        }}
        scriptSigInputHex="02abcd"
        scriptPubKeyInputHex=""
      />
    );

    expect(screen.getByText("PUSH 2 bytes")).toBeInTheDocument();
    expect(screen.getByText(/Push raw bytes onto the stack/i)).toBeInTheDocument();
  });

  it("shows a taproot key-path explainer banner", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          steps: [
            { pc: -1, opcode: 0, opcode_name: "taproot_witness", stack_before: ["aa"], stack_after: ["aa"], phase: "taproot" },
            { pc: -1, opcode: 0, opcode_name: "taproot_schnorr_verify", stack_before: ["aa"], stack_after: ["01"], phase: "taproot" },
          ],
          witnessStack: ["aa"],
        }}
      />
    );

    expect(
      screen.getByText(/Taproot key-path spend: no witnessScript/i)
    ).toBeInTheDocument();
  });

  it("copies the trace to the clipboard with feedback", async () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={scriptResult}
        scriptSigInputHex="76"
        scriptPubKeyInputHex="88"
      />
    );

    const copyButton = screen.getByRole("button", { name: /Copy All/i });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    const writeCall = (navigator.clipboard.writeText as unknown as Mock).mock
      .results.at(-1)?.value;
    if (writeCall instanceof Promise) {
      await act(async () => {
        await writeCall;
      });
    }

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Step #0")
    );
    await screen.findByRole("button", { name: /Copied!/i });
  });

  it("renders an empty-state message when no steps are available", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{ isValid: false, steps: [] }}
        scriptSigInputHex=""
        scriptPubKeyInputHex=""
      />
    );

    expect(screen.getByText(/No script trace available/i)).toBeInTheDocument();
  });
});
