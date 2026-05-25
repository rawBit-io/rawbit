// src/help/demos/drop-and-connect.ts
// First help demo, broken into discrete steps so the runtime can pause/play
// and jump forward/back between them.

import type { Edge } from "@xyflow/react";

import { allSidebarNodes } from "@/components/sidebar-nodes";
import { setVal } from "@/lib/utils";
import type { FlowNode, NodeTemplate } from "@/types";

import {
  getHandleScreenPosition,
  getRectCursorCenter,
  getSidebarNodeSourceRect,
  getSidebarSearchInputRect,
  withCursorTipAt,
} from "../runtime/helpers";
import type { DemoStep, DemoStepContext, HelpDemo } from "../types";

const TX_LABEL = "TX Template legacy";
const VARINT_LABEL = "Int → VarInt";
const INPUT_LABEL = "Input";
const INPUT_TITLE = "Input Count";

const TX_NODE_ID = "node_help_demo_tx_template";
const VARINT_NODE_ID = "node_help_demo_varint";
const INPUT_NODE_ID = "node_help_demo_input";
const INPUT_TO_VARINT_EDGE = "edge_help_demo_input_to_varint";
const VARINT_TO_TX_EDGE = "edge_help_demo_varint_to_tx";

const TX_POSITION = { x: 865, y: 90 };
const VARINT_POSITION = { x: 470, y: 225 };
const INPUT_POSITION = { x: 80, y: 130 };

const VIEWPORT = { x: 0, y: 0, zoom: 1 };

const SPEEDUP = 1.5;
const sp = (ms: number) => Math.round(ms / SPEEDUP);

/* ----------------- shared helpers (reused across steps) ----------------- */

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
      .filter((node) => node.id !== nodeId) // re-runnable: never duplicate
      .map((node) => ({ ...node, selected: false })),
    dropped,
  ]);
}

function scheduleCategoryDrop(
  ctx: DemoStepContext,
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

  return sp(2250) + 200;
}

const SEARCH_TYPE_DELAY = 150; // text typing — intentionally unscaled

function scheduleSearchDrop(
  ctx: DemoStepContext,
  startAt: number,
  drop: DropArgs,
  label: string,
  eyebrow: string,
  query: string,
) {
  ctx.scheduleStep(startAt, () => {
    ctx.setSidebarSearch("");
    const center = getRectCursorCenter(getSidebarSearchInputRect());
    ctx.setOverlay({ cursor: center, ghost: null });
  });

  const focusAt = startAt + sp(750);
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
  });

  return dropAt - startAt + 200;
}

const CONN_MOVE = sp(620);
const CONN_GRAB = sp(300);
const CONN_DRAG = sp(880);
const CONN_SETTLE = sp(260);
const CONN_TOTAL = CONN_MOVE + CONN_GRAB + CONN_DRAG + CONN_SETTLE;

function scheduleConnect(
  ctx: DemoStepContext,
  startAt: number,
  sourceNodeId: string,
  targetNodeId: string,
  targetHandleId: string,
  sourceFallback: { x: number; y: number },
  targetFallback: { x: number; y: number },
  onRelease: () => void,
) {
  const resolveSource = () =>
    getHandleScreenPosition(sourceNodeId, "source", null) ??
    ctx.flowToScreen(sourceFallback);
  const resolveTarget = () =>
    getHandleScreenPosition(targetNodeId, "target", targetHandleId) ??
    ctx.flowToScreen(targetFallback);

  ctx.scheduleStep(startAt, () => {
    ctx.setOverlay({
      cursor: withCursorTipAt(resolveSource()),
      ghost: null,
    });
  });

  ctx.scheduleStep(startAt + CONN_MOVE, () => {
    const src = resolveSource();
    ctx.setOverlay({
      cursor: withCursorTipAt(src),
      ghost: null,
      pressing: true,
      connection: src,
    });
  });

  ctx.scheduleStep(startAt + CONN_MOVE + CONN_GRAB, () => {
    const src = resolveSource();
    ctx.setOverlay({
      cursor: withCursorTipAt(resolveTarget()),
      ghost: null,
      pressing: true,
      connection: src,
    });
  });

  ctx.scheduleStep(startAt + CONN_TOTAL, () => {
    onRelease();
    ctx.setOverlay({
      cursor: withCursorTipAt(resolveTarget()),
      ghost: null,
      connection: null,
    });
  });

  return CONN_TOTAL + 200;
}

const TITLE_TYPE_DELAY = 85; // text typing — NOT scaled

