//  src/components/nodes/GroupNode.tsx
//  -------------------------------------------------------------------
//  Group node with top title pill and on-demand controls
//  - Menu renders in a portal (always above children)
//  - Menu position follows the anchor live while open (handles zoom/pan)
//  - Deleting from the menu recursively deletes all descendants
//  -------------------------------------------------------------------

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  NodeProps,
  NodeResizer,
  useReactFlow,
  ResizeParams,
  Viewport,
} from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Minus,
  Plus,
  MoreHorizontal,
  Copy,
  Trash2,
  Check,
  Ungroup,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClipboardLite } from "@/hooks/nodes/useClipboardLite";
import { useSnapshotSchedulerContext } from "@/hooks/useSnapshotSchedulerContext";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useFlowActions } from "@/hooks/useFlowActions";
import type { CalculationNodeData, FlowNode } from "@/types";
import { produce, setAutoFreeze } from "immer";
import { EditableLabel } from "./common/EditableLabel";
import { BorderDragHandles } from "./common/BorderDragHandles";
import { useNodePortalMenu } from "@/hooks/nodes/useNodePortalMenu";

setAutoFreeze(false);

// --- UI constants ---------------------------------------------------
const DEFAULT_FONT_SIZE = 44;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 150;
const RESIZE_HANDLE_SIZE = 24;
const TITLE_PILL_MIN_WIDTH = 220;

const MIN_W = 380;
const MIN_H = 220;

const BORDER_WIDTH = 10;
const MENU_WIDTH = 240;
const TITLE_CLICK_MOVE_TOLERANCE = 4;
const TITLE_DOUBLE_CLICK_MS = 360;
const CLEAR_BUNDLE_EDGE_SELECTION_EVENT = "rawbit:clear-bundle-edge-selection";

const isAdditiveSelectionEvent = (
  event: Pick<
    React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>,
    "ctrlKey" | "metaKey"
  >
): boolean => event.metaKey || event.ctrlKey;

const isNestedFlowNodeTarget = (
  target: EventTarget | null,
  currentTarget: EventTarget | null
): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (!(currentTarget instanceof HTMLElement)) return false;
  const targetNode = target.closest(".react-flow__node");
  const currentNode = currentTarget.closest(".react-flow__node");
  return Boolean(targetNode && currentNode && targetNode !== currentNode);
};

const normalizeFontSize = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_FONT_SIZE;
  return Math.min(Math.max(numeric, MIN_FONT_SIZE), MAX_FONT_SIZE);
};

