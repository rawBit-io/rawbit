import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HelpMenu } from "@/help/HelpMenu";

function renderHelpMenu() {
  return render(
    <HelpMenu
      isOpen
      runningDemoId={null}
      onPlayDemo={vi.fn()}
      onStopDemo={vi.fn()}
    />,
  );
}

describe("HelpMenu search", () => {
  it("searches inside detailed functionality explanations and opens the detail panel", () => {
    renderHelpMenu();

    fireEvent.change(screen.getByLabelText("Search help"), {
      target: { value: "backend function code" },
    });

    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Simplified + backend also includes each node's backend function code for harder debugging or review",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Load")).not.toBeInTheDocument();
  });

  it("searches help group names", () => {
    renderHelpMenu();

    fireEvent.change(screen.getByLabelText("Search help"), {
      target: { value: "workspace" },
    });

    expect(screen.getByText("Load")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Close tab")).toBeInTheDocument();
  });

  it("searches guided demo step text", () => {
    renderHelpMenu();

    fireEvent.change(screen.getByLabelText("Search help"), {
      target: { value: "syntax-highlighted" },
    });

    expect(screen.getByText("Inspect node code")).toBeInTheDocument();
  });
});