function scheduleRename(
  ctx: DemoStepContext,
  startAt: number,
  nodeId: string,
  baseTitle: string,
  fullTitle: string,
  cursorPoint: { x: number; y: number },
) {
  ctx.scheduleStep(startAt, () => {
    ctx.setOverlay({ cursor: ctx.flowToScreen(cursorPoint), ghost: null });
  });

  ctx.scheduleStep(startAt + sp(450), () => {
    ctx.setOverlay({
      cursor: ctx.flowToScreen(cursorPoint),
      ghost: null,
      pressing: true,
    });
  });

  const typeStart = startAt + sp(700);
  for (let i = baseTitle.length + 1; i <= fullTitle.length; i += 1) {
    const partial = fullTitle.slice(0, i);
    ctx.scheduleStep(
      typeStart + (i - baseTitle.length) * TITLE_TYPE_DELAY,
      () => {
        ctx.setNodes((current) =>
          current.map((node) => {
            if (node.id !== nodeId) return node;
            const existing = (node.data ?? {}) as Record<string, unknown>;
            return {
              ...node,
              data: { ...existing, title: partial } as FlowNode["data"],
            };
          }),
        );
      },
    );
  }
  const dur =
    sp(700) +
    (fullTitle.length - baseTitle.length) * TITLE_TYPE_DELAY -
    startAt;
  return dur + 200;
}

/* ----------------- steps ----------------- */

const STEP_COUNT = 8;

