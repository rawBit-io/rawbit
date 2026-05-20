// src/help/registry.ts
// Ordered list of help demos. Adding a new demo = create its file under
// ./demos/ and append it here.

import { dropAndConnectDemo } from "./demos/drop-and-connect";
import { showCodeDemo } from "./demos/show-code";
import type { HelpDemo } from "./types";

export const HELP_DEMOS: HelpDemo[] = [dropAndConnectDemo, showCodeDemo];

export function getHelpDemo(id: string | null | undefined): HelpDemo | null {
  if (!id) return null;
  return HELP_DEMOS.find((demo) => demo.id === id) ?? null;
}
