// src/help/runtime/helpers.ts
// DOM/screen helpers used by demos. Kept dependency-free so demos can be
// tested in isolation.

import { CURSOR_TIP_OFFSET } from "@/components/introDropCursor";

const SIDEBAR_FALLBACK = { x: 76, y: 240, width: 196, height: 96 };

function findSidebarNodeSource(label: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-node-template-label]"),
    ).find((node) => node.dataset.nodeTemplateLabel === label) ?? null
  );
}

/** Scroll a sidebar node card into view before a demo measures or picks it. */
export function revealSidebarNodeSource(label: string) {
  const el = findSidebarNodeSource(label);
  el?.scrollIntoView({ block: "center", behavior: "auto" });
}

/** Bounding rect of a sidebar node card identified by its label. */
export function getSidebarNodeSourceRect(label: string) {
  if (typeof document === "undefined") return { ...SIDEBAR_FALLBACK };
  const el = findSidebarNodeSource(label);
  if (!el) return { ...SIDEBAR_FALLBACK };
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width || SIDEBAR_FALLBACK.width,
    height: rect.height || SIDEBAR_FALLBACK.height,
  };
}

/** Bounding rect of the sidebar search input. */
export function getSidebarSearchInputRect() {
  if (typeof document === "undefined") {
    return { x: 96, y: 150, width: 220, height: 32 };
  }
  const input = document.getElementById("sidebar-search");
  if (!input) return { x: 96, y: 150, width: 220, height: 32 };
  const rect = input.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width || 220,
    height: rect.height || 32,
  };
}

/** Centre point of a rect, adjusted slightly so the cursor sits visually centred. */
export function getRectCursorCenter(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: rect.x + rect.width / 2 - 4,
    y: rect.y + rect.height / 2 - 4,
  };
}

/**
 * Translates `point` so the cursor *tip* lands exactly on it (the SVG apex is
 * offset from the wrapper origin).
 */
export function withCursorTipAt(point: { x: number; y: number }) {
  return {
    x: point.x - CURSOR_TIP_OFFSET.x,
    y: point.y - CURSOR_TIP_OFFSET.y,
  };
}

/** Screen-space centre of a rendered DOM element. */
export function getElementCenter(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Dispatches a bubbling `pointerdown` (with a `mousedown` fallback) on `el`.
 * Needed for Radix DropdownMenuTrigger/PopoverTrigger which open on
 * `pointerdown` — plain `el.click()` does NOT open them.
 */
export function dispatchPointerDown(el: Element) {
  const init = {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
  };
  try {
    el.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...init,
        isPrimary: true,
        pointerType: "mouse",
      }),
    );
  } catch {
    el.dispatchEvent(new MouseEvent("mousedown", init));
  }
}

/** The ⋯ menu button inside a rendered React Flow node, by node id. */
export function findNodeMenuButton(nodeId: string): HTMLButtonElement | null {
  if (typeof document === "undefined") return null;
  const nodeEl = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${nodeId}"]`,
  );
  if (!nodeEl) return null;
  return nodeEl.querySelector<HTMLButtonElement>(
    'button[aria-label$=" menu"]',
  );
}

/**
 * Locates an open Radix dropdown/dialog item by its (trimmed) text content.
 * Searches role-tagged items first, then falls back to any button.
 */
export function findMenuItemByText(text: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const want = text.trim().toLowerCase();
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], button',
    ),
  );
  return (
    candidates.find(
      (el) => (el.textContent ?? "").trim().toLowerCase() === want,
    ) ?? null
  );
}

/**
 * Smooth-scrolls the NodeCodeDialog's code area to a given fraction of its
 * scrollable height (0 = top, 1 = bottom). Returns true if the container
 * was found.
 */
export function scrollCodeDialogTo(ratio: number, smooth = true): boolean {
  if (typeof document === "undefined") return false;
  const el = document.querySelector<HTMLElement>(
    ".syntax-highlighter-container",
  );
  if (!el) return false;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  const top = Math.round(max * Math.max(0, Math.min(1, ratio)));
  el.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  return true;
}

/** Screen-space centre of a real, rendered React Flow handle. */
export function getHandleScreenPosition(
  nodeId: string,
  type: "source" | "target",
  handleId?: string | null
): { x: number; y: number } | null {
  if (typeof document === "undefined") return null;
  const nodeEl = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${nodeId}"]`
  );
  if (!nodeEl) return null;
  let handleEl: HTMLElement | null = null;
  if (handleId) {
    handleEl = nodeEl.querySelector<HTMLElement>(
      `.react-flow__handle[data-handleid="${handleId}"]`
    );
  }
  if (!handleEl) {
    handleEl = nodeEl.querySelector<HTMLElement>(
      `.react-flow__handle.${type}`
    );
  }
  if (!handleEl) return null;
  const rect = handleEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}
