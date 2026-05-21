// src/components/IntroDropOverlay.tsx
// -----------------------------------------------------------------------------
// Renders the first-visit intro flow drop overlay: a fake cursor, a ghost drag
// card, and an optional video panel after the flow lands on the canvas.
// Positions are smoothly interpolated by CSS transitions on `transform`, so
// updating `cursor` / `ghost` to a new screen coordinate looks like a real
// user moving the mouse.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";

import { CURSOR_TIP_OFFSET } from "@/components/introDropCursor";
import type { HelpMenuDesignId } from "@/help/designs";
import { cn } from "@/lib/utils";

export interface IntroDropOverlayState {
  cursor: { x: number; y: number } | null;
  ghost: {
    x: number;
    y: number;
    label: string;
    eyebrow?: string;
    detail?: string;
  } | null;
  pressing?: boolean;
  /** Fixed screen point of the source handle while a wire is being dragged. */
  connection?: { x: number; y: number } | null;
  caption?: {
    step?: string;
    title: string;
    body?: string;
    video?: {
      src: string;
      title: string;
    };
  } | null;
  controls?: {
    closeLabel?: string;
    onClose?: () => void;
    /** Step-by-step demo controls (set by the help-demo runtime). */
    onPause?: () => void;
    onPlay?: () => void;
    onPrev?: () => void;
    onNext?: () => void;
    onReplay?: () => void;
    isPlaying?: boolean;
    canPrev?: boolean;
    canNext?: boolean;
    /** Labels like "3 / 7" for the current step. */
    stepLabel?: string;
  } | null;
}

interface Props {
  state: IntroDropOverlayState | null;
  helpControlDesign?: HelpMenuDesignId;
  /**
   * Pixels of right-side area the caption card should avoid (e.g. the help
   * menu width when it's open). The card right-aligns past this inset.
   */
  captionRightInset?: number;
}

/**
 * Bezier path matching React Flow's left/right handle connection line, so the
 * dragged wire looks identical to one a user would pull between ports.
 */
function bezierPath(sx: number, sy: number, tx: number, ty: number) {
  const curvature = 0.25;
  const offset = curvature * Math.max(Math.abs(tx - sx), 60);
  const sourceControlX = sx + offset;
  const targetControlX = tx - offset;
  return `M ${sx},${sy} C ${sourceControlX},${sy} ${targetControlX},${ty} ${tx},${ty}`;
}

