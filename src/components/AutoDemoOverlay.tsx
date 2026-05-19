// src/components/AutoDemoOverlay.tsx
// -----------------------------------------------------------------------------
// Renders a fake "demo" cursor + a ghost drag card while guided demos play.
// Positions are smoothly interpolated by CSS transitions on `transform`, so
// updating `cursor` / `ghost` to a new screen coordinate looks like a real
// user moving the mouse.
//
// When `connection` is set the overlay also draws a live bezier "wire" that
// originates at a fixed source-handle point and tracks the cursor frame by
// frame — replicating the React Flow connection-drag a real user performs.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

import { CURSOR_TIP_OFFSET } from "@/components/autoDemoCursor";

export interface AutoDemoOverlayState {
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
}

interface Props {
  state: AutoDemoOverlayState | null;
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

export function AutoDemoOverlay({ state }: Props) {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const [wirePath, setWirePath] = useState<string | null>(null);
  const [wireEnd, setWireEnd] = useState<{ x: number; y: number } | null>(null);

  const connection = state?.connection ?? null;

  // While a connection wire is active, follow the cursor element's *live*
  // (mid-CSS-transition) position every animation frame and redraw the path.
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
  const { cursor, ghost, pressing } = state;
  if (!cursor && !ghost) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[120]"
      aria-hidden="true"
      data-testid="auto-demo-overlay"
    >
      {connection && wirePath && (
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          <path
            className="rawbit-auto-demo-wire"
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
          className="rawbit-auto-demo-ghost absolute left-0 top-0 rounded-md border border-primary/60 bg-card px-3 py-2 text-card-foreground shadow-lg"
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
          className="rawbit-auto-demo-cursor absolute left-0 top-0"
          style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            className={pressing ? "rawbit-auto-demo-cursor-press" : undefined}
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
    </div>
  );
}
