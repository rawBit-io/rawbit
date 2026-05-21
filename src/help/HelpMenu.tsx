// src/help/HelpMenu.tsx
// Right-side menu shown on help tabs.

import { BookOpen, Play, Square } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { HELP_DEMOS } from "./registry";
import type { HelpDemo } from "./types";

const ALL_TOPICS = "all";

const CATEGORY_ORDER = [
  "Canvas basics",
  "Script walkthroughs",
  "Transactions",
  "Keys & signing",
];

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
  runningDemoId: string | null;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
}

interface CategoryGroup {
  category: string;
  demos: HelpDemo[];
}

export function HelpMenu({
  isOpen,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
}: HelpMenuProps) {
  const [selectedCategory, setSelectedCategory] = useState(ALL_TOPICS);

  const grouped = useMemo<CategoryGroup[]>(() => {
    const byCategory = new Map<string, HelpDemo[]>();
    for (const demo of HELP_DEMOS) {
      const category = demo.category ?? "Demos";
      const bucket = byCategory.get(category) ?? [];
      bucket.push(demo);
      byCategory.set(category, bucket);
    }

    const ordered = CATEGORY_ORDER.map((category) => ({
      category,
      demos: byCategory.get(category) ?? [],
    }));

    for (const [category, demos] of byCategory) {
      if (!CATEGORY_ORDER.includes(category)) {
        ordered.push({ category, demos });
      }
    }

    return ordered;
  }, []);

  const liveGroups = useMemo(
    () => grouped.filter(({ demos }) => demos.length > 0),
    [grouped],
  );

  const visibleGroups = useMemo(
    () =>
      selectedCategory === ALL_TOPICS
        ? liveGroups
        : liveGroups.filter(({ category }) => category === selectedCategory),
    [liveGroups, selectedCategory],
  );

  return (
    <aside
      data-testid="help-menu"
      aria-hidden={!isOpen}
      className={cn(
        "fixed bottom-0 right-0 top-14 z-10 flex select-none flex-col border-l border-primary/20 bg-card shadow-2xl shadow-foreground/10 transition-[width] duration-300 dark:border-primary/15 dark:bg-card",
        isOpen ? "w-80" : "w-0 overflow-hidden",
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
        <TopicHeader totalDemos={HELP_DEMOS.length} />
        <TopicTabs
          grouped={liveGroups}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-background/50 px-3 py-3">
        <GroupList
          groups={visibleGroups}
          runningDemoId={runningDemoId}
          onPlayDemo={onPlayDemo}
          onStopDemo={onStopDemo}
        />
      </div>
    </aside>
  );
}

function TopicHeader({ totalDemos }: { totalDemos: number }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Topics
      </div>
      <div className="text-[11px] text-muted-foreground">
        {totalDemos} demos
      </div>
    </div>
  );
}

function TopicTabs({
  grouped,
  selectedCategory,
  onSelectCategory,
}: {
  grouped: CategoryGroup[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="tablist"
      aria-label="Help topics"
    >
      <TopicButton
        label="All"
        count={HELP_DEMOS.length}
        selected={selectedCategory === ALL_TOPICS}
        onClick={() => onSelectCategory(ALL_TOPICS)}
      />
      {grouped.map(({ category, demos }) => (
        <TopicButton
          key={category}
          label={categoryLabel(category)}
          count={demos.length}
          selected={selectedCategory === category}
          onClick={() => onSelectCategory(category)}
        />
      ))}
    </div>
  );
}

function TopicButton({
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
        "inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        selected
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "text-[10px]",
          count === 0 ? "opacity-45" : "opacity-70",
        )}
      >
        {count || "soon"}
      </span>
    </button>
  );
}

function GroupList({
  groups,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
}: {
  groups: CategoryGroup[];
  runningDemoId: string | null;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
}) {
  if (groups.length === 0 || groups.every(({ demos }) => demos.length === 0)) {
    return <EmptyTopic />;
  }

  return (
    <>
      {groups.map(({ category, demos }) => (
        <section key={category} className="mb-4 last:mb-0">
          <GroupHeader category={category} demos={demos} />
          <ul className="space-y-2">
            {demos.map((demo) => {
              const isRunning = runningDemoId === demo.id;
              return (
                <li key={demo.id}>
                  <DemoCard
                    demo={demo}
                    isRunning={isRunning}
                    onClick={() => (isRunning ? onStopDemo() : onPlayDemo(demo))}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

function GroupHeader({
  category,
  demos,
}: {
  category: string;
  demos: HelpDemo[];
}) {
  return (
    <div className="mb-2 px-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {category}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {demos.length || "soon"}
        </div>
      </div>
      <div className="mt-1 text-xs leading-snug text-muted-foreground">
        {categoryDescription(category)}
      </div>
    </div>
  );
}

function DemoCard({
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
        "group rounded-md border bg-card p-3 shadow-sm transition-colors",
        isRunning
          ? "border-primary/60 bg-primary/10 shadow-primary/10"
          : "border-border hover:border-primary/25 hover:bg-card",
      )}
    >
      <div className="flex items-start gap-3">
        <DemoText demo={demo} />
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 shrink-0 rounded-sm border p-0 shadow-none transition-opacity",
            isRunning
              ? "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
              : "border-border/70 bg-transparent text-primary/75 opacity-80 hover:border-primary/30 hover:bg-primary/10 hover:text-primary group-hover:opacity-100",
          )}
          onClick={onClick}
          aria-label={isRunning ? "Stop demo" : "Play demo"}
          title={isRunning ? "Stop demo" : "Play demo"}
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

function DemoText({ demo }: { demo: HelpDemo }) {
  return (
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
  );
}

function EmptyTopic() {
  return (
    <div className="rounded-md border border-dashed bg-card p-4 text-sm leading-snug text-muted-foreground">
      This section is reserved for upcoming rawBit walkthroughs. Existing demos
      stay under Canvas for now.
    </div>
  );
}
