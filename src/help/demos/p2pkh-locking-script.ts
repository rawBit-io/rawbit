// src/help/demos/p2pkh-locking-script.ts
// Builds a P2PKH locking script from searched sidebar nodes.

import type { Edge } from "@xyflow/react";

import { allSidebarNodes } from "@/components/sidebar-nodes";
import { buildOpcodeInputState } from "@/lib/opcodeNodeData";
import type { FlowNode, NodeTemplate } from "@/types";

import {
  getHandleScreenPosition,
  getRectCursorCenter,
  getSidebarNodeSourceRect,
  getSidebarSearchInputRect,
  withCursorTipAt,
} from "../runtime/helpers";
import type { DemoStep, DemoStepContext, HelpDemo } from "../types";

const RANDOM_LABEL = "Random 32 Bytes";
const PUBKEY_LABEL = "PrivKey → PubKey";
const HASH160_LABEL = "Data → HASH160";
const PUSH_LABEL = "Data → Push Opcode";
const OPCODE_LABEL = "Opcode Sequence";
const CONCAT_LABEL = "Concat";

const RANDOM_ID = "node_help_demo_p2pkh_random";
const PUBKEY_ID = "node_help_demo_p2pkh_pubkey";
const HASH160_ID = "node_help_demo_p2pkh_hash160";
const PUSH_ID = "node_help_demo_p2pkh_push";
const PREFIX_ID = "node_help_demo_p2pkh_prefix_ops";
const SUFFIX_ID = "node_help_demo_p2pkh_suffix_ops";
const SCRIPT_ID = "node_help_demo_p2pkh_script";

const RANDOM_POSITION = { x: 0, y: 330 };
const PUBKEY_POSITION = { x: 320, y: 330 };
const HASH160_POSITION = { x: 640, y: 330 };
const PREFIX_POSITION = { x: 980, y: 40 };
const PUSH_POSITION = { x: 980, y: 430 };
const SUFFIX_POSITION = { x: 980, y: 740 };
const SCRIPT_POSITION = { x: 1320, y: 300 };

const GRAPH_BOUNDS = {
  minX: 0,
  minY: 40,
  maxX: SCRIPT_POSITION.x + 400,
  maxY: 975,
};
const VIEWPORT_PADDING = 32;
const CAPTION_RESERVED_HEIGHT = 180;
const FALLBACK_VIEWPORT = { x: 0, y: 86, zoom: 0.43 };
const MIN_DEMO_ZOOM = 0.28;

function demoViewport() {
  if (typeof document === "undefined") return FALLBACK_VIEWPORT;

  const pane = document.querySelector<HTMLElement>(".react-flow");
  const rect = pane?.getBoundingClientRect();
  const width = rect?.width ?? 0;
  const height = rect?.height ?? 0;
  if (width <= 0 || height <= 0) return FALLBACK_VIEWPORT;

  const graphWidth = GRAPH_BOUNDS.maxX - GRAPH_BOUNDS.minX;
  const graphHeight = GRAPH_BOUNDS.maxY - GRAPH_BOUNDS.minY;
  const fitHeight = Math.max(1, height - CAPTION_RESERVED_HEIGHT);
  const usableWidth = Math.max(1, width - 2 * VIEWPORT_PADDING);
  const usableHeight = Math.max(1, fitHeight - 2 * VIEWPORT_PADDING);
  const zoom = Math.max(
    MIN_DEMO_ZOOM,
    Math.min(usableWidth / graphWidth, usableHeight / graphHeight),
  );

  return {
    x: Math.round((width - graphWidth * zoom) / 2 - GRAPH_BOUNDS.minX * zoom),
    y: Math.round(
      VIEWPORT_PADDING +
        (usableHeight - graphHeight * zoom) / 2 -
        GRAPH_BOUNDS.minY * zoom,
    ),
    zoom,
  };
}

const PRIVATE_KEY =
  "3b1b1c44e2894638de9e37d1436da220d20871750cea5b8bf8831ef4b12b6f32";
