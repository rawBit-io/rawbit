// src/help/demos/show-code.ts
// Help demo: drop a hash node onto the canvas, then walk through opening its
// ⋯ menu and clicking "Show Code" to reveal the Python source behind the
// node. Demonstrates the "inspect the code" promise from the marketing copy.

import { allSidebarNodes } from "@/components/sidebar-nodes";
import type { FlowNode, NodeTemplate } from "@/types";

import {
  dispatchPointerDown,
  findMenuItemByText,
  findNodeMenuButton,
  getElementCenter,
  getRectCursorCenter,
  getSidebarNodeSourceRect,
  scrollCodeDialogTo,
  withCursorTipAt,
} from "../runtime/helpers";
import type { DemoContext, HelpDemo } from "../types";

const SHA256_LABEL = "Data → SHA-256";
const SHA256_NODE_ID = "node_help_demo_sha256";
const SHA256_POSITION = { x: 220, y: 180 };

const VIEWPORT = { x: 0, y: 0, zoom: 1 };

const SPEEDUP = 1.5;
const sp = (ms: number) => Math.round(ms / SPEEDUP);

function cloneTemplateData(template: NodeTemplate): Record<string, unknown> {
  const source = template.nodeData as Record<string, unknown>;
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(source);
    }
  } catch {
    /* fall back to JSON copy */
  }
  return JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
}

function findTemplate(label: string): NodeTemplate | undefined {
  return allSidebarNodes.find((node) => node.label === label);
}

interface DropArgs {
  template: NodeTemplate;
  nodeId: string;
  position: { x: number; y: number };
  override?: (data: Record<string, unknown>) => Record<string, unknown>;
}

function placeNode(
  ctx: DemoContext,
  { template, nodeId, position, override }: DropArgs,
) {
  const baseData = cloneTemplateData(template);
  const nextData = override ? override(baseData) : baseData;
  const dropped: FlowNode = {
    id: nodeId,
    type: template.type,
    position,
    selected: true,
    data: nextData as FlowNode["data"],
  };
  ctx.setNodes((current) => [
    ...current.map((node) => ({ ...node, selected: false })),
    dropped,
  ]);
}

/** Cursor → sidebar card → press → ghost → drag to canvas → drop. */
function scheduleCategoryDrop(
  ctx: DemoContext,
  startAt: number,
  drop: DropArgs,
  label: string,
  eyebrow: string,
) {
  ctx.scheduleStep(startAt, () => {
    ctx.setSidebarHighlightLabel(label);
  });

  ctx.scheduleStep(startAt + sp(350), () => {
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({ cursor: center, ghost: null });
  });

  ctx.scheduleStep(startAt + sp(1050), () => {
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({ cursor: center, ghost: null, pressing: true });
  });

  ctx.scheduleStep(startAt + sp(1250), () => {
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({
      cursor: center,
      ghost: { x: center.x - 20, y: center.y - 18, eyebrow, label },
    });
  });

  ctx.scheduleStep(startAt + sp(1500), () => {
    const target = ctx.flowToScreen(drop.position);
    ctx.setOverlay({
      cursor: target,
      ghost: { x: target.x - 20, y: target.y - 18, eyebrow, label },
    });
  });

  ctx.scheduleStep(startAt + sp(2250), () => {
    const target = ctx.flowToScreen(drop.position);
    placeNode(ctx, drop);
    ctx.setOverlay({ cursor: target, ghost: null, pressing: true });
    ctx.setSidebarHighlightLabel(undefined);
  });
}