function makeSteps(): DemoStep[] {
  return [
    {
      id: "drop-tx-template",
      caption: {
        step: `1 / ${STEP_COUNT}`,
        title: "Drop a transaction template",
        body:
          "Drag the TX Template legacy from the Transactions category to lay down the skeleton of a transaction.",
      },
      durationMs: sp(2250) + 400,
      play(ctx) {
        const tpl = findTemplate(TX_LABEL);
        if (!tpl) return;
        scheduleCategoryDrop(
          ctx,
          0,
          {
            template: tpl,
            nodeId: TX_NODE_ID,
            position: TX_POSITION,
            override: (data) => ({
              ...data,
              inputs: { ...(data.inputs as object | undefined), vals: {} },
              result: "",
              dirty: false,
            }),
          },
          TX_LABEL,
          "Transactions",
        );
      },
    },
    {
      id: "search-varint",
      caption: {
        step: `2 / ${STEP_COUNT}`,
        title: "Search the sidebar",
        body:
          "Don't see the node you need? Type into the sidebar search — try 'varint' to find Int → VarInt instantly.",
      },
      durationMs: sp(1000) + 6 * SEARCH_TYPE_DELAY + sp(450) + sp(1900) + 400,
      play(ctx) {
        const tpl = findTemplate(VARINT_LABEL);
        if (!tpl) return;
        scheduleSearchDrop(
          ctx,
          0,
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
          "varint",
        );
      },
    },
    {
      id: "drop-input",
      caption: {
        step: `3 / ${STEP_COUNT}`,
        title: "Drop the Input",
        body:
          "Input nodes are the entry points of every flow — they're where you type raw data.",
      },
      durationMs: sp(2250) + 400,
      play(ctx) {
        const tpl = findTemplate(INPUT_LABEL);
        if (!tpl) return;
        scheduleCategoryDrop(
          ctx,
          0,
          {
            template: tpl,
            nodeId: INPUT_NODE_ID,
            position: INPUT_POSITION,
            override: (data) => ({
              ...data,
              value: "",
              inputs: { ...(data.inputs as object | undefined), val: "" },
              result: "",
              dirty: false,
            }),
          },
          INPUT_LABEL,
          "Canvas & Inputs",
        );
      },
    },
    {
      id: "rename-input",
      caption: {
        step: `4 / ${STEP_COUNT}`,
        title: "Rename on the canvas",
        body:
          "Click a node's title to rename it. Good names make complex flows readable.",
      },
      durationMs:
        sp(700) +
        (INPUT_TITLE.length - INPUT_LABEL.length) * TITLE_TYPE_DELAY +
        400,
      play(ctx) {
        // Make sure the title resets each time this step plays so the
        // typing always starts from "Input" and ends at "Input Count".
        ctx.setNodes((current) =>
          current.map((node) =>
            node.id === INPUT_NODE_ID
              ? {
                  ...node,
                  data: { ...(node.data ?? {}), title: INPUT_LABEL } as
                    FlowNode["data"],
                }
              : node,
          ),
        );
        scheduleRename(
          ctx,
          0,
          INPUT_NODE_ID,
          INPUT_LABEL,
          INPUT_TITLE,
          { x: INPUT_POSITION.x + 50, y: INPUT_POSITION.y + 24 },
        );
      },
    },
    {
      id: "type-value",
      caption: {
        step: `5 / ${STEP_COUNT}`,
        title: "Type a value",
        body:
          "Click into an input field and type — every downstream result recomputes live as you change values.",
      },
      durationMs: sp(500) + 400,
      play(ctx) {
        ctx.scheduleStep(0, () => {
          ctx.setOverlay({
            cursor: ctx.flowToScreen({
              x: INPUT_POSITION.x + 72,
              y: INPUT_POSITION.y + 96,
            }),
            ghost: null,
          });
        });
        ctx.scheduleStep(sp(500), () => {
          ctx.setNodes((current) =>
            current.map((node) => {
              if (node.id !== INPUT_NODE_ID) return node;
              const existing = (node.data ?? {}) as Record<string, unknown>;
              const existingInputs =
                (existing.inputs as Record<string, unknown> | undefined) ?? {};
              return {
                ...node,
                data: {
                  ...existing,
                  value: "1",
                  inputs: { ...existingInputs, val: "1" },
                  result: "1",
                  dirty: false,
                } as FlowNode["data"],
              };
            }),
          );
        });
      },
    },
    {
      id: "connect-input-varint",
      caption: {
        step: `6 / ${STEP_COUNT}`,
        title: "Connect ports",
        body:
          "Drag from a node's right-side output port to another node's left-side input port to wire them together.",
      },
      durationMs: CONN_TOTAL + 400,
      play(ctx) {
        // Always remove the edge first so the connect animation reads as fresh.
        ctx.setEdges((current) =>
          current.filter((edge) => edge.id !== INPUT_TO_VARINT_EDGE),
        );
        scheduleConnect(
          ctx,
          0,
          INPUT_NODE_ID,
          VARINT_NODE_ID,
          "input-0",
          {
            x: INPUT_POSITION.x + 250,
            y: INPUT_POSITION.y + 78,
          },
          { x: VARINT_POSITION.x, y: VARINT_POSITION.y + 72 },
          () => {
            ctx.setEdges((current) => [
              ...current.filter((edge) => edge.id !== INPUT_TO_VARINT_EDGE),
              {
                id: INPUT_TO_VARINT_EDGE,
                source: INPUT_NODE_ID,
                target: VARINT_NODE_ID,
                targetHandle: "input-0",
                selected: false,
              } as Edge,
            ]);
            ctx.setNodes((current) =>
              current.map((node) => {
                if (node.id !== VARINT_NODE_ID) return node;
                const existing = (node.data ?? {}) as Record<string, unknown>;
                const existingInputs =
                  (existing.inputs as Record<string, unknown> | undefined) ??
                  {};
                return {
                  ...node,
                  selected: false,
                  data: {
                    ...existing,
                    inputs: { ...existingInputs, val: "1" },
                    result: "01",
                    dirty: false,
                  } as FlowNode["data"],
                };
              }),
            );
          },
        );
      },
    },
    {
      id: "connect-varint-tx",
      caption: {
        step: `7 / ${STEP_COUNT}`,
        title: "Build the chain",
        body:
          "Each connection feeds the next node. Wire the VarInt output into the template's INPUT_COUNT field to finish the mini-flow.",
      },
      durationMs: CONN_TOTAL + 400,
      play(ctx) {
        ctx.setEdges((current) =>
          current.filter((edge) => edge.id !== VARINT_TO_TX_EDGE),
        );
        scheduleConnect(
          ctx,
          0,
          VARINT_NODE_ID,
          TX_NODE_ID,
          "input-10",
          {
            x: VARINT_POSITION.x + 250,
            y: VARINT_POSITION.y + 72,
          },
          { x: TX_POSITION.x, y: TX_POSITION.y + 265 },
          () => {
            ctx.setEdges((current) => [
              ...current.filter((edge) => edge.id !== VARINT_TO_TX_EDGE),
              {
                id: VARINT_TO_TX_EDGE,
                source: VARINT_NODE_ID,
                target: TX_NODE_ID,
                targetHandle: "input-10",
                selected: false,
              } as Edge,
            ]);
            ctx.setNodes((current) =>
              current.map((node) => {
                if (node.id !== TX_NODE_ID) {
                  return { ...node, selected: false };
                }
                const existing = (node.data ?? {}) as Record<string, unknown>;
                const existingInputs =
                  (existing.inputs as Record<string, unknown> | undefined) ??
                  {};
                return {
                  ...node,
                  selected: false,
                  data: {
                    ...existing,
                    inputs: {
                      ...existingInputs,
                      vals: setVal(existingInputs.vals, 10, "01"),
                    },
                    result: "01",
                    dirty: false,
                  } as FlowNode["data"],
                };
              }),
            );
          },
        );
      },
    },
    {
      id: "complete",
      caption: {
        step: "Done",
        title: "Mini-flow complete",
        body:
          "Three nodes, wired and computing live. Use the controls to replay, step back, or pick another demo.",
      },
      durationMs: 200,
      play(ctx) {
        // Deselect everything; the caption + controls stay visible.
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

export const dropAndConnectDemo: HelpDemo = {
  id: "drop-and-connect",
  title: "Drop, type & connect",
  description: "Drop nodes, type values, wire them together.",
  category: "Canvas basics",
  incrementalForward: true,

  init(ctx) {
    ctx.setViewport(VIEWPORT);
    ctx.setNodes(() => []);
    ctx.setEdges(() => []);
  },

  steps: makeSteps(),
};
