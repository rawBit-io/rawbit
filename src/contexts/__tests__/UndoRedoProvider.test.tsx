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
