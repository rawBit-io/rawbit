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
import { normalizeRadioChannel, radioChannelFromData } from "@/lib/graphUtils";
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

function radioLinkStatusEqual(a: RadioLinkStatus, b: RadioLinkStatus) {
  return a.error === b.error && a.message === b.message;
}

function getRadioLinkStatus(
  isSend: boolean,
  channel: string,
  nodes: FlowNode[],
): RadioLinkStatus {
  if (isSend) {
    return { error: false };
  }

  const senders = nodes.filter(
    (node) =>
      node.data?.functionName === "radio_send" &&
      radioChannelFromData(node.data) === channel,
  );

  if (senders.length === 0) {
    return {
      error: true,
      message: `Radio Receive ${channel} has no matching Radio Send`,
    };
  }
  if (senders.length > 1) {
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
  const { scheduleSnapshot } = useSnapshotSchedulerContext();
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
  const hasError = localRadioStatus.error;
  const errorTitle = localRadioStatus.message ?? "Radio link error";
  const circleLeft = isSend ? 16 : 60;
  const handleClass = "!h-3 !w-3 !border-2 !border-primary !bg-background";

  const commitChannel = useCallback(
    (value: string) => {
      const nextChannel = normalizeChannel(value);
      const nextTitle = `${titlePrefix} ${nextChannel}`;

      setNodes((nodes) =>
        nodes.map((node) => {
          const fnName = node.data?.functionName;
          const isRadioNode =
            fnName === "radio_send" || fnName === "radio_receive";

          if (node.id !== id) {
            return isRadioNode
              ? { ...node, data: { ...node.data, dirty: true } }
              : node;
          }

          return {
            ...node,
            data: {
              ...node.data,
              title: nextTitle,
              radioChannel: nextChannel,
              dirty: true,
            },
          };
        })
      );
      scheduleSnapshot("Change Radio Channel");
    },
    [id, scheduleSnapshot, setNodes, titlePrefix]
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
        {hasError && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="absolute z-20 cursor-pointer"
                  style={{ left: 40, top: -22 }}
                >
                  <AlertTriangle className="node-error-icon h-5 w-5" />
                </div>
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
        />
      </div>
    </div>
  );
}
