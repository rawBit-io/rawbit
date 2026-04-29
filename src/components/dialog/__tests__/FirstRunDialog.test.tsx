import { renderWithProviders } from "@/test-utils/render";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("@/components/ui/dialog", () => {
  const Dialog = ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="mock-dialog" data-open={open}>
      <button
        type="button"
        data-testid="mock-dialog-close"
        onClick={() => onOpenChange?.(false)}
      >
        Close
      </button>
      {children}
    </div>
  );

  const wrap =
    (Tag: keyof JSX.IntrinsicElements) =>
    ({ children }: { children: React.ReactNode }) =>
      React.createElement(Tag, null, children);

  return {
    Dialog,
    DialogContent: wrap("div"),
    DialogDescription: wrap("p"),
    DialogHeader: wrap("div"),
    DialogTitle: wrap("h2"),
  };
});

vi.mock("@/components/ui/select", () => {

  type SelectContextValue = {
    value?: string;
    onValueChange?: (value: string) => void;
  };

  const SelectContext = React.createContext<SelectContextValue>({});

  const Select = ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <SelectContext.Provider value={{ value, onValueChange }}>
      <div data-testid="mock-select-root">{children}</div>
    </SelectContext.Provider>
  );

  const SelectTrigger = ({
    children,
  }: {
    children: React.ReactNode;
  }) => <button type="button" data-testid="mock-select-trigger">{children}</button>;

  const SelectValue = ({
    placeholder,
  }: {
    placeholder?: string;
  }) => {
    const { value } = React.useContext(SelectContext);
    return <span data-testid="mock-select-value">{value ?? placeholder ?? ""}</span>;
  };

  const SelectContent = ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-testid="mock-select-content">{children}</div>;

  const SelectItem = ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => {
    const { onValueChange } = React.useContext(SelectContext);
    return (
      <button
        type="button"
        data-testid={`mock-select-item-${value}`}
        onClick={() => onValueChange?.(value)}
      >
        {children}
      </button>
    );
  };

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  };
});

import { FirstRunDialog } from "../FirstRunDialog";

const exampleFlows = [
  { id: "flow-1", label: "Intro flow" },
  { id: "flow-2", label: "SegWit flow" },
];

describe("FirstRunDialog", () => {
  it("starts from an empty canvas when requested", async () => {
    const onStartEmpty = vi.fn();
    const onLoadExample = vi.fn();
    const user = userEvent.setup();

    const { getByText } = renderWithProviders(
      <FirstRunDialog
        open
        flows={exampleFlows}
        onStartEmpty={onStartEmpty}
        onLoadExample={onLoadExample}
      />
    );
    expect(
      getByText("Pick how you would like to get started.")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Start empty canvas/i }));

    expect(onStartEmpty).toHaveBeenCalledTimes(1);
    expect(onLoadExample).not.toHaveBeenCalled();
  });

  it("loads the selected example flow", async () => {
    const onStartEmpty = vi.fn();
    const onLoadExample = vi.fn();
    const user = userEvent.setup();

    const { getByText } = renderWithProviders(
      <FirstRunDialog
        open
        flows={exampleFlows}
        onStartEmpty={onStartEmpty}
        onLoadExample={onLoadExample}
      />
    );
    expect(
      getByText("Want a tour instead? Load one of our guided example flows.")
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("mock-select-item-flow-2"));
    await user.click(screen.getByRole("button", { name: /Load example flow/i }));

    expect(onLoadExample).toHaveBeenCalledTimes(1);
    expect(onLoadExample).toHaveBeenCalledWith("flow-2");
    expect(onStartEmpty).not.toHaveBeenCalled();
  });

  it("closes without triggering any action when dismissed without a selection", async () => {
    // The old behaviour (close → implicit empty canvas) was intentionally
    // removed so that closing the dialog on a shared-link URL does NOT wipe
    // the canvas.  Now close simply propagates onOpenChange(false) and lets
    // the caller decide what to do.
    const onStartEmpty = vi.fn();
    const onLoadExample = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    const utils = renderWithProviders(
      <FirstRunDialog
        open
        flows={exampleFlows}
        onStartEmpty={onStartEmpty}
        onLoadExample={onLoadExample}
        onOpenChange={onOpenChange}
      />
    );
    expect(
      utils.getByText("Pick how you would like to get started.")
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("mock-dialog-close"));

    // Dialog signals close — no canvas action is taken automatically.
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onStartEmpty).not.toHaveBeenCalled();
    expect(onLoadExample).not.toHaveBeenCalled();
  });

  it("can hide the empty canvas option for read-only environments", async () => {
    const onStartEmpty = vi.fn();
    const onLoadExample = vi.fn();
    const user = userEvent.setup();

    const utils = renderWithProviders(
      <FirstRunDialog
        open
        flows={exampleFlows}
        onStartEmpty={onStartEmpty}
        onLoadExample={onLoadExample}
        hideStartEmpty
      />
    );

    expect(
      screen.queryByRole("button", { name: /Start empty canvas/i })
    ).not.toBeInTheDocument();
    expect(
      utils.getByText("Mobile mode is read-only — load an example to explore the canvas.")
    ).toBeInTheDocument();
    expect(
      utils.getByText("Load one of our guided example flows to look around.")
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("mock-dialog-close"));

    expect(onStartEmpty).not.toHaveBeenCalled();
    expect(onLoadExample).not.toHaveBeenCalled();
  });
});
