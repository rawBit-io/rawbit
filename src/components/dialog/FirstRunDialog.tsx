import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ExampleFlowOption = {
  id: string;
  label: string;
};

interface FirstRunDialogProps {
  open: boolean;
  flows: ExampleFlowOption[];
  onStartEmpty: () => void;
  onLoadExample: (flowId: string) => void;
  hideStartEmpty?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const FALLBACK_FLOW_ID = "";

export function FirstRunDialog({
  open,
  flows,
  onStartEmpty,
  onLoadExample,
  hideStartEmpty = false,
  onOpenChange,
}: FirstRunDialogProps) {
  const actionRef = useRef<"empty" | "example" | null>(null);
  const desktopPreviewFlows = useMemo(() => flows.slice(0, 5), [flows]);
  const selectableFlows = hideStartEmpty ? flows : desktopPreviewFlows;
  const defaultFlowId = useMemo(
    () => selectableFlows[0]?.id ?? FALLBACK_FLOW_ID,
    [selectableFlows]
  );
  const [selectedFlowId, setSelectedFlowId] = useState(defaultFlowId);

  useEffect(() => {
    if (open) {
      actionRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!selectableFlows.length) {
      setSelectedFlowId(FALLBACK_FLOW_ID);
      return;
    }
    if (!selectableFlows.some((flow) => flow.id === selectedFlowId)) {
      setSelectedFlowId(selectableFlows[0]?.id ?? FALLBACK_FLOW_ID);
    }
  }, [selectableFlows, selectedFlowId]);

  const handleStartEmpty = () => {
    actionRef.current = "empty";
    onStartEmpty();
  };

  const handleLoadClick = () => {
    if (!selectedFlowId) return;
    actionRef.current = "example";
    onLoadExample(selectedFlowId);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange?.(nextOpen);
  };

  const dialogDescription = hideStartEmpty
    ? "Mobile mode is read-only — load an example to explore the canvas."
    : "Pick how you would like to get started.";
  const exampleIntro = hideStartEmpty
    ? "Load one of our guided example flows to look around."
    : "Want a tour instead? Load one of our guided example flows.";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="inset-x-4 top-2 w-auto max-w-none grid-cols-1 translate-x-0 translate-y-0 max-h-[calc(100dvh-1rem)] overflow-y-auto p-4 sm:left-1/2 sm:right-auto sm:top-[50%] sm:w-full sm:max-w-lg sm:max-h-[85vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-6"
      >
        <DialogHeader>
          <DialogTitle>Welcome to raw₿it</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          {!hideStartEmpty && (
            <div className="rounded-md border p-4 space-y-3 bg-muted/20">
              <div className="text-sm text-muted-foreground">
                Start from a blank canvas and build your flow by dragging nodes
                from the sidebar.
              </div>
              <Button variant="default" onClick={handleStartEmpty}>
                Start empty canvas
              </Button>
            </div>
          )}

          <div className="rounded-md border p-4 space-y-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{exampleIntro}</p>
            </div>
            {flows.length ? (
              <>
                {hideStartEmpty ? (
                  <div
                    role="listbox"
                    aria-label="Example flows"
                    className="max-h-64 overflow-y-auto rounded-md border"
                  >
                    {flows.map((flow) => {
                      const selected = flow.id === selectedFlowId;
                      return (
                        <button
                          key={flow.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => setSelectedFlowId(flow.id)}
                          className={cn(
                            "flex w-full items-center gap-2 border-l-4 border-transparent px-3 py-2 text-left text-sm transition-colors",
                            selected
                              ? "bg-primary/10 text-foreground font-semibold border-primary"
                              : "hover:bg-muted/50"
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {flow.label}
                          </span>
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                            {selected ? (
                              <Check className="h-4 w-4 text-primary" />
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Select
                    value={selectedFlowId}
                    onValueChange={setSelectedFlowId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose an example flow" />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      align="start"
                      sideOffset={4}
                      avoidCollisions={false}
                    >
                      {desktopPreviewFlows.map((flow) => (
                        <SelectItem key={flow.id} value={flow.id}>
                          {flow.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  variant="outline"
                  onClick={handleLoadClick}
                  disabled={!selectedFlowId}
                >
                  Load example flow
                </Button>
                {!hideStartEmpty && flows.length > desktopPreviewFlows.length && (
                  <p className="text-xs font-bold text-foreground">
                    Check other flows in Flow Examples in the sidebar.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Example flows are not available right now.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
