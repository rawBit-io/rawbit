import { useEffect, useState } from "react";
import {
  Theme,
  Skin,
  ThemeProviderState,
  ThemeProviderContext,
} from "@/contexts/theme";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
  skinStorageKey?: string;
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
  skinStorageKey: string
) => {
  const validSkins = JSON.stringify(VALID_SKINS);
  const validThemes = JSON.stringify(VALID_THEMES);
  const defaultSkin = DEFAULT_SKIN;
  const storageKeyJson = JSON.stringify(storageKey);
  const skinStorageKeyJson = JSON.stringify(skinStorageKey);
  const defaultThemeJson = JSON.stringify(defaultTheme);
  const defaultSkinJson = JSON.stringify(defaultSkin);
  // This function will be converted to a string and injected into a script tag
  return `(function() {
    var storageKey = ${storageKeyJson};
    var skinStorageKey = ${skinStorageKeyJson};
    var defaultTheme = ${defaultThemeJson};
    var defaultSkin = ${defaultSkinJson};
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
  })();`;
};

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  skinStorageKey = "vite-ui-skin",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => normalizeTheme(safeStorageGet(storageKey), defaultTheme)
  );
  const [skin, setSkin] = useState<Skin>(() =>
    normalizeSkin(safeStorageGet(skinStorageKey))
  );
  const [mounted, setMounted] = useState(false);

  // Set up the initial theme script
  useEffect(() => {
    // Only inject the script on client-side
    if (typeof window !== "undefined") {
      const script = document.createElement("script");
      script.textContent = setInitialTheme(storageKey, defaultTheme, skinStorageKey);
      script.id = "theme-initializer";

      const existingScript = document.getElementById("theme-initializer");
      if (!existingScript) {
        document.head.appendChild(script);
      }
    }

    setMounted(true);
  }, [defaultTheme, storageKey, skinStorageKey]);

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
