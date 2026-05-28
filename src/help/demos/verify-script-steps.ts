// Walks through the Verify Script node inside the bundled Intro P2PKH flow.

import type { Edge } from "@xyflow/react";

import introP2pkhFlow from "@/my_tx_flows/p0_Intro_P2PKH.json";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";
import { placeFlowDataAtPosition } from "@/lib/flow/placeFlowTemplate";
import {
  ingestScriptSteps,
  restoreScriptSteps,
} from "@/lib/share/scriptStepsCache";
import type { FlowData, FlowNode } from "@/types";

import {
  getElementCenter,
  getRectCursorCenter,
  getSidebarSearchInputRect,
  withCursorTipAt,
} from "../runtime/helpers";
import type { DemoStep, DemoStepContext, HelpDemo } from "../types";

const FLOW_ID = "flow-0";
const FLOW_LABEL = "Intro P2PKH";
const FLOW_SEARCH = "flow 0 p2pkh";
const VERIFY_NODE_ID = "node_o6vul7a";
const VERIFY_SEARCH = "verify script";
const FLOW_DROP_POSITION = { x: 0, y: 0 };
const FLOW_SOURCE_FALLBACK = { x: 76, y: 780, width: 196, height: 96 };
const VERIFY_NODE_FALLBACK_SIZE = { width: 410, height: 620 };

const SPEEDUP = 1;
const sp = (ms: number) => Math.round(ms / SPEEDUP);
const SEARCH_TYPE_DELAY = 80;
const TOPBAR_SEARCH_TYPE_DELAY = 110;
const NEXT_CLICK_GAP = sp(1350);
const STEP_COUNT = 7;

type GraphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function cloneFlowData(): FlowData {
  const source = introP2pkhFlow as FlowData;
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(source);
    }
  } catch {
    /* fall back */
  }
  return JSON.parse(JSON.stringify(source)) as FlowData;
}

function cloneNodeForCanvas(node: FlowNode) {
  const base: FlowNode & { dragHandle?: string } = {
    ...node,
    data: node.data ? { ...node.data } : node.data,
    position: node.position
      ? { x: node.position.x, y: node.position.y }
      : node.position,
    selected: node.id === VERIFY_NODE_ID,
  };
  if (base.type === "shadcnGroup" && !base.dragHandle) {
    base.dragHandle = "[data-drag-handle]";
  }
  return base;
}

function prepareIntroFlow() {
  const placed = placeFlowDataAtPosition(
    cloneFlowData(),
    FLOW_DROP_POSITION.x,
    FLOW_DROP_POSITION.y,
  );
  restoreScriptSteps([]);
  const nodes = stripLegacyFlowMapNodeData(
    ingestScriptSteps(placed.nodes.map(cloneNodeForCanvas)),
  );
  const edges = placed.edges.map((edge) => ({ ...edge })) as Edge[];
  return { nodes, edges };
}

function placedFlowNodes() {
  return placeFlowDataAtPosition(
    cloneFlowData(),
    FLOW_DROP_POSITION.x,
    FLOW_DROP_POSITION.y,
  ).nodes;
}

