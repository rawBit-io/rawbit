import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Walkthrough } from "../Walkthrough";

describe("Walkthrough", () => {
  it("renders as a small canvas panel", () => {
    render(<Walkthrough open onSkip={vi.fn()} onFinish={vi.fn()} />);

    expect(screen.getByTestId("walkthrough-panel")).toBeInTheDocument();
    expect(screen.getByText("Watch the sidebar")).toBeInTheDocument();
    expect(screen.getByText("1 / 8")).toBeInTheDocument();
  });

  it("steps forward and backward through the walkthrough", async () => {
    const user = userEvent.setup();

    render(<Walkthrough open onSkip={vi.fn()} onFinish={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText("Drop an input node")).toBeInTheDocument();
    expect(screen.getByText("2 / 8")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /previous/i }));

    expect(screen.getByText("Watch the sidebar")).toBeInTheDocument();
    expect(screen.getByText("1 / 8")).toBeInTheDocument();
  });

  it("calls close and finish callbacks", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    const onFinish = vi.fn();

    render(<Walkthrough open onSkip={onSkip} onFinish={onFinish} />);

    await user.click(screen.getByRole("button", { name: /close walkthrough/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 7; index += 1) {
      await user.click(screen.getByRole("button", { name: /next/i }));
    }

    await user.click(screen.getByRole("button", { name: /finish/i }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("notifies the active step when the user advances", async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();

    render(
      <Walkthrough
        open
        onSkip={vi.fn()}
        onFinish={vi.fn()}
        onStepChange={onStepChange}
      />
    );

    expect(onStepChange).toHaveBeenCalledWith(0);

    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(onStepChange).toHaveBeenCalledWith(1);
  });
});

