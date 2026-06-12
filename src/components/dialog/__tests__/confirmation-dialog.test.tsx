import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmationDialog } from "../confirmation-dialog";

describe("ConfirmationDialog", () => {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    title: "Title",
    description: "Description",
  };

  it("renders the cancel button when cancelText is provided", () => {
    render(
      <ConfirmationDialog {...baseProps} confirmText="OK" cancelText="Cancel" />
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });

  it("omits the cancel button when cancelText is not provided", () => {
    render(<ConfirmationDialog {...baseProps} confirmText="OK" />);

    expect(
      screen.queryByRole("button", { name: "Cancel" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });
});