function getNodeAbsolutePosition(
  nodes: FlowNode[],
  nodeId: string,
): { x: number; y: number } {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const node = nodesById.get(nodeId);
  if (!node) return { x: 0, y: 0 };

  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodesById.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

function getGraphBounds(nodes: FlowNode[]): GraphBounds {
  const topLevelNodes = nodes.filter((node) => !node.parentId);
  const relevantNodes = topLevelNodes.length > 0 ? topLevelNodes : nodes;
  return relevantNodes.reduce<GraphBounds>(
    (bounds, node) => {
      const width =
        node.width ??
        node.measured?.width ??
        (typeof node.data?.width === "number" ? node.data.width : 300);
      const height =
        node.height ??
        node.measured?.height ??
        (typeof node.data?.height === "number" ? node.data.height : 220);
      return {
        minX: Math.min(bounds.minX, node.position.x),
        minY: Math.min(bounds.minY, node.position.y),
        maxX: Math.max(bounds.maxX, node.position.x + width),
        maxY: Math.max(bounds.maxY, node.position.y + height),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

const POSITION_NODES = placedFlowNodes();
const VERIFY_ABSOLUTE_POSITION = getNodeAbsolutePosition(
  POSITION_NODES,
  VERIFY_NODE_ID,
);
const PLACED_GRAPH_BOUNDS = getGraphBounds(POSITION_NODES);

function getPaneRect() {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector<HTMLElement>(".react-flow")?.getBoundingClientRect() ??
    null
  );
}

function overviewViewport() {
  const pane = getPaneRect();
  const width = pane?.width ?? 1280;
  const height = pane?.height ?? 720;
  const padding = 34;
  const captionReserve = 190;
  const graphWidth = PLACED_GRAPH_BOUNDS.maxX - PLACED_GRAPH_BOUNDS.minX;
  const graphHeight = PLACED_GRAPH_BOUNDS.maxY - PLACED_GRAPH_BOUNDS.minY;
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - captionReserve - padding * 2);
  const zoom = Math.min(0.14, usableWidth / graphWidth, usableHeight / graphHeight);

  return {
    x: Math.round(
      (width - graphWidth * zoom) / 2 - PLACED_GRAPH_BOUNDS.minX * zoom,
    ),
    y: Math.round(
      padding +
        (usableHeight - graphHeight * zoom) / 2 -
        PLACED_GRAPH_BOUNDS.minY * zoom,
    ),
    zoom,
  };
}

function verifyNodeViewport() {
  const pane = getPaneRect();
  const width = pane?.width ?? 1280;
  const height = pane?.height ?? 720;
  const isCompact = width < 980;
  const zoom = isCompact ? 0.52 : 0.62;
  const targetX =
    VERIFY_ABSOLUTE_POSITION.x + VERIFY_NODE_FALLBACK_SIZE.width / 2;
  const targetY =
    VERIFY_ABSOLUTE_POSITION.y + VERIFY_NODE_FALLBACK_SIZE.height / 2;

  return {
    x: Math.round(width * (isCompact ? 0.5 : 0.48) - targetX * zoom),
    y: Math.round(height * 0.42 - targetY * zoom),
    zoom,
  };
}

function getFlowSourceRect() {
  if (typeof document === "undefined") return FLOW_SOURCE_FALLBACK;
  const el = getFlowSourceElement();
  if (!el) return FLOW_SOURCE_FALLBACK;
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width || FLOW_SOURCE_FALLBACK.width,
    height: rect.height || FLOW_SOURCE_FALLBACK.height,
  };
}

function getFlowSourceElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(
    `[data-flow-template-id="${FLOW_ID}"]`,
  );
}

function revealFlowSource() {
  const el = getFlowSourceElement();
  el?.scrollIntoView({ block: "center", behavior: "auto" });
}

function getFlowDropScreenPoint(ctx: DemoStepContext) {
  const target = ctx.flowToScreen(FLOW_DROP_POSITION);
  const pane = getPaneRect();
  if (!pane) return target;

  return {
    x: Math.min(Math.max(target.x, pane.left + 80), pane.right - 80),
    y: Math.min(Math.max(target.y, pane.top + 80), pane.bottom - 80),
  };
}

function getNodeElement(nodeId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${nodeId}"]`,
  );
}

function getVerifyNodeCenter() {
  const node = getNodeElement(VERIFY_NODE_ID);
  if (node) return getElementCenter(node);
  const pane = getPaneRect();
  return {
    x: (pane?.left ?? 0) + (pane?.width ?? 1280) * 0.5,
    y: (pane?.top ?? 0) + (pane?.height ?? 720) * 0.42,
  };
}

function getTopbarSearchButton(): HTMLButtonElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLButtonElement>(
    'button[aria-label="Search nodes"]',
  );
}

function getSearchPanelInputRect() {
  if (typeof document === "undefined") {
    return { x: 1020, y: 112, width: 220, height: 32 };
  }
  const input = document.getElementById("search-panel-input");
  if (!input) return { x: 1020, y: 112, width: 220, height: 32 };
  const rect = input.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width || 220,
    height: rect.height || 32,
  };
}

function findSearchPanelResult(label: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const want = label.trim().toLowerCase();
  const panel = document.querySelector<HTMLElement>(
    '[data-testid="search-panel"]',
  );
  if (!panel) return null;
  const results = Array.from(
    panel.querySelectorAll<HTMLElement>('[role="button"]'),
  );
  return (
    results.find((item) =>
      Array.from(item.querySelectorAll("strong")).some(
        (title) => (title.textContent ?? "").trim().toLowerCase() === want,
      ),
    ) ??
    results.find((item) =>
      (item.textContent ?? "").toLowerCase().includes(want),
    ) ??
    null
  );
}

function findScriptStepsButton(): HTMLButtonElement | null {
  const node = getNodeElement(VERIFY_NODE_ID);
  if (!node) return null;
  return (
    Array.from(node.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => (button.textContent ?? "").trim() === "View Script Steps",
    ) ?? null
  );
}

function getScriptStepsDialog(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return (
    Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
      (dialog) =>
        (dialog.textContent ?? "").includes("Script Execution Steps"),
    ) ?? null
  );
}

