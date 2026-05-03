import { act, render, waitFor } from "@testing-library/react";
import type { Edge } from "@xyflow/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CalculationNode from "@/components/nodes/CalculationNode";
import { CanonicalGraphContext } from "@/contexts/canonical-graph";
import type { FlowNode } from "@/types";
import { buildFlowNode, buildNodeProps } from "@/test-utils/types";

let calcViewMock: ReturnType<typeof vi.fn>;
const reactFlowMock = vi.hoisted(() => ({
  setNodes: vi.fn(),
  setEdges: vi.fn(),
  getEdges: vi.fn(() => []),
  storeState: { edges: [] as unknown[], nodes: [] as unknown[] },
}));
const derivedMock = vi.hoisted(() => ({
  value: {
    isMultiVal: false,
    nodeWidth: 200,
    minHeight: 150,
    connectionStatus: "ok",
    wiredHandles: new Set(["input-1"]),
  },
}));
const trezorMock = vi.hoisted(() => ({
  getTrezorAddress: vi.fn(),
  signTrezorTransaction: vi.fn(),
  parseTrezorBoolean: vi.fn((value: string) => value === "true"),
}));

vi.mock("@/components/nodes/calculation/CalculationNodeView", () => ({
  CalculationNodeView: (props: Record<string, unknown>) => {
    calcViewMock(props);
    return <div data-testid="calc-view" />;
  },
}));

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    setNodes: reactFlowMock.setNodes,
    setEdges: reactFlowMock.setEdges,
    getEdges: reactFlowMock.getEdges,
  }),
  useStore: (selector: (state: { edges: unknown[]; nodes: unknown[] }) => unknown) =>
    selector(reactFlowMock.storeState),
}));

vi.mock("@/hooks/useSnapshotSchedulerContext", () => ({
  useSnapshotSchedulerContext: () => ({
    lockEdgeSnapshotSkip: vi.fn(),
    releaseEdgeSnapshotSkip: vi.fn(),
    scheduleSnapshot: vi.fn(),
    lockNodeRemovalSnapshotSkip: vi.fn(),
    releaseNodeRemovalSnapshotSkip: vi.fn(),
    skipNextNodeRemovalRef: { current: false },
  }),
}));

vi.mock("@/hooks/useCalculation", () => ({
  useNodeCalculationLogic: () => ({
    numInputs: 2,
    value: "hello",
    result: "world",
    error: false,
    handleChange: vi.fn(),
  }),
}));

vi.mock("@/hooks/nodes/useCalcNodeDerived", () => ({
  useCalcNodeDerived: () => derivedMock.value,
}));

vi.mock("@/hooks/nodes/useCalcNodeMutations", () => ({
  useCalcNodeMutations: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/nodes/useClipboardLite", () => ({
  useClipboardLite: () => ({ onCopy: vi.fn() }),
}));

vi.mock("@/hooks/nodes/useGroupInstances", () => ({
  useGroupInstances: () => ({ group: true }),
}));

vi.mock("@/lib/share/scriptStepsCache", () => ({
  getScriptSteps: () => ({ trace: [1] }),
}));

vi.mock("@/lib/trezor/connect", () => trezorMock);