export function IntroDropOverlay({
  state,
  helpControlDesign = "original",
  captionRightInset = 0,
}: Props) {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const [wirePath, setWirePath] = useState<string | null>(null);
  const [wireEnd, setWireEnd] = useState<{ x: number; y: number } | null>(null);

  const connection = state?.connection ?? null;

  // While a connection wire is active, follow the cursor element's live
  // CSS-transition position every animation frame and redraw the path.
  useEffect(() => {
    if (!connection) {
      setWirePath(null);
      setWireEnd(null);
      return;
    }

    let frame = 0;
    const tick = () => {
      const el = cursorRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const tx = rect.left + CURSOR_TIP_OFFSET.x;
        const ty = rect.top + CURSOR_TIP_OFFSET.y;
        setWirePath(bezierPath(connection.x, connection.y, tx, ty));
        setWireEnd({ x: tx, y: ty });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [connection]);

  if (!state) return null;
  const { cursor, ghost, pressing, caption, controls } = state;
  const hasInteractiveContent = Boolean(caption?.video || controls);
  if (!cursor && !ghost && !caption && !controls) return null;
  const controlRowClass = cn(
    "flex items-center justify-between gap-2 border-t px-6 py-3",
    helpControlDesign === "original" && "border-border bg-muted/40",
    helpControlDesign === "path" && "border-primary/15 bg-primary/5",
    helpControlDesign === "console" &&
      "border-zinc-800 bg-zinc-950 text-zinc-50",
    helpControlDesign === "library" && "border-border bg-background",
  );
  const secondaryControlClass = cn(
    "inline-flex h-9 w-9 items-center justify-center border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
    helpControlDesign === "path" &&
      "rounded-full border-primary/25 bg-background text-primary hover:bg-primary hover:text-primary-foreground",
    helpControlDesign === "console" &&
      "rounded-sm border-zinc-700 bg-zinc-900 text-zinc-50 hover:bg-zinc-800",
    helpControlDesign === "library" &&
      "rounded-md border-border bg-card text-foreground hover:border-primary/35 hover:bg-primary/10",
    helpControlDesign === "original" &&
      "rounded-md border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
  );
  const primaryControlClass = cn(
    "inline-flex h-9 w-9 items-center justify-center border transition-colors",
    helpControlDesign === "path" &&
      "rounded-full border-primary bg-primary text-primary-foreground hover:bg-primary/90",
    helpControlDesign === "console" &&
      "rounded-sm border-zinc-100 bg-zinc-50 text-zinc-950 hover:bg-white",
    helpControlDesign === "library" &&
      "rounded-md border-primary/40 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground",
    helpControlDesign === "original" &&
      "rounded-md border-primary/50 bg-primary/10 text-primary hover:bg-primary/15",
  );
  const restartControlClass = cn(
    secondaryControlClass,
    helpControlDesign === "path" ? "ml-0" : "ml-1",
  );
  const stepLabelClass = cn(
    "text-xs font-medium uppercase text-muted-foreground",
    helpControlDesign === "console"
      ? "font-mono tracking-widest text-zinc-400"
      : "tracking-wide",
  );

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[120]"
      aria-hidden={hasInteractiveContent ? undefined : true}
      data-testid="intro-drop-overlay"
    >
      {connection && wirePath && (
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          <path
            className="rawbit-intro-drop-wire"
            d={wirePath}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <circle
            cx={connection.x}
            cy={connection.y}
            r={4}
            fill="hsl(var(--primary))"
          />
          {wireEnd && (
            <circle
              cx={wireEnd.x}
              cy={wireEnd.y}
              r={4}
              fill="hsl(var(--background))"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
            />
          )}
        </svg>
      )}

      {ghost && (
        <div
          className="rawbit-intro-drop-ghost absolute left-0 top-0 rounded-md border border-primary/60 bg-card px-3 py-2 text-card-foreground shadow-lg"
          style={{ transform: `translate(${ghost.x}px, ${ghost.y}px)` }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {ghost.eyebrow ?? "Canvas & Inputs"}
          </div>
          <div className="mt-0.5 text-sm font-semibold leading-tight">
            {ghost.label}
          </div>
          {ghost.detail && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {ghost.detail}
            </div>
          )}
        </div>
      )}

      {cursor && (
        <div
          ref={cursorRef}
          className="rawbit-intro-drop-cursor absolute left-0 top-0"
          style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            className={pressing ? "rawbit-intro-drop-cursor-press" : undefined}
          >
            <path
              d="M4 3 L20 12 L12.8 13.4 L10.4 20.6 Z"
              fill="#ffffff"
              stroke="#111827"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}

      {caption && (
        <div
          className="pointer-events-auto absolute bottom-4 w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-lg sm:bottom-8"
          style={{ right: captionRightInset + 16 }}
        >
          {controls?.onClose && (
            <button
              type="button"
              aria-label={controls.closeLabel ?? "Close"}
              className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={controls.onClose}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <div className="px-6 py-5 pr-14">
            {caption.step && (
              <div className="text-sm font-semibold uppercase tracking-normal text-muted-foreground">
                {caption.step}
              </div>
            )}
            <div className="text-3xl font-semibold leading-tight text-primary">
              {caption.title}
            </div>
            {caption.body && (
              <div className="mt-2 whitespace-pre-line text-lg leading-snug text-muted-foreground">
                {caption.body}
              </div>
            )}
          </div>
          {(controls?.onPrev ||
            controls?.onPause ||
            controls?.onPlay ||
            controls?.onNext ||
            controls?.onReplay) && (
            <div className={controlRowClass}>
              <div className="flex items-center gap-1.5">
                {controls.onPrev && (
                  <button
                    type="button"
                    onClick={controls.onPrev}
                    disabled={!controls.canPrev}
                    aria-label="Previous step"
                    title="Previous step"
                    className={secondaryControlClass}
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                )}
                {controls.isPlaying && controls.onPause ? (
                  <button
                    type="button"
                    onClick={controls.onPause}
                    aria-label="Pause"
                    title="Pause"
                    className={primaryControlClass}
                  >
                    <Pause className="h-5 w-5" aria-hidden="true" />
                  </button>
                ) : controls.onPlay ? (
                  <button
                    type="button"
                    onClick={controls.onPlay}
                    aria-label="Play"
                    title="Play current step"
                    className={primaryControlClass}
                  >
                    <Play className="h-5 w-5" aria-hidden="true" />
                  </button>
                ) : null}
                {controls.onNext && (
                  <button
                    type="button"
                    onClick={controls.onNext}
                    disabled={!controls.canNext}
                    aria-label="Next step"
                    title="Next step"
                    className={secondaryControlClass}
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                )}
                {controls.onReplay && (
                  <button
                    type="button"
                    onClick={controls.onReplay}
                    aria-label="Restart from beginning"
                    title="Restart from beginning"
                    className={restartControlClass}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {controls.stepLabel && (
                <div className={stepLabelClass}>
                  {controls.stepLabel}
                </div>
              )}
            </div>
          )}
          {caption.video && (
            <div className="bg-background">
              <iframe
                className="aspect-video w-full"
                src={caption.video.src}
                title={caption.video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
