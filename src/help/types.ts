// src/help/types.ts
// Shape of help demos and the runtime context they receive.

import type { Edge } from "@xyflow/react";

import type { IntroDropOverlayState } from "@/components/IntroDropOverlay";
import type { FlowNode } from "@/types";

/**
 * Helpers and setters the orchestrating Flow component passes to a demo at
 * run time. Demos consume this — they don't reach into Flow.tsx state.
 */
/** Caption shown in the bottom-right card (step + title + body). */
export type DemoCaption = NonNullable<IntroDropOverlayState["caption"]>;

export interface DemoContext {
  /**
   * Replace the cursor/ghost/wire overlay state. The runtime merges in the
   * currently-active caption, so cursor moves never drop the narration.
   */
  setOverlay: (state: IntroDropOverlayState | null) => void;
  /**
   * Set (or clear) the narration card shown in the bottom-right. The caption
   * persists across subsequent setOverlay calls until the next setCaption.
   */
  setCaption: (caption: DemoCaption | null) => void;
  /** Drive the sidebar search box (undefined releases control). */
  setSidebarSearch: (value: string | undefined) => void;
  /** Highlight a sidebar node card by label (undefined clears). */
  setSidebarHighlightLabel: (label: string | undefined) => void;
  /** Update the active tab's nodes. */
  setNodes: (updater: (prev: FlowNode[]) => FlowNode[]) => void;
  /** Update the active tab's edges. */
  setEdges: (updater: (prev: Edge[]) => Edge[]) => void;
  /**
   * Schedule `fn` to run at `delayMs` from "now". Returns a handle the
   * runtime tracks for cancellation when the demo is stopped.
   */
  scheduleStep: (delayMs: number, fn: () => void) => void;
  /** Project a flow-space point to a screen-space point. */
  flowToScreen: (point: { x: number; y: number }) => { x: number; y: number };
  /** Force the React Flow viewport (useful at demo start). */
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  /** Returns true when the demo is still meant to be running. */
  isRunning: () => boolean;
}

export interface HelpDemo {
  /** Stable id used as the run handle and for analytics. */
  id: string;
  /** Display title shown in the help menu. */
  title: string;
  /** Short one-line subtitle shown beneath the title. */
  description: string;
  /** Optional category label for grouping in the menu. */
  category?: string;
  /**
   * Orchestration entrypoint. Demos call `ctx.scheduleStep` repeatedly to lay
   * out their timeline; the runtime tracks and cancels timers when stopped.
   */
  run: (ctx: DemoContext) => void;
}
