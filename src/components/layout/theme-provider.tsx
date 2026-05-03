import { useEffect, useState } from "react";
import {
  DEFAULT_DASHED_EDGE_VISIBILITY,
  DEFAULT_EDGE_VISIBILITY,
  DEFAULT_GROUP_FILL_OPACITY,
  EDGE_VISIBILITY_MAX,
  EDGE_VISIBILITY_MIN,
  GROUP_FILL_OPACITY_MAX,
  GROUP_FILL_OPACITY_MIN,
  type Skin,
  type EdgeVisibility,
  type EdgeVisibilityMode,
  type Theme,
  type ThemeProviderState,
  ThemeProviderContext,
} from "@/contexts/theme";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  skinStorageKey?: string;
  edgeVisibilityStorageKey?: string;
  dashedEdgeVisibilityStorageKey?: string;
  groupFillOpacityStorageKey?: string;
};

const VALID_SKINS: readonly Skin[] = [
  "shadcn",
  "paper",
  "midnight",
];

const VALID_THEMES: readonly Theme[] = ["dark", "light", "system"];
const DEFAULT_SKIN: Skin = "paper";

function normalizeTheme(value: string | null, fallback: Theme): Theme {
  if (value && VALID_THEMES.includes(value as Theme)) {
    return value as Theme;
  }
  return fallback;
}

function normalizeSkin(value: string | null): Skin {
  if (value === "default") {
    return "shadcn";
  }
  if (value && VALID_SKINS.includes(value as Skin)) {
    return value as Skin;
  }
  return DEFAULT_SKIN;
}

function clampEdgeVisibility(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.min(EDGE_VISIBILITY_MAX, Math.max(EDGE_VISIBILITY_MIN, parsed));
  return Number(clamped.toFixed(2));
}

function clampGroupFillOpacity(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.min(
    GROUP_FILL_OPACITY_MAX,
    Math.max(GROUP_FILL_OPACITY_MIN, parsed)
  );
  return Number(clamped.toFixed(2));
}

function halfEdgeVisibility(value: EdgeVisibility): EdgeVisibility {
  return {
    light: Number(
      Math.min(
        EDGE_VISIBILITY_MAX,
        Math.max(EDGE_VISIBILITY_MIN, value.light / 2)
      ).toFixed(3)
    ),
    dark: Number(
      Math.min(
        EDGE_VISIBILITY_MAX,
        Math.max(EDGE_VISIBILITY_MIN, value.dark / 2)
      ).toFixed(3)
    ),
  };
}

function normalizeEdgeVisibility(
  value: unknown,
  fallback: EdgeVisibility = DEFAULT_EDGE_VISIBILITY
): EdgeVisibility {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<Record<EdgeVisibilityMode, unknown>>)
      : {};
  return {
    light: clampEdgeVisibility(candidate.light, fallback.light),
    dark: clampEdgeVisibility(candidate.dark, fallback.dark),
  };
}

function normalizeGroupFillOpacity(
  value: unknown,
  fallback: EdgeVisibility = DEFAULT_GROUP_FILL_OPACITY
): EdgeVisibility {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<Record<EdgeVisibilityMode, unknown>>)
      : {};
  return {
    light: clampGroupFillOpacity(candidate.light, fallback.light),
    dark: clampGroupFillOpacity(candidate.dark, fallback.dark),
  };
}

function parseStoredEdgeVisibility(
  value: string | null,
  fallback: EdgeVisibility = DEFAULT_EDGE_VISIBILITY
): EdgeVisibility {
  if (!value) return fallback;
  try {
    return normalizeEdgeVisibility(JSON.parse(value), fallback);
  } catch {
    return fallback;
  }
}

function parseStoredGroupFillOpacity(value: string | null): EdgeVisibility {
  if (!value) return DEFAULT_GROUP_FILL_OPACITY;
  try {
    return normalizeGroupFillOpacity(JSON.parse(value));
  } catch {
    return DEFAULT_GROUP_FILL_OPACITY;
  }
}

function serializeEdgeVisibility(value: EdgeVisibility): string {
  return JSON.stringify(value);
}

