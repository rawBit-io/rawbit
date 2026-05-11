import { act, render, screen, fireEvent } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  TopBar,
  type TopBarProps,
  type ExtraTopBarProps,
} from "@/components/layout/TopBar";
import {
  EDGE_THICKNESS_STEP,
  EDGE_VISIBILITY_STEP,
  GROUP_FILL_OPACITY_STEP,
} from "@/contexts/theme";

const undoMock = vi.fn();
const redoMock = vi.fn();
const setThemeMock = vi.fn<(theme: string) => void>();
const setSkinMock = vi.fn<(skin: string) => void>();
const adjustEdgeVisibilityMock = vi.fn<(mode: string, delta: number) => void>();
const adjustDashedEdgeVisibilityMock = vi.fn<
  (mode: string, delta: number) => void
>();
const adjustGroupFillOpacityMock = vi.fn<
  (mode: string, delta: number) => void
>();
const adjustEdgeThicknessMock = vi.fn<(mode: string, delta: number) => void>();
let themeMock: "light" | "dark" | "system" = "light";

vi.mock("@/hooks/useUndoRedo", () => ({
  useUndoRedo: () => ({
    undo: undoMock,
    redo: redoMock,
    canUndo: false,
    canRedo: true,
  }),
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: themeMock,
    setTheme: setThemeMock,
    skin: "shadcn",
    setSkin: setSkinMock,
    edgeVisibility: { light: 0.65, dark: 0.65 },
    dashedEdgeVisibility: { light: 0.325, dark: 0.325 },
    groupFillOpacity: { light: 0.07, dark: 0.07 },
    edgeThickness: { light: 1, dark: 1 },
    adjustEdgeVisibility: adjustEdgeVisibilityMock,
    adjustDashedEdgeVisibility: adjustDashedEdgeVisibilityMock,
    adjustGroupFillOpacity: adjustGroupFillOpacityMock,
    adjustEdgeThickness: adjustEdgeThicknessMock,
  }),
}));

const fileInputRef: MutableRefObject<HTMLInputElement | null> = { current: null };

const baseProps: TopBarProps & ExtraTopBarProps = {
  isSidebarOpen: true,
  onToggle: vi.fn(),
  onSave: vi.fn(),
  onSaveSimplified: vi.fn(),
  onSaveLlmExport: vi.fn(),
  onShare: vi.fn(),
  shareDisabled: true,
  onLoad: vi.fn(),
  onCopy: vi.fn(),
  onPaste: vi.fn(),
  canCopy: false,
  hasCopiedNodes: false,
  fileInputRef,
  onFileSelect: vi.fn(),
  calcStatus: "OK",
  errorInfo: [],
  errorCount: 0,
  showErrorPanel: false,
  setShowErrorPanel: vi.fn(),
  onRetryAll: vi.fn(),
  hasLimitErrors: false,
  onToggleColorPalette: vi.fn(),
  isColorPaletteOpen: false,
  canColorSelection: false,
  onGroup: vi.fn(),
  onUngroup: vi.fn(),
  canGroupSelectedNodes: () => false,
  canUngroupSelectedNodes: () => true,
  showUndoRedoPanel: false,
  setShowUndoRedoPanel: vi.fn(),
  tabs: [{ id: "tab-1", title: "Flow 1" }],
  activeTabId: "tab-1",
  onTabSelect: vi.fn(),
  onAddTab: vi.fn(),
  onCloseTab: vi.fn(),
  onRenameTab: vi.fn(),
  onConnectClick: vi.fn(),
  connectDisabled: true,
  onSearchClick: vi.fn(),
  setShowSearchPanel: vi.fn(),
  showMiniMap: true,
  onToggleMiniMap: vi.fn(),
  showInfoNodes: true,
  hasInfoNodes: true,
  onToggleInfoNodes: vi.fn(),
  isSelectionModeActive: false,
  onToggleSelectionMode: vi.fn(),
  onWalkthroughClick: vi.fn(),
};

