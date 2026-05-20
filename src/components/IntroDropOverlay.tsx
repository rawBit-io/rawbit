// src/components/IntroDropOverlay.tsx
// -----------------------------------------------------------------------------
// Renders the first-visit intro flow drop overlay: a fake cursor, a ghost drag
// card, and an optional video panel after the flow lands on the canvas.
// Positions are smoothly interpolated by CSS transitions on `transform`, so
// updating `cursor` / `ghost` to a new screen coordinate looks like a real
// user moving the mouse.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Square, X } from "lucide-react";

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
    /** Hooked up by guided demos: stop the running demo. */
    onPause?: () => void;
    /** Hooked up by guided demos: replay from the beginning. */
    onReplay?: () => void;
    /** True while a demo is auto-playing; controls show "Stop" instead of "Play". */
    isPlaying?: boolean;
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

export function IntroDropOverlay({ state, captionRightInset = 0 }: Props) {
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
          {(controls?.onPause || controls?.onReplay) && (
            <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-6 py-3">
              {controls.isPlaying && controls.onPause ? (
                <button
                  type="button"
                  onClick={controls.onPause}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Square className="h-4 w-4" aria-hidden="true" />
                  Stop
                </button>
              ) : controls.onReplay ? (
                <button
                  type="button"
                  onClick={controls.onReplay}
                  className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/15"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Replay
                </button>
              ) : null}
              {controls.isPlaying && controls.onReplay && (
                <button
                  type="button"
                  onClick={controls.onReplay}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
                  title="Restart this demo from the beginning"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Restart
                </button>
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
