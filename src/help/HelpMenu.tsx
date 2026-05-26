// src/help/HelpMenu.tsx
// Right-side help menu shown on help tabs.

import type { ComponentType } from "react";
import { useCallback, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardPaste,
  Copy,
  FileText,
  FileUp,
  Github,
  Globe,
  History,
  Layers3,
  Mail,
  MapPinned,
  Minus,
  Moon,
  Paintbrush,
  Palette,
  PanelLeft,
  Play,
  Plus,
  Redo,
  Save,
  Search,
  Share,
  Share2,
  Square,
  SquareMousePointer,
  SquareSplitVertical,
  Sun,
  Twitter,
  Undo,
  X,
  Youtube,
} from "lucide-react";

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

type HelpMode = "guided" | "guide";
type HelpIcon = ComponentType<{ className?: string }>;

function HelpDiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  );
}

interface Props {
  isOpen: boolean;
  runningDemoId: string | null;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
  onCloseHelpTab?: () => void;
}

type HelpGuideGroup = {
  title: string;
  items: {
    title: string;
    body: string;
    icon: HelpIcon;
  }[];
};
type HelpGuideItem = HelpGuideGroup["items"][number];

const HELP_GUIDE_GROUPS: HelpGuideGroup[] = [
  {
    title: "Workspace",
    items: [
      {
        title: "Sidebar",
        body: "Open or collapse the node library",
        icon: PanelLeft,
      },
      {
        title: "Load",
        body: "Import a saved rawBit JSON flow",
        icon: FileUp,
      },
      {
        title: "Save",
        body: "Download the flow. Hold S for simplified or L for LLM export",
        icon: Save,
      },
      {
        title: "New tab",
        body: "Create another canvas tab",
        icon: Plus,
      },
      {
        title: "Close tab",
        body: "Close a canvas tab when the X appears",
        icon: X,
      },
    ],
  },
  {
    title: "Editing",
    items: [
      {
        title: "Copy",
        body: "Copy selected nodes, groups, and supported links",
        icon: Copy,
      },
      {
        title: "Paste",
        body: "Paste copied canvas content",
        icon: ClipboardPaste,
      },
      {
        title: "Connect",
        body: "Connect two selected nodes or copy compatible inputs",
        icon: Share2,
      },
      {
        title: "Group",
        body: "Wrap selected nodes into a group",
        icon: Square,
      },
      {
        title: "Ungroup",
        body: "Break selected groups back into nodes",
        icon: SquareSplitVertical,
      },
      {
        title: "Undo",
        body: "Step back through canvas changes",
        icon: Undo,
      },
      {
        title: "Redo",
        body: "Replay an undone canvas change",
        icon: Redo,
      },
      {
        title: "History",
        body: "Open the undo and redo history panel",
        icon: History,
      },
    ],
  },
  {
    title: "Canvas view",
    items: [
      {
        title: "Colour palette",
        body: "Apply colors to selected nodes or groups",
        icon: Palette,
      },
      {
        title: "Selection tool",
        body: "Toggle box selection, or hold S while dragging",
        icon: SquareMousePointer,
      },
      {
        title: "Info nodes",
        body: "Show or hide text info nodes",
        icon: FileText,
      },
      {
        title: "Minimap",
        body: "Show or hide the map of the whole canvas",
        icon: MapPinned,
      },
      {
        title: "Search",
        body: "Open the search panel for nodes and labels",
        icon: Search,
      },
    ],
  },
  {
    title: "Sharing",
    items: [
      {
        title: "Share snapshot",
        body: "Create a shareable snapshot link",
        icon: Share,
      },
      {
        title: "Community links",
        body: "Open rawBit links and contact channels",
        icon: Globe,
      },
      {
        title: "GitHub",
        body: "Open the project repository",
        icon: Github,
      },
      {
        title: "X / Twitter",
        body: "Open rawBit social updates",
        icon: Twitter,
      },
      {
        title: "YouTube",
        body: "Open rawBit videos and demos",
        icon: Youtube,
      },
      {
        title: "Discord",
        body: "Join the community chat",
        icon: HelpDiscordIcon,
      },
      {
        title: "Email",
        body: "Contact rawBit by email",
        icon: Mail,
      },
      {
        title: "Help",
        body: "Open this panel and guided demos",
        icon: CircleHelp,
      },
    ],
  },
  {
    title: "Appearance",
    items: [
      {
        title: "Skin",
        body: "Choose the UI skin and canvas edge styling",
        icon: Paintbrush,
      },
      {
        title: "Selected skin",
        body: "Marks the active skin inside the skin menu",
        icon: Check,
      },
      {
        title: "Decrease",
        body: "Lower edge thickness or opacity in the skin menu",
        icon: Minus,
      },
      {
        title: "Increase",
        body: "Raise edge thickness or opacity in the skin menu",
        icon: Plus,
      },
      {
        title: "Light mode",
        body: "Switch to the light theme",
        icon: Sun,
      },
      {
        title: "Dark mode",
        body: "Switch to the dark theme",
        icon: Moon,
      },
    ],
  },
];

