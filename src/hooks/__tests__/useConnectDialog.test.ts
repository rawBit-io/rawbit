import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";

import { useConnectDialog } from "../useConnectPorts";
import type { FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";

const makeNode = (id: string): FlowNode => ({
  id,
  type: "calculation",
  position: { x: 0, y: 0 },
  data: { functionName: "identity", numInputs: 1 },
  selected: true,
} as FlowNode);

describe("useConnectDialog", () => {
  const setup = () => {
    const markPending = vi.fn();
    const setConnectOpen = vi.fn();

    const hook = renderHook(() => {
      const [nodes, setNodes] = useState<FlowNode[]>([
        makeNode("node-a"),
        makeNode("node-b"),
      ]);
      const [edges, setEdges] = useState<Edge[]>([]);
      const skipNextEdgeSnapshotRef = useRef(false);

      const connect = useConnectDialog({
        nodes,
        edges,
        connectOpen: true,
        selectedNodeIds: nodes.filter((n) => n.selected).map((n) => n.id),
        setNodes: (updater) => setNodes((prev) => updater(prev)),
        setEdges: (updater) => setEdges((prev) => updater(prev)),
        markPendingAfterDirtyChange: markPending,
        skipNextEdgeSnapshotRef,
        setConnectOpen,
      });

      return { connect, nodes, edges, skipNextEdgeSnapshotRef };
    });

    return { hook, markPending, setConnectOpen };
  };

  it("adds edges, marks targets dirty, and closes the dialog", () => {
    const { hook, markPending, setConnectOpen } = setup();

    act(() => {
      hook.result.current.connect.handleApply([
        {
          source: "node-a",
          sourceHandle: null,
          target: "node-b",
          targetHandle: null,
        },
      ]);
    });

    expect(hook.result.current.edges).toHaveLength(1);
    const [, targetNode] = hook.result.current.nodes;
    expect(targetNode.data?.dirty).toBe(true);
    expect(hook.result.current.skipNextEdgeSnapshotRef.current).toBe(true);
    expect(markPending).toHaveBeenCalledTimes(1);
    expect(setConnectOpen).toHaveBeenCalledWith(false);
  });

  it("swaps source and target when no connections are applied", () => {
    const { hook, markPending, setConnectOpen } = setup();

    const initialSourceId = hook.result.current.connect.sourcePorts?.id;

    act(() => {
      hook.result.current.connect.handleApply([]);
    });

    const swappedSourceId = hook.result.current.connect.sourcePorts?.id;
    expect(initialSourceId).toBe("node-a");
    expect(swappedSourceId).toBe("node-b");
    expect(markPending).not.toHaveBeenCalled();
    expect(setConnectOpen).not.toHaveBeenCalled();
  });

  it("resets swapped direction when the selected pair changes", async () => {
    const markPending = vi.fn();
    const setConnectOpen = vi.fn();
    const nodes = [makeNode("node-a"), makeNode("node-b"), makeNode("node-c")];

    const hook = renderHook(
      ({ selectedNodeIds }: { selectedNodeIds: string[] }) => {
        const skipNextEdgeSnapshotRef = useRef(false);

        return useConnectDialog({
          nodes,
          edges: [],
          connectOpen: true,
          selectedNodeIds,
          setNodes: vi.fn(),
          setEdges: vi.fn(),
          markPendingAfterDirtyChange: markPending,
          skipNextEdgeSnapshotRef,
          setConnectOpen,
        });
      },
      { initialProps: { selectedNodeIds: ["node-a", "node-b"] } }
    );

    act(() => {
      hook.result.current.handleApply([]);
    });

    await waitFor(() => {
      expect(hook.result.current.sourcePorts?.id).toBe("node-b");
    });

    hook.rerender({ selectedNodeIds: ["node-a", "node-c"] });

    await waitFor(() => {
      expect(hook.result.current.sourcePorts?.id).toBe("node-a");
      expect(hook.result.current.targetPorts?.id).toBe("node-c");
    });
  });
});
