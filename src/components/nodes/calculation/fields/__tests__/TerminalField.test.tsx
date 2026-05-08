import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { TerminalField } from "../TerminalField";

function ControlledTerminalField({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const [renderTick, setRenderTick] = useState(0);

  return (
    <div data-render-tick={renderTick}>
      <TerminalField
        label="Input:"
        value={value}
        onChange={(nextValue) => {
          setValue(nextValue);
          setRenderTick((current) => current + 1);
        }}
      />
    </div>
  );
}

describe("TerminalField", () => {
  it("preserves the caret while editing in the middle of a controlled value", async () => {
    const user = userEvent.setup();

    render(<ControlledTerminalField initialValue="abcdef" />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.click(textarea);
    textarea.setSelectionRange(3, 3);

    await user.keyboard("X");

    expect(textarea).toHaveValue("abcXdef");
    expect(textarea.selectionStart).toBe(4);
    expect(textarea.selectionEnd).toBe(4);
  });

  it("syncs external values while not focused", () => {
    const { rerender } = render(
      <TerminalField label="Input:" value="first" onChange={vi.fn()} />
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue("first");

    rerender(<TerminalField label="Input:" value="second" onChange={vi.fn()} />);

    expect(textarea).toHaveValue("second");
  });
});
