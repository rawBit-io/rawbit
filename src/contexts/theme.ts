import { createContext } from "react";

export type Theme = "dark" | "light" | "system";
export type Skin =
  | "shadcn"
  | "paper"
  | "midnight";
export type EdgeVisibilityMode = "light" | "dark";
export type EdgeVisibility = Record<EdgeVisibilityMode, number>;

export const EDGE_VISIBILITY_MIN = 0.1;
export const EDGE_VISIBILITY_MAX = 1;
export const EDGE_VISIBILITY_STEP = 0.05;
export const DEFAULT_EDGE_VISIBILITY: EdgeVisibility = {
  light: 0.45,
  dark: 0.45,
};

export type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  skin: Skin;
  setSkin: (skin: Skin) => void;
  edgeVisibility: EdgeVisibility;
  adjustEdgeVisibility: (mode: EdgeVisibilityMode, delta: number) => void;
};

export const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined
);
