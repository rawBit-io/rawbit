import type { MutableRefObject } from "react";

import type { SnapshotScheduler } from "@/hooks/useSnapshotScheduler";

const noop = () => undefined;

const createBooleanRef = (initial = false): MutableRefObject<boolean> => ({
  current: initial,
});

export function createSnapshotScheduler(
  overrides: Partial<SnapshotScheduler> = {}
): SnapshotScheduler {
  const base: SnapshotScheduler = {
    pushCleanState: noop,
    scheduleSnapshot: noop,
    pendingSnapshotRef: createBooleanRef(),
    skipNextEdgeSnapshotRef: createBooleanRef(),
    skipNextNodeRemovalRef: createBooleanRef(),
    markPendingAfterDirtyChange: noop,
    clearPendingAfterCalc: noop,
    lockNodeRemovalSnapshotSkip: noop,
    releaseNodeRemovalSnapshotSkip: noop,
  };

  return { ...base, ...overrides };
}