const PUBKEY =
  "027bbae0eec6b6cc26292379c0f8ef6b343fced478735d92da0f2a3a52a93ddc47";
const PUBKEY_HASH = "bfa89be8ec6dc6a06e38a43934fc764f9069ceed";
const PREFIX_HEX = "76a9";
const PUSH_HEX = "14";
const SUFFIX_HEX = "88ac";

const SPEEDUP = 1.5;
const sp = (ms: number) => Math.round(ms / SPEEDUP);
const SEARCH_TYPE_DELAY = 80;
const SEARCH_DROP_SETTLE = 220;

const CONN_MOVE = sp(560);
const CONN_GRAB = sp(220);
const CONN_DRAG = sp(720);
const CONN_TOTAL = CONN_MOVE + CONN_GRAB + CONN_DRAG + sp(180);
const CONN_GAP = 120;
const OPCODE_TYPE_DELAY = 70;
const CONCAT_CONFIG_TOTAL = sp(1900);

function searchDropDuration(query: string) {
  return (
    sp(560) +
    sp(180) +
    query.length * SEARCH_TYPE_DELAY +
    sp(320) +
    sp(1450) +
    SEARCH_DROP_SETTLE
  );
}

function opcodeSelectDuration(query: string) {
  return (
    sp(220) +
    sp(140) +
    query.length * OPCODE_TYPE_DELAY +
    sp(160) +
    sp(260) +
    sp(260)
  );
}

function opcodeSequenceDuration(queries: string[]) {
  return (
    queries.reduce(
      (total, query) => total + opcodeSelectDuration(query) + sp(140),
      0,
    ) + sp(120)
  );
}

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

function getNodeElement(nodeId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${nodeId}"]`,
  );
}

function elementCenter(
  el: HTMLElement | null,
  fallback: { x: number; y: number },
) {
  if (!el) return fallback;
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
}

function findOpcodeSearchInput(nodeId: string): HTMLInputElement | null {
  return (
    getNodeElement(nodeId)?.querySelector<HTMLInputElement>(
      'input[placeholder="Search Opcodes"]',
    ) ?? null
  );
}

function findOpcodeResult(nodeId: string, opcode: string): HTMLElement | null {
  const node = getNodeElement(nodeId);
  if (!node) return null;
  return (
    Array.from(node.querySelectorAll<HTMLElement>("div")).find(
      (el) =>
        (el.textContent ?? "").includes(opcode) &&
        !el.textContent?.includes("Calculation Result"),
    ) ?? null
  );
}

function findConcatPlusButton(nodeId: string): HTMLButtonElement | null {
  const node = getNodeElement(nodeId);
  if (!node) return null;
  const plusIcon = node.querySelector<SVGElement>(".lucide-plus");
  if (plusIcon) return plusIcon.closest("button");
  const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>("button"));
  // Concat has a header menu button, then INPUTS[] minus/plus buttons.
  return buttons[2] ?? null;
}

