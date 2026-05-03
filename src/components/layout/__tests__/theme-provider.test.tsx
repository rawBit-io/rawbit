import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ThemeProvider } from "@/components/layout/theme-provider";
import {
  DEFAULT_DASHED_EDGE_VISIBILITY,
  DEFAULT_EDGE_THICKNESS,
  DEFAULT_GROUP_FILL_OPACITY,
  EDGE_THICKNESS_STEP,
  EDGE_VISIBILITY_STEP,
  GROUP_FILL_OPACITY_STEP,
} from "@/contexts/theme";
import { useTheme } from "@/hooks/useTheme";
import { ensureMatchMedia, mockMatchMedia } from "@/test-utils/dom";
import type { MockCleanup } from "@/test-utils/dom";

function ThemeConsumer() {
  const {
    theme,
    setTheme,
    skin,
    edgeVisibility,
    dashedEdgeVisibility,
    groupFillOpacity,
    edgeThickness,
    adjustEdgeVisibility,
    adjustDashedEdgeVisibility,
    adjustGroupFillOpacity,
    adjustEdgeThickness,
  } = useTheme();
  return (
    <>
      <button data-testid="theme-toggle" onClick={() => setTheme("light")}>
        <span data-testid="theme-value">{theme}</span>
      </button>
      <span data-testid="skin-value">{skin}</span>
      <span data-testid="edge-light-value">{edgeVisibility.light}</span>
      <span data-testid="edge-dark-value">{edgeVisibility.dark}</span>
      <span data-testid="dashed-edge-light-value">
        {dashedEdgeVisibility.light}
      </span>
      <span data-testid="dashed-edge-dark-value">
        {dashedEdgeVisibility.dark}
      </span>
      <span data-testid="group-fill-light-value">
        {groupFillOpacity.light}
      </span>
      <span data-testid="group-fill-dark-value">
        {groupFillOpacity.dark}
      </span>
      <span data-testid="edge-thickness-light-value">
        {edgeThickness.light}
      </span>
      <span data-testid="edge-thickness-dark-value">
        {edgeThickness.dark}
      </span>
      <button
        data-testid="edge-light-increase"
        onClick={() => adjustEdgeVisibility("light", EDGE_VISIBILITY_STEP)}
      />
      <button
        data-testid="dashed-edge-light-increase"
        onClick={() =>
          adjustDashedEdgeVisibility("light", EDGE_VISIBILITY_STEP)
        }
      />
      <button
        data-testid="group-fill-light-increase"
        onClick={() => adjustGroupFillOpacity("light", GROUP_FILL_OPACITY_STEP)}
      />
      <button
        data-testid="edge-thickness-light-increase"
        onClick={() => adjustEdgeThickness("light", EDGE_THICKNESS_STEP)}
      />
    </>
  );
}

