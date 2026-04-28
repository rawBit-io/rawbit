// src/components/layout/TopBar.tsx
// -----------------------------------------------------------------------------
// Full version – now includes Search-panel support
// -----------------------------------------------------------------------------

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
  type RefObject,
} from "react";

import {
  Save,
  FileUp,
  Copy,
  ClipboardPaste,
  Moon,
  Sun,
  Undo,
  Redo,
  History,
  X,
  Plus,
  Minus,
  PanelLeft,
  Palette,
  Square,
  SquareSplitVertical,
  SquareMousePointer,
  Share2,
  Search,
  MapPinned,
  Share,
  Globe,
  Github,
  Twitter,
  Mail,
  Network,
  Paintbrush,
  Check,
} from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/hooks/useTheme";
import {
  EDGE_VISIBILITY_STEP,
  type EdgeVisibilityMode,
  type Skin,
} from "@/contexts/theme";
import { cn } from "@/lib/utils";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import type { CalcStatus, CalculationState } from "@/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface TopBarProps {
  isSidebarOpen: boolean;
  onSave: () => void;
  onLoad: () => void;
  onCopy: () => void;
  onPaste: () => void;
  canCopy: boolean;
  hasCopiedNodes: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;

  /** calculation status + errors */
  calcStatus: CalcStatus;
  errorInfo: CalculationState["errorInfo"];
  errorCount: number;
  showErrorPanel: boolean;
  setShowErrorPanel: (v: boolean) => void;
  onRetryAll?: () => void;
  hasLimitErrors?: boolean;

  /* colour palette */
  onToggleColorPalette: (e: MouseEvent) => void;
  isColorPaletteOpen: boolean;
  canColorSelection: boolean;

  /* group / ungroup */
  onGroup?: () => void;
  onUngroup?: () => void;
  canGroupSelectedNodes?: () => boolean;
  canUngroupSelectedNodes?: () => boolean;

  /* connect dialog */
  onConnectClick?: () => void;
  connectDisabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Component-specific extra props                                            */
/* -------------------------------------------------------------------------- */

export type ExtraTopBarProps = {
  onSaveSimplified: () => void | Promise<void>;
  onSaveLlmExport: () => void | Promise<void>;
  onShare?: () => void;
  shareDisabled?: boolean;

  /* Undo / Redo panel */
  showUndoRedoPanel?: boolean;
  setShowUndoRedoPanel?: (open: boolean) => void;

  /* sidebar toggle */
  onToggle: () => void;

  /* tabs */
  tabs?: { id: string; title: string; tooltip?: string }[];
  activeTabId?: string;
  onTabSelect?: (id: string) => void;
  onAddTab?: () => void;
  onCloseTab?: (id: string) => void;
  onRenameTab?: (id: string, title: string) => void;

  /* connect dialog */
  onConnectClick?: () => void;
  connectDisabled?: boolean;

  /* Search panel toggle */
  onSearchClick?: () => void;
  setShowSearchPanel?: (open: boolean) => void;
  showProtocolDiagramPanel?: boolean;
  setShowProtocolDiagramPanel?: (open: boolean) => void;
  hasProtocolDiagram?: boolean;
  protocolDiagramDisabledTooltip?: string;

  /* mini-map toggle */
  showMiniMap?: boolean;
  onToggleMiniMap?: () => void;
  isSelectionModeActive?: boolean;
  onToggleSelectionMode?: () => void;
  tabBarRightInset?: number;
};

type TopBarIconButtonProps = ButtonProps & {
  tooltip: string;
};

const TopBarIconButton = forwardRef<HTMLButtonElement, TopBarIconButtonProps>(
  (
    { tooltip, disabled, className, children, onPointerDown, ...props },
    ref
  ) => {
    const ariaLabel = props["aria-label"] ?? tooltip;
    const button = (
      <Button
        {...props}
        ref={ref}
        disabled={disabled}
        aria-label={ariaLabel}
        title={disabled ? undefined : tooltip}
        className={className}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (event.defaultPrevented) return;
          if (event.pointerType === "mouse" || event.pointerType === "pen" || event.pointerType === "touch") {
            event.preventDefault();
          }
        }}
      >
        {children}
      </Button>
    );

    if (!disabled) {
      return button;
    }

    return (
      <span className="inline-flex" title={tooltip}>
        {button}
      </span>
    );
  }
);
TopBarIconButton.displayName = "TopBarIconButton";

