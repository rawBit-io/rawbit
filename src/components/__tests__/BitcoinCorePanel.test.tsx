import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { BitcoinCorePanel } from "@/components/layout/BitcoinCorePanel";

const fetchBitcoinStatus = vi.fn();
const sendBitcoinCommand = vi.fn();

vi.mock("@/lib/bitcoin/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bitcoin/api")>();
  return {
    ...actual,
    fetchBitcoinStatus: (...args: unknown[]) => fetchBitcoinStatus(...args),
    sendBitcoinCommand: (...args: unknown[]) => sendBitcoinCommand(...args),
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
});
