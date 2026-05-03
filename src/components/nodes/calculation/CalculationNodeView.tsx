import React, {
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Handle, Position } from "@xyflow/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Check,
  Copy,
  FileCode,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Usb,
} from "lucide-react";

import { ConnectionStatusBadge } from "./fields/ConnectionStatusBadge";
import { EditableLabel } from "./fields/EditableLabel";
import { FieldWithHandle } from "./fields/FieldWithHandle";
import { SelectField } from "./fields/SelectField";
import { TerminalField } from "./fields/TerminalField";
import { FieldSection } from "./sections/FieldSection";
import { GroupSection } from "./sections/GroupSection";
import {
  SENTINEL_EMPTY,
  SENTINEL_FORCE00,
  SENTINEL_NULL,
} from "@/lib/nodes/constants";
import { canGrowGroup } from "@/lib/nodes/fieldUtils";
import { INSTANCE_STRIDE, cn, getVal } from "@/lib/utils";
import type {
  FieldDefinition as BaseFieldDefinition,
  GroupDefinition,
  NodeData,
  ScriptExecutionResult,
} from "@/types";
import type { ConnectionStatus } from "@/hooks/nodes/useCalcNodeDerived";
import type { UseCalcNodeMutationsResult } from "@/hooks/nodes/useCalcNodeMutations";
import type { UseGroupInstancesResult } from "@/hooks/nodes/useGroupInstances";
import type { ClipboardLiteResult } from "@/hooks/nodes/useClipboardLite";

const ScriptExecutionSteps = React.lazy(
  () => import("@/components/dialog/ScriptExecutionSteps")
);
const NodeCodeDialog = React.lazy(
  () => import("@/components/dialog/NodeCodeDialog")
);

interface SingleValueProps {
  showField: boolean;
  showHandle: boolean;
  value: string | undefined;
  onChange: (value: string) => void;
}

interface ScriptData {
  isScriptVerification: boolean;
  scriptResult: ScriptExecutionResult | null;
  scriptSigInputHex: string;
  scriptPubKeyInputHex: string;
}

interface CalculationNodeViewProps {
  selected: boolean;
  data: NodeData;
  rawTitle: string;
  derived: {
    isMultiVal: boolean;
    nodeWidth: number;
    minHeight: number;
    connectionStatus: ConnectionStatus;
  };
  isInputConnected: (fieldIndex: number) => boolean;
  getInputMeta?: (fieldIndex: number) => { value: unknown; error: boolean } | undefined;
  mut: UseCalcNodeMutationsResult;
  group: UseGroupInstancesResult;
  clip: ClipboardLiteResult;
  singleValue?: SingleValueProps;
  result: unknown;
  error: boolean;
  hasRegenerate: boolean;
  hardwareAction?: string;
  onHardwareAction?: () => void;
  showComment: boolean;
  comment: string;
  script: ScriptData;
}

type FieldDefinition = BaseFieldDefinition & {
  options?: string[];
  comment?: string;
  allowEmpty00?: boolean;
  allowEmptyBlank?: boolean;
  allowNull?: boolean;
  nullLabel?: string;
};

type AsciiTreeNode = {
  label: string;
  left?: AsciiTreeNode;
  right?: AsciiTreeNode;
};

const LEAF_HASH_GROUP_TITLE = "LEAF_HASHES[]";

const alphaLabel = (index: number) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let label = "";
  let n = index;
  while (true) {
    const rem = n % 26;
    label = alphabet[rem] + label;
    n = Math.floor(n / 26);
    if (n === 0) break;
    n -= 1;
  }
  return label;
};

const defaultLeafLabel = (index: number) => `Leaf ${alphaLabel(index)}`;

const buildTaprootTree = (labels: string[]): AsciiTreeNode | null => {
  if (!labels.length) return null;
  let nodes: AsciiTreeNode[] = labels.map((label) => ({ label }));
  while (nodes.length > 1) {
    const next: AsciiTreeNode[] = [];
    for (let index = 0; index < nodes.length; index += 2) {
      const left = nodes[index];
      const right = nodes[index + 1];
      if (!right) {
        next.push(left);
        continue;
      }
      next.push({ label: "branch", left, right });
    }
    nodes = next;
  }
  return nodes[0];
};

