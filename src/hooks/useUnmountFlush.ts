import { useEffect, useRef } from "react";

export interface PendingFlush {
  /** Whether there is an uncommitted edit worth flushing right now. */
  shouldFlush: boolean;
  /** Commit the pending edit. Called at most once, on unmount. */
  flush: () => void;
}

/**
 * Commit an in-progress edit when the component unmounts.
 *
 * Nodes are culled off-viewport (React Flow `onlyRenderVisibleElements`)
 * without firing blur, so an edit held in `useState` would be silently lost
 * when the user pans away mid-edit. Pass the latest `{ shouldFlush, flush }`
 * every render; it is captured in a ref and invoked once on unmount if a
 * pending edit remains.
 *
 * Replaces the hand-rolled "latest-ref + empty-dep cleanup effect" idiom that
 * every blur-committing node field otherwise repeats.
 */
export function useUnmountFlush(pending: PendingFlush): void {
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(
    () => () => {
      if (pendingRef.current.shouldFlush) pendingRef.current.flush();
    },
    []
  );
}