function findRegenerateButton(nodeId: string): HTMLButtonElement | null {
  const node = getNodeElement(nodeId);
  if (!node) return null;
  const refreshIcon = node.querySelector<SVGElement>(".lucide-refresh-cw");
  return refreshIcon?.closest("button") ?? null;
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

  const focusAt = startAt + sp(560);
  ctx.scheduleStep(focusAt, () => {
    const center = getRectCursorCenter(getSidebarSearchInputRect());
    ctx.setOverlay({ cursor: center, ghost: null, pressing: true });
  });

  const typeStart = focusAt + sp(180);
  for (let i = 1; i <= query.length; i += 1) {
    const partial = query.slice(0, i);
    ctx.scheduleStep(typeStart + i * SEARCH_TYPE_DELAY, () => {
      ctx.setSidebarSearch(partial);
      const center = getRectCursorCenter(getSidebarSearchInputRect());
      ctx.setOverlay({ cursor: center, ghost: null });
    });
  }

  const typeEnd = typeStart + query.length * SEARCH_TYPE_DELAY;
  const moveToCard = typeEnd + sp(320);
  ctx.scheduleStep(moveToCard, () => {
    ctx.setSidebarHighlightLabel(label);
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({ cursor: center, ghost: null });
  });

  ctx.scheduleStep(moveToCard + sp(460), () => {
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({ cursor: center, ghost: null, pressing: true });
  });

  ctx.scheduleStep(moveToCard + sp(620), () => {
    const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
    ctx.setOverlay({
      cursor: center,
      ghost: { x: center.x - 20, y: center.y - 18, eyebrow, label },
    });
  });

  ctx.scheduleStep(moveToCard + sp(800), () => {
    const target = ctx.flowToScreen(drop.position);
    ctx.setOverlay({
      cursor: target,
      ghost: { x: target.x - 20, y: target.y - 18, eyebrow, label },
    });
  });

  const dropAt = moveToCard + sp(1450);
  ctx.scheduleStep(dropAt, () => {
    const target = ctx.flowToScreen(drop.position);
    placeNode(ctx, drop);
    ctx.setOverlay({ cursor: target, ghost: null, pressing: true });
    ctx.setSidebarSearch("");
    ctx.setSidebarHighlightLabel(undefined);
  });

  return dropAt - startAt + SEARCH_DROP_SETTLE;
}

function schedulePlacedNodeSetup(
  ctx: DemoStepContext,
  startAt: number,
  drops: Array<DropArgs & { label: string; eyebrow: string; query: string }>,
) {
  let offset = startAt;
  drops.forEach(({ label, eyebrow, query, ...drop }) => {
    offset += scheduleSearchDrop(ctx, offset, drop, label, eyebrow, query);
    offset += sp(120);
  });

  ctx.scheduleStep(offset + sp(120), () => {
    ctx.setViewport(demoViewport());
    ctx.setOverlay({ cursor: null, ghost: null });
  });

  return offset - startAt + sp(520);
}

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

  return CONN_TOTAL + CONN_GAP;
}

function updateNodeData(
  ctx: DemoStepContext,
  nodeId: string,
  updater: (data: Record<string, unknown>) => Record<string, unknown>,
) {
  ctx.setNodes((current) =>
    current.map((node) => {
      if (node.id !== nodeId) return node;
      return {
        ...node,
        data: updater((node.data ?? {}) as Record<string, unknown>) as
          FlowNode["data"],
      };
    }),
  );
}

function setConnectedValue(
  ctx: DemoStepContext,
  nodeId: string,
  inputValue: string,
  result: string,
) {
  updateNodeData(ctx, nodeId, (data) => {
    const inputs = (data.inputs as Record<string, unknown> | undefined) ?? {};
    return {
      ...data,
      inputs: { ...inputs, val: inputValue },
      result,
      dirty: false,
    };
  });
}

function addEdge(ctx: DemoStepContext, edge: Edge) {
  ctx.setEdges((current) => [
    ...current.filter((existing) => existing.id !== edge.id),
    edge,
  ]);
}

function opcodeData(names: string[], result: string) {
  return (data: Record<string, unknown>) => ({
    ...data,
    ...buildOpcodeInputState(names),
    result,
    dirty: false,
  });
}

function emptyRandomData() {
  return (data: Record<string, unknown>) => ({
    ...data,
    result: "",
    dirty: false,
    forceRegenerate: false,
  });
}

function emptySingleInputData() {
  return (data: Record<string, unknown>) => ({
    ...data,
    inputs: { val: "" },
    result: "",
    dirty: false,
  });
}

function emptyConcatData() {
  return (data: Record<string, unknown>) => ({
    ...data,
    title: "Concat",
    inputs: { vals: {} },
    result: "",
    customFieldLabels: undefined,
    groupInstances: { "INPUTS[]": 2 },
    groupInstanceKeys: { "INPUTS[]": [0, 100] },
    comment: "",
    showComment: false,
    dirty: false,
  });
}

