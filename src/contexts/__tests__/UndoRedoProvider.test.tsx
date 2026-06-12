import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Edge } from "@xyflow/react";
import type { FlowNode } from "@/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestScriptSteps = vi.fn((nodes: FlowNode[]) => nodes);
const snapshotScriptSteps = vi.fn(() => [] as unknown[]);
const restoreScriptSteps = vi.fn();

vi.mock("@/lib/share/scriptStepsCache", () => ({
  ingestScriptSteps: (...args: unknown[]) => ingestScriptSteps(...(args as [FlowNode[]])),
  snapshotScriptSteps: () => snapshotScriptSteps(),
  restoreScriptSteps: (...args: unknown[]) => restoreScriptSteps(...(args as [unknown])),
  removeScriptSteps: vi.fn(),
}));

import { UndoRedoProvider } from "../UndoRedoContext";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { buildGroupBundledElements } from "@/lib/flow/groupEdgeBundling";

const wrapper = ({ children }: { children: ReactNode }) => (
  <UndoRedoProvider>{children}</UndoRedoProvider>
);

const makeNode = (id: string): FlowNode => ({
  id,
  type: "calculation",
  position: { x: 0, y: 0 },
  data: { title: id },
  selected: false,
} as FlowNode);

const edges: Edge[] = [];

