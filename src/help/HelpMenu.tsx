// src/help/HelpMenu.tsx
// Right-side menu shown on help tabs. Elevated card design: cards sit on a
// quiet muted background with shadows + hover lift so the list reads like a
// stack of raised cards.

import { BookOpen, Play, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  ALL_TOPICS,
  categoryDescription,
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
}

export function HelpMenu({
  isOpen,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
}: Props) {
  const { selectedCategory, setSelectedCategory, liveGroups, visibleGroups } =
    useHelpMenuState();

  return (
    <aside
      data-testid="help-menu"
      aria-hidden={!isOpen}
      className={cn(
        "fixed bottom-0 right-0 top-14 z-10 flex select-none flex-col border-l border-border bg-muted/30 text-card-foreground transition-[width] duration-300 dark:bg-muted/10",
        isOpen ? "w-80" : "w-0 overflow-hidden",
      )}
    >
      <div className="border-b border-border bg-card px-5 pb-5 pt-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          Guided help
        </div>
        <div className="mt-2 text-2xl font-semibold leading-tight text-foreground">
          Learn rawBit on the canvas
        </div>
        <div className="mt-2 text-sm leading-snug text-muted-foreground">
          Each demo runs live on the canvas. Pause and step through any time.
        </div>
      </div>

      <div className="border-b border-border bg-card/70 px-4 py-3 shadow-sm">
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
  runningDemoId,
  onPlayDemo,
  onStopDemo,
}: {
  group: CategoryGroup;
  runningDemoId: string | null;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2 px-1">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.category}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {group.demos.length || "soon"}
          </div>
        </div>
        <div className="mt-1 text-xs leading-snug text-muted-foreground">
          {categoryDescription(group.category)}
        </div>
      </div>
      <ul className="space-y-3">
        {group.demos.map((demo) => {
          const isRunning = runningDemoId === demo.id;
          return (
            <li key={demo.id}>
              <Card
                demo={demo}
                isRunning={isRunning}
                onClick={() => (isRunning ? onStopDemo() : onPlayDemo(demo))}
              />
            </li>
          );
        })}
      </ul>
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
      className={cn(
        "group rounded-lg border bg-card p-3.5 transition-all",
        isRunning
          ? "border-primary/60 ring-1 ring-primary/30"
          : "border-border hover:-translate-y-1 hover:border-primary/30",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight text-foreground">
            {demo.title}
          </div>
          <div className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
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
