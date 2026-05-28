import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlowHotkeys } from "../useFlowHotkeys";

describe("useFlowHotkeys", () => {
  const setup = () => {
    const paletteOpenRef = { current: false };
    const hasSelectionRef = { current: true };
    const hasCopiedNodesRef = { current: true };
    const canUndoRef = { current: true };
    const canRedoRef = { current: true };
    const canGroupSelectedRef = { current: () => true };
    const canUngroupSelectedRef = { current: () => true };

    const copyNodes = vi.fn();
    const pasteNodes = vi.fn();
    const undo = vi.fn();
    const redo = vi.fn();
    const group = vi.fn();
    const ungroup = vi.fn();

    renderHook(() =>
      useFlowHotkeys({
        paletteOpenRef,
        hasSelectionRef,
        hasCopiedNodesRef,
        copyNodesRef: { current: copyNodes },
        pasteNodesRef: { current: pasteNodes },
        canUndoRef,
        canRedoRef,
        undoRef: { current: undo },
        redoRef: { current: redo },
        canGroupSelectedRef,
        canUngroupSelectedRef,
        groupWithUndoRef: { current: group },
        ungroupWithUndoRef: { current: ungroup },
      })
    );

    return {
      paletteOpenRef,
      hasSelectionRef,
      hasCopiedNodesRef,
      canUndoRef,
      canRedoRef,
      canGroupSelectedRef,
      canUngroupSelectedRef,
      copyNodes,
      pasteNodes,
      undo,
      redo,
      group,
      ungroup,
    } as const;
  };

  beforeEach(() => {
    // ensure document has focusable body
    document.body.innerHTML = "<div></div>";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fireKey = (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true, ...options });
    window.dispatchEvent(event);
  };

  it("invokes clipboard actions", () => {
    const { copyNodes, pasteNodes } = setup();

    fireKey("c");
    fireKey("v");

    expect(copyNodes).toHaveBeenCalledTimes(1);
    expect(pasteNodes).toHaveBeenCalledWith(false);
  });

  it("honours meta-key shortcuts on macOS", () => {
    const { copyNodes } = setup();

    fireKey("c", { ctrlKey: false, metaKey: true });

    expect(copyNodes).toHaveBeenCalledTimes(1);
  });

  it("skips shortcuts while palette is open", () => {
    const { paletteOpenRef, copyNodes } = setup();
    paletteOpenRef.current = true;

    fireKey("c");
    expect(copyNodes).not.toHaveBeenCalled();
  });

  it("honours undo/redo and grouping shortcuts", () => {
    const { undo, redo, group, ungroup } = setup();

    fireKey("z");
    fireKey("y");
    fireKey("g");
    fireKey("u");

    expect(undo).toHaveBeenCalled();
    expect(redo).toHaveBeenCalled();
    expect(group).toHaveBeenCalled();
    expect(ungroup).toHaveBeenCalled();
  });

  it("does not call ungroup shortcut without an ungroupable selection", () => {
    const { canUngroupSelectedRef, ungroup } = setup();
    canUngroupSelectedRef.current = () => false;

    fireKey("u");

    expect(ungroup).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while typing", () => {
    const { copyNodes } = setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireKey("c");
    expect(copyNodes).not.toHaveBeenCalled();
  });

  it("falls back to copy/paste events if keydown is suppressed", () => {
    const { copyNodes, pasteNodes } = setup();

    const copyEvent = new Event("copy") as ClipboardEvent;
    const pasteEvent = new Event("paste") as ClipboardEvent;

    document.dispatchEvent(copyEvent);
    document.dispatchEvent(pasteEvent);

    expect(copyNodes).toHaveBeenCalledTimes(1);
    expect(pasteNodes).toHaveBeenCalledWith(false);
  });
});
