import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";

import { BitcoinCorePanel } from "@/components/layout/BitcoinCorePanel";

const fetchBitcoinStatus = vi.fn();
const sendBitcoinCommand = vi.fn();
const rebuildTransaction = vi.fn();
const pollIncomingTransactions = vi.fn();

vi.mock("@/lib/bitcoin/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bitcoin/api")>();
  return {
    ...actual,
    fetchBitcoinStatus: (...args: unknown[]) => fetchBitcoinStatus(...args),
    sendBitcoinCommand: (...args: unknown[]) => sendBitcoinCommand(...args),
    rebuildTransaction: (...args: unknown[]) => rebuildTransaction(...args),
    pollIncomingTransactions: (...args: unknown[]) =>
      pollIncomingTransactions(...args),
  };
});

describe("BitcoinCorePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchBitcoinStatus.mockResolvedValue({
      connected: true,
      chain: "regtest",
      blocks: 101,
    });
    pollIncomingTransactions.mockResolvedValue({ txids: [], mempool: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows node status when opened", async () => {
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("regtest")).toBeInTheDocument());
    expect(screen.getByText("block 101")).toBeInTheDocument();
  });

  it("sends a command and renders the result", async () => {
    sendBitcoinCommand.mockResolvedValue({ result: { chain: "regtest" } });
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} />);

    const input = screen.getByTestId("bitcoin-cli-input");
    fireEvent.change(input, { target: { value: "getblockchaininfo" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByText("> getblockchaininfo")).toBeInTheDocument(),
    );
    expect(sendBitcoinCommand).toHaveBeenCalledWith("getblockchaininfo", []);
    expect(screen.getByText(/"chain": "regtest"/)).toBeInTheDocument();
  });

  it("renders RPC errors in the output", async () => {
    sendBitcoinCommand.mockResolvedValue({
      error: { code: -32601, message: "Method not found" },
    });
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} />);

    const input = screen.getByTestId("bitcoin-cli-input");
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(
        screen.getByText("error -32601: Method not found"),
      ).toBeInTheDocument(),
    );
  });

  it("warns when the node is not on regtest", async () => {
    fetchBitcoinStatus.mockResolvedValue({
      connected: true,
      chain: "main",
      blocks: 900000,
    });
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByText(/read-only commands only/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("mainnet")).toBeInTheDocument();
  });

  it("shows the backend/node error when not connected", async () => {
    fetchBitcoinStatus.mockResolvedValue({
      connected: false,
      error: "rawBit backend is not reachable.",
    });
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByText("rawBit backend is not reachable."),
      ).toBeInTheDocument(),
    );
  });

  it("recalls previous commands with ArrowUp", async () => {
    sendBitcoinCommand.mockResolvedValue({ result: 101 });
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} />);

    const input = screen.getByTestId("bitcoin-cli-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "getblockcount" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe(""));

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("getblockcount");
  });

  it("rebuilds a transaction and hands the flow to onRebuild", async () => {
    const flow = { name: "Rebuild abc", nodes: [], edges: [] };
    rebuildTransaction.mockResolvedValue({ flow, txid: "abc123" });
    const onRebuild = vi.fn();
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} onRebuild={onRebuild} />);

    const input = screen.getByTestId("bitcoin-rebuild-input");
    fireEvent.change(input, { target: { value: "abc123" } });
    fireEvent.click(screen.getByTestId("bitcoin-rebuild-button"));

    await waitFor(() => expect(onRebuild).toHaveBeenCalledWith(flow, "abc123"));
    expect(rebuildTransaction).toHaveBeenCalledWith("abc123");
  });

  it("shows a rebuild error and does not call onRebuild", async () => {
    rebuildTransaction.mockResolvedValue({
      error: { message: "only 1-input / 1-output transactions are supported yet" },
    });
    const onRebuild = vi.fn();
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} onRebuild={onRebuild} />);

    fireEvent.change(screen.getByTestId("bitcoin-rebuild-input"), {
      target: { value: "deadbeef" },
    });
    fireEvent.click(screen.getByTestId("bitcoin-rebuild-button"));

    await waitFor(() =>
      expect(screen.getByText(/1-input/)).toBeInTheDocument(),
    );
    expect(onRebuild).not.toHaveBeenCalled();
  });

  it("does not wipe an in-progress draft on ArrowDown", async () => {
    sendBitcoinCommand.mockResolvedValue({ result: 101 });
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} />);

    const input = screen.getByTestId("bitcoin-cli-input") as HTMLInputElement;
    // submit one command so history is non-empty
    fireEvent.change(input, { target: { value: "getblockcount" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe(""));

    // start typing a new command, then press ArrowDown while not browsing
    fireEvent.change(input, { target: { value: "createrawtransaction" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("createrawtransaction");
  });

  it("surfaces new node transactions as one-click rebuilds", async () => {
    vi.useFakeTimers();
    const primingTx = "aa".repeat(32);
    const freshTx = "bb".repeat(32);
    pollIncomingTransactions
      .mockResolvedValueOnce({ txids: [primingTx], mempool: [] })
      .mockResolvedValueOnce({ txids: [freshTx], mempool: [] });
    const flow = { name: "Rebuild bb", nodes: [], edges: [] };
    rebuildTransaction.mockResolvedValue({ flow, txid: freshTx });
    const onRebuild = vi.fn();
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} onRebuild={onRebuild} />);

    // status resolves, the watch primes its cursor — history is not surfaced
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByTestId("bitcoin-incoming")).not.toBeInTheDocument();

    // next poll finds a fresh transaction
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTestId("bitcoin-incoming")).toBeInTheDocument();
    const chip = screen.getByTestId("bitcoin-incoming-rebuild");
    expect(chip.textContent).toContain(freshTx.slice(0, 16));

    fireEvent.click(chip);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(rebuildTransaction).toHaveBeenCalledWith(freshTx);
    expect(onRebuild).toHaveBeenCalledWith(flow, freshTx);
    // the rebuilt tx leaves the incoming list
    expect(screen.queryByTestId("bitcoin-incoming")).not.toBeInTheDocument();
  });

  it("does not watch for transactions off regtest", async () => {
    vi.useFakeTimers();
    fetchBitcoinStatus.mockResolvedValue({
      connected: true,
      chain: "main",
      blocks: 900000,
    });
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(pollIncomingTransactions).not.toHaveBeenCalled();
  });

  it("a dismissed incoming transaction stays dismissed", async () => {
    vi.useFakeTimers();
    const freshTx = "cc".repeat(32);
    pollIncomingTransactions
      .mockResolvedValueOnce({ txids: [], mempool: [] })
      .mockResolvedValueOnce({ txids: [freshTx], mempool: [] });
    render(<BitcoinCorePanel isOpen onClose={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTestId("bitcoin-incoming")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Dismiss"));
    expect(screen.queryByTestId("bitcoin-incoming")).not.toBeInTheDocument();
    // later polls return nothing new; the seen-set keeps the tx away
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByTestId("bitcoin-incoming")).not.toBeInTheDocument();
  });
});
