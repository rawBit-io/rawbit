import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { useAutoRefreshVersion } from "../useAutoRefreshVersion";

const NEEDS_RELOAD_KEY = "rawbit:needsReload";
const LAST_HIDDEN_KEY = "rawbit:lastHiddenAt";

const setVisibilityState = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
};

describe("useAutoRefreshVersion", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setVisibilityState("visible");
    window.__RAWBIT_VERSION__ = "current-version";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setVisibilityState("visible");
  });

  it("writes reload flag when fetched version differs from current build", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ version: "new-version" }),
      } as Response);

    const { unmount } = renderHook(() =>
      useAutoRefreshVersion({ tabs: [], saveTabData: vi.fn() })
    );

    await waitFor(() => {
      expect(window.localStorage.getItem(NEEDS_RELOAD_KEY)).toBe("1");
    });

    expect(fetchMock).toHaveBeenCalled();
    unmount();
  });

  it("ignores HTML fallback responses from the version endpoint", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        json: vi.fn(async () => {
          throw new SyntaxError("Unexpected token '<'");
        }),
      } as unknown as Response);

    const { unmount } = renderHook(() =>
      useAutoRefreshVersion({ tabs: [], saveTabData: vi.fn() })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/healthz$/),
        expect.objectContaining({
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        })
      );
    });

    expect(window.localStorage.getItem(NEEDS_RELOAD_KEY)).toBeNull();
    expect(warnSpy).not.toHaveBeenCalledWith(
      "Version check failed",
      expect.anything()
    );

    unmount();
  });

  it("still accepts mocked JSON responses without headers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ version: "new-version" }),
      } as Response);

    const { unmount } = renderHook(() =>
      useAutoRefreshVersion({ tabs: [], saveTabData: vi.fn() })
    );

    await waitFor(() => {
      expect(window.localStorage.getItem(NEEDS_RELOAD_KEY)).toBe("1");
    });

    expect(fetchMock).toHaveBeenCalled();
    unmount();
  });

  it("persists tabs and reloads once when returning from idle with pending flag", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ version: window.__RAWBIT_VERSION__ }),
      } as Response);

    const saveTabData = vi.fn();
    const reloadSpy = vi.fn();

    const { unmount } = renderHook(() =>
      useAutoRefreshVersion({
        tabs: [
          { id: "tab-a" },
          { id: "tab-b" },
        ],
        saveTabData,
        onReload: reloadSpy,
      })
    );

    const now = Date.now();
    window.localStorage.setItem(NEEDS_RELOAD_KEY, "1");
    window.localStorage.setItem(LAST_HIDDEN_KEY, String(now - 120_000));

    setVisibilityState("visible");
    await act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(saveTabData).toHaveBeenCalledWith("tab-a");
    expect(saveTabData).toHaveBeenCalledWith("tab-b");
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(NEEDS_RELOAD_KEY)).toBeNull();

    await act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    unmount();
    fetchMock.mockRestore();
    vi.useRealTimers();
  });
});
