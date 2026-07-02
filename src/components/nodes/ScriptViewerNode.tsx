/*  src/components/nodes/ScriptViewerNode.tsx
    ---------------------------------------------------------------
    Read-only "Script Viewer" node.

    Connect the hex output of any node (e.g. a redeemScript concat)
    to its single left input; it disassembles the script and renders
    it as indented, human-readable opcodes with the real pushed
    bytes. It has NO output handle and produces no value — a pure
    display / sink node.
    --------------------------------------------------------------- */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NodeProps,
  useReactFlow,
  useStore,
  type Edge,
} from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MoreHorizontal,
  FileCode,
  Copy,
  Check,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowNode } from "@/types";
import { useSnapshotSchedulerContext } from "@/hooks/useSnapshotSchedulerContext";
import { useClipboardLite } from "@/hooks/nodes/useClipboardLite";
import { useDismissNodeMenuOnCanvasPointerDown } from "@/hooks/nodes/useDismissNodeMenuOnCanvasPointerDown";
import { useCanonicalGraph } from "@/contexts/canonical-graph";
import { FieldWithHandle } from "./calculation/fields/FieldWithHandle";
import { parseScriptDisassembly } from "@/lib/scriptDisassembly";
import NodeCodeDialog from "@/components/dialog/NodeCodeDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/** Cap DOM lines for pathologically large inputs (e.g. a whole raw tx). */
const MAX_RENDER_LINES = 2000;

type ConnectedInput = {
  /** True when an edge is wired into input-0, regardless of value. */
  hasEdge: boolean;
  /** Resolved upstream hex, or undefined if the source has no value yet. */
  value: string | undefined;
  error: boolean;
};

const connectedInputsEqual = (a: ConnectedInput, b: ConnectedInput) =>
  a.hasEdge === b.hasEdge && a.value === b.value && a.error === b.error;

