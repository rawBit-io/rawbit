/*  src/components/nodes/OpCodeNode.tsx
    ---------------------------------------------------------------
    Refactored to use a single source of truth (node data)
    and eliminate state synchronization issues
    [2025-04-23] – minor perf tweak:
      • ALL_OPS is now a module-level singleton
    --------------------------------------------------------------- */

import React, {
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
  Maximize2,
  Minimize2,
  MoreHorizontal,
  FileCode,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowNode } from "@/types";
import { useSnapshotSchedulerContext } from "@/hooks/useSnapshotSchedulerContext";
import { useClipboardLite } from "@/hooks/nodes/useClipboardLite";
import {
  OpcodeExpandedView,
  SelectedCategory,
} from "./opcode/OpcodeExpandedView";
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
  const [fullSearch, setFullSearch] = useState("");
  const [category, setCategory] = useState<SelectedCategory>("all");

  const filteredFull = useMemo(() => {
    const query = fullSearch.trim().toLowerCase();
    if (query) {
      return ALL_OPS.filter((op) =>
        [op.name, op.description, op.hex]
          .join(" ")
          .toLowerCase()
          .includes(query)
      );
    }
    if (category !== "all") {
      const categorySet = new Set<string>(OP_CODES[category].map((op) => op.name));
      return ALL_OPS.filter((op) => categorySet.has(op.name));
    }
    return ALL_OPS;
  }, [fullSearch, category]);

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
    fullSearch,
    setFullSearch,
    category,
    setCategory,
    filteredFull,
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
  const { lockEdgeSnapshotSkip, releaseEdgeSnapshotSkip, scheduleSnapshot } =
    useSnapshotSchedulerContext();

  /* ------------ UI state ------------ */
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [miniSearch, setMiniSearch] = useState("");
  const commentEditStartRef = useRef(
    typeof data.comment === "string" ? data.comment : ""
  );
  const {
    fullSearch,
    setFullSearch,
    category,
    setCategory,
    filteredFull,
    filteredMini,
  } = useOpcodeFilters(miniSearch);

  /* ------------ Refs for scroll handling ------------ */
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const opcodeScrollRef = useRef<HTMLDivElement>(null);
  const sequenceScrollRef = useRef<HTMLDivElement>(null);

  /* ------------ Derive selected opcodes from node data ------------ */
  const selectedOps = useMemo(() => {
    const names = Array.isArray(data.opSequenceNames)
      ? data.opSequenceNames
      : [];
    return names.map(findOpItemByName).filter((i): i is OpItem => i !== null);
  }, [data.opSequenceNames]);

  /* ------------ Derive hex value directly from selectedOps ------------ */
  const hex = useMemo(
    () => selectedOps.map((o) => o.hex).join(""),
    [selectedOps]
  );

  /* ====================================================================
                   Node Data Update Functions
       ==================================================================== */

  // Add Opcode directly to node data
  const addOp = useCallback(
    (op: OpItem) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== id) return node;

          const names = Array.isArray(node.data.opSequenceNames)
            ? [...node.data.opSequenceNames, op.name]
            : [op.name];

          return {
            ...node,
            data: {
              ...node.data,
              functionName: "op_code_select",
              paramExtraction: "single_val",
              opSequenceNames: names,
              value:
                names.length > 0
                  ? names
                      .map((n) => {
                        const item = findOpItemByName(n);
                        return item ? item.hex : "";
                      })
                      .join("")
                  : "",
              dirty: true,
            },
          };
        })
      );

      if (!isExpanded) setMiniSearch("");
    },
    [id, setNodes, isExpanded]
  );

  // Remove Opcode directly from node data
  const removeOp = useCallback(
    (idx: number) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== id) return node;

          const names = Array.isArray(node.data.opSequenceNames)
            ? node.data.opSequenceNames.filter((_, i) => i !== idx)
            : [];

          return {
            ...node,
            data: {
              ...node.data,
              functionName: "op_code_select",
              paramExtraction: "single_val",
              opSequenceNames: names,
              value:
                names.length > 0
                  ? names
                      .map((n) => {
                        const item = findOpItemByName(n);
                        return item ? item.hex : "";
                      })
                      .join("")
                  : "",
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
    result: hex,
    rawTitle: data.title || "Opcode Node",
    id,
  });
  const copyHex = useCallback(() => {
    if (!hex) return;
    clip.copyResult();
  }, [clip, hex]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
    if (isExpanded) {
      setFullSearch("");
      setCategory("all");
    } else {
      setMiniSearch("");
    }
  }, [isExpanded, setCategory, setFullSearch, setMiniSearch]);

  const toggleComment = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, showComment: !n.data.showComment } }
          : n
      )
    );
  }, [id, setNodes]);

  const changeComment = useCallback(
    (v: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, comment: v } } : n
        )
      );
    },
    [id, setNodes]
  );

  const handleCommentFocus = useCallback((value: string) => {
    commentEditStartRef.current = value;
  }, []);

  const commitCommentOnBlur = useCallback(
    (value: string) => {
      const normalizedStart = commentEditStartRef.current.trim();
      const normalizedNext = value.trim();
      commentEditStartRef.current = value;

      if (normalizedStart === normalizedNext) return;

      const shouldNormalizeStoredValue =
        value !== normalizedNext || normalizedNext.length === 0;

      if (shouldNormalizeStoredValue) {
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
      }

      scheduleSnapshot("Update Node Comment");
    },
    [id, scheduleSnapshot, setNodes]
  );

  const deleteNode = useCallback(() => {
    lockEdgeSnapshotSkip();
    let removedEdge = false;
    setEdges((eds) => {
      if (!eds.length) {
        releaseEdgeSnapshotSkip();
        return eds;
      }
      const filtered = eds.filter((edge) => {
        const shouldRemove = edge.source === id || edge.target === id;
        if (shouldRemove) removedEdge = true;
        return !shouldRemove;
      });
      if (!removedEdge) {
        releaseEdgeSnapshotSkip();
      }
      return filtered;
    });

    setNodes((nds) => nds.filter((n) => n.id !== id));

    scheduleSnapshot("Node(s) removed", { refresh: true });
  }, [
    id,
    lockEdgeSnapshotSkip,
    releaseEdgeSnapshotSkip,
    scheduleSnapshot,
    setEdges,
    setNodes,
  ]);

  /* Prevent wheel propagation in scroll areas */
  useEffect(() => {
    if (!isExpanded) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    const add = (r: React.RefObject<HTMLDivElement>) => {
      const el = r.current;
      if (!el) return () => {};
      el.addEventListener("wheel", stop, { passive: true });
      return () => el.removeEventListener("wheel", stop);
    };
    const c1 = add(categoryScrollRef);
    const c2 = add(opcodeScrollRef);
    const c3 = add(sequenceScrollRef);
    return () => {
      c1();
      c2();
      c3();
    };
  }, [isExpanded]);

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
        isExpanded ? "w-[350px]" : "w-[280px]"
      )}
      style={data.borderColor ? { borderColor: data.borderColor } : {}}
    >
      {/* --- Title bar -------------------------------------------------- */}

      <div className="flex w-full flex-row items-center gap-2 border-b border-border p-2 text-xl">
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
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-1"
            onClick={toggleExpand}
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* --- Body ------------------------------------------------------ */}
      <CardContent className="p-2 flex-grow flex flex-col gap-2 text-xs">
        {/* ---------------- EXPANDED VIEW ---------------- */}
        {isExpanded && (
          <OpcodeExpandedView
            fullSearch={fullSearch}
            onFullSearchChange={(value) => setFullSearch(value)}
            category={category}
            onCategoryChange={(next) => setCategory(next)}
            filteredOps={filteredFull}
            onAddOp={addOp}
            selectedOps={selectedOps}
            onRemoveOp={removeOp}
            categoryScrollRef={categoryScrollRef}
            opcodeScrollRef={opcodeScrollRef}
            sequenceScrollRef={sequenceScrollRef}
          />
        )}

        {/* ---------------- MINI VIEW ---------------- */}
        {!isExpanded && (
          <OpcodeMiniView
            miniSearch={miniSearch}
            onMiniSearchChange={setMiniSearch}
            filteredMini={filteredMini}
            selectedOps={selectedOps}
            onAddOp={addOp}
            onRemoveOp={removeOp}
          />
        )}

        {/* ---------------- Final hex ---------------- */}
        <div className="mt-auto border-t border-border pt-2 text-xs">
          <div className="font-medium text-primary mb-1">
            {isExpanded ? ">_ Final Hex Output:" : "Final Hex:"}
          </div>
          <div className="flex items-center gap-1">
            <div className="font-mono bg-muted p-1 rounded flex-1 text-xs break-all">
              {hex || "No Opcodes selected"}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0"
              onClick={copyHex}
              disabled={!hex}
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
              value={data.comment || ""}
              onChange={(e) => changeComment(e.target.value)}
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
