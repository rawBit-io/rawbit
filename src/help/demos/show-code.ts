// src/help/demos/show-code.ts
// Help demo broken into discrete steps so the runtime can pause/play and
// jump forward/back between them.

import { allSidebarNodes } from "@/components/sidebar-nodes";
import type { FlowNode, NodeTemplate } from "@/types";

import {
  dispatchPointerDown,
  findMenuItemByText,
  findNodeMenuButton,
  getElementCenter,
  getRectCursorCenter,
  getSidebarNodeSourceRect,
  getSidebarSearchInputRect,
  scrollCodeDialogTo,
  withCursorTipAt,
} from "../runtime/helpers";
import type { DemoStep, DemoStepContext, HelpDemo } from "../types";

const VARINT_LABEL = "Int → VarInt";
const VARINT_NODE_ID = "node_help_demo_code_varint";
const VARINT_POSITION = { x: 220, y: 180 };

const VIEWPORT = { x: 0, y: 0, zoom: 1 };

const SPEEDUP = 1.5;
const sp = (ms: number) => Math.round(ms / SPEEDUP);
const MENU_BUTTON_PRESS_AT = sp(650);
const SHOW_CODE_CURSOR_AT = MENU_BUTTON_PRESS_AT + 450;
const SHOW_CODE_PRESS_AT = SHOW_CODE_CURSOR_AT + 550;
const SHOW_CODE_CLICK_AT = SHOW_CODE_PRESS_AT + 850;
const SEARCH_TYPE_DELAY = 150;
const VARINT_SEARCH_QUERY = "var";
const VARINT_DROP_DURATION =
  sp(650) +
  sp(250) +
  VARINT_SEARCH_QUERY.length * SEARCH_TYPE_DELAY +
  sp(450) +
  sp(1900) +
  400;

function cloneTemplateData(template: NodeTemplate): Record<string, unknown> {
  const source = template.nodeData as Record<string, unknown>;
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(source);
    }
  } catch {
    /* fall back */
  }
  return JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
}

function findTemplate(label: string): NodeTemplate | undefined {
  return allSidebarNodes.find((node) => node.label === label);
}

function getShowCodeItem() {
  return findMenuItemByText("Show Code");
}

function isCodeDialogOpen() {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(".syntax-highlighter-container"));
}

function setCursorOnShowCodeItem(
  ctx: DemoStepContext,
  opts: { pressing?: boolean; clickPulse?: boolean } = {},
) {
  const item = getShowCodeItem();
  if (!item) return;
  ctx.setOverlay({
    cursor: withCursorTipAt(getElementCenter(item)),
    ghost: null,
    pressing: opts.pressing,
    clickPulse: opts.clickPulse,
  });
}

function openCodeDialog(ctx?: DemoStepContext, attempts = 0) {
  // Abort if the demo was stopped / tab switched (NB-21): this rAF loop
  // schedules directly via window.requestAnimationFrame, so it must check
  // ownership itself or it keeps clicking the live DOM after Stop.
  if (ctx && !ctx.isRunning()) return;
  if (isCodeDialogOpen()) {
    ctx?.setOverlay({ cursor: null, ghost: null });
    return;
  }

  const item = getShowCodeItem();
  if (item) {
    item.click();
    ctx?.setOverlay({ cursor: null, ghost: null });
    return;
  }

  if (attempts === 0 || attempts % 2 === 0) {
    const button = findNodeMenuButton(VARINT_NODE_ID);
    if (button) dispatchPointerDown(button);
  }
  if (attempts >= 10 || typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    openCodeDialog(ctx, attempts + 1);
  });
}

interface DropArgs {
  template: NodeTemplate;
  nodeId: string;
  position: { x: number; y: number };
  override?: (data: Record<string, unknown>) => Record<string, unknown>;
}

function placeNode(
  ctx: DemoStepContext,
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
    ...current
      .filter((node) => node.id !== nodeId)
      .map((node) => ({ ...node, selected: false })),
    dropped,
  ]);
}

function scheduleSearchDrop(
  ctx: DemoStepContext,
  drop: DropArgs,
  label: string,
  eyebrow: string,
  query: string,
) {
  ctx.scheduleStep(0, () => {
    ctx.setSidebarSearch("");
    const center = getRectCursorCenter(getSidebarSearchInputRect());
    ctx.setOverlay({ cursor: center, ghost: null });
  });

  const focusAt = sp(650);
  ctx.scheduleStep(focusAt, () => {
    const center = getRectCursorCenter(getSidebarSearchInputRect());
    ctx.setOverlay({ cursor: center, ghost: null, pressing: true });
  });

  const typeStart = focusAt + sp(250);
  for (let i = 1; i <= query.length; i += 1) {
    const partial = query.slice(0, i);
    ctx.scheduleStep(typeStart + i * SEARCH_TYPE_DELAY, () => {
      ctx.setSidebarSearch(partial);
      const center = getRectCursorCenter(getSidebarSearchInputRect());
      ctx.setOverlay({ cursor: center, ghost: null });
    });
  }

  const typeEnd = typeStart + query.length * SEARCH_TYPE_DELAY;
  const moveToCard = typeEnd + sp(450);
  ctx.scheduleStep(moveToCard, () => {
    ctx.setSidebarHighlightLabel(label);
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({ cursor: center, ghost: null });
  });

  ctx.scheduleStep(moveToCard + sp(700), () => {
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({ cursor: center, ghost: null, pressing: true });
  });

  ctx.scheduleStep(moveToCard + sp(900), () => {
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({
      cursor: center,
      ghost: { x: center.x - 20, y: center.y - 18, eyebrow, label },
    });
  });

  ctx.scheduleStep(moveToCard + sp(1150), () => {
    const target = ctx.flowToScreen(drop.position);
    ctx.setOverlay({
      cursor: target,
      ghost: { x: target.x - 20, y: target.y - 18, eyebrow, label },
    });
  });

  const dropAt = moveToCard + sp(1900);
  ctx.scheduleStep(dropAt, () => {
    const target = ctx.flowToScreen(drop.position);
    placeNode(ctx, drop);
    ctx.setOverlay({ cursor: target, ghost: null, pressing: true });
    ctx.setSidebarSearch("");
    ctx.setSidebarHighlightLabel(undefined);
  });

  return dropAt + 200;
}