function growConcatTo(ctx: DemoStepContext, count: number) {
  const keys = Array.from({ length: count }, (_, index) => index * 100);
  updateNodeData(ctx, SCRIPT_ID, (data) => ({
    ...data,
    groupInstances: { "INPUTS[]": count },
    groupInstanceKeys: { "INPUTS[]": keys },
    dirty: false,
  }));
}

function scheduleOpcodeSelect(
  ctx: DemoStepContext,
  startAt: number,
  nodeId: string,
  query: string,
  opcode: string,
  namesAfter: string[],
  resultAfter: string,
  fallback: { x: number; y: number },
) {
  ctx.scheduleStep(startAt, () => {
    const input = findOpcodeSearchInput(nodeId);
    ctx.setOverlay({
      cursor: withCursorTipAt(elementCenter(input, ctx.flowToScreen(fallback))),
      ghost: null,
    });
  });

  const focusAt = startAt + sp(220);
  ctx.scheduleStep(focusAt, () => {
    const input = findOpcodeSearchInput(nodeId);
    if (input) setInputValue(input, "");
    ctx.setOverlay({
      cursor: withCursorTipAt(elementCenter(input, ctx.flowToScreen(fallback))),
      ghost: null,
      pressing: true,
    });
  });

  const typeStart = focusAt + sp(140);
  for (let i = 1; i <= query.length; i += 1) {
    const partial = query.slice(0, i);
    ctx.scheduleStep(typeStart + i * OPCODE_TYPE_DELAY, () => {
      const input = findOpcodeSearchInput(nodeId);
      if (input) setInputValue(input, partial);
      ctx.setOverlay({
        cursor: withCursorTipAt(elementCenter(input, ctx.flowToScreen(fallback))),
        ghost: null,
      });
    });
  }

  const resultAt = typeStart + query.length * OPCODE_TYPE_DELAY + sp(160);
  ctx.scheduleStep(resultAt, () => {
    const result = findOpcodeResult(nodeId, opcode);
    ctx.setOverlay({
      cursor: withCursorTipAt(
        elementCenter(
          result,
          ctx.flowToScreen({ x: fallback.x, y: fallback.y + 72 }),
        ),
      ),
      ghost: null,
    });
  });

  const clickAt = resultAt + sp(260);
  ctx.scheduleStep(clickAt, () => {
    const result = findOpcodeResult(nodeId, opcode);
    result?.click();
    updateNodeData(ctx, nodeId, opcodeData(namesAfter, resultAfter));
    ctx.setOverlay({
      cursor: withCursorTipAt(
        elementCenter(
          result,
          ctx.flowToScreen({ x: fallback.x, y: fallback.y + 72 }),
        ),
      ),
      ghost: null,
      pressing: true,
    });
  });

  ctx.scheduleStep(clickAt + sp(120), () => {
    const input = findOpcodeSearchInput(nodeId);
    if (input) setInputValue(input, "");
  });

  return clickAt - startAt + sp(260);
}

function scheduleOpcodeSequenceBuild(
  ctx: DemoStepContext,
  startAt: number,
  nodeId: string,
  ops: Array<{
    query: string;
    opcode: string;
    namesAfter: string[];
    resultAfter: string;
  }>,
  fallback: { x: number; y: number },
) {
  let offset = startAt;
  ops.forEach((op) => {
    const duration = scheduleOpcodeSelect(
      ctx,
      offset,
      nodeId,
      op.query,
      op.opcode,
      op.namesAfter,
      op.resultAfter,
      fallback,
    );
    offset += duration + sp(140);
  });
  return offset - startAt + sp(120);
}