/* --------------------------------------------------------------------
   The actual node component
-------------------------------------------------------------------- */
export default function ShadcnGroupNode({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const rf = useReactFlow<FlowNode>();
  const { pushState } = useUndoRedo();
  const { scheduleSnapshot } = useSnapshotSchedulerContext();
  const { ungroupWithUndo } = useFlowActions();

  // menu state
  const [showMenu, setShowMenu] = useState(false);
  const [showTitleControls, setShowTitleControls] = useState(false);
  const [titlePressActive, setTitlePressActive] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [titleEditSignal, setTitleEditSignal] = useState(0);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const titlePressRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    didDrag: boolean;
  } | null>(null);
  const lastTitleClickRef = useRef<{
    time: number;
    x: number;
    y: number;
  } | null>(null);
  const suppressNextTitleClickRef = useRef(false);
  const { containerRef: menuContainerRef, position: menuPos } =
    useNodePortalMenu({
      isOpen: showMenu,
      anchorRef: menuAnchorRef as React.MutableRefObject<HTMLElement | null>,
      onClose: () => setShowMenu(false),
    });
  const rawTitle = data.title || "Group Node";
  const { copyId, idCopied } = useClipboardLite({
    result: undefined,
    rawTitle,
    id,
  });

  const menuPosition = useMemo(() => {
    if (!showMenu) return null;
    const anchorRect = menuAnchorRef.current?.getBoundingClientRect();
    const fallbackTop = menuPos.y - 24;
    const fallbackLeft = menuPos.x + 8;
    let top = anchorRect ? anchorRect.top : fallbackTop;
    let left = anchorRect ? anchorRect.right + 8 : fallbackLeft;

    if (typeof window !== "undefined") {
      const maxLeft = Math.max(8, window.innerWidth - MENU_WIDTH - 8);
      left = Math.min(Math.max(8, left), maxLeft);
    } else {
      left = Math.max(8, left);
    }

    top = Math.max(8, top);

    return { top, left };
  }, [menuPos, showMenu]);

  useEffect(() => {
    if (!showMenu) return;
    const pane = document.querySelector(".react-flow__pane");
    if (!pane) return;
    const handlePanePointerDown = () => {
      setShowMenu(false);
      setShowTitleControls(false);
    };
    pane.addEventListener("pointerdown", handlePanePointerDown);
    return () => {
      pane.removeEventListener("pointerdown", handlePanePointerDown);
    };
  }, [showMenu]);

  useEffect(() => {
    if (selected) return;
    setShowMenu(false);
    setShowTitleControls(false);
    setTitlePressActive(false);
    titlePressRef.current = null;
    lastTitleClickRef.current = null;
  }, [selected]);

  /* ----------------------------------------------------------------
       Helper: mutate node data in place (keeps RF internals intact)
  ---------------------------------------------------------------- */
  const mutateNode = useCallback(
    (mutator: (data: CalculationNodeData) => void) => {
      rf.setNodes((nodes) =>
        produce(nodes, (draft) => {
          const target = draft.find((node) => node.id === id);
          if (!target) return;
          const baseData: CalculationNodeData = {
            ...(target.data as CalculationNodeData | undefined),
          };
          mutator(baseData);
          target.data = baseData;
        })
      );
    },
    [rf, id]
  );

  /* ----------------------------------------------------------------
       Title / font size handlers
  ---------------------------------------------------------------- */
  const commitTitle = (val: string) => {
    mutateNode((d) => (d.title = val));
    setTimeout(
      () => pushState(rf.getNodes(), rf.getEdges(), "Change Group Title"),
      0
    );
  };

  const clearSelectedEdges = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(CLEAR_BUNDLE_EDGE_SELECTION_EVENT));
    }

    rf.setEdges((currentEdges) => {
      let changed = false;
      const next = currentEdges.map((edge) => {
        if (!edge.selected) return edge;
        changed = true;
        return { ...edge, selected: false };
      });
      return changed ? next : currentEdges;
    });
  }, [rf]);

  const selectGroupNode = useCallback(
    (options?: { preserveExisting?: boolean }) => {
      clearSelectedEdges();
      const preserveExisting = options?.preserveExisting === true;

      rf.setNodes((currentNodes) => {
        let changed = false;
        const next = currentNodes.map((node) => {
          const shouldSelect =
            node.id === id
              ? true
              : preserveExisting
                ? node.selected === true
                : false;
          if (node.selected === shouldSelect) return node;
          changed = true;
          return { ...node, selected: shouldSelect };
        });
        return changed ? next : currentNodes;
      });
    },
    [clearSelectedEdges, id, rf]
  );

  const blurActiveEditableElement = useCallback(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (active === document.body) return;
    const isEditable =
      active.isContentEditable ||
      active.matches("input, textarea, select, [contenteditable]");
    if (!isEditable) return;
    active.blur();
  }, []);

  const handleHeaderControlPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      blurActiveEditableElement();
      event.stopPropagation();
      selectGroupNode({
        preserveExisting: isAdditiveSelectionEvent(event),
      });
    },
    [blurActiveEditableElement, selectGroupNode]
  );

  const showGroupChrome = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      if (suppressNextTitleClickRef.current) {
        suppressNextTitleClickRef.current = false;
        return;
      }
      selectGroupNode({
        preserveExisting: isAdditiveSelectionEvent(event),
      });
      setShowTitleControls(true);
    },
    [selectGroupNode]
  );

  const startTitleEdit = useCallback(
    () => {
      setShowMenu(false);
      setShowTitleControls(false);
      selectGroupNode();
      setTitleEditSignal((signal) => signal + 1);
    },
    [selectGroupNode]
  );

  const requestTitleEdit = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, [contenteditable='true'], select, button"
        )
      ) {
        return;
      }

      startTitleEdit();
    },
    [startTitleEdit]
  );

  const handleTitlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const eventTime =
        typeof event.timeStamp === "number" ? event.timeStamp : Date.now();
      const lastClick = lastTitleClickRef.current;
      const isSecondTitleClick =
        lastClick !== null &&
        eventTime - lastClick.time <= TITLE_DOUBLE_CLICK_MS &&
        Math.abs(event.clientX - lastClick.x) <= TITLE_CLICK_MOVE_TOLERANCE &&
        Math.abs(event.clientY - lastClick.y) <= TITLE_CLICK_MOVE_TOLERANCE;

      if (isSecondTitleClick) {
        event.preventDefault();
        event.stopPropagation();
        titlePressRef.current = null;
        lastTitleClickRef.current = null;
        suppressNextTitleClickRef.current = true;
        setTitlePressActive(false);
        startTitleEdit();
        return;
      }

      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, [contenteditable='true'], select, button"
        )
      ) {
        return;
      }

      titlePressRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        didDrag: false,
      };
      suppressNextTitleClickRef.current = false;
      setTitlePressActive(true);
      setShowMenu(false);
      setShowTitleControls(false);
      selectGroupNode({
        preserveExisting: isAdditiveSelectionEvent(event),
      });
    },
    [selectGroupNode, startTitleEdit]
  );

  useEffect(() => {
    if (!titlePressActive) return;

    const markMovement = (event: PointerEvent) => {
      const press = titlePressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      const dx = Math.abs(event.clientX - press.startX);
      const dy = Math.abs(event.clientY - press.startY);
      if (dx > TITLE_CLICK_MOVE_TOLERANCE || dy > TITLE_CLICK_MOVE_TOLERANCE) {
        press.didDrag = true;
      }
    };

    const finishPress = (event: PointerEvent) => {
      const press = titlePressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;

      titlePressRef.current = null;
      setTitlePressActive(false);

      if (press.didDrag) {
        suppressNextTitleClickRef.current = true;
        lastTitleClickRef.current = null;
        setShowTitleControls(false);
        return;
      }

      lastTitleClickRef.current = {
        time:
          typeof event.timeStamp === "number" ? event.timeStamp : Date.now(),
        x: event.clientX,
        y: event.clientY,
      };
      setShowTitleControls(true);
    };

    const cancelPress = (event: PointerEvent) => {
      const press = titlePressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      titlePressRef.current = null;
      lastTitleClickRef.current = null;
      suppressNextTitleClickRef.current = true;
      setTitlePressActive(false);
      setShowTitleControls(false);
    };

    window.addEventListener("pointermove", markMovement);
    window.addEventListener("pointerup", finishPress);
    window.addEventListener("pointercancel", cancelPress);

    return () => {
      window.removeEventListener("pointermove", markMovement);
      window.removeEventListener("pointerup", finishPress);
      window.removeEventListener("pointercancel", cancelPress);
    };
  }, [titlePressActive]);

  const increaseFontSize = () => {
    const currentSize = normalizeFontSize(data.fontSize);
    if (currentSize < MAX_FONT_SIZE) {
      const step = currentSize >= 48 ? 8 : currentSize >= 32 ? 4 : 2;
      mutateNode(
        (d) => {
          d.fontSize = Math.min(currentSize + step, MAX_FONT_SIZE);
        }
      );
      selectGroupNode();
      setTimeout(
        () => pushState(rf.getNodes(), rf.getEdges(), "Increase Font Size"),
        0
      );
    }
  };

  const decreaseFontSize = () => {
    const currentSize = normalizeFontSize(data.fontSize);
    if (currentSize > MIN_FONT_SIZE) {
      const step = currentSize > 48 ? 8 : currentSize > 32 ? 4 : 2;
      mutateNode(
        (d) => {
          d.fontSize = Math.max(currentSize - step, MIN_FONT_SIZE);
        }
      );
      selectGroupNode();
      setTimeout(
        () => pushState(rf.getNodes(), rf.getEdges(), "Decrease Font Size"),
        0
      );
    }
  };

  /* ----------------------------------------------------------------
       Resize handlers
  ---------------------------------------------------------------- */
  const resize = (_evt: unknown, { x, y, width, height }: ResizeParams) => {
    rf.setNodes((nodes) =>
      produce(nodes, (draft) => {
        const node = draft.find((item) => item.id === id);
        if (!node) return;

        const data: CalculationNodeData = {
          ...(node.data as CalculationNodeData | undefined),
        };

        if (typeof width === "number") {
          node.width = width;
          data.width = width;
        }
        if (typeof height === "number") {
          node.height = height;
          data.height = height;
        }

        if (typeof x === "number") {
          node.position.x = x;
        }
        if (typeof y === "number") {
          node.position.y = y;
        }

        node.data = data;
      })
    );
  };

  const endResize = () =>
    setTimeout(
      () => pushState(rf.getNodes(), rf.getEdges(), "Resize Group"),
      0
    );

  /* ----------------------------------------------------------------
       Body interactions – pan canvas with LMB, respect selection mode
  ---------------------------------------------------------------- */
  const bodyPanRef = useRef<{
    startX: number;
    startY: number;
    origin: Viewport;
  } | null>(null);

  const isInteractionTargetEditable = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(
      target.closest(
        "input, textarea, [contenteditable='true'], select, button"
      )
    );
  };

  const isSelectionModeActive = () =>
    typeof document !== "undefined" &&
    document.body.dataset.flowSelectionMode === "true";

  const handleBodyPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (isInteractionTargetEditable(e.target)) return;
      if (isNestedFlowNodeTarget(e.target, e.currentTarget)) return;
      setShowMenu(false);
      setShowTitleControls(false);
      blurActiveEditableElement();
      clearSelectedEdges();

      if (isSelectionModeActive()) {
        // Let the pane create a marquee selection
        e.stopPropagation();
        const pane = document.querySelector(".react-flow__pane");
        if (pane) {
          pane.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
              pointerType: e.pointerType,
              pointerId: e.pointerId,
              clientX: e.clientX,
              clientY: e.clientY,
              button: 0,
              buttons: 1,
            })
          );
        }
        return;
      }

      e.stopPropagation();
      e.preventDefault();
      bodyPanRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origin: rf.getViewport(),
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [blurActiveEditableElement, clearSelectedEdges, rf]
  );

  const handleBodyPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!bodyPanRef.current) return;
      e.preventDefault();
      const { startX, startY, origin } = bodyPanRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const zoom = origin.zoom ?? 1;
      rf.setViewport({
        x: (origin.x ?? 0) + dx,
        y: (origin.y ?? 0) + dy,
        zoom,
      });
    },
    [rf]
  );

  const resetBodyPan = useCallback((e?: React.PointerEvent<HTMLDivElement>) => {
    if (!bodyPanRef.current) return;
    bodyPanRef.current = null;
    if (e) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch (err) {
        void err;
      }
      e.stopPropagation();
    }
  }, []);

  /* ----------------------------------------------------------------
       Menu actions handled by useNodePortalMenu
  ---------------------------------------------------------------- */
  const handleCopyId = useCallback(() => {
    copyId();
    setShowMenu(false);
  }, [copyId]);

  const deleteGroup = useCallback(() => {
    setShowMenu(false);
    // Recursively collect ids of the group and all its descendants
    const all = rf.getNodes() as FlowNode[];
    const toRemove = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of all) {
        if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
          toRemove.add(n.id);
          changed = true;
        }
      }
    }

    rf.setNodes((nds) => nds.filter((n) => !toRemove.has(n.id)));

    rf.setEdges((eds) => {
      if (!eds.length) return eds;
      let removedEdge = false;
      const filtered = eds.filter((edge) => {
        const shouldRemove =
          toRemove.has(edge.source) || toRemove.has(edge.target);
        if (shouldRemove) removedEdge = true;
        return !shouldRemove;
      });
      return removedEdge ? filtered : eds;
    });

    scheduleSnapshot("Node(s) removed", { refresh: true });
  }, [id, rf, scheduleSnapshot]);

  const ungroupGroup = useCallback(() => {
    setShowMenu(false);

    rf.setNodes((nodes) =>
      nodes.map((node) => (node.id === id ? { ...node, selected: true } : node))
    );

    // Defer to ensure selection state is applied before invoking undo-aware action
    requestAnimationFrame(() => {
      ungroupWithUndo();
    });
  }, [id, rf, ungroupWithUndo]);

  /* -------------------------------------------------------------
     Derived layout values
  ------------------------------------------------------------- */
  const w = Number(data.width) || 600;
  const h = Number(data.height) || 360;
  const currentFontSize = normalizeFontSize(data.fontSize);
  const titleForSizing = titleDraft ?? rawTitle;
  const titlePillHeight = Math.round(Math.max(56, currentFontSize + 30));
  const titleControlsVisible = showTitleControls || showMenu;
  const titleControlVisualSize = Math.round(currentFontSize);
  const titleControlButtonSize = Math.round(
    Math.max(28, currentFontSize + 12)
  );
  const titleControlValueWidth = Math.round(
    Math.max(34, currentFontSize * 2.15)
  );
  const titleControlGap = Math.round(Math.max(4, currentFontSize * 0.12));
  const titleControlsWidth = titleControlsVisible
    ? Math.round(
        titleControlButtonSize * 3 +
          titleControlValueWidth +
          titleControlGap * 3 +
          16
      )
    : 0;
  const titlePillWidth = Math.round(
    Math.max(
      TITLE_PILL_MIN_WIDTH,
      titleForSizing.length * currentFontSize * 0.62 +
        56 +
        titleControlsWidth
    )
  );
  const titleTextWidth = Math.max(
    120,
    titlePillWidth - 48 - titleControlsWidth
  );

  const borderStyle = data.borderColor
    ? { borderColor: data.borderColor }
    : undefined;

  return (
    <Card
      className={cn(
        "rounded-lg shadow-md bg-card relative overflow-visible font-mono text-primary",
        selected
          ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
          : ""
      )}
      style={{ width: w, height: h, ...borderStyle }}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        if (isInteractionTargetEditable(event.target)) return;
        if (isNestedFlowNodeTarget(event.target, event.currentTarget)) return;
        selectGroupNode({
          preserveExisting: isAdditiveSelectionEvent(event),
        });
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={MIN_W}
        minHeight={MIN_H}
        lineStyle={{
          border: "1px dashed var(--muted-foreground)",
          pointerEvents: "none",
          zIndex: 6,
        }}
        handleStyle={{
          width: RESIZE_HANDLE_SIZE,
          height: RESIZE_HANDLE_SIZE,
          backgroundColor: "hsl(var(--background))",
          border: "2px solid var(--resizer-handle-color)",
          borderRadius: 6,
          boxShadow: "0 0 0 2px hsl(var(--background))",
          zIndex: 8,
          pointerEvents: "auto",
        }}
        onResize={resize}
        onResizeEnd={endResize}
      />

      {/* Top title pill (drag handle) */}
      <div
        data-drag-handle
        data-testid="group-header"
        className="absolute left-1/2 top-0 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background/95 shadow-sm cursor-grab active:cursor-grabbing"
        style={{
          width: titlePillWidth,
          height: titlePillHeight,
          ...borderStyle,
        }}
        onPointerDownCapture={handleTitlePointerDown}
        onClick={showGroupChrome}
      >
        <div className="flex h-full w-full items-center justify-center gap-2 px-5">
          <div
            data-testid="group-title-area"
            className="flex h-full min-w-0 cursor-text items-center justify-center leading-tight"
            style={{ width: titleTextWidth }}
            onDoubleClick={requestTitleEdit}
          >
            <EditableLabel
              value={rawTitle}
              onCommit={commitTitle}
              onDraftChange={setTitleDraft}
              editSignal={titleEditSignal}
              maxLength={100}
              fontSize={currentFontSize}
              className="group-node-title font-mono text-center text-primary"
            />
          </div>

          {titleControlsVisible && (
            <div
              className="nodrag flex shrink-0 items-center gap-1 border-l border-border pl-2"
              style={{
                columnGap: titleControlGap,
                paddingLeft: Math.max(8, Math.round(currentFontSize * 0.22)),
              }}
              onPointerDownCapture={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <Button
                variant="ghost"
                size="icon"
                onPointerDownCapture={handleHeaderControlPointerDown}
                onClick={decreaseFontSize}
                disabled={currentFontSize <= MIN_FONT_SIZE}
                title="Decrease font size"
                aria-label="Decrease font size"
                className="rounded-full p-0"
                style={{
                  width: titleControlButtonSize,
                  height: titleControlButtonSize,
                }}
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
                  fontSize: currentFontSize,
                  lineHeight: 1,
                }}
              >
                {Math.round(currentFontSize)}
              </span>

              <Button
                variant="ghost"
                size="icon"
                onPointerDownCapture={handleHeaderControlPointerDown}
                onClick={increaseFontSize}
                disabled={currentFontSize >= MAX_FONT_SIZE}
                title="Increase font size"
                aria-label="Increase font size"
                className="rounded-full p-0"
                style={{
                  width: titleControlButtonSize,
                  height: titleControlButtonSize,
                }}
              >
                <Plus
                  className="text-foreground"
                  style={{
                    width: titleControlVisualSize,
                    height: titleControlVisualSize,
                  }}
                />
              </Button>

              <Button
                ref={menuAnchorRef}
                variant="ghost"
                size="icon"
                className="rounded-full p-0"
                style={{
                  width: titleControlButtonSize,
                  height: titleControlButtonSize,
                }}
                onClick={() => setShowMenu((v) => !v)}
                onPointerDownCapture={handleHeaderControlPointerDown}
                aria-label="More"
                title="More"
              >
                <MoreHorizontal
                  className="text-foreground"
                  style={{
                    width: titleControlVisualSize,
                    height: titleControlVisualSize,
                  }}
                />
              </Button>
            </div>
          )}
        </div>
        {data.error && (
          <div
            className="absolute -right-1 -top-1 cursor-default rounded-full bg-background"
            title={data.extendedError || "Group node error"}
          >
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
        )}
      </div>

      {/* Thin 10px invisible border areas act as additional drag handles */}
      <BorderDragHandles
        borderWidth={BORDER_WIDTH}
        cornerGap={RESIZE_HANDLE_SIZE}
      />

      {/* Body content background fill (transparent) */}
      <CardContent
        data-testid="group-body"
        className="absolute inset-0 p-2 overflow-visible nodrag"
        onPointerDownCapture={handleBodyPointerDown}
        onPointerMoveCapture={handleBodyPointerMove}
        onPointerUpCapture={resetBodyPan}
        onPointerCancelCapture={resetBodyPan}
        onPointerLeave={resetBodyPan}
        onClickCapture={(e) => {
          if (e.button === 0) e.stopPropagation();
        }}
      >
        <div className="relative z-10 h-full w-full" data-testid="group-body-content" />
        {data.borderColor && (
          <div
            className="group-fill absolute inset-0 pointer-events-none rounded-lg z-0"
            data-testid="group-fill"
            style={{ backgroundColor: data.borderColor }}
          />
        )}
      </CardContent>

      {/* PORTALED MENU – follows the anchor live while open */}
      {showMenu &&
        menuPosition &&
        createPortal(
          <div
            ref={(node) => {
              menuContainerRef.current = node;
            }}
            className="z-[2147483647] fixed rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              minWidth: MENU_WIDTH,
            }}
            onPointerDownCapture={(e) => e.stopPropagation()}
          >
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={handleCopyId}
            >
              {idCopied ? (
                <>
                  <Check className="h-4 w-4" /> Copied ✓
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy ID
                </>
              )}
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={ungroupGroup}
            >
              <Ungroup className="h-4 w-4" /> Ungroup
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
              onClick={deleteGroup}
            >
              <Trash2 className="h-4 w-4" /> Delete Node
            </button>
          </div>,
          document.body
        )}
    </Card>
  );
}