const renderAsciiTree = (node: AsciiTreeNode) => {
  const GAP = 2;
  const render = (
    current: AsciiTreeNode
  ): { lines: string[]; width: number; height: number; middle: number } => {
    const label = String(current.label);
    if (!current.left && !current.right) {
      return {
        lines: [label],
        width: label.length,
        height: 1,
        middle: Math.floor(label.length / 2),
      };
    }

    const left = current.left ? render(current.left) : null;
    const right = current.right ? render(current.right) : null;

    if (!left || !right) {
      const child = left ?? right;
      if (!child) {
        return {
          lines: [label],
          width: label.length,
          height: 1,
          middle: Math.floor(label.length / 2),
        };
      }

      const extra = Math.max(0, label.length - child.width);
      const padLeft = Math.floor(extra / 2);
      const padRight = extra - padLeft;
      const width = child.width + padLeft + padRight;
      const childPos = padLeft + child.middle;
      const labelStart = Math.max(
        0,
        Math.floor(width / 2) - Math.floor(label.length / 2)
      );
      const firstLine =
        " ".repeat(labelStart) +
        label +
        " ".repeat(Math.max(0, width - labelStart - label.length));
      let secondLine = "";
      for (let index = 0; index < width; index += 1) {
        if (index === childPos) {
          secondLine += left ? "/" : "\\";
        } else {
          secondLine += " ";
        }
      }
      const merged = child.lines.map(
        (line) => " ".repeat(padLeft) + line + " ".repeat(padRight)
      );
      return {
        lines: [firstLine, secondLine, ...merged],
        width,
        height: child.height + 2,
        middle: Math.floor(width / 2),
      };
    }

    const baseWidth = left.width + GAP + right.width;
    let padLeft = 0;
    let padRight = 0;
    if (label.length > baseWidth) {
      const extra = label.length - baseWidth;
      padLeft = Math.floor(extra / 2);
      padRight = extra - padLeft;
    }
    const width = baseWidth + padLeft + padRight;
    const leftStart = padLeft;
    const rightStart = padLeft + left.width + GAP;
    const leftPos = leftStart + left.middle;
    const rightPos = rightStart + right.middle;
    const rootCenter = Math.floor((leftPos + rightPos) / 2);
    const labelStart = Math.max(
      0,
      rootCenter - Math.floor(label.length / 2)
    );
    const firstLine =
      " ".repeat(labelStart) +
      label +
      " ".repeat(Math.max(0, width - labelStart - label.length));
    let secondLine = "";
    for (let index = 0; index < width; index += 1) {
      if (index === leftPos) {
        secondLine += "/";
      } else if (index === rightPos) {
        secondLine += "\\";
      } else {
        secondLine += " ";
      }
    }
    const height = Math.max(left.height, right.height);
    const merged = [];
    for (let index = 0; index < height; index += 1) {
      const leftLine = left.lines[index] ?? " ".repeat(left.width);
      const rightLine = right.lines[index] ?? " ".repeat(right.width);
      merged.push(
        " ".repeat(padLeft) +
          leftLine +
          " ".repeat(GAP) +
          rightLine +
          " ".repeat(padRight)
      );
    }
    return {
      lines: [firstLine, secondLine, ...merged],
      width,
      height: height + 2,
      middle: rootCenter,
    };
  };

  const { lines } = render(node);
  return lines.map((line) => line.replace(/\s+$/g, "")).join("\n");
};

