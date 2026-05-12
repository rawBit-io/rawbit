import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useConnectPorts } from "../useConnectPorts";
import type { FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";

const makeNode = (id: string, numInputs = 2): FlowNode =>
  ({
    id,
    type: "calculation",
    position: { x: 0, y: 0 },
    data: { functionName: id, numInputs },
  }) as FlowNode;

describe("useConnectPorts", () => {
  const nodes = [makeNode("node-a", 2), makeNode("node-b", 1), makeNode("node-c", 3)];
  const edges: Edge[] = [
    {
      id: "edge-1",
      source: "node-a",
      target: "node-b",
      sourceHandle: "output-1",
      targetHandle: "input-0",
    },
  ];

  const flushEffects = () =>
    act(async () => {
      await Promise.resolve();
    });

  it("orders allPorts based on the selected signature order", async () => {
    type SelectionProps = {
      selectedSignature: string;
      selectedNodeIds: string[];
    };

    const { result, rerender } = renderHook<
      ReturnType<typeof useConnectPorts>,
      SelectionProps
    >(
      (props: SelectionProps) =>
        useConnectPorts({
          nodes,
          edges: [],
          connectOpen: true,
          selectedSignature: props.selectedSignature,
          selectedNodeIds: props.selectedNodeIds,
          isSwapped: false,
        }),
      {
        initialProps: { selectedSignature: "", selectedNodeIds: [] },
      }
    );

    await flushEffects();

    rerender({ selectedSignature: "node-b|node-a", selectedNodeIds: ["node-b", "node-a"] });
    await flushEffects();

    await waitFor(() =>
      expect(result.current.allPorts.map((p) => p.id)).toEqual(["node-b", "node-a"])
    );
  });

  it("reuses cached ports while the dialog remains open", async () => {
    const { result, rerender } = renderHook(
      (props) =>
        useConnectPorts({
          nodes,
          edges: [],
          connectOpen: true,
          selectedSignature: "node-a|node-b",
          selectedNodeIds: ["node-a", "node-b"],
          isSwapped: props?.isSwapped ?? false,
        }),
      { initialProps: { isSwapped: false } }
    );

    await flushEffects();

    await waitFor(() => {
      expect(result.current.sourcePorts).not.toBeNull();
    });

    const firstSource = result.current.sourcePorts!;
    rerender({ isSwapped: false });
    await flushEffects();

    await waitFor(() => {
      expect(result.current.sourcePorts).toEqual(firstSource);
    });
  });

  it("invalidates cached ports when the selected signature changes", async () => {
    const { result, rerender } = renderHook(
      (selectedSignature: string) =>
        useConnectPorts({
          nodes,
          edges: [],
          connectOpen: true,
          selectedSignature,
          selectedNodeIds: selectedSignature.split("|").filter(Boolean),
          isSwapped: false,
        }),
      { initialProps: "node-a|node-b" }
    );

    await flushEffects();

    await waitFor(() => {
      expect(result.current.sourcePorts?.id).toBe("node-a");
    });

    rerender("node-b|node-c");
    await flushEffects();

    await waitFor(() => {
      expect(result.current.sourcePorts?.id).toBe("node-b");
    });
  });

  it("auto-orients selected nodes when only the reverse direction can connect", async () => {
    const signNode = makeNode("sign-tx", 2);
    const randomNode = makeNode("random-32-bytes", 0);

    const { result } = renderHook(() =>
      useConnectPorts({
        nodes: [signNode, randomNode],
        edges: [],
        connectOpen: true,
        selectedSignature: "sign-tx|random-32-bytes",
        selectedNodeIds: ["sign-tx", "random-32-bytes"],
        isSwapped: false,
      })
    );

    await flushEffects();

    await waitFor(() => {
      expect(result.current.canConnect).toBe(true);
      expect(result.current.sourcePorts?.id).toBe("random-32-bytes");
      expect(result.current.targetPorts?.id).toBe("sign-tx");
    });
  });

  it("enables the action when only copy inputs can apply", async () => {
    const sourceNode = {
      id: "source",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "sink",
        inputStructure: {
          ungrouped: [{ index: 0, label: "Input" }],
        },
        outputPorts: [{ label: "hidden", handleId: "", showHandle: false }],
      },
    } as FlowNode;
    const targetNode = makeNode("target", 1);
    const edgeToCopy: Edge = {
      id: "incoming",
      source: "upstream",
      sourceHandle: null,
      target: "source",
      targetHandle: "input-0",
    };

    const { result } = renderHook(() =>
      useConnectPorts({
        nodes: [sourceNode, targetNode],
        edges: [edgeToCopy],
        connectOpen: true,
        selectedSignature: "source|target",
        selectedNodeIds: ["source", "target"],
        isSwapped: false,
      })
    );

    await flushEffects();

    await waitFor(() => {
      expect(result.current.canConnect).toBe(true);
      expect(result.current.canConnectEdge).toBe(false);
      expect(result.current.canCopyInputs).toBe(true);
      expect(result.current.availableModes).toEqual(["copy"]);
      expect(result.current.sourcePorts?.id).toBe("source");
      expect(result.current.targetPorts?.id).toBe("target");
    });
  });

  it("auto-orients selected nodes when only reverse copy inputs can apply", async () => {
    const targetNode = makeNode("target", 1);
    const sourceNode = {
      id: "source",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "sink",
        inputStructure: {
          ungrouped: [{ index: 0, label: "Input" }],
        },
        outputPorts: [{ label: "hidden", handleId: "", showHandle: false }],
      },
    } as FlowNode;
    const edgeToCopy: Edge = {
      id: "incoming",
      source: "upstream",
      sourceHandle: null,
      target: "source",
      targetHandle: "input-0",
    };

    const { result } = renderHook(() =>
      useConnectPorts({
        nodes: [targetNode, sourceNode],
        edges: [edgeToCopy],
        connectOpen: true,
        selectedSignature: "source|target",
        selectedNodeIds: ["target", "source"],
        isSwapped: false,
      })
    );

    await flushEffects();

    await waitFor(() => {
      expect(result.current.canConnect).toBe(true);
      expect(result.current.canConnectEdge).toBe(false);
      expect(result.current.canCopyInputs).toBe(true);
      expect(result.current.sourcePorts?.id).toBe("source");
      expect(result.current.targetPorts?.id).toBe("target");
    });
  });

  it("includes upstream source ports for copy-input labels", async () => {
    const upstreamNode = {
      id: "upstream",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        title: "Random 32 Bytes",
        functionName: "random_256",
        numInputs: 0,
      },
    } as FlowNode;
    const sourceNode = {
      id: "source",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        title: "Sign TX A",
        functionName: "sign_tx",
        inputStructure: {
          ungrouped: [{ index: 0, label: "Private Key" }],
        },
        outputPorts: [{ label: "hidden", handleId: "", showHandle: false }],
      },
    } as FlowNode;
    const targetNode = makeNode("target", 1);
    const edgeToCopy: Edge = {
      id: "incoming",
      source: "upstream",
      sourceHandle: null,
      target: "source",
      targetHandle: "input-0",
    };

    const { result } = renderHook(() =>
      useConnectPorts({
        nodes: [upstreamNode, sourceNode, targetNode],
        edges: [edgeToCopy],
        connectOpen: true,
        selectedSignature: "source|target",
        selectedNodeIds: ["source", "target"],
        isSwapped: false,
      })
    );

    await flushEffects();

    await waitFor(() => {
      expect(result.current.allPorts.map((port) => port.id)).toEqual([
        "source",
        "target",
        "upstream",
      ]);
      expect(result.current.allPorts.find((port) => port.id === "upstream"))
        .toMatchObject({
          label: "Random 32 Bytes",
          functionName: "random_256",
        });
    });
  });

  it.each([
    ["group", "shadcnGroup"],
    ["text info", "shadcnTextInfo"],
  ])("does not allow a %s node to connect to calculation inputs", async (_, type) => {
    const canvasNode = {
      id: "canvas-node",
      type,
      position: { x: 0, y: 0 },
      data: { title: "Canvas Node" },
    } as FlowNode;
    const targetNode = makeNode("target", 2);

    const { result } = renderHook(() =>
      useConnectPorts({
        nodes: [canvasNode, targetNode],
        edges: [],
        connectOpen: true,
        selectedSignature: "canvas-node|target",
        selectedNodeIds: ["canvas-node", "target"],
        isSwapped: false,
      })
    );

    await flushEffects();

    await waitFor(() => {
      expect(result.current.canConnect).toBe(false);
      expect(result.current.sourcePorts?.id).toBe("canvas-node");
      expect(result.current.sourcePorts?.outputs).toEqual([]);
    });
  });

  it.each([
    ["group", "shadcnGroup"],
    ["text info", "shadcnTextInfo"],
  ])("does not auto-orient through a %s node", async (_, type) => {
    const sourceNode = makeNode("source", 0);
    const canvasNode = {
      id: "canvas-node",
      type,
      position: { x: 0, y: 0 },
      data: { title: "Canvas Node" },
    } as FlowNode;

    const { result } = renderHook(() =>
      useConnectPorts({
        nodes: [sourceNode, canvasNode],
        edges: [],
        connectOpen: true,
        selectedSignature: "source|canvas-node",
        selectedNodeIds: ["source", "canvas-node"],
        isSwapped: false,
      })
    );

    await flushEffects();

    await waitFor(() => {
      expect(result.current.canConnect).toBe(false);
      expect(result.current.sourcePorts?.id).toBe("source");
      expect(result.current.targetPorts?.id).toBe("canvas-node");
    });
  });

  it("still allows non-backend action nodes with explicit outputs to connect", async () => {
    const trezorNode = {
      id: "trezor",
      type: "trezorAction",
      position: { x: 0, y: 0 },
      data: {
        title: "Trezor Get Address",
        outputPorts: [{ label: "address", handleId: "" }],
      },
    } as FlowNode;
    const targetNode = makeNode("target", 1);

    const { result } = renderHook(() =>
      useConnectPorts({
        nodes: [trezorNode, targetNode],
        edges: [],
        connectOpen: true,
        selectedSignature: "trezor|target",
        selectedNodeIds: ["trezor", "target"],
        isSwapped: false,
      })
    );

    await flushEffects();

    await waitFor(() => {
      expect(result.current.canConnect).toBe(true);
      expect(result.current.sourcePorts?.outputs).toEqual([
        { label: "address", handleId: "" },
      ]);
    });
  });

  it("exposes existing edges in a simplified format", () => {
    const { result } = renderHook(() =>
      useConnectPorts({
        nodes,
        edges,
        connectOpen: true,
        selectedSignature: "",
        selectedNodeIds: [],
        isSwapped: false,
      })
    );

    expect(result.current.existingEdges).toEqual([
      {
        source: "node-a",
        target: "node-b",
        sourceHandle: "output-1",
        targetHandle: "input-0",
      },
    ]);
  });

  it("does not expose hidden source outputs in connect dialog ports", async () => {
    const taprootTweakNode = {
      id: "taproot-tweak",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "taproot_tweak_xonly_pubkey",
        numInputs: 2,
        outputPorts: [
          { label: "Q (x-only)", handleId: "" },
          { label: "parity (c0/c1)", handleId: "output-1" },
          { label: "tweak (32B)", handleId: "output-2", showHandle: false },
        ],
      },
    } as FlowNode;

    const nonceNode = makeNode("musig2-nonce", 5);

    const { result } = renderHook(() =>
      useConnectPorts({
        nodes: [taprootTweakNode, nonceNode],
        edges: [],
        connectOpen: true,
        selectedSignature: "taproot-tweak|musig2-nonce",
        selectedNodeIds: ["taproot-tweak", "musig2-nonce"],
        isSwapped: false,
      })
    );

    await flushEffects();

    await waitFor(() => {
      expect(result.current.sourcePorts?.outputs).toEqual([
        { label: "Q (x-only)", handleId: "" },
        { label: "parity (c0/c1)", handleId: "output-1" },
      ]);
    });
  });
});