export default function ScriptViewerNode({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const { setNodes, setEdges } = useReactFlow<FlowNode>();
  const { scheduleSnapshot } = useSnapshotSchedulerContext();
  const canonicalGraph = useCanonicalGraph();

  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [showCode, setShowCode] = useState(false);
  useDismissNodeMenuOnCanvasPointerDown(nodeMenuOpen, () =>
    setNodeMenuOpen(false)
  );

  /* ---- read the single connected hex value straight from the store ---- */
  const connected = useStore(
    useCallback(
      (state: { edges: Edge[]; nodes: FlowNode[] }): ConnectedInput => {
        const edges = canonicalGraph?.edges ?? state.edges;
        const nodes = canonicalGraph?.nodes ?? state.nodes;
        const edge = edges.find(
          (e) =>
            e.target === id && (e.targetHandle ?? "").startsWith("input-")
        );
        if (!edge) return { hasEdge: false, value: undefined, error: false };
        const source = nodes.find((n) => n.id === edge.source);
        if (!source) return { hasEdge: true, value: undefined, error: false };

        const sourceHandle = edge.sourceHandle ?? "";
        const outputValues = source.data?.outputValues;
        const hasCustomOutput =
          sourceHandle &&
          outputValues &&
          typeof outputValues === "object" &&
          sourceHandle in outputValues;
        const raw = hasCustomOutput
          ? (outputValues as Record<string, unknown>)[sourceHandle]
          : sourceHandle
          ? undefined
          : source.data?.result;

        return {
          hasEdge: true,
          value:
            typeof raw === "string"
              ? raw
              : raw == null
              ? undefined
              : String(raw),
          error: Boolean(source.data?.error),
        };
      },
      [canonicalGraph, id]
    ),
    connectedInputsEqual
  );

  const hasValue = connected.value !== undefined;
  const hex = connected.value ?? "";
  const disasm = useMemo(() => parseScriptDisassembly(hex), [hex]);

  /* ---- comment (parity with sibling nodes) ---- */
  const currentComment = typeof data.comment === "string" ? data.comment : "";
  const [commentDraft, setCommentDraft] = useState(currentComment);
  const [isCommentEditing, setIsCommentEditing] = useState(false);
  const commentEditStartRef = useRef(currentComment);
  useEffect(() => {
    if (!isCommentEditing) setCommentDraft(currentComment);
  }, [currentComment, isCommentEditing]);

  const clip = useClipboardLite({
    result: hex,
    rawTitle: data.title || "Script Viewer",
    id,
  });

  const toggleComment = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, showComment: !n.data.showComment } }
          : n
      )
    );
  }, [id, setNodes]);

  const handleCommentFocus = useCallback((value: string) => {
    setIsCommentEditing(true);
    commentEditStartRef.current = value;
  }, []);

  const commitCommentOnBlur = useCallback(
    (value: string) => {
      const normalizedStart = commentEditStartRef.current.trim();
      const normalizedNext = value.trim();
      setIsCommentEditing(false);
      setCommentDraft(normalizedNext);
      commentEditStartRef.current = normalizedNext;
      if (normalizedStart === normalizedNext) return;
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          const nextData = { ...n.data };
          if (normalizedNext) nextData.comment = normalizedNext;
          else delete nextData.comment;
          return { ...n, data: nextData };
        })
      );
      scheduleSnapshot("Update Node Comment");
    },
    [id, scheduleSnapshot, setNodes]
  );

  // Flush an in-progress comment edit if the node unmounts (off-viewport cull).
  const commentFlushRef = useRef({
    isCommentEditing,
    commentDraft,
    commitCommentOnBlur,
  });
  commentFlushRef.current = {
    isCommentEditing,
    commentDraft,
    commitCommentOnBlur,
  };
  useEffect(
    () => () => {
      const pending = commentFlushRef.current;
      if (pending.isCommentEditing)
        pending.commitCommentOnBlur(pending.commentDraft);
    },
    []
  );

  const deleteNode = useCallback(() => {
    setEdges((eds) => {
      if (!eds.length) return eds;
      let removed = false;
      const filtered = eds.filter((e) => {
        const drop = e.source === id || e.target === id;
        if (drop) removed = true;
        return !drop;
      });
      return removed ? filtered : eds;
    });
    setNodes((nds) => nds.filter((n) => n.id !== id));
    scheduleSnapshot("Node(s) removed", {
      refresh: true,
      coalesceFollowingCalc: true,
    });
  }, [id, scheduleSnapshot, setEdges, setNodes]);

  const highlightStyles =
    data.isHighlighted && !selected
      ? cn(
          "ring-8 ring-yellow-400 ring-offset-4 ring-offset-background",
          "shadow-[0_0_10px_4px_rgba(234,179,8,0.8)]"
        )
      : "";
  const selectedStyles = selected
    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
    : "";

  const shownLines = disasm.lines.slice(0, MAX_RENDER_LINES);
  const hiddenCount = disasm.lines.length - shownLines.length;

  const renderLines = () =>
    shownLines.map((line, idx) => (
      <div
        key={idx}
        style={{ paddingLeft: line.depth * 16 }}
        className="whitespace-pre-wrap break-all"
      >
        <span
          title={line.hex ? `0x${line.hex}` : undefined}
          className={cn(
            line.kind === "push" && "italic text-primary/70",
            line.kind === "unknown" && "font-medium text-destructive",
            line.kind === "opcode" && "text-primary"
          )}
        >
          {line.text}
        </span>
      </div>
    ));

  return (
    <Card
      className={cn(
        "relative flex flex-col border-2 bg-card font-mono text-primary shadow-md transition-all duration-150 ease-in-out",
        selectedStyles,
        highlightStyles,
        data.borderColor ? "!border-3" : "border-border",
        "w-[360px]"
      )}
      style={data.borderColor ? { borderColor: data.borderColor } : {}}
    >
      {/* --- Title bar --- */}
      <div className="calc-node-header flex w-full flex-row items-center gap-2 border-b border-border p-2 text-xl">
        <div className="min-w-0 flex-1 break-words leading-tight">
          {data.title || "Script Viewer"}
        </div>
        <div className="flex shrink-0 items-center space-x-1">
          <DropdownMenu
            modal={false}
            open={nodeMenuOpen}
            onOpenChange={setNodeMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 p-1">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent
                align="end"
                side="right"
                avoidCollisions
                className="origin-top-right z-[100] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                onPointerDown={(e) => e.stopPropagation()}
                onWheelCapture={(e) => e.stopPropagation()}
                style={{ fontSize: "14px", minWidth: "180px" }}
              >
                <DropdownMenuItem onSelect={() => setShowCode(true)}>
                  <FileCode className="mr-1 h-4 w-4" /> Show Code
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => clip.copyId()}>
                  {clip.idCopied ? (
                    <Check className="mr-1 h-4 w-4" />
                  ) : (
                    <Copy className="mr-1 h-4 w-4" />
                  )}
                  Copy ID
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleComment}>
                  <MessageSquare className="mr-1 h-4 w-4" />
                  {data.showComment ? "Hide Comment" : "Show Comment"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => deleteNode()}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Delete Node
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </div>
      </div>

      {/* --- Body --- */}
      <CardContent className="flex flex-grow flex-col gap-2 p-2 text-xs">
        {/* Input: hex + left target handle on the outer perimeter */}
        <FieldWithHandle
          handleId="input-0"
          label="SCRIPT HEX:"
          value={hex}
          connected={connected.hasEdge}
          readOnly
          rows={1}
          autoResizeMaxRows={3}
          handleOffset={-16}
          placeholder="Connect a script-hex output"
        />

        {/* Disassembly header */}
        <div className="font-medium text-primary">
          {">"} Disassembly
          {disasm.ok && disasm.byteLength > 0 && (
            <span className="ml-1 text-muted-foreground">
              ({disasm.lines.length} ops · {disasm.byteLength} bytes)
            </span>
          )}
        </div>

        {/* nodrag + select-text so the disassembly can be selected/copied
            without the node being dragged (xyflow sets user-select:none). */}
        <div className="field-surface nodrag nowheel max-h-[380px] select-text overflow-auto rounded-md border p-2 font-mono text-xs leading-relaxed">
          {!connected.hasEdge ? (
            <div className="italic text-muted-foreground">
              Connect a node that outputs a script (hex).
            </div>
          ) : connected.error ? (
            <>
              <div className="mb-1 font-medium text-destructive">
                ⚠ Upstream node has an error — showing last successful result.
              </div>
              {hasValue && disasm.ok ? (
                renderLines()
              ) : (
                <div className="italic text-muted-foreground">
                  No script to show.
                </div>
              )}
            </>
          ) : !hasValue ? (
            <div className="italic text-muted-foreground">
              Connected — waiting for a script value…
            </div>
          ) : !disasm.ok ? (
            <>
              {disasm.lines.length > 0 && (
                <div className="mb-1">{renderLines()}</div>
              )}
              <div className="font-medium text-destructive">
                ⚠ {disasm.error}
              </div>
              {hex && (
                <div className="mt-1 break-all text-muted-foreground/70">
                  {hex}
                </div>
              )}
            </>
          ) : disasm.lines.length === 0 ? (
            <div className="italic text-muted-foreground">Empty script.</div>
          ) : (
            <>
              {renderLines()}
              {hiddenCount > 0 && (
                <div className="mt-1 italic text-muted-foreground">
                  … {hiddenCount} more line{hiddenCount === 1 ? "" : "s"} (truncated)
                </div>
              )}
              {disasm.warning && (
                <div className="mt-1 font-medium text-amber-600 dark:text-amber-500">
                  ⚠ {disasm.warning}
                </div>
              )}
            </>
          )}
        </div>

        {/* Comment (parity with sibling nodes) */}
        {data.showComment && (
          <div className="mt-1 border-t border-border pt-2">
            <div className="mb-1 text-xs font-medium">Node Comment:</div>
            <textarea
              className="nodrag w-full resize-none rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              rows={3}
              placeholder="Enter your notes here…"
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onFocus={(e) => handleCommentFocus(e.target.value)}
              onBlur={(e) => commitCommentOnBlur(e.target.value)}
              style={{ maxHeight: "120px", overflowY: "auto" }}
            />
          </div>
        )}
      </CardContent>

      <NodeCodeDialog
        open={showCode}
        onClose={() => setShowCode(false)}
        functionName="script_viewer"
      />
    </Card>
  );
}
