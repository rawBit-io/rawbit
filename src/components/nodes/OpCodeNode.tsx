/*  src/components/nodes/OpCodeNode.tsx
    ---------------------------------------------------------------
    Refactored to use a single source of truth (node data)
    and eliminate state synchronization issues
    [2025-04-23] – minor perf tweak:
      • ALL_OPS is now a module-level singleton
    --------------------------------------------------------------- */

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { NodeProps, Handle, Position, useReactFlow } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Copy,
  Check,
  MoreHorizontal,
  FileCode,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowNode } from "@/types";
import { useSnapshotSchedulerContext } from "@/hooks/useSnapshotSchedulerContext";
import { useClipboardLite } from "@/hooks/nodes/useClipboardLite";
import { OpcodeMiniView } from "./opcode/OpcodeMiniView";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import NodeCodeDialog from "@/components/dialog/NodeCodeDialog";

import { OP_CODES, OpItem, findOpItemByName } from "@/lib/opcodes";
import {
  buildOpcodeInputState,
  getOpcodeInputNames,
} from "@/lib/opcodeNodeData";

/* ------------------------------------------------------------------ */
/*  ALL_OPS – computed once per module load                           */
/* ------------------------------------------------------------------ */
const ALL_OPS: OpItem[] = (() => {
  const m = new Map<string, OpItem>();
  Object.values(OP_CODES)
    .flat()
    .forEach((op) => {
      if (!m.has(op.name)) m.set(op.name, op);
    });
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
})();