describe("UndoRedoProvider", () => {
  beforeEach(() => {
    ingestScriptSteps.mockClear();
    snapshotScriptSteps.mockClear();
    restoreScriptSteps.mockClear();
  });

  it("enforces history limits and preserves snapshot labels", async () => {
    const { result } = renderHook(() => useUndoRedo(), { wrapper });

    for (let i = 0; i < 52; i += 1) {
      await act(async () => {
        result.current.pushState([makeNode(`n${i}`)], edges, `Snap ${i}`);
      });
    }

    expect(snapshotScriptSteps).toHaveBeenCalledTimes(52);
    expect(result.current.history).toHaveLength(50);
    expect(result.current.history[0]?.label).toBe("Snap 2");
    expect(result.current.history.at(-1)?.label).toBe("Snap 51");
    expect(result.current.pointer).toBe(49);
  });

  it("supports undo and redo navigation", async () => {
    const { result } = renderHook(() => useUndoRedo(), { wrapper });

    await act(async () => {
      result.current.pushState([makeNode("n1")], edges, "First");
    });
    await act(async () => {
      result.current.pushState([makeNode("n2")], edges, "Second");
    });
    await act(async () => {
      result.current.pushState([makeNode("n3")], edges, "Third");
    });

    expect(result.current.history).toHaveLength(3);

    await act(async () => {
      result.current.undo();
    });
    await act(async () => {
      result.current.undo();
    });
    expect(result.current.pointer).toBe(0);

    await act(async () => {
      result.current.redo();
    });
    expect(result.current.pointer).toBe(1);
  });

  it("initializes and switches tab histories while restoring script steps", async () => {
    const { result } = renderHook(() => useUndoRedo(), { wrapper });

    await act(async () => {
      result.current.initializeTabHistory("tab-2", [makeNode("x")], edges);
    });

    expect(restoreScriptSteps).toHaveBeenCalled();
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]?.label).toBe("Initial snapshot");
    expect(result.current.pointer).toBe(0);

    await act(async () => {
      result.current.pushState([makeNode("x2")], edges, "Update");
    });

    await act(async () => {
      result.current.setActiveTab("tab-1");
    });

    expect(result.current.history).toEqual([]);
  });

  it("does not restore script steps when only switching active tab context", async () => {
    const { result } = renderHook(() => useUndoRedo(), { wrapper });

    await act(async () => {
      result.current.initializeTabHistory("tab-2", [makeNode("x")], edges);
    });

    restoreScriptSteps.mockClear();

    await act(async () => {
      result.current.setActiveTab("tab-1");
    });

    expect(restoreScriptSteps).not.toHaveBeenCalled();
  });

  it("can push a snapshot into a non-active tab history", async () => {
    const { result } = renderHook(() => useUndoRedo(), { wrapper });

    await act(async () => {
      result.current.initializeTabHistory("tab-2", [], edges);
    });
    await act(async () => {
      result.current.setActiveTab("tab-1");
    });
    await act(async () => {
      result.current.pushState([makeNode("shared")], edges, {
        label: "Imported shared flow abc",
        tabId: "tab-2",
      });
    });

    expect(result.current.history).toEqual([]);

    await act(async () => {
      result.current.setActiveTab("tab-2");
    });

    expect(result.current.history.map((snapshot) => snapshot.label)).toEqual([
      "Initial snapshot",
      "Imported shared flow abc",
    ]);
    expect(result.current.history.at(-1)?.nodes.map((node) => node.id)).toEqual([
      "shared",
    ]);
  });

  it("stores calc state metadata with snapshots", async () => {
    const { result } = renderHook(() => useUndoRedo(), { wrapper });

    const calcState = {
      status: "ERROR" as const,
      errors: [{ nodeId: "n1", error: "Too many" }],
    };

    await act(async () => {
      result.current.pushState([makeNode("n1")], edges, {
        label: "Limit hit",
        calcState,
      });
    });

    const stored = result.current.history.at(-1)?.calcState;
    expect(stored).toEqual(calcState);
    expect(stored).not.toBe(calcState);
    expect(stored?.errors).not.toBe(calcState.errors);
  });

  it("keeps generated group bundle elements out of history snapshots", async () => {
    const { result } = renderHook(() => useUndoRedo(), { wrapper });
    const nodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      makeNode("a1"),
      makeNode("a2"),
      makeNode("b1"),
    ].map((node) =>
      node.id === "a1" || node.id === "a2"
        ? { ...node, parentId: "group-a" }
        : node.id === "b1"
          ? { ...node, parentId: "group-b" }
          : node
    ) as FlowNode[];
    const bundledEdges: Edge[] = [
      { id: "e1", source: "a1", target: "b1" } as Edge,
      { id: "e2", source: "a2", target: "b1" } as Edge,
    ];
    const visual = buildGroupBundledElements({ nodes, edges: bundledEdges });

    await act(async () => {
      result.current.pushState(visual.nodes, visual.edges, "Visual graph");
    });

    const snapshot = result.current.history.at(-1);
    expect(snapshot?.nodes).toHaveLength(nodes.length);
    expect(snapshot?.edges).toHaveLength(bundledEdges.length);
    expect(
      snapshot?.nodes.some((node) => node.id.startsWith("__group_bundle_port__:"))
    ).toBe(false);
    expect(
      snapshot?.edges.some(
        (edge) =>
          edge.id.startsWith("__group_bundle__:") ||
          edge.id.startsWith("__group_bundle_segment__:") ||
          edge.hidden === true
      )
    ).toBe(false);
  });

  it("replaceState folds into the matching top entry without adding a history step", async () => {
    const { result } = renderHook(() => useUndoRedo(), { wrapper });

    await act(async () => {
      result.current.pushState([makeNode("a")], edges, "Initial");
    });
    await act(async () => {
      result.current.pushState([makeNode("b")], edges, "Node(s) removed");
    });
    expect(result.current.history).toHaveLength(2);

    // After-calc folds into "Node(s) removed": same entry count, label kept,
    // state refreshed to the post-recalc nodes.
    await act(async () => {
      result.current.replaceState([makeNode("b-recalculated")], edges, {
        label: "After calc",
        coalesceFromLabel: "Node(s) removed",
      });
    });

    expect(result.current.history).toHaveLength(2);
    expect(result.current.history.at(-1)?.label).toBe("Node(s) removed");
    expect(result.current.history.at(-1)?.nodes[0]?.id).toBe("b-recalculated");
    expect(result.current.pointer).toBe(1);

    // One undo returns to before the structural action — a single step.
    await act(async () => {
      result.current.undo();
    });
    expect(result.current.history[result.current.pointer]?.label).toBe("Initial");
  });

  it("replaceState appends when the top entry is not the coalesce target", async () => {
    const { result } = renderHook(() => useUndoRedo(), { wrapper });

    await act(async () => {
      result.current.pushState([makeNode("a")], edges, "Some edit");
    });

    // No "Node(s) removed" on top — a plain edit's after-calc must append.
    await act(async () => {
      result.current.replaceState([makeNode("b")], edges, {
        label: "After calc",
        coalesceFromLabel: "Node(s) removed",
      });
    });

    expect(result.current.history).toHaveLength(2);
    expect(result.current.history.at(-1)?.label).toBe("After calc");
    expect(result.current.pointer).toBe(1);
  });

  it("throws when useUndoRedo is used without a provider", () => {
    const { result } = renderHook(() => {
      try {
        return useUndoRedo();
      } catch (error) {
        return error as Error;
      }
    });

    expect(result.current).toBeInstanceOf(Error);
    expect((result.current as Error).message).toMatch(
      /useUndoRedo must be used inside an UndoRedoProvider/
    );
  });
});
