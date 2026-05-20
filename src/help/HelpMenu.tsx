// src/help/HelpMenu.tsx
// Right-side menu shown on help tabs. Introduces the guided help path, lists
// demos by category, and lets the user play or stop a demo on the canvas.

import { BookOpen, Play, Square } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { HELP_DEMOS } from "./registry";
import type { HelpDemo } from "./types";

const ALL_TOPICS = "all";

const categoryMeta: Record<string, { label: string; description: string }> = {
  "Canvas basics": {
    label: "Canvas",
    description:
      "Start here: place nodes, connect ports, edit values, and inspect node code.",
  },
  "Script walkthroughs": {
    label: "Scripts",
    description:
      "Step through script execution, stack changes, signatures, and failure cases.",
  },
  Transactions: {
    label: "Transactions",
    description:
      "Build and inspect transaction fields, witnesses, preimages, and signatures.",
  },
  "Keys & signing": {
    label: "Keys",
    description:
      "Understand addresses, key tweaks, signatures, and hardware signing flows.",
  },
};

function categoryLabel(category: string) {
  return categoryMeta[category]?.label ?? category;
}

function categoryDescription(category: string) {
  return (
    categoryMeta[category]?.description ??
    "Focused demos for this part of the rawBit workflow."
  );
}

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
  const [selectedCategory, setSelectedCategory] = useState(ALL_TOPICS);

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

  const visibleGroups = useMemo(
    () =>
      selectedCategory === ALL_TOPICS
        ? grouped
        : grouped.filter(({ category }) => category === selectedCategory),
    [grouped, selectedCategory]
  );

  const totalDemos = HELP_DEMOS.length;

  return (
    <aside
      data-testid="help-menu"
      aria-hidden={!isOpen}
      className={cn(
        "fixed bottom-0 right-0 top-14 z-10 flex select-none flex-col border-l border-primary/20 bg-card shadow-2xl shadow-foreground/10 transition-[width] duration-300",
        "dark:border-primary/15 dark:bg-card",
        isOpen ? "w-80" : "w-0 overflow-hidden"
      )}
    >
      <div className="border-b border-primary/15 bg-primary/5 px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          Guided help
        </div>
        <div className="mt-2 text-2xl font-semibold leading-tight text-foreground">
          Learn rawBit on the canvas
        </div>
        <div className="mt-2 text-sm leading-snug text-muted-foreground">
          New to rawBit? Start here. Demos play directly on the canvas and can
          be paused, stepped, or replayed while you learn the workflow.
        </div>
      </div>

      <div className="border-b border-border bg-background/70 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Topics
          </div>
          <div className="text-[11px] text-muted-foreground">
            {totalDemos} demos
          </div>
        </div>
        <div
          className="flex flex-wrap gap-1.5"
          role="tablist"
          aria-label="Help topics"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === ALL_TOPICS}
            onClick={() => setSelectedCategory(ALL_TOPICS)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              selectedCategory === ALL_TOPICS
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground"
            )}
          >
            All
          </button>
          {grouped.map(({ category, demos }) => (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={selectedCategory === category}
              onClick={() => setSelectedCategory(category)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                selectedCategory === category
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground"
              )}
            >
              {categoryLabel(category)}
              <span className="ml-1 text-[10px] opacity-70">
                {demos.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-background/50 px-3 py-3">
        {visibleGroups.map(({ category, demos }) => (
          <section key={category} className="mb-4 last:mb-0">
            <div className="mb-2 px-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {category}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {demos.length} demos
                </div>
              </div>
              <div className="mt-1 text-xs leading-snug text-muted-foreground">
                {categoryDescription(category)}
              </div>
            </div>
            <ul className="space-y-2">
              {demos.map((demo) => {
                const isRunning = runningDemoId === demo.id;
                return (
                  <li key={demo.id}>
                    <div
                      className={cn(
                        "group rounded-md border bg-card p-3 shadow-sm transition-colors",
                        isRunning
                          ? "border-primary/60 bg-primary/10 shadow-primary/10"
                          : "border-border hover:border-primary/25 hover:bg-card"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold leading-tight text-foreground">
                            {demo.title}
                          </div>
                          <div className="mt-1 text-xs leading-snug text-muted-foreground">
                            {demo.description}
                          </div>
                          <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-primary/75">
                            {demo.steps.length} steps
                          </div>
                        </div>
                        <Button
                          variant={isRunning ? "secondary" : "outline"}
                          size="sm"
                          className={cn(
                            "h-8 shrink-0 px-2.5",
                            !isRunning &&
                              "border-primary/30 bg-background text-primary hover:bg-primary/10 hover:text-primary"
                          )}
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
          </section>
        ))}
      </div>
    </aside>
  );
}