function openSkinMenu() {
  const trigger = screen.getByRole("button", { name: "Skin: shadcn" });
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("TopBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setThemeMock.mockClear();
    setSkinMock.mockClear();
    adjustEdgeVisibilityMock.mockClear();
    adjustDashedEdgeVisibilityMock.mockClear();
    adjustGroupFillOpacityMock.mockClear();
    adjustEdgeThicknessMock.mockClear();
    themeMock = "light";
  });

  it("disables share and undo buttons based on props", () => {
    render(<TopBar {...baseProps} />);

    expect(screen.getByRole("button", { name: "Share snapshot" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Group" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ungroup" })).not.toBeDisabled();
  });

  it("invokes toggles for minimap, selection mode, and theme", () => {
    render(<TopBar {...baseProps} shareDisabled={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide minimap" }));
    expect(baseProps.onToggleMiniMap).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Hide info nodes" }));
    expect(baseProps.onToggleInfoNodes).toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Selection tool (click to toggle or hold S + drag with LMB)",
      })
    );
    expect(baseProps.onToggleSelectionMode).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });

  it("opens the walkthrough from the topbar button", () => {
    render(<TopBar {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Walkthrough" }));

    expect(baseProps.onWalkthroughClick).toHaveBeenCalledTimes(1);
  });

  it("disables the info node toggle when no info nodes exist", () => {
    render(<TopBar {...baseProps} hasInfoNodes={false} />);

    expect(screen.getByRole("button", { name: "No info nodes" })).toBeDisabled();
  });

  it("marks the info node toggle active when info nodes are hidden", () => {
    render(<TopBar {...baseProps} showInfoNodes={false} />);

    const toggle = screen.getByRole("button", { name: "Show info nodes" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAttribute("data-active", "true");
  });

  it("applies skin selection and clears focus from skin trigger on close", () => {
    render(<TopBar {...baseProps} />);

    const trigger = screen.getByRole("button", { name: "Skin: shadcn" });
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: /paper ledger/i }));

    expect(setSkinMock).toHaveBeenCalledWith("paper");
    expect(trigger).not.toHaveFocus();
  });

  it("adjusts the active light edge visibility from the skin menu", () => {
    render(<TopBar {...baseProps} />);

    openSkinMenu();

    expect(screen.getByText("Edges")).toBeInTheDocument();
    expect(screen.getByText("Thickness")).toBeInTheDocument();
    expect(screen.getByText("Normal opacity")).toBeInTheDocument();
    expect(screen.getByText("Dashed opacity")).toBeInTheDocument();
    expect(screen.getByText("Group fill")).toBeInTheDocument();
    expect(screen.queryByText("Edge visibility")).not.toBeInTheDocument();
    expect(screen.queryByText("Light mode")).not.toBeInTheDocument();
    expect(screen.queryByText("Dark mode")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Increase normal edge opacity",
      })
    );
    expect(adjustEdgeVisibilityMock).toHaveBeenCalledWith(
      "light",
      EDGE_VISIBILITY_STEP
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Decrease normal edge opacity",
      })
    );
    expect(adjustEdgeVisibilityMock).toHaveBeenCalledWith(
      "light",
      -EDGE_VISIBILITY_STEP
    );
    expect(
      screen.queryByRole("button", { name: "Reset edges" })
    ).not.toBeInTheDocument();
  });

  it("adjusts the active edge thickness from the skin menu", () => {
    render(<TopBar {...baseProps} />);

    openSkinMenu();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Increase edge thickness",
      })
    );
    expect(adjustEdgeThicknessMock).toHaveBeenCalledWith(
      "light",
      EDGE_THICKNESS_STEP
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Decrease edge thickness",
      })
    );
    expect(adjustEdgeThicknessMock).toHaveBeenCalledWith(
      "light",
      -EDGE_THICKNESS_STEP
    );
  });

  it("adjusts the active dashed edge visibility from the skin menu", () => {
    render(<TopBar {...baseProps} />);

    openSkinMenu();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Increase dashed edge opacity",
      })
    );
    expect(adjustDashedEdgeVisibilityMock).toHaveBeenCalledWith(
      "light",
      EDGE_VISIBILITY_STEP
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Decrease dashed edge opacity",
      })
    );
    expect(adjustDashedEdgeVisibilityMock).toHaveBeenCalledWith(
      "light",
      -EDGE_VISIBILITY_STEP
    );
  });

  it("adjusts the active group fill opacity from the skin menu", () => {
    render(<TopBar {...baseProps} />);

    const trigger = screen.getByRole("button", { name: "Skin: shadcn" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Increase group fill opacity",
      })
    );
    expect(adjustGroupFillOpacityMock).toHaveBeenCalledWith(
      "light",
      GROUP_FILL_OPACITY_STEP
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Decrease group fill opacity",
      })
    );
    expect(adjustGroupFillOpacityMock).toHaveBeenCalledWith(
      "light",
      -GROUP_FILL_OPACITY_STEP
    );
  });

  it("repeats group fill opacity adjustment while held", () => {
    vi.useFakeTimers();
    try {
      render(<TopBar {...baseProps} />);

      const trigger = screen.getByRole("button", { name: "Skin: shadcn" });
      fireEvent.keyDown(trigger, { key: "Enter" });

      const increase = screen.getByRole("button", {
        name: "Increase group fill opacity",
      });
      fireEvent.pointerDown(increase, { pointerId: 1 });

      expect(adjustGroupFillOpacityMock).toHaveBeenCalledTimes(1);
      expect(adjustGroupFillOpacityMock).toHaveBeenLastCalledWith(
        "light",
        GROUP_FILL_OPACITY_STEP
      );

      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(adjustGroupFillOpacityMock).toHaveBeenCalledTimes(2);

      act(() => {
        vi.advanceTimersByTime(140);
      });
      expect(adjustGroupFillOpacityMock).toHaveBeenCalledTimes(4);

      fireEvent.pointerUp(increase, { pointerId: 1 });
      act(() => {
        vi.advanceTimersByTime(210);
      });
      expect(adjustGroupFillOpacityMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("adjusts the active dark edge visibility from the skin menu", () => {
    themeMock = "dark";
    render(<TopBar {...baseProps} />);

    openSkinMenu();

    expect(screen.getByText("Edges")).toBeInTheDocument();
    expect(screen.getByText("Thickness")).toBeInTheDocument();
    expect(screen.getByText("Normal opacity")).toBeInTheDocument();
    expect(screen.getByText("Dashed opacity")).toBeInTheDocument();
    expect(screen.getByText("Group fill")).toBeInTheDocument();
    expect(screen.queryByText("Light mode")).not.toBeInTheDocument();
    expect(screen.queryByText("Dark mode")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Decrease normal edge opacity",
      })
    );
    expect(adjustEdgeVisibilityMock).toHaveBeenCalledWith(
      "dark",
      -EDGE_VISIBILITY_STEP
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Increase edge thickness",
      })
    );
    expect(adjustEdgeThicknessMock).toHaveBeenCalledWith(
      "dark",
      EDGE_THICKNESS_STEP
    );
  });

  it("opens share dialog handler when enabled", () => {
    render(<TopBar {...baseProps} shareDisabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Share snapshot" }));
    expect(baseProps.onShare).toHaveBeenCalled();
  });

  it("hides retry-all button when errors are not limit-related", () => {
    render(<TopBar {...baseProps} calcStatus="ERROR" errorCount={1} />);
    const retry = screen.queryByTitle("Retry all nodes in this tab");
    expect(retry).not.toBeInTheDocument();
  });

  it("uses themed emphasis for the error badge", () => {
    render(<TopBar {...baseProps} calcStatus="ERROR" errorCount={2} />);

    const errorBadge = screen.getByTitle("Show errors");
    expect(errorBadge).toHaveClass("text-primary");
    expect(errorBadge).toHaveClass("font-semibold");
    expect(errorBadge.className).not.toContain("text-black");
  });

  it("enables retry-all button and fires callback when limit errors exist", () => {
    render(
      <TopBar
        {...baseProps}
        calcStatus="ERROR"
        errorCount={1}
        hasLimitErrors
      />
    );
    const retry = screen.getByTitle("Retry all nodes in this tab");
    expect(retry).not.toBeDisabled();
    fireEvent.click(retry);
    expect(baseProps.onRetryAll).toHaveBeenCalled();
  });

  it("allows double-click renaming of tabs", () => {
    render(<TopBar {...baseProps} />);

    const tabTrigger = screen.getByText("Flow 1");
    fireEvent.doubleClick(tabTrigger);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New Tab Name" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(baseProps.onRenameTab).toHaveBeenCalledWith("tab-1", "New Tab Name");
  });

  it("closes other panels before showing search", () => {
    const setShowUndoRedoPanel = vi.fn();
    const setShowErrorPanel = vi.fn();
    const onSearchClick = vi.fn();

    render(
      <TopBar
        {...baseProps}
        setShowUndoRedoPanel={setShowUndoRedoPanel}
        setShowErrorPanel={setShowErrorPanel}
        onSearchClick={onSearchClick}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Search nodes" }));

    expect(setShowUndoRedoPanel).toHaveBeenCalledWith(false);
    expect(setShowErrorPanel).toHaveBeenCalledWith(false);
    expect(onSearchClick).toHaveBeenCalled();
  });

  it("closes search panel when toggling error list", () => {
    const setShowErrorPanel = vi.fn();
    const setShowSearchPanel = vi.fn();

    render(
      <TopBar
        {...baseProps}
        calcStatus="ERROR"
        errorCount={2}
        setShowErrorPanel={setShowErrorPanel}
        setShowSearchPanel={setShowSearchPanel}
      />
    );

    fireEvent.click(screen.getByTitle("Show errors"));

    expect(setShowSearchPanel).toHaveBeenCalledWith(false);
    expect(setShowErrorPanel).toHaveBeenCalledWith(true);
  });

  it("invokes simplified save when holding the S key", () => {
    const onSave = vi.fn();
    const onSaveSimplified = vi.fn();

    render(
      <TopBar
        {...baseProps}
        onSave={onSave}
        onSaveSimplified={onSaveSimplified}
      />
    );

    fireEvent.keyDown(window, { key: "s" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveSimplified).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.keyUp(window, { key: "s" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalled();
  });

  it("shows both save shortcut hints in the hover title", () => {
    render(<TopBar {...baseProps} />);

    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "title",
      "Save (hold S for simplified, hold L for LLM export)"
    );
  });

  it("invokes LLM export when holding the L key", () => {
    const onSave = vi.fn();
    const onSaveSimplified = vi.fn();
    const onSaveLlmExport = vi.fn();

    render(
      <TopBar
        {...baseProps}
        onSave={onSave}
        onSaveSimplified={onSaveSimplified}
        onSaveLlmExport={onSaveLlmExport}
      />
    );

    fireEvent.keyDown(window, { key: "l" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveLlmExport).toHaveBeenCalled();
    expect(onSaveSimplified).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.keyUp(window, { key: "l" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalled();
  });

});
