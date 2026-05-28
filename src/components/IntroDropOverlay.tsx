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
  clickPulse?: boolean;
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
  const {
    cursor,
    ghost,
    pressing,
    clickPulse,
    caption,
    controls,
  } = state;
  const hasInteractiveContent = Boolean(caption?.video || controls);
  if (!cursor && !ghost && !caption && !controls) return null;
  const showCaptionStep =
    Boolean(caption?.step) && !controls?.stepLabel;
  const hasStepControls = Boolean(
    controls?.onPrev ||
      controls?.onPause ||
      controls?.onPlay ||
      controls?.onNext ||
      controls?.onReplay,
  );
  const captionRightGap = hasStepControls ? 88 : 16;
  const clickRing = cursor && clickPulse
    ? {
        x: cursor.x + CURSOR_TIP_OFFSET.x - 28,
        y: cursor.y + CURSOR_TIP_OFFSET.y - 28,
      }
    : null;

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

      {clickRing && (
        <div
          className="rawbit-intro-click-ring absolute left-0 top-0"
          style={{
            left: clickRing.x,
            top: clickRing.y,
          }}
        />
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
          className="pointer-events-auto absolute bottom-4 overflow-hidden rounded-md border border-border bg-background text-foreground shadow-md sm:bottom-8"
          style={{
            right: captionRightInset + captionRightGap,
            width: "min(30rem, calc(100vw - 8rem))",
          }}
        >
          {controls?.onClose && (
            <button
              type="button"
              aria-label={controls.closeLabel ?? "Close"}
              className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={controls.onClose}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <div className="px-5 py-4 pr-12">
            {showCaptionStep && (
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {caption.step}
              </div>
            )}
            <div className="mt-1 text-lg font-semibold leading-tight tracking-tight text-foreground">
              {caption.title}
            </div>
            {caption.body && (
              <div className="mt-2 whitespace-pre-line text-base leading-relaxed text-muted-foreground">
                {caption.body}
              </div>
            )}
          </div>
          {(controls?.onPrev ||
            controls?.onPause ||
            controls?.onPlay ||
            controls?.onNext ||
            controls?.onReplay) && (
            <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-5 py-3">
              <div className="flex items-center gap-1.5">
                {controls.onPrev && (
                  <button
                    type="button"
                    onClick={controls.onPrev}
                    disabled={!controls.canPrev}
                    aria-label="Previous step"
                    title="Previous step"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-primary/50 bg-primary/10 text-primary hover:bg-primary/15"
                  >
                    <Pause className="h-5 w-5" aria-hidden="true" />
                  </button>
                ) : controls.onPlay ? (
                  <button
                    type="button"
                    onClick={controls.onPlay}
                    aria-label="Play"
                    title="Resume demo"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-primary/50 bg-primary/10 text-primary hover:bg-primary/15"
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
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
                    className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {controls.stepLabel && (
                <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
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
