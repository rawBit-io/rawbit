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
import { useDismissNodeMenuOnCanvasPointerDown } from "@/hooks/nodes/useDismissNodeMenuOnCanvasPointerDown";
import { useSnapshotSchedulerContext } from "@/hooks/useSnapshotSchedulerContext";
import type { CalculationNodeData, FlowNode } from "@/types";
import { resolveTextInfoDimensions } from "@/lib/textInfoDimensions";
import { produce, setAutoFreeze, Draft } from "immer";

setAutoFreeze(false); // Immer objects must stay mutable for React-Flow

/* -------------------------------------------------------------
 *  Constants
 * ----------------------------------------------------------- */
const DEFAULT_TEXT = "Double-click to edit";
const MIN_WIDTH = 360;
const MIN_HEIGHT = 100;
const CONTENT_VERTICAL_CHROME = 48;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 150;

function requestNodeInternalsUpdate(
  rf: ReturnType<typeof useReactFlow<FlowNode>>,
  id: string
) {
  const updateNodeInternals = (
    rf as ReturnType<typeof useReactFlow<FlowNode>> & {
      updateNodeInternals?: (nodeId: string) => void;
    }
  ).updateNodeInternals;

  if (!updateNodeInternals) return;

  const run = () => updateNodeInternals(id);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    run();
  }
}

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
  const isDefaultContent = useCallback((value: string) => {
    const trimmed = value.trim();
    return trimmed === "" || trimmed === DEFAULT_TEXT || trimmed === "...";
  }, []);

  /* ───────── hooks & helpers ──────────────────────────────── */
  const rf = useReactFlow<FlowNode>();
  // Snapshots go through the scheduler (pushCleanState) — raw pushState
  // moves the history pointer without skipLoadRef, which Flow's load
  // effect misreads as undo navigation and reloads stale state.
  const { scheduleSnapshot } = useSnapshotSchedulerContext();

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

  // Keep React Flow's outer node geometry in sync with the visible card.
  // Otherwise offscreen unmount/remount can restore the default node size.
  const updateNodeSize = useCallback(
    (width: number, height: number) => {
      rf.setNodes((nodes) => {
        const idx = nodes.findIndex((n) => n.id === id);
        if (idx === -1) return nodes;

        const currentNode = nodes[idx];
        const currentData = (currentNode.data ?? {}) as CalculationNodeData;
        const nextMeasured = {
          ...currentNode.measured,
          width,
          height,
        };

        if (
          currentData.width === width &&
          currentData.height === height &&
          currentNode.width === width &&
          currentNode.height === height &&
          currentNode.measured?.width === width &&
          currentNode.measured?.height === height
        ) {
          return nodes;
        }

        const next = [...nodes];
        next[idx] = {
          ...currentNode,
          width,
          height,
          measured: nextMeasured,
          data: {
            ...currentData,
            width,
            height,
          },
        };
        return next;
      });

      requestNodeInternalsUpdate(rf, id);
    },
    [rf, id]
  );

  /* ───────── node-level data ──────────────────────────────── */
  const rawContent = typeof data.content === "string" ? data.content : "";
  const isPlaceholderContent = isDefaultContent(rawContent);
  const content = isPlaceholderContent ? DEFAULT_TEXT : rawContent;
  const fontSize = normalizeFontSize(data.fontSize);
  const lineHeight = Math.round(fontSize * 1.5); // Use the same calculation as the second file
  const paletteColor =
    typeof data.borderColor === "string" && data.borderColor.trim()
      ? data.borderColor.trim()
      : undefined;
  const hasExplicitNoFill = data.textInfoFill === "none";
  const borderStyle = paletteColor ? { borderColor: paletteColor } : undefined;
  const fillStyle = paletteColor ? { backgroundColor: paletteColor } : undefined;
  const { copyId, idCopied } = useClipboardLite({
    result: undefined,
    rawTitle: "Text Info Node",
    id,
  });

  const { width: displayWidth, height: displayHeight } =
    resolveTextInfoDimensions({
      dataWidth: data.width,
      dataHeight: data.height,
      nodeWidth,
      nodeHeight,
      fallbackWidth: MIN_WIDTH,
      fallbackHeight: MIN_HEIGHT,
    });
  const committedSizeRef = useRef({
    width: Math.round(displayWidth),
    height: Math.round(displayHeight),
  });
  committedSizeRef.current.width = Math.round(displayWidth);
  committedSizeRef.current.height = Math.round(displayHeight);
  const titleFontSize = Math.round(Math.max(18, Math.min(36, fontSize)));
  const titlePillHeight = Math.round(Math.max(52, titleFontSize + 24));
  const titleControlVisualSize = Math.round(Math.max(14, titleFontSize * 0.78));
  const titleControlButtonSize = Math.round(Math.max(30, titleFontSize + 10));
  const titleControlValueWidth = Math.round(Math.max(34, titleFontSize * 1.8));
  const titleControlGap = Math.round(Math.max(4, titleFontSize * 0.12));
  const fontControlsVisible = selected;
  const controlsVisible = selected;
  const fontControlsWidth = fontControlsVisible
    ? titleControlButtonSize * 2 + titleControlValueWidth + titleControlGap * 2
    : 0;
  const titleControlsWidth = Math.round(
    titleControlButtonSize +
      fontControlsWidth +
      (fontControlsVisible ? titleControlGap : 0) +
      16
  );
  const titlePillWidth = Math.round(titleControlsWidth + 32);
  const contentTopPadding = controlsVisible
    ? Math.round(Math.max(44, titlePillHeight * 0.78))
    : 32;

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

  useEffect(() => {
    if (!selected) setShowMenu(false);
  }, [selected]);

  useDismissNodeMenuOnCanvasPointerDown(showMenu, () => {
    setShowMenu(false);
  });

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

  // Normalize legacy mismatches in both directions:
  // - older sessions may only have data.width/height
  // - older bundled flows may only have resized React Flow geometry
  useEffect(() => {
    updateNodeSize(Math.round(displayWidth), Math.round(displayHeight));
  }, [displayWidth, displayHeight, updateNodeSize]);

  const updateTextareaFit = useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = `${Math.max(
      32,
      displayHeightRef.current - CONTENT_VERTICAL_CHROME
    )}px`;
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
      scheduleSnapshot("Font Size");
    },
    [normalizeFontSize, updateNode, scheduleSnapshot]
  );

  /* ───────── editing lifecycle ───────────────────────────── */
  const startEdit = useCallback(() => {
    setDraft(isDefaultContent(content) ? "" : content);
    setIsEditing(true);
    setTimeout(() => {
      textareaRef.current?.focus();
      updateTextareaFit();
    }, 0);
  }, [content, isDefaultContent, updateTextareaFit]);

  const commitEdit = useCallback(() => {
    const newText = draft.trim() ? draft : DEFAULT_TEXT;
    setIsEditing(false);

    if (newText !== content) {
      updateNode((d) => {
        d.content = newText;
      });
      scheduleSnapshot("Edit Text");
    }
  }, [draft, content, updateNode, scheduleSnapshot]);

  // onlyRenderVisibleElements unmounts off-viewport nodes without firing
  // blur; flush an in-progress edit on unmount so typed text isn't lost.
  // Latest-value ref + [] deps keep this strictly unmount-only, and the
  // flush mirrors commitEdit (including the snapshot) so the edit reaches
  // undo history and the revTick-driven autosave.
  const editFlushRef = useRef({ isEditing, draft, content, updateNode, scheduleSnapshot });
  editFlushRef.current = { isEditing, draft, content, updateNode, scheduleSnapshot };
  useEffect(
    () => () => {
      const pending = editFlushRef.current;
      if (!pending.isEditing) return;
      const newText = pending.draft.trim() ? pending.draft : DEFAULT_TEXT;
      if (newText === pending.content) return;
      pending.updateNode((d) => {
        d.content = newText;
      });
      pending.scheduleSnapshot("Edit Text");
    },
    []
  );

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
      updateNodeSize(w, h);
      if (isEditing && textareaRef.current) {
        textareaRef.current.style.height = `${Math.max(
          32,
          h - CONTENT_VERTICAL_CHROME
        )}px`;
      }
    },
    [updateNodeSize, isEditing]
  );

  const onResizeEnd = useCallback(
    () => scheduleSnapshot("Resize Text Node"),
    [scheduleSnapshot]
  );

  /* ───────── Portaled menu handlers ───────────────────────── */
  const handleCopyId = useCallback(() => {
    copyId();
    setShowMenu(false);
  }, [copyId]);

  const deleteNode = useCallback(() => {
    rf.setEdges((eds) => {
      if (!eds.length) return eds;
      let removedEdge = false;
      const filtered = eds.filter((edge: Edge) => {
        const shouldRemove = edge.source === id || edge.target === id;
        if (shouldRemove) removedEdge = true;
        return !shouldRemove;
      });
      return removedEdge ? filtered : eds;
    });

    rf.setNodes((nds) => nds.filter((n) => n.id !== id));

    scheduleSnapshot("Node(s) removed", {
      refresh: true,
      coalesceFollowingCalc: true,
    });
  }, [
    id,
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
        "rounded-lg shadow-md bg-card relative overflow-visible text-primary transition-colors cursor-pointer",
        highlightStyles, // yellow halo when data.isHighlighted === true
        selectedStyles // blue ring when the node itself is selected
      )}
      style={{
        ...borderStyle,
        width: displayWidth,
        height: displayHeight,
      }}
    >
      <div
        className={cn(
          "text-info-fill pointer-events-none absolute inset-0 z-0 rounded-lg",
          paletteColor && "has-palette-fill",
          hasExplicitNoFill && "no-text-info-fill"
        )}
        data-testid="text-info-fill"
        style={fillStyle}
      />

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

      {controlsVisible && (
        <div
          data-testid="text-info-header"
          className="absolute left-1/2 top-0 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background/95 shadow-sm cursor-grab active:cursor-grabbing"
          style={{
            width: titlePillWidth,
            height: titlePillHeight,
            ...borderStyle,
          }}
        >
          <div className="flex h-full w-full items-center justify-center px-3">
            <div
              className="nodrag flex shrink-0 items-center"
              style={{
                columnGap: titleControlGap,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {fontControlsVisible && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full p-0"
                    style={{
                      width: titleControlButtonSize,
                      height: titleControlButtonSize,
                    }}
                    onClick={() => changeFontSize(-2)}
                    title="Smaller font"
                    aria-label="Smaller font"
                  >
                    <Minus
                      className="text-foreground"
                      style={{
                        width: titleControlVisualSize,
                        height: titleControlVisualSize,
                      }}
                    />
                  </Button>
                  <span
                    className="text-center text-muted-foreground tabular-nums select-none"
                    style={{
                      width: titleControlValueWidth,
                      fontSize: titleFontSize,
                      lineHeight: 1,
                    }}
                  >
                    {fontSize}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full p-0"
                    style={{
                      width: titleControlButtonSize,
                      height: titleControlButtonSize,
                    }}
                    onClick={() => changeFontSize(+2)}
                    title="Larger font"
                    aria-label="Larger font"
                  >
                    <Plus
                      className="text-foreground"
                      style={{
                        width: titleControlVisualSize,
                        height: titleControlVisualSize,
                      }}
                    />
                  </Button>
                </>
              )}

              <DropdownMenu
                modal={false}
                open={showMenu}
                onOpenChange={setShowMenu}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="Text node menu"
                    title="Text node menu"
                    variant="ghost"
                    size="icon"
                    className="rounded-full p-0"
                    style={{
                      width: titleControlButtonSize,
                      height: titleControlButtonSize,
                    }}
                  >
                    <MoreHorizontal
                      className="text-foreground"
                      style={{
                        width: titleControlVisualSize,
                        height: titleControlVisualSize,
                      }}
                    />
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
        </div>
      )}

      {/* Content */}
      <CardContent
        className="relative z-10 h-full overflow-hidden px-8 pb-8 cursor-pointer"
        style={{ paddingTop: contentTopPadding }}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className="nowheel nodrag h-full w-full resize-none border-0 bg-transparent p-0 text-foreground cursor-text focus:outline-none"
            style={{
              fontSize: `${fontSize}px`,
              lineHeight: `${lineHeight}px`,
              overflowY: "auto",
              overscrollBehavior: "contain",
              fontFamily: "inherit",
            }}
            placeholder="Type markdown here…"
          />
        ) : (
          <div
            ref={contentRef}
            className={`text-info-markdown nowheel h-full w-full cursor-pointer overflow-auto text-foreground${
              isPlaceholderContent ? " text-info-placeholder" : ""
            }`}
            title="Double-click to edit"
            style={{
              fontSize: `${fontSize}px`,
              lineHeight: `${lineHeight}px`,
              overflowY: "auto",
              overscrollBehavior: "contain",
              fontFamily: "inherit",
            }}
            onDoubleClick={(e) => {
              if (!(e.target as HTMLElement).closest("a")) startEdit();
            }}
            dangerouslySetInnerHTML={{ __html: formatted }}
          />
        )}
      </CardContent>
    </Card>
  );
}