function useOpcodeFilters(miniSearch: string) {
  const filteredMini = useMemo(() => {
    if (!miniSearch) return [];
    const query = miniSearch.toLowerCase();
    return ALL_OPS.filter((op) =>
      [op.name, op.hex, op.description]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [miniSearch]);

  return {
    filteredMini,
  };
}

/* ======================================================================
               COMPONENT
       ====================================================================== */
export default function OpCodeNode({
  id,
  data,
  selected,
}: NodeProps<FlowNode>) {
  const { setNodes, setEdges } = useReactFlow<FlowNode>();
  const { scheduleSnapshot } = useSnapshotSchedulerContext();

  /* ------------ UI state ------------ */
  const [showCode, setShowCode] = useState(false);
  const [miniSearch, setMiniSearch] = useState("");
  const currentComment = typeof data.comment === "string" ? data.comment : "";
  const [commentDraft, setCommentDraft] = useState(currentComment);
  const [isCommentEditing, setIsCommentEditing] = useState(false);
  const commentEditStartRef = useRef(
    currentComment
  );
  const { filteredMini } = useOpcodeFilters(miniSearch);

  useEffect(() => {
    if (!isCommentEditing) {
      setCommentDraft(currentComment);
    }
  }, [currentComment, isCommentEditing]);

  /* ------------ Derive selected opcodes from node data ------------ */
  // Keep display indices aligned with the stored name list: unknown names
  // (e.g. from flows saved with another catalogue version) render as
  // placeholders instead of being filtered out, so removeOp(index) below
  // targets the right entry.
  const selectedOps = useMemo(() => {
    const names = getOpcodeInputNames(data);
    return names.map(
      (name): OpItem =>
        findOpItemByName(name) ?? {
          name,
          hex: "??",
          description: "Unknown opcode (not in catalogue)",
        }
    );
  }, [data]);

  const resultHex = typeof data.result === "string" ? data.result : "";

  /* ====================================================================
                   Node Data Update Functions
       ==================================================================== */

  // Add Opcode directly to node data
  const addOp = useCallback(
    (op: OpItem) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== id) return node;

          const names = [...getOpcodeInputNames(node.data), op.name];
          const restData = { ...node.data };
          delete restData.opSequenceNames;
          delete restData.value;

          return {
            ...node,
            data: {
              ...restData,
              ...buildOpcodeInputState(names),
              result: "",
              dirty: true,
            },
          };
        })
      );

      setMiniSearch("");
    },
    [id, setNodes]
  );

  // Remove Opcode directly from node data
  const removeOp = useCallback(
    (idx: number) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== id) return node;

          const names = getOpcodeInputNames(node.data).filter((_, i) => i !== idx);
          const restData = { ...node.data };
          delete restData.opSequenceNames;
          delete restData.value;

          return {
            ...node,
            data: {
              ...restData,
              ...buildOpcodeInputState(names),
              result: "",
              dirty: true,
            },
          };
        })
      );
    },
    [id, setNodes]
  );

  /* ====================================================================
                   UI Handlers
       ==================================================================== */
  const clip = useClipboardLite({
    result: resultHex,
    rawTitle: data.title || "Opcode Node",
    id,
  });
  const copyHex = useCallback(() => {
    if (!resultHex) return;
    clip.copyResult();
  }, [clip, resultHex]);

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
          if (normalizedNext) {
            nextData.comment = normalizedNext;
          } else {
            delete nextData.comment;
          }
          return { ...n, data: nextData };
        })
      );

      scheduleSnapshot("Update Node Comment");
    },
    [id, scheduleSnapshot, setNodes]
  );

  // onlyRenderVisibleElements unmounts off-viewport nodes without firing
  // blur; flush an in-progress comment edit so typed text isn't lost.
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
      if (pending.isCommentEditing) {
        pending.commitCommentOnBlur(pending.commentDraft);
      }
    },
    []
  );

  const deleteNode = useCallback(() => {
    setEdges((eds) => {
      if (!eds.length) return eds;
      let removedEdge = false;
      const filtered = eds.filter((edge) => {
        const shouldRemove = edge.source === id || edge.target === id;
        if (shouldRemove) removedEdge = true;
        return !shouldRemove;
      });
      return removedEdge ? filtered : eds;
    });

    setNodes((nds) => nds.filter((n) => n.id !== id));

    scheduleSnapshot("Node(s) removed", { refresh: true });
  }, [
    id,
    scheduleSnapshot,
    setEdges,
    setNodes,
  ]);

  /* ====================================================================
                   Render
       ==================================================================== */
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

  return (
    <Card
      className={cn(
        "relative flex flex-col border-2 bg-card font-mono text-primary shadow-md transition-all duration-150 ease-in-out",
        selectedStyles,
        highlightStyles,
        data.borderColor ? "!border-3" : "border-border",
        "w-[280px]"
      )}
      style={data.borderColor ? { borderColor: data.borderColor } : {}}
    >
      {/* --- Title bar -------------------------------------------------- */}

      <div className="calc-node-header flex w-full flex-row items-center gap-2 border-b border-border p-2 text-xl">
        <div className="min-w-0 flex-1 break-words leading-tight">
          {data.title || "Opcode Sequence"}
        </div>
        <div className="flex shrink-0 items-center space-x-1">
          <DropdownMenu modal={false}>
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
                className="origin-top-right z-[100] shadow-md bg-popover text-popover-foreground rounded-md border p-1"
                onPointerDown={(e) => e.stopPropagation()}
                onWheelCapture={(e) => e.stopPropagation()}
                style={{ fontSize: "14px", minWidth: "180px" }}
              >
                <DropdownMenuItem onSelect={() => setShowCode(true)}>
                  <FileCode className="h-4 w-4 mr-1" /> Show Code
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleComment}>
                  <MessageSquare className="h-4 w-4 mr-1" />
                  {data.showComment ? "Hide Comment" : "Show Comment"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    deleteNode();
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Delete Node
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </div>
      </div>

      {/* --- Body ------------------------------------------------------ */}
      <CardContent className="p-2 flex-grow flex flex-col gap-2 text-xs">
        {/* ---------------- MINI VIEW ---------------- */}
        <OpcodeMiniView
          miniSearch={miniSearch}
          onMiniSearchChange={setMiniSearch}
          filteredMini={filteredMini}
          selectedOps={selectedOps}
          onAddOp={addOp}
          onRemoveOp={removeOp}
        />

        {/* ---------------- Final hex ---------------- */}
        <div className="mt-auto pt-2 text-xs">
          <div className="font-medium text-primary mb-1">
            {">"} Calculation Result:
          </div>
          <div className="flex items-center gap-1">
            <div className="font-mono flex-1 text-xs break-all">
              {resultHex ||
                (selectedOps.length > 0
                  ? "Waiting for calculation"
                  : "No Opcodes selected")}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0"
              onClick={copyHex}
              disabled={!resultHex}
              title={clip.resultCopied ? "Copied!" : "Copy"}
            >
              {clip.resultCopied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* ---------------- Comment ---------------- */}
        {data.showComment && (
          <div className="mt-2 border-t border-border pt-2">
            <div className="text-xs font-medium mb-1">Node Comment:</div>
            <textarea
              className="nodrag w-full resize-none rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring text-xs p-2 font-mono"
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

      {/* Handle & code dialog */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-primary !bg-background"
        style={{ top: "50%", transform: "translate(50%, -50%)" }}
      />
      <NodeCodeDialog
        open={showCode}
        onClose={() => setShowCode(false)}
        functionName="op_code_select"
      />
    </Card>
  );
}
