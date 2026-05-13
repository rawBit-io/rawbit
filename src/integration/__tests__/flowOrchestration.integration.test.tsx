import { act, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { useGlobalCalculationLogic } from "@/hooks/useCalculation";
import type { CalcError, FieldDefinition, FlowNode, NodeData } from "@/types";
import type { Edge } from "@xyflow/react";
import { buildFlowNode } from "@/test-utils/types";

const recalculateGraphMock = vi.hoisted(() =>
  vi.fn(async (nodes: FlowNode[], _edges: Edge[], version: number) => {
    void _edges;
    return {
      nodes: nodes.map((node) => ({
        ...node,
        data: { ...node.data, dirty: false, error: false },
      })),
      version,
      errors: [],
    };
  })
);
const getAffectedSubgraphMock = vi.hoisted(() =>
  vi.fn(
    (
      nodes: FlowNode[],
      edges: Edge[],
      _options?: { eligibleNodeIds?: Set<string> }
    ) => {
      void _options;
      return {
        affectedNodes: nodes,
        affectedEdges: edges,
      };
    }
  )
);
const mergePartialResultsIntoFullGraphMock = vi.hoisted(() =>
  vi.fn((nodes: FlowNode[], recalcNodes: FlowNode[]) => {
    void nodes;
    return recalcNodes;
  })
);
const checkForCyclesAndMarkErrorsMock = vi.hoisted(() => vi.fn<() => boolean>(() => false));
const removeScriptStepsMock = vi.hoisted(() =>
  vi.fn<(nodes: FlowNode[]) => void>(() => undefined)
);
const forEachFieldInstanceMock = vi.hoisted(() =>
  vi.fn<
    (data: NodeData, callback: (absoluteIndex: number, field: FieldDefinition) => void) => void
  >()
);
const getValMock = vi.hoisted(() => vi.fn<(store: unknown, idx: number) => string>());
const originalForEachRef = vi.hoisted(() => ({
  current: undefined as
    | ((
        data: NodeData,
        callback: (absoluteIndex: number, field: FieldDefinition) => void
      ) => void)
    | undefined,
}));
const originalGetValRef = vi.hoisted(() => ({
  current: undefined as ((store: unknown, idx: number) => string) | undefined,
}));
const reactFlowApiRef = vi.hoisted(() => ({
  current: {
    setNodes: (_incoming: FlowNode[] | ((prev: FlowNode[]) => FlowNode[])) => {
      void _incoming;
      return undefined;
    },
    getNodes: () => [] as FlowNode[],
    getEdges: () => [] as Edge[],
  },
}));

const createBaseNode = (overrides: Partial<FlowNode> = {}): FlowNode => {
  const { data, ...rest } = overrides;
  return buildFlowNode({
    id: "calc-1",
    type: "calculation",
    position: { x: 0, y: 0 },
    data: { functionName: "identity", dirty: false, ...(data ?? {}) },
    ...rest,
  });
};

vi.mock("@/lib/graphUtils", async (orig) => {
  const actual = await orig<typeof import("@/lib/graphUtils")>();
  return {
    ...actual,
    recalculateGraph: recalculateGraphMock,
    getAffectedSubgraph: (
      nodes: FlowNode[],
      edges: Edge[],
      options?: { eligibleNodeIds?: Set<string> }
    ) => getAffectedSubgraphMock(nodes, edges, options),
    mergePartialResultsIntoFullGraph: mergePartialResultsIntoFullGraphMock,
    checkForCyclesAndMarkErrors: checkForCyclesAndMarkErrorsMock,
  };
});

vi.mock("@/lib/share/scriptStepsCache", async (orig) => {
  const actual = await orig<typeof import("@/lib/share/scriptStepsCache")>();
  return {
    ...actual,
    removeScriptSteps: removeScriptStepsMock,
  };
});

vi.mock("@/lib/nodes/fieldUtils", async (orig) => {
  const actual = await orig<typeof import("@/lib/nodes/fieldUtils")>();
  originalForEachRef.current = actual.forEachFieldInstance;
  return {
    ...actual,
    forEachFieldInstance: (
      data: NodeData,
      callback: (absoluteIndex: number, field: FieldDefinition) => void
    ) => forEachFieldInstanceMock(data, callback),
  };
});

vi.mock("@/lib/utils", async (orig) => {
  const actual = await orig<typeof import("@/lib/utils")>();
  originalGetValRef.current = actual.getVal;
  return {
    ...actual,
    getVal: (store: unknown, idx: number) => getValMock(store, idx),
  };
});

vi.mock("@xyflow/react", async (orig) => {
  const actual = await orig<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => reactFlowApiRef.current,
  };
});

