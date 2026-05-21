// src/help/HelpMenu.tsx
// Right-side menu shown on help tabs. It can render as the current/original
// guide plus three alternate structures for future rawBit feature demos.

import {
  BookOpen,
  Boxes,
  CheckCircle2,
  CircleDot,
  Compass,
  FileCode2,
  Library,
  Play,
  Route,
  Square,
  TerminalSquare,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { HELP_MENU_DESIGNS, type HelpMenuDesignId } from "./designs";
import { HELP_DEMOS } from "./registry";
import type { HelpDemo } from "./types";

const ALL_TOPICS = "all";

const CATEGORY_ORDER = [
  "Canvas basics",
  "Script walkthroughs",
  "Transactions",
  "Keys & signing",
];

const categoryMeta: Record<
  string,
  {
    label: string;
    description: string;
    icon: typeof BookOpen;
  }
> = {
  "Canvas basics": {
    label: "Canvas",
    icon: Compass,
    description:
      "Start here: place nodes, connect ports, edit values, and inspect node code.",
  },
  "Script walkthroughs": {
    label: "Scripts",
    icon: FileCode2,
    description:
      "Step through script execution, stack changes, signatures, and failure cases.",
  },
  Transactions: {
    label: "Transactions",
    icon: Boxes,
    description:
      "Build and inspect transaction fields, witnesses, preimages, and signatures.",
  },
  "Keys & signing": {
    label: "Keys",
    icon: CheckCircle2,
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
  design: HelpMenuDesignId;
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
  design,
  onPlayDemo,
  onStopDemo,
}: HelpMenuProps) {
  const [selectedCategory, setSelectedCategory] = useState(ALL_TOPICS);

  const grouped = useMemo<CategoryGroup[]>(() => {
    const byCategory = new Map<string, HelpDemo[]>();
    for (const demo of HELP_DEMOS) {
      const cat = demo.category ?? "Demos";
      const bucket = byCategory.get(cat) ?? [];
      bucket.push(demo);
      byCategory.set(cat, bucket);
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
    [grouped]
  );

  const visibleGroups = useMemo(
    () =>
      selectedCategory === ALL_TOPICS
        ? liveGroups
        : grouped.filter(({ category }) => category === selectedCategory),
    [grouped, liveGroups, selectedCategory]
  );

  const totalDemos = HELP_DEMOS.length;
  const selectedDesign =
    HELP_MENU_DESIGNS.find((option) => option.id === design) ??
    HELP_MENU_DESIGNS[0];

  return (
    <aside
      data-testid="help-menu"
      data-help-design={design}
      aria-hidden={!isOpen}
      className={cn(
        "fixed bottom-0 right-0 top-14 z-10 flex select-none flex-col border-l transition-[width] duration-300",
        design === "original" &&
          "border-primary/20 bg-card shadow-2xl shadow-foreground/10 dark:border-primary/15 dark:bg-card",
        design === "path" &&
          "border-primary/25 bg-background shadow-2xl shadow-primary/10",
        design === "console" &&
          "border-zinc-300 bg-zinc-50 shadow-2xl shadow-zinc-950/10",
        design === "library" &&
          "border-border bg-card shadow-2xl shadow-foreground/10",
        isOpen ? "w-80" : "w-0 overflow-hidden"
      )}
    >
      {design === "original" ? (
        <OriginalHelpMenu
          groups={visibleGroups}
          grouped={liveGroups}
          totalDemos={totalDemos}
          selectedCategory={selectedCategory}
          runningDemoId={runningDemoId}
          onSelectCategory={setSelectedCategory}
          onPlayDemo={onPlayDemo}
          onStopDemo={onStopDemo}
        />
      ) : design === "path" ? (
        <PathHelpMenu
          groups={visibleGroups}
          grouped={grouped}
          totalDemos={totalDemos}
          selectedCategory={selectedCategory}
          selectedDesignLabel={selectedDesign.label}
          runningDemoId={runningDemoId}
          onSelectCategory={setSelectedCategory}
          onPlayDemo={onPlayDemo}
          onStopDemo={onStopDemo}
        />
      ) : design === "console" ? (
        <ConsoleHelpMenu
          groups={visibleGroups}
          grouped={grouped}
          totalDemos={totalDemos}
          selectedCategory={selectedCategory}
          selectedDesignLabel={selectedDesign.label}
          runningDemoId={runningDemoId}
          onSelectCategory={setSelectedCategory}
          onPlayDemo={onPlayDemo}
          onStopDemo={onStopDemo}
        />
      ) : (
        <LibraryHelpMenu
          groups={visibleGroups}
          grouped={grouped}
          totalDemos={totalDemos}
          selectedCategory={selectedCategory}
          selectedDesignLabel={selectedDesign.label}
          runningDemoId={runningDemoId}
          onSelectCategory={setSelectedCategory}
          onPlayDemo={onPlayDemo}
          onStopDemo={onStopDemo}
        />
      )}
    </aside>
  );
}

interface VariantProps {
  groups: CategoryGroup[];
  grouped: CategoryGroup[];
  totalDemos: number;
  selectedCategory: string;
  runningDemoId: string | null;
  onSelectCategory: (category: string) => void;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
  selectedDesignLabel?: string;
}

function OriginalHelpMenu({
  groups,
  grouped,
  totalDemos,
  selectedCategory,
  runningDemoId,
  onSelectCategory,
  onPlayDemo,
  onStopDemo,
}: VariantProps) {
  return (
    <>
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
        <TopicHeader totalDemos={totalDemos} />
        <TopicTabs
          grouped={grouped}
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          variant="original"
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-background/50 px-3 py-3">
        <GroupList
          groups={groups}
          design="original"
          runningDemoId={runningDemoId}
          onPlayDemo={onPlayDemo}
          onStopDemo={onStopDemo}
        />
      </div>
    </>
  );
}

function PathHelpMenu({
  groups,
  grouped,
  totalDemos,
  selectedCategory,
  selectedDesignLabel,
  runningDemoId,
  onSelectCategory,
  onPlayDemo,
  onStopDemo,
}: VariantProps) {
  return (
    <>
      <div className="border-b border-primary/20 bg-background px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Route className="h-4 w-4" aria-hidden="true" />
            {selectedDesignLabel}
          </div>
          <div className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {totalDemos} live
          </div>
        </div>
        <div className="mt-3 text-2xl font-semibold leading-tight text-foreground">
          Guided route through rawBit
        </div>
        <div className="mt-2 text-sm leading-snug text-muted-foreground">
          Pick a topic, run the demo, then step through the canvas action by
          action.
        </div>
      </div>

      <div className="border-b border-border bg-primary/[0.03] px-4 py-3">
        <TopicTabs
          grouped={grouped}
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          variant="path"
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-background px-3 py-3">
        <GroupList
          groups={groups}
          design="path"
          runningDemoId={runningDemoId}
          onPlayDemo={onPlayDemo}
          onStopDemo={onStopDemo}
        />
      </div>
    </>
  );
}

function ConsoleHelpMenu({
  groups,
  grouped,
  totalDemos,
  selectedCategory,
  selectedDesignLabel,
  runningDemoId,
  onSelectCategory,
  onPlayDemo,
  onStopDemo,
}: VariantProps) {
  return (
    <>
      <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-4 text-zinc-50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wide">
            <TerminalSquare className="h-4 w-4" aria-hidden="true" />
            {selectedDesignLabel}
          </div>
          <div className="font-mono text-[11px] text-zinc-400">
            demos:{totalDemos}
          </div>
        </div>
        <div className="mt-3 font-mono text-xl font-semibold leading-tight">
          help.index
        </div>
        <div className="mt-2 text-sm leading-snug text-zinc-300">
          A dense runbook for canvas, scripts, transactions, keys, and future
          rawBit workflows.
        </div>
      </div>

      <div className="border-b border-zinc-300 bg-zinc-100 px-3 py-3">
        <TopicTabs
          grouped={grouped}
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          variant="console"
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-background px-3 py-3">
        <GroupList
          groups={groups}
          design="console"
          runningDemoId={runningDemoId}
          onPlayDemo={onPlayDemo}
          onStopDemo={onStopDemo}
        />
      </div>
    </>
  );
}

function LibraryHelpMenu({
  groups,
  grouped,
  totalDemos,
  selectedCategory,
  selectedDesignLabel,
  runningDemoId,
  onSelectCategory,
  onPlayDemo,
  onStopDemo,
}: VariantProps) {
  return (
    <>
      <div className="border-b border-border bg-card px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Library className="h-4 w-4" aria-hidden="true" />
          {selectedDesignLabel}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
          <div className="text-2xl font-semibold leading-tight text-foreground">
            rawBit demo library
          </div>
          <div className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
            {totalDemos}
          </div>
        </div>
        <div className="mt-2 text-sm leading-snug text-muted-foreground">
          Browse the feature catalog now; add script walkthroughs and deeper
          transaction lessons into the same shelves later.
        </div>
      </div>

      <div className="border-b border-border bg-background px-3 py-3">
        <TopicTabs
          grouped={grouped}
          selectedCategory={selectedCategory}
          onSelectCategory={onSelectCategory}
          variant="library"
        />
      </div>

      <div className="flex-1 overflow-y-auto bg-muted/25 px-3 py-3">
        <GroupList
          groups={groups}
          design="library"
          runningDemoId={runningDemoId}
          onPlayDemo={onPlayDemo}
          onStopDemo={onStopDemo}
        />
      </div>
    </>
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
  variant,
}: {
  grouped: CategoryGroup[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  variant: HelpMenuDesignId;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap",
        variant === "console" ? "gap-1" : "gap-1.5"
      )}
      role="tablist"
      aria-label="Help topics"
    >
      <TopicButton
        label="All"
        count={HELP_DEMOS.length}
        selected={selectedCategory === ALL_TOPICS}
        variant={variant}
        onClick={() => onSelectCategory(ALL_TOPICS)}
      />
      {grouped.map(({ category, demos }) => {
        const meta = categoryMeta[category];
        const Icon = meta?.icon ?? CircleDot;
        return (
          <TopicButton
            key={category}
            label={categoryLabel(category)}
            count={demos.length}
            icon={variant === "path" || variant === "library" ? Icon : undefined}
            selected={selectedCategory === category}
            variant={variant}
            onClick={() => onSelectCategory(category)}
          />
        );
      })}
    </div>
  );
}

function TopicButton({
  label,
  count,
  selected,
  variant,
  icon: Icon,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  variant: HelpMenuDesignId;
  icon?: typeof BookOpen;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1 border text-xs font-medium transition-colors",
        variant === "original" &&
          "rounded-md px-2.5 py-1",
        variant === "original" &&
          (selected
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground"),
        variant === "path" &&
          "rounded-full px-2.5 py-1.5",
        variant === "path" &&
          (selected
            ? "border-primary/55 bg-primary text-primary-foreground"
            : "border-primary/20 bg-background text-foreground hover:bg-primary/10"),
        variant === "console" &&
          "rounded-sm px-2 py-1 font-mono uppercase tracking-wide",
        variant === "console" &&
          (selected
            ? "border-zinc-950 bg-zinc-950 text-zinc-50"
            : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-600 hover:text-zinc-950"),
        variant === "library" &&
          "rounded-md px-2.5 py-1.5",
        variant === "library" &&
          (selected
            ? "border-primary/50 bg-card text-primary shadow-sm"
            : "border-border bg-background text-muted-foreground hover:text-foreground")
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      <span>{label}</span>
      <span
        className={cn(
          "text-[10px]",
          count === 0 ? "opacity-45" : "opacity-70"
        )}
      >
        {count || "soon"}
      </span>
    </button>
  );
}

function GroupList({
  groups,
  design,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
}: {
  groups: CategoryGroup[];
  design: HelpMenuDesignId;
  runningDemoId: string | null;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
}) {
  if (groups.length === 0 || groups.every(({ demos }) => demos.length === 0)) {
    return <EmptyTopic design={design} />;
  }

  return (
    <>
      {groups.map(({ category, demos }) => (
        <section key={category} className="mb-4 last:mb-0">
          <GroupHeader category={category} demos={demos} design={design} />
          <ul
            className={cn(
              design === "console" ? "space-y-1.5" : "space-y-2"
            )}
          >
            {demos.map((demo, index) => {
              const isRunning = runningDemoId === demo.id;
              return (
                <li key={demo.id}>
                  <DemoCard
                    demo={demo}
                    index={index}
                    design={design}
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
  design,
}: {
  category: string;
  demos: HelpDemo[];
  design: HelpMenuDesignId;
}) {
  const meta = categoryMeta[category];
  const Icon = meta?.icon ?? CircleDot;

  return (
    <div
      className={cn(
        "mb-2 px-1",
        design === "path" && "rounded-md border border-primary/15 bg-primary/5 p-2",
        design === "console" && "border-b border-zinc-300 pb-1",
        design === "library" && "rounded-md bg-background p-2"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            "flex items-center gap-1.5 font-semibold uppercase text-muted-foreground",
            design === "console"
              ? "font-mono text-[10px] tracking-widest"
              : "text-[11px] tracking-wide"
          )}
        >
          {design !== "original" && (
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {category}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {demos.length || "soon"}
        </div>
      </div>
      <div
        className={cn(
          "mt-1 text-xs leading-snug text-muted-foreground",
          design === "console" && "font-mono"
        )}
      >
        {categoryDescription(category)}
      </div>
    </div>
  );
}

function DemoCard({
  demo,
  index,
  design,
  isRunning,
  onClick,
}: {
  demo: HelpDemo;
  index: number;
  design: HelpMenuDesignId;
  isRunning: boolean;
  onClick: () => void;
}) {
  if (design === "original") {
    return (
      <div
        className={cn(
          "group rounded-md border bg-card p-3 shadow-sm transition-colors",
          isRunning
            ? "border-primary/60 bg-primary/10 shadow-primary/10"
            : "border-border hover:border-primary/25 hover:bg-card"
        )}
      >
        <div className="flex items-start gap-3">
          <DemoText demo={demo} design={design} />
          <Button
            variant={isRunning ? "secondary" : "outline"}
            size="sm"
            className={cn(
              "h-8 shrink-0 px-2.5",
              !isRunning &&
                "border-primary/30 bg-background text-primary hover:bg-primary/10 hover:text-primary"
            )}
            onClick={onClick}
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
    );
  }

  return (
    <div
      className={cn(
        "group border transition-colors",
        design === "path" &&
          "rounded-lg p-3",
        design === "path" &&
          (isRunning
            ? "border-primary bg-primary/10 shadow-sm shadow-primary/10"
            : "border-primary/20 bg-card hover:border-primary/45 hover:bg-primary/[0.03]"),
        design === "console" &&
          "rounded-sm p-2.5",
        design === "console" &&
          (isRunning
            ? "border-zinc-950 bg-zinc-950 text-zinc-50"
            : "border-zinc-300 bg-white hover:border-zinc-600"),
        design === "library" &&
          "rounded-md bg-card p-3 shadow-sm",
        design === "library" &&
          (isRunning
            ? "border-primary/60 ring-1 ring-primary/20"
            : "border-border hover:border-primary/25")
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center",
            design === "path" &&
              "mt-0.5 h-8 w-8 rounded-full border border-primary/25 bg-primary/10 text-xs font-semibold text-primary",
            design === "console" &&
              "mt-0.5 h-7 w-7 rounded-sm border border-current/20 font-mono text-[11px]",
            design === "library" &&
              "mt-0.5 h-8 w-8 rounded-md border border-border bg-background text-xs font-semibold text-primary"
          )}
        >
          {String(index + 1).padStart(2, "0")}
        </div>
        <DemoText demo={demo} design={design} isRunning={isRunning} />
        <DemoAction design={design} isRunning={isRunning} onClick={onClick} />
      </div>
    </div>
  );
}

function DemoText({
  demo,
  design,
  isRunning,
}: {
  demo: HelpDemo;
  design: HelpMenuDesignId;
  isRunning?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div
        className={cn(
          "text-sm font-semibold leading-tight",
          design === "console" && "font-mono",
          isRunning && design === "console"
            ? "text-zinc-50"
            : "text-foreground"
        )}
      >
        {demo.title}
      </div>
      <div
        className={cn(
          "mt-1 text-xs leading-snug",
          isRunning && design === "console"
            ? "text-zinc-300"
            : "text-muted-foreground"
        )}
      >
        {demo.description}
      </div>
      <div
        className={cn(
          "mt-2 text-[11px] font-medium uppercase tracking-wide",
          design === "console" && "font-mono tracking-widest",
          isRunning && design === "console"
            ? "text-zinc-300"
            : "text-primary/75"
        )}
      >
        {demo.steps.length} steps
      </div>
    </div>
  );
}

function DemoAction({
  design,
  isRunning,
  onClick,
}: {
  design: HelpMenuDesignId;
  isRunning: boolean;
  onClick: () => void;
}) {
  const Icon = isRunning ? Square : Play;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isRunning ? "Stop demo" : "Play demo"}
      title={isRunning ? "Stop demo" : "Play demo"}
      className={cn(
        "flex shrink-0 items-center justify-center transition-colors",
        design === "path" &&
          "h-9 w-9 rounded-full border border-primary/30 bg-background text-primary hover:bg-primary hover:text-primary-foreground",
        design === "console" &&
          "h-8 w-8 rounded-sm border font-mono",
        design === "console" &&
          (isRunning
            ? "border-zinc-200 bg-zinc-50 text-zinc-950 hover:bg-white"
            : "border-zinc-950 bg-zinc-950 text-zinc-50 hover:bg-zinc-800"),
        design === "library" &&
          "h-9 w-9 rounded-md border border-border bg-background text-primary hover:border-primary/40 hover:bg-primary/10"
      )}
    >
      <Icon className={cn(design === "console" ? "h-3.5 w-3.5" : "h-4 w-4")} />
    </button>
  );
}

function EmptyTopic({ design }: { design: HelpMenuDesignId }) {
  return (
    <div
      className={cn(
        "rounded-md border p-4 text-sm leading-snug text-muted-foreground",
        design === "console"
          ? "border-dashed bg-background font-mono"
          : "border-dashed bg-card"
      )}
    >
      This section is reserved for upcoming rawBit walkthroughs. Existing demos
      stay under Canvas for now.
    </div>
  );
}