function scheduleConcatConfigure(ctx: DemoStepContext, startAt: number) {
  const plusFallback = {
    x: SCRIPT_POSITION.x + 240,
    y: SCRIPT_POSITION.y + 100,
  };
  ctx.scheduleStep(startAt, () => {
    const button = findConcatPlusButton(SCRIPT_ID);
    ctx.setOverlay({
      cursor: withCursorTipAt(
        elementCenter(button, ctx.flowToScreen(plusFallback)),
      ),
      ghost: null,
    });
  });

  ctx.scheduleStep(startAt + sp(300), () => {
    const button = findConcatPlusButton(SCRIPT_ID);
    button?.click();
    growConcatTo(ctx, 3);
    ctx.setOverlay({
      cursor: withCursorTipAt(
        elementCenter(button, ctx.flowToScreen(plusFallback)),
      ),
      ghost: null,
      pressing: true,
    });
  });

  ctx.scheduleStep(startAt + sp(760), () => {
    const button = findConcatPlusButton(SCRIPT_ID);
    ctx.setOverlay({
      cursor: withCursorTipAt(
        elementCenter(button, ctx.flowToScreen(plusFallback)),
      ),
      ghost: null,
    });
  });

  ctx.scheduleStep(startAt + sp(1040), () => {
    const button = findConcatPlusButton(SCRIPT_ID);
    button?.click();
    growConcatTo(ctx, 4);
    ctx.setOverlay({
      cursor: withCursorTipAt(
        elementCenter(button, ctx.flowToScreen(plusFallback)),
      ),
      ghost: null,
      pressing: true,
    });
  });

  ctx.scheduleStep(startAt + sp(1420), () => {
    updateNodeData(ctx, SCRIPT_ID, (data) => ({
      ...data,
      title: "scriptPubKey",
      customFieldLabels: {
        0: "OP codes",
        100: "pubKey hash len",
        200: "pubKey hash",
        300: "OP codes",
      },
      comment: "OP_DUP OP_HASH160 pubKeyHash\nOP_EQUALVERIFY OP_CHECKSIG",
      showComment: true,
      dirty: false,
    }));
    ctx.setOverlay({
      cursor: ctx.flowToScreen({
        x: SCRIPT_POSITION.x + 100,
        y: SCRIPT_POSITION.y + 28,
      }),
      ghost: null,
    });
  });

  return CONCAT_CONFIG_TOTAL;
}

function scheduleRegenerateEntropy(ctx: DemoStepContext, startAt: number) {
  const fallback = { x: RANDOM_POSITION.x + 215, y: RANDOM_POSITION.y + 24 };

  ctx.scheduleStep(startAt, () => {
    const button = findRegenerateButton(RANDOM_ID);
    ctx.setOverlay({
      cursor: withCursorTipAt(elementCenter(button, ctx.flowToScreen(fallback))),
      ghost: null,
    });
  });

  ctx.scheduleStep(startAt + sp(320), () => {
    const button = findRegenerateButton(RANDOM_ID);
    updateNodeData(ctx, RANDOM_ID, (data) => ({
      ...data,
      result: PRIVATE_KEY,
      dirty: false,
      forceRegenerate: false,
    }));
    ctx.setOverlay({
      cursor: withCursorTipAt(elementCenter(button, ctx.flowToScreen(fallback))),
      ghost: null,
      pressing: true,
    });
  });

  return sp(760);
}

function scriptInputValue(index: number) {
  const orderedKeys = [0, 100, 200, 300];
  const valueByKey: Record<number, string> = {
    0: PREFIX_HEX,
    100: PUSH_HEX,
    200: PUBKEY_HASH,
    300: SUFFIX_HEX,
  };

  return (data: Record<string, unknown>) => {
    const inputs = (data.inputs as Record<string, unknown> | undefined) ?? {};
    const vals: Record<number, unknown> = {
      ...((inputs.vals as Record<string, unknown> | undefined) ?? {}),
      [index]: valueByKey[index],
    };
    const result = orderedKeys.map((key) => String(vals[key] ?? "")).join("");
    return {
      ...data,
      inputs: { ...inputs, vals },
      result,
      dirty: false,
    };
  };
}

const STEP_COUNT = 8;

