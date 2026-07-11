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

  it("labels a legacy cached P2WPKH trace as scriptCode", () => {
    const hash = "11".repeat(20);
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          scriptPubKey: `0014${hash}`,
          witnessScript: `76a914${hash}88ac`,
          witnessStack: ["aa", "bb"],
          steps: [
            {
              pc: -1,
              opcode_name: "witness_script",
              step: "witness_script",
              script_hex: `76a914${hash}88ac`,
              stack_before: ["aa", "bb"],
              stack_after: ["aa", "bb"],
              phase: "witnessScript",
            },
            {
              pc: 0,
              opcode: 118,
              opcode_name: "OP_DUP",
              stack_before: ["aa", "bb"],
              stack_after: ["aa", "bb", "bb"],
              phase: "witnessScript",
            },
          ],
        }}
      />
    );

    // the old pc:-1 pseudo-step renders as a validator rule
    expect(screen.getByText("Rule:")).toBeInTheDocument();
    expect(screen.getByText(/Load the witness stack/i)).toBeInTheDocument();
    // old labeling contract is preserved for cached traces
    expect(screen.getByText(/Phase 4 \(scriptCode\)/i)).toBeInTheDocument();
    expect(
      screen.getByTestId("scriptCode-script-pane")
    ).toHaveTextContent(/scriptCode/);
    // the serialized witness pane replaces the old witnessStack list
    expect(screen.getByTestId("witness-pane")).toBeInTheDocument();
    expect(screen.queryByText(/witnessStack/i)).not.toBeInTheDocument();
  });

  const nativeP2wpkhHash = "11".repeat(20);
  const nativeP2wpkhResult = {
    isValid: true,
    scriptPubKey: `0014${nativeP2wpkhHash}`,
    scriptCode: `76a914${nativeP2wpkhHash}88ac`,
    usesWitness: true,
    witnessStack: ["aa", "bb"],
    steps: [
      {
        pc: 0,
        opcode: 0,
        opcode_name: "OP_0",
        stack_before: [],
        stack_after: [""],
        phase: "scriptPubKey",
      },
      {
        pc: 1,
        opcode: 20,
        opcode_name: "PUSH 20 bytes",
        stack_before: [""],
        stack_after: ["", nativeP2wpkhHash],
        phase: "scriptPubKey",
      },
      {
        pc: -1,
        opcode_name: "witness_program_match",
        kind: "validator" as const,
        step: "witness_program_match",
        program_hex: nativeP2wpkhHash,
        stack_before: [],
        stack_after: [],
        phase: "witness",
      },
      {
        pc: -1,
        opcode_name: "witness item 1/2",
        kind: "validator" as const,
        step: "witness_load",
        witness_index: 0,
        witness_total: 2,
        stack_before: [],
        stack_after: ["aa"],
        phase: "witness",
      },
      {
        pc: -1,
        opcode_name: "witness item 2/2",
        kind: "validator" as const,
        step: "witness_load",
        witness_index: 1,
        witness_total: 2,
        stack_before: ["aa"],
        stack_after: ["aa", "bb"],
        phase: "witness",
      },
      {
        pc: -1,
        opcode_name: "scriptcode_derive",
        kind: "validator" as const,
        step: "scriptcode_derive",
        script_hex: `76a914${nativeP2wpkhHash}88ac`,
        program_hex: nativeP2wpkhHash,
        stack_before: ["aa", "bb"],
        stack_after: ["aa", "bb"],
        phase: "witness",
      },
      {
        pc: 0,
        opcode: 118,
        opcode_name: "OP_DUP",
        stack_before: ["aa", "bb"],
        stack_after: ["aa", "bb", "bb"],
        phase: "witnessScript",
      },
    ],
  };

  it("walks a native P2WPKH trace as opcode steps only, P2SH-style", async () => {
    const user = userEvent.setup();
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={nativeP2wpkhResult}
      />
    );

    // validator bookkeeping steps (phase "witness") are not walked:
    // 2 scriptPubKey opcodes + 1 scriptCode opcode remain
    expect(screen.getByText(/Step 1\/3 — Phase 2 \(scriptPubKey\)/i)).toBeInTheDocument();

    // the empty scriptSig field stays visible with a short origin note
    expect(screen.getByTestId("scriptSig-empty-pane")).toHaveTextContent(
      /unlocking data moved to the witness/i
    );
    // serialized witness pane, labeled as data
    expect(screen.getByTestId("witness-pane")).toHaveTextContent(
      /not a script/i
    );
    // scriptCode pane is always visible with a short derivation note
    expect(screen.getByTestId("scriptCode-script-pane")).toHaveTextContent(
      /never transmitted/i
    );

    // step 1: no note yet
    expect(
      screen.queryByText(/valid under their rules/i)
    ).not.toBeInTheDocument();

    const nextButton = screen.getByRole("button", { name: /Next/i });
    await user.click(nextButton);

    // step 2 (last old-rules step): the old-nodes verdict note
    expect(
      screen.getByText(/valid under their rules/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/witness items become the new stack/i)
    ).not.toBeInTheDocument();

    await user.click(nextButton);

    // final step: plain opcode chrome inside the derived scriptCode, with
    // the one-time second-run note explaining the fresh-stack jump
    expect(screen.getByText("Opcode:")).toBeInTheDocument();
    expect(screen.getByText("OP_DUP")).toBeInTheDocument();
    expect(
      screen.getByText(/witness items become the new stack/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/valid under their rules/i)
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Step 3\/3 — Phase 4 \(scriptCode\)/i)
    ).toBeInTheDocument();
    expect(nextButton).toBeDisabled();

    // no rule steps surface in the walk
    expect(screen.queryByText("Rule:")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Witness validation/i)
    ).not.toBeInTheDocument();
  });

  it("labels a P2WSH execution as witnessScript and skips the check steps", () => {
    const program = "ab".repeat(32);
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          scriptPubKey: `0020${program}`,
          witnessScript: "51",
          usesWitness: true,
          witnessStack: ["51"],
          steps: [
            {
              pc: -1,
              opcode_name: "witness item 1/1",
              kind: "validator",
              step: "witness_load",
              witness_index: 0,
              witness_total: 1,
              stack_before: [],
              stack_after: ["51"],
              phase: "witness",
            },
            {
              pc: -1,
              opcode_name: "witness_script_check",
              kind: "validator",
              step: "witness_script_check",
              script_hex: "51",
              sha256_hex: program,
              program_hex: program,
              stack_before: ["51"],
              stack_after: [],
              phase: "witness",
            },
            {
              pc: 0,
              opcode: 81,
              opcode_name: "OP_1",
              stack_before: [],
              stack_after: ["01"],
              phase: "witnessScript",
            },
          ],
        }}
      />
    );

    // only the opcode step is walked
    expect(
      screen.getByText(/Step 1\/1 — Phase 4 \(witnessScript\)/i)
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("witnessScript-script-pane")
    ).toHaveTextContent(/last witness item/i);
    expect(screen.queryByText("Rule:")).not.toBeInTheDocument();
  });

  it("exports the walked steps and the derived scriptCode via Copy All", async () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={nativeP2wpkhResult}
      />
    );

    const copyButton = screen.getByRole("button", { name: /Copy All/i });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    const written = (navigator.clipboard.writeText as unknown as Mock).mock
      .calls.at(-1)?.[0] as string;
    // numbering matches the on-screen walk (witness bookkeeping excluded)
    expect(written).toContain("Step #3");
    expect(written).not.toContain("Step #4");
    expect(written).not.toContain("RULE(");
    expect(written).toContain(
      `scriptCode (BIP143, derived — never transmitted): 76a914${nativeP2wpkhHash}88ac`
    );
    expect(written).toContain("witnessStack: [aa, bb]");
  });

  it("labels a Taproot script-path execution as tapscript", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          scriptPubKey: `5120${"11".repeat(32)}`,
          witnessScript: "51",
          steps: [
            {
              pc: 0,
              opcode: 81,
              opcode_name: "OP_1",
              stack_before: [],
              stack_after: ["01"],
              phase: "witnessScript",
            },
          ],
        }}
      />
    );

    expect(screen.getByText(/Phase 4 \(tapscript\)/i)).toBeInTheDocument();
    expect(screen.getByTestId("tapscript-script-pane")).toHaveTextContent(
      "tapscript:"
    );
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

  it("derives P2SH redeemScript from trace and highlights it during phase 3", async () => {
    const user = userEvent.setup();
    const signature = "aa".repeat(71);
    const redeemScript = "6351ac68"; // OP_IF OP_1 OP_CHECKSIG OP_ENDIF
    const p2shHash = "11".repeat(20);
    const p2shScriptPubKey = `a914${p2shHash}87`;
    const scriptSig = `47${signature}0004${redeemScript}`;

    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          scriptSig,
          scriptPubKey: p2shScriptPubKey,
          steps: [
            {
              pc: 0,
              opcode: 71,
              opcode_name: "PUSH 71 bytes",
              stack_before: [],
              stack_after: [signature],
              phase: "scriptSig",
            },
            {
              pc: 72,
              opcode: 0,
              opcode_name: "OP_0",
              stack_before: [signature],
              stack_after: [signature, ""],
              phase: "scriptSig",
            },
            {
              pc: 73,
              opcode: 4,
              opcode_name: "PUSH 4 bytes",
              stack_before: [signature, ""],
              stack_after: [signature, "", redeemScript],
              phase: "scriptSig",
            },
            {
              pc: 0,
              opcode: 169,
              opcode_name: "OP_HASH160",
              stack_before: [signature, "", redeemScript],
              stack_after: [signature, "", p2shHash],
              phase: "scriptPubKey",
            },
            {
              pc: 1,
              opcode: 20,
              opcode_name: "PUSH 20 bytes",
              stack_before: [signature, "", p2shHash],
              stack_after: [signature, "", p2shHash, p2shHash],
              phase: "scriptPubKey",
            },
            {
              pc: 22,
              opcode: 135,
              opcode_name: "OP_EQUAL",
              stack_before: [signature, "", p2shHash, p2shHash],
              stack_after: [signature, "", "01"],
              phase: "scriptPubKey",
            },
            {
              pc: 0,
              opcode: 99,
              opcode_name: "OP_IF",
              stack_before: [signature, ""],
              stack_after: [signature],
              phase: "redeemScript",
            },
          ],
        }}
      />
    );

    expect(screen.getByTestId("scriptSig-script-pane")).toBeInTheDocument();
    expect(screen.getByTestId("scriptPubKey-script-pane")).toBeInTheDocument();
    expect(screen.getByTestId("redeemScript-script-pane")).toHaveTextContent(
      redeemScript
    );

    const nextButton = screen.getByRole("button", { name: /Next/i });
    for (let i = 0; i < 6; i += 1) {
      await user.click(nextButton);
    }

    expect(
      screen.getByText(/Step 7\/7 — Phase 3 \(redeemScript\)/i)
    ).toBeInTheDocument();
    const redeemPane = screen.getByTestId("redeemScript-script-pane");
    expect(
      redeemPane.querySelector(".field-surface .font-semibold.text-primary")
    ).toHaveTextContent("63");
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
