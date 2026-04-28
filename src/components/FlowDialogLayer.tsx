import { ConfirmationDialog } from "@/components/dialog/confirmation-dialog";
import ConnectDialog from "@/components/dialog/ConnectDialog";
import { ShareDialog } from "@/components/dialog/ShareDialog";
import { SoftGateDialog } from "@/components/share/SoftGateDialog";
import type { NodePorts } from "@/components/dialog/ConnectDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resetWorkspaceStorageAndReload } from "@/lib/workspaceReset";
import { ChevronDown, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

interface FlowDialogLayerProps {
  closeDialog: { open: boolean; tabId: string | null };
  tabCount: number;
  onConfirmTabClose: () => void;
  onCancelTabClose: () => void;
  onCloseAllTabs: () => void;
  onCloseOtherTabs: () => void;
  onResetWorkspace?: () => void | Promise<void>;

  showSaveConfirmation: boolean;
  saveConfirmationMessage: string;
  onConfirmSave: () => void;
  onCancelSave: () => void;
  showLlmSaveConfirmation: boolean;
  llmSaveConfirmationMessage: string;
  onConfirmLlmSave: () => void;
  onCancelLlmSave: () => void;

  infoDialog: { open: boolean; message: string };
  closeInfoDialog: () => void;

  connectOpen: boolean;
  setConnectOpen: (open: boolean) => void;
  allPorts: NodePorts[];
  sourcePorts: NodePorts | null;
  targetPorts: NodePorts | null;
  existingEdges: {
    source: string;
    sourceHandle: string | null;
    target: string;
    targetHandle: string | null;
  }[];
  onConnectApply: (
    edges: {
      source: string;
      sourceHandle: string | null;
      target: string;
      targetHandle: string | null;
    }[]
  ) => void;

  shareDialogOpen: boolean;
  shareCreatedId: string | null;
  closeShareDialog: () => void;
  requestShare: () => Promise<{ id: string }>;
  softGateOpen: boolean;
  closeSoftGate: () => void;
  verifyTurnstile: (token?: string) => Promise<{ id: string } | void | undefined>;
}

type CloseTabAction = "current" | "all" | "others" | "reset";

interface CloseTabActionPickerProps {
  selectedAction: CloseTabAction;
  canCloseOtherTabs: boolean;
  onSelectAction: (action: CloseTabAction) => void;
}

const CLOSE_TAB_ACTION_LABELS: Record<CloseTabAction, string> = {
  current: "Close",
  all: "Close all tabs",
  others: "Close other tabs",
  reset: "Reset workspace",
};

const closeActionMenuItemClass =
  "h-8 gap-2 px-2 !text-sm font-medium leading-none";

const closeActionMenuIconClass = "h-3.5 w-3.5 text-muted-foreground";

function CloseTabActionPicker({
  selectedAction,
  canCloseOtherTabs,
  onSelectAction,
}: CloseTabActionPickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          aria-label="Choose close action"
          title="Choose close action"
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 p-1 font-sans text-sm">
        {selectedAction !== "current" && (
          <DropdownMenuItem
            className={closeActionMenuItemClass}
            onSelect={() => onSelectAction("current")}
          >
            <X className={closeActionMenuIconClass} />
            Close this tab
          </DropdownMenuItem>
        )}
        {selectedAction !== "all" && (
          <DropdownMenuItem
            className={closeActionMenuItemClass}
            onSelect={() => onSelectAction("all")}
          >
            <Trash2 className={closeActionMenuIconClass} />
            Close all tabs
          </DropdownMenuItem>
        )}
        {selectedAction !== "others" && (
          <DropdownMenuItem
            className={closeActionMenuItemClass}
            disabled={!canCloseOtherTabs}
            onSelect={() => onSelectAction("others")}
          >
            <Trash2 className={closeActionMenuIconClass} />
            Close other tabs
          </DropdownMenuItem>
        )}
        {selectedAction !== "reset" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={`${closeActionMenuItemClass} text-destructive focus:text-destructive`}
              onSelect={() => onSelectAction("reset")}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset workspace
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FlowDialogLayer({
  closeDialog,
  tabCount,
  onConfirmTabClose,
  onCancelTabClose,
  onCloseAllTabs,
  onCloseOtherTabs,
  onResetWorkspace,
  showSaveConfirmation,
  saveConfirmationMessage,
  onConfirmSave,
  onCancelSave,
  showLlmSaveConfirmation,
  llmSaveConfirmationMessage,
  onConfirmLlmSave,
  onCancelLlmSave,
  infoDialog,
  closeInfoDialog,
  connectOpen,
  setConnectOpen,
  allPorts,
  sourcePorts,
  targetPorts,
  existingEdges,
  onConnectApply,
  shareDialogOpen,
  shareCreatedId,
  closeShareDialog,
  requestShare,
  softGateOpen,
  closeSoftGate,
  verifyTurnstile,
}: FlowDialogLayerProps) {
  const [closeTabAction, setCloseTabAction] =
    useState<CloseTabAction>("current");

  useEffect(() => {
    if (!closeDialog.open) {
      setCloseTabAction("current");
    }
  }, [closeDialog.open]);

  const handleResetWorkspace = () => {
    if (onResetWorkspace) {
      void onResetWorkspace();
      return;
    }
    void resetWorkspaceStorageAndReload();
  };

  const handleConfirmCloseAction = () => {
    if (closeTabAction === "all") {
      onCloseAllTabs();
      return;
    }
    if (closeTabAction === "others") {
      onCloseOtherTabs();
      return;
    }
    if (closeTabAction === "reset") {
      handleResetWorkspace();
      return;
    }
    onConfirmTabClose();
  };

  return (
    <>
      <ConfirmationDialog
        isOpen={closeDialog.open}
        title="Close Tab"
        description="Closing deletes this tab's data. Save it as a file or share link first if you need it."
        confirmText={CLOSE_TAB_ACTION_LABELS[closeTabAction]}
        confirmVariant={closeTabAction === "reset" ? "destructive" : "default"}
        cancelText="Cancel"
        onConfirm={handleConfirmCloseAction}
        onClose={onCancelTabClose}
        footerAction={
          <CloseTabActionPicker
            selectedAction={closeTabAction}
            canCloseOtherTabs={Boolean(closeDialog.tabId) && tabCount > 1}
            onSelectAction={setCloseTabAction}
          />
        }
      />

      <ConfirmationDialog
        isOpen={showSaveConfirmation}
        title="Save Simplified Flow"
        description={saveConfirmationMessage}
        confirmText="Save"
        cancelText="Cancel"
        onConfirm={onConfirmSave}
        onClose={onCancelSave}
      />

      <ConfirmationDialog
        isOpen={showLlmSaveConfirmation}
        title="Save LLM Export"
        description={llmSaveConfirmationMessage}
        confirmText="Save"
        cancelText="Cancel"
        onConfirm={onConfirmLlmSave}
        onClose={onCancelLlmSave}
      />

      <ConfirmationDialog
        isOpen={infoDialog.open}
        title="Information"
        description={infoDialog.message}
        confirmText="OK"
        onConfirm={closeInfoDialog}
        onClose={closeInfoDialog}
      />

      {connectOpen && (
        <ConnectDialog
          open
          allPorts={allPorts}
          onClose={() => setConnectOpen(false)}
          onApply={onConnectApply}
          source={sourcePorts}
          target={targetPorts}
          existingEdges={existingEdges}
        />
      )}

      <ShareDialog
        open={shareDialogOpen}
        createdId={shareCreatedId}
        onClose={closeShareDialog}
        onCreateShare={requestShare}
      />

      <SoftGateDialog
        open={softGateOpen}
        onClose={closeSoftGate}
        onVerified={(token) => verifyTurnstile(token)}
      />
    </>
  );
}
