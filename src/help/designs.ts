export const HELP_MENU_DESIGNS = [
  {
    id: "original",
    label: "Original",
    description: "Current guided panel",
  },
  {
    id: "path",
    label: "Path",
    description: "Bright newcomer route",
  },
  {
    id: "console",
    label: "Console",
    description: "Compact technical index",
  },
  {
    id: "library",
    label: "Library",
    description: "Feature catalog view",
  },
] as const;

export type HelpMenuDesignId = (typeof HELP_MENU_DESIGNS)[number]["id"];

export const DEFAULT_HELP_MENU_DESIGN: HelpMenuDesignId = "original";

export function isHelpMenuDesignId(value: unknown): value is HelpMenuDesignId {
  return HELP_MENU_DESIGNS.some((design) => design.id === value);
}