function findNextButton(): HTMLButtonElement | null {
  const dialog = getScriptStepsDialog();
  if (!dialog) return null;
  return (
    Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => (button.textContent ?? "").trim() === "Next",
    ) ?? null
  );
}

function findDialogCloseButton(): HTMLButtonElement | null {
  const dialog = getScriptStepsDialog();
  if (!dialog) return null;
  const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));
  return (
    buttons.find((button) => (button.textContent ?? "").trim() === "Close") ??
    buttons.find((button) => button.getAttribute("aria-label") === "Close") ??
    null
  );
}

function setCursorOnButton(
  ctx: DemoStepContext,
  button: HTMLButtonElement | null,
  opts: { pressing?: boolean; clickPulse?: boolean } = {},
) {
  if (!button) return;
  ctx.setOverlay({
    cursor: withCursorTipAt(getElementCenter(button)),
    ghost: null,
    pressing: opts.pressing,
    clickPulse: opts.clickPulse,
  });
}

function setCursorOnElement(
  ctx: DemoStepContext,
  el: HTMLElement | null,
  opts: { pressing?: boolean; clickPulse?: boolean } = {},
) {
  if (!el) return;
  ctx.setOverlay({
    cursor: withCursorTipAt(getElementCenter(el)),
    ghost: null,
    pressing: opts.pressing,
    clickPulse: opts.clickPulse,
  });
}

function openScriptSteps(ctx?: DemoStepContext, attempts = 0) {
  if (getScriptStepsDialog()) return;

  const button = findScriptStepsButton();
  if (button) {
    button.click();
    return;
  }

  if (attempts >= 12 || typeof window === "undefined") return;
  window.requestAnimationFrame(() => openScriptSteps(ctx, attempts + 1));
}

function closeScriptSteps(ctx?: DemoStepContext, attempts = 0) {
  const button = findDialogCloseButton();
  if (button) {
    button.click();
    return;
  }
  if (attempts >= 12 || typeof window === "undefined") return;
  window.requestAnimationFrame(() => closeScriptSteps(ctx, attempts + 1));
}

function clickNext(ctx?: DemoStepContext, attempts = 0) {
  const button = findNextButton();
  if (button && !button.disabled) {
    button.click();
    return;
  }

  if (!getScriptStepsDialog()) {
    openScriptSteps(ctx);
  }
  if (attempts >= 12 || typeof window === "undefined") return;
  window.requestAnimationFrame(() => clickNext(ctx, attempts + 1));
}

function scheduleNextClicks(ctx: DemoStepContext, count: number) {
  for (let i = 0; i < count; i += 1) {
    const moveAt = i * NEXT_CLICK_GAP;
    const clickAt = moveAt + sp(260);
    ctx.scheduleStep(moveAt, () => {
      setCursorOnButton(ctx, findNextButton());
    });
    ctx.scheduleStep(clickAt, () => {
      setCursorOnButton(ctx, findNextButton(), {
        pressing: true,
        clickPulse: true,
      });
      clickNext(ctx);
    });
  }
}

function scheduleFlowSearchAndDrop(ctx: DemoStepContext) {
  ctx.scheduleStep(0, () => {
    ctx.setSidebarSearch("");
    ctx.setViewport(overviewViewport());
    ctx.setOverlay({
      cursor: getRectCursorCenter(getSidebarSearchInputRect()),
      ghost: null,
    });
  });

  const focusAt = sp(560);
  ctx.scheduleStep(focusAt, () => {
    ctx.setOverlay({
      cursor: getRectCursorCenter(getSidebarSearchInputRect()),
      ghost: null,
      pressing: true,
    });
  });

  const typeStart = focusAt + sp(180);
  for (let i = 1; i <= FLOW_SEARCH.length; i += 1) {
    const partial = FLOW_SEARCH.slice(0, i);
    ctx.scheduleStep(typeStart + i * SEARCH_TYPE_DELAY, () => {
      ctx.setSidebarSearch(partial);
      ctx.setOverlay({
        cursor: getRectCursorCenter(getSidebarSearchInputRect()),
        ghost: null,
      });
    });
  }

  const typeEnd = typeStart + FLOW_SEARCH.length * SEARCH_TYPE_DELAY;
  const revealAt = typeEnd + sp(200);
  ctx.scheduleStep(revealAt, () => {
    ctx.setSidebarFlowHighlight(FLOW_ID);
    revealFlowSource();
  });

  const moveToCard = typeEnd + sp(760);
  ctx.scheduleStep(moveToCard, () => {
    revealFlowSource();
    const center = getRectCursorCenter(getFlowSourceRect());
    ctx.setSidebarFlowHighlight(FLOW_ID);
    ctx.setOverlay({ cursor: center, ghost: null });
  });

  ctx.scheduleStep(moveToCard + sp(560), () => {
    const center = getRectCursorCenter(getFlowSourceRect());
    ctx.setOverlay({ cursor: center, ghost: null, pressing: true });
  });

  ctx.scheduleStep(moveToCard + sp(760), () => {
    const center = getRectCursorCenter(getFlowSourceRect());
    ctx.setOverlay({
      cursor: center,
      ghost: {
        x: center.x - 20,
        y: center.y - 18,
        eyebrow: "Flow Examples",
        label: FLOW_LABEL,
        detail: "Dropping onto canvas",
      },
    });
  });

  ctx.scheduleStep(moveToCard + sp(1020), () => {
    const target = getFlowDropScreenPoint(ctx);
    ctx.setOverlay({
      cursor: target,
      ghost: {
        x: target.x - 20,
        y: target.y - 18,
        eyebrow: "Flow Examples",
        label: FLOW_LABEL,
        detail: "Dropping onto canvas",
      },
    });
  });

  ctx.scheduleStep(moveToCard + sp(1500), () => {
    const { nodes, edges } = prepareIntroFlow();
    ctx.setNodes(() => nodes);
    ctx.setEdges(() => edges);
    ctx.setViewport(overviewViewport());
    const target = getFlowDropScreenPoint(ctx);
    ctx.setOverlay({
      cursor: target,
      ghost: null,
      pressing: true,
    });
  });
}

