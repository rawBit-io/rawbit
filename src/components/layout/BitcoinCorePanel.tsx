import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RefreshCw, X } from "lucide-react";
import {
  fetchBitcoinStatus,
  parseCommandLine,
  sendBitcoinCommand,
  type BitcoinStatus,
} from "@/lib/bitcoin/api";

export interface BitcoinCorePanelProps {
  isOpen: boolean;
  hasVisibleTabs?: boolean;
  onClose?: () => void;
  style?: CSSProperties;
}

type ConsoleEntry = {
  id: number;
  command: string;
  ok: boolean;
  output: string;
};

const MAX_ENTRIES = 200;
const EXAMPLE_COMMANDS = ["getblockchaininfo", "getblockcount", "getnewaddress"];

function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "null";
  return JSON.stringify(result, null, 2);
}

export function BitcoinCorePanel({
  isOpen,
  hasVisibleTabs = false,
  onClose,
  style = {},
}: BitcoinCorePanelProps) {
  const [status, setStatus] = useState<BitcoinStatus | null>(null);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const entryId = useRef(0);
  const commandHistory = useRef<string[]>([]);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatus(await fetchBitcoinStatus());
  }, []);

  useEffect(() => {
    if (isOpen) void refreshStatus();
  }, [isOpen, refreshStatus]);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const runCommand = useCallback(
    async (line: string) => {
      const parsed = parseCommandLine(line);
      if (!parsed || busy) return;
      setBusy(true);
      setDraft("");
      setHistoryIndex(null);
      commandHistory.current.push(line);
      try {
        const reply = await sendBitcoinCommand(parsed.method, parsed.params);
        const entry: ConsoleEntry = {
          id: entryId.current++,
          command: line,
          ok: !reply.error,
          output: reply.error
            ? reply.error.code !== undefined
              ? `error ${reply.error.code}: ${reply.error.message}`
              : reply.error.message
            : formatResult(reply.result),
        };
        setEntries((prev) => [...prev.slice(-(MAX_ENTRIES - 1)), entry]);
        void refreshStatus();
      } finally {
        setBusy(false);
      }
    },
    [busy, refreshStatus],
  );

  const navigateHistory = (direction: -1 | 1) => {
    const history = commandHistory.current;
    if (history.length === 0) return;
    // Not browsing history yet + pressing Down: leave the in-progress draft alone.
    if (historyIndex === null && direction === 1) return;
    const next = historyIndex === null ? history.length - 1 : historyIndex + direction;
    if (next >= history.length) {
      setHistoryIndex(null);
      setDraft("");
      return;
    }
    const clamped = Math.max(0, next);
    setHistoryIndex(clamped);
    setDraft(history[clamped]);
  };

  const chainLabel = status?.chain === "main" ? "mainnet" : status?.chain;

  return (
    <div
      className={cn(
        "fixed top-14 bottom-0 right-0 z-10 flex flex-col select-none border-l border-border bg-background transition-[width] duration-300",
        isOpen ? "w-80" : "w-0 overflow-hidden",
      )}
      data-testid="bitcoin-core-panel"
      style={{ pointerEvents: isOpen ? "auto" : "none", ...style }}
    >
      {isOpen && (
        <>
          {/* Header */}
          <div
            className={cn(
              "flex items-center justify-between px-2 border-b",
              hasVisibleTabs ? "h-10" : "pt-2 pb-1",
            )}
          >
            <span className="text-sm font-medium">Bitcoin Core</span>
            <button
              onClick={() => onClose?.()}
              title="Close Bitcoin Core console"
              className="p-1 rounded hover:bg-secondary active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Node status */}
          <div
            className="flex select-text items-center gap-2 border-b px-2 py-1.5 text-xs"
            data-testid="bitcoin-status"
          >
            {status?.connected ? (
              <>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono uppercase tracking-wide",
                    status.chain === "regtest"
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-red-500/15 text-red-600 dark:text-red-400",
                  )}
                >
                  {chainLabel}
                </span>
                <span className="text-muted-foreground">
                  block {status.blocks ?? "?"}
                </span>
              </>
            ) : (
              <span className="truncate text-muted-foreground" title={status?.error}>
                {status === null ? "Checking node…" : (status.error ?? "Not connected.")}
              </span>
            )}
            <button
              onClick={() => void refreshStatus()}
              title="Refresh node status"
              className="ml-auto p-1 rounded hover:bg-secondary active:scale-95"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          {status?.connected && status.chain !== "regtest" && (
            <div className="border-b bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
              Not a regtest node — rawBit forwards read-only commands only.
            </div>
          )}

          {/* Console output */}
          <div
            ref={outputRef}
            className="flex-grow select-text overflow-y-auto px-2 py-2 font-mono text-xs"
            data-testid="bitcoin-console-output"
          >
            {entries.length === 0 ? (
              <div className="select-none text-muted-foreground">
                <p className="mb-2">
                  Send commands to your local node, e.g.{" "}
                </p>
                <ul className="space-y-1">
                  {EXAMPLE_COMMANDS.map((cmd) => (
                    <li key={cmd}>
                      <button
                        className="rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-muted/70"
                        onClick={() => void runCommand(cmd)}
                      >
                        {cmd}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="mb-2">
                  <div className="break-all text-muted-foreground">
                    &gt; {entry.command}
                  </div>
                  <pre
                    className={cn(
                      "whitespace-pre-wrap break-all",
                      !entry.ok && "text-red-600 dark:text-red-400",
                    )}
                  >
                    {entry.output}
                  </pre>
                </div>
              ))
            )}
          </div>

          {/* Command input */}
          <div className="border-t px-2 py-2">
            <Input
              data-testid="bitcoin-cli-input"
              name="rawbitBitcoinCliNoAutocomplete"
              value={draft}
              placeholder={busy ? "Running…" : "bitcoin-cli command"}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              className="h-8 select-text font-mono text-xs"
              onChange={(e) => {
                setDraft(e.target.value);
                setHistoryIndex(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runCommand(draft);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  navigateHistory(-1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  navigateHistory(1);
                }
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
