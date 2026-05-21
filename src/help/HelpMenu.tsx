// src/help/HelpMenu.tsx
// Right-side menu shown on help tabs. Elevated card design.
//
// Visual refinements baked in:
//   1. Smaller title  — "Guided help" at text-xl, tighter header padding.
//   3. Bigger group headers — category names read as real section headings.
//   6. Unified body size — header body + card descriptions both text-sm.
//   7. Tighter cards — slimmer padding, single-line description, denser list.

import { ChevronDown, Play, Square, X } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  ALL_TOPICS,
  CATEGORY_ORDER,
  categoryLabel,
  totalDemoCount,
  useHelpMenuState,
  type CategoryGroup,
} from "./helpMenuData";
import { HELP_DEMOS } from "./registry";
import type { HelpDemo } from "./types";

interface Props {
  isOpen: boolean;
  runningDemoId: string | null;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
  /** Closes the help tab (and therefore the menu). */
  onCloseHelpTab?: () => void;
}

export function HelpMenu({
  isOpen,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
  onCloseHelpTab,
}: Props) {
  const { selectedCategory, setSelectedCategory, liveGroups, visibleGroups } =
    useHelpMenuState();

  const [openCategories, setOpenCategories] = useState<Set<string>>(
    () => new Set(CATEGORY_ORDER.slice(0, 1)),
  );
  const toggleCategory = useCallback((category: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  return (
    <aside
      data-testid="help-menu"
      aria-hidden={!isOpen}
      className={cn(
        "fixed bottom-0 right-0 top-14 z-10 flex select-none flex-col border-l border-border bg-background text-foreground transition-[width] duration-300",
        isOpen ? "w-64" : "w-0 overflow-hidden",
      )}
    >
      {/* Title bar — h-10 so its bottom border lines up with the tabbar's,
          and the background matches so it reads as one bar. */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/95 px-5 backdrop-blur-md">
        <div className="text-base font-medium leading-tight tracking-tight text-foreground">
          Guided help
        </div>
        {onCloseHelpTab && (
          <button
            type="button"
            onClick={onCloseHelpTab}
            aria-label="Close help"
            title="Close help"
            className="-mr-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="px-4 pt-4">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Topics</span>
          <span className="tabular-nums">{totalDemoCount} demos</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill
            label="All"
            count={HELP_DEMOS.length}
            selected={selectedCategory === ALL_TOPICS}
            onClick={() => setSelectedCategory(ALL_TOPICS)}
          />
          {liveGroups.map(({ category, demos }) => (
            <Pill
              key={category}
              label={categoryLabel(category)}
              count={demos.length}
              selected={selectedCategory === category}
              onClick={() => setSelectedCategory(category)}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {visibleGroups.length === 0 ? (
          <Empty />
        ) : (
          visibleGroups.map((group) => (
            <Group
              key={group.category}
              group={group}
              isOpen={openCategories.has(group.category)}
              onToggle={() => toggleCategory(group.category)}
              runningDemoId={runningDemoId}
              onPlayDemo={onPlayDemo}
              onStopDemo={onStopDemo}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function Pill({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium shadow-sm transition-all",
        selected
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "tabular-nums text-[10px]",
          count === 0 ? "opacity-45" : "opacity-65",
        )}
      >
        {count || "soon"}
      </span>
    </button>
  );
}

function Group({
  group,
  isOpen,
  onToggle,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
}: {
  group: CategoryGroup;
  isOpen: boolean;
  onToggle: () => void;
  runningDemoId: string | null;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="group/header mb-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent/30"
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            isOpen ? "rotate-0" : "-rotate-90",
          )}
          aria-hidden="true"
        />
        <div className="text-[15px] font-medium text-foreground">
          {group.category}
        </div>
        <div className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {group.demos.length || "soon"}
        </div>
      </button>
      {isOpen && (
        <ul className="space-y-2">
          {group.demos.map((demo) => {
            const isRunning = runningDemoId === demo.id;
            return (
              <li key={demo.id}>
                <Card
                  demo={demo}
                  isRunning={isRunning}
                  onClick={() =>
                    isRunning ? onStopDemo() : onPlayDemo(demo)
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Card({
  demo,
  isRunning,
  onClick,
}: {
  demo: HelpDemo;
  isRunning: boolean;
  onClick: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(
          "application/x-rawbit-help-demo",
          demo.id,
        );
        event.dataTransfer.effectAllowed = "copy";
      }}
      title="Drag onto the canvas to play this demo"
      className={cn(
        "group cursor-grab rounded-lg border bg-card p-3 transition-colors active:cursor-grabbing",
        isRunning
          ? "border-primary/60 ring-1 ring-primary/30"
          : "border-border hover:border-primary/30",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {demo.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {demo.description}
          </div>
          <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-primary/75">
            {demo.steps.length} steps
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClick}
          aria-label={isRunning ? "Stop demo" : "Play demo"}
          title={isRunning ? "Stop demo" : "Play demo"}
          className={cn(
            "h-9 w-9 shrink-0 rounded-full border shadow-sm transition-colors",
            isRunning
              ? "border-primary/55 bg-primary/15 text-primary"
              : "border-border bg-card text-primary/75 hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
          )}
        >
          {isRunning ? (
            <Square className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 translate-x-px" />
          )}
        </Button>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-lg border border-dashed bg-card p-4 text-sm leading-snug text-muted-foreground shadow-sm">
      Nothing in this topic yet. Check back soon.
    </div>
  );
}
