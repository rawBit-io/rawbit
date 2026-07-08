import { useCallback } from "react";
import {
  Handle,
  NodeProps,
  Position,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { AlertTriangle } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSnapshotSchedulerContext } from "@/hooks/useSnapshotSchedulerContext";
import {
  isRadioFunctionName,
  normalizeRadioChannel,
  radioChannelFromData,
  radioTitleForFunction,
  updateRadioOutputPortLabels,
} from "@/lib/graphUtils";
import { cn } from "@/lib/utils";
import type { FlowNode, NodeData } from "@/types";
import { EditableLabel } from "./common/EditableLabel";

const RADIO_NODE_WIDTH = 132;
const RADIO_NODE_HEIGHT = 64;

function sanitizeChannelDraft(value: string) {
  return value.replace(/\D/g, "").slice(0, 2);
}

function normalizeChannel(value: string) {
  return normalizeRadioChannel(value);
}

type RadioLinkStatus = {
  error: boolean;
  message?: string;
};

const senderCountCache: {
  nodes: FlowNode[] | null;
  counts: Map<string, number>;
} = {
  nodes: null,
  counts: new Map(),
};

function radioSenderCounts(nodes: FlowNode[]) {
  if (senderCountCache.nodes === nodes) return senderCountCache.counts;

  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.data?.functionName !== "radio_send") continue;
    const senderChannel = radioChannelFromData(node.data);
    counts.set(senderChannel, (counts.get(senderChannel) ?? 0) + 1);
  }

  senderCountCache.nodes = nodes;
  senderCountCache.counts = counts;
  return counts;
}

function radioLinkStatusEqual(a: RadioLinkStatus, b: RadioLinkStatus) {
  return a.error === b.error && a.message === b.message;
}

function getRadioLinkStatus(
  isSend: boolean,
  channel: string,
  nodes: FlowNode[],
): RadioLinkStatus {
  const matchingSenders = radioSenderCounts(nodes).get(channel) ?? 0;

  if (isSend) {
    if (matchingSenders > 1) {
      return {
        error: true,
        message: `Radio Send ${channel} duplicates another Radio Send`,
      };
    }
    return { error: false };
  }

  if (matchingSenders === 0) {
    return {
      error: true,
      message: `Radio Receive ${channel} has no matching Radio Send`,
    };
  }
  if (matchingSenders > 1) {
    return {
      error: true,
      message: `Radio Receive ${channel} has multiple matching Radio Sends`,
    };
  }

  return { error: false };
}

