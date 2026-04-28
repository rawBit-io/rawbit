import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ThemeProvider } from "@/components/layout/theme-provider";
import { EDGE_VISIBILITY_STEP } from "@/contexts/theme";
import { useTheme } from "@/hooks/useTheme";
import { ensureMatchMedia, mockMatchMedia } from "@/test-utils/dom";
import type { MockCleanup } from "@/test-utils/dom";

function ThemeConsumer() {
  const {
    theme,
    setTheme,
    skin,
    edgeVisibility,
    adjustEdgeVisibility,
  } = useTheme();
  return (
    <>
      <button data-testid="theme-toggle" onClick={() => setTheme("light")}>
        <span data-testid="theme-value">{theme}</span>
      </button>
      <span data-testid="skin-value">{skin}</span>
      <span data-testid="edge-light-value">{edgeVisibility.light}</span>
      <span data-testid="edge-dark-value">{edgeVisibility.dark}</span>
      <button
        data-testid="edge-light-increase"
        onClick={() => adjustEdgeVisibility("light", EDGE_VISIBILITY_STEP)}
      />
    </>
  );
}

describe("ThemeProvider", () => {
  const STORAGE_KEY = "test-theme";
  const EDGE_VISIBILITY_STORAGE_KEY = "test-edge-visibility";
  let baseMatchMediaCleanup: MockCleanup | undefined;

  beforeEach(() => {
    baseMatchMediaCleanup = ensureMatchMedia();
    localStorage.clear();
    document.documentElement.className = "";
    const script = document.getElementById("theme-initializer");
    script?.remove();
  });

  afterEach(() => {
    baseMatchMediaCleanup?.();
    baseMatchMediaCleanup = undefined;
    localStorage.clear();
    document.documentElement.className = "";
    const script = document.getElementById("theme-initializer");
    script?.remove();
  });

  it("injects initializer script only once", async () => {
    const { rerender } = render(
      <ThemeProvider storageKey={STORAGE_KEY} defaultTheme="light">
        <div>child</div>
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(document.getElementById("theme-initializer")).not.toBeNull()
    );

    rerender(
      <ThemeProvider storageKey={STORAGE_KEY} defaultTheme="dark">
        <div>child</div>
      </ThemeProvider>
    );

    expect(
      document.head.querySelectorAll("#theme-initializer").length
    ).toBe(1);
  });

  it("applies stored theme and updates class list when setTheme is called", async () => {
    localStorage.setItem(STORAGE_KEY, "dark");

    render(
      <ThemeProvider storageKey={STORAGE_KEY} defaultTheme="light">
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("theme-value")).toHaveTextContent("dark")
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await act(async () => {
      screen.getByTestId("theme-toggle").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("theme-value")).toHaveTextContent("light")
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("respects system preference when theme is set to system", async () => {
    localStorage.setItem(STORAGE_KEY, "system");
    const restoreMatchMedia = mockMatchMedia({ matches: true });

    render(
      <ThemeProvider storageKey={STORAGE_KEY} defaultTheme="light">
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("theme-value")).toHaveTextContent("system")
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    restoreMatchMedia?.();
  });

  it("falls back when stored theme is invalid", async () => {
    localStorage.setItem(STORAGE_KEY, "neon");

    render(
      <ThemeProvider storageKey={STORAGE_KEY} defaultTheme="light">
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("theme-value")).toHaveTextContent("light")
    );
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("keeps rendering when browser storage is unavailable", async () => {
    const getSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });
    const setSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });

    render(
      <ThemeProvider storageKey={STORAGE_KEY} defaultTheme="dark">
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("theme-value")).toHaveTextContent("dark")
    );
    expect(screen.getByTestId("skin-value")).toHaveTextContent("paper");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await act(async () => {
      screen.getByTestId("theme-toggle").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("theme-value")).toHaveTextContent("light")
    );

    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("defaults skin to paper when no saved skin exists", async () => {
    render(
      <ThemeProvider storageKey={STORAGE_KEY} defaultTheme="light">
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("skin-value")).toHaveTextContent("paper")
    );
    expect(document.documentElement.dataset.skin).toBe("paper");
  });

  it("persists edge visibility and applies CSS variables", async () => {
    localStorage.setItem(
      EDGE_VISIBILITY_STORAGE_KEY,
      JSON.stringify({ light: 0.95, dark: 0.2 })
    );

    render(
      <ThemeProvider
        storageKey={STORAGE_KEY}
        edgeVisibilityStorageKey={EDGE_VISIBILITY_STORAGE_KEY}
        defaultTheme="light"
      >
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("edge-light-value")).toHaveTextContent("0.95")
    );
    expect(screen.getByTestId("edge-dark-value")).toHaveTextContent("0.2");
    expect(
      document.documentElement.style.getPropertyValue("--edge-light-opacity")
    ).toBe("0.95");
    expect(
      document.documentElement.style.getPropertyValue("--edge-dark-opacity")
    ).toBe("0.2");

    await act(async () => {
      screen.getByTestId("edge-light-increase").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("edge-light-value")).toHaveTextContent("1")
    );
    expect(localStorage.getItem(EDGE_VISIBILITY_STORAGE_KEY)).toBe(
      JSON.stringify({ light: 1, dark: 0.2 })
    );
    expect(
      document.documentElement.style.getPropertyValue("--edge-light-opacity")
    ).toBe("1");
  });

  it("throws when useTheme is called outside ThemeProvider", () => {
    const { result } = renderHook(() => {
      try {
        return useTheme();
      } catch (error) {
        return error;
      }
    });

    expect(result.current).toBeInstanceOf(Error);
    expect((result.current as Error).message).toContain(
      "useTheme must be used within a ThemeProvider"
    );
  });
});
