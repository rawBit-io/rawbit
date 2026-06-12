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
    expect(screen.getByTestId("script-step-scroll")).not.toContainElement(
      screen.getByTestId("script-step-navigation")
    );

    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText(/Step 2\/2 — Phase 2/i)).toBeInTheDocument();
    expect(
      screen.getByText(/fail immediately if they differ/i)
    ).toBeInTheDocument();

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

  it("explains numeric equality without deprecated wording", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          steps: [
            {
              pc: 0,
              opcode: 156,
              opcode_name: "OP_NUMEQUAL",
              stack_before: ["02", "02"],
              stack_after: ["01"],
              phase: "scriptPubKey",
            },
          ],
        }}
      />
    );

    expect(
      screen.getByText(/Compare the top two numbers/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/deprecated/i)).not.toBeInTheDocument();
  });

  it("highlights the top pubkey and signature for OP_CHECKSIGVERIFY with duplicate pubkeys", () => {
    const pubkey =
      "027bbae0eec6b6cc26292379c0f8ef6b343fced478735d92da0f2a3a52a93ddc47";
    const signature =
      "304402205f938ff2ae3a47116c64adbc306eae6c806df1fc5a5e03be3d63f0123dfa146802207c27b37ecae9d91f24659ba3df2cf41bc78a2fba38738b0f09c44021d6ec608f01";

    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          steps: [
            {
              pc: 1,
              opcode: 173,
              opcode_name: "OP_CHECKSIGVERIFY",
              stack_before: [pubkey, signature, pubkey],
              stack_after: [pubkey],
              phase: "scriptPubKey",
            },
          ],
        }}
      />
    );

    const stackBeforeTitle = screen.getByText("Stack Before (top → first)");
    const stackBeforeColumn = stackBeforeTitle.parentElement as HTMLElement;
    const rows = Array.from(
      stackBeforeColumn.querySelectorAll(".field-surface")
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(pubkey);
    expect(rows[1]).toHaveTextContent(signature);
    expect(rows[2]).toHaveTextContent(pubkey);
    expect(rows[0]).toHaveClass("font-semibold");
    expect(rows[1]).toHaveClass("font-semibold");
    expect(rows[2]).not.toHaveClass("font-semibold");
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

  it("summarizes verification failure without duplicating the raw final error", async () => {
    const user = userEvent.setup();
    const failedSteps = Array.from({ length: 7 }, (_, index) => ({
      pc: index,
      opcode: index === 6 ? 172 : 118,
      opcode_name: index === 6 ? "OP_CHECKSIG" : "OP_DUP",
      stack_before: index === 6 ? ["03", "30"] : ["02"],
      stack_after: index === 6 ? ["03", "30"] : ["02", "02"],
      phase: index === 0 ? "scriptSig" : "scriptPubKey",
      failed: index === 6,
      error:
        index === 6
          ? "signature check failed, and signature is not empty"
          : undefined,
    }));

    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: false,
          error:
            "signature check failed, and signature is not empty (Note: SegWit/Taproot verification requires the spent amount in satoshis)",
          steps: failedSteps,
        }}
        scriptSigInputHex="47"
        scriptPubKeyInputHex="ac"
      />
    );

    expect(
      screen.getByText("FAILED STEP 7: OP_CHECKSIG")
    ).toBeInTheDocument();
    expect(screen.getByText("FAILED STEP 7: OP_CHECKSIG")).toHaveClass(
      "script-execution-error"
    );
    expect(screen.queryByText(/FinalError:/i)).not.toBeInTheDocument();

    const nextButton = screen.getByRole("button", { name: /Next/i });
    for (let i = 0; i < 6; i += 1) {
      await user.click(nextButton);
    }

    expect(screen.getByText("Failed")).toHaveClass("script-execution-error");
    expect(screen.getByText(/signature check failed/i)).toBeInTheDocument();
    expect(screen.getByText(/signature check failed/i)).toHaveClass(
      "script-execution-error"
    );
    const explanation = screen.getByText(
      /Check a signature against a public key/i
    );
    const stepError = screen.getByText(/signature check failed/i);
    const stackBefore = screen.getByText("Stack Before (top → first)");
    expect(
      stepError.compareDocumentPosition(explanation) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      stepError.compareDocumentPosition(stackBefore) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
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

    // numbering matches the dialog's 1-based "Step N/M" indicator
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Step #1")
    );
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith(
      expect.stringContaining("Step #0")
    );
    await screen.findByRole("button", { name: /Copied!/i });
  });

  it("survives the trace shrinking while the dialog is open", async () => {
    const user = userEvent.setup();
    const longSteps = Array.from({ length: 7 }, (_, index) => ({
      pc: index,
      opcode: 118,
      opcode_name: "OP_DUP",
      stack_before: ["02"],
      stack_after: ["02", "02"],
      phase: "scriptPubKey",
    }));

    const { rerender } = render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{ isValid: true, steps: longSteps }}
        scriptSigInputHex="76"
        scriptPubKeyInputHex="88"
      />
    );

    const nextButton = screen.getByRole("button", { name: /Next/i });
    for (let i = 0; i < 6; i += 1) {
      await user.click(nextButton);
    }
    expect(screen.getByText(/Step 7\/7/i)).toBeInTheDocument();

    // a recalculation replaces the trace with a shorter one
    rerender(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{ isValid: false, steps: longSteps.slice(0, 3) }}
        scriptSigInputHex="76"
        scriptPubKeyInputHex="88"
      />
    );

    expect(screen.getByText(/Step 1\/3/i)).toBeInTheDocument();
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
