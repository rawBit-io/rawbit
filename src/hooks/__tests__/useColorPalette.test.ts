import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { useColorPalette } from "../useColorPalette";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { FlowNode } from "@/types";
import { buildFlowNode } from "@/test-utils/types";
import { createMouseEvent } from "@/test-utils/events";

const buildNode = (id: string, selected = true): FlowNode =>
  buildFlowNode({
    id,
    selected,
    data: { functionName: "identity" },
  });

describe("useColorPalette", () => {
  const scheduleSnapshot = vi.fn();

  const setup = (
    nodes: FlowNode[] = [buildNode("node-1")],
    isColorable: (node: FlowNode) => boolean = (node) =>
      node.type === "calculation"
  ) =>
    renderHook(() => {
      const [state, setState] = useState(nodes);

      const palette = useColorPalette({
        getNodes: () => state,
        setNodes: (updater) => setState((prev) => updater(prev)),
        scheduleSnapshot,
        isColorable,
      });

      return { palette, nodes: state };
    });

  beforeEach(() => {
    scheduleSnapshot.mockClear();
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  });

  it("opens when selection is eligible and applies colors", () => {
    const hook = setup();

    act(() => {
      hook.result.current.palette.updateEligibility();
    });

    expect(hook.result.current.palette.canApply).toBe(true);

    act(() => {
      hook.result.current.palette.open(
        createMouseEvent("pointerdown", { clientX: 900 }) as unknown as ReactMouseEvent<Element>
      );
    });

    expect(hook.result.current.palette.isOpen).toBe(true);
    expect(hook.result.current.palette.position).toEqual({ x: 828, y: 64 });

    act(() => {
      hook.result.current.palette.apply("#ffeeaa");
    });

    expect(scheduleSnapshot).toHaveBeenCalledWith("Change Node Color");
    expect(hook.result.current.nodes[0].data?.borderColor).toBe("#ffeeaa");
    expect(hook.result.current.palette.isOpen).toBe(false);
  });

  it("marks text info fill as none when reset is applied", () => {
    const textInfoNode = buildFlowNode({
      id: "text-1",
      type: "shadcnTextInfo",
      selected: true,
      data: {
        functionName: "shadcnTextInfo",
        borderColor: "#d6a500",
      },
    });
    const hook = setup([textInfoNode], (node) => node.type === "shadcnTextInfo");

    act(() => {
      hook.result.current.palette.apply(undefined);
    });

    expect(hook.result.current.nodes[0].data?.borderColor).toBeUndefined();
    expect(hook.result.current.nodes[0].data?.textInfoFill).toBe("none");
  });

  it("keeps palette closed when no eligible selection exists", () => {
    const hook = setup([buildNode("node-1", false)]);

    act(() => {
      hook.result.current.palette.updateEligibility();
      hook.result.current.palette.open(
        createMouseEvent("pointerdown", { clientX: 100 }) as unknown as ReactMouseEvent<Element>
      );
    });

    expect(hook.result.current.palette.canApply).toBe(false);
    expect(hook.result.current.palette.isOpen).toBe(false);
    expect(scheduleSnapshot).not.toHaveBeenCalled();
  });
});
