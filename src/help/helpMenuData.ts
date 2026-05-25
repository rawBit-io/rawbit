// src/help/helpMenuData.ts
// Shared, view-agnostic category data + grouping logic for guided help.

import { useMemo, useState } from "react";

import { HELP_DEMOS } from "./registry";
import type { HelpDemo } from "./types";

export const ALL_TOPICS = "all";

export const CATEGORY_ORDER = [
  "Canvas basics",
  "Script walkthroughs",
  "Transactions",
  "Keys & signing",
];

export const categoryMeta: Record<
  string,
  { label: string; description: string }
> = {
  "Canvas basics": {
    label: "Canvas",
    description:
      "Start here: place nodes, connect ports, edit values, and inspect node code.",
  },
  "Script walkthroughs": {
    label: "Scripts",
    description:
      "Step through script execution, stack changes, signatures, and failure cases.",
  },
  Transactions: {
    label: "Transactions",
    description:
      "Build and inspect transaction fields, witnesses, preimages, and signatures.",
  },
  "Keys & signing": {
    label: "Keys",
    description:
      "Understand addresses, key tweaks, signatures, and hardware signing flows.",
  },
};

export function categoryLabel(category: string) {
  return categoryMeta[category]?.label ?? category;
}

export function categoryDescription(category: string) {
  return (
    categoryMeta[category]?.description ??
    "Focused demos for this part of the rawBit workflow."
  );
}

export interface CategoryGroup {
  category: string;
  demos: HelpDemo[];
}

/**
 * Returns demos grouped by category (in the configured order) plus the
 * subset live + the visible subset filtered by `selectedCategory`. Variants
 * share this hook so visual divergence stays in the JSX only.
 */
export function useCategoryGroups(selectedCategory: string) {
  const grouped = useMemo<CategoryGroup[]>(() => {
    const byCategory = new Map<string, HelpDemo[]>();
    for (const demo of HELP_DEMOS) {
      const category = demo.category ?? "Demos";
      const bucket = byCategory.get(category) ?? [];
      bucket.push(demo);
      byCategory.set(category, bucket);
    }
    const ordered = CATEGORY_ORDER.map((category) => ({
      category,
      demos: byCategory.get(category) ?? [],
    }));
    for (const [category, demos] of byCategory) {
      if (!CATEGORY_ORDER.includes(category)) {
        ordered.push({ category, demos });
      }
    }
    return ordered;
  }, []);

  const liveGroups = useMemo(
    () => grouped.filter(({ demos }) => demos.length > 0),
    [grouped],
  );

  const visibleGroups = useMemo(
    () =>
      selectedCategory === ALL_TOPICS
        ? liveGroups
        : liveGroups.filter(({ category }) => category === selectedCategory),
    [liveGroups, selectedCategory],
  );

  return { grouped, liveGroups, visibleGroups };
}

export function useHelpMenuState() {
  const [selectedCategory, setSelectedCategory] = useState(ALL_TOPICS);
  const groups = useCategoryGroups(selectedCategory);
  return { selectedCategory, setSelectedCategory, ...groups };
}

export const totalDemoCount = HELP_DEMOS.length;
