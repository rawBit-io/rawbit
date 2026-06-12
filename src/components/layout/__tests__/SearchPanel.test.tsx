import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchPanel } from "../SearchPanel";
import type { FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";
import { mockClipboard } from "@/test-utils/dom";

const nodes: FlowNode[] = [
  {
    id: "hash-node",
    type: "calculation",
    position: { x: 0, y: 0 },
    data: { title: "Hash Node", comment: "hash", inputs: {}, paramExtraction: "multi_val" },
    selected: false,
  } as FlowNode,
];

const edges: Edge[] = [];

describe("SearchPanel", () => {
  const renderPanel = (override: Partial<ComponentProps<typeof SearchPanel>> = {}) =>
    render(
      <SearchPanel
        isOpen
        nodes={nodes}
        edges={edges}
        query=""
        setQuery={vi.fn()}
        onSelect={vi.fn()}
        hasVisibleTabs
        {...override}
      />
    );

  it("debounces query updates on change", () => {
    vi.useFakeTimers();
    const setQuery = vi.fn();

    renderPanel({ setQuery });

    const input = screen.getByPlaceholderText("Search node id, name, text");
    fireEvent.change(input, { target: { value: "hash" } });

    expect(setQuery).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    expect(setQuery).toHaveBeenCalledWith("hash");
    vi.useRealTimers();
  });

  it("invokes onSelect via keyboard interaction", () => {
    const onSelect = vi.fn();
    renderPanel({ query: "hash", setQuery: vi.fn(), onSelect });

    const item = screen.getByText("Hash Node").closest("[role='button']");
    expect(item).not.toBeNull();
    fireEvent.keyDown(item!, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("hash-node");
  });

  it("does not fire the row action when keyboard-activating the nested copy button", async () => {
    const onSelect = vi.fn();
    const onLocateMatch = vi.fn();
    renderPanel({ query: "hash", setQuery: vi.fn(), onSelect, onLocateMatch });

    const copyButton = await screen.findByLabelText(/Copy: Hash Node hash-node/);
    fireEvent.keyDown(copyButton, { key: "Enter" });
    fireEvent.keyDown(copyButton, { key: " " });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onLocateMatch).not.toHaveBeenCalled();
  });

  it("copies text using navigator.clipboard when available", async () => {
    const clipboard = mockClipboard();
    renderPanel({ query: "hash", setQuery: vi.fn() });

    const copyButton = await screen.findByLabelText(/Copy: Hash Node hash-node/);
    fireEvent.click(copyButton);

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("Hash Node hash-node"));
    clipboard.restore();
  });

  it("falls back to document.execCommand when clipboard API is missing", async () => {
    const navigatorWithClipboard = window.navigator as Navigator & { clipboard?: Clipboard };
    const originalClipboard = navigatorWithClipboard.clipboard;
    Reflect.deleteProperty(navigatorWithClipboard, "clipboard");
    const execSpy = vi.spyOn(document, "execCommand").mockReturnValue(true);

    renderPanel({ query: "hash", setQuery: vi.fn() });
    const copyButton = await screen.findByLabelText(/Copy: Hash Node hash-node/);
    fireEvent.click(copyButton);

    await waitFor(() => expect(execSpy).toHaveBeenCalledWith("copy"));

    execSpy.mockRestore();
    if (originalClipboard) {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    } else {
      Reflect.deleteProperty(window.navigator, "clipboard");
    }
  });

  it("prevents panel text selection while keeping input selectable", () => {
    renderPanel();

    expect(screen.getByTestId("search-panel").className).toContain("select-none");
    expect(
      screen.getByPlaceholderText("Search node id, name, text").className
    ).toContain("select-text");
  });
});
