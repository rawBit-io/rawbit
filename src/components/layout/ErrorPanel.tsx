import { useState } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { Copy, Check, X } from "lucide-react";
import type { CalcError, FlowNode } from "@/types";

export interface ErrorPanelProps {
  isOpen: boolean;
  errors: CalcError[];
  nodes: FlowNode[];
  hasVisibleTabs?: boolean;
  onSelect: (nodeId: string) => void;
  style?: CSSProperties;
}

/* Optional close handler so parent can hide the panel via × button */
export interface ErrorPanelFullProps extends ErrorPanelProps {
  onClose?: () => void;
}

const TOP_BAR = "3.5rem"; // h-14
const TAB_BAR = "2.5rem"; // h-10
const HEADER = "2.5rem"; // <h2> height

export function ErrorPanel({
  isOpen,
  errors,
  hasVisibleTabs = false,
  nodes,
  onSelect,
  onClose,
  style = {},
}: ErrorPanelFullProps) {
  const listMaxHeight = hasVisibleTabs
    ? `calc(100vh - ${TOP_BAR} - ${TAB_BAR} - ${HEADER})`
    : `calc(100vh - ${TOP_BAR} - ${HEADER})`;

  const labelFor = (id: string) =>
    nodes.find((n) => n.id === id)?.data?.title ??
    nodes.find((n) => n.id === id)?.data?.functionName ??
    id;

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyErrorInfo = (
    nodeId: string,
    error: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();

    const nodeTitle = labelFor(nodeId);
    const nodeInfo = nodeTitle === nodeId ? nodeId : `${nodeTitle} ${nodeId}`;
    const textToCopy = `${nodeInfo}\nError: ${error}`;

    const doSet = () => {
      setCopiedId(nodeId);
      setTimeout(() => setCopiedId(null), 1500);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy).then(doSet, () => {
        fallbackCopy(textToCopy);
        doSet();
      });
    } else {
      fallbackCopy(textToCopy);
      doSet();
    }
  };

  const fallbackCopy = (text: string) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  };

  return (
    <div
      className={cn(
        "fixed top-0 bottom-0 right-0 z-10 flex flex-col select-none border-l border-border bg-background text-foreground transition-[width] duration-300",
        isOpen ? "w-64" : "w-0 overflow-hidden"
      )}
      data-testid="error-panel"
      style={{ pointerEvents: isOpen ? "auto" : "none", ...style }}
    >
      {isOpen && (
        <>
          {/* spacer keeps header below the fixed top bar */}
          <div className="h-14" />

          {/* Header */}
          <div
            className={cn(
              "px-2 flex h-auto items-center justify-between border-b py-2",
              hasVisibleTabs ? "h-10" : "mt-3"
            )}
          >
            <h2 className="text-sm font-medium">Errors</h2>
            <button
              onClick={() => onClose?.()}
              title="Close panel"
              className="p-1 rounded hover:bg-secondary active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* List */}
          <div
            className="flex-grow px-2 pb-2 overflow-y-auto"
            style={{ maxHeight: listMaxHeight }}
          >
            {errors.length ? (
              <ul className="space-y-1">
                {errors.map((e, idx) => (
                  <li key={e.nodeId + idx}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(e.nodeId)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ")
                          onSelect(e.nodeId);
                      }}
                      aria-label={`Select node ${labelFor(e.nodeId)}`}
                      /* NOTE: this wrapper is the hover/focus "group" */
                      className="group grid grid-cols-[1fr,auto] items-start gap-2 w-full p-1 text-sm cursor-pointer rounded hover:bg-secondary focus-within:bg-secondary"
                    >
                      {/* text column */}
                      <div className="min-w-0">
                        <strong className="block truncate">
                          {labelFor(e.nodeId)}
                        </strong>
                        <span
                          className="block whitespace-pre-wrap break-words italic text-black dark:text-white"
                          title={e.error}
                        >
                          {e.error}
                        </span>
                      </div>

                      {/* actions column (hidden until hover/focus) */}
                      <button
                        type="button"
                        onClick={(ev) => copyErrorInfo(e.nodeId, e.error, ev)}
                        title={`Copy error info for ${labelFor(e.nodeId)}`}
                        aria-label={`Copy error info for ${labelFor(e.nodeId)}`}
                        /* Keep space reserved; don't intercept clicks until visible */
                        className="shrink-0 self-start p-1.5 rounded border border-border bg-background
                                   opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
                                   pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto
                                   transition-opacity duration-150 active:scale-95"
                      >
                        {copiedId === e.nodeId ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm italic text-muted-foreground pt-1">
                No errors 🎉
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
