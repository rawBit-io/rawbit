// src/help/types.ts
// Shape of help demos and the runtime context they receive.

import type { Edge } from "@xyflow/react";

import type { IntroDropOverlayState } from "@/components/IntroDropOverlay";
import type { FlowNode } from "@/types";

/** Caption shown in the bottom-right card (step + title + body). */
export type DemoCaption = NonNullable<IntroDropOverlayState["caption"]>;

/**
 * Helpers + setters passed to each step's `play(ctx)`. In fast-forward mode
 * (used to set up state for a target step) `setOverlay` is a no-op and
 * `scheduleStep` collapses delays to 0 — but `setNodes`/`setEdges` and
 * direct DOM dispatches still run so the canvas reaches the expected state.
 */
export interface DemoStepContext {
  setOverlay: (state: IntroDropOverlayState | null) => void;
  setSidebarSearch: (value: string | undefined) => void;
  setSidebarHighlightLabel: (label: string | undefined) => void;
  setNodes: (updater: (prev: FlowNode[]) => FlowNode[]) => void;
  setEdges: (updater: (prev: Edge[]) => Edge[]) => void;
  scheduleStep: (delayMs: number, fn: () => void) => void;
  flowToScreen: (point: { x: number; y: number }) => { x: number; y: number };
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  isRunning: () => boolean;
}

export interface DemoStep {
  /** Stable id used as the button label and for analytics. */
  id: string;
  /** Caption shown for this step's duration. */
  caption: DemoCaption;
  /** Schedule the animated changes for this step (timings relative to step start). */
  play: (ctx: DemoStepContext) => void;
  /** Auto-advance to the next step after this many ms in normal playback. */
  durationMs: number;
}

export interface HelpDemo {
  id: string;
  title: string;
  description: string;
  category?: string;
  /** One-time setup before any step plays (clear canvas, set viewport). */
  init?: (ctx: DemoStepContext) => void;
  steps: DemoStep[];
}
