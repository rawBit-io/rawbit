import { RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { OpItem, OpCodeCategories, categoryNames } from "@/lib/opcodes";

export type SelectedCategory = OpCodeCategories | "all";

interface OpcodeExpandedViewProps {
  fullSearch: string;
  onFullSearchChange: (value: string) => void;
  category: SelectedCategory;
  onCategoryChange: (category: SelectedCategory) => void;
  filteredOps: OpItem[];
  onAddOp: (op: OpItem) => void;
  selectedOps: OpItem[];
  onRemoveOp: (index: number) => void;
  categoryScrollRef: RefObject<HTMLDivElement>;
  opcodeScrollRef: RefObject<HTMLDivElement>;
  sequenceScrollRef: RefObject<HTMLDivElement>;
}

export function OpcodeExpandedView({
  fullSearch,
  onFullSearchChange,
  category,
  onCategoryChange,
  filteredOps,
  onAddOp,
  selectedOps,
  onRemoveOp,
  categoryScrollRef,
  opcodeScrollRef,
  sequenceScrollRef,
}: OpcodeExpandedViewProps) {
  return (
    <div className="flex flex-col gap-4 text-sm text-primary">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-8 text-xs nodrag text-primary placeholder:text-muted-foreground"
          placeholder="Search all Opcodes..."
          value={fullSearch}
          onChange={(event) => onFullSearchChange(event.target.value)}
        />
      </div>

      <div>
        <label className="text-sm font-medium">
          Filter by Category {fullSearch && "(applied after search)"}
        </label>
        <ScrollArea
          className="h-24 rounded-md border border-border nodrag"
          ref={categoryScrollRef}
        >
          <div className="p-1">
            <button
              className={cn(
                "w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent",
                category === "all" && "bg-accent font-semibold"
              )}
              onClick={() => onCategoryChange("all")}
            >
              All
            </button>
            <div className="mx-2 my-1 h-px bg-border" />
            {Object.entries(categoryNames).map(([key, name]) => (
              <button
                key={key}
                className={cn(
                  "w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent",
                  category === key && "bg-accent font-semibold"
                )}
                onClick={() => onCategoryChange(key as OpCodeCategories)}
              >
                {name}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div>
        <label className="text-sm font-medium">
          Opcodes List (click to add)
        </label>
        <div
          className="h-32 overflow-auto rounded-md border border-border nodrag"
          ref={opcodeScrollRef}
        >
          <div className="p-1">
            {filteredOps.length === 0 ? (
              <div className="p-3 text-center text-muted-foreground italic text-xs">
                No matching Opcodes found.
              </div>
            ) : (
              filteredOps.map((op) => (
                <div
                  key={op.name}
                  className="p-1.5 border-b last:border-b-0 cursor-pointer hover:bg-accent rounded-sm flex items-center text-xs"
                  onClick={() => onAddOp(op)}
                  title={`${op.name} – ${op.description}`}
                >
                  <div className="flex-grow mr-2">
                    <div className="font-mono font-semibold">{op.name}</div>
                    <div className="text-muted-foreground text-[11px]">
                      {op.description}
                    </div>
                  </div>
                  <div className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded shrink-0">
                    0x{op.hex}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-2">
        <label className="text-sm font-medium">
          Selected Sequence (click X)
        </label>
        <div
          className="h-28 overflow-auto rounded-md border border-border nodrag"
          ref={sequenceScrollRef}
        >
          {selectedOps.length === 0 ? (
            <div className="p-3 text-center text-muted-foreground italic text-xs">
              Sequence empty
            </div>
          ) : (
            <div className="p-1">
              {selectedOps.map((op, index) => (
                <div
                  key={`${index}-${op.name}`}
                  className="p-1 pr-3 border-b last:border-b-0 flex items-center justify-between text-xs hover:bg-muted/50"
                >
                  <div className="flex items-center gap-1.5 flex-grow mr-2 overflow-hidden">
                    <span className="text-muted-foreground w-4 text-right shrink-0 text-[11px]">
                      {index + 1}.
                    </span>
                    <span
                      className="font-mono font-semibold truncate text-[11px]"
                      title={op.name}
                    >
                      {op.name}
                    </span>
                    <span className="font-mono text-muted-foreground shrink-0 text-[11px]">
                      (0x{op.hex})
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => onRemoveOp(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