describe("ThemeProvider", () => {
  const STORAGE_KEY = "test-theme";
  const EDGE_VISIBILITY_STORAGE_KEY = "test-edge-visibility";
  const DASHED_EDGE_VISIBILITY_STORAGE_KEY = "test-dashed-edge-visibility";
  const GROUP_FILL_OPACITY_STORAGE_KEY = "test-group-fill-opacity";
  const EDGE_THICKNESS_STORAGE_KEY = "test-edge-thickness";
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
    expect(
      document.documentElement.style.getPropertyValue("--edge-light-dashed-opacity")
    ).toBe("0.475");
    expect(
      document.documentElement.style.getPropertyValue("--edge-dark-dashed-opacity")
    ).toBe("0.1");

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
    expect(
      document.documentElement.style.getPropertyValue("--edge-light-dashed-opacity")
    ).toBe("0.475");
    expect(
      document.documentElement.style.getPropertyValue("--group-light-fill-opacity")
    ).toBe(String(DEFAULT_GROUP_FILL_OPACITY.light));
  });

  it("persists dashed edge visibility and applies CSS variables", async () => {
    localStorage.setItem(
      DASHED_EDGE_VISIBILITY_STORAGE_KEY,
      JSON.stringify({ light: 0.35, dark: 0.15 })
    );

    render(
      <ThemeProvider
        storageKey={STORAGE_KEY}
        dashedEdgeVisibilityStorageKey={DASHED_EDGE_VISIBILITY_STORAGE_KEY}
        defaultTheme="light"
      >
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("dashed-edge-light-value")).toHaveTextContent(
        "0.35"
      )
    );
    expect(screen.getByTestId("dashed-edge-dark-value")).toHaveTextContent(
      "0.15"
    );
    expect(
      document.documentElement.style.getPropertyValue("--edge-light-dashed-opacity")
    ).toBe("0.35");
    expect(
      document.documentElement.style.getPropertyValue("--edge-dark-dashed-opacity")
    ).toBe("0.15");

    await act(async () => {
      screen.getByTestId("dashed-edge-light-increase").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("dashed-edge-light-value")).toHaveTextContent(
        "0.4"
      )
    );
    expect(localStorage.getItem(DASHED_EDGE_VISIBILITY_STORAGE_KEY)).toBe(
      JSON.stringify({ light: 0.4, dark: 0.15 })
    );
    expect(
      document.documentElement.style.getPropertyValue("--edge-light-dashed-opacity")
    ).toBe("0.4");
  });

  it("defaults dashed edge visibility to half of normal edge visibility", async () => {
    render(
      <ThemeProvider storageKey={STORAGE_KEY} defaultTheme="light">
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("dashed-edge-light-value")).toHaveTextContent(
        String(DEFAULT_DASHED_EDGE_VISIBILITY.light)
      )
    );
    expect(
      document.documentElement.style.getPropertyValue("--edge-light-dashed-opacity")
    ).toBe(String(DEFAULT_DASHED_EDGE_VISIBILITY.light));
  });

  it("persists group fill opacity and applies CSS variables", async () => {
    localStorage.setItem(
      GROUP_FILL_OPACITY_STORAGE_KEY,
      JSON.stringify({ light: 0.2, dark: 0.05 })
    );

    render(
      <ThemeProvider
        storageKey={STORAGE_KEY}
        groupFillOpacityStorageKey={GROUP_FILL_OPACITY_STORAGE_KEY}
        defaultTheme="light"
      >
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("group-fill-light-value")).toHaveTextContent(
        "0.2"
      )
    );
    expect(screen.getByTestId("group-fill-dark-value")).toHaveTextContent(
      "0.05"
    );
    expect(
      document.documentElement.style.getPropertyValue("--group-light-fill-opacity")
    ).toBe("0.2");
    expect(
      document.documentElement.style.getPropertyValue("--group-dark-fill-opacity")
    ).toBe("0.05");

    await act(async () => {
      screen.getByTestId("group-fill-light-increase").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("group-fill-light-value")).toHaveTextContent(
        "0.21"
      )
    );
    expect(localStorage.getItem(GROUP_FILL_OPACITY_STORAGE_KEY)).toBe(
      JSON.stringify({ light: 0.21, dark: 0.05 })
    );
    expect(
      document.documentElement.style.getPropertyValue("--group-light-fill-opacity")
    ).toBe("0.21");
  });

  it("persists edge thickness and applies stroke width CSS variables", async () => {
    localStorage.setItem(
      EDGE_THICKNESS_STORAGE_KEY,
      JSON.stringify({ light: 1.2, dark: 0.8 })
    );

    render(
      <ThemeProvider
        storageKey={STORAGE_KEY}
        edgeThicknessStorageKey={EDGE_THICKNESS_STORAGE_KEY}
        defaultTheme="light"
      >
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("edge-thickness-light-value")).toHaveTextContent(
        "1.2"
      )
    );
    expect(screen.getByTestId("edge-thickness-dark-value")).toHaveTextContent(
      "0.8"
    );
    expect(
      document.documentElement.style.getPropertyValue("--edge-light-stroke-width")
    ).toBe("1.68px");
    expect(
      document.documentElement.style.getPropertyValue(
        "--edge-light-selected-stroke-width"
      )
    ).toBe("2.88px");
    expect(
      document.documentElement.style.getPropertyValue(
        "--group-bundle-light-outside-edge-width"
      )
    ).toBe("2.4px");
    expect(
      document.documentElement.style.getPropertyValue("--edge-dark-stroke-width")
    ).toBe("1.12px");

    await act(async () => {
      screen.getByTestId("edge-thickness-light-increase").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("edge-thickness-light-value")).toHaveTextContent(
        "1.3"
      )
    );
    expect(localStorage.getItem(EDGE_THICKNESS_STORAGE_KEY)).toBe(
      JSON.stringify({ light: 1.3, dark: 0.8 })
    );
    expect(
      document.documentElement.style.getPropertyValue("--edge-light-stroke-width")
    ).toBe("1.82px");
  });

  it("defaults edge thickness to normal width", async () => {
    render(
      <ThemeProvider storageKey={STORAGE_KEY} defaultTheme="light">
        <ThemeConsumer />
      </ThemeProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("edge-thickness-light-value")).toHaveTextContent(
        String(DEFAULT_EDGE_THICKNESS.light)
      )
    );
    expect(
      document.documentElement.style.getPropertyValue("--edge-light-stroke-width")
    ).toBe("1.4px");
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
