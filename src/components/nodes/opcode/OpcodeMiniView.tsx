import { Button } from "@/components/ui/button";
import { OpItem } from "@/lib/opcodes";
import { X } from "lucide-react";

interface OpcodeMiniViewProps {
  miniSearch: string;
  onMiniSearchChange: (value: string) => void;
  filteredMini: OpItem[];
  selectedOps: OpItem[];
  onAddOp: (item: OpItem) => void;
  onRemoveOp: (index: number) => void;
}

export function OpcodeMiniView({
  miniSearch,
  onMiniSearchChange,
  filteredMini,
  selectedOps,
  onAddOp,
  onRemoveOp,
}: OpcodeMiniViewProps) {
  return (
    <>
      <div>
        <label className="text-xs font-medium text-primary">Search OP</label>
        <input
          className="nodrag w-full rounded border border-input bg-background px-2 py-1 text-xs text-primary placeholder:text-muted-foreground"
          type="text"
          value={miniSearch}
          onChange={(event) => onMiniSearchChange(event.target.value)}
          placeholder="Type to see Opcodes…"
        />
      </div>

      {miniSearch && (
        <div
          className="nodrag h-20 overflow-auto rounded border border-border text-xs"
          onWheelCapture={(event) => event.stopPropagation()}
        >
          {filteredMini.length === 0 ? (
            <div className="p-2 text-center text-muted-foreground italic">
              No match
            </div>
          ) : (
            <div className="p-0">
              {filteredMini.map((op) => (
                <div
                  key={op.name}
                  className="p-1 border-b last:border-b-0 cursor-pointer hover:bg-accent flex justify-between items-center"
                  onClick={() => onAddOp(op)}
                  title={op.description}
                >
                  <span className="font-mono truncate">{op.name}</span>
                  <span className="text-muted-foreground text-[10px]">0x{op.hex}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        className="nodrag h-16 overflow-auto rounded border border-border text-xs"
        onWheelCapture={(event) => event.stopPropagation()}
      >
        {selectedOps.length === 0 ? (
          <div className="p-2 text-center text-muted-foreground italic">
            Sequence empty
          </div>
        ) : (
          <div className="p-0">
            {selectedOps.map((op, index) => (
              <div
                key={`${op.name}-${index}`}
                className="px-1 py-1 pr-3 border-b last:border-b-0 flex items-center justify-between hover:bg-muted/50"
              >
                <span className="font-mono truncate flex-1 mr-1">{op.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 p-0"
                  onClick={() => onRemoveOp(index)}
                >
                  <X className="h-3 w-3" />
                  <span className="sr-only">Remove opcode</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