function DiscordIcon({ className }: { className?: string }) {
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

/* -------------------------------------------------------------------------- */
/*  TopBar                                                                    */
/* -------------------------------------------------------------------------- */

export function TopBar(props: TopBarProps & ExtraTopBarProps) {
  const {
    /* layout & IO */
    isSidebarOpen,
    onToggle,
    onSave,
    onSaveSimplified,
    onSaveLlmExport,
    onShare,
    shareDisabled,
    onLoad,
    onCopy,
    onPaste,
    canCopy,
    hasCopiedNodes,
    fileInputRef,
    onFileSelect,

    /* calc banner / errors */
    calcStatus,
    errorCount,
    showErrorPanel,
    setShowErrorPanel,
    onRetryAll,
    hasLimitErrors = false,

    /* colour palette */
    onToggleColorPalette,
    isColorPaletteOpen,
    canColorSelection,

    /* group / ungroup */
    onGroup,
    onUngroup,
    canGroupSelectedNodes,
    canUngroupSelectedNodes,

    /* undo / redo */
    showUndoRedoPanel = false,
    setShowUndoRedoPanel,

    /* tabs */
    tabs = [],
    activeTabId,
    onTabSelect,
    onAddTab,
    onCloseTab,
    onRenameTab,

    /* connect */
    onConnectClick,
    connectDisabled = true,

    /* search panel */
    onSearchClick,
    setShowSearchPanel,
    showProtocolDiagramPanel = false,
    setShowProtocolDiagramPanel,
    hasProtocolDiagram = false,
    protocolDiagramDisabledTooltip = "Add groups to enable diagram view",
    showMiniMap = true,
    onToggleMiniMap,
    isSelectionModeActive = false,
    onToggleSelectionMode,
    tabBarRightInset = 0,
  } = props;

  /* ---------------------------------------------------------------------- */

  const {
    theme,
    setTheme,
    skin,
    setSkin,
    edgeVisibility,
    adjustEdgeVisibility,
  } = useTheme();
  const { undo, redo, canUndo, canRedo } = useUndoRedo();
  const saveSimplifiedHotKeyRef = useRef(false);
  const saveLlmHotKeyRef = useRef(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const skinTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!renamingTabId) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.select();
    });
  }, [renamingTabId]);

  useEffect(() => {
    if (!renamingTabId) return;
    if (!tabs.some((tab) => tab.id === renamingTabId)) {
      setRenamingTabId(null);
      setRenameDraft("");
    }
  }, [tabs, renamingTabId]);

  const beginRename = useCallback(
    (tabId: string, currentTitle: string) => {
      if (!onRenameTab) return;
      setRenamingTabId(tabId);
      setRenameDraft(currentTitle);
    },
    [onRenameTab]
  );

  const commitRename = useCallback(() => {
    if (!renamingTabId || !onRenameTab) {
      setRenamingTabId(null);
      setRenameDraft("");
      renameInputRef.current = null;
      return;
    }
    onRenameTab(renamingTabId, renameDraft);
    setRenamingTabId(null);
    setRenameDraft("");
    renameInputRef.current = null;
  }, [onRenameTab, renamingTabId, renameDraft]);

  const cancelRename = useCallback(() => {
    setRenamingTabId(null);
    setRenameDraft("");
    renameInputRef.current = null;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isKeyS = (event: KeyboardEvent) => event.key?.toLowerCase() === "s";
    const isKeyL = (event: KeyboardEvent) => event.key?.toLowerCase() === "l";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isKeyS(event)) {
        saveSimplifiedHotKeyRef.current = true;
      } else if (isKeyL(event)) {
        saveLlmHotKeyRef.current = true;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isKeyS(event)) {
        saveSimplifiedHotKeyRef.current = false;
      } else if (isKeyL(event)) {
        saveLlmHotKeyRef.current = false;
      }
    };

    const handleWindowBlur = () => {
      saveSimplifiedHotKeyRef.current = false;
      saveLlmHotKeyRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  const handleSaveClick = useCallback(() => {
    if (saveLlmHotKeyRef.current) {
      void onSaveLlmExport();
      return;
    }

    if (saveSimplifiedHotKeyRef.current) {
      void onSaveSimplified();
      return;
    }

    onSave();
  }, [onSave, onSaveSimplified, onSaveLlmExport]);

  /** small banner left of the error-button */
  const statusText = calcStatus === "CALC" ? "calc" : "";
  const showRetryAllButton =
    Boolean(onRetryAll) && calcStatus === "ERROR" && hasLimitErrors;

  const isGroupDisabled = !(canGroupSelectedNodes?.() ?? false);
  const isUngroupDisabled = !(canUngroupSelectedNodes?.() ?? false);
  const activeEdgeVisibilityMode: EdgeVisibilityMode =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";

  /* ---------------------------------------------------------------------- */
  /*  UI                                                                    */
  /* ---------------------------------------------------------------------- */

  return (
    <>
      {/* ===== FIXED TOP BAR ============================================ */}
      <div
        className={cn(
          "fixed top-0 right-0 z-20 flex h-14 items-center border-b border-border bg-background transition-all select-none",
          isSidebarOpen ? "left-64" : "left-0"
        )}
      >
        {/* ---------- LEFT cluster ------------------------------------ */}
        <div className="flex items-center px-2">
          {/* sidebar toggle */}
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onToggle}
            tooltip="Sidebar"
          >
            <PanelLeft
              className={cn(
                "h-7 w-7 transition-transform",
                !isSidebarOpen && "rotate-180"
              )}
            />
          </TopBarIconButton>
          {/* file IO */}
          <Separator orientation="vertical" className="mx-2 h-8 w-px" />
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onLoad}
            tooltip="Load"
          >
            <FileUp className="h-7 w-7" />
          </TopBarIconButton>
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={handleSaveClick}
            tooltip="Save (hold S for simplified)"
            aria-label="Save"
            aria-description="Hold S while clicking to download a simplified export, or hold L to include backend function sources for LLM export"
          >
            <Save className="h-7 w-7" />
          </TopBarIconButton>
          {/* clipboard */}
          <Separator orientation="vertical" className="mx-2 h-8 w-px" />
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onCopy}
            disabled={!canCopy}
            tooltip="Copy nodes (Ctrl/Cmd+C)"
          >
            <Copy className="h-7 w-7" />
          </TopBarIconButton>
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onPaste}
            disabled={!hasCopiedNodes}
            tooltip="Paste nodes (Ctrl/Cmd+V)"
          >
            <ClipboardPaste className="h-7 w-7" />
          </TopBarIconButton>
          {/* connect */}
          <Separator orientation="vertical" className="mx-2 h-8 w-px" />
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onConnectClick}
            disabled={connectDisabled}
            tooltip="Connect nodes / copy inputs (select 2 nodes)"
          >
            <Share2 className="h-7 w-7" />
          </TopBarIconButton>
          {/* group / ungroup */}
          <Separator orientation="vertical" className="mx-2 h-8 w-px" />
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onGroup}
            disabled={isGroupDisabled}
            tooltip="Group"
          >
            <Square className="h-7 w-7" />
          </TopBarIconButton>
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onUngroup}
            disabled={isUngroupDisabled}
            tooltip="Ungroup"
          >
            <SquareSplitVertical className="h-7 w-7" />
          </TopBarIconButton>
          {/* undo / redo / history */}
          <Separator orientation="vertical" className="mx-2 h-8 w-px" />
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={undo}
            disabled={!canUndo}
            tooltip="Undo"
          >
            <Undo className="h-7 w-7" />
          </TopBarIconButton>
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={redo}
            disabled={!canRedo}
            tooltip="Redo"
          >
            <Redo className="h-7 w-7" />
          </TopBarIconButton>
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={() => {
              /* always close the ErrorPanel and SearchPanel when opening History */
              setShowErrorPanel?.(false);
              setShowSearchPanel?.(false);
              setShowProtocolDiagramPanel?.(false);
              setShowUndoRedoPanel?.(!showUndoRedoPanel);
            }}
            tooltip="History"
          >
            <History className="h-7 w-7" />
          </TopBarIconButton>
          {/* colour palette */}
          <Separator orientation="vertical" className="mx-2 h-8 w-px" />
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onToggleColorPalette}
            disabled={!isColorPaletteOpen && !canColorSelection}
            tooltip="Colour palette"
          >
            <Palette className="h-7 w-7" />
          </TopBarIconButton>
          <Separator orientation="vertical" className="mx-2 h-8 w-px" />
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onToggleSelectionMode}
            tooltip="Selection tool (click to toggle or hold S + drag with LMB)"
            aria-pressed={isSelectionModeActive}
            data-active={isSelectionModeActive || undefined}
            className={cn(
              isSelectionModeActive &&
                "bg-secondary text-secondary-foreground hover:bg-secondary"
            )}
          >
            <SquareMousePointer
              className={cn("h-7 w-7", isSelectionModeActive && "text-primary")}
            />
          </TopBarIconButton>
          {/* 🔍 search panel */}
          <Separator orientation="vertical" className="mx-2 h-8 w-px" />
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onToggleMiniMap}
            tooltip={showMiniMap ? "Hide minimap" : "Show minimap"}
          >
            <MapPinned className="h-7 w-7" />
          </TopBarIconButton>
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={() => {
              setShowUndoRedoPanel?.(false);
              setShowErrorPanel?.(false);
              setShowSearchPanel?.(false);
              setShowProtocolDiagramPanel?.(!showProtocolDiagramPanel);
            }}
            disabled={!hasProtocolDiagram}
            tooltip={
              hasProtocolDiagram
                ? showProtocolDiagramPanel
                  ? "Hide flow map"
                  : "Show flow map"
                : protocolDiagramDisabledTooltip
            }
            aria-label="Flow map"
            className={cn(
              showProtocolDiagramPanel &&
                "bg-secondary text-secondary-foreground hover:bg-secondary"
            )}
          >
            <Network className="h-7 w-7" />
          </TopBarIconButton>
          <Separator orientation="vertical" className="mx-2 h-8 w-px" />{" "}
          {/* Search shortcut */}
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={() => {
              setShowUndoRedoPanel?.(false);
              setShowErrorPanel?.(false);
              setShowProtocolDiagramPanel?.(false);
              onSearchClick?.();
            }}
            tooltip="Search nodes"
          >
            <Search className="h-7 w-7" />
          </TopBarIconButton>
        </div>

        {/* ---------- RIGHT cluster ----------------------------------- */}
        <div className="ml-auto flex items-center gap-2 px-3">
          {statusText && (
            <div
              data-testid="calc-status"
              className="rounded border border-border/70 bg-background px-2 py-0.5 text-[0.7rem] font-mono uppercase tracking-[0.3em]"
            >
              {statusText}
            </div>
          )}

          {/* Error badge toggles the ErrorPanel */}
          {showRetryAllButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowUndoRedoPanel?.(false);
                setShowSearchPanel?.(false);
                setShowProtocolDiagramPanel?.(false);
                onRetryAll?.();
              }}
              title="Retry all nodes in this tab"
              className="h-6 px-2 text-xs border border-border"
            >
              retry&nbsp;all
            </Button>
          )}

          {calcStatus === "ERROR" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowUndoRedoPanel?.(false);
                setShowSearchPanel?.(false);
                setShowProtocolDiagramPanel?.(false);
                setShowErrorPanel?.(!showErrorPanel);
              }}
              title="Show errors"
              className={cn(
                "h-6 px-2 text-xs border border-border",
                "text-black dark:text-white"
              )}
            >
              error&nbsp;({errorCount})
            </Button>
          )}

          {/* add tab */}
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onAddTab}
            tooltip="New tab"
          >
            <Plus className="h-6 w-6" />
          </TopBarIconButton>

          <Separator orientation="vertical" className="mx-1 h-6 w-px" />

          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={onShare}
            disabled={shareDisabled}
            tooltip="Share snapshot"
          >
            <Share className="h-7 w-7" />
          </TopBarIconButton>

          {/* community links */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <TopBarIconButton
                variant="ghost"
                size="icon"
                aria-label="Community & Links"
                tooltip="Community & Links"
                className="focus-visible:ring-0 focus-visible:ring-offset-0"
              >
                <Globe className="h-5 w-5" />
              </TopBarIconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom">
              <DropdownMenuItem asChild>
                <a
                  href="https://discord.gg/HPSYkT9tq"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <DiscordIcon className="h-4 w-4" />
                  <span>Discord</span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href="https://github.com/rawBit-io/rawbit"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <Github className="h-4 w-4" />
                  <span>GitHub</span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href="https://x.com/rawBit_io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <Twitter className="h-4 w-4" />
                  <span>X (Twitter)</span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href="mailto:hi@rawbit.io"
                  className="flex items-center gap-2"
                >
                  <Mail className="h-4 w-4" />
                  <span>Email</span>
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="mx-1 h-6 w-px" />

          {/* skin switch */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <TopBarIconButton
                ref={skinTriggerRef}
                variant="ghost"
                size="icon"
                tooltip={`Skin: ${skin}`}
              >
                <Paintbrush className={cn("h-5 w-5 transition-colors", skin !== "shadcn" && "text-primary")} />
              </TopBarIconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="bottom"
              className="w-52 p-1 font-sans text-sm"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                skinTriggerRef.current?.blur();
              }}
            >
              {(
                [
                  ["shadcn", "Shadcn"],
                  ["paper", "Paper Ledger"],
                  ["midnight", "Midnight Signal"],
                ] as const
              ).map(([key, label]) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() => setSkin(key as Skin)}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      skin === key ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span>{label}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <div className="flex h-8 items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm">
                <span className="w-20">Edges</span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label="Decrease edge visibility"
                    title="Decrease edge visibility"
                    className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      adjustEdgeVisibility(
                        activeEdgeVisibilityMode,
                        -EDGE_VISIBILITY_STEP
                      );
                    }}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-7 text-center font-mono text-xs text-muted-foreground">
                    {Math.round(
                      edgeVisibility[activeEdgeVisibilityMode] * 100
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase edge visibility"
                    title="Increase edge visibility"
                    className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      adjustEdgeVisibility(
                        activeEdgeVisibilityMode,
                        EDGE_VISIBILITY_STEP
                      );
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* theme switch */}
          <TopBarIconButton
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            tooltip="Toggle theme"
          >
            <Sun className="h-7 w-7 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-7 w-7 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </TopBarIconButton>
        </div>
      </div>

      {/* hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={onFileSelect}
      />

      {/* TAB BAR (shown whenever tabs exist) */}
      {tabs.length > 0 && (
        <div
          className={cn(
            // ⬇︎  just add this utility class
            "fixed top-14 z-10 h-10 border-b bg-background/80 backdrop-blur-sm select-none transition-[right] duration-300",
            isSidebarOpen ? "left-64" : "left-0"
          )}
          style={{ right: tabBarRightInset }}
        >
          <div className="tab-strip-scroll h-full w-full overflow-x-auto overflow-y-hidden">
            <div className="flex h-full min-w-max items-center px-1">
              <Tabs value={activeTabId} onValueChange={onTabSelect}>
                <TabsList className="h-full gap-0.5 bg-transparent p-0">
                  {tabs.map((t) => {
                    const isRenaming = renamingTabId === t.id;
                    return (
                      <TabsTrigger
                        key={t.id}
                        value={t.id}
                        title={t.tooltip ?? t.title}
                        className="relative group flex h-8 items-center rounded-none px-3 text-sm after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:data-[state=active]:bg-primary"
                        onDoubleClick={(e) => {
                          if (!onRenameTab) return;
                          e.preventDefault();
                          e.stopPropagation();
                          beginRename(t.id, t.title);
                        }}
                      >
                        {isRenaming ? (
                          <input
                            ref={(el) => {
                              if (isRenaming) {
                                renameInputRef.current = el;
                              }
                            }}
                            value={renameDraft}
                            onChange={(event) =>
                              setRenameDraft(event.target.value)
                            }
                            onBlur={commitRename}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                commitRename();
                              } else if (event.key === "Escape") {
                                event.preventDefault();
                                cancelRename();
                              }
                            }}
                            className="w-36 rounded-sm border border-input bg-background px-2 py-0.5 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary"
                          />
                        ) : (
                          <span className="flex-grow truncate text-center max-w-[9rem]">
                            {t.title}
                          </span>
                        )}
                        {onCloseTab && !isRenaming && (
                          <span
                            className="ml-2 cursor-pointer rounded-full p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent data-[state=active]:text-foreground/70"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCloseTab(t.id);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </span>
                        )}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </Tabs>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