function makeSteps(): DemoStep[] {
  const placementDuration =
    searchDropDuration("random") +
    searchDropDuration("priv") +
    searchDropDuration("hash160") +
    searchDropDuration("push") +
    2 * searchDropDuration("opcode") +
    searchDropDuration("concat") +
    7 * sp(120) +
    sp(520);
  const regenerateDuration = sp(760);
  const prefixOpcodeBuild = opcodeSequenceDuration(["dup", "hash160"]);
  const suffixOpcodeBuild = opcodeSequenceDuration(["equalverify", "checksig"]);

  return [
    {
      id: "place-nodes",
      caption: {
        step: `1 / ${STEP_COUNT}`,
        title: "Place the building blocks",
        body:
          "Search and drop the nodes first, then fit the canvas before wiring anything.",
      },
      durationMs: placementDuration,
      play(ctx) {
        ctx.scheduleStep(0, () => ctx.setViewport(demoViewport()));
        const randomTpl = findTemplate(RANDOM_LABEL);
        const pubkeyTpl = findTemplate(PUBKEY_LABEL);
        const hashTpl = findTemplate(HASH160_LABEL);
        const pushTpl = findTemplate(PUSH_LABEL);
        const opcodeTpl = findTemplate(OPCODE_LABEL);
        const concatTpl = findTemplate(CONCAT_LABEL);
        if (
          !randomTpl ||
          !pubkeyTpl ||
          !hashTpl ||
          !pushTpl ||
          !opcodeTpl ||
          !concatTpl
        ) {
          return;
        }

        schedulePlacedNodeSetup(ctx, 0, [
          {
            template: randomTpl,
            nodeId: RANDOM_ID,
            position: RANDOM_POSITION,
            override: emptyRandomData(),
            label: RANDOM_LABEL,
            eyebrow: "Keys & Addresses",
            query: "random",
          },
          {
            template: pubkeyTpl,
            nodeId: PUBKEY_ID,
            position: PUBKEY_POSITION,
            override: emptySingleInputData(),
            label: PUBKEY_LABEL,
            eyebrow: "Keys & Addresses",
            query: "priv",
          },
          {
            template: hashTpl,
            nodeId: HASH160_ID,
            position: HASH160_POSITION,
            override: emptySingleInputData(),
            label: HASH160_LABEL,
            eyebrow: "Hashes",
            query: "hash160",
          },
          {
            template: pushTpl,
            nodeId: PUSH_ID,
            position: PUSH_POSITION,
            override: emptySingleInputData(),
            label: PUSH_LABEL,
            eyebrow: "Encoding & Script Data",
            query: "push",
          },
          {
            template: opcodeTpl,
            nodeId: PREFIX_ID,
            position: PREFIX_POSITION,
            override: opcodeData([], ""),
            label: OPCODE_LABEL,
            eyebrow: "Encoding & Script Data",
            query: "opcode",
          },
          {
            template: opcodeTpl,
            nodeId: SUFFIX_ID,
            position: SUFFIX_POSITION,
            override: opcodeData([], ""),
            label: OPCODE_LABEL,
            eyebrow: "Encoding & Script Data",
            query: "opcode",
          },
          {
            template: concatTpl,
            nodeId: SCRIPT_ID,
            position: SCRIPT_POSITION,
            override: emptyConcatData(),
            label: CONCAT_LABEL,
            eyebrow: "Canvas & Inputs",
            query: "concat",
          },
        ]);
      },
    },
    {
      id: "generate-entropy",
      caption: {
        step: `2 / ${STEP_COUNT}`,
        title: "Generate entropy",
        body:
          "Click regenerate on Random 32 Bytes to create the private-key seed.",
      },
      durationMs: regenerateDuration + 200,
      play(ctx) {
        scheduleRegenerateEntropy(ctx, 0);
      },
    },
    {
      id: "derive-pubkey",
      caption: {
        step: `3 / ${STEP_COUNT}`,
        title: "Derive the public key",
        body: "Connect the random private key into PrivKey → PubKey.",
      },
      durationMs: CONN_TOTAL + 400,
      play(ctx) {
        scheduleConnect(
          ctx,
          0,
          RANDOM_ID,
          PUBKEY_ID,
          "input-0",
          { x: RANDOM_POSITION.x + 250, y: RANDOM_POSITION.y + 74 },
          { x: PUBKEY_POSITION.x, y: PUBKEY_POSITION.y + 74 },
          () => {
            addEdge(ctx, {
              id: "edge_help_demo_p2pkh_random_pubkey",
              source: RANDOM_ID,
              target: PUBKEY_ID,
              targetHandle: "input-0",
              selected: false,
            } as Edge);
            setConnectedValue(ctx, PUBKEY_ID, PRIVATE_KEY, PUBKEY);
          },
        );
      },
    },
    {
      id: "hash-pubkey",
      caption: {
        step: `4 / ${STEP_COUNT}`,
        title: "Hash the public key",
        body: "Connect the compressed public key into Data → HASH160.",
      },
      durationMs: CONN_TOTAL + 400,
      play(ctx) {
        scheduleConnect(
          ctx,
          0,
          PUBKEY_ID,
          HASH160_ID,
          "input-0",
          { x: PUBKEY_POSITION.x + 250, y: PUBKEY_POSITION.y + 74 },
          { x: HASH160_POSITION.x, y: HASH160_POSITION.y + 74 },
          () => {
            addEdge(ctx, {
              id: "edge_help_demo_p2pkh_pubkey_hash160",
              source: PUBKEY_ID,
              target: HASH160_ID,
              targetHandle: "input-0",
              selected: false,
            } as Edge);
            setConnectedValue(ctx, HASH160_ID, PUBKEY, PUBKEY_HASH);
          },
        );
      },
    },
    {
      id: "push-hash",
      caption: {
        step: `5 / ${STEP_COUNT}`,
        title: "Encode the hash push",
        body:
          "Connect the pubKeyHash into Data → Push Opcode. A 20-byte hash needs push opcode 14.",
      },
      durationMs: CONN_TOTAL + 400,
      play(ctx) {
        scheduleConnect(
          ctx,
          0,
          HASH160_ID,
          PUSH_ID,
          "input-0",
          { x: HASH160_POSITION.x + 250, y: HASH160_POSITION.y + 74 },
          { x: PUSH_POSITION.x, y: PUSH_POSITION.y + 74 },
          () => {
            addEdge(ctx, {
              id: "edge_help_demo_p2pkh_hash160_push",
              source: HASH160_ID,
              target: PUSH_ID,
              targetHandle: "input-0",
              selected: false,
            } as Edge);
            setConnectedValue(ctx, PUSH_ID, PUBKEY_HASH, PUSH_HEX);
          },
        );
      },
    },
    {
      id: "select-opcodes",
      caption: {
        step: `6 / ${STEP_COUNT}`,
        title: "Select script opcodes",
        body:
          "Use each Opcode Sequence search field to pick the P2PKH prefix and suffix opcodes.",
      },
      durationMs: prefixOpcodeBuild + suffixOpcodeBuild + 500,
      play(ctx) {
        scheduleOpcodeSequenceBuild(
          ctx,
          0,
          PREFIX_ID,
          [
            {
              query: "dup",
              opcode: "OP_DUP",
              namesAfter: ["OP_DUP"],
              resultAfter: "76",
            },
            {
              query: "hash160",
              opcode: "OP_HASH160",
              namesAfter: ["OP_DUP", "OP_HASH160"],
              resultAfter: PREFIX_HEX,
            },
          ],
          { x: PREFIX_POSITION.x + 104, y: PREFIX_POSITION.y + 110 },
        );
        scheduleOpcodeSequenceBuild(
          ctx,
          prefixOpcodeBuild + sp(220),
          SUFFIX_ID,
          [
            {
              query: "equalverify",
              opcode: "OP_EQUALVERIFY",
              namesAfter: ["OP_EQUALVERIFY"],
              resultAfter: "88",
            },
            {
              query: "checksig",
              opcode: "OP_CHECKSIG",
              namesAfter: ["OP_EQUALVERIFY", "OP_CHECKSIG"],
              resultAfter: SUFFIX_HEX,
            },
          ],
          { x: SUFFIX_POSITION.x + 116, y: SUFFIX_POSITION.y + 110 },
        );
      },
    },
    {
      id: "assemble-script",
      caption: {
        step: `7 / ${STEP_COUNT}`,
        title: "Assemble scriptPubKey",
        body:
          "Add Concat fields, rename them, then wire prefix, push length, pubKeyHash, and suffix.",
      },
      durationMs:
        CONCAT_CONFIG_TOTAL + 4 * (CONN_TOTAL + CONN_GAP) + 400,
      play(ctx) {
        const connectAt = scheduleConcatConfigure(ctx, 0) + sp(140);

        const connections = [
          {
            edgeId: "edge_help_demo_p2pkh_prefix_script",
            source: PREFIX_ID,
            targetHandle: "input-0",
            sourceFallback: {
              x: PREFIX_POSITION.x + 280,
              y: PREFIX_POSITION.y + 100,
            },
            targetFallback: {
              x: SCRIPT_POSITION.x,
              y: SCRIPT_POSITION.y + 88,
            },
            index: 0,
          },
          {
            edgeId: "edge_help_demo_p2pkh_push_script",
            source: PUSH_ID,
            targetHandle: "input-100",
            sourceFallback: {
              x: PUSH_POSITION.x + 250,
              y: PUSH_POSITION.y + 74,
            },
            targetFallback: {
              x: SCRIPT_POSITION.x,
              y: SCRIPT_POSITION.y + 135,
            },
            index: 100,
          },
          {
            edgeId: "edge_help_demo_p2pkh_hash_script",
            source: HASH160_ID,
            targetHandle: "input-200",
            sourceFallback: {
              x: HASH160_POSITION.x + 250,
              y: HASH160_POSITION.y + 74,
            },
            targetFallback: {
              x: SCRIPT_POSITION.x,
              y: SCRIPT_POSITION.y + 185,
            },
            index: 200,
          },
          {
            edgeId: "edge_help_demo_p2pkh_suffix_script",
            source: SUFFIX_ID,
            targetHandle: "input-300",
            sourceFallback: {
              x: SUFFIX_POSITION.x + 280,
              y: SUFFIX_POSITION.y + 100,
            },
            targetFallback: {
              x: SCRIPT_POSITION.x,
              y: SCRIPT_POSITION.y + 235,
            },
            index: 300,
          },
        ];

        connections.forEach((connection, index) => {
          scheduleConnect(
            ctx,
            connectAt + index * (CONN_TOTAL + CONN_GAP),
            connection.source,
            SCRIPT_ID,
            connection.targetHandle,
            connection.sourceFallback,
            connection.targetFallback,
            () => {
              addEdge(ctx, {
                id: connection.edgeId,
                source: connection.source,
                target: SCRIPT_ID,
                targetHandle: connection.targetHandle,
                selected: false,
              } as Edge);
              updateNodeData(ctx, SCRIPT_ID, scriptInputValue(connection.index));
            },
          );
        });
      },
    },
    {
      id: "complete",
      caption: {
        step: "Done",
        title: "P2PKH locking script complete",
        body:
          "scriptPubKey is OP_DUP OP_HASH160 <pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG.",
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

export const p2pkhLockingScriptDemo: HelpDemo = {
  id: "p2pkh-locking-script",
  title: "Build P2PKH locking script",
  description: "Assemble the classic P2PKH scriptPubKey.",
  category: "Bitcoin scripts",
  incrementalForward: true,

  init(ctx) {
    ctx.setViewport(demoViewport());
    ctx.setNodes(() => []);
    ctx.setEdges(() => []);
  },

  steps: makeSteps(),
};