function applyEdgeVisibilityCss({
  edgeVisibility,
  dashedEdgeVisibility,
  groupFillOpacity,
}: {
  edgeVisibility: EdgeVisibility;
  dashedEdgeVisibility: EdgeVisibility;
  groupFillOpacity: EdgeVisibility;
}): void {
  const root = window.document.documentElement;
  root.style.setProperty("--edge-light-opacity", String(edgeVisibility.light));
  root.style.setProperty("--edge-dark-opacity", String(edgeVisibility.dark));
  root.style.setProperty(
    "--edge-light-dashed-opacity",
    String(dashedEdgeVisibility.light)
  );
  root.style.setProperty(
    "--edge-dark-dashed-opacity",
    String(dashedEdgeVisibility.dark)
  );
  root.style.setProperty(
    "--group-light-fill-opacity",
    String(groupFillOpacity.light)
  );
  root.style.setProperty(
    "--group-dark-fill-opacity",
    String(groupFillOpacity.dark)
  );
}

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be disabled by browser settings; keep in-memory state usable.
  }
}

// This script will run before your React app mounts
// to prevent theme flashing
const setInitialTheme = (
  storageKey: string,
  defaultTheme: Theme,
  skinStorageKey: string,
  edgeVisibilityStorageKey: string,
  dashedEdgeVisibilityStorageKey: string,
  groupFillOpacityStorageKey: string
) => {
  const validSkins = JSON.stringify(VALID_SKINS);
  const validThemes = JSON.stringify(VALID_THEMES);
  const defaultSkin = DEFAULT_SKIN;
  const storageKeyJson = JSON.stringify(storageKey);
  const skinStorageKeyJson = JSON.stringify(skinStorageKey);
  const defaultThemeJson = JSON.stringify(defaultTheme);
  const defaultSkinJson = JSON.stringify(defaultSkin);
  const edgeVisibilityStorageKeyJson = JSON.stringify(edgeVisibilityStorageKey);
  const dashedEdgeVisibilityStorageKeyJson = JSON.stringify(
    dashedEdgeVisibilityStorageKey
  );
  const groupFillOpacityStorageKeyJson = JSON.stringify(
    groupFillOpacityStorageKey
  );
  const defaultEdgeVisibilityJson = JSON.stringify(DEFAULT_EDGE_VISIBILITY);
  const defaultDashedEdgeVisibilityJson = JSON.stringify(
    DEFAULT_DASHED_EDGE_VISIBILITY
  );
  const defaultGroupFillOpacityJson = JSON.stringify(DEFAULT_GROUP_FILL_OPACITY);
  const edgeVisibilityMinJson = JSON.stringify(EDGE_VISIBILITY_MIN);
  const edgeVisibilityMaxJson = JSON.stringify(EDGE_VISIBILITY_MAX);
  const groupFillOpacityMinJson = JSON.stringify(GROUP_FILL_OPACITY_MIN);
  const groupFillOpacityMaxJson = JSON.stringify(GROUP_FILL_OPACITY_MAX);
  // This function will be converted to a string and injected into a script tag
  return `(function() {
    var storageKey = ${storageKeyJson};
    var skinStorageKey = ${skinStorageKeyJson};
    var edgeVisibilityStorageKey = ${edgeVisibilityStorageKeyJson};
    var dashedEdgeVisibilityStorageKey = ${dashedEdgeVisibilityStorageKeyJson};
    var groupFillOpacityStorageKey = ${groupFillOpacityStorageKeyJson};
    var defaultTheme = ${defaultThemeJson};
    var defaultSkin = ${defaultSkinJson};
    var defaultEdgeVisibility = ${defaultEdgeVisibilityJson};
    var defaultDashedEdgeVisibility = ${defaultDashedEdgeVisibilityJson};
    var defaultGroupFillOpacity = ${defaultGroupFillOpacityJson};
    var edgeVisibilityMin = ${edgeVisibilityMinJson};
    var edgeVisibilityMax = ${edgeVisibilityMaxJson};
    var groupFillOpacityMin = ${groupFillOpacityMinJson};
    var groupFillOpacityMax = ${groupFillOpacityMaxJson};
    var validThemes = ${validThemes};
    var validSkins = ${validSkins};
    const getStoredTheme = () => {
      try {
        return localStorage.getItem(storageKey);
      } catch (_) {
        return null;
      }
    };
    const getSystemTheme = () => {
      if (typeof window.matchMedia !== 'function') {
        return 'light';
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const storedTheme = getStoredTheme();
    const theme = validThemes.includes(storedTheme) ? storedTheme : defaultTheme;
    const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;

    document.documentElement.classList.add(resolvedTheme);

    var rawSkin = null;
    try {
      rawSkin = localStorage.getItem(skinStorageKey);
    } catch (_) {}
    var migratedSkin = rawSkin === 'default' ? 'shadcn' : rawSkin;
    var skin = validSkins.includes(migratedSkin) ? migratedSkin : defaultSkin;
    if (skin !== rawSkin) {
      try {
        localStorage.setItem(skinStorageKey, skin);
      } catch (_) {}
    }
    document.documentElement.dataset.skin = skin;

    function clampEdgeVisibility(value, fallback) {
      var parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(edgeVisibilityMax, Math.max(edgeVisibilityMin, parsed));
    }
    function clampGroupFillOpacity(value, fallback) {
      var parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(groupFillOpacityMax, Math.max(groupFillOpacityMin, parsed));
    }
    function normalizeEdgeVisibility(value, fallback) {
      value = value && typeof value === 'object' ? value : {};
      fallback = fallback || defaultEdgeVisibility;
      return {
        light: clampEdgeVisibility(value.light, fallback.light),
        dark: clampEdgeVisibility(value.dark, fallback.dark)
      };
    }
    function normalizeGroupFillOpacity(value, fallback) {
      value = value && typeof value === 'object' ? value : {};
      fallback = fallback || defaultGroupFillOpacity;
      return {
        light: clampGroupFillOpacity(value.light, fallback.light),
        dark: clampGroupFillOpacity(value.dark, fallback.dark)
      };
    }
    function halfEdgeVisibility(value) {
      return {
        light: clampEdgeVisibility(value.light / 2, defaultDashedEdgeVisibility.light),
        dark: clampEdgeVisibility(value.dark / 2, defaultDashedEdgeVisibility.dark)
      };
    }
    var edgeVisibility = defaultEdgeVisibility;
    try {
      var rawEdgeVisibility = localStorage.getItem(edgeVisibilityStorageKey);
      if (rawEdgeVisibility) {
        edgeVisibility = normalizeEdgeVisibility(JSON.parse(rawEdgeVisibility), defaultEdgeVisibility);
      }
    } catch (_) {}
    var dashedEdgeVisibility = halfEdgeVisibility(edgeVisibility);
    try {
      var rawDashedEdgeVisibility = localStorage.getItem(dashedEdgeVisibilityStorageKey);
      if (rawDashedEdgeVisibility) {
        dashedEdgeVisibility = normalizeEdgeVisibility(JSON.parse(rawDashedEdgeVisibility), halfEdgeVisibility(edgeVisibility));
      }
    } catch (_) {}
    var groupFillOpacity = defaultGroupFillOpacity;
    try {
      var rawGroupFillOpacity = localStorage.getItem(groupFillOpacityStorageKey);
      if (rawGroupFillOpacity) {
        groupFillOpacity = normalizeGroupFillOpacity(JSON.parse(rawGroupFillOpacity), defaultGroupFillOpacity);
      }
    } catch (_) {}
    document.documentElement.style.setProperty('--edge-light-opacity', String(edgeVisibility.light));
    document.documentElement.style.setProperty('--edge-dark-opacity', String(edgeVisibility.dark));
    document.documentElement.style.setProperty('--edge-light-dashed-opacity', String(dashedEdgeVisibility.light));
    document.documentElement.style.setProperty('--edge-dark-dashed-opacity', String(dashedEdgeVisibility.dark));
    document.documentElement.style.setProperty('--group-light-fill-opacity', String(groupFillOpacity.light));
    document.documentElement.style.setProperty('--group-dark-fill-opacity', String(groupFillOpacity.dark));
  })();`;
};

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  skinStorageKey = "vite-ui-skin",
  edgeVisibilityStorageKey = "vite-ui-edge-visibility",
  dashedEdgeVisibilityStorageKey = "vite-ui-dashed-edge-visibility",
  groupFillOpacityStorageKey = "vite-ui-group-fill-opacity",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => normalizeTheme(safeStorageGet(storageKey), defaultTheme)
  );
  const [skin, setSkin] = useState<Skin>(() =>
    normalizeSkin(safeStorageGet(skinStorageKey))
  );
  const [edgeVisibility, setEdgeVisibility] = useState<EdgeVisibility>(() =>
    parseStoredEdgeVisibility(safeStorageGet(edgeVisibilityStorageKey))
  );
  const [dashedEdgeVisibility, setDashedEdgeVisibility] = useState<EdgeVisibility>(
    () =>
      parseStoredEdgeVisibility(
        safeStorageGet(dashedEdgeVisibilityStorageKey),
        halfEdgeVisibility(edgeVisibility)
      )
  );
  const [groupFillOpacity, setGroupFillOpacity] = useState<EdgeVisibility>(() =>
    parseStoredGroupFillOpacity(safeStorageGet(groupFillOpacityStorageKey))
  );
  const [mounted, setMounted] = useState(false);

  // Set up the initial theme script
  useEffect(() => {
    // Only inject the script on client-side
    if (typeof window !== "undefined") {
      const script = document.createElement("script");
      script.textContent = setInitialTheme(
        storageKey,
        defaultTheme,
        skinStorageKey,
        edgeVisibilityStorageKey,
        dashedEdgeVisibilityStorageKey,
        groupFillOpacityStorageKey
      );
      script.id = "theme-initializer";

      const existingScript = document.getElementById("theme-initializer");
      if (!existingScript) {
        document.head.appendChild(script);
      }
    }

    setMounted(true);
  }, [
    dashedEdgeVisibilityStorageKey,
    defaultTheme,
    edgeVisibilityStorageKey,
    groupFillOpacityStorageKey,
    storageKey,
    skinStorageKey,
  ]);

  useEffect(() => {
    if (!mounted) return;

    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const root = window.document.documentElement;
    root.dataset.skin = skin;
  }, [skin, mounted]);

  useEffect(() => {
    if (!mounted) return;
    applyEdgeVisibilityCss({
      edgeVisibility,
      dashedEdgeVisibility,
      groupFillOpacity,
    });
  }, [dashedEdgeVisibility, edgeVisibility, groupFillOpacity, mounted]);

  const saveVisibility = (
    storageKey: string,
    setVisibility: React.Dispatch<React.SetStateAction<EdgeVisibility>>,
    getNextValue: (current: EdgeVisibility) => EdgeVisibility
  ) => {
    setVisibility((current) => {
      const normalized = normalizeEdgeVisibility(getNextValue(current));
      safeStorageSet(storageKey, serializeEdgeVisibility(normalized));
      return normalized;
    });
  };

  const value: ThemeProviderState = {
    theme,
    setTheme: (theme: Theme) => {
      safeStorageSet(storageKey, theme);
      setTheme(theme);
    },
    skin,
    setSkin: (skin: Skin) => {
      const normalizedSkin = normalizeSkin(skin);
      safeStorageSet(skinStorageKey, normalizedSkin);
      setSkin(normalizedSkin);
    },
    edgeVisibility,
    dashedEdgeVisibility,
    groupFillOpacity,
    adjustEdgeVisibility: (mode: EdgeVisibilityMode, delta: number) => {
      saveVisibility(
        edgeVisibilityStorageKey,
        setEdgeVisibility,
        (current) => ({
          ...current,
          [mode]: current[mode] + delta,
        })
      );
    },
    adjustDashedEdgeVisibility: (mode: EdgeVisibilityMode, delta: number) => {
      saveVisibility(
        dashedEdgeVisibilityStorageKey,
        setDashedEdgeVisibility,
        (current) => ({
          ...current,
          [mode]: current[mode] + delta,
        })
      );
    },
    adjustGroupFillOpacity: (mode: EdgeVisibilityMode, delta: number) => {
      setGroupFillOpacity((current) => {
        const normalized = normalizeGroupFillOpacity({
          ...current,
          [mode]: current[mode] + delta,
        });
        safeStorageSet(
          groupFillOpacityStorageKey,
          serializeEdgeVisibility(normalized)
        );
        return normalized;
      });
    },
  };

  // Avoid theme flashing by not rendering until mounted
  if (!mounted) {
    return null;
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}
