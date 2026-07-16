import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EditableLabel } from "../EditableLabel";

// Off-viewport culling (onlyRenderVisibleElements) unmounts nodes without
// firing blur; an in-progress edit must be committed on unmount (DA-14:
// radio channel). Callers that pass onDraftChange (e.g. GroupNode) own the
// flush themselves — the component must NOT double-commit for them.
describe("EditableLabel (common) unmount flush", () => {
  it("commits an in-progress edit when unmounted", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const view = render(
      <EditableLabel value="3" onCommit={onCommit} ariaLabel="channel" />
    );

    await user.dblClick(screen.getByRole("button", { name: "channel" }));
    await user.keyboard("7");

    view.unmount();
    expect(onCommit).toHaveBeenCalledWith("37");
  });

  it("commits the fallback when the draft is blank", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const view = render(
      <EditableLabel
        value="Name"
        onCommit={onCommit}
        fallback="Group Node"
        ariaLabel="title"
      />
    );

    await user.dblClick(screen.getByRole("button", { name: "title" }));
    await user.clear(screen.getByRole("textbox"));

    view.unmount();
    expect(onCommit).toHaveBeenCalledWith("Group Node");
  });

  it("skips the self-flush when the parent owns the draft (onDraftChange)", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const view = render(
      <EditableLabel
        value="Name"
        onCommit={onCommit}
        onDraftChange={vi.fn()}
        ariaLabel="title"
      />
    );

    await user.dblClick(screen.getByRole("button", { name: "title" }));
    await user.keyboard("X");

    view.unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit after Escape cancels the edit", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const view = render(
      <EditableLabel value="Name" onCommit={onCommit} ariaLabel="title" />
    );

    await user.dblClick(screen.getByRole("button", { name: "title" }));
    await user.keyboard("X{Escape}");

    view.unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