function scheduleSearchVerifyNode(ctx: DemoStepContext) {
  ctx.scheduleStep(0, () => {
    ctx.setSidebarSearch("");
    ctx.setSidebarFlowHighlight(undefined);
    ctx.setSearchPanel(false);
    ctx.setSearchQuery("");
    ctx.setHelpMenuVisible(true);
    ctx.setViewport(overviewViewport());
    setCursorOnElement(ctx, getTopbarSearchButton());
  });

  const openAt = sp(820);
  ctx.scheduleStep(openAt, () => {
    setCursorOnElement(ctx, getTopbarSearchButton(), {
      pressing: true,
      clickPulse: true,
    });
    ctx.setHelpMenuVisible(false);
    ctx.setSearchPanel(true);
  });

  const inputAt = openAt + sp(520);
  ctx.scheduleStep(inputAt, () => {
    ctx.setOverlay({
      cursor: getRectCursorCenter(getSearchPanelInputRect()),
      ghost: null,
    });
  });

  const typeStart = inputAt + sp(320);
  for (let i = 1; i <= VERIFY_SEARCH.length; i += 1) {
    const partial = VERIFY_SEARCH.slice(0, i);
    ctx.scheduleStep(typeStart + i * TOPBAR_SEARCH_TYPE_DELAY, () => {
      ctx.setSearchQuery(partial);
      ctx.setOverlay({
        cursor: getRectCursorCenter(getSearchPanelInputRect()),
        ghost: null,
      });
    });
  }

  const typeEnd = typeStart + VERIFY_SEARCH.length * TOPBAR_SEARCH_TYPE_DELAY;
  const moveToResult = typeEnd + sp(650);
  ctx.scheduleStep(moveToResult, () => {
    setCursorOnElement(ctx, findSearchPanelResult("Verify Script"));
  });

  const clickResultAt = moveToResult + sp(560);
  ctx.scheduleStep(clickResultAt, () => {
    const result = findSearchPanelResult("Verify Script");
    setCursorOnElement(ctx, result, {
      pressing: true,
      clickPulse: true,
    });
    ctx.focusNode(VERIFY_NODE_ID);
  });

  ctx.scheduleStep(clickResultAt + sp(1050), () => {
    ctx.setSearchPanel(false);
    ctx.setSearchQuery("");
    ctx.setHelpMenuVisible(true);
    ctx.setViewport(verifyNodeViewport());
    ctx.setOverlay({
      cursor: withCursorTipAt(getVerifyNodeCenter()),
      ghost: null,
    });
  });
}