describe("CalculationNode", () => {
  beforeEach(() => {
    calcViewMock = vi.fn();
    reactFlowMock.setNodes.mockReset();
    reactFlowMock.setEdges.mockReset();
    reactFlowMock.getEdges.mockReset();
    reactFlowMock.getEdges.mockReturnValue([]);
    reactFlowMock.storeState = { edges: [], nodes: [] };
    trezorMock.getTrezorAddress.mockReset();
    trezorMock.signTrezorTransaction.mockReset();
    trezorMock.parseTrezorBoolean.mockClear();
    derivedMock.value = {
      isMultiVal: false,
      nodeWidth: 200,
      minHeight: 150,
      connectionStatus: "ok",
      wiredHandles: new Set(["input-1"]),
    };
  });

  it("passes derived props to view", () => {
    const node: FlowNode = buildFlowNode({
      id: "calc-1",
      selected: true,
      data: {
        functionName: "script_verification",
        inputs: { vals: { 0: "sig", 1: "pub" } },
        comment: "note",
        showComment: true,
      },
    });

    render(<CalculationNode {...buildNodeProps(node)} />);

    expect(calcViewMock).toHaveBeenCalled();
    const props = calcViewMock.mock.calls[0][0] as Record<string, unknown>;
    expect(props.script).toMatchObject({
      isScriptVerification: true,
      scriptResult: { trace: [1] },
      scriptSigInputHex: "sig",
      scriptPubKeyInputHex: "pub",
    });
    expect((props.singleValue as { value: string }).value).toBe("hello");
    expect(props.error).toBe(false);
    expect(props.comment).toBe("note");
  });

  it("clears stale Trezor results when connected inputs change", async () => {
    derivedMock.value = {
      ...derivedMock.value,
      isMultiVal: true,
      wiredHandles: new Set(["input-0"]),
    };

    const node: FlowNode = buildFlowNode({
      id: "trezor-1",
      data: {
        functionName: "trezor_get_address",
        hardwareAction: "trezor_get_address",
        result: "old-address",
        hardwareInputSnapshot: JSON.stringify([
          [0, "m/44'/1'/0'/0/0"],
          [1, "testnet"],
          [2, "SPENDADDRESS"],
          [3, "true"],
        ]),
        inputs: {
          vals: {
            0: "m/44'/1'/0'/0/0",
            1: "testnet",
            2: "SPENDADDRESS",
            3: "true",
          },
        },
        inputStructure: {
          ungrouped: [
            { index: 0, label: "Derivation Path:" },
            { index: 1, label: "Coin:" },
            { index: 2, label: "Script Type:" },
            { index: 3, label: "Show On Trezor:" },
          ],
        },
      },
    });
    const source: FlowNode = buildFlowNode({
      id: "path-source",
      data: { result: "m/44'/1'/0'/0/1" },
    });
    reactFlowMock.storeState = {
      nodes: [node, source],
      edges: [
        {
          source: "path-source",
          target: "trezor-1",
          sourceHandle: "",
          targetHandle: "input-0",
        },
      ],
    };

    render(<CalculationNode {...buildNodeProps(node)} />);

    await waitFor(() => expect(reactFlowMock.setNodes).toHaveBeenCalled());
    const updateNodes = reactFlowMock.setNodes.mock.calls.at(-1)?.[0] as (
      nodes: FlowNode[]
    ) => FlowNode[];
    const updated = updateNodes([node])[0];

    expect(updated.data.result).toBe("");
    expect(updated.data.outputValues).toBeUndefined();
    expect(updated.data.hardwareInputSnapshot).toBeUndefined();
    expect(updated.data.hardwareStatusText).toBe(
      "Inputs changed. Press Get Address again."
    );
  });

  it("resolves connected input values from canonical edges when bundle edges are rendered", () => {
    derivedMock.value = {
      ...derivedMock.value,
      isMultiVal: true,
      wiredHandles: new Set(["input-0"]),
    };
    const node: FlowNode = buildFlowNode({
      id: "calc-1",
      data: {
        functionName: "concat_all",
        paramExtraction: "multi_val",
        inputs: { vals: { 0: "saved-value" } },
      },
    });
    const source: FlowNode = buildFlowNode({
      id: "raw-source",
      data: { result: "02000000" },
    });
    const portNode: FlowNode = buildFlowNode({
      id: "__group_bundle_port__:target:group-a->group-b",
      type: "groupBundlePort",
      data: {},
    });
    const canonicalEdges: Edge[] = [
      {
        id: "raw-edge",
        source: "raw-source",
        target: "calc-1",
        targetHandle: "input-0",
      },
    ];
    reactFlowMock.storeState = {
      nodes: [node, portNode],
      edges: [
        {
          id: "visual-segment",
          source: portNode.id,
          target: "calc-1",
          targetHandle: "input-0",
        },
      ],
    };

    render(
      <CanonicalGraphContext.Provider
        value={{ nodes: [node, source], edges: canonicalEdges }}
      >
        <CalculationNode {...buildNodeProps(node)} />
      </CanonicalGraphContext.Provider>
    );

    const props = calcViewMock.mock.calls.at(-1)?.[0] as {
      getInputMeta: (index: number) => { value: unknown } | undefined;
    };

    expect(props.getInputMeta(0)?.value).toBe("02000000");
  });

  it("clears legacy Trezor results that do not have an input snapshot", async () => {
    derivedMock.value = {
      ...derivedMock.value,
      isMultiVal: true,
      wiredHandles: new Set(["input-0"]),
    };

    const node: FlowNode = buildFlowNode({
      id: "trezor-legacy",
      data: {
        functionName: "trezor_get_address",
        hardwareAction: "trezor_get_address",
        result: "legacy-address",
        inputs: {
          vals: {
            0: "m/44'/1'/0'/0/0",
            1: "testnet",
            2: "SPENDADDRESS",
            3: "true",
          },
        },
        inputStructure: {
          ungrouped: [
            { index: 0, label: "Derivation Path:" },
            { index: 1, label: "Coin:" },
            { index: 2, label: "Script Type:" },
            { index: 3, label: "Show On Trezor:" },
          ],
        },
      },
    });
    reactFlowMock.storeState = {
      nodes: [node],
      edges: [],
    };

    render(<CalculationNode {...buildNodeProps(node)} />);

    await waitFor(() => expect(reactFlowMock.setNodes).toHaveBeenCalled());
    const updateNodes = reactFlowMock.setNodes.mock.calls.at(-1)?.[0] as (
      nodes: FlowNode[]
    ) => FlowNode[];
    const updated = updateNodes([node])[0];

    expect(updated.data.result).toBe("");
    expect(updated.data.hardwareStatusText).toBe(
      "Inputs changed. Press Get Address again."
    );
  });

  it("does not fall back to saved editable values when wired Trezor input is missing", async () => {
    derivedMock.value = {
      ...derivedMock.value,
      isMultiVal: true,
      wiredHandles: new Set(["input-0"]),
    };

    const node: FlowNode = buildFlowNode({
      id: "trezor-1",
      data: {
        functionName: "trezor_get_address",
        hardwareAction: "trezor_get_address",
        inputs: {
          vals: {
            0: "m/44'/1'/0'/0/0",
            1: "testnet",
            2: "SPENDADDRESS",
            3: "true",
          },
        },
        inputStructure: {
          ungrouped: [
            { index: 0, label: "Derivation Path:" },
            { index: 1, label: "Coin:" },
            { index: 2, label: "Script Type:" },
            { index: 3, label: "Show On Trezor:" },
          ],
        },
      },
    });
    const source: FlowNode = buildFlowNode({
      id: "path-source",
      data: {},
    });
    reactFlowMock.storeState = {
      nodes: [node, source],
      edges: [
        {
          source: "path-source",
          target: "trezor-1",
          sourceHandle: "",
          targetHandle: "input-0",
        },
      ],
    };

    render(<CalculationNode {...buildNodeProps(node)} />);

    const props = calcViewMock.mock.calls.at(-1)?.[0] as {
      onHardwareAction: () => Promise<void>;
    };
    await act(async () => {
      await props.onHardwareAction();
    });

    expect(trezorMock.getTrezorAddress).not.toHaveBeenCalled();
    const updateNodes = reactFlowMock.setNodes.mock.calls.at(-1)?.[0] as (
      nodes: FlowNode[]
    ) => FlowNode[];
    const updated = updateNodes([node])[0];

    expect(updated.data.hardwareStatus).toBe("error");
    expect(updated.data.hardwareStatusText).toBe("Derivation path is required");
    expect(updated.data.result).toBe("");
  });

  it("blocks Trezor signing when the connected params node is in error", async () => {
    derivedMock.value = {
      ...derivedMock.value,
      isMultiVal: true,
      wiredHandles: new Set(["input-0"]),
    };

    const node: FlowNode = buildFlowNode({
      id: "trezor-sign",
      data: {
        functionName: "trezor_sign_transaction",
        hardwareAction: "trezor_sign_transaction",
        inputs: {
          vals: {
            0: "",
          },
        },
        inputStructure: {
          ungrouped: [
            {
              index: 0,
              label: "signTransaction Params JSON:",
            },
          ],
        },
      },
    });
    const paramsSource: FlowNode = buildFlowNode({
      id: "params-source",
      data: {
        result: '{"coin":"testnet","inputs":[],"outputs":[]}',
        error: true,
        extendedError: "Calculation failed: previous raw transaction is required",
      },
    });
    reactFlowMock.storeState = {
      nodes: [node, paramsSource],
      edges: [
        {
          source: "params-source",
          target: "trezor-sign",
          sourceHandle: "",
          targetHandle: "input-0",
        },
      ],
    };

    render(<CalculationNode {...buildNodeProps(node)} />);

    const props = calcViewMock.mock.calls.at(-1)?.[0] as {
      onHardwareAction: () => Promise<void>;
    };
    await act(async () => {
      await props.onHardwareAction();
    });

    expect(trezorMock.signTrezorTransaction).not.toHaveBeenCalled();
    const updateNodes = reactFlowMock.setNodes.mock.calls.at(-1)?.[0] as (
      nodes: FlowNode[]
    ) => FlowNode[];
    const updated = updateNodes([node])[0];

    expect(updated.data.hardwareStatus).toBe("error");
    expect(updated.data.hardwareStatusText).toBe(
      "Calculation failed: previous raw transaction is required"
    );
    expect(updated.data.result).toBe("");
  });
});