export default function RadioNode({ id, data, selected }: NodeProps<FlowNode>) {
  const nodeData = data as NodeData;
  const { setNodes } = useReactFlow<FlowNode>();
  const { markPendingAfterDirtyChange, scheduleSnapshot } =
    useSnapshotSchedulerContext();
  const isSend = nodeData.functionName === "radio_send";
  const channel = radioChannelFromData(nodeData);
  const titlePrefix = isSend ? "Radio Send" : "Radio Receive";
  const localRadioStatus = useStore(
    useCallback(
      (state: { nodes: FlowNode[] }) =>
        getRadioLinkStatus(isSend, channel, state.nodes),
      [channel, isSend],
    ),
    radioLinkStatusEqual,
  );
  const backendErrorMessage = nodeData.error
    ? String(nodeData.extendedError ?? "Radio node error")
    : undefined;
  const errorTitle =
    [localRadioStatus.message, backendErrorMessage].filter(Boolean).join("\n\n") ||
    "Radio link error";
  const hasError = localRadioStatus.error || Boolean(backendErrorMessage);
  const circleLeft = isSend ? 16 : 60;
  const handleClass = "!h-3 !w-3 !border-2 !border-primary !bg-background";
  const paletteColor =
    typeof nodeData.borderColor === "string" && nodeData.borderColor.trim()
      ? nodeData.borderColor.trim()
      : undefined;

  const commitChannel = useCallback(
    (value: string) => {
      const nextChannel = normalizeChannel(value);
      const nextTitle = radioTitleForFunction(
        nodeData.functionName,
        nextChannel,
      );
      const outputPortLabelsAreCurrent =
        !Array.isArray(nodeData.outputPorts) ||
        nodeData.outputPorts.every((port) => port.label === nextChannel);
      if (
        nextChannel === channel &&
        nodeData.title === nextTitle &&
        nodeData.radioChannel === nextChannel &&
        outputPortLabelsAreCurrent
      ) {
        return;
      }

      setNodes((nodes) =>
        nodes.map((node) => {
          const fnName = node.data?.functionName;
          const isRadioNode = isRadioFunctionName(fnName);

          if (node.id !== id) {
            return isRadioNode
              ? { ...node, data: { ...node.data, dirty: true } }
              : node;
          }

          return {
            ...node,
            data: updateRadioOutputPortLabels(
              {
                ...node.data,
                title: nextTitle,
                radioChannel: nextChannel,
                dirty: true,
              },
              nextChannel,
            ),
          };
        })
      );
      markPendingAfterDirtyChange();
      scheduleSnapshot("Change Radio Channel", {
        coalesceFollowingCalc: true,
      });
    },
    [
      channel,
      id,
      nodeData.functionName,
      nodeData.outputPorts,
      nodeData.radioChannel,
      nodeData.title,
      markPendingAfterDirtyChange,
      scheduleSnapshot,
      setNodes,
    ]
  );

  return (
    <div
      className="relative overflow-visible"
      style={{ width: RADIO_NODE_WIDTH, height: RADIO_NODE_HEIGHT }}
      title={hasError ? errorTitle : `${titlePrefix} ${channel}`}
      data-testid={`radio-${isSend ? "send" : "receive"}-node`}
    >
      {isSend ? (
        <>
          <div className="absolute left-0 top-1/2 h-[2px] w-4 -translate-y-1/2 bg-primary" />
          <div className="absolute left-[72px] top-1/2 h-[2px] w-9 -translate-y-1/2 bg-primary" />
          <div
            className="absolute left-[108px] top-1/2 h-0 w-0 -translate-y-1/2 border-y-[6px] border-l-[14px] border-y-transparent border-l-primary"
            aria-hidden="true"
          />
          <Handle
            type="target"
            position={Position.Left}
            id="input-0"
            className={handleClass}
            style={{ top: "50%", left: 0, transform: "translate(-50%, -50%)" }}
          />
        </>
      ) : (
        <>
          <div className="absolute left-1 top-1/2 h-[2px] w-10 -translate-y-1/2 bg-primary" />
          <div
            className="absolute left-[44px] top-1/2 h-0 w-0 -translate-y-1/2 border-y-[6px] border-l-[14px] border-y-transparent border-l-primary"
            aria-hidden="true"
          />
          <div className="absolute left-[116px] top-1/2 h-[2px] w-4 -translate-y-1/2 bg-primary" />
          <Handle
            type="source"
            position={Position.Right}
            className={handleClass}
            style={{ top: "50%", right: 0, transform: "translate(50%, -50%)" }}
          />
        </>
      )}

      <div
        className={cn(
          "absolute top-1/2 flex h-14 w-14 -translate-y-1/2 items-center justify-center",
          "rounded-full border-2 border-primary bg-background text-primary shadow-sm",
          selected &&
            "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}
        style={{ left: circleLeft }}
      >
        {paletteColor && (
          <div
            className="radio-node-fill pointer-events-none absolute inset-0 z-0 rounded-full"
            data-testid="radio-node-fill"
            style={{ backgroundColor: paletteColor }}
          />
        )}
        {hasError && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="absolute z-20 cursor-pointer bg-transparent p-0"
                  style={{ left: 40, top: -22 }}
                  aria-label={errorTitle}
                >
                  <AlertTriangle className="node-error-icon h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-md">
                <div className="max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                  {errorTitle}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <EditableLabel
          value={channel}
          onCommit={commitChannel}
          className="relative z-10 text-center font-mono leading-none text-primary"
          readOnlyStyle={{ cursor: "grab", userSelect: "none" }}
          editingClassName="!border-0 !px-0 !py-0 !shadow-none !outline-none focus:!ring-0 focus:!outline-none"
          fontSize={24}
          maxLength={2}
          fallback="1"
          sanitizeInput={sanitizeChannelDraft}
          ariaLabel={`${titlePrefix} channel ${channel}`}
        />
      </div>
    </div>
  );
}
