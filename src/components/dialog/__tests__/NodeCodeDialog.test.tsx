import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const syntaxPropsSpy = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light" }),
}));

vi.mock("@/components/ui/dialog", () => {
  const Dialog = ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div data-testid="mock-dialog">{children}</div> : null);

  const wrap =
    (Tag: keyof JSX.IntrinsicElements) =>
    ({ children, className }: { children: React.ReactNode; className?: string }) =>
      React.createElement(Tag, { className }, children);

  return {
    Dialog,
    DialogContent: wrap("div"),
    DialogDescription: wrap("p"),
    DialogFooter: wrap("div"),
    DialogHeader: wrap("div"),
    DialogTitle: wrap("h2"),
  };
});

vi.mock("react-syntax-highlighter", () => ({
  Prism: (props: Record<string, unknown>) => {
    syntaxPropsSpy(props);
    return <pre data-testid="syntax-code">{props.children as React.ReactNode}</pre>;
  },
}));

import NodeCodeDialog from "../NodeCodeDialog";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return {
    ok: init.status === undefined ? true : init.status >= 200 && init.status < 300,
    status: init.status ?? 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("NodeCodeDialog", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    syntaxPropsSpy.mockClear();
    window.sessionStorage.clear();
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: "def sample():\n    return 'ok'" }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders code with non-wrapping highlighter configuration", async () => {
    render(
      <NodeCodeDialog
        open
        onClose={vi.fn()}
        functionName="public_key_from_private_key"
      />
    );

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/code?functionName=public_key_from_private_key"),
        expect.objectContaining({
          headers: { accept: "application/json" },
          signal: expect.any(AbortSignal),
        })
      )
    );

    await waitFor(() => expect(screen.getByTestId("syntax-code")).toBeInTheDocument());
    expect(syntaxPropsSpy).toHaveBeenCalled();

    const lastCall = syntaxPropsSpy.mock.calls.at(-1)?.[0] as {
      wrapLongLines?: boolean;
      customStyle?: { whiteSpace?: string };
    };

    expect(lastCall.wrapLongLines).toBe(false);
    expect(lastCall.customStyle?.whiteSpace).toBe("pre");
  });

  it("shows backend errors for unsuccessful responses", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "Function not found" }, { status: 404 }));

    render(
      <NodeCodeDialog open onClose={vi.fn()} functionName="missing_function" />
    );

    expect(await screen.findByText("Error: Function not found")).toBeInTheDocument();
  });

  it("uses the reset cache-bust token when fetching code", async () => {
    window.sessionStorage.setItem("rawbit:code-source-cache-bust", "reset-123");

    render(
      <NodeCodeDialog open onClose={vi.fn()} functionName="hash160_hex" />
    );

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:5007/code?functionName=hash160_hex&cacheBust=reset-123",
        expect.objectContaining({
          headers: { accept: "application/json" },
          signal: expect.any(AbortSignal),
        })
      )
    );
  });

  it("ignores stale responses after the requested function changes", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    global.fetch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { rerender } = render(
      <NodeCodeDialog open onClose={vi.fn()} functionName="first_function" />
    );

    rerender(
      <NodeCodeDialog open onClose={vi.fn()} functionName="second_function" />
    );

    first.resolve(jsonResponse({ code: "def first(): pass" }));
    second.resolve(jsonResponse({ code: "def second(): pass" }));

    await waitFor(() =>
      expect(screen.getByTestId("syntax-code")).toHaveTextContent(
        "def second(): pass"
      )
    );
    expect(screen.queryByText("def first(): pass")).not.toBeInTheDocument();
  });

  const selectInCodeContainer = (element: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const dispatchCopyEvent = () => {
    const setData = vi.fn();
    const event = new Event("copy", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    document.dispatchEvent(event);
    return { event, setData };
  };

  it("leaves the native copy untouched when no line numbers are selected", async () => {
    render(
      <NodeCodeDialog open onClose={vi.fn()} functionName="sample_function" />
    );
    await waitFor(() =>
      expect(screen.getByTestId("syntax-code")).toBeInTheDocument()
    );

    const container = document.querySelector(
      ".syntax-highlighter-container"
    ) as HTMLElement;
    const code = document.createElement("span");
    code.textContent = '    118: "OP_DUP",';
    container.appendChild(code);
    selectInCodeContainer(code);

    const { event, setData } = dispatchCopyEvent();

    expect(setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("strips only line-number gutters that leak into the copied selection", async () => {
    render(
      <NodeCodeDialog open onClose={vi.fn()} functionName="sample_function" />
    );
    await waitFor(() =>
      expect(screen.getByTestId("syntax-code")).toBeInTheDocument()
    );

    const container = document.querySelector(
      ".syntax-highlighter-container"
    ) as HTMLElement;
    const row = document.createElement("span");
    row.innerHTML =
      '<span class="linenumber react-syntax-highlighter-line-number">42</span>' +
      '<span>    118: "OP_DUP",</span>';
    container.appendChild(row);
    selectInCodeContainer(row);

    const { event, setData } = dispatchCopyEvent();

    expect(setData).toHaveBeenCalledWith("text/plain", '    118: "OP_DUP",');
    expect(event.defaultPrevented).toBe(true);
  });

  it("renders large code prefixes as plain text and highlights the tail", async () => {
    const largeCode = Array.from(
      { length: 501 },
      (_, index) => `line_${index}`
    ).join("\n");
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ code: largeCode }));

    render(
      <NodeCodeDialog
        open
        onClose={vi.fn()}
        functionName="entropy_to_bip39_mnemonic"
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("plain-code")).toBeInTheDocument()
    );

    await waitFor(() =>
      expect(screen.getByTestId("syntax-code")).toBeInTheDocument()
    );

    expect(screen.getByTestId("plain-code")).toHaveTextContent("line_300");
    expect(screen.getByTestId("plain-code")).not.toHaveTextContent("line_301");
    expect(screen.getByTestId("syntax-code")).toHaveTextContent("line_301");
    expect(screen.getByTestId("syntax-code")).toHaveTextContent("line_500");

    const lastCall = syntaxPropsSpy.mock.calls.at(-1)?.[0] as {
      startingLineNumber?: number;
    };
    expect(lastCall.startingLineNumber).toBe(302);
  });
});
