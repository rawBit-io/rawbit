// File: src/components/dialog/NodeCodeDialog.tsx

import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Prism code highlighting
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneLight,
  oneDark,
} from "react-syntax-highlighter/dist/esm/styles/prism";

import { useTheme } from "@/hooks/useTheme";
import { buildCodeSourceUrl } from "@/lib/codeSourceCache";

const DEFAULT_LOCAL_API = "http://localhost:5007";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const HIGHLIGHT_LINE_LIMIT = 500;
const HIGHLIGHT_TAIL_LINE_COUNT = 200;

function isLocalHost(hostname?: string) {
  if (!hostname) return false;
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

function resolveApiBase(): { baseUrl: string; forcedLocal: boolean } {
  const envBase =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
    DEFAULT_LOCAL_API;
  const allowRemote =
    (import.meta.env.VITE_ALLOW_REMOTE_API || "")
      .toString()
      .toLowerCase() === "true";
  const isPageLocal = typeof window !== "undefined" && isLocalHost(window.location.hostname);

  try {
    const envUrl = new URL(envBase);
    const isEnvLocal = isLocalHost(envUrl.hostname);
    if (import.meta.env.DEV && isPageLocal && !isEnvLocal && !allowRemote) {
      return { baseUrl: DEFAULT_LOCAL_API, forcedLocal: true };
    }
    return { baseUrl: envBase, forcedLocal: false };
  } catch {
    return { baseUrl: DEFAULT_LOCAL_API, forcedLocal: true };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

interface NodeCodeDialogProps {
  open: boolean;
  onClose: () => void;
  functionName?: string;
}

export function NodeCodeDialog({
  open,
  onClose,
  functionName,
}: NodeCodeDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const codeLines = code ? code.split(/\r\n|\r|\n/) : [];
  const codeLineCount = codeLines.length;
  const usePlainCode = codeLineCount > HIGHLIGHT_LINE_LIMIT;
  const highlightedTailLines = usePlainCode
    ? codeLines.slice(-HIGHLIGHT_TAIL_LINE_COUNT)
    : codeLines;
  const plainPrefixLines = usePlainCode
    ? codeLines.slice(0, -HIGHLIGHT_TAIL_LINE_COUNT)
    : [];
  const highlightedCode = highlightedTailLines.join("\n");
  const plainPrefixCode = plainPrefixLines.join("\n");
  const highlightedStartLine = usePlainCode ? plainPrefixLines.length + 1 : 1;

  // Use your custom theme (light/dark/system)
  const { theme } = useTheme();
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    if (theme === "dark") {
      setIsDarkMode(true);
    } else if (theme === "light") {
      setIsDarkMode(false);
    } else {
      // System
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      setIsDarkMode(media.matches);
      const handler = (e: MediaQueryListEvent) => {
        setIsDarkMode(e.matches);
      };
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
  }, [theme]);

  // Fetch code from the backend
  useEffect(() => {
    if (!open || !functionName) return;
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError("");
    setCode("");
    const api = resolveApiBase();

    const loadCode = async () => {
      try {
        const res = await fetch(
          buildCodeSourceUrl(api.baseUrl, functionName),
          {
            headers: { accept: "application/json" },
            signal: controller.signal,
          }
        );
        const contentType = res.headers.get("content-type") || "";
        const resp = contentType.includes("application/json")
          ? await res.json()
          : null;

        if (!active) return;

        if (!res.ok) {
          const backendError =
            isRecord(resp) && typeof resp.error === "string"
              ? resp.error
              : `Request failed (${res.status})`;
          setError(backendError);
          setCode("");
          return;
        }

        if (isRecord(resp) && typeof resp.error === "string") {
          setError(resp.error);
          setCode("");
          return;
        }

        setCode(
          isRecord(resp) && typeof resp.code === "string" ? resp.code : ""
        );
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        setError(errorMessage(err));
        setCode("");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadCode();

    return () => {
      active = false;
      controller.abort();
    };
  }, [open, functionName]);

  // Copy-to-clipboard
  const handleCopy = useCallback(() => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
      },
      (err) => console.error("Failed to copy code", err)
    );
  }, [code]);

  // Handle copy event to clean line numbers if needed
  useEffect(() => {
    if (!open) return;

    const handleCopyEvent = (e: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      // Check if the selection is within our code dialog
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const codeContainer = document.querySelector(
        ".syntax-highlighter-container"
      );

      if (codeContainer && codeContainer.contains(container as Node)) {
        // Line numbers are unselectable, but some browsers (Safari) can
        // still leak them into the copied text. Only rewrite the clipboard
        // when actual line-number gutters made it into the selection, and
        // strip exactly those elements — never digits in the code itself.
        const fragment = range.cloneContents();
        const lineNumbers = fragment.querySelectorAll(
          ".react-syntax-highlighter-line-number"
        );
        if (lineNumbers.length === 0) return;

        lineNumbers.forEach((el) => el.remove());

        // Set the cleaned text to clipboard
        e.clipboardData?.setData("text/plain", fragment.textContent ?? "");
        e.preventDefault();
      }
    };

    // Stop keyboard events from propagating to the Flow component
    const handleKeyDown = (e: KeyboardEvent) => {
      // Stop propagation for copy/paste/cut commands
      if (
        (e.ctrlKey || e.metaKey) &&
        ["c", "v", "x", "a"].includes(e.key.toLowerCase())
      ) {
        e.stopPropagation();
      }
    };

    document.addEventListener("copy", handleCopyEvent);
    document.addEventListener("keydown", handleKeyDown, true); // Use capture phase

    return () => {
      document.removeEventListener("copy", handleCopyEvent);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="w-[min(82vw,700px)] max-w-none"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            Python source for: <span className="italic">{functionName}</span>
          </DialogTitle>
          <DialogDescription>
            This is the source of your backend function:
          </DialogDescription>
        </DialogHeader>

        <div
          className="h-[62vh] min-h-[460px] max-h-[680px] overflow-auto border p-2 bg-muted rounded-md syntax-highlighter-container"
          onKeyDown={(e) => e.stopPropagation()}
        >
          {loading && <div>Loading code...</div>}
          {!loading && error && (
            <div className="text-red-500">Error: {error}</div>
          )}

          {!loading && !error && code && usePlainCode && (
            <pre
              data-testid="plain-code"
              className="m-0 whitespace-pre text-sm"
              style={{
                fontFamily:
                  'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
              }}
            >
              <code>{plainPrefixCode}</code>
            </pre>
          )}

          {!loading && !error && code && (
            <SyntaxHighlighter
              language="python"
              style={isDarkMode ? oneDark : oneLight}
              showLineNumbers
              startingLineNumber={highlightedStartLine}
              wrapLongLines={false}
              // Make line numbers unselectable
              lineNumberStyle={{
                userSelect: "none",
                WebkitUserSelect: "none",
                MozUserSelect: "none",
                msUserSelect: "none",
              }}
              // Additional container styles
              customStyle={{
                margin: 0,
                fontSize: "14px",
                whiteSpace: "pre",
              }}
              // Code tag props to ensure proper selection
              codeTagProps={{
                style: {
                  fontFamily:
                    'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
                },
              }}
            >
              {highlightedCode}
            </SyntaxHighlighter>
          )}

          {!loading && !error && !code && <div>No code available</div>}
        </div>

        <DialogFooter className="mt-4 flex justify-between">
          <Button
            variant="outline"
            className="select-none"
            onClick={handleCopy}
            disabled={!code}
          >
            {copied ? "Copied!" : "Copy Code"}
          </Button>
          <Button variant="outline" className="select-none" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NodeCodeDialog;
