// src/help/HelpMenu.tsx
// Right-side help panel shown on help tabs. A search-first command palette:
// one flat, filterable index of every guided demo (playable) and reference
// entry. Echoes the sidebar's search field and row density so it feels native.

import { useMemo, useState } from "react";
import { ChevronRight, CornerDownLeft, Play, Search, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { useHelpMenuState } from "./helpMenuData";
import { HELP_GUIDE_GROUPS, type HelpGuideItem } from "./helpGuideData";
import type { HelpDemo } from "./types";

interface Props {
  isOpen: boolean;
  runningDemoId: string | null;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
  onCloseHelpTab?: () => void;
}

type Hit =
  | { kind: "demo"; demo: HelpDemo; group: string }
  | { kind: "ref"; item: HelpGuideItem; group: string };

function includesQuery(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.toLowerCase());
}

export function HelpMenu({
  isOpen,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
  onCloseHelpTab,
}: Props) {
  const { liveGroups } = useHelpMenuState();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sections = useMemo(() => {
    const demoSections = liveGroups.map((group) => ({
      title: group.category,
      hits: group.demos.map<Hit>((demo) => ({
        kind: "demo",
        demo,
        group: group.category,
      })),
    }));
    const refSections = HELP_GUIDE_GROUPS.map((group) => ({
      title: group.title,
      hits: group.items.map<Hit>((item) => ({
        kind: "ref",
        item,
        group: group.title,
      })),
    }));
    return [...demoSections, ...refSections];
  }, [liveGroups]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return sections;
    return sections
      .map((section) => ({
        title: section.title,
        hits: section.hits.filter((hit) =>
          hit.kind === "demo"
            ? includesQuery(`${hit.demo.title} ${hit.demo.description}`, q)
            : includesQuery(`${hit.item.title} ${hit.item.body}`, q),
        ),
      }))
      .filter((section) => section.hits.length > 0);
  }, [sections, query]);

  const resultCount = filtered.reduce((sum, s) => sum + s.hits.length, 0);

  return (
    <aside
      data-testid="help-menu"
      aria-hidden={!isOpen}
      className={cn(
        "fixed bottom-0 right-0 top-14 z-10 flex select-none flex-col border-l border-border bg-background text-foreground transition-[width] duration-300",
        isOpen ? "w-72" : "w-0 overflow-hidden",
      )}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4">
        <div className="text-sm font-medium text-foreground">Help</div>
        <div className="-mr-1 flex items-center gap-1">
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

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-3 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search demos & help…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Search help"
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <span className="text-base leading-none">×</span>
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
              Press a row to play or expand
            </span>
            <span className="tabular-nums">{resultCount} results</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="mx-3 mt-4 rounded-md border border-dashed bg-card px-3 py-6 text-center text-sm text-muted-foreground">
              No matches for “{query}”.
            </div>
          ) : (
            filtered.map((section) => (
              <div key={section.title} className="mb-1">
                <div className="sticky top-0 z-10 bg-background/95 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {section.title}
                </div>
                <ul className="px-2">
                  {section.hits.map((hit) =>
                    hit.kind === "demo" ? (
                      <li key={hit.demo.id}>
                        <DemoRow
                          demo={hit.demo}
                          isRunning={runningDemoId === hit.demo.id}
                          onPlay={() => onPlayDemo(hit.demo)}
                          onStop={onStopDemo}
                        />
                      </li>
                    ) : (
                      <li key={`${hit.group}-${hit.item.title}`}>
                        <RefRow
                          item={hit.item}
                          isOpen={expanded === `${hit.group}-${hit.item.title}`}
                          onToggle={() =>
                            setExpanded((prev) =>
                              prev === `${hit.group}-${hit.item.title}`
                                ? null
                                : `${hit.group}-${hit.item.title}`,
                            )
                          }
                        />
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function DemoRow({
  demo,
  isRunning,
  onPlay,
  onStop,
}: {
  demo: HelpDemo;
  isRunning: boolean;
  onPlay: () => void;
  onStop: () => void;
}) {
  return (
    <button
      type="button"
      onClick={isRunning ? onStop : onPlay}
      aria-label={isRunning ? "Stop demo" : "Play demo"}
      className={cn(
        "group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
        isRunning ? "bg-primary/10" : "hover:bg-accent/40",
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors",
          isRunning
            ? "border-primary/55 bg-primary/15 text-primary"
            : "border-border text-primary/80 group-hover:border-primary/40 group-hover:bg-primary/10",
        )}
      >
        {isRunning ? (
          <Square className="h-3 w-3" />
        ) : (
          <Play className="h-3 w-3 translate-x-px" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {demo.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {demo.description}
        </span>
      </span>
      <span className="shrink-0 text-[10px] font-medium uppercase tabular-nums text-muted-foreground">
        {demo.steps.length} steps
      </span>
    </button>
  );
}

function RefRow({
  item,
  isOpen,
  onToggle,
}: {
  item: HelpGuideItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const Icon = item.icon;
  const hasMore = Boolean(item.moreInfo?.length);
  return (
    <div>
      <button
        type="button"
        onClick={hasMore ? onToggle : undefined}
        aria-expanded={hasMore ? isOpen : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
          hasMore ? "hover:bg-accent/40" : "cursor-default",
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {item.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {item.body}
          </span>
        </span>
        {hasMore && (
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90",
            )}
            aria-hidden="true"
          />
        )}
      </button>
      {hasMore && isOpen && (
        <ul className="mb-1 ml-12 space-y-1.5 border-l border-border/70 pl-3 text-xs leading-snug text-muted-foreground">
          {item.moreInfo!.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
