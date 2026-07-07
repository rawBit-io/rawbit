import { memo } from "react";
import {
  Position,
  ViewportPortal,
  getBezierPath,
  useStore,
} from "@xyflow/react";

import { isRadioFunctionName, radioChannelFromData } from "@/lib/graphUtils";
import type { FlowNode } from "@/types";

const RADIO_NODE_WIDTH = 132;
const RADIO_NODE_HEIGHT = 64;

type RadioLink = {
  key: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
};

type OverlayStoreState = {
  nodes: FlowNode[];
  nodeLookup: Map<
    string,
    {
      measured?: { width?: number; height?: number };
      internals: { positionAbsolute: { x: number; y: number } };
    }
  >;
};

const NO_LINKS: RadioLink[] = [];

function nodeAnchor(
  state: OverlayStoreState,
  nodeId: string,
  side: "right" | "left",
) {
  const internal = state.nodeLookup.get(nodeId);
  if (!internal) return null;
  const { x, y } = internal.internals.positionAbsolute;
  const width = internal.measured?.width ?? RADIO_NODE_WIDTH;
  const height = internal.measured?.height ?? RADIO_NODE_HEIGHT;
  return { x: side === "right" ? x + width : x, y: y + height / 2 };
}

/**
 * Wireless pair lines for the currently selected radio nodes.
 *
 * Selecting either end of a valid link (exactly one sender on the channel)
 * yields one line per send→receive pair; a selected sender links to all of
 * its receivers. Broken links (no sender / duplicate senders) draw nothing —
 * the nodes' own warning triangles cover those states.
 */
function selectRadioLinks(state: OverlayStoreState): RadioLink[] {
  let anySelectedRadio = false;
  for (const node of state.nodes) {
    if (node.selected && isRadioFunctionName(node.data?.functionName)) {
      anySelectedRadio = true;
      break;
    }
  }
  if (!anySelectedRadio) return NO_LINKS;

  const sendersByChannel = new Map<string, FlowNode[]>();
  const receiversByChannel = new Map<string, FlowNode[]>();
  for (const node of state.nodes) {
    const fnName = node.data?.functionName;
    if (!isRadioFunctionName(fnName)) continue;
    const channel = radioChannelFromData(node.data);
    const byChannel =
      fnName === "radio_send" ? sendersByChannel : receiversByChannel;
    const list = byChannel.get(channel) ?? [];
    list.push(node);
    byChannel.set(channel, list);
  }

  const pairs = new Map<string, { senderId: string; receiverId: string }>();
  for (const node of state.nodes) {
    if (!node.selected) continue;
    const fnName = node.data?.functionName;
    if (!isRadioFunctionName(fnName)) continue;

    const channel = radioChannelFromData(node.data);
    const senders = sendersByChannel.get(channel) ?? [];
    if (senders.length !== 1) continue;
    const senderId = senders[0].id;

    if (fnName === "radio_send") {
      for (const receiver of receiversByChannel.get(channel) ?? []) {
        pairs.set(`${senderId}__${receiver.id}`, {
          senderId,
          receiverId: receiver.id,
        });
      }
    } else {
      pairs.set(`${senderId}__${node.id}`, { senderId, receiverId: node.id });
    }
  }

  const links: RadioLink[] = [];
  for (const [key, { senderId, receiverId }] of pairs) {
    const source = nodeAnchor(state, senderId, "right");
    const target = nodeAnchor(state, receiverId, "left");
    if (!source || !target) continue;
    links.push({
      key,
      sourceX: source.x,
      sourceY: source.y,
      targetX: target.x,
      targetY: target.y,
    });
  }
  return links.length ? links : NO_LINKS;
}

function radioLinksEqual(a: RadioLink[], b: RadioLink[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const prev = a[index];
    const next = b[index];
    if (
      prev.key !== next.key ||
      prev.sourceX !== next.sourceX ||
      prev.sourceY !== next.sourceY ||
      prev.targetX !== next.targetX ||
      prev.targetY !== next.targetY
    ) {
      return false;
    }
  }
  return true;
}

function RadioLinkOverlay() {
  const links = useStore(selectRadioLinks, radioLinksEqual);

  if (!links.length) return null;

  return (
    <ViewportPortal>
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={2}
        height={2}
        aria-hidden="true"
        data-testid="radio-link-overlay"
      >
        {links.map((link) => {
          const [path] = getBezierPath({
            sourceX: link.sourceX,
            sourceY: link.sourceY,
            sourcePosition: Position.Right,
            targetX: link.targetX,
            targetY: link.targetY,
            targetPosition: Position.Left,
          });
          return (
            <path
              key={link.key}
              d={path}
              className="radio-link-overlay-path"
              data-testid="radio-link-overlay-path"
            />
          );
        })}
      </svg>
    </ViewportPortal>
  );
}

export default memo(RadioLinkOverlay);
