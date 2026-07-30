import { renderWithProviders } from "@/test-utils/render";
import type { NodeData } from "@/types";
import type { UseCalcNodeDerivedResult } from "@/hooks/nodes/useCalcNodeDerived";
import type { ClipboardLiteResult } from "@/hooks/nodes/useClipboardLite";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { DISMISS_NODE_MENUS_EVENT } from "@/lib/flow/nodeMenuEvents";
import { allSidebarNodes } from "@/components/sidebar-nodes";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/dialog/ScriptExecutionSteps", () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="script-steps" /> : null),
}));

vi.mock("@/components/dialog/NodeCodeDialog", () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="code-dialog" /> : null),
}));

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    Handle: (props: Record<string, unknown>) => (
      <div data-testid="rf-handle" {...props} />
    ),
    // The view calls these to re-measure handle positions; outside a
    // ReactFlowProvider the real hooks throw, so stub them.
    useNodeId: () => "test-node",
    useUpdateNodeInternals: () => () => {},
  };
});

import { CalculationNodeView } from "../calculation/CalculationNodeView";

const TINY_PNG_HEX =
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
  "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082";

function createMut() {
  return {
    setFieldValue: vi.fn(),
    advanceFieldValue: vi.fn(),
    setTaprootLeafIndex: vi.fn(),
    setTxFieldExtractField: vi.fn(),
    resizeTxFieldExtractFields: vi.fn(),
    updateFieldLabel: vi.fn(),
    updateGroupTitle: vi.fn(),
    handleNetworkChange: vi.fn(),
    handleTitleUpdate: vi.fn(),
    handleRegenerate: vi.fn(),
    toggleComment: vi.fn(),
    handleCommentChange: vi.fn(),
    commitCommentOnBlur: vi.fn(),
    deleteNode: vi.fn(),
  } as const;
}

function createClip(overrides: Partial<ClipboardLiteResult> = {}): ClipboardLiteResult {
  const base: ClipboardLiteResult = {
    prettyResult: "0xdeadbeef",
    copyResult: vi.fn(),
    copyError: vi.fn(),
    copyId: vi.fn(),
    resultCopied: false,
    errorCopied: false,
    idCopied: false,
  };
  return { ...base, ...overrides };
}

