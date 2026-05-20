// src/help/HelpMenu.tsx
// Right-side menu shown on help tabs. Lists demos by category; clicking one
// plays it on the current canvas. A running demo stays highlighted and can
// be stopped from its row.

import { Play, Square } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { HELP_DEMOS } from "./registry";
import type { HelpDemo } from "./types";

interface HelpMenuProps {
  isOpen: boolean;
  /** id of the currently-running demo, if any. */
  runningDemoId: string | null;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
}

export function HelpMenu({
  isOpen,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
}: HelpMenuProps) {
  const grouped = useMemo(() => {
    const byCategory = new Map<string, HelpDemo[]>();
    for (const demo of HELP_DEMOS) {
      const cat = demo.category ?? "Demos";
      const bucket = byCategory.get(cat) ?? [];
      bucket.push(demo);
      byCategory.set(cat, bucket);
    }
    return Array.from(byCategory, ([category, demos]) => ({ category, demos }));
  }, []);

  return (
    <aside
      data-testid="help-menu"
      aria-hidden={!isOpen}
      className={cn(
        "fixed top-14 bottom-0 right-0 z-10 flex select-none flex-col border-l border-border bg-background transition-[width] duration-300",
        isOpen ? "w-72" : "w-0 overflow-hidden"
      )}
    >
      <div className="border-b border-border px-3 py-2">
        <div className="text-sm font-semibold">Help</div>
        <div className="text-xs text-muted-foreground">
          Pick a concept — it plays on this canvas.
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {grouped.map(({ category, demos }) => (
          <div key={category} className="mb-3 last:mb-0">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {category}
            </div>
            <ul className="space-y-1.5">
              {demos.map((demo) => {
                const isRunning = runningDemoId === demo.id;
                return (
                  <li key={demo.id}>
                    <div
                      className={cn(
                        "group rounded-md border bg-card p-2 transition-colors",
                        isRunning
                          ? "border-primary/50 bg-primary/5"
                          : "border-border hover:bg-accent/40"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {demo.title}
                          </div>
                          <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
                            {demo.description}
                          </div>
                        </div>
                        <Button
                          variant={isRunning ? "secondary" : "outline"}
                          size="sm"
                          className="shrink-0"
                          onClick={() =>
                            isRunning ? onStopDemo() : onPlayDemo(demo)
                          }
                          aria-label={isRunning ? "Stop demo" : "Play demo"}
                        >
                          {isRunning ? (
                            <>
                              <Square className="h-3.5 w-3.5" />
                              Stop
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5" />
                              Play
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}
