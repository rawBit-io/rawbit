import { renderWithProviders } from "@/test-utils/render";
import type { NodeData } from "@/types";
import type { UseCalcNodeDerivedResult } from "@/hooks/nodes/useCalcNodeDerived";
import type { ClipboardLiteResult } from "@/hooks/nodes/useClipboardLite";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
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
  };
});

import { CalculationNodeView } from "../calculation/CalculationNodeView";

function createMut() {
  return {
    setFieldValue: vi.fn(),
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
    await user.type(commentArea, " updated");
    expect(mut.handleCommentChange).toHaveBeenCalled();
    expect(mut.handleCommentChange.mock.calls.at(-1)?.[0]).not.toBe("Remember");
    await user.tab();
    expect(mut.commitCommentOnBlur).toHaveBeenCalledWith(
      "Remember",
      "Remember"
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

  it("renders dynamic TX field extract outputs without the generic result block", async () => {
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

    expect(screen.getByText("> Outputs")).toBeInTheDocument();
    expect(screen.getByText("abc")).toBeInTheDocument();
    expect(screen.getByText("51")).toBeInTheDocument();
    expect(screen.queryByText("> Calculation Result:")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("rf-handle")).toHaveLength(4);

    await user.click(screen.getByTitle("Copy txid output to clipboard"));
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(await screen.findByTitle("Copied!")).toBeInTheDocument();

    await user.click(screen.getByTitle("Add output"));
    expect(mut.resizeTxFieldExtractFields).toHaveBeenCalledWith(true);

    await user.click(screen.getByTitle("Remove output"));
    expect(mut.resizeTxFieldExtractFields).toHaveBeenCalledWith(false);
  });

  it("hides duplicate result output on identity input nodes", () => {
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
        rawTitle="Input"
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
    expect(screen.queryByText("> Calculation Result:")).not.toBeInTheDocument();
    expect(screen.queryByTestId("node-result")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Copy result to clipboard")).not.toBeInTheDocument();
  });
});
