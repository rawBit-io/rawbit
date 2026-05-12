import { FC, useEffect, useMemo, useRef, useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerClose,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeftRight, X } from "lucide-react";
import {
  getDirectionAvailability,
  getOccupiedTargetHandles,
  type ConnectMode,
  type EdgeLike,
  type NodePorts,
  type PortInfo,
} from "@/lib/nodes/connectActions";

export type { EdgeLike, NodePorts, PortInfo };

/* --- helpers --- */
const UN = "__UN__";
const mOut = (h: string) => (h === "" ? UN : h);
const umap = (h: string) => (h === UN ? null : h);

export interface ConnectDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (edges: EdgeLike[]) => void;
  source: NodePorts | null;
  target: NodePorts | null;
  existingEdges: EdgeLike[];

  /* Full list so we can look up labels */
  allPorts?: NodePorts[];
}

/** helper: build a dictionary of (nodeId -> NodePorts) */
function buildMap(all?: NodePorts[]): Record<string, NodePorts> {
  const map: Record<string, NodePorts> = {};
  (all || []).forEach((p) => {
    map[p.id] = p;
  });
  return map;
}

const ConnectDialog: FC<ConnectDialogProps> = ({
  open,
  onClose,
  onApply,
  source,
  target,
  existingEdges,
  allPorts,
}) => {
  /* local states */
  const [mode, setMode] = useState<"connect" | "copy">("connect");
  const [selectedOut, setSelectedOut] = useState<string | null>(null);
  const [targetsChecked, setTargetsChecked] = useState<Record<string, boolean>>(
    {}
  );

  // Checkboxes in copy-inputs table
  const [copySelections, setCopySelections] = useState<Record<string, boolean>>(
    {}
  );

  const lastPairRef = useRef<string | null>(null);
  const initialPairRef = useRef<string | null>(null);

  /* build node map for label lookups */
  const nodeMap = useMemo(() => buildMap(allPorts), [allPorts]);

  const availability = useMemo(() => {
    return getDirectionAvailability(source, target, existingEdges);
  }, [source, target, existingEdges]);
  const reverseAvailability = useMemo(() => {
    return getDirectionAvailability(target, source, existingEdges);
  }, [source, target, existingEdges]);
  const connectOK = availability.canConnectEdge;
  const copyOK = availability.canCopyInputs;
  const copyRows = availability.copyPlan.rows;
  const skipped = availability.copyPlan.skipped;
  const availableModes = availability.availableModes;
  const firstAvailableMode: ConnectMode = copyOK
    ? "copy"
    : connectOK
    ? "connect"
    : "connect";
  const canSwap = reverseAvailability.canDoAnything;

  const availableModeSet = useMemo(
    () => new Set<ConnectMode>(availableModes),
    [availableModes]
  );

  const modeButtonClass = availableModes.length === 1 ? "min-w-36" : "";

  const setVisibleMode = (nextMode: ConnectMode) => {
    if (!availableModeSet.has(nextMode)) return;
    setMode(nextMode);
  };

  useEffect(() => {
    if (!open) return;
    if (mode === "copy" && !copyOK) setMode(firstAvailableMode);
    if (mode === "connect" && !connectOK) setMode(firstAvailableMode);
  }, [open, mode, copyOK, connectOK, firstAvailableMode]);

  useEffect(() => {
    if (!open) return;
    setMode(firstAvailableMode);
    setSelectedOut(null);
    setTargetsChecked({});
  }, [open, source?.id, target?.id, firstAvailableMode]);

  /* preserve checkbox choices instead of resetting them */
  useEffect(() => {
    if (!open) return;
    if (mode !== "copy") return;
    if (!copyOK) return;
    setCopySelections((prev) => {
      const next = { ...prev };
      copyRows.forEach((r) => {
        if (r.id && !(r.id in next)) next[r.id] = true; // default for new rows
      });
      return next;
    });
  }, [open, mode, copyOK, copyRows]);

  /* when source/target swap we re-seed selections */
  useEffect(() => {
    if (!open) {
      lastPairRef.current = null;
      initialPairRef.current = null;
      return;
    }
    if (mode !== "copy" || !source || !target) return;
    const signature = `${source.id}|${target.id}`;
    if (initialPairRef.current === null) {
      initialPairRef.current = signature;
    }
    if (lastPairRef.current === null) {
      lastPairRef.current = signature;
      return;
    }
    if (lastPairRef.current === signature) return;
    lastPairRef.current = signature;

    const seeded: Record<string, boolean> = {};
    copyRows.forEach((row) => {
      if (!row.id) return;
      seeded[row.id] = signature === initialPairRef.current;
    });
    setCopySelections(seeded);
  }, [open, mode, source, target, copyRows]);

  /* helpers for manual connect */
  const takenOnTgt = useMemo(() => {
    return getOccupiedTargetHandles(target, existingEdges);
  }, [existingEdges, target]);

  const toggleTgt = (h: string) =>
    setTargetsChecked((p) => ({ ...p, [h]: !p[h] }));

  /* canApply / doApply */
  const canApply = useMemo(() => {
    if (!source || !target) return false;
    if (mode === "copy") {
      return copyOK && copyRows.some((r) => r.id && copySelections[r.id]);
    }
    return Boolean(
      connectOK &&
        selectedOut &&
        Object.entries(targetsChecked).some(
          ([handleId, checked]) => checked && !takenOnTgt.has(handleId)
        )
    );
  }, [
    source,
    target,
    mode,
    copyOK,
    copyRows,
    copySelections,
    connectOK,
    selectedOut,
    targetsChecked,
    takenOnTgt,
  ]);

  const doApply = () => {
    if (!canApply || !source || !target) return;

    if (mode === "copy") {
      const toCopy = copyRows.filter((r) => r.id && copySelections[r.id]);
      return onApply(toCopy);
    }

    const edges = Object.entries(targetsChecked)
      .filter(([handleId, selected]) => selected && !takenOnTgt.has(handleId))
      .map(([h]) => ({
        source: source.id,
        sourceHandle: umap(selectedOut!),
        target: target.id,
        targetHandle: h,
      }));
    onApply(edges);
  };

  if (!source || !target) return null;

  /* outs for manual connect */
  const outs = source.outputs.map((o) => ({
    ...o,
    handleId: mOut(o.handleId),
  }));

  /* swap – notify parent with empty list */
  const swap = () => onApply([]);

  /* label lookup for copy rows */
  function getSourceLabel(row: EdgeLike): string {
    const n = nodeMap[row.source];
    if (!n) return row.source;
    return n.label; // show node’s friendly name
  }
  function getTargetLabel(row: EdgeLike): string {
    const n = nodeMap[row.target];
    if (!n) return row.targetHandle || "(missing)";
    if (!row.targetHandle) return "(null)";
    const inPort = n.inputs.find((i) => i.handleId === row.targetHandle);
    return inPort ? inPort.label : row.targetHandle; // will show “FAAA” etc.
  }

  /* ----------------------------------- UI ---------------------------------- */
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-w-lg ml-auto">
        <DrawerHeader className="border-b px-4 py-3 flex items-center justify-between">
          <div>
            <DrawerTitle className="text-base">Wiring Studio</DrawerTitle>
            <DrawerDescription className="text-sm text-muted-foreground">
              Duplicate incoming edges from one node to another or create new
              connections manually.
            </DrawerDescription>
          </div>

          <DrawerClose asChild>
            <Button size="icon" variant="ghost">
              <X className="h-5 w-5" />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        {/* mode switch */}
        {availableModes.length > 0 && (
          <div className="flex justify-center gap-2 py-3 border-b">
            {connectOK && (
              <Button
                className={modeButtonClass}
                variant={mode === "connect" ? "default" : "outline"}
                onClick={() => setVisibleMode("connect")}
              >
                Connect Edge
              </Button>
            )}
            {copyOK && (
              <Button
                className={modeButtonClass}
                variant={mode === "copy" ? "default" : "outline"}
                onClick={() => setVisibleMode("copy")}
              >
                Copy Inputs
              </Button>
            )}
          </div>
        )}

        {/* caption + swap */}
        <div className="flex items-center justify-center gap-2 px-4 py-3 border-b">
          <div className="text-sm text-center">
            <strong>Source</strong>
            <br />
            {source.label}
            {source.functionName && (
              <span className="text-xs text-muted-foreground">
                {" "}
                ({source.functionName})
              </span>
            )}
          </div>

          <Button
            size="icon"
            variant="ghost"
            onClick={swap}
            disabled={!canSwap}
            title="Swap source and target"
          >
            <ArrowLeftRight className="h-5 w-5" />
          </Button>

          <div className="text-sm text-center">
            <strong>Target</strong>
            <br />
            {target.label}
            {target.functionName && (
              <span className="text-xs text-muted-foreground">
                {" "}
                ({target.functionName})
              </span>
            )}
          </div>
        </div>

        {/* body */}
        {mode === "connect" && connectOK ? (
          /* --- manual connect UI --- */
          <div className="flex gap-4 px-4 py-4">
            {/* source outs */}
            <ScrollArea className="flex-1 h-64 border rounded">
              <div className="px-4 py-2">
                {outs.map((o) => (
                  <label
                    key={o.handleId}
                    className="flex items-center gap-2 cursor-pointer select-none mb-1"
                  >
                    <Checkbox
                      checked={selectedOut === o.handleId}
                      onCheckedChange={() =>
                        setSelectedOut((p) =>
                          p === o.handleId ? null : o.handleId
                        )
                      }
                    />
                    {o.label}
                  </label>
                ))}
                {outs.length === 0 && (
                  <p className="text-sm text-muted-foreground">(no outputs)</p>
                )}
              </div>
            </ScrollArea>

            {/* target ins */}
            <ScrollArea className="flex-1 h-64 border rounded">
              <div className="px-4 py-2">
                {target.inputs.map((inp) => {
                  const disabled = takenOnTgt.has(inp.handleId);
                  return (
                    <label
                      key={inp.handleId}
                      className={`flex items-center gap-2 select-none mb-1 ${
                        disabled ? "opacity-40 cursor-not-allowed" : ""
                      }`}
                    >
                      <Checkbox
                        disabled={disabled}
                        checked={targetsChecked[inp.handleId] ?? false}
                        onCheckedChange={() => toggleTgt(inp.handleId)}
                      />
                      {inp.label}
                    </label>
                  );
                })}
                {target.inputs.length === 0 && (
                  <p className="text-sm text-muted-foreground">(no inputs)</p>
                )}
              </div>
            </ScrollArea>
          </div>
        ) : mode === "copy" && copyOK ? (
          /* --- copy-inputs table --- */
          <ScrollArea className="h-72 mx-4 my-4 border rounded">
            {copyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">
                No compatible incoming edges to duplicate.
              </p>
            ) : (
              <>
                {skipped > 0 && (
                  <p className="text-xs text-muted-foreground p-2">
                    {skipped} input{skipped === 1 ? " was" : "s were"} omitted
                    (already wired or not present on target)
                  </p>
                )}

                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b">
                      <th className="w-10 py-2" />
                      <th className="w-1/2 text-center font-medium py-2">
                        From Node
                      </th>
                      <th className="w-1/2 text-center font-medium py-2">
                        Copy To {target.label}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {copyRows.map((r) => {
                      const checked = r.id ? copySelections[r.id] : true;
                      return (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="px-2 text-center">
                            <Checkbox
                              checked={!!checked}
                              onCheckedChange={() => {
                                if (!r.id) return;
                                setCopySelections((prev) => ({
                                  ...prev,
                                  [r.id!]: !prev[r.id!],
                                }));
                              }}
                            />
                          </td>
                          <td className="py-1 text-center">
                            {getSourceLabel(r)}
                          </td>
                          <td className="py-1 text-center">
                            {getTargetLabel(r)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </ScrollArea>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No available wiring actions for this direction.
          </div>
        )}

        {/* footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={doApply} disabled={!canApply}>
            Apply
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default ConnectDialog;