describe("CalculationNodeView", () => {
  let data: NodeData;
  let derived: UseCalcNodeDerivedResult;

  beforeEach(() => {
    data = {
      functionName: "op_sum",
      paramExtraction: "single_val",
      inputs: { vals: ["123"] },
      customFieldLabels: { 0: "INPUT" },
      networkDependent: true,
      selectedNetwork: "testnet",
      showComment: true,
      comment: "Remember",
    } as NodeData;

    derived = {
      isMultiVal: false,
      nodeWidth: 250,
      minHeight: 100,
      visibleInputs: 0,
      wiredHandles: new Set(),
      connectionStatus: { connected: 0, total: 0, shouldShow: false },
    };
  });

  it("handles menu actions, clipboard helpers, and script viewer", async () => {
    const mut = createMut();
    const clip = createClip();
    const user = userEvent.setup();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={data}
        rawTitle="Calc Node"
        derived={derived}
        isInputConnected={(index) => index === 0}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={{
          showField: true,
          showHandle: true,
          value: "123",
          onChange: vi.fn(),
        }}
        result="OK"
        error={false}
        hasRegenerate={true}
        showComment={true}
        comment={"Remember"}
        script={{
          isScriptVerification: true,
          scriptResult: {
            isValid: true,
            steps: [
              {
                pc: 0,
                opcode: 0x51,
                opcode_name: "OP_1",
                stack_before: [],
                stack_after: ["01"],
              },
            ],
          },
          scriptSigInputHex: "aa",
          scriptPubKeyInputHex: "bb",
        }}
      />
    );

    await user.click(screen.getByTitle("Copy result to clipboard"));
    expect(clip.copyResult).toHaveBeenCalledTimes(1);

    const menuTrigger = screen
      .getAllByRole("button")
      .find((btn) => btn.getAttribute("aria-haspopup") === "menu");
    expect(menuTrigger).toBeDefined();

    await user.click(menuTrigger!);
    await user.click(screen.getByText("Show Code"));
    expect(screen.getByTestId("code-dialog")).toBeInTheDocument();

    await user.click(menuTrigger!);
    await user.click(
      screen.getByRole("menuitem", { name: /hide comment/i })
    );
    expect(mut.toggleComment).toHaveBeenCalledTimes(1);

    await user.click(menuTrigger!);
    await user.click(screen.getByRole("menuitem", { name: /copy id/i }));
    expect(clip.copyId).toHaveBeenCalledTimes(1);

    await user.click(menuTrigger!);
    await user.click(screen.getByRole("menuitem", { name: /delete node/i }));
    expect(mut.deleteNode).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /view script steps/i }));
    expect(screen.getByTestId("script-steps")).toBeInTheDocument();

    const commentArea = await screen.findByPlaceholderText(
      "Enter your notes here..."
    );
    expect(commentArea).toHaveClass("field-surface");
    expect(screen.getByRole("combobox")).toHaveClass("field-surface");
    await user.click(commentArea);
    (commentArea as HTMLTextAreaElement).setSelectionRange(3, 3);
    await user.keyboard("X");
    expect(commentArea).toHaveValue("RemXember");
    expect(mut.handleCommentChange).not.toHaveBeenCalled();
    await user.tab();
    expect(mut.commitCommentOnBlur).toHaveBeenCalledWith(
      "Remember",
      "RemXember"
    );
  });

  it("respects clipboard id feedback state", async () => {
    const clip = createClip({ idCopied: true });
    const mut = createMut();
    const user = userEvent.setup();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={data}
        rawTitle="Calc Node"
        derived={derived}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result={undefined}
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    const menuTrigger = screen
      .getAllByRole("button")
      .find((btn) => btn.getAttribute("aria-haspopup") === "menu");
    await user.click(menuTrigger!);

    const copyIdItem = screen.getByRole("menuitem", { name: /copied ✓/i });
    expect(copyIdItem).toBeInTheDocument();
  });

  it("renders a configured advance button and advances its target field", async () => {
    const clip = createClip();
    const mut = createMut();
    const user = userEvent.setup();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{
          ...data,
          advanceButton: {
            targetField: 1,
            stepField: 2,
            label: "Mine next batch",
            nextValueOutput: "output-2",
          },
        }}
        rawTitle="Mine Nonce Range"
        derived={derived}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result={undefined}
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    await user.click(
      screen.getByRole("button", { name: "Mine next batch" })
    );

    expect(mut.advanceFieldValue).toHaveBeenCalledWith(
      1,
      2,
      false,
      "output-2"
    );
  });

  it("disables the advance button while dirty, errored, or stopped", () => {
    const clip = createClip();
    const mut = createMut();
    const advanceButton = {
      targetField: 1,
      stepField: 2,
      label: "Mine next batch",
      disableWhenOutput: {
        handleId: "output-1",
        equals: "true",
      },
    };

    const { rerender } = renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{ ...data, advanceButton, dirty: true }}
        rawTitle="Mine Nonce Range"
        derived={derived}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result={undefined}
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(
      screen.getByRole("button", { name: "Mine next batch" })
    ).toBeDisabled();

    rerender(
      <CalculationNodeView
        selected={false}
        data={{ ...data, advanceButton, dirty: false }}
        rawTitle="Mine Nonce Range"
        derived={derived}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result={undefined}
        error
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(
      screen.getByRole("button", { name: "Mine next batch" })
    ).toBeDisabled();

    rerender(
      <CalculationNodeView
        selected={false}
        data={{
          ...data,
          advanceButton,
          dirty: false,
          outputValues: { "output-1": "true" },
        }}
        rawTitle="Mine Nonce Range"
        derived={derived}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result={undefined}
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(
      screen.getByRole("button", { name: "Mine next batch" })
    ).toBeDisabled();
  });

  it("closes the node menu on canvas pointer-down dismiss events", async () => {
    const mut = createMut();
    const clip = createClip();
    const user = userEvent.setup();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={data}
        rawTitle="Calc Node"
        derived={derived}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result="OK"
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    const menuTrigger = screen
      .getAllByRole("button")
      .find((btn) => btn.getAttribute("aria-haspopup") === "menu");
    expect(menuTrigger).toBeDefined();

    await user.click(menuTrigger!);
    expect(screen.getByRole("menuitem", { name: /copy id/i })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event(DISMISS_NODE_MENUS_EVENT));
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("menuitem", { name: /copy id/i })
      ).not.toBeInTheDocument();
    });
  });

  it("falls back to 'Unknown error' in the tooltip when extendedError is missing", async () => {
    // Regression for RB-52: String(undefined) is the truthy "undefined",
    // which used to render literally instead of the fallback.
    const clip = createClip();
    const mut = createMut();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{ ...data, error: true, extendedError: undefined } as NodeData}
        rawTitle="Calc Node"
        derived={derived}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result={undefined}
        error={true}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    const icon = document.querySelector(".node-error-icon");
    expect(icon).not.toBeNull();
    // Radix tooltips open without delay on focus (hover needs a real pointer).
    fireEvent.focus(icon!.parentElement as HTMLElement);

    // Radix renders the tooltip content plus a visually-hidden a11y copy.
    expect(
      (await screen.findAllByText("Unknown error")).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("renders signet for network-dependent nodes", () => {
    const clip = createClip();
    const mut = createMut();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{ ...data, selectedNetwork: "signet" } as NodeData}
        rawTitle="Calc Node"
        derived={derived}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result={undefined}
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("Signet");
  });

  it("shows live upstream values on connected fields instead of stale stored values", () => {
    const clip = createClip();
    const mut = createMut();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{
          functionName: "trezor_get_address",
          paramExtraction: "multi_val",
          inputs: { vals: { 0: "m/44'/1'/0'/0/0" } },
          inputStructure: {
            ungrouped: [
              {
                index: 0,
                label: "Derivation Path:",
                rows: 1,
                placeholder: "m/44'/1'/0'/0/0",
              },
            ],
          },
        } as NodeData}
        rawTitle="Trezor Get Address"
        derived={{
          ...derived,
          isMultiVal: true,
        }}
        isInputConnected={(index) => index === 0}
        getInputMeta={(index) =>
          index === 0
            ? { value: "m/44'/1'/0'/0/1", error: false }
            : undefined
        }
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result={undefined}
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(
      screen.getByDisplayValue("m/44'/1'/0'/0/1")
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("m/44'/1'/0'/0/0")
    ).not.toBeInTheDocument();
  });

  it("keeps Math Operation vertical while tightening result spacing", () => {
    const clip = createClip({ prettyResult: "12" });
    const mut = createMut();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{
          functionName: "math_operation",
          title: "Math Operation",
          paramExtraction: "multi_val",
          inputs: { vals: ["7", "+", "5"] },
          inputStructure: {
            ungrouped: [
              { index: 0, label: "Left value:", rows: 1 },
              {
                index: 1,
                label: "Operator:",
                unconnectable: true,
                options: ["+", "-", "*", "/"],
              },
              { index: 2, label: "Right value:", rows: 1 },
            ],
          },
        } as NodeData}
        rawTitle="Math Operation"
        derived={{
          ...derived,
          isMultiVal: true,
          connectionStatus: { connected: 2, total: 2, shouldShow: true },
        }}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result="12"
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(screen.getByText(/Left value:/)).toBeInTheDocument();
    expect(screen.getByText("Operator:")).toBeInTheDocument();
    expect(screen.getByText(/Right value:/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();

    const resultLabel = screen.getByText("> Calculation Result:");
    expect(resultLabel).toHaveClass("mb-1");
    expect(resultLabel).not.toHaveClass("mb-2");
    expect(resultLabel.closest(".calc-node-result")).toHaveClass("mt-1", "pt-0");
  });

  it("keeps Verify Script focused while hiding flags and Taproot controls by default", async () => {
    const clip = createClip({ prettyResult: "true" });
    const mut = createMut();
    const user = userEvent.setup();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{
          functionName: "script_verification",
          paramExtraction: "multi_val",
          inputs: { vals: { 3: "0" } },
          inputStructure: {
            ungrouped: [
              { index: 0, label: "scriptSig_hex", rows: 3 },
              { index: 1, label: "scriptPubKey_hex", rows: 3 },
              { index: 2, label: "tx_hex", rows: 3 },
              {
                index: 3,
                label: "input_index_to_verify",
                rows: 1,
                unconnectable: true,
              },
              {
                index: 4,
                label: "exclude_flags",
                rows: 1,
                unconnectable: true,
              },
              {
                index: 5,
                label: "spent_amount_sats",
                rows: 1,
                allowEmptyBlank: true,
              },
            ],
            groups: [
              {
                title: "Taproot Prevouts (vin order)",
                baseIndex: 100,
                expandable: true,
                fieldCountToAdd: 1,
                minInstances: 0,
                fields: [
                  { index: 0, label: "prevout_amount_sats", rows: 1 },
                  { index: 1, label: "prevout_scriptPubKey_hex", rows: 3 },
                ],
              },
            ],
          },
        } as NodeData}
        rawTitle="Verify Script"
        derived={{
          ...derived,
          isMultiVal: true,
        }}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result="true"
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: true,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(screen.getByText(/SCRIPTSIG_HEX/)).toBeInTheDocument();
    expect(screen.getByText(/SPENT_AMOUNT_SATS/)).toBeInTheDocument();
    expect(screen.queryByText(/EXCLUDE_FLAGS/)).not.toBeInTheDocument();
    const taprootGroupTitle = (_content: string, element: Element | null) =>
      element?.textContent?.trim() === "> Taproot prevouts";
    expect(screen.queryByText(taprootGroupTitle)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /advanced \(taproot and flags\)/i })
    );

    expect(screen.getByText(/EXCLUDE_FLAGS/)).toBeInTheDocument();
    expect(screen.getAllByText(taprootGroupTitle).length).toBeGreaterThan(0);
  });

  it("renders dynamic TX field extract outputs in a dedicated result block", async () => {
    const clip = createClip({ prettyResult: "hidden summary" });
    const mut = createMut();
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{
          functionName: "extract_tx_field",
          paramExtraction: "multi_val",
          txFieldExtractMode: "dynamic",
          txExtractFields: ["txid", "vout.scriptPubKey"],
          outputValues: {
            "output-0": "abc",
            "output-1": "51",
          },
          inputStructure: {
            ungrouped: [
              { index: 0, label: "Raw TX (hex):", rows: 4 },
              { index: 1, label: "VIN/VOUT Index:", rows: 1 },
            ],
          },
          inputs: { vals: { 1: "0" } },
        } as NodeData}
        rawTitle="TX Field Extract"
        derived={{
          ...derived,
          isMultiVal: true,
        }}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result="hidden summary"
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(screen.getByText("> EXTRACTED FIELDS")).toBeInTheDocument();
    expect(screen.getByText("abc")).toBeInTheDocument();
    expect(screen.getByText("51")).toBeInTheDocument();
    expect(screen.getAllByTestId("rf-handle")).toHaveLength(4);

    await user.click(screen.getByTitle("Copy txid output to clipboard"));
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(await screen.findByTitle("Copied!")).toBeInTheDocument();

    await user.click(screen.getByTitle("Add output"));
    expect(mut.resizeTxFieldExtractFields).toHaveBeenCalledWith(true);

    await user.click(screen.getByTitle("Remove output"));
    expect(mut.resizeTxFieldExtractFields).toHaveBeenCalledWith(false);
  });

  it("renders concat_all inputs as one-line auto-growing fields even when renamed", () => {
    const clip = createClip({ prettyResult: "aabb" });
    const mut = createMut();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{
          functionName: "concat_all",
          title: "scriptPubKey",
          paramExtraction: "multi_val",
          inputs: {
            vals: {
              0: "aa",
              100: "bb",
            },
          },
          inputStructure: {
            groups: [
              {
                title: "INPUTS[]",
                baseIndex: 0,
                fields: [{ index: 0, label: "Value:", rows: 3 }],
              },
            ],
          },
          groupInstanceKeys: { "INPUTS[]": [0, 100] },
        } as NodeData}
        rawTitle="scriptPubKey"
        derived={{
          ...derived,
          isMultiVal: true,
        }}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={undefined}
        result="aabb"
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(screen.getByDisplayValue("aa")).toHaveAttribute("rows", "1");
    expect(screen.getByDisplayValue("bb")).toHaveAttribute("rows", "1");
    expect(
      screen.getByTitle("Aggregator node: concatenates ordered input parts")
    ).toHaveTextContent("concat");
  });

  it("marks renamed identity input nodes and hides duplicate result output", () => {
    const clip = createClip({ prettyResult: "abc123" });
    const mut = createMut();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{
          functionName: "identity",
          paramExtraction: "single_val",
          showField: true,
        } as NodeData}
        rawTitle="Funding hash"
        derived={derived}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        singleValue={{
          showField: true,
          showHandle: false,
          value: "abc123",
          onChange: vi.fn(),
        }}
        result="abc123"
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(screen.getByDisplayValue("abc123")).toHaveAttribute("rows", "1");
    expect(
      screen.queryByTitle("Aggregator node: concatenates ordered input parts")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTitle("Input node: manually entered source value")
    ).toHaveTextContent("in");
    expect(screen.queryByText("> Calculation Result:")).not.toBeInTheDocument();
    expect(screen.queryByTestId("node-result")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Copy result to clipboard")).not.toBeInTheDocument();
  });

  it("shows picture script summary as info without a copy result button", () => {
    const clip = createClip({
      prettyResult:
        "103 P2SH redeemScripts\n49416 picture bytes\n480 B/output, 240 B chunks\n<240B data> <240B data> OP_2DROP <pubkey> OP_CHECKSIG",
    });
    const mut = createMut();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={{
          functionName: "bip110_picture_p2sh_scripts",
          title: "Picture → P2SH Scripts",
          paramExtraction: "multi_val",
          inputs: {
            vals: {
              0: TINY_PNG_HEX,
              1: "03c35139c7b76ef1c1d6cdc1bd56eb11ba5c260a7493b528bb74a8aa8f12cb7a63",
            },
          },
          inputStructure: {
            ungrouped: [
              {
                index: 0,
                label: "Picture hex:",
                fileInput: "image-hex",
                autoResizeMaxRows: 4,
              },
              { index: 1, label: "Compressed pubkey:" },
            ],
          },
          outputPorts: Array.from({ length: 20 }, (_, index) => ({
            label: `script ${index + 1}`,
            handleId: `output-${index}`,
            showLabel: false,
          })),
        } as NodeData}
        rawTitle="Picture → P2SH Scripts"
        derived={{
          ...derived,
          isMultiVal: true,
          nodeWidth: 400,
          minHeight: 1200,
          connectionStatus: { connected: 0, total: 2, shouldShow: true },
        }}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        result={clip.prettyResult}
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    expect(screen.getByText("> Info:")).toBeInTheDocument();
    expect(screen.queryByText("> Calculation Result:")).not.toBeInTheDocument();
    expect(screen.getByTestId("picture-preview")).toHaveAttribute(
      "src",
      expect.stringMatching(/^data:image\/png;base64,/)
    );
    expect(screen.getByTestId("node-result")).toHaveTextContent(
      "103 P2SH redeemScripts"
    );
    expect(screen.getByTestId("node-result")).toHaveTextContent(
      "<240B data> <240B data> OP_2DROP <pubkey> OP_CHECKSIG"
    );
    expect(screen.queryByTitle("Copy result to clipboard")).not.toBeInTheDocument();
  });

  it("shows builder group headers with +/- expansion controls (BIP341 flows expand these across all inputs)", () => {
    const mut = createMut();
    const clip = createClip();

    const renderBuilder = (
      groupTitle: string,
      fields: NonNullable<
        NonNullable<NodeData["inputStructure"]>["groups"]
      >[number]["fields"]
    ) => {
      const titleByGroup: Record<string, string> = {
        "PREVOUTS[]": "PREVOUTS Builder",
        "SEQUENCES[]": "SEQUENCE Builder",
        "OUTPUTS[]": "OUTPUTS Builder",
      };
      const title = titleByGroup[groupTitle] ?? "Builder";
      return renderWithProviders(
        <CalculationNodeView
          selected={false}
          data={{
            functionName: "concat_all",
            title,
            paramExtraction: "multi_val",
            inputs: { vals: [] },
            inputStructure: {
              ungrouped: [],
              groups: [
                {
                  title: groupTitle,
                  baseIndex: 0,
                  expandable: true,
                  fieldCountToAdd: fields.length,
                  minInstances: 1,
                  maxInstances: 20,
                  fields,
                },
              ],
            },
            groupInstances: { [groupTitle]: 1 },
            groupInstanceKeys: { [groupTitle]: [0] },
          } as NodeData}
          rawTitle={title}
          derived={{
            ...derived,
            isMultiVal: true,
            nodeWidth: 360,
            minHeight: 200,
            connectionStatus: {
              connected: 0,
              total: fields.length,
              shouldShow: true,
            },
          }}
          isInputConnected={() => false}
          mut={mut}
          group={{ handleGroupSize: vi.fn() }}
          clip={clip}
          result=""
          error={false}
          hasRegenerate={false}
          showComment={false}
          comment=""
          script={{
            isScriptVerification: false,
            scriptResult: null,
            scriptSigInputHex: "",
            scriptPubKeyInputHex: "",
          }}
        />
      );
    };

    let rendered = renderBuilder("PREVOUTS[]", [
      { index: 0, label: "TXID[32]:", rows: 2 },
      { index: 10, label: "VOUT[4]:", rows: 1 },
    ]);

    expect(screen.getByText("> PREVOUTS[]")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add PREVOUTS[]" })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Remove PREVOUTS[]" })
    ).toBeInTheDocument();
    expect(screen.getByText("> TXID[32]:")).toBeInTheDocument();
    expect(screen.getByText("> VOUT[4]:")).toBeInTheDocument();

    rendered.unmount();

    rendered = renderBuilder("SEQUENCES[]", [
      { index: 0, label: "SEQUENCE[4]:", rows: 1 },
    ]);

    expect(screen.getByText("> SEQUENCES[]")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add SEQUENCES[]" })
    ).toBeEnabled();
    expect(screen.getByText("> SEQUENCE[4]:")).toBeInTheDocument();

    rendered.unmount();

    renderBuilder("OUTPUTS[]", [
      { index: 0, label: "AMOUNT[8]:", rows: 1 },
      { index: 10, label: "SCRIPTLEN:", rows: 1 },
      { index: 20, label: "SCRIPTPUBKEY:", rows: 2 },
    ]);

    expect(screen.getByText("> OUTPUTS[]")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add OUTPUTS[]" })
    ).toBeEnabled();
    expect(screen.getByText("> AMOUNT[8]:")).toBeInTheDocument();
    expect(screen.getByText("> SCRIPTLEN:")).toBeInTheDocument();
    expect(screen.getByText("> SCRIPTPUBKEY:")).toBeInTheDocument();
  });

  it.each([
    ["Bitcoin Block Merkle Tree", ["TX_HASHES[]"]],
    ["MuSig2 Partial Sign", ["PUBKEYS[]"]],
    ["MuSig2 Partial Sig Agg", ["PUBKEYS[]", "PARTIAL_SIGS[]"]],
  ])("removes the requested group dividers from %s", (title, groups) => {
    const mut = createMut();
    const clip = createClip();
    const template = allSidebarNodes.find((node) => node.label === title);

    expect(template).toBeDefined();

    renderWithProviders(
      <CalculationNodeView
        selected={false}
        data={structuredClone(template!.nodeData) as NodeData}
        rawTitle={title}
        derived={{
          ...derived,
          isMultiVal: true,
          nodeWidth: 360,
          minHeight: 400,
          connectionStatus: { connected: 0, total: 8, shouldShow: true },
        }}
        isInputConnected={() => false}
        mut={mut}
        group={{ handleGroupSize: vi.fn() }}
        clip={clip}
        result=""
        error={false}
        hasRegenerate={false}
        showComment={false}
        comment=""
        script={{
          isScriptVerification: false,
          scriptResult: null,
          scriptSigInputHex: "",
          scriptPubKeyInputHex: "",
        }}
      />
    );

    groups.forEach((groupTitle) => {
      const groupHeader = screen.getByText(`> ${groupTitle}`).parentElement;
      expect(groupHeader).not.toBeNull();
      expect(groupHeader).not.toHaveClass("border-b");
      expect(
        screen.getByRole("button", { name: `Add ${groupTitle}` })
      ).toBeEnabled();
    });
  });

  it.each(["TX Template legacy", "TX Template"])(
    "keeps the OUTPUTS[] resize controls visible in %s",
    (title) => {
      const mut = createMut();
      const clip = createClip();
      const handleGroupSize = vi.fn();
      const template = allSidebarNodes.find((node) => node.label === title);

      expect(template).toBeDefined();

      renderWithProviders(
        <CalculationNodeView
          selected={false}
          data={structuredClone(template!.nodeData) as NodeData}
          rawTitle={title}
          derived={{
            ...derived,
            isMultiVal: true,
            nodeWidth: 360,
            minHeight: 400,
            connectionStatus: { connected: 0, total: 4, shouldShow: true },
          }}
          isInputConnected={() => false}
          mut={mut}
          group={{ handleGroupSize }}
          clip={clip}
          result=""
          error={false}
          hasRegenerate={false}
          showComment={false}
          comment=""
          script={{
            isScriptVerification: false,
            scriptResult: null,
            scriptSigInputHex: "",
            scriptPubKeyInputHex: "",
          }}
        />
      );

      expect(screen.getByText("> OUTPUTS[]")).toBeInTheDocument();
      const removeOutput = screen.getByRole("button", {
        name: "Remove OUTPUTS[]",
      });
      const addOutput = screen.getByRole("button", { name: "Add OUTPUTS[]" });
      expect(removeOutput).toBeDisabled();
      expect(addOutput).toBeEnabled();

      fireEvent.click(addOutput);
      expect(handleGroupSize).toHaveBeenCalledWith(
        "OUTPUTS[]",
        expect.objectContaining({ title: "OUTPUTS[]" }),
        true
      );
    }
  );

  it.each([1, 3, 5, 10])(
    "renders the authoritative Bitcoin block Merkle tree for %i transaction hashes",
    (leafCount) => {
      type TestTreeNode = {
        hash: string;
        label: string;
        leafIndex?: number;
        duplicated?: boolean;
        duplicateOf?: string;
        left?: TestTreeNode;
        right?: TestTreeNode;
      };

      let hashCounter = 1;
      const nextHash = () =>
        (hashCounter++).toString(16).padStart(64, "0");
      let level: TestTreeNode[] = Array.from(
        { length: leafCount },
        (_, index) => ({
          hash: nextHash(),
          label: `TX${index}`,
          leafIndex: index,
        })
      );
      const levels: string[][] = [];
      let duplicateCount = 0;
      let depth = 0;

      while (level.length > 1) {
        if (level.length % 2 === 1) {
          const source = level[level.length - 1];
          level = [
            ...level,
            {
              hash: source.hash,
              label: source.label,
              duplicated: true,
              duplicateOf: source.label,
            },
          ];
          duplicateCount += 1;
        }
        levels.push(level.map((node) => node.hash));

        const parents: TestTreeNode[] = [];
        for (let index = 0; index < level.length; index += 2) {
          parents.push({
            hash: nextHash(),
            label: `L${depth + 1}N${index / 2}`,
            left: level[index],
            right: level[index + 1],
          });
        }
        level = parents;
        depth += 1;
      }
      levels.push([level[0].hash]);

      const mut = createMut();
      const clip = createClip({ prettyResult: level[0].hash });
      renderWithProviders(
        <CalculationNodeView
          selected={false}
          data={{
            functionName: "bitcoin_merkle_tree",
            title: "Bitcoin Block Merkle Tree",
            outputLayout: "bitcoin_block_merkle_tree",
            outputPorts: [
              {
                label: "merkle root (internal)",
                handleId: "",
                handleTop: "50%",
                showLabel: false,
              },
            ],
            blockMerkleTree: {
              root: level[0].hash,
              mutated: false,
              leafCount,
              levels,
              duplicateCount,
              tree: level[0],
            },
          } as NodeData}
          rawTitle="Bitcoin Block Merkle Tree"
          derived={{
            ...derived,
            isMultiVal: true,
            nodeWidth: 440,
            minHeight: 300,
            connectionStatus: {
              connected: leafCount,
              total: leafCount,
              shouldShow: true,
            },
          }}
          isInputConnected={() => true}
          mut={mut}
          group={{ handleGroupSize: vi.fn() }}
          clip={clip}
          result={level[0].hash}
          error={false}
          hasRegenerate={false}
          showComment={false}
          comment=""
          script={{
            isScriptVerification: false,
            scriptResult: null,
            scriptSigInputHex: "",
            scriptPubKeyInputHex: "",
          }}
        />
      );

      const tree = screen.getByTestId("block-merkle-tree");
      const treeField = tree.querySelector("textarea");
      const treeText = treeField?.value ?? "";
      expect(treeText).toContain(leafCount === 1 ? "root =" : "ROOT");
      expect(treeText).toContain("TX0 (coinbase)");
      expect(treeText).toContain(`TX${leafCount - 1}`);
      if (leafCount === 1) {
        expect(treeText).toContain("root = TX0 (coinbase)");
        expect(treeText).not.toContain("(duplicate)");
      } else {
        expect(treeText).toContain("(duplicate)");
      }
      expect(treeText.match(/\(duplicate\)/g) ?? []).toHaveLength(
        duplicateCount
      );
      expect(screen.getByText(`Transactions: ${leafCount}`)).toBeInTheDocument();
      expect(
        screen.getByText(`Odd duplications: ${duplicateCount}`)
      ).toBeInTheDocument();
      expect(screen.getByText("Mutation detected:")).toBeInTheDocument();
      expect(screen.getByTestId("block-merkle-mutated-value")).toHaveTextContent(
        "false"
      );
      expect(
        screen.getByTitle("Copy result to clipboard")
      ).toBeInTheDocument();
      expect(Number(treeField?.getAttribute("rows"))).toBeLessThanOrEqual(12);
    }
  );
});
