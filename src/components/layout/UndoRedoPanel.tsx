// src/components/layout/UndoRedoPanel.tsx
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { cn } from "@/lib/utils";
import { X } from "lucide-react"; // ← new
import type { MouseEvent } from "react";

interface UndoRedoPanelProps {
  isOpen: boolean;
  hasVisibleTabs?: boolean;
  /** Called when the user clicks the × button */
  onClose?: () => void; // ← new optional prop
}

// Heights used for max-height calc
const TOP_BAR_HEIGHT = "3.5rem"; // h-14
const TAB_BAR_HEIGHT = "2.5rem"; // h-10
const HEADER_EST = "2.5rem"; // panel header itself

export function UndoRedoPanel({
  isOpen,
  hasVisibleTabs = false,
  onClose, // ← receive handler
}: UndoRedoPanelProps) {
  const { history, pointer, jumpTo } = useUndoRedo();

  const listMaxH = hasVisibleTabs
    ? `calc(100vh - ${TOP_BAR_HEIGHT} - ${TAB_BAR_HEIGHT} - ${HEADER_EST})`
    : `calc(100vh - ${TOP_BAR_HEIGHT} - ${HEADER_EST})`;

  return (
    <div
      className={cn(
        "fixed top-0 bottom-0 right-0 z-10 flex flex-col select-none",
        "border-l border-border bg-background text-foreground",
        "transition-[width] duration-300",
        isOpen ? "w-64" : "w-0 overflow-hidden"
      )}
      data-testid="undo-redo-panel"
      style={{ pointerEvents: isOpen ? "auto" : "none" }}
    >
      {isOpen && (
        <>
          {/* spacer keeps header below the fixed top bar */}
          <div className="h-14" />

          {/* ───────────────── Panel header + close button ───────────────── */}
          <div
            className={cn(
              "px-2 flex h-auto items-center justify-between border-b py-2",
              hasVisibleTabs ? "h-10" : "mt-3"
            )}
          >
            <h2 className="text-sm font-medium">Undo/Redo Stack</h2>
            <button
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                onClose?.();
              }}
              title="Close panel"
              className="p-1 rounded hover:bg-secondary active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ───────────────── Scrollable list of snapshots ─────────────── */}
          <div
            className="flex-grow px-2 pb-2 overflow-y-auto"
            style={{ maxHeight: listMaxH }}
          >
            {history.length > 0 ? (
              <ul className="space-y-1">
                {history.map((snap, index) => (
                  <li key={index}>
                    <button
                      onClick={() => jumpTo(index)}
                      className={cn(
                        "block w-full text-left p-1 text-sm rounded",
                        index === pointer
                          ? "bg-accent text-accent-foreground font-medium"
                          : "hover:bg-secondary"
                      )}
                    >
                      {index}. {snap.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="italic text-sm text-muted-foreground pt-1">
                No history yet
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
