// src/help/demos/drop-and-connect.ts
// First help demo: drop three nodes (TX template, VarInt via sidebar search,
// Input), rename the Input on canvas, type a value into it, and connect them
// port-to-port — the same gesture set the previous walkthrough used.

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
import type { DemoCaption, DemoContext, HelpDemo } from "../types";

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

function cloneTemplateData(template: NodeTemplate): Record<string, unknown> {
  const source = template.nodeData as Record<string, unknown>;
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(source);
    }
  } catch {
    /* fall through */
  }
  return JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
}

function findTemplate(label: string): NodeTemplate | undefined {
  return allSidebarNodes.find((node) => node.label === label);
}

interface PartialDrop {
  template: NodeTemplate;
  nodeId: string;
  position: { x: number; y: number };
  override?: (data: Record<string, unknown>) => Record<string, unknown>;
}

function placeNode(
  ctx: DemoContext,
  { template, nodeId, position, override }: PartialDrop
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

/**
 * Schedules the standard "grab a sidebar card and drag it to a flow position"
 * gesture. Reveals the card by label first, then animates cursor → press →
 * ghost → drag → drop.
 */
function scheduleCategoryDrop(
  ctx: DemoContext,
  startAt: number,
  drop: PartialDrop,
  label: string,
  eyebrow: string
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
      ghost: {
        x: center.x - 20,
        y: center.y - 18,
        eyebrow,
        label,
      },
    });
  });

  ctx.scheduleStep(startAt + sp(1500), () => {
    const target = ctx.flowToScreen(drop.position);
    ctx.setOverlay({
      cursor: target,
      ghost: {
        x: target.x - 20,
        y: target.y - 18,
        eyebrow,
        label,
      },
    });
  });

  ctx.scheduleStep(startAt + sp(2250), () => {
    const target = ctx.flowToScreen(drop.position);
    placeNode(ctx, drop);
    ctx.setOverlay({ cursor: target, ghost: null, pressing: true });
    ctx.setSidebarHighlightLabel(undefined);
  });
}

const SEARCH_TYPE_DELAY = 150; // text typing — intentionally NOT scaled

/**
 * The sidebar-search variant: cursor flies to the search box, types a query,
 * then drags the matched result card onto the canvas.
 */
function scheduleSearchDrop(
  ctx: DemoContext,
  startAt: number,
  drop: PartialDrop,
  label: string,
  eyebrow: string,
  query: string
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
      ghost: {
        x: target.x - 20,
        y: target.y - 18,
        eyebrow,
        label,
      },
    });
  });

  const dropAt = moveToCard + sp(1900);
  ctx.scheduleStep(dropAt, () => {
    const target = ctx.flowToScreen(drop.position);
    placeNode(ctx, drop);
    ctx.setOverlay({ cursor: target, ghost: null, pressing: true });
    ctx.setSidebarSearch("");
  });

  return dropAt - startAt;
}

const CONN_MOVE = sp(620);
const CONN_GRAB = sp(300);
const CONN_DRAG = sp(880);
const CONN_SETTLE = sp(260);
const CONN_TOTAL = CONN_MOVE + CONN_GRAB + CONN_DRAG + CONN_SETTLE;

/**
 * Animates a port-to-port connection drag: cursor glides to the source
 * handle, presses, the wire follows the cursor across to the target handle,
 * then `onRelease` adds the real edge and clears the wire.
 */
function scheduleConnect(
  ctx: DemoContext,
  startAt: number,
  sourceNodeId: string,
  targetNodeId: string,
  targetHandleId: string,
  sourceFallback: { x: number; y: number },
  targetFallback: { x: number; y: number },
  onRelease: () => void
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

  return CONN_TOTAL;
}

const TITLE_TYPE_DELAY = 85; // text typing — NOT scaled

function scheduleRename(
  ctx: DemoContext,
  startAt: number,
  nodeId: string,
  baseTitle: string,
  fullTitle: string,
  cursorPoint: { x: number; y: number }
) {
  ctx.scheduleStep(startAt, () => {
    ctx.setOverlay({
      cursor: ctx.flowToScreen(cursorPoint),
      ghost: null,
    });
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
          })
        );
      }
    );
  }
  return (
    typeStart +
    (fullTitle.length - baseTitle.length) * TITLE_TYPE_DELAY -
    startAt
  );
}