export function CalculationNodeView({
  selected,
  data,
  rawTitle,
  derived,
  isInputConnected,
  getInputMeta,
  mut,
  group,
  clip,
  singleValue,
  result,
  error,
  hasRegenerate,
  hardwareAction,
  onHardwareAction,
  showComment,
  comment,
  script,
}: CalculationNodeViewProps) {
  const [showCode, setShowCode] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const commentEditStartRef = useRef(comment);

  const handleCommentFocus = useCallback((value: string) => {
    commentEditStartRef.current = value;
  }, []);

  const handleCommentBlur = useCallback(
    (value: string) => {
      mut.commitCommentOnBlur(commentEditStartRef.current, value);
      commentEditStartRef.current = value;
    },
    [mut]
  );
  const [anchoredHandleTops, setAnchoredHandleTops] = useState<
    Record<string, number | null>
  >({});
  const [musig2SecnonceCopied, setMusig2SecnonceCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const pathRowRef = useRef<HTMLDivElement | null>(null);
  const pathTriggerRef =
    useRef<React.ElementRef<typeof SelectTrigger> | null>(null);
  const parityRowRef = useRef<HTMLDivElement | null>(null);
  const parityValueRef = useRef<HTMLDivElement | null>(null);
  const musig2PubnonceRowRef = useRef<HTMLDivElement | null>(null);
  const musig2SecnonceRowRef = useRef<HTMLDivElement | null>(null);

  const highlightStyles =
    data.isHighlighted && !selected
      ? cn(
          "ring-8 ring-yellow-400 ring-offset-4 ring-offset-background",
          "shadow-[0_0_10px_4px_rgba(234,179,8,0.8)]"
        )
      : "";
  const selectedStyles = selected
    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
    : "";

  const showField = singleValue?.showField ?? false;
  const showHandle = singleValue?.showHandle ?? false;
  const outputLayout = data.outputLayout ?? "default";
  const isTaprootTreeBuilder = outputLayout === "taproot_tree_builder";
  const isTaprootTweakXonly = outputLayout === "taproot_tweak_xonly_pubkey";
  const isMusig2NonceGen = outputLayout === "musig2_nonce_gen";
  const outputPorts = useMemo(
    () =>
      Array.isArray(data.outputPorts) && data.outputPorts.length > 0
        ? data.outputPorts
        : [{ label: "out", handleId: "" }],
    [data.outputPorts]
  );
  const isHardwareAction = typeof hardwareAction === "string" && hardwareAction !== "";
  const hardwareBusy = data.hardwareStatus === "running";
  const hardwareActionLabel =
    typeof data.hardwareActionLabel === "string" && data.hardwareActionLabel
      ? data.hardwareActionLabel
      : hardwareAction === "trezor_get_address"
      ? "Get Address"
      : hardwareAction === "trezor_sign_transaction"
      ? "Sign"
      : "Run";
  const hardwareStatusText =
    typeof data.hardwareStatusText === "string" ? data.hardwareStatusText : "";
  const taprootTree = data.taprootTree as
    | {
        leafCount?: number;
        leafLabels?: string[];
        paths?: string[][];
        display?: unknown;
      }
    | undefined;
  const parityValue =
    data.outputValues && typeof data.outputValues === "object"
      ? (data.outputValues as Record<string, unknown>)["output-1"]
      : undefined;
  const parityDisplay =
    parityValue === undefined || parityValue === null || parityValue === ""
      ? "--"
      : String(parityValue);
  const musig2Outputs =
    data.outputValues && typeof data.outputValues === "object"
      ? (data.outputValues as Record<string, unknown>)
      : undefined;
  const musig2SecnonceValue = musig2Outputs?.["output-1"];
  const musig2PubnonceDisplay =
    result === undefined || result === null || result === ""
      ? "--"
      : clip.prettyResult;
  const musig2SecnonceDisplay =
    musig2SecnonceValue === undefined ||
    musig2SecnonceValue === null ||
    musig2SecnonceValue === ""
      ? "--"
      : typeof musig2SecnonceValue === "object"
      ? JSON.stringify(musig2SecnonceValue, null, 2)
      : String(musig2SecnonceValue);

  const copyMusig2Secnonce = () => {
    if (musig2SecnonceValue === undefined || musig2SecnonceValue === null) return;
    const text =
      typeof musig2SecnonceValue === "object"
        ? JSON.stringify(musig2SecnonceValue, null, 2)
        : String(musig2SecnonceValue);
    if (!text) return;

    const onSuccess = () => {
      setMusig2SecnonceCopied(true);
      window.setTimeout(() => setMusig2SecnonceCopied(false), 1000);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess, () => fallback());
    } else {
      fallback();
    }

    function fallback() {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        onSuccess();
      } finally {
        document.body.removeChild(textarea);
      }
    }
  };

  const handleCopyId = () => {
    clip.copyId();
  };

  const resolveConnectedField = (
    fieldIndex: number,
    rawValue: string | undefined,
    connected: boolean,
    fallbackPlaceholder?: string
  ) => {
    const meta = getInputMeta?.(fieldIndex);
    const upstreamValue = meta?.value;
    const upstreamValueString =
      upstreamValue === undefined || upstreamValue === null
        ? ""
        : String(upstreamValue);
    const isSentinelOverride =
      rawValue === SENTINEL_EMPTY ||
      rawValue === SENTINEL_NULL ||
      rawValue === SENTINEL_FORCE00;
    const hasRawValue = rawValue !== "" && rawValue !== undefined;
    const hasUpstreamValue = upstreamValueString !== "";
    const displayValue = isSentinelOverride
      ? rawValue
      : connected
      ? upstreamValueString
      : rawValue;

    const placeholder = connected
      ? rawValue === SENTINEL_EMPTY
        ? "--EMPTY--"
        : rawValue === SENTINEL_NULL
        ? "--NULL--"
        : !hasRawValue && meta?.error
        ? "Upstream error"
        : !hasRawValue && !hasUpstreamValue
        ? "Connected (no output)"
        : "Connected"
      : fallbackPlaceholder;

    return { displayValue, placeholder };
  };

  const makeRenderSingleField =
    (scope: string) => (field: FieldDefinition) => {
      const fieldIndex = field.index;
      const connected = isInputConnected(fieldIndex);
      const rawValue = getVal(data.inputs?.vals, fieldIndex) as
        | string
        | undefined;
      const resolved = resolveConnectedField(
        fieldIndex,
        rawValue,
        connected,
        field.placeholder
      );
      const fieldLabel = data.customFieldLabels?.[fieldIndex] || field.label;
      const handleOffset = scope.startsWith("between-") ? -32 : -16;
      const allowNull =
        field.allowNull ||
        (data.functionName === "musig2_nonce_gen" && fieldIndex === 2);

      if (field.options) {
        const current = rawValue ?? field.options[0];
        return (
          <SelectField
            key={`${scope}-${fieldIndex}`}
            label={fieldLabel}
            value={current}
            options={field.options}
            onChange={(value) =>
              mut.setFieldValue(fieldIndex, value, false, false)
            }
          />
        );
      }

      return (
        <FieldWithHandle
          key={`${scope}-${fieldIndex}`}
          handleId={`input-${fieldIndex}`}
          connected={connected}
          label={fieldLabel}
          placeholder={resolved.placeholder}
          value={resolved.displayValue}
          small={field.small}
          rows={field.rows}
          handleOffset={handleOffset}
          disableHandle={field.unconnectable}
          allowEmpty00={field.allowEmpty00}
          allowEmptyBlank={field.allowEmptyBlank}
          allowNull={allowNull}
          emptyLabel={field.emptyLabel}
          nullLabel={field.nullLabel}
          comment={field.comment}
          onChange={(value) =>
            mut.setFieldValue(
              fieldIndex,
              value,
              connected,
              !!(field.allowEmpty00 || field.allowEmptyBlank || allowNull)
            )
          }
          onLabelChange={(label) => mut.updateFieldLabel(fieldIndex, label)}
        />
      );
    };

  const renderGroupField = (
    offset: number,
    field: FieldDefinition,
    index: number
  ) => {
    const fieldIndex = offset + field.index;
    const connected = isInputConnected(fieldIndex);
    const rawValue = getVal(data.inputs?.vals, fieldIndex) as
      | string
      | undefined;
    const resolved = resolveConnectedField(
      fieldIndex,
      rawValue,
      connected,
      field.placeholder
    );
    const fieldLabel = data.customFieldLabels?.[fieldIndex] || field.label;
    const allowNull =
      field.allowNull ||
      (data.functionName === "musig2_nonce_gen" && fieldIndex === 2);

    if (field.options) {
      const current = rawValue ?? field.options[0];
      return (
        <SelectField
          key={`${field.label}-${fieldIndex}-${index}`}
          label={fieldLabel}
          value={current}
          options={field.options}
          onChange={(value) =>
            mut.setFieldValue(fieldIndex, value, false, false)
          }
        />
      );
    }

    return (
      <FieldWithHandle
        key={`${field.label}-${fieldIndex}`}
        comment={field.comment}
        handleId={`input-${fieldIndex}`}
        connected={connected}
        label={fieldLabel}
        placeholder={resolved.placeholder}
        value={resolved.displayValue}
        small={field.small}
        rows={field.rows}
        handleOffset={-33}
        disableHandle={field.unconnectable}
        allowEmpty00={field.allowEmpty00}
        allowEmptyBlank={field.allowEmptyBlank}
        allowNull={allowNull}
        emptyLabel={field.emptyLabel}
        nullLabel={field.nullLabel}
        onChange={(value) =>
          mut.setFieldValue(
            fieldIndex,
            value,
            connected,
            !!(field.allowEmpty00 || field.allowEmptyBlank || allowNull)
          )
        }
        onLabelChange={(label) => mut.updateFieldLabel(fieldIndex, label)}
      />
    );
  };

  const groupInstanceKeys = (groupDef: GroupDefinition) => {
    const keys = data.groupInstanceKeys?.[groupDef.title];
    if (keys?.length) return keys;

    const instanceCount = data.groupInstances?.[groupDef.title] ?? 0;
    return Array.from(
      { length: instanceCount },
      (_, index) => groupDef.baseIndex + index * INSTANCE_STRIDE
    );
  };

  const taprootLeafLabels = (() => {
    if (!isTaprootTreeBuilder) return [];
    const groupDef = data.inputStructure?.groups?.find(
      (group) => group.title === LEAF_HASH_GROUP_TITLE
    );
    if (!groupDef || groupDef.fields.length === 0) return [];
    const fieldOffset = groupDef.fields[0].index ?? 0;
    const keys = groupInstanceKeys(groupDef)
      .slice()
      .sort((a, b) => a - b);
    const leafCount =
      typeof taprootTree?.leafCount === "number"
        ? taprootTree.leafCount
        : keys.length;
    if (!leafCount) return [];

    const labels: string[] = [];
    for (let index = 0; index < leafCount; index += 1) {
      const baseIndex = keys[index];
      const fieldIndex =
        typeof baseIndex === "number" ? baseIndex + fieldOffset : undefined;
      const customLabel =
        fieldIndex !== undefined
          ? data.customFieldLabels?.[fieldIndex]
          : undefined;
      const trimmedLabel =
        typeof customLabel === "string" ? customLabel.trim() : "";
      labels.push(trimmedLabel || defaultLeafLabel(index));
    }
    return labels;
  })();

  const taprootLeafIndex =
    taprootLeafLabels.length > 0
      ? Math.min(
          Math.max(
            typeof data.taprootLeafIndex === "number"
              ? data.taprootLeafIndex
              : 0,
            0
          ),
          taprootLeafLabels.length - 1
        )
      : 0;

  const taprootTreeDisplay = (() => {
    if (!taprootTree) return "";
    const fallbackDisplay =
      typeof taprootTree.display === "string"
        ? taprootTree.display
        : JSON.stringify(taprootTree, null, 2) ?? "";
    if (!taprootLeafLabels.length) return fallbackDisplay;
    const tree = buildTaprootTree(taprootLeafLabels);
    if (!tree) return fallbackDisplay;
    if (!tree.left && !tree.right) {
      return renderAsciiTree({ label: "root", left: tree });
    }
    tree.label = "root";
    return renderAsciiTree(tree);
  })();
  const hideResultForInputNode = showField && data.functionName === "identity";

  const anchoredPortSources = useMemo(
    () =>
      Array.from(
        new Set(
          outputPorts
            .map((port) => port.handleTopSource)
            .filter(
              (source): source is string =>
                typeof source === "string" && source.trim().length > 0
            )
        )
      ),
    [outputPorts]
  );

  useLayoutEffect(() => {
    if (!anchoredPortSources.length) return;
    const cardEl = cardRef.current;
    if (!cardEl) return;

    const getAnchorTarget = (source: string): HTMLElement | null => {
      if (source === "taproot-path-select") {
        return pathTriggerRef.current ?? pathRowRef.current;
      }
      if (source === "taproot-output-parity") {
        return parityValueRef.current ?? parityRowRef.current;
      }
      if (source === "musig2-pubnonce") {
        return musig2PubnonceRowRef.current;
      }
      if (source === "musig2-secnonce") {
        return musig2SecnonceRowRef.current;
      }
      return null;
    };

    const updatePosition = () => {
      const cardHeight = cardEl.offsetHeight;
      if (!cardHeight) return;
      const cardRect = cardEl.getBoundingClientRect();
      if (!cardRect.height) return;
      const next: Record<string, number | null> = {};

      anchoredPortSources.forEach((source) => {
        const targetEl = getAnchorTarget(source);
        if (!targetEl) {
          next[source] = null;
          return;
        }
        const targetRect = targetEl.getBoundingClientRect();
        if (!targetRect.height) {
          next[source] = null;
          return;
        }
        const scaleY = cardRect.height / cardHeight;
        const rawTop = targetRect.top - cardRect.top + targetRect.height / 2;
        const nextTop = scaleY ? rawTop / scaleY : rawTop;
        if (!Number.isFinite(nextTop)) {
          next[source] = null;
          return;
        }
        // Normalize to integer pixels to avoid sub-pixel oscillation loops.
        next[source] = Math.round(Math.min(Math.max(nextTop, 0), cardHeight));
      });

      setAnchoredHandleTops((prev) => {
        const merged: Record<string, number | null> = {};
        let changed = false;

        anchoredPortSources.forEach((source) => {
          const value = next[source] ?? null;
          merged[source] = value;
          if ((prev[source] ?? null) !== value) changed = true;
        });

        const prevKeys = Object.keys(prev);
        if (prevKeys.length !== anchoredPortSources.length) {
          changed = true;
        }

        return changed ? merged : prev;
      });
    };

    updatePosition();
    const schedule =
      typeof window !== "undefined" && window.requestAnimationFrame
        ? window.requestAnimationFrame
        : (cb: () => void) => setTimeout(cb, 0);
    const cancel =
      typeof window !== "undefined" && window.cancelAnimationFrame
        ? window.cancelAnimationFrame
        : (id: number) => clearTimeout(id);
    const rafId = schedule(updatePosition);

    if (typeof ResizeObserver === "undefined") {
      return () => cancel(rafId as number);
    }

    const observer = new ResizeObserver(() => {
      updatePosition();
    });
    anchoredPortSources.forEach((source) => {
      const targetEl = getAnchorTarget(source);
      if (targetEl) observer.observe(targetEl);
    });

    return () => {
      cancel(rafId as number);
      observer.disconnect();
    };
  }, [
    anchoredPortSources,
    isTaprootTreeBuilder,
    taprootLeafLabels.length,
    taprootTreeDisplay,
    taprootLeafIndex,
    isTaprootTweakXonly,
    parityDisplay,
    isMusig2NonceGen,
    musig2PubnonceDisplay,
    musig2SecnonceDisplay,
    result,
    showComment,
  ]);

  return (
    <Card
      ref={cardRef}
      className={cn(
        "relative flex flex-col border-2 bg-card font-mono text-primary shadow-md transition-colors",
        selectedStyles,
        highlightStyles,
        data.borderColor ? "!border-3" : "border-border"
      )}
      style={{
        width: derived.nodeWidth,
        minHeight: derived.minHeight,
        overflow: "visible",
        contain: "layout",
        ...(data.borderColor ? { borderColor: data.borderColor } : {}),
      }}
    >
      <div className="flex w-full flex-row items-start gap-2 border-b border-border p-2 text-xl">
        <div className="min-w-0 flex-1 break-words leading-tight">
          <EditableLabel
            value={rawTitle}
            onCommit={mut.handleTitleUpdate}
            className="text-xl"
            maxLength={100}
          />
        </div>

        <div className="flex flex-shrink-0 items-center space-x-2">
          {derived.connectionStatus.shouldShow && (
            <ConnectionStatusBadge
              connected={derived.connectionStatus.connected}
              total={derived.connectionStatus.total}
            />
          )}

          {error && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-pointer">
                    <AlertTriangle className="h-7 w-7 text-destructive" />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-md">
                  <div className="flex flex-col gap-2">
                    <div className="max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                      {String(data.extendedError) || "Unknown error"}
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="nodrag flex h-7 items-center gap-1 px-2"
                        onPointerDownCapture={(event) =>
                          event.stopPropagation()
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          clip.copyError();
                        }}
                      >
                        {clip.errorCopied ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span className="text-xs">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span className="text-xs">Copy</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {isHardwareAction && (
            <Button
              variant="outline"
              size="sm"
              className="nodrag flex h-8 items-center gap-1.5 px-2 text-xs"
              disabled={hardwareBusy}
              onPointerDownCapture={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onHardwareAction?.();
              }}
            >
              {hardwareBusy ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Usb className="h-3.5 w-3.5" />
              )}
              <span>{hardwareActionLabel}</span>
            </Button>
          )}

          {hasRegenerate && !isHardwareAction && (
            <Button variant="ghost" size="icon" onClick={mut.handleRegenerate}>
              <RefreshCw className="h-5 w-5" />
            </Button>
          )}

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative z-10">
                <MoreHorizontal className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuPortal>
              <DropdownMenuContent
                align="end"
                side="right"
                avoidCollisions
                className="z-[100] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                style={{ fontSize: "14px", minWidth: "180px" }}
                onPointerDown={(event) => event.stopPropagation()}
                onWheelCapture={(event) => event.stopPropagation()}
              >
                {data.functionName && !data.hideCode && (
                  <DropdownMenuItem onSelect={() => setShowCode(true)}>
                    <span className="flex items-center gap-2">
                      <FileCode className="h-4 w-4" /> Show Code
                    </span>
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem onSelect={mut.toggleComment}>
                  <span className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    {showComment ? "Hide Comment" : "Show Comment"}
                  </span>
                </DropdownMenuItem>

                <DropdownMenuItem onSelect={handleCopyId}>
                  <span className="flex items-center gap-2">
                    <Copy className="h-4 w-4" />
                    {clip.idCopied ? "Copied ✓" : "Copy ID"}
                  </span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onSelect={mut.deleteNode}
                  className="text-destructive focus:text-destructive"
                >
                  <span className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4" /> Delete Node
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col p-4 text-sm">
        {!derived.isMultiVal && singleValue && (
          <div className={cn(hideResultForInputNode ? "mb-0" : "mb-4")}>
            {showField && (
              <FieldWithHandle
                handleId="input-0"
                connected={isInputConnected(0)}
                label={data.customFieldLabels?.[0] || "INPUT VALUE:"}
                placeholder="Type a value..."
                value={singleValue.value}
                rows={hideResultForInputNode ? 1 : undefined}
                autoResizeMaxRows={hideResultForInputNode ? 3 : undefined}
                onChange={singleValue.onChange}
                disableHandle={!showHandle}
                handleOffset={-16}
                onLabelChange={(value) => mut.updateFieldLabel(0, value)}
              />
            )}

            {!showField && showHandle && (
              <Handle
                type="target"
                position={Position.Left}
                id="input-0"
                className="!h-3 !w-3 !border-2 !border-primary !bg-background"
                style={{ top: "50%", transform: "translate(-50%, -50%)" }}
              />
            )}
          </div>
        )}

        {derived.isMultiVal && (
          <div className="mb-6 flex flex-col gap-6">
            <FieldSection
              fields={
                data.inputStructure?.ungrouped as FieldDefinition[] | undefined
              }
              scope="ungrouped"
              renderField={makeRenderSingleField("ungrouped")}
            />

            {data.inputStructure?.groups?.map((groupDef) => {
              const keys = groupInstanceKeys(groupDef);
              const instanceCount =
                data.groupInstances?.[groupDef.title] ?? keys.length;
              const canDecrement = instanceCount > (groupDef.minInstances ?? 1);
              const canIncrement = Boolean(
                groupDef.expandable &&
                  !(
                    groupDef.maxInstances &&
                    instanceCount >= groupDef.maxInstances
                  ) &&
                  canGrowGroup(
                    groupDef.baseIndex,
                    keys,
                    groupDef.fields as FieldDefinition[]
                  )
              );

              return (
                <React.Fragment key={groupDef.title}>
                  <GroupSection
                    group={groupDef}
                    instanceKeys={keys}
                    title={
                      data.customGroupTitles?.[groupDef.title] || groupDef.title
                    }
                    onTitleCommit={(title) =>
                      mut.updateGroupTitle(groupDef.title, title)
                    }
                    canIncrement={canIncrement}
                    canDecrement={canDecrement}
                    onIncrement={() =>
                      group.handleGroupSize(groupDef.title, groupDef, true)
                    }
                    onDecrement={() =>
                      group.handleGroupSize(groupDef.title, groupDef, false)
                    }
                    renderField={renderGroupField}
                  />

                  <FieldSection
                    fields={
                      data.inputStructure?.betweenGroups?.[groupDef.title] as
                        | FieldDefinition[]
                        | undefined
                    }
                    scope={`between-${groupDef.title}`}
                    paddingLeft={16}
                    renderField={makeRenderSingleField(
                      `between-${groupDef.title}`
                    )}
                  />
                </React.Fragment>
              );
            })}

            <FieldSection
              fields={
                data.inputStructure?.afterGroups as
                  | FieldDefinition[]
                  | undefined
              }
              scope="after"
              renderField={makeRenderSingleField("after")}
            />
          </div>
        )}

        {!hideResultForInputNode && (
          <div className="mt-auto border-t border-border pt-2">
            <div className="mb-2 text-sm text-primary">
              {">"} Calculation Result:
            </div>
            {isMusig2NonceGen ? (
              <div className="space-y-3 text-sm">
                <div
                  ref={musig2PubnonceRowRef}
                  className="flex items-start justify-between gap-2"
                >
                  <div className="flex-1 min-w-0" data-testid="node-result">
                    <div className="mb-1 text-xs font-medium">Pubnonce:</div>
                    <span className="block whitespace-pre-wrap break-all">
                      {musig2PubnonceDisplay}
                    </span>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="nodrag shrink-0 self-start"
                    onPointerDownCapture={(event) => event.stopPropagation()}
                    onClick={clip.copyResult}
                    disabled={result === undefined}
                    title={
                      clip.resultCopied ? "Copied!" : "Copy pubnonce to clipboard"
                    }
                  >
                    {clip.resultCopied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                <div
                  ref={musig2SecnonceRowRef}
                  className="flex items-start justify-between gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="mb-1 text-xs font-medium">Secnonce:</div>
                    <span className="block whitespace-pre-wrap break-all">
                      {musig2SecnonceDisplay}
                    </span>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="nodrag shrink-0 self-start"
                    onPointerDownCapture={(event) => event.stopPropagation()}
                    onClick={copyMusig2Secnonce}
                    disabled={
                      musig2SecnonceValue === undefined ||
                      musig2SecnonceValue === null ||
                      musig2SecnonceValue === ""
                    }
                    title={
                      musig2SecnonceCopied
                        ? "Copied!"
                        : "Copy secnonce to clipboard"
                    }
                  >
                    {musig2SecnonceCopied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2 text-sm">
                <div className="flex-1 min-w-0" data-testid="node-result">
                  <span className="block whitespace-pre-wrap break-all">
                    {clip.prettyResult}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="nodrag shrink-0 self-start"
                  onPointerDownCapture={(event) => event.stopPropagation()}
                  onClick={clip.copyResult}
                  disabled={result === undefined}
                  title={clip.resultCopied ? "Copied!" : "Copy result to clipboard"}
                >
                  {clip.resultCopied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}

            {isTaprootTreeBuilder && taprootLeafLabels.length > 0 ? (
              <div
                ref={pathRowRef}
                className="relative mt-3 flex items-center justify-between"
              >
                <span className="text-xs font-medium">Merkle Path Leaf:</span>
                <Select
                  value={String(taprootLeafIndex)}
                  onValueChange={(value) =>
                    mut.setTaprootLeafIndex(Number(value))
                  }
                >
                  <SelectTrigger
                    ref={pathTriggerRef}
                    className="h-7 w-40"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {taprootLeafLabels.map((label, index) => (
                      <SelectItem key={`${label}-${index}`} value={String(index)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {isTaprootTweakXonly ? (
              <div
                ref={parityRowRef}
                className="relative mt-3 flex items-center justify-between"
              >
                <span className="text-xs font-medium">Output Key Parity:</span>
                <div
                  ref={parityValueRef}
                  className="flex h-7 min-w-[3.5rem] items-center justify-center rounded-md border border-input bg-background px-2 text-xs font-mono"
                >
                  {parityDisplay}
                </div>
              </div>
            ) : null}

            {taprootTreeDisplay ? (
              <div className="mt-3 border-t border-border pt-2">
                <TerminalField
                  label="Taproot Tree:"
                  value={taprootTreeDisplay}
                  readOnly={true}
                  rows={Math.min(
                    12,
                    Math.max(4, taprootTreeDisplay.split("\n").length)
                  )}
                />
              </div>
            ) : null}

            {data.networkDependent && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium">Network:</span>
                <Select
                  value={data.selectedNetwork || "testnet"}
                  onValueChange={mut.handleNetworkChange}
                >
                  <SelectTrigger className="h-7 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mainnet">Mainnet</SelectItem>
                    <SelectItem value="testnet">Testnet</SelectItem>
                    <SelectItem value="regtest">Regtest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {script.isScriptVerification && script.scriptResult !== null ? (
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => setShowSteps(true)}
              >
                View Script Steps
              </Button>
            ) : null}

            {isHardwareAction && hardwareStatusText ? (
              <div className="mt-3 rounded border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                {hardwareStatusText}
              </div>
            ) : null}
          </div>
        )}

        {showComment && (
          <div className="mt-4 border-t border-border pt-2">
            <TerminalField
              label="Node Comment:"
              placeholder="Enter your notes here..."
              value={comment}
              onChange={mut.handleCommentChange}
              onFocus={handleCommentFocus}
              onBlur={handleCommentBlur}
            />
          </div>
        )}
      </CardContent>

      {outputPorts
        .filter((port) => port.showHandle !== false)
        .map((port, index, visiblePorts) => {
          const anchoredTop =
            typeof port.handleTopSource === "string"
              ? anchoredHandleTops[port.handleTopSource]
              : null;
          const top =
            anchoredTop !== null && anchoredTop !== undefined
              ? `${anchoredTop}px`
              : port.handleTop
              ? port.handleTop
              : `${((index + 1) / (visiblePorts.length + 1)) * 100}%`;
          const handleId = port.handleId || undefined;
          const showLabel =
            port.showLabel !== undefined
              ? port.showLabel
              : visiblePorts.length > 1;
          return (
            <React.Fragment key={`${port.handleId || "out"}-${index}`}>
              {showLabel ? (
                <div
                  className="absolute right-5 text-[10px] text-muted-foreground"
                  style={{ top, transform: "translateY(-50%)" }}
                >
                  {port.label}
                </div>
              ) : null}
              <Handle
                type="source"
                id={handleId}
                position={Position.Right}
                className="!h-3 !w-3 !border-2 !border-primary !bg-background"
                style={{ top, transform: "translate(50%, -50%)" }}
              />
            </React.Fragment>
          );
        })}

      <Suspense fallback={null}>
        <ScriptExecutionSteps
          open={showSteps}
          onClose={() => setShowSteps(false)}
          scriptResult={script.scriptResult}
          scriptSigInputHex={script.scriptSigInputHex}
          scriptPubKeyInputHex={script.scriptPubKeyInputHex}
        />
      </Suspense>

      <Suspense fallback={null}>
        <NodeCodeDialog
          open={showCode}
          onClose={() => setShowCode(false)}
          functionName={data.functionName}
        />
      </Suspense>
    </Card>
  );
}