const STEP_COUNT = 5;

function makeSteps(): DemoStep[] {
  return [
    {
      id: "drop-varint",
      caption: {
        step: `1 / ${STEP_COUNT}`,
        title: "Drop a VarInt node",
        body:
          "Search for VarInt, drop Int → VarInt, then inspect the Python behind it.",
      },
      durationMs: VARINT_DROP_DURATION,
      play(ctx) {
        const tpl = findTemplate(VARINT_LABEL);
        if (!tpl) return;
        scheduleSearchDrop(
          ctx,
          {
            template: tpl,
            nodeId: VARINT_NODE_ID,
            position: VARINT_POSITION,
            override: (data) => ({
              ...data,
              inputs: { ...(data.inputs as object | undefined), val: "" },
              result: "",
              dirty: false,
            }),
          },
          VARINT_LABEL,
          "Encoding & Script Data",
          VARINT_SEARCH_QUERY,
        );
      },
    },
    {
      id: "open-show-code",
      caption: {
        step: `2 / ${STEP_COUNT}`,
        title: "Open Show Code",
        body:
          "Use the node's ⋯ menu and choose Show Code to open its Python function.",
      },
      durationMs: SHOW_CODE_CLICK_AT + 500,
      play(ctx) {
        ctx.scheduleStep(0, () => {
          const button = findNodeMenuButton(VARINT_NODE_ID);
          if (!button) return;
          ctx.setOverlay({
            cursor: withCursorTipAt(getElementCenter(button)),
            ghost: null,
          });
        });
        ctx.scheduleStep(MENU_BUTTON_PRESS_AT, () => {
          const button = findNodeMenuButton(VARINT_NODE_ID);
          if (!button) return;
          ctx.setOverlay({
            cursor: withCursorTipAt(getElementCenter(button)),
            ghost: null,
            pressing: true,
          });
          dispatchPointerDown(button);
        });
        ctx.scheduleStep(SHOW_CODE_CURSOR_AT, () =>
          setCursorOnShowCodeItem(ctx),
        );
        ctx.scheduleStep(SHOW_CODE_PRESS_AT, () => {
          setCursorOnShowCodeItem(ctx, {
            pressing: true,
            clickPulse: true,
          });
        });
        ctx.scheduleStep(SHOW_CODE_CLICK_AT, () => openCodeDialog(ctx));
      },
    },
    {
      id: "read-source",
      caption: {
        step: `3 / ${STEP_COUNT}`,
        title: "Read the source",
        body:
          "Syntax-highlighted, read-only. Scroll through to see helpers and imports the function pulls in.",
      },
      durationMs: sp(1400) + sp(1800) + sp(1600) + sp(900),
      play(ctx) {
        ctx.scheduleStep(0, () => openCodeDialog());
        ctx.scheduleStep(sp(1400), () => scrollCodeDialogTo(0.45));
        ctx.scheduleStep(sp(1400) + sp(1800), () => scrollCodeDialogTo(0.85));
        ctx.scheduleStep(
          sp(1400) + sp(1800) + sp(1600),
          () => scrollCodeDialogTo(0),
        );
      },
    },
    {
      id: "close-dialog",
      caption: {
        step: `4 / ${STEP_COUNT}`,
        title: "Close when done",
        body:
          "Dismiss the dialog with the Close button (or press Escape) to return to the canvas.",
      },
      durationMs: sp(700) + 400,
      play(ctx) {
        ctx.scheduleStep(0, () => {
          const close = findMenuItemByText("Close");
          if (!close) return;
          ctx.setOverlay({
            cursor: withCursorTipAt(getElementCenter(close)),
            ghost: null,
          });
        });
        ctx.scheduleStep(sp(700), () => {
          const close = findMenuItemByText("Close");
          if (!close) return;
          ctx.setOverlay({
            cursor: withCursorTipAt(getElementCenter(close)),
            ghost: null,
            pressing: true,
          });
          close.click();
        });
      },
    },
    {
      id: "complete",
      caption: {
        step: "Done",
        title: "You've seen the source",
        body:
          "Every node works the same way: ⋯ menu → Show Code. Use the controls to replay or step back.",
      },
      durationMs: 200,
      play(ctx) {
        ctx.setNodes((current) =>
          current.map((node) =>
            node.selected ? { ...node, selected: false } : node,
          ),
        );
        ctx.setOverlay({ cursor: null, ghost: null });
      },
    },
  ];
}

export const showCodeDemo: HelpDemo = {
  id: "show-code",
  title: "Inspect node code",
  description: "Open any node's Python source.",
  category: "Canvas basics",
  incrementalForward: true,

  init(ctx) {
    ctx.setViewport(VIEWPORT);
    ctx.setNodes(() => []);
    ctx.setEdges(() => []);
  },

  steps: makeSteps(),
};
