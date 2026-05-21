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
  scrollCodeDialogTo,
  withCursorTipAt,
} from "../runtime/helpers";
import type { DemoStep, DemoStepContext, HelpDemo } from "../types";

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
    /* fall back */
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

function scheduleCategoryDrop(
  ctx: DemoStepContext,
  drop: DropArgs,
  label: string,
  eyebrow: string,
) {
  ctx.scheduleStep(0, () => {
    ctx.setSidebarHighlightLabel(label);
  });
  ctx.scheduleStep(sp(350), () => {
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({ cursor: center, ghost: null });
  });
  ctx.scheduleStep(sp(1050), () => {
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({ cursor: center, ghost: null, pressing: true });
  });
  ctx.scheduleStep(sp(1250), () => {
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({
      cursor: center,
      ghost: { x: center.x - 20, y: center.y - 18, eyebrow, label },
    });
  });
  ctx.scheduleStep(sp(1500), () => {
    const target = ctx.flowToScreen(drop.position);
    ctx.setOverlay({
      cursor: target,
      ghost: { x: target.x - 20, y: target.y - 18, eyebrow, label },
    });
  });
  ctx.scheduleStep(sp(2250), () => {
    const target = ctx.flowToScreen(drop.position);
    placeNode(ctx, drop);
    ctx.setOverlay({ cursor: target, ghost: null, pressing: true });
    ctx.setSidebarHighlightLabel(undefined);
  });
}

const STEP_COUNT = 6;

function makeSteps(): DemoStep[] {
  return [
    {
      id: "drop-sha256",
      caption: {
        step: `1 / ${STEP_COUNT}`,
        title: "Drop a hash node",
        body:
          "Every calculation node is backed by Python. Let's drop a SHA-256 to inspect its source.",
      },
      durationMs: sp(2250) + 400,
      play(ctx) {
        const tpl = findTemplate(SHA256_LABEL);
        if (!tpl) return;
        scheduleCategoryDrop(
          ctx,
          {
            template: tpl,
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
      },
    },
    {
      id: "open-menu",
      caption: {
        step: `2 / ${STEP_COUNT}`,
        title: "Open the node's menu",
        body:
          "Each node has a ⋯ button in its header — that's where 'Show Code' lives.",
      },
      durationMs: sp(650) + sp(300) + 400,
      play(ctx) {
        ctx.scheduleStep(0, () => {
          const button = findNodeMenuButton(SHA256_NODE_ID);
          if (!button) return;
          ctx.setOverlay({
            cursor: withCursorTipAt(getElementCenter(button)),
            ghost: null,
          });
        });
        ctx.scheduleStep(sp(650), () => {
          const button = findNodeMenuButton(SHA256_NODE_ID);
          if (!button) return;
          ctx.setOverlay({
            cursor: withCursorTipAt(getElementCenter(button)),
            ghost: null,
            pressing: true,
          });
          dispatchPointerDown(button);
        });
      },
    },
    {
      id: "pick-show-code",
      caption: {
        step: `3 / ${STEP_COUNT}`,
        title: 'Pick "Show Code"',
        body:
          "Opens a dialog with the exact Python function this node runs — syntax-highlighted and read-only.",
      },
      durationMs: sp(450) + sp(550) + 400,
      play(ctx) {
        ctx.scheduleStep(0, () => {
          const item = findMenuItemByText("Show Code");
          if (!item) return;
          ctx.setOverlay({
            cursor: withCursorTipAt(getElementCenter(item)),
            ghost: null,
          });
        });
        ctx.scheduleStep(sp(450), () => {
          const item = findMenuItemByText("Show Code");
          if (!item) return;
          ctx.setOverlay({
            cursor: withCursorTipAt(getElementCenter(item)),
            ghost: null,
            pressing: true,
          });
          item.click();
        });
      },
    },
    {
      id: "read-source",
      caption: {
        step: `4 / ${STEP_COUNT}`,
        title: "Read the source",
        body:
          "Syntax-highlighted, read-only. Scroll through to see helpers and imports the function pulls in.",
      },
      durationMs: sp(1400) + sp(1800) + sp(1600) + sp(900),
      play(ctx) {
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
        step: `5 / ${STEP_COUNT}`,
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

  init(ctx) {
    ctx.setViewport(VIEWPORT);
    ctx.setNodes(() => []);
    ctx.setEdges(() => []);
  },

  steps: makeSteps(),
};
