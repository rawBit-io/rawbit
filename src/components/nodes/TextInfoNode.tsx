/* ------------------------------------------------------------------
   TextInfoNode – markdown/info canvas with dark mode support
   Updated: Fixed ResizeObserver + Restored proper text rendering
------------------------------------------------------------------- */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
} from "react";
import { NodeProps, useReactFlow, NodeResizer, Edge } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Minus, Plus, MoreHorizontal, Copy, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { mdToHtml } from "@/lib/markdown";
import { useClipboardLite } from "@/hooks/nodes/useClipboardLite";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useSnapshotSchedulerContext } from "@/hooks/useSnapshotSchedulerContext";
import type { CalculationNodeData, FlowNode } from "@/types";
import { produce, setAutoFreeze, Draft } from "immer";

setAutoFreeze(false); // Immer objects must stay mutable for React-Flow

/* -------------------------------------------------------------
 *  Constants
 * ----------------------------------------------------------- */
const DEFAULT_TEXT = "...";
const MIN_WIDTH = 360;
const MIN_HEIGHT = 100;
const HEADER_HEIGHT = 32; // h-8 in Tailwind = 32px
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 150;

/* -------------------------------------------------------------
 *  Search highlight helpers
 * ----------------------------------------------------------- */
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unmarkAll(root: HTMLElement) {
  const marks = root.querySelectorAll("mark.__searchHit");
  marks.forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(m.textContent || ""), m);
    parent.normalize(); // merge adjacent text nodes
  });
}

function markAll(root: HTMLElement, term: string): number {
  const re = new RegExp(escapeRegExp(term), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  let hits = 0;
  textNodes.forEach((tn) => {
    const value = tn.nodeValue || "";
    if (!value) return;
    re.lastIndex = 0;
    if (!re.test(value)) return;
    re.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      const start = m.index;
      const end = start + m[0].length;
      if (start > last)
        frag.appendChild(document.createTextNode(value.slice(last, start)));
      const mark = document.createElement("mark");
      mark.className = "__searchHit";
      mark.textContent = value.slice(start, end);
      // gentle yellow; inline so no global CSS needed
      mark.style.background = "rgba(234,179,8,0.45)";
      mark.style.borderRadius = "2px";
      mark.style.padding = "0 1px";
      frag.appendChild(mark);
      hits += 1;
      last = end;
    }
    if (last < value.length)
      frag.appendChild(document.createTextNode(value.slice(last)));
    tn.parentNode?.replaceChild(frag, tn);
  });

  return hits;
}

