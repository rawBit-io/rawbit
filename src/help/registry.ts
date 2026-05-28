// src/help/registry.ts
// Ordered list of help demos. Adding a new demo = create its file under
// ./demos/ and append it here.

import { dropAndConnectDemo } from "./demos/drop-and-connect";
import { p2pkhLockingScriptDemo } from "./demos/p2pkh-locking-script";
import { showCodeDemo } from "./demos/show-code";
import { verifyScriptStepsDemo } from "./demos/verify-script-steps";
import type { HelpDemo } from "./types";

export const HELP_DEMOS: HelpDemo[] = [
  dropAndConnectDemo,
  p2pkhLockingScriptDemo,
  verifyScriptStepsDemo,
  showCodeDemo,
];

export function getHelpDemo(id: string | null | undefined): HelpDemo | null {
  if (!id) return null;
  return HELP_DEMOS.find((demo) => demo.id === id) ?? null;
}