function makeSteps(): DemoStep[] {
  return [
    {
      id: "drop-intro-p2pkh-flow",
      caption: {
        step: `1 / ${STEP_COUNT}`,
        title: "Drop Intro P2PKH flow",
        body:
          "Search Flow Examples, drop Intro P2PKH, then inspect the Verify Script node.",
      },
      durationMs: sp(5600),
      play(ctx) {
        scheduleFlowSearchAndDrop(ctx);
      },
    },
    {
      id: "search-verify-script",
      caption: {
        step: `2 / ${STEP_COUNT}`,
        title: "Search for Verify Script",
        body:
          "Use the topbar search to find the node and jump to its position in the flow.",
      },
      durationMs: sp(6500),
      play(ctx) {
        scheduleSearchVerifyNode(ctx);
      },
    },
    {
      id: "open-script-steps",
      caption: {
        step: `3 / ${STEP_COUNT}`,
        title: "Open execution steps",
        body:
          "Use View Script Steps to inspect every opcode and stack transition.",
      },
      durationMs: sp(2100),
      play(ctx) {
        ctx.scheduleStep(0, () => {
          ctx.setViewport(verifyNodeViewport());
        });
        ctx.scheduleStep(sp(520), () => {
          setCursorOnButton(ctx, findScriptStepsButton());
        });
        ctx.scheduleStep(sp(900), () => {
          setCursorOnButton(ctx, findScriptStepsButton(), {
            pressing: true,
            clickPulse: true,
          });
        });
        ctx.scheduleStep(sp(1180), () => {
          openScriptSteps(ctx);
        });
      },
    },
    {
      id: "script-sig-pushes",
      caption: {
        step: `4 / ${STEP_COUNT}`,
        title: "Read scriptSig pushes",
        body:
          "The first two steps push the signature and public key onto the stack.",
      },
      durationMs: NEXT_CLICK_GAP + sp(560),
      play(ctx) {
        ctx.scheduleStep(0, () => openScriptSteps(ctx));
        scheduleNextClicks(ctx, 1);
      },
    },
    {
      id: "duplicate-and-hash",
      caption: {
        step: `5 / ${STEP_COUNT}`,
        title: "Duplicate and hash",
        body:
          "OP_DUP copies the public key, then OP_HASH160 turns that copy into a public-key hash.",
      },
      durationMs: NEXT_CLICK_GAP * 2 + sp(560),
      play(ctx) {
        ctx.scheduleStep(0, () => openScriptSteps(ctx));
        scheduleNextClicks(ctx, 2);
      },
    },
    {
      id: "compare-pubkey-hash",
      caption: {
        step: `6 / ${STEP_COUNT}`,
        title: "Compare the lock",
        body:
          "The pushed public-key hash is compared with OP_EQUALVERIFY before signature checking.",
      },
      durationMs: NEXT_CLICK_GAP * 2 + sp(560),
      play(ctx) {
        ctx.scheduleStep(0, () => openScriptSteps(ctx));
        scheduleNextClicks(ctx, 2);
      },
    },
    {
      id: "signature-check",
      caption: {
        step: `7 / ${STEP_COUNT}`,
        title: "Verify the signature",
        body:
          "OP_CHECKSIG checks the signature with the public key and leaves the spend valid.",
      },
      durationMs: NEXT_CLICK_GAP + sp(3200),
      play(ctx) {
        ctx.scheduleStep(0, () => openScriptSteps(ctx));
        scheduleNextClicks(ctx, 1);
        const closeMoveAt = NEXT_CLICK_GAP + sp(1000);
        ctx.scheduleStep(closeMoveAt, () => {
          setCursorOnButton(ctx, findDialogCloseButton());
        });
        ctx.scheduleStep(closeMoveAt + sp(480), () => {
          setCursorOnButton(ctx, findDialogCloseButton(), {
            pressing: true,
            clickPulse: true,
          });
          closeScriptSteps(ctx);
        });
        ctx.scheduleStep(closeMoveAt + sp(860), () => {
          ctx.setSearchPanel(false);
          ctx.setSearchQuery("");
          ctx.setHelpMenuVisible(true);
          ctx.setOverlay({
            cursor: null,
            ghost: null,
            caption: {
              step: `7 / ${STEP_COUNT}`,
              title: "Verify Script walkthrough complete",
              body:
                "Replay the demo or step backward to review how each opcode changes the stack.",
            },
          });
        });
      },
    },
  ];
}

export const verifyScriptStepsDemo: HelpDemo = {
  id: "verify-script-steps",
  title: "Walk Verify Script steps",
  description: "Open a P2PKH flow and step through script execution.",
  category: "Bitcoin scripts",
  init(ctx) {
    restoreScriptSteps([]);
    ctx.setSidebarSearch(undefined);
    ctx.setSidebarHighlightLabel(undefined);
    ctx.setSidebarFlowHighlight(undefined);
    ctx.setSearchPanel(false);
    ctx.setSearchQuery("");
    ctx.setHelpMenuVisible(true);
    ctx.setNodes(() => []);
    ctx.setEdges(() => []);
    ctx.setViewport(overviewViewport());
  },
  steps: makeSteps(),
};
