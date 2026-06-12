import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Copy, Check, X } from "lucide-react";
import type { Edge } from "@xyflow/react";
import type { FlowNode, NodeData } from "@/types";

export interface SearchPanelProps {
  isOpen: boolean;
  nodes: FlowNode[];
  edges: Edge[];
  query: string;
  setQuery: (s: string) => void;
  hasVisibleTabs?: boolean;
  onSelect: (nodeId: string) => void;
  style?: CSSProperties;
}

/* ------------------------------------------------------------------
   Extra optional prop for closing via × button
------------------------------------------------------------------ */
export type SearchPanelFullProps = SearchPanelProps & {
  /** Called when the user clicks the close (×) button */
  onClose?: () => void;
  /** Ask canvas to highlight a text match inside a node */
  onLocateMatch?: (nodeId: string, term: string) => void;
};

/* ---------- helpers ------------------------------------------------ */

const isNotFullyConnected = (n: FlowNode) =>
  ((n.data as NodeData).unwiredCount ?? 0) > 0;

/* ------------------------------------------------------------------ */

export function SearchPanel(props: SearchPanelFullProps) {
  const {
    isOpen,
    nodes,
    edges: _edges, // (unused – kept only to match the prop type)
    query,
    setQuery, // ← comes from parent
    hasVisibleTabs = false,
    onSelect,
    onClose,
    onLocateMatch,
    style = {},
  } = props;
  void _edges;

  /* ----------------------------------------------------------------
      1) Local input value + 100 ms debounce before we call setQuery
  ---------------------------------------------------------------- */
  const [draft, setDraft] = useState(query);
  const timer = useRef<number | undefined>(undefined);

  const handleChange = (val: string) => {
    setDraft(val);

    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setQuery(val), 100);
  };

  const clearInput = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    setDraft("");
    setQuery(""); // clear immediately (no debounce)
  };

  // Keep local state in-sync when parent clears the query
  useEffect(() => setDraft(query), [query]);

  /* ----------------------------------------------------------------
      2) Helper function to get node label
  ---------------------------------------------------------------- */
  const labelFor = (id: string) =>
    nodes.find((n) => n.id === id)?.data?.title ??
    nodes.find((n) => n.id === id)?.data?.functionName ??
    id;

  /* ----------------------------------------------------------------
      3) Copy functionality state
  ---------------------------------------------------------------- */
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyNodeInfo = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the node selection

    // Get the node title/label
    const nodeTitle = labelFor(nodeId);
    // Format: "TITLE node_id" or just "node_id" if title equals id
    const textToCopy = nodeTitle === nodeId ? nodeId : `${nodeTitle} ${nodeId}`;

    const markCopied = () => {
      setCopiedId(nodeId);
      setTimeout(() => setCopiedId(null), 1500);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy).then(markCopied, () => {
        fallbackCopy(textToCopy);
        markCopied();
      });
    } else {
      fallbackCopy(textToCopy);
      markCopied();
    }
  };

  const fallbackCopy = (text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  };

  /* ----------------------------------------------------------------
      4) A sanitized single term for highlighting inside nodes
         - If query is quoted, use the inside
         - Else use the first token
  ---------------------------------------------------------------- */
  const sanitizedTerm = useMemo(() => {
    const q = query.trim();
    if (!q) return "";
    const quoted =
      (q.startsWith('"') && q.endsWith('"')) ||
      (q.startsWith("'") && q.endsWith("'"));
    if (quoted) return q.slice(1, -1);
    return q.split(/\s+/).filter(Boolean)[0] ?? "";
  }, [query]);

  /* ----------------------------------------------------------------
      5) Build haystack once per node and filter against debounced query
         (Now includes d.content for TextInfoNode and real d.inputs)
  ---------------------------------------------------------------- */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    // Special helper keyword:  "partial"  → show nodes with unwired inputs
    if (q === "partial" || q === "[partial]") {
      return nodes.filter(
        (n) =>
          (n.data as NodeData).paramExtraction === "multi_val" &&
          isNotFullyConnected(n)
      );
    }

    // Check if query is wrapped in quotes for exact match
    const isExactMatch =
      (q.startsWith('"') && q.endsWith('"')) ||
      (q.startsWith("'") && q.endsWith("'"));

    let searchQuery = q;
    let searchTokens: string[] = [];

    if (isExactMatch) {
      // Remove quotes and use exact match
      searchQuery = q.slice(1, -1);
    } else {
      // Split into tokens and require ALL tokens to be present, order agnostic
      searchTokens = q.split(/\s+/).filter(Boolean);
    }

    return nodes.filter((n) => {
      const d = n.data as NodeData;

      // Build haystack with all searchable content
      const haystack = [
        n.id,
        d?.title,
        d?.functionName,
        d?.comment,
        d?.result,
        d?.content, // ← search inside TextInfoNode markdown
        JSON.stringify(d?.inputs ?? {}), // ← include actual inputs
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\\u[\dA-F]{4}/gi, "")
        .toLowerCase();

      if (isExactMatch) {
        return haystack.includes(searchQuery);
      } else {
        return searchTokens.every((token) => haystack.includes(token));
      }
    });
  }, [nodes, query]);

  /* ---------- UI -------------------------------------------------- */

  const TAB_BAR = "2.5rem";
  const HEADER = "3.25rem";
  const listMaxH =
    `calc(100vh - ${HEADER}` + (hasVisibleTabs ? ` - ${TAB_BAR}` : "") + ")";

  return (
    <div
      className={cn(
        "fixed top-14 bottom-0 right-0 z-10 flex flex-col select-none border-l border-border bg-background transition-[width] duration-300",
        isOpen ? "w-64" : "w-0 overflow-hidden"
      )}
      data-testid="search-panel"
      style={{ pointerEvents: isOpen ? "auto" : "none", ...style }}
    >
      {isOpen && (
        <>
          {/* ──────────────── Header with close button ──────────────── */}
          <div
            className={cn(
              "flex items-center justify-between px-2 border-b",
              hasVisibleTabs ? "h-10" : "pt-2 pb-1"
            )}
          >
            <span className="text-sm font-medium">Search</span>
            <button
              onClick={() => onClose?.()}
              title="Close search"
              className="p-1 rounded hover:bg-secondary active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search box -------------------------------------------------- */}
          <div className="px-2 pt-2">
            <div className="relative">
              <Input
                id="search-panel-input"
                name="rawbitSearchPanelNoAutocomplete"
                value={draft}
                placeholder="Search node id, name, text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                aria-autocomplete="none"
                spellCheck={false}
                onChange={(e) => handleChange(e.target.value)}
                className="h-8 pr-7 select-text"
                autoFocus
              />
              {draft && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-secondary active:scale-95"
                  onClick={clearInput}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Action buttons --------------------------------------------- */}
          <div className="px-2 my-2 space-y-2">
            {/* Only show 'partial' quick action when nothing is typed */}
            {!draft.trim() && (
              <button
                className="w-full rounded bg-muted py-1 text-sm hover:bg-muted/70"
                title="Find all nodes with unwired inputs"
                onClick={() => handleChange("partial")}
              >
                Search for partial nodes
              </button>
            )}
          </div>

          {/* Match list -------------------------------------------------- */}
          <div
            className="flex-grow overflow-y-auto px-2 pb-2"
            style={{ maxHeight: listMaxH }}
          >
            {query && matches.length === 0 ? (
              <div className="mt-2 text-sm italic text-muted-foreground">
                No matches
              </div>
            ) : (
              <ul className="space-y-1 mt-2">
                {matches.map((n) => (
                  <li key={n.id} className="group">
                    <div
                      role="button"
                      tabIndex={0}
                      className="grid grid-cols-[1fr,auto] items-center gap-2 w-full rounded p-1 text-left text-sm hover:bg-secondary focus-within:bg-secondary"
                      onClick={() => {
                        onSelect(n.id);
                        onLocateMatch?.(n.id, sanitizedTerm);
                      }}
                      onKeyDown={(e) => {
                        // Ignore key events bubbling from the nested copy
                        // button; only react to keys aimed at the row itself.
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(n.id);
                          onLocateMatch?.(n.id, sanitizedTerm);
                        }
                      }}
                    >
                      {/* text column */}
                      <div className="min-w-0">
                        <strong className="block truncate">
                          {labelFor(n.id)}
                        </strong>
                        <span className="block text-xs truncate">
                          {n.id}
                        </span>
                      </div>

                      {/* actions column (hidden until hover/focus) */}
                      <button
                        type="button"
                        onClick={(e) => copyNodeInfo(n.id, e)} // stops propagation
                        aria-label={`Copy: ${labelFor(n.id)} ${n.id}`}
                        className="shrink-0 p-1.5 rounded border border-border bg-background
                                   opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
                                   pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto
                                   transition-opacity duration-150 active:scale-95"
                      >
                        {copiedId === n.id ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