interface FlowOrchestrationHandles {
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  getNodes: () => FlowNode[];
  getEdges: () => Edge[];
  statusHistory: () => string[];
  errorsHistory: () => CalcError[][];
}

interface FlowOrchestrationHarnessProps {
  debounceMs?: number;
  initialNodes?: FlowNode[];
  initialEdges?: Edge[];
  onReady?: (handles: FlowOrchestrationHandles) => void;
}

function FlowOrchestrationHarness({
  debounceMs = 0,
  initialNodes = [],
  initialEdges = [],
  onReady,
}: FlowOrchestrationHarnessProps) {
  const [nodes, setNodes] = useState<FlowNode[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [status, setStatus] = useState("OK");

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    reactFlowApiRef.current = {
      setNodes: (incoming: FlowNode[] | ((prev: FlowNode[]) => FlowNode[])) => {
        setNodes((prev) =>
          typeof incoming === "function"
            ? (incoming as (prev: FlowNode[]) => FlowNode[])(prev)
            : incoming
        );
      },
      getNodes: () => nodesRef.current,
      getEdges: () => edgesRef.current,
    };
  }, [edges, nodes]);

  const statusHistoryRef = useRef<string[]>([]);
  const errorsHistoryRef = useRef<CalcError[][]>([]);

  useGlobalCalculationLogic({
    nodes,
    edges,
    debounceMs,
    onStatusChange: (nextStatus, errors = []) => {
      setStatus(nextStatus);
      statusHistoryRef.current.push(nextStatus);
      errorsHistoryRef.current.push(errors);
    },
  });

  useEffect(() => {
    onReady?.({
      setNodes,
      setEdges,
      getNodes: () => nodesRef.current,
      getEdges: () => edgesRef.current,
      statusHistory: () => [...statusHistoryRef.current],
      errorsHistory: () => [...errorsHistoryRef.current],
    });
  }, [edges, nodes, onReady]);

  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="dirty-flag">{String(nodes[0]?.data?.dirty ?? false)}</div>
      <div data-testid="error-flag">{String(nodes[0]?.data?.error ?? false)}</div>
    </div>
  );
}

async function renderFlowOrchestrationHarness(
  props: Omit<FlowOrchestrationHarnessProps, "onReady"> = {}
): Promise<{
  rerender: (nextProps?: Omit<FlowOrchestrationHarnessProps, "onReady">) => void;
  getHandles: () => FlowOrchestrationHandles;
}> {
  const handlesRef: { current: FlowOrchestrationHandles | null } = {
    current: null,
  };

  const view = render(
    <ReactFlowProvider>
      <FlowOrchestrationHarness
        {...props}
        onReady={(handles) => {
          handlesRef.current = handles;
        }}
      />
    </ReactFlowProvider>
  );

  await waitFor(() => expect(handlesRef.current).not.toBeNull());

  return {
    rerender: (nextProps = {}) => {
      view.rerender(
        <ReactFlowProvider>
          <FlowOrchestrationHarness
            {...nextProps}
            onReady={(handles) => {
              handlesRef.current = handles;
            }}
          />
        </ReactFlowProvider>
      );
    },
    getHandles: () => handlesRef.current as FlowOrchestrationHandles,
  };
}

