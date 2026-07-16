import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EditableLabel } from "../EditableLabel";

// Off-viewport culling (onlyRenderVisibleElements) unmounts nodes without
// firing blur; an in-progress label edit must be committed on unmount
// (DA-12 class: OpCode/Script Viewer titles, field captions).
describe("EditableLabel (calc fields) unmount flush", () => {
  it("commits an in-progress edit when unmounted", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const view = render(<EditableLabel value="Title" onCommit={onCommit} />);

    await user.dblClick(screen.getByText("> Title"));
    await user.keyboard(" 2");

    view.unmount();
    expect(onCommit).toHaveBeenCalledWith("Title 2");
  });

  it("does not commit when the edit was cancelled with Escape", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const view = render(<EditableLabel value="Title" onCommit={onCommit} />);

    await user.dblClick(screen.getByText("> Title"));
    await user.keyboard(" 2{Escape}");

    view.unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit an unchanged draft on unmount", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const view = render(<EditableLabel value="Title" onCommit={onCommit} />);

    await user.dblClick(screen.getByText("> Title"));

    view.unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
