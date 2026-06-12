import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ErrorPanel } from "../ErrorPanel";
import type { FlowNode } from "@/types";
import { mockClipboard } from "@/test-utils/dom";

const nodes: FlowNode[] = [
  {
    id: "node-1",
    type: "calculation",
    position: { x: 0, y: 0 },
    data: { title: "Node One" },
  } as FlowNode,
];

describe("ErrorPanel", () => {
  const errors = [{ nodeId: "node-1", error: "Boom!" }];

  it("invokes onSelect for clicks and keyboard events", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ErrorPanel
        isOpen
        errors={errors}
        nodes={nodes}
        onSelect={onSelect}
        onClose={onClose}
        hasVisibleTabs
      />
    );

    const entry = screen.getByText("Boom!").closest("[role='button']");
    expect(entry).not.toBeNull();
    fireEvent.click(entry!);
    expect(onSelect).toHaveBeenCalledWith("node-1");

    fireEvent.keyDown(entry!, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);

    const closeButton = screen.getByTitle("Close panel");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not select the node when keyboard-activating the nested copy button", () => {
    const onSelect = vi.fn();
    render(
      <ErrorPanel isOpen errors={errors} nodes={nodes} onSelect={onSelect} hasVisibleTabs />
    );

    const copyButton = screen.getByLabelText("Copy error info for Node One");
    fireEvent.keyDown(copyButton, { key: "Enter" });
    fireEvent.keyDown(copyButton, { key: " " });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("copies error info via navigator.clipboard when available", async () => {
    const clipboard = mockClipboard();
    render(
      <ErrorPanel isOpen errors={errors} nodes={nodes} onSelect={vi.fn()} hasVisibleTabs />
    );

    const copyButton = screen.getByLabelText("Copy error info for Node One");
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith("Node One node-1\nError: Boom!")
    );
    clipboard.restore();
  });

  it("falls back to execCommand when clipboard API is absent", async () => {
    const navigatorWithClipboard = window.navigator as Navigator & { clipboard?: Clipboard };
    const originalClipboard = navigatorWithClipboard.clipboard;
    Reflect.deleteProperty(navigatorWithClipboard, "clipboard");

    const execSpy = vi.spyOn(document, "execCommand").mockReturnValue(true);

    render(
      <ErrorPanel isOpen errors={errors} nodes={nodes} onSelect={vi.fn()} hasVisibleTabs />
    );

    const copyButton = screen.getByLabelText("Copy error info for Node One");
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

  it("prevents text selection within the panel surface", () => {
    render(
      <ErrorPanel isOpen errors={errors} nodes={nodes} onSelect={vi.fn()} hasVisibleTabs />
    );

    expect(screen.getByTestId("error-panel").className).toContain("select-none");
  });
});
