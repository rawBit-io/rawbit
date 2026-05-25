// src/help/HelpMenu.tsx
// Right-side guided help menu shown on help tabs.

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
  onCloseHelpTab?: () => void;
}

export function HelpMenu({
  isOpen,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
  onCloseHelpTab,
}: Props) {
  const { selectedCategory, setSelectedCategory, grouped } =
    useHelpMenuState();

  const displayedGroups =
    selectedCategory === ALL_TOPICS
      ? grouped
      : grouped.filter(({ category }) => category === selectedCategory);

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
        isOpen ? "w-72" : "w-0 overflow-hidden",
      )}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/95 px-5 backdrop-blur-md">
        <div className="text-base font-medium leading-tight tracking-tight text-foreground">
          Guided help
        </div>
        <div className="-mr-2 flex items-center gap-1">
          {onCloseHelpTab && (
            <button
              type="button"
              onClick={onCloseHelpTab}
              aria-label="Close help"
              title="Close help"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-border/50 px-4 py-3 text-sm leading-snug text-muted-foreground">
        Play short canvas demos, pause anytime, and step through each action.
      </div>

      <div className="px-4 pt-3">
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
          {grouped.map(({ category, demos }) => (
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
        {displayedGroups.length === 0 ? (
          <Empty />
        ) : (
          displayedGroups.map((group) => (
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
  const hasDemos = group.demos.length > 0;

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
        <div
          className={cn(
            "text-[15px] font-medium",
            hasDemos ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {group.category}
        </div>
        <div className="ml-auto text-[11px] tabular-nums text-muted-foreground">
          {group.demos.length || "soon"}
        </div>
      </button>
      {isOpen &&
        (hasDemos ? (
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
        ) : (
          <div className="rounded-md border border-dashed bg-card px-3 py-2 text-xs leading-snug text-muted-foreground">
            Demos for this topic are coming soon.
          </div>
        ))}
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
      className={cn(
        "group rounded-lg border bg-card p-3 transition-colors",
        isRunning
          ? "border-primary/60 ring-1 ring-primary/30"
          : "border-border hover:border-primary/30",
      )}
    >
      <div className="flex items-start gap-2.5">
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
            "h-7 w-7 shrink-0 rounded-md border bg-transparent shadow-none transition-colors",
            isRunning
              ? "border-primary/55 bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
              : "border-border text-primary/75 hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
          )}
        >
          {isRunning ? (
            <Square className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3 translate-x-px" />
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