describe("Flow orchestration integration", () => {
  beforeEach(() => {
    recalculateGraphMock.mockClear();
    getAffectedSubgraphMock.mockClear();
    mergePartialResultsIntoFullGraphMock.mockClear();
    checkForCyclesAndMarkErrorsMock.mockClear().mockReturnValue(false);
    removeScriptStepsMock.mockClear();

    forEachFieldInstanceMock.mockImplementation((data, cb) => {
      originalForEachRef.current?.(data, cb);
    });
    getValMock.mockImplementation((store, idx) =>
      originalGetValRef.current ? originalGetValRef.current(store, idx) : ""
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears dirty nodes after successful recalculation and records CALC → OK", async () => {
    const { getHandles } = await renderFlowOrchestrationHarness({
      debounceMs: 0,
      initialNodes: [createBaseNode()],
    });
    const handles = getHandles();

    await waitFor(() => expect(handles.getNodes().length).toBeGreaterThan(0));

    act(() => {
      handles.setNodes((prev) =>
        prev.map((node) => ({
          ...node,
          data: { ...node.data, dirty: true },
        }))
      );
    });

    await waitFor(() => expect(recalculateGraphMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("OK"));
    expect(screen.getByTestId("dirty-flag").textContent).toBe("false");

    const history = handles.statusHistory();
    expect(history).toContain("CALC");
    expect(history.at(-1)).toBe("OK");
  });

  it("recalculates even when multi-value inputs are empty", async () => {
    forEachFieldInstanceMock.mockImplementation((_data, cb) => {
      cb(0, { label: "field", index: 0, allowEmptyBlank: true, unconnectable: false });
    });
    getValMock.mockReturnValue("");

    const { getHandles } = await renderFlowOrchestrationHarness({
      initialNodes: [createBaseNode()],
    });
    const handles = getHandles();

    await waitFor(() => expect(handles.getNodes().length).toBe(1));

    act(() => {
      handles.setNodes((prev) =>
        prev.map((node) => ({
          ...node,
          data: {
            ...node.data,
            paramExtraction: "multi_val",
            functionName: "custom",
            dirty: true,
          },
        }))
      );
    });

    await waitFor(() => expect(recalculateGraphMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(handles.getNodes()[0]?.data?.dirty).toBe(false));
    expect(removeScriptStepsMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe("OK");
  });

  it("flags cycles without hitting the backend", async () => {
    checkForCyclesAndMarkErrorsMock.mockReturnValueOnce(true);

    const { getHandles } = await renderFlowOrchestrationHarness({
      initialNodes: [createBaseNode()],
    });
    const handles = getHandles();

    await waitFor(() => expect(handles.getNodes().length).toBe(1));

    act(() => {
      handles.setNodes((prev) =>
        prev.map((node) => ({
          ...node,
          data: { ...node.data, dirty: true },
        }))
      );
    });

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ERROR"));
    expect(screen.getByTestId("error-flag").textContent).toBe("true");
    expect(screen.getByTestId("dirty-flag").textContent).toBe("false");
    await waitFor(() => {
      const errorsHistory = handles.errorsHistory();
      expect(errorsHistory[errorsHistory.length - 1]).toEqual([
        {
          nodeId: "calc-1",
          error: "Cycle detected in this sub-graph – calculation aborted.",
        },
      ]);
    });
    expect(recalculateGraphMock).not.toHaveBeenCalled();
  });

  it("marks nodes errored when backend calculation fails", async () => {
    recalculateGraphMock.mockImplementationOnce(async () => {
      throw new Error("backend exploded");
    });

    const { getHandles } = await renderFlowOrchestrationHarness({
      initialNodes: [createBaseNode()],
    });
    const handles = getHandles();

    await waitFor(() => expect(handles.getNodes().length).toBe(1));

    act(() => {
      handles.setNodes((prev) =>
        prev.map((node) => ({
          ...node,
          data: { ...node.data, dirty: true },
        }))
      );
    });

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ERROR"));
    expect(screen.getByTestId("error-flag").textContent).toBe("true");
    expect(screen.getByTestId("dirty-flag").textContent).toBe("false");
    expect(recalculateGraphMock).toHaveBeenCalledTimes(1);
  });

  it("ignores stale backend responses and leaves dirty flags in place", async () => {
    recalculateGraphMock.mockImplementationOnce(async (nodes, _edges, version) => {
      void _edges;
      return {
        nodes: nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            dirty: false,
            error: node.data?.error ?? false,
          },
        })),
        version: version - 1,
        errors: [],
      };
    });

    const { getHandles } = await renderFlowOrchestrationHarness({
      initialNodes: [createBaseNode()],
    });
    const handles = getHandles();

    await waitFor(() => expect(handles.getNodes().length).toBe(1));
    mergePartialResultsIntoFullGraphMock.mockClear();

    act(() => {
      handles.setNodes((prev) =>
        prev.map((node) => ({
          ...node,
          data: { ...node.data, dirty: true },
        }))
      );
    });

    await waitFor(() => expect(recalculateGraphMock).toHaveBeenCalled());
    await waitFor(() => expect(mergePartialResultsIntoFullGraphMock).not.toHaveBeenCalled());

    expect(screen.getByTestId("dirty-flag").textContent).toBe("true");
    expect(screen.getByTestId("status").textContent).toBe("OK");
  });
});