export const showCodeDemo: HelpDemo = {
  id: "show-code",
  title: "Inspect node code",
  description:
    "Every calculation node is backed by Python — open the ⋯ menu, pick Show Code, read the source.",
  category: "Canvas basics",

  run(ctx) {
    const sha256 = findTemplate(SHA256_LABEL);
    if (!sha256) return;

    ctx.setViewport(VIEWPORT);
    ctx.setNodes(() => []);
    ctx.setEdges(() => []);

    if (typeof window !== "undefined") {
      ctx.setOverlay({
        cursor: { x: window.innerWidth * 0.55, y: window.innerHeight - 80 },
        ghost: null,
      });
    }

    const DROP_DURATION = sp(2250);

    // — Beat 1: drop the node ————————————————————————————————
    ctx.scheduleStep(0, () => {
      ctx.setCaption({
        step: "1 / 5",
        title: "Drop a hash node",
        body:
          "Every calculation node is backed by Python. Let's drop a SHA-256 to inspect its source.",
      });
    });
    scheduleCategoryDrop(
      ctx,
      0,
      {
        template: sha256,
        nodeId: SHA256_NODE_ID,
        position: SHA256_POSITION,
        override: (data) => ({
          ...data,
          inputs: { ...(data.inputs as object | undefined), val: "" },
          result: "",
          dirty: false,
        }),
      },
      SHA256_LABEL,
      "Hashes",
    );
    const dropEnd = DROP_DURATION;

    // — Beat 2: open the node's ⋯ menu ————————————————————————
    const beat2At = dropEnd + sp(500);
    ctx.scheduleStep(beat2At, () => {
      ctx.setCaption({
        step: "2 / 5",
        title: "Open the node's menu",
        body:
          "Each node has a ⋯ button in its header — that's where 'Show Code' lives.",
      });
      const button = findNodeMenuButton(SHA256_NODE_ID);
      if (!button) return;
      ctx.setOverlay({
        cursor: withCursorTipAt(getElementCenter(button)),
        ghost: null,
      });
    });

    // Press ⋯ (Radix dropdown opens on pointerdown, not click).
    const openMenuAt = beat2At + sp(650);
    ctx.scheduleStep(openMenuAt, () => {
      const button = findNodeMenuButton(SHA256_NODE_ID);
      if (!button) return;
      ctx.setOverlay({
        cursor: withCursorTipAt(getElementCenter(button)),
        ghost: null,
        pressing: true,
      });
      dispatchPointerDown(button);
    });

    // — Beat 3: pick "Show Code" ——————————————————————————————
    const moveToItemAt = openMenuAt + sp(450);
    ctx.scheduleStep(moveToItemAt, () => {
      ctx.setCaption({
        step: "3 / 5",
        title: 'Pick "Show Code"',
        body:
          "Opens a dialog with the exact Python function this node runs — syntax-highlighted and read-only.",
      });
      const item = findMenuItemByText("Show Code");
      if (!item) return;
      ctx.setOverlay({
        cursor: withCursorTipAt(getElementCenter(item)),
        ghost: null,
      });
    });

    const clickItemAt = moveToItemAt + sp(550);
    ctx.scheduleStep(clickItemAt, () => {
      const item = findMenuItemByText("Show Code");
      if (!item) return;
      ctx.setOverlay({
        cursor: withCursorTipAt(getElementCenter(item)),
        ghost: null,
        pressing: true,
      });
      item.click();
    });

    // — Beat 4: read the source and scroll through it ————————————
    const readBeatAt = clickItemAt + sp(900);
    ctx.scheduleStep(readBeatAt, () => {
      ctx.setCaption({
        step: "4 / 5",
        title: "Read the source",
        body:
          "Syntax-highlighted, read-only. Scroll through to see helpers and imports the function pulls in.",
      });
    });
    const scrollMidAt = readBeatAt + sp(1400);
    ctx.scheduleStep(scrollMidAt, () => {
      scrollCodeDialogTo(0.45);
    });
    const scrollBottomAt = scrollMidAt + sp(1800);
    ctx.scheduleStep(scrollBottomAt, () => {
      scrollCodeDialogTo(0.85);
    });
    const scrollBackAt = scrollBottomAt + sp(1600);
    ctx.scheduleStep(scrollBackAt, () => {
      scrollCodeDialogTo(0);
    });

    // — Beat 5: close the dialog ——————————————————————————————
    const closeBeatAt = scrollBackAt + sp(1100);
    ctx.scheduleStep(closeBeatAt, () => {
      ctx.setCaption({
        step: "5 / 5",
        title: "Close when done",
        body:
          "Dismiss the dialog with the Close button (or press Escape) to return to the canvas.",
      });
      const close = findMenuItemByText("Close");
      if (!close) return;
      ctx.setOverlay({
        cursor: withCursorTipAt(getElementCenter(close)),
        ghost: null,
      });
    });

    const clickCloseAt = closeBeatAt + sp(700);
    ctx.scheduleStep(clickCloseAt, () => {
      const close = findMenuItemByText("Close");
      if (!close) return;
      ctx.setOverlay({
        cursor: withCursorTipAt(getElementCenter(close)),
        ghost: null,
        pressing: true,
      });
      close.click();
    });

    // Final: leave a "Done" caption + Replay control; cursor hidden.
    const demoEndsAt = clickCloseAt + sp(1200);
    ctx.scheduleStep(demoEndsAt, () => {
      ctx.setNodes((current) =>
        current.map((node) =>
          node.selected ? { ...node, selected: false } : node,
        ),
      );
      ctx.setCaption({
        step: "Done",
        title: "You've seen the source",
        body:
          "Press Replay to watch again, or pick another demo from the panel on the right.",
      });
      ctx.setOverlay({ cursor: null, ghost: null });
    });
  },
};