export function HelpMenu({
  isOpen,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
  onCloseHelpTab,
}: Props) {
  const { selectedCategory, setSelectedCategory, liveGroups } =
    useHelpMenuState();
  const [activeMode, setActiveMode] = useState<HelpMode>("guided");

  const displayedGroups =
    selectedCategory === ALL_TOPICS
      ? liveGroups
      : liveGroups.filter(({ category }) => category === selectedCategory);

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

      <HelpModeTabs activeMode={activeMode} onChange={setActiveMode} />

      {activeMode === "guided" ? (
        <GuidedHelpView
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          liveGroups={liveGroups}
          displayedGroups={displayedGroups}
          openCategories={openCategories}
          toggleCategory={toggleCategory}
          runningDemoId={runningDemoId}
          onPlayDemo={onPlayDemo}
          onStopDemo={onStopDemo}
        />
      ) : (
        <HelpContentView />
      )}
    </aside>
  );
}

function HelpModeTabs({
  activeMode,
  onChange,
}: {
  activeMode: HelpMode;
  onChange: (mode: HelpMode) => void;
}) {
  return (
    <div className="border-b border-border px-3 py-2">
      <div
        role="group"
        aria-label="Help type"
        className="grid grid-cols-2 gap-1 rounded-md bg-muted/45 p-1"
      >
        <ModeTab
          label="Guided help"
          selected={activeMode === "guided"}
          onClick={() => onChange("guided")}
        />
        <ModeTab
          label="Help"
          selected={activeMode === "guide"}
          onClick={() => onChange("guide")}
        />
      </div>
    </div>
  );
}

function ModeTab({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "h-8 rounded-md border px-2 text-sm font-medium transition-colors",
        selected
          ? "border-border bg-background text-foreground shadow-sm"
          : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function GuidedHelpView({
  selectedCategory,
  setSelectedCategory,
  liveGroups,
  displayedGroups,
  openCategories,
  toggleCategory,
  runningDemoId,
  onPlayDemo,
  onStopDemo,
}: {
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  liveGroups: CategoryGroup[];
  displayedGroups: CategoryGroup[];
  openCategories: Set<string>;
  toggleCategory: (category: string) => void;
  runningDemoId: string | null;
  onPlayDemo: (demo: HelpDemo) => void;
  onStopDemo: () => void;
}) {
  return (
    <>
      <div className="border-b border-border px-4 py-3 text-sm leading-snug text-muted-foreground">
        Step through demos like a compact reference: play, pause, forward, back
      </div>

      <div className="px-4 pt-3">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase text-muted-foreground">
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
    </>
  );
}

function HelpContentView() {
  return (
    <>
      <div className="border-b border-border px-4 py-3 text-sm leading-snug text-muted-foreground">
        A compact overview of the main functions
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-2">
          {HELP_GUIDE_GROUPS.map((group) => (
            <details
              key={group.title}
              open
              className="group border-b border-border/70 pb-2"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm font-medium text-foreground">
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-0 -rotate-90" />
                <span>{group.title}</span>
              </summary>
              <div className="space-y-2 pb-2 pl-6 pt-1">
                {group.items.map((item) => (
                  <OutlineItem
                    key={`${group.title}-${item.title}`}
                    item={item}
                  />
                ))}
              </div>
            </details>
          ))}
        </div>
      </div>
    </>
  );
}

function OutlineItem({ item }: { item: HelpGuideItem }) {
  const Icon = item.icon;
  return (
    <div className="grid grid-cols-[24px_1fr] gap-2.5">
      <div className="mt-0.5 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{item.title}</div>
        <p className="text-sm leading-snug text-muted-foreground">
          {item.body}
        </p>
      </div>
    </div>
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
      aria-pressed={selected}
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
                  <DemoCard
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
        "group rounded-lg border bg-card p-3 transition-colors",
        isRunning
          ? "border-primary/60 ring-1 ring-primary/30"
          : "rounded-md border-border hover:bg-accent/20",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
          <Layers3 className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {demo.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {demo.description}
          </div>
          <div className="mt-2 text-[11px] font-medium uppercase text-primary/75">
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
    <div className="rounded-md border border-dashed bg-card p-4 text-sm leading-snug text-muted-foreground">
      Nothing in this topic yet. Check back soon.
    </div>
  );
}
