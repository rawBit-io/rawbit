import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { SoftGateDialog } from "@/components/share/SoftGateDialog";

type TurnstileMock = {
  render: (element: HTMLElement, options: { callback: (token: string) => void }) => string;
  remove?: (widgetId: string) => void;
};

describe("SoftGateDialog", () => {
  const appendStub = vi.fn((element: Node) => element);
  let originalTurnstile: TurnstileMock | undefined;

  // Radix also appends <style> tags to document.head; only count scripts.
  const scriptAppendCount = () =>
    appendStub.mock.calls.filter(([el]) => el instanceof HTMLScriptElement)
      .length;

  beforeEach(() => {
    appendStub.mockImplementation((el: Node) => {
      if (el instanceof HTMLScriptElement) {
        el.onload?.(new Event("load"));
      }
      return el;
    });
    const windowWithTurnstile = window as typeof window & { turnstile?: TurnstileMock };
    originalTurnstile = windowWithTurnstile.turnstile;
    delete windowWithTurnstile.turnstile;
    vi.spyOn(document.head, "appendChild").mockImplementation(appendStub);
  });

  afterEach(() => {
    cleanup();
    appendStub.mockReset();
    vi.restoreAllMocks();
    const windowWithTurnstile = window as typeof window & { turnstile?: TurnstileMock };
    if (originalTurnstile === undefined) delete windowWithTurnstile.turnstile;
    else windowWithTurnstile.turnstile = originalTurnstile;
  });

  it("loads Turnstile script when opening", async () => {
    render(
      <SoftGateDialog open onClose={vi.fn()} onVerified={vi.fn()} />
    );

    await waitFor(() => expect(appendStub).toHaveBeenCalled());
    expect(screen.getByText(/Quick verification/i)).toBeInTheDocument();
  });

  it("renders widget and cleans up when closing", async () => {
    const onVerified = vi.fn();
    const remove = vi.fn();
    const renderWidget = vi.fn(
      (_element: HTMLElement, opts: { callback: (token: string) => void }) => {
        opts.callback("token-42");
        return "widget-id";
      }
    );

    const windowWithTurnstile = window as typeof window & { turnstile?: TurnstileMock };
    windowWithTurnstile.turnstile = {
      render: renderWidget,
      remove,
    };

    const { rerender, unmount } = render(
      <SoftGateDialog open onClose={vi.fn()} onVerified={onVerified} />
    );

    await waitFor(() => expect(renderWidget).toHaveBeenCalled());
    expect(onVerified).toHaveBeenCalledWith("token-42");

    rerender(
      <SoftGateDialog open={false} onClose={vi.fn()} onVerified={onVerified} />
    );
    unmount();

    expect(remove).toHaveBeenCalledWith("widget-id");
  });

  it("keeps the widget mounted when onVerified changes identity", async () => {
    const remove = vi.fn();
    const renderWidget = vi.fn(
      (element: HTMLElement, opts: { callback: (token: string) => void }) => {
        void element;
        void opts;
        return "widget-id";
      }
    );

    const windowWithTurnstile = window as typeof window & { turnstile?: TurnstileMock };
    windowWithTurnstile.turnstile = {
      render: renderWidget,
      remove,
    };

    const { rerender } = render(
      <SoftGateDialog open onClose={vi.fn()} onVerified={vi.fn()} />
    );

    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));

    const nextVerified = vi.fn();
    rerender(
      <SoftGateDialog open onClose={vi.fn()} onVerified={nextVerified} />
    );

    expect(remove).not.toHaveBeenCalled();
    expect(renderWidget).toHaveBeenCalledTimes(1);

    // The widget callback still reaches the latest handler.
    renderWidget.mock.calls[0][1].callback("token-7");
    expect(nextVerified).toHaveBeenCalledWith("token-7");
  });

  it("shows a retry state when the Turnstile script fails to load", async () => {
    appendStub.mockImplementation((el: Node) => {
      if (el instanceof HTMLScriptElement) {
        el.onerror?.(new Event("error"));
      }
      return el;
    });

    render(<SoftGateDialog open onClose={vi.fn()} onVerified={vi.fn()} />);

    expect(
      await screen.findByText(/verification widget could not be loaded/i)
    ).toBeInTheDocument();

    // Retry re-injects the script; a successful load clears the error state.
    appendStub.mockImplementation((el: Node) => {
      if (el instanceof HTMLScriptElement) {
        el.onload?.(new Event("load"));
      }
      return el;
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(scriptAppendCount()).toBe(2));
    await waitFor(() =>
      expect(
        screen.queryByText(/verification widget could not be loaded/i)
      ).not.toBeInTheDocument()
    );
  });

  it("does not inject duplicate script tags while a load is pending", async () => {
    const pendingScripts: HTMLScriptElement[] = [];
    appendStub.mockImplementation((el: Node) => {
      if (el instanceof HTMLScriptElement) {
        pendingScripts.push(el);
      }
      return el;
    });

    const { rerender } = render(
      <SoftGateDialog open onClose={vi.fn()} onVerified={vi.fn()} />
    );
    expect(scriptAppendCount()).toBe(1);

    // Close and reopen the gate before the script finished loading.
    rerender(<SoftGateDialog open={false} onClose={vi.fn()} onVerified={vi.fn()} />);
    rerender(<SoftGateDialog open onClose={vi.fn()} onVerified={vi.fn()} />);

    expect(scriptAppendCount()).toBe(1);

    // Settle the shared load promise so later tests start fresh.
    await act(async () => {
      pendingScripts[0]?.onload?.(new Event("load"));
    });
  });
});
