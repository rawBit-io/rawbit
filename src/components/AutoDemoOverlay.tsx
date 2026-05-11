// src/components/AutoDemoOverlay.tsx
// -----------------------------------------------------------------------------
// Renders a fake "demo" cursor + a ghost drag card while runAutoDemo plays.
// Positions are smoothly interpolated by CSS transitions on `transform`, so
// updating `cursor` / `ghost` to a new screen coordinate looks like a real
// user moving the mouse.
// -----------------------------------------------------------------------------

export interface AutoDemoOverlayState {
  cursor: { x: number; y: number } | null;
  ghost: { x: number; y: number; label: string } | null;
  pressing?: boolean;
}

interface Props {
  state: AutoDemoOverlayState | null;
}

export function AutoDemoOverlay({ state }: Props) {
  if (!state) return null;
  const { cursor, ghost, pressing } = state;
  if (!cursor && !ghost) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[120]"
      aria-hidden="true"
      data-testid="auto-demo-overlay"
    >
      {ghost && (
        <div
          className="rawbit-auto-demo-ghost absolute left-0 top-0 rounded-md border border-primary/60 bg-card px-3 py-2 text-card-foreground shadow-lg"
          style={{ transform: `translate(${ghost.x}px, ${ghost.y}px)` }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Canvas &amp; Inputs
          </div>
          <div className="mt-0.5 text-sm font-semibold leading-tight">
            {ghost.label}
          </div>
        </div>
      )}

      {cursor && (
        <div
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