export const dropAndConnectDemo: HelpDemo = {
  id: "drop-and-connect",
  title: "Drop, type & connect",
  description:
    "Build a 3-node mini-flow: drop the nodes, rename one, type a value, wire ports together.",
  category: "Canvas basics",

  run(ctx) {
    const txTemplate = findTemplate(TX_LABEL);
    const varIntTemplate = findTemplate(VARINT_LABEL);
    const inputTemplate = findTemplate(INPUT_LABEL);
    if (!txTemplate || !varIntTemplate || !inputTemplate) return;

    ctx.setViewport(VIEWPORT);

    // Start with a clean canvas.
    ctx.setNodes(() => []);
    ctx.setEdges(() => []);

    // Cursor fades in from the lower right corner.
    if (typeof window !== "undefined") {
      ctx.setOverlay({
        cursor: { x: window.innerWidth * 0.55, y: window.innerHeight - 80 },
        ghost: null,
      });
    }

    const DROP_DURATION = sp(2250);

    // Inline helper: schedule a caption beat (persists until the next call).
    const narrate = (at: number, caption: DemoCaption) => {
      ctx.scheduleStep(at, () => ctx.setCaption(caption));
    };

    // 1. TX template — dragged from its category.
    narrate(0, {
      step: "1 / 7",
      title: "Drop a transaction template",
      body:
        "Drag the TX Template legacy from the Transactions category to lay down the skeleton of a transaction.",
    });
    scheduleCategoryDrop(
      ctx,
      0,
      {
        template: txTemplate,
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
      "Transactions"
    );
    const txEnd = DROP_DURATION;

    // 2. VarInt — lives deeper in the sidebar, so search for it first.
    const varIntStart = txEnd + sp(450);
    narrate(varIntStart, {
      step: "2 / 7",
      title: "Search the sidebar",
      body:
        "Don't see the node you need? Type into the sidebar search — try 'varint' to find Int → VarInt instantly.",
    });
    const varIntDuration = scheduleSearchDrop(
      ctx,
      varIntStart,
      {
        template: varIntTemplate,
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
      "varint"
    );
    const varIntEnd = varIntStart + varIntDuration;

    // 3. Input — dragged from its (open) category.
    const inputStart = varIntEnd + sp(450);
    narrate(inputStart, {
      step: "3 / 7",
      title: "Drop the Input",
      body:
        "Input nodes are the entry points of every flow — they're where you type raw data.",
    });
    scheduleCategoryDrop(
      ctx,
      inputStart,
      {
        template: inputTemplate,
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
      "Canvas & Inputs"
    );
    const inputEnd = inputStart + DROP_DURATION;

    // 4. Rename the Input title to "Input Count" live on canvas.
    narrate(inputEnd + sp(150), {
      step: "4 / 7",
      title: "Rename on the canvas",
      body:
        "Click a node's title to rename it. Naming nodes well makes complex flows readable.",
    });
    const renameDuration = scheduleRename(
      ctx,
      inputEnd + sp(350),
      INPUT_NODE_ID,
      INPUT_LABEL,
      INPUT_TITLE,
      { x: INPUT_POSITION.x + 50, y: INPUT_POSITION.y + 24 }
    );
    const renameEnd = inputEnd + sp(350) + renameDuration;

    // 5. Move to the value field, set the value to "1".
    const valueMoveAt = renameEnd + sp(350);
    narrate(valueMoveAt - sp(100), {
      step: "5 / 7",
      title: "Type a value",
      body:
        "Click into an input field and type — every downstream result recomputes live as you change values.",
    });
    ctx.scheduleStep(valueMoveAt, () => {
      ctx.setOverlay({
        cursor: ctx.flowToScreen({
          x: INPUT_POSITION.x + 72,
          y: INPUT_POSITION.y + 96,
        }),
        ghost: null,
      });
    });
    const valueSetAt = valueMoveAt + sp(500);
    ctx.scheduleStep(valueSetAt, () => {
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
        })
      );
    });

    // 6. Connect Input.output → VarInt input-0.
    const conn1Start = valueSetAt + sp(700);
    narrate(conn1Start, {
      step: "6 / 7",
      title: "Connect ports",
      body:
        "Drag from a node's right-side output port to another node's left-side input port to wire them together.",
    });
    scheduleConnect(
      ctx,
      conn1Start,
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
          ...current,
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
              (existing.inputs as Record<string, unknown> | undefined) ?? {};
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
          })
        );
      }
    );

    // 7. Connect VarInt.output → TX template input-10.
    const conn2Start = conn1Start + CONN_TOTAL + sp(240);
    narrate(conn2Start, {
      step: "7 / 7",
      title: "Build the chain",
      body:
        "Each connection feeds the next node. Wire the VarInt output into the template's INPUT_COUNT field to finish the mini-flow.",
    });
    scheduleConnect(
      ctx,
      conn2Start,
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
          ...current,
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
              (existing.inputs as Record<string, unknown> | undefined) ?? {};
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
          })
        );
      }
    );

    // 8. Final: leave a "Done" caption + Replay control; cursor hidden.
    const demoEndsAt = conn2Start + CONN_TOTAL + sp(1200);
    ctx.scheduleStep(demoEndsAt, () => {
      ctx.setNodes((current) =>
        current.map((node) =>
          node.selected ? { ...node, selected: false } : node
        )
      );
      ctx.setCaption({
        step: "Done",
        title: "Mini-flow complete",
        body:
          "Press Replay to watch again, or pick another demo from the panel on the right.",
      });
      ctx.setOverlay({ cursor: null, ghost: null });
    });
  },
};
