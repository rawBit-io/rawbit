import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { FlowPanels } from "@/components/FlowPanels";
import type { FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";

const jumpTo = vi.fn();

vi.mock("@/hooks/useUndoRedo", () => ({
  useUndoRedo: () => ({
    history: [{ label: "Initial" }, { label: "Edit node" }],
    pointer: 1,
    jumpTo,
  }),
}));

const nodes: FlowNode[] = [
  {
    id: "node-1",
    type: "calculation",
    position: { x: 0, y: 0 },
    data: { title: "Node 1" },
  } as FlowNode,
];

const edges: Edge[] = [];

describe("FlowPanels", () => {
  const setShowUndoRedoPanel = vi.fn();
  const setShowErrorPanel = vi.fn();
  const setShowSearchPanel = vi.fn();
  const setShowBitcoinPanel = vi.fn();
  const setSearchQuery = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderPanels = () =>
    render(
      <FlowPanels
        showUndoRedoPanel
        setShowUndoRedoPanel={setShowUndoRedoPanel}
        showErrorPanel
        setShowErrorPanel={setShowErrorPanel}
        errorInfo={[{ nodeId: "node-1", error: "Boom!" }]}
        nodes={nodes}
        showSearchPanel
        setShowSearchPanel={setShowSearchPanel}
        showBitcoinPanel={false}
        setShowBitcoinPanel={setShowBitcoinPanel}
        onRebuildFlow={vi.fn()}
        searchQuery="hash"
        setSearchQuery={setSearchQuery}
        edges={edges}
        centerOnNode={vi.fn()}
        focusSearchHit={vi.fn()}
        hasMultipleTabs
      />
    );

  it("renders the real panels and wires close handlers", () => {
    renderPanels();

    expect(screen.getByText("Undo/Redo Stack")).toBeInTheDocument();
    expect(screen.getByText("Errors")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search node id, name, text")).toBeInTheDocument();

    const undoHeader = screen.getByText("Undo/Redo Stack").parentElement!;
    fireEvent.click(within(undoHeader).getByTitle("Close panel"));
    expect(setShowUndoRedoPanel).toHaveBeenCalledWith(false);

    const errorHeader = screen.getByText("Errors").parentElement!;
    fireEvent.click(within(errorHeader).getByTitle("Close panel"));
    expect(setShowErrorPanel).toHaveBeenCalledWith(false);

    const searchHeader = screen.getByText("Search").parentElement!;
    fireEvent.click(within(searchHeader).getByTitle("Close search"));
    expect(setShowSearchPanel).toHaveBeenCalledWith(false);

  });
});
