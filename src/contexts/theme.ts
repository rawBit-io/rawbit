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
export const GROUP_FILL_OPACITY_MIN = 0;
export const GROUP_FILL_OPACITY_MAX = 0.5;
export const GROUP_FILL_OPACITY_STEP = 0.01;
export const EDGE_THICKNESS_MIN = 0.5;
export const EDGE_THICKNESS_MAX = 2;
export const EDGE_THICKNESS_STEP = 0.1;
export const DEFAULT_EDGE_VISIBILITY: EdgeVisibility = {
  light: 0.45,
  dark: 0.45,
};
export const DEFAULT_DASHED_EDGE_VISIBILITY: EdgeVisibility = {
  light: DEFAULT_EDGE_VISIBILITY.light / 2,
  dark: DEFAULT_EDGE_VISIBILITY.dark / 2,
};
export const DEFAULT_GROUP_FILL_OPACITY: EdgeVisibility = {
  light: 0.05,
  dark: 0.05,
};
export const DEFAULT_EDGE_THICKNESS: EdgeVisibility = {
  light: 1,
  dark: 1,
};

export type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  skin: Skin;
  setSkin: (skin: Skin) => void;
  edgeVisibility: EdgeVisibility;
  dashedEdgeVisibility: EdgeVisibility;
  groupFillOpacity: EdgeVisibility;
  edgeThickness: EdgeVisibility;
  adjustEdgeVisibility: (mode: EdgeVisibilityMode, delta: number) => void;
  adjustDashedEdgeVisibility: (
    mode: EdgeVisibilityMode,
    delta: number
  ) => void;
  adjustGroupFillOpacity: (mode: EdgeVisibilityMode, delta: number) => void;
  adjustEdgeThickness: (mode: EdgeVisibilityMode, delta: number) => void;
};

export const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined
);
