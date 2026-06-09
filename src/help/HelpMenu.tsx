// src/help/HelpMenu.tsx
// Right-side help panel shown on help tabs. A search-first index with two
// collapsible areas: playable demos and the rawBit functionality reference.

import { useMemo, useState } from "react";
import { ChevronRight, Play, Search, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { useHelpMenuState } from "./helpMenuData";
import {
  HELP_GUIDE_GROUPS,
  type HelpGuideDetail,
  type HelpGuideItem,
} from "./helpGuideData";
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

type HelpSection = {
  id: "demos" | "functionality";
  title: string;
  hits: Hit[];
};

function helpDetailText(detail: HelpGuideDetail): string {
  return typeof detail === "string" ? detail : detail.text;
}

function queryTerms(query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  if (
    trimmed.length > 1 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"')
  ) {
    return [trimmed.slice(1, -1).trim()].filter(Boolean);
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

function includesQuery(haystack: string, query: string): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return false;
  const normalizedHaystack = haystack.toLowerCase();
  return terms.every((term) => normalizedHaystack.includes(term));
}

function hitTitle(hit: Hit): string {
  return hit.kind === "demo" ? hit.demo.title : hit.item.title;
}

function hitBody(hit: Hit): string {
  return hit.kind === "demo" ? hit.demo.description : hit.item.body;
}

function hitDetailText(hit: Hit): string {
  if (hit.kind === "demo") {
    return hit.demo.steps
      .flatMap((step) => [
        step.id,
        step.caption.step,
        step.caption.title,
        step.caption.body,
      ])
      .join(" ");
  }
  return hit.item.moreInfo?.map(helpDetailText).join(" ") ?? "";
}

function hitMatchesDetail(hit: Hit, query: string): boolean {
  return includesQuery(hitDetailText(hit), query);
}

function hitSearchRank(hit: Hit, query: string): number | null {
  if (includesQuery(hitTitle(hit), query)) return 0;
  if (includesQuery(hitBody(hit), query)) return 1;
  if (hitMatchesDetail(hit, query)) return 2;
  if (includesQuery(hit.group, query)) return 3;
  return null;
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
  const [expandedDetailId, setExpandedDetailId] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState({
    demos: true,
    functionality: true,
  });

  const sections = useMemo(() => {
    const demoHits = liveGroups.flatMap((group) =>
      group.demos.map<Hit>((demo) => ({
        kind: "demo",
        demo,
        group: group.category,
      }))
    );
    const refHits = HELP_GUIDE_GROUPS.flatMap((group) =>
      group.items.map<Hit>((item) => ({
        kind: "ref",
        item,
        group: group.title,
      }))
    );
    return [
      { id: "demos", title: "Demos", hits: demoHits },
      { id: "functionality", title: "Functionality", hits: refHits },
    ] satisfies HelpSection[];
  }, [liveGroups]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return sections;
    return sections
      .map((section) => ({
        id: section.id,
        title: section.title,
        hits: section.hits
          .map((hit) => ({ hit, rank: hitSearchRank(hit, q) }))
          .filter(
            (entry): entry is { hit: Hit; rank: number } =>
              entry.rank !== null,
          )
          .sort(
            (a, b) =>
              a.rank - b.rank || hitTitle(a.hit).localeCompare(hitTitle(b.hit)),
          )
          .map((entry) => entry.hit),
      }))
      .filter((section) => section.hits.length > 0);
  }, [sections, query]);

  const toggleSection = (sectionId: HelpSection["id"]) => {
    setOpenSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const handleSearchChange = (value: string) => {
    setQuery(value);
    if (value.trim()) {
      setOpenSections({ demos: true, functionality: true });
    }
  };

  return (
    <aside
      data-testid="help-menu"
      aria-hidden={!isOpen}
      className={cn(
        "fixed bottom-0 right-0 top-14 z-30 flex select-none flex-col border-l border-border bg-background text-foreground transition-[width] duration-300",
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
        <div className="px-3 pb-2 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(event) => handleSearchChange(event.target.value)}
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
        </div>

        <div className="flex-1 overflow-y-auto pb-2 pt-1">
          {filtered.length === 0 ? (
            <div className="mx-3 mt-4 rounded-md border border-dashed bg-card px-3 py-6 text-center text-sm text-muted-foreground">
              No matches for “{query}”.
            </div>
          ) : (
            filtered.map((section) => (
              <div key={section.title} className="mb-1">
                <SectionHeader
                  title={section.title}
                  isOpen={openSections[section.id]}
                  onToggle={() => toggleSection(section.id)}
                />
                {openSections[section.id] && (
                  <ul className="px-1.5">
                    {section.hits.map((hit) => {
                      const rowId =
                        hit.kind === "ref"
                          ? `${hit.group}-${hit.item.title}`
                          : hit.demo.id;
                      const queryDetailMatch =
                        query.trim().length > 0 && hitMatchesDetail(hit, query);

                      return hit.kind === "demo" ? (
                        <li key={hit.demo.id}>
                          <DemoRow
                            demo={hit.demo}
                            isRunning={runningDemoId === hit.demo.id}
                            onPlay={() => onPlayDemo(hit.demo)}
                            onStop={onStopDemo}
                          />
                        </li>
                      ) : (
                        <li key={rowId}>
                          <RefRow
                            item={hit.item}
                            isOpen={
                              expandedDetailId === rowId || queryDetailMatch
                            }
                            onToggle={() =>
                              setExpandedDetailId((prev) =>
                                prev === rowId
                                  ? null
                                  : rowId,
                              )
                            }
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function SectionHeader({
  title,
  isOpen,
  onToggle,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      className="sticky top-0 z-10 flex w-full items-center justify-between bg-background/95 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <span>{title}</span>
      <ChevronRight
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-transform",
          isOpen && "rotate-90",
        )}
        aria-hidden="true"
      />
    </button>
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
        "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
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
        <span className="block text-sm font-medium leading-tight text-foreground">
          {demo.title}
        </span>
        <span className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
          {demo.description}
        </span>
      </span>
      <span className="mt-0.5 shrink-0 text-[10px] font-medium uppercase tabular-nums text-muted-foreground">
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
          "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          hasMore ? "hover:bg-muted/60" : "cursor-default",
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/80 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-tight text-foreground">
            {item.title}
          </span>
          <span className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            {item.body}
          </span>
        </span>
        {hasMore && (
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90",
            )}
            aria-hidden="true"
          />
        )}
      </button>
      {hasMore && isOpen && (
        <div className="mx-2 mb-1.5 mt-1.5 select-text rounded-md border border-border/70 bg-muted/35 px-3 py-2.5">
          <ul className="list-disc space-y-2 pl-4 text-[13px] leading-relaxed text-muted-foreground marker:text-primary/55">
            {item.moreInfo!.map((detail) => {
              const text = typeof detail === "string" ? detail : detail.text;
              const isStrong =
                typeof detail === "object" && detail.strong === true;
              return (
                <li
                  key={text}
                  className={cn(isStrong && "font-semibold text-foreground")}
                >
                  {text}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
