import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RefreshCw, X } from "lucide-react";
import {
  fetchBitcoinStatus,
  parseCommandLine,
  pollIncomingTransactions,
  rebuildTransaction,
  sendBitcoinCommand,
  type BitcoinStatus,
} from "@/lib/bitcoin/api";

export interface BitcoinCorePanelProps {
  isOpen: boolean;
  hasVisibleTabs?: boolean;
  onClose?: () => void;
  onRebuild?: (flow: unknown, txid?: string) => void;
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
const WATCH_INTERVAL_MS = 5_000;
const MAX_INCOMING = 5;

function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "null";
  return JSON.stringify(result, null, 2);
}

export function BitcoinCorePanel({
  isOpen,
  hasVisibleTabs = false,
  onClose,
  onRebuild,
  style = {},
}: BitcoinCorePanelProps) {
  const [status, setStatus] = useState<BitcoinStatus | null>(null);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [rebuildRef, setRebuildRef] = useState("");
  const [rebuildBusy, setRebuildBusy] = useState(false);
  const [rebuildError, setRebuildError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<string[]>([]);
  const entryId = useRef(0);
  const commandHistory = useRef<string[]>([]);
  const outputRef = useRef<HTMLDivElement | null>(null);
  // Watch cursor: last listsinceblock block hash, last mempool snapshot, and
  // every txid already surfaced (or present before the watch started).
  const watchRef = useRef<{
    lastBlock?: string;
    mempool?: string[];
    seen: Set<string>;
    primed: boolean;
    polling: boolean;
  }>({ seen: new Set(), primed: false, polling: false });

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

  const runRebuild = useCallback(
    async (refOverride?: string) => {
      const ref = (refOverride ?? rebuildRef).trim();
      if (!ref || rebuildBusy) return;
      setRebuildBusy(true);
      setRebuildError(null);
      try {
        const reply = await rebuildTransaction(ref);
        if (reply.error || !reply.flow) {
          setRebuildError(reply.error?.message ?? "Rebuild failed.");
          return;
        }
        onRebuild?.(reply.flow, reply.txid);
        setRebuildRef("");
        setIncoming((prev) => prev.filter((txid) => txid !== ref));
      } finally {
        setRebuildBusy(false);
      }
    },
    [rebuildRef, rebuildBusy, onRebuild],
  );

  // Watch the node for new transactions while the panel is open (regtest
  // only — every fresh wallet or mempool tx becomes a one-click rebuild).
  const watchEnabled =
    isOpen && status?.connected === true && status.chain === "regtest";
  useEffect(() => {
    if (!watchEnabled) return;
    let cancelled = false;

    const poll = async () => {
      const watch = watchRef.current;
      if (watch.polling) return;
      watch.polling = true;
      try {
        const result = await pollIncomingTransactions({
          lastBlock: watch.lastBlock,
          mempool: watch.mempool,
        });
        if (cancelled) return;
        watch.lastBlock = result.lastBlock;
        watch.mempool = result.mempool;
        const fresh = result.txids.filter((txid) => !watch.seen.has(txid));
        for (const txid of fresh) watch.seen.add(txid);
        // the first poll only primes the cursor — history is not "incoming"
        if (!watch.primed) {
          watch.primed = true;
          return;
        }
        if (fresh.length > 0) {
          setIncoming((prev) =>
            [...fresh.reverse(), ...prev].slice(0, MAX_INCOMING),
          );
        }
      } finally {
        watchRef.current.polling = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), WATCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [watchEnabled]);

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

          {/* Rebuild a transaction on the canvas */}
          <div className="border-b px-2 py-2" data-testid="bitcoin-rebuild">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Rebuild a transaction on canvas
            </div>
            <div className="flex gap-1">
              <Input
                data-testid="bitcoin-rebuild-input"
                name="rawbitRebuildNoAutocomplete"
                value={rebuildRef}
                placeholder="txid or raw tx hex"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={rebuildBusy}
                className="h-8 select-text font-mono text-xs"
                onChange={(e) => {
                  setRebuildRef(e.target.value);
                  setRebuildError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runRebuild();
                  }
                }}
              />
              <button
                data-testid="bitcoin-rebuild-button"
                onClick={() => void runRebuild()}
                disabled={rebuildBusy || !rebuildRef.trim()}
                className="shrink-0 rounded bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {rebuildBusy ? "…" : "Rebuild"}
              </button>
            </div>
            {rebuildError && (
              <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                {rebuildError}
              </div>
            )}
            {incoming.length > 0 && (
              <div className="mt-2" data-testid="bitcoin-incoming">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  New transactions on your node
                </div>
                <ul className="space-y-1">
                  {incoming.map((txid) => (
                    <li key={txid} className="flex items-center gap-1">
                      <button
                        data-testid="bitcoin-incoming-rebuild"
                        onClick={() => void runRebuild(txid)}
                        disabled={rebuildBusy}
                        title={`Rebuild ${txid} on canvas`}
                        className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-left font-mono text-xs hover:bg-muted/70 disabled:opacity-50"
                      >
                        {txid.slice(0, 16)}…
                      </button>
                      <button
                        onClick={() =>
                          setIncoming((prev) => prev.filter((t) => t !== txid))
                        }
                        title="Dismiss"
                        className="shrink-0 rounded p-0.5 hover:bg-secondary"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

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
