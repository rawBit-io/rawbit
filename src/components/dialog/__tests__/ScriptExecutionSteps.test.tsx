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

  it("walks a native P2WPKH trace: scriptPubKey opcodes, the derivation rule, then the scriptCode", async () => {
    const user = userEvent.setup();
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={nativeP2wpkhResult}
      />
    );

    // pure bookkeeping (witness_program_match, witness_load) stays hidden;
    // the scriptCode-derivation rule is walked: 2 scriptPubKey opcodes +
    // 1 derive rule + 1 scriptCode opcode = 4 steps
    expect(screen.getByText(/Step 1\/4 — Phase 2 \(scriptPubKey\)/i)).toBeInTheDocument();

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

    // step 2 (last scriptPubKey step): the old-nodes verdict note
    expect(
      screen.getByText(/valid under their rules/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/witness items become the new stack/i)
    ).not.toBeInTheDocument();

    await user.click(nextButton);

    // step 3: the scriptCode-derivation rule is now a walkable Rule step
    expect(screen.getByText("Rule:")).toBeInTheDocument();
    expect(
      screen.getByText(/Derive scriptCode from the witness program/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Step 3\/4 — Witness validation/i)
    ).toBeInTheDocument();

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
      screen.getByText(/Step 4\/4 — Phase 4 \(scriptCode\)/i)
    ).toBeInTheDocument();
    expect(nextButton).toBeDisabled();
  });

  it("walks the P2WSH hash-check rule then the witnessScript, hiding item load", () => {
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

    // witness_load is hidden; the hash-check rule + the opcode are walked
    expect(
      screen.getByText(/Step 1\/2 — Witness validation/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Rule:")).toBeInTheDocument();
    expect(screen.getByText(/Hash-check the witnessScript/i)).toBeInTheDocument();
    expect(
      screen.getByTestId("witnessScript-script-pane")
    ).toHaveTextContent(/last witness item/i);
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
    // numbering matches the on-screen walk: 4 steps incl. the derive rule
    expect(written).toContain("Step #4");
    expect(written).not.toContain("Step #5");
    // the scriptCode-derivation rule is now walked and copied
    expect(written).toContain("RULE(BIP143)");
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

  it("curates live taproot validator steps that carry a machine step name", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          scriptPubKey: `5120${"11".repeat(32)}`,
          steps: [
            {
              pc: -1,
              kind: "validator",
              step: "witness_stack",
              opcode_name: "taproot_witness",
              stack_before: ["aa"],
              stack_after: ["aa"],
              phase: "taproot",
            },
            {
              pc: -1,
              kind: "validator",
              step: "schnorr_verify",
              opcode_name: "taproot_schnorr_verify",
              stack_before: ["aa"],
              stack_after: ["01"],
              phase: "taproot",
            },
          ],
        }}
      />
    );

    // step 1 dispatches on step="witness_stack" -> curated BIP341 rule,
    // not the bare opcode_name fallback. (The key-path banner also mentions
    // loading the witness stack, so the phrase appears more than once.)
    expect(screen.getByText("Rule:")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Load the witness stack/i).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("BIP341")).toBeInTheDocument();
    expect(screen.queryByText("taproot_witness")).not.toBeInTheDocument();
  });

  it("curates the taproot script-path dissection rows", async () => {
    const user = userEvent.setup();
    const controlHex = `c1${"22".repeat(32)}${"33".repeat(32)}`;

    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          scriptPubKey: `5120${"11".repeat(32)}`,
          steps: [
            {
              pc: -1,
              kind: "validator",
              step: "control_block_extract",
              opcode_name: "taproot_control_block_extract",
              control_hex: controlHex,
              stack_before: ["aa", "51", controlHex],
              stack_after: ["aa", "51"],
              phase: "taproot",
            },
            {
              pc: -1,
              step: "witness_script",
              opcode_name: "witness_script",
              script_hex: "51",
              stack_before: ["aa", "51"],
              stack_after: ["aa"],
              committed: true,
              executed: true,
              phase: "witnessScript",
            },
          ],
        }}
      />
    );

    // The pop of the control block is a curated BIP341 rule, not the raw
    // machine name, and its stacks show the item leaving the stack.
    expect(
      screen.getByText(/Pop the control block \(last witness item\)/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText("BIP341").length).toBeGreaterThan(0);
    expect(
      screen.queryByText("taproot_control_block_extract")
    ).not.toBeInTheDocument();

    // A live taproot witness_script row (carries committed/executed) is the
    // leaf-script pop — not the legacy "Load the witness stack" labeling.
    await user.click(screen.getByRole("button", { name: /Next/i }));
    expect(
      screen.getByText(/Pop the leaf script \(second-to-last witness item\)/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Load the witness stack/i)
    ).not.toBeInTheDocument();
  });

  it("renders a schema-poor validator step (no pc/kind/stacks) without crashing", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: false,
          error: "taproot leaf version not supported",
          steps: [
            {
              // the pre-fix leaf_version event shape: no pc, no kind, no stacks
              step: "leaf_version",
              phase: "taproot",
            } as unknown as (typeof baseSteps)[number],
          ],
        }}
      />
    );

    // classified as a rule (no pc and no opcode) and curated, not crashed
    expect(screen.getByText("Rule:")).toBeInTheDocument();
    expect(screen.getByText(/Check the tapleaf version/i)).toBeInTheDocument();
  });

  it("renders a trace_truncated marker as an informational rule with its detail", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          steps: [
            {
              pc: 0,
              opcode: 81,
              opcode_name: "OP_1",
              stack_before: [],
              stack_after: ["01"],
              phase: "scriptPubKey",
            },
            {
              pc: -1,
              kind: "validator",
              step: "trace_truncated",
              opcode_name: "trace_truncated",
              stack_before: [],
              stack_after: [],
              error: "trace truncated: max_trace_steps=20000 reached after 20000 recorded steps",
              phase: "scriptPubKey",
            },
          ],
        }}
      />
    );

    const nextButton = screen.getByRole("button", { name: /Next/i });
    fireEvent.click(nextButton);
    // the phrase appears in both the rule title and the error detail
    expect(screen.getAllByText(/Trace truncated/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/max_trace_steps=20000 reached/i)
    ).toBeInTheDocument();
  });

  it("falls back to a generic summary when the failing step is filtered out", () => {
    // a witness-phase failure is not in the walked list, so the summary
    // must not point at an index the user cannot navigate to
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: false,
          error: "witness program mismatch",
          scriptPubKey: `0014${"11".repeat(20)}`,
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
              pc: -1,
              kind: "validator",
              step: "witness_program_match",
              opcode_name: "witness_program_match",
              stack_before: [],
              stack_after: [],
              failed: true,
              error: "witness program mismatch",
              phase: "witness",
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Verification failed")).toBeInTheDocument();
    expect(screen.queryByText(/FAILED STEP/i)).not.toBeInTheDocument();
  });

  it("catches a render error and keeps a closable dialog (no white screen)", () => {
    // Force a throw deep in render by handing the pane a hostile hex value.
    // getter throws when the component reads scriptPubKey during render.
    const hostile = {
      isValid: true,
      steps: [
        {
          pc: 0,
          opcode: 81,
          opcode_name: "OP_1",
          stack_before: [],
          stack_after: ["01"],
          phase: "scriptPubKey",
        },
      ],
    };
    Object.defineProperty(hostile, "scriptPubKey", {
      get() {
        throw new Error("boom in render");
      },
      enumerable: true,
    });

    // suppress React's expected error logging for this intentional throw
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={hostile as unknown as typeof scriptResult}
      />
    );

    expect(
      screen.getByText(/could not render this trace/i)
    ).toBeInTheDocument();
    // a Close control is available (Radix also renders a built-in one)
    expect(
      screen.getAllByRole("button", { name: /Close/i }).length
    ).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it("marks an opcode in a not-taken branch with a 'branch not executed' badge", async () => {
    const user = userEvent.setup();
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          steps: [
            {
              pc: 0,
              opcode: 0,
              opcode_name: "OP_0",
              stack_before: [],
              stack_after: [""],
              phase: "scriptPubKey",
              branch_active: true,
            },
            {
              pc: 1,
              opcode: 99,
              opcode_name: "OP_IF",
              stack_before: [""],
              stack_after: [],
              phase: "scriptPubKey",
              branch_active: true,
            },
            {
              pc: 2,
              opcode: 106,
              opcode_name: "OP_RETURN",
              stack_before: [],
              stack_after: [],
              phase: "scriptPubKey",
              branch_active: false,
            },
          ],
        }}
      />
    );

    const nextButton = screen.getByRole("button", { name: /Next/i });
    await user.click(nextButton);
    // OP_IF ran in the taken branch: its step card must not be dimmed.
    expect(screen.getByText("OP_IF").closest(".opacity-55")).toBeNull();
    await user.click(nextButton);

    expect(screen.getByText("OP_RETURN")).toBeInTheDocument();
    expect(screen.getByText(/branch not executed/i)).toBeInTheDocument();
    expect(
      screen.getByText(/inside a branch that was not taken/i)
    ).toBeInTheDocument();
    // The skipped opcode's card renders dimmed, not hidden.
    expect(
      screen.getByText("OP_RETURN").closest(".opacity-55")
    ).not.toBeNull();
  });

  it("curates the taproot_annex validator event", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          scriptPubKey: `5120${"11".repeat(32)}`,
          steps: [
            {
              pc: -1,
              kind: "validator",
              step: "taproot_annex",
              opcode_name: "taproot_annex",
              phase: "taproot",
              annex_hex: `50${"aa".repeat(4)}`,
              annex_hash: "bb".repeat(32),
              stack_before: ["cc".repeat(64), `50${"aa".repeat(4)}`],
              stack_after: ["cc".repeat(64)],
            },
          ],
        }}
      />
    );
    expect(screen.getByText("Process the annex")).toBeInTheDocument();
    expect(screen.getByText("BIP341")).toBeInTheDocument();
    expect(
      screen.getByText(/stripped from the stack before execution/i)
    ).toBeInTheDocument();
  });

  it("curates the op_success validator event", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          scriptPubKey: `5120${"11".repeat(32)}`,
          steps: [
            {
              pc: 3,
              kind: "validator",
              step: "op_success",
              opcode_name: "op_success",
              policy: "ok",
              stack_before: ["aa"],
              stack_after: ["aa"],
              phase: "taproot",
            },
          ],
        }}
      />
    );
    expect(
      screen.getByText(/OP_SUCCESS — leaf succeeds without executing/i)
    ).toBeInTheDocument();
    expect(screen.getByText("BIP342")).toBeInTheDocument();
  });

  it("glosses a terminal failure by its machine error_code", async () => {
    const user = userEvent.setup();
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: false,
          error: "invalid schnorr signature size",
          scriptPubKey: `5120${"11".repeat(32)}`,
          steps: [
            {
              pc: -1,
              kind: "validator",
              step: "witness_stack",
              opcode_name: "taproot_witness",
              stack_before: ["aa"],
              stack_after: ["aa"],
              phase: "taproot",
            },
            {
              pc: -1,
              kind: "validator",
              step: "schnorr_verify",
              opcode_name: "taproot_schnorr_verify",
              stack_before: ["aa"],
              stack_after: [],
              failed: true,
              error: "invalid schnorr signature size",
              error_code: "SCHNORR_SIG_SIZE",
              phase: "taproot",
            },
          ],
        }}
      />
    );
    const nextButton = screen.getByRole("button", { name: /Next/i });
    await user.click(nextButton);
    // raw error + curated gloss both present
    expect(
      screen.getByText("invalid schnorr signature size")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/must be 64 or 65 bytes/i)
    ).toBeInTheDocument();
  });

  it("labels the tapscript pane with committed/executed state", () => {
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
              pc: -1,
              kind: "validator",
              step: "witness_script",
              opcode_name: "witness_script",
              script_hex: "51",
              committed: true,
              executed: true,
              stack_before: [],
              stack_after: [],
              phase: "witnessScript",
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
    expect(screen.getByTestId("tapscript-script-pane")).toHaveTextContent(
      /committed by the control block and executed/i
    );
  });

  it("labels an inactive control-flow opcode as processed, not skipped", async () => {
    const user = userEvent.setup();
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          steps: [
            {
              pc: 0,
              opcode: 0,
              opcode_name: "OP_0",
              stack_before: [],
              stack_after: [""],
              phase: "scriptPubKey",
              branch_active: true,
            },
            {
              pc: 1,
              opcode: 103,
              opcode_name: "OP_ELSE",
              stack_before: [],
              stack_after: [],
              phase: "scriptPubKey",
              branch_active: false,
            },
          ],
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: /Next/i }));

    expect(screen.getByText("OP_ELSE")).toBeInTheDocument();
    expect(
      screen.getByText(/control-flow marker processed/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/branch not executed/i)).toBeNull();
    expect(
      screen.getByText(/manages the IF\/ELSE branch structure/i)
    ).toBeInTheDocument();
    // Processed control opcodes keep full opacity — no skipped dimming.
    expect(screen.getByText("OP_ELSE").closest(".opacity-55")).toBeNull();
  });

  it("renders an empty tapscript pane instead of implying a key-path spend", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          scriptPubKey: `5120${"11".repeat(32)}`,
          witnessScript: "",
          steps: [
            {
              pc: -1,
              kind: "validator",
              step: "witness_script",
              opcode_name: "witness_script",
              script_hex: "",
              committed: true,
              executed: true,
              stack_before: ["01"],
              stack_after: ["01"],
              phase: "taproot",
            },
          ],
        }}
      />
    );

    const pane = screen.getByTestId("tapscript-script-pane");
    expect(pane).toHaveTextContent(/empty tapscript — no opcodes execute/i);
    expect(pane).toHaveTextContent(
      /committed by the control block and executed/i
    );
  });

  it("uses a neutral caption when an older trace lacks committed/executed", () => {
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
              pc: -1,
              kind: "validator",
              step: "witness_script",
              opcode_name: "witness_script",
              script_hex: "51",
              stack_before: [],
              stack_after: [],
              phase: "witnessScript",
            },
          ],
        }}
      />
    );
    expect(screen.getByTestId("tapscript-script-pane")).toHaveTextContent(
      /commitment status unavailable \(older trace\)/i
    );
    expect(
      screen.queryByText(/commitment not verified/i)
    ).toBeNull();
  });

  it("does not copy an empty tapscript as a key-path spend", async () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: true,
          scriptPubKey: `5120${"11".repeat(32)}`,
          witnessScript: "",
          steps: [
            {
              pc: -1,
              kind: "validator",
              step: "witness_script",
              opcode_name: "witness_script",
              script_hex: "",
              committed: true,
              executed: true,
              stack_before: ["01"],
              stack_after: ["01"],
              phase: "taproot",
            },
          ],
        }}
      />
    );

    const copyButton = screen.getByRole("button", { name: /Copy All/i });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    const written = (navigator.clipboard.writeText as unknown as Mock).mock
      .calls.at(-1)?.[0] as string;
    expect(written).not.toContain("Taproot key-path spend");
  });

  it("labels a failed P2WSH candidate as a hash mismatch, not hash-checked", () => {
    render(
      <ScriptExecutionSteps
        open
        onClose={vi.fn()}
        scriptResult={{
          isValid: false,
          error: "witness program mismatch",
          witnessScript: "51",
          steps: [
            {
              pc: -1,
              kind: "validator",
              step: "witness_script_check",
              opcode_name: "witness_script_check",
              script_hex: "51",
              failed: true,
              error: "witness program mismatch",
              error_code: "WITNESS_PROGRAM_MISMATCH",
              stack_before: ["51"],
              stack_after: [],
              phase: "witness",
            },
          ],
        }}
      />
    );
    expect(
      screen.getByTestId("witnessScript-script-pane")
    ).toHaveTextContent(/its SHA256 did not match the committed program/i);
  });
});
