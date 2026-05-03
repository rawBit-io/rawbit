import { useEffect, useState } from "react";
import {
  DEFAULT_EDGE_VISIBILITY,
  EDGE_VISIBILITY_MAX,
  EDGE_VISIBILITY_MIN,
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

function normalizeEdgeVisibility(value: unknown): EdgeVisibility {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<Record<EdgeVisibilityMode, unknown>>)
      : {};
  return {
    light: clampEdgeVisibility(candidate.light, DEFAULT_EDGE_VISIBILITY.light),
    dark: clampEdgeVisibility(candidate.dark, DEFAULT_EDGE_VISIBILITY.dark),
  };
}

function parseStoredEdgeVisibility(value: string | null): EdgeVisibility {
  if (!value) return DEFAULT_EDGE_VISIBILITY;
  try {
    return normalizeEdgeVisibility(JSON.parse(value));
  } catch {
    return DEFAULT_EDGE_VISIBILITY;
  }
}

function serializeEdgeVisibility(value: EdgeVisibility): string {
  return JSON.stringify(value);
}

function applyEdgeVisibilityCss(value: EdgeVisibility): void {
  const root = window.document.documentElement;
  root.style.setProperty("--edge-light-opacity", String(value.light));
  root.style.setProperty("--edge-dark-opacity", String(value.dark));
  root.style.setProperty("--edge-light-dashed-opacity", String(value.light / 2));
  root.style.setProperty("--edge-dark-dashed-opacity", String(value.dark / 2));
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
  edgeVisibilityStorageKey: string
) => {
  const validSkins = JSON.stringify(VALID_SKINS);
  const validThemes = JSON.stringify(VALID_THEMES);
  const defaultSkin = DEFAULT_SKIN;
  const storageKeyJson = JSON.stringify(storageKey);
  const skinStorageKeyJson = JSON.stringify(skinStorageKey);
  const defaultThemeJson = JSON.stringify(defaultTheme);
  const defaultSkinJson = JSON.stringify(defaultSkin);
  const edgeVisibilityStorageKeyJson = JSON.stringify(edgeVisibilityStorageKey);
  const defaultEdgeVisibilityJson = JSON.stringify(DEFAULT_EDGE_VISIBILITY);
  const edgeVisibilityMinJson = JSON.stringify(EDGE_VISIBILITY_MIN);
  const edgeVisibilityMaxJson = JSON.stringify(EDGE_VISIBILITY_MAX);
  // This function will be converted to a string and injected into a script tag
  return `(function() {
    var storageKey = ${storageKeyJson};
    var skinStorageKey = ${skinStorageKeyJson};
    var edgeVisibilityStorageKey = ${edgeVisibilityStorageKeyJson};
    var defaultTheme = ${defaultThemeJson};
    var defaultSkin = ${defaultSkinJson};
    var defaultEdgeVisibility = ${defaultEdgeVisibilityJson};
    var edgeVisibilityMin = ${edgeVisibilityMinJson};
    var edgeVisibilityMax = ${edgeVisibilityMaxJson};
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
    function normalizeEdgeVisibility(value) {
      value = value && typeof value === 'object' ? value : {};
      return {
        light: clampEdgeVisibility(value.light, defaultEdgeVisibility.light),
        dark: clampEdgeVisibility(value.dark, defaultEdgeVisibility.dark)
      };
    }
    var edgeVisibility = defaultEdgeVisibility;
    try {
      var rawEdgeVisibility = localStorage.getItem(edgeVisibilityStorageKey);
      if (rawEdgeVisibility) {
        edgeVisibility = normalizeEdgeVisibility(JSON.parse(rawEdgeVisibility));
      }
    } catch (_) {}
    document.documentElement.style.setProperty('--edge-light-opacity', String(edgeVisibility.light));
    document.documentElement.style.setProperty('--edge-dark-opacity', String(edgeVisibility.dark));
    document.documentElement.style.setProperty('--edge-light-dashed-opacity', String(edgeVisibility.light / 2));
    document.documentElement.style.setProperty('--edge-dark-dashed-opacity', String(edgeVisibility.dark / 2));
  })();`;
};

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  skinStorageKey = "vite-ui-skin",
  edgeVisibilityStorageKey = "vite-ui-edge-visibility",
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
        edgeVisibilityStorageKey
      );
      script.id = "theme-initializer";

      const existingScript = document.getElementById("theme-initializer");
      if (!existingScript) {
        document.head.appendChild(script);
      }
    }

    setMounted(true);
  }, [defaultTheme, edgeVisibilityStorageKey, storageKey, skinStorageKey]);

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
    applyEdgeVisibilityCss(edgeVisibility);
  }, [edgeVisibility, mounted]);

  const saveEdgeVisibility = (
    getNextValue: (current: EdgeVisibility) => EdgeVisibility
  ) => {
    setEdgeVisibility((current) => {
      const normalized = normalizeEdgeVisibility(getNextValue(current));
      safeStorageSet(edgeVisibilityStorageKey, serializeEdgeVisibility(normalized));
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
    adjustEdgeVisibility: (mode: EdgeVisibilityMode, delta: number) => {
      saveEdgeVisibility((current) => ({
        ...current,
        [mode]: current[mode] + delta,
      }));
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
