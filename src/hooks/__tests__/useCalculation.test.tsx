import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Edge } from "@xyflow/react";
import type { FlowNode, RecalcResponse } from "@/types";
import { buildFlowNode } from "@/test-utils/types";

const setNodesMock = vi.hoisted(() => vi.fn());
const recalculateGraphMock = vi.hoisted(() => vi.fn());

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>(
    "@xyflow/react"
  );
  return {
    ...actual,
    useReactFlow: () => ({ setNodes: setNodesMock }),
  };
});

vi.mock("@/lib/graphUtils", () => ({
  recalculateGraph: recalculateGraphMock,
  getAffectedSubgraph: (nodes: FlowNode[], edges: Edge[]) => ({
    affectedNodes: nodes.filter((node) => node.data?.dirty),
    affectedEdges: edges,
  }),
  checkForCyclesAndMarkErrors: () => false,
  mergePartialResultsIntoFullGraph: (
    _nodes: FlowNode[],
    recalcNodes: FlowNode[]
  ) => recalcNodes,
}));

import { useGlobalCalculationLogic } from "../useCalculation";

function makeNode(id: string, dirty: boolean): FlowNode {
  return buildFlowNode({
    id,
    type: "calculation",
    position: { x: 0, y: 0 },
    data: { functionName: "identity", dirty },
  });
}

function deferredRecalc() {
  let resolve!: (value: RecalcResponse) => void;
  const promise = new Promise<RecalcResponse>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useGlobalCalculationLogic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setNodesMock.mockClear();
    recalculateGraphMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ignores in-flight calculation responses after the graph changes", async () => {
    const pending = deferredRecalc();
    recalculateGraphMock.mockReturnValueOnce(pending.promise);
    const onStatusChange = vi.fn();

    const { rerender } = renderHook(
      ({ nodes }) =>
        useGlobalCalculationLogic({
          nodes,
          edges: [],
          debounceMs: 0,
          onStatusChange,
        }),
      {
        initialProps: {
          nodes: [makeNode("old-dirty", true)],
        },
      }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(recalculateGraphMock).toHaveBeenCalledTimes(1);

    rerender({ nodes: [makeNode("new-clean", false)] });

    await act(async () => {
      pending.resolve({
        version: 1,
        nodes: [{ ...makeNode("old-dirty", false), data: { result: "stale" } }],
        errors: [],
      });
      await Promise.resolve();
    });

    expect(setNodesMock).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith("CALC");
    expect(onStatusChange).toHaveBeenCalledWith("OK", []);
  });

  it("dedupes structurally-identical edges before the backend round-trip", async () => {
    // Regression for the Safari shared-import bug: the live edge state can
    // transiently hold a duplicate cable (same source→target+handle, different
    // edge id). Sending both yields "Multiple cables connected to input N".
    recalculateGraphMock.mockResolvedValue({ version: 1, nodes: [], errors: [] });
    const onStatusChange = vi.fn();

    const dupEdges: Edge[] = [
      { id: "e1", source: "a", target: "b", targetHandle: "input-0" } as Edge,
      { id: "e2", source: "a", target: "b", targetHandle: "input-0" } as Edge,
    ];

    renderHook(() =>
      useGlobalCalculationLogic({
        nodes: [makeNode("a", false), makeNode("b", true)],
        edges: dupEdges,
        debounceMs: 0,
        onStatusChange,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(recalculateGraphMock).toHaveBeenCalledTimes(1);
    const sentEdges = recalculateGraphMock.mock.calls[0][1] as Edge[];
    expect(sentEdges).toHaveLength(1);
    expect(sentEdges[0]).toMatchObject({
      source: "a",
      target: "b",
      targetHandle: "input-0",
    });
  });
});