export default function TextInfoNode({
  id,
  data,
  selected,
  width: nodeWidth,
  height: nodeHeight,
}: NodeProps<FlowNode>) {
  const normalizeFontSize = useCallback(
    (value: unknown) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 16;
      return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, numeric));
    },
    []
  );

  /* ───────── hooks & helpers ──────────────────────────────── */
  const rf = useReactFlow<FlowNode>();
  const { pushState } = useUndoRedo();
  const {
    lockEdgeSnapshotSkip,
    releaseEdgeSnapshotSkip,
    scheduleSnapshot,
  } = useSnapshotSchedulerContext();

  /* ---------- O(1) node patch helper ------------------------ */
  const updateNode = useCallback(
    (mutator: (draft: Draft<CalculationNodeData>) => void) => {
      rf.setNodes((nodes) => {
        const idx = nodes.findIndex((n) => n.id === id);
        if (idx === -1) return nodes;
        const currentNode = nodes[idx];
        const currentData = (currentNode.data ?? {}) as CalculationNodeData;
        const nextData = produce(currentData, mutator);
        if (nextData === currentData) return nodes;
        const next = [...nodes];
        next[idx] = {
          ...currentNode,
          data: nextData,
        };
        return next;
      });
    },
    [rf, id]
  );

  /* ───────── node-level data ──────────────────────────────── */
  const content = typeof data.content === "string" ? data.content : "";
  const fontSize = normalizeFontSize(data.fontSize);
  const lineHeight = Math.round(fontSize * 1.5); // Use the same calculation as the second file
  const borderStyle = data.borderColor ? { borderColor: data.borderColor } : {};
  const rawTitle = data.title || "Text Node";
  const { copyId, idCopied } = useClipboardLite({
    result: undefined,
    rawTitle,
    id,
  });

  // Use node dimensions if available, otherwise fall back to data dimensions
  const displayWidth = nodeWidth || data.width || MIN_WIDTH;
  const displayHeight = nodeHeight || data.height || MIN_HEIGHT;
  const committedSizeRef = useRef({
    width: Math.round(displayWidth),
    height: Math.round(displayHeight),
  });
  committedSizeRef.current.width = Math.round(displayWidth);
  committedSizeRef.current.height = Math.round(displayHeight);

  /* 🔶 Highlight ring (search / edge-select) */
  const highlightStyles =
    data.isHighlighted && !selected
      ? cn(
          "ring-8 ring-yellow-400 ring-offset-4 ring-offset-background",
          "shadow-[0_0_10px_4px_rgba(234,179,8,0.80)]"
        )
      : "";
  const selectedStyles = selected
    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
    : "";

  /* ───────── local editing state ───────────────────────────── */
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<string>(content || DEFAULT_TEXT);
  const [showMenu, setShowMenu] = useState(false);
  const searchMarkTerm = data.searchMark?.term?.trim();
  const searchMarkTimestamp = data.searchMark?.ts;

  /* keep draft in sync when external content changes */
  useEffect(() => {
    if (isEditing) return;
    const nextDraft = content || DEFAULT_TEXT;
    setDraft((prev) => (prev === nextDraft ? prev : nextDraft));
  }, [content, isEditing]);

  /* -----------------------------------------------------------
   *  Derived / deferred markdown HTML
   * --------------------------------------------------------- */
  const deferredContent = useDeferredValue(content);
  const formatted = useMemo(() => mdToHtml(deferredContent), [deferredContent]);

  /* refs */
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /* ───────── textarea height helper ───────────────────────── */
  // Keep a ref so updateTextareaFit stays stable (no deps that churn on every
  // resize tick), preventing useEffect / onResize from recreating on each render.
  const displayHeightRef = useRef(displayHeight);
  displayHeightRef.current = displayHeight;

  const updateTextareaFit = useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = `${displayHeightRef.current - HEADER_HEIGHT}px`;
  }, []); // stable – reads height via ref

  useEffect(() => {
    if (isEditing) updateTextareaFit();
  }, [isEditing, updateTextareaFit]);

  /* wheel isolation inside content div for both modes */
  useEffect(() => {
    const div = contentRef.current;
    if (!div) return;
    const handle = (e: WheelEvent) => {
      const max = div.scrollHeight - div.clientHeight;
      if (max > 0) {
        e.stopPropagation();
        div.scrollTop += e.deltaY;
      }
    };
    div.addEventListener("wheel", handle, { passive: false });
    return () => div.removeEventListener("wheel", handle);
  }, []);

  /* wheel isolation for textarea when editing */
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !isEditing) return;
    const handle = (e: WheelEvent) => {
      const max = textarea.scrollHeight - textarea.clientHeight;
      if (max > 0) {
        e.stopPropagation();
        textarea.scrollTop += e.deltaY;
      }
    };
    textarea.addEventListener("wheel", handle, { passive: false });
    return () => textarea.removeEventListener("wheel", handle);
  }, [isEditing]);

  /* ───────── font size controls (commits immediately) ───────── */
  const changeFontSize = useCallback(
    (delta: number) => {
      updateNode((d) => {
        d.fontSize = normalizeFontSize((d.fontSize || 16) + delta);
      });
      setTimeout(() => pushState(rf.getNodes(), rf.getEdges(), "Font Size"), 0);
    },
    [normalizeFontSize, updateNode, pushState, rf]
  );

  /* ───────── editing lifecycle ───────────────────────────── */
  const startEdit = useCallback(() => {
    setDraft(content === DEFAULT_TEXT ? "" : content);
    setIsEditing(true);
    setTimeout(() => {
      textareaRef.current?.focus();
      updateTextareaFit();
    }, 0);
  }, [content, updateTextareaFit]);

  const commitEdit = useCallback(() => {
    const newText = draft.trim() ? draft : DEFAULT_TEXT;
    setIsEditing(false);

    if (newText !== content) {
      updateNode((d) => {
        d.content = newText;
      });
      setTimeout(() => pushState(rf.getNodes(), rf.getEdges(), "Edit Text"), 0);
    }
  }, [draft, content, updateNode, pushState, rf]);

  /* keyboard and change handlers */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsEditing(false);
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commitEdit();
      }
    },
    [commitEdit]
  );

  /* ───────── resize handlers (commit immediately) ───────────── */
  const onResize = useCallback(
    (_: unknown, { width, height }: { width: number; height: number }) => {
      // Round to integer pixels to prevent sub-pixel oscillation loops
      // (same fix applied to CalculationNodeView anchored handles).
      const w = Math.round(width);
      const h = Math.round(height);
      const current = committedSizeRef.current;
      if (current.width === w && current.height === h) {
        return;
      }
      current.width = w;
      current.height = h;
      updateNode((d) => {
        d.width = w;
        d.height = h;
      });
      if (isEditing && textareaRef.current) {
        textareaRef.current.style.height = `${h - HEADER_HEIGHT}px`;
      }
    },
    [updateNode, isEditing]
  );

  const onResizeEnd = useCallback(
    () =>
      setTimeout(
        () => pushState(rf.getNodes(), rf.getEdges(), "Resize Text Node"),
        0
      ),
    [pushState, rf]
  );

  /* ───────── Portaled menu handlers ───────────────────────── */
  const handleCopyId = useCallback(() => {
    copyId();
    setShowMenu(false);
  }, [copyId]);

  const deleteNode = useCallback(() => {
    lockEdgeSnapshotSkip();
    let removedEdge = false;
    rf.setEdges((eds) => {
      if (!eds.length) {
        releaseEdgeSnapshotSkip();
        return eds;
      }
      const filtered = eds.filter((edge: Edge) => {
        const shouldRemove = edge.source === id || edge.target === id;
        if (shouldRemove) removedEdge = true;
        return !shouldRemove;
      });
      if (!removedEdge) {
        releaseEdgeSnapshotSkip();
      }
      return filtered;
    });

    rf.setNodes((nds) => nds.filter((n) => n.id !== id));

    scheduleSnapshot("Node(s) removed", { refresh: true });
  }, [
    id,
    lockEdgeSnapshotSkip,
    releaseEdgeSnapshotSkip,
    rf,
    scheduleSnapshot,
  ]);

  /* ───────── Search highlighting effect ───────────────────── */
  useEffect(() => {
    if (isEditing) return;
    const el = contentRef.current;
    if (!el) return;

    unmarkAll(el);

    if (!searchMarkTerm) return;

    const hits = markAll(el, searchMarkTerm);
    if (hits > 0) {
      const first = el.querySelector("mark.__searchHit") as HTMLElement | null;
      first?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
    }
  }, [formatted, isEditing, searchMarkTerm, searchMarkTimestamp]);

  /* ───────── JSX ───────────────────────────────────────────── */
  return (
    <Card
      className={cn(
        "rounded-lg shadow-md bg-card relative overflow-visible",
        highlightStyles, // yellow halo when data.isHighlighted === true
        selectedStyles, // blue ring when the node itself is selected
        data.borderColor ? "border-2" : "border"
      )}
      style={{
        ...borderStyle,
        width: displayWidth,
        height: displayHeight,
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={100}
        lineStyle={{
          border: "1px dashed var(--muted-foreground)",
          pointerEvents: "none",
        }}
        handleStyle={{
          width: 24,
          height: 24,
          backgroundColor: "hsl(var(--background))",
          border: "2px solid var(--resizer-handle-color)",
          borderRadius: 6,
          boxShadow: "0 0 0 2px hsl(var(--background))",
          pointerEvents: "auto",
        }}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />

      {/* Header – font controls and inline menu */}
      <div className="flex items-center justify-between h-8 px-2 -mx-px -mt-px bg-primary/10 border-b rounded-t-lg cursor-pointer active:cursor-grabbing">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => changeFontSize(-2)}
            title="Smaller font"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="text-xs text-muted-foreground w-5 text-center">
            {fontSize}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => changeFontSize(+2)}
            title="Larger font"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Markdown</span>

          <DropdownMenu modal={false} open={showMenu} onOpenChange={setShowMenu}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuPortal>
              <DropdownMenuContent
                align="end"
                side="right"
                avoidCollisions
                className="z-[100] min-w-[160px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                style={{ fontSize: "14px" }}
                onPointerDown={(event) => event.stopPropagation()}
                onWheelCapture={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem onSelect={handleCopyId}>
                  <span className="flex items-center gap-2">
                    {idCopied ? (
                      <>
                        <Check className="h-4 w-4" /> Copied ✓
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" /> Copy ID
                      </>
                    )}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={deleteNode}
                >
                  <span className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4" /> Delete Node
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </div>
      </div>

      {/* Content */}
      <CardContent className="p-0 h-[calc(100%-32px)] overflow-hidden">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className="nowheel nodrag w-full h-full p-4 bg-transparent focus:outline-none border-0 resize-none"
            style={{
              fontSize: `${fontSize}px`,
              lineHeight: `${lineHeight}px`,
              overflowY: "auto",
              overscrollBehavior: "contain",
              fontFamily:
                '"Inter Var",Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
            }}
            placeholder="Type markdown here…"
          />
        ) : (
          <div
            ref={contentRef}
            className="nowheel nodrag cursor-text p-4 w-full h-full"
            style={{
              fontSize: `${fontSize}px`,
              lineHeight: `${lineHeight}px`,
              overflowY: "auto",
              overscrollBehavior: "contain",
              // Removed whiteSpace: "pre-wrap" - this was causing extra spacing
              fontFamily:
                '"Inter Var",Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
            }}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("a")) startEdit();
            }}
            dangerouslySetInnerHTML={{ __html: formatted }}
          />
        )}
      </CardContent>
    </Card>
  );
}
