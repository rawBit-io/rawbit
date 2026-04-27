import { afterEach, describe, expect, it, vi } from "vitest";

type NativeResizeCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver
) => void;

describe("patchResizeObserver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("coalesces rapid-fire resize batches into one frame without dropping entries", async () => {
    let nativeCallback: NativeResizeCallback | null = null;
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let frameId = 0;

    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        nativeCallback = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }

    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      frameId += 1;
      frameCallbacks.set(frameId, callback);
      return frameId;
    });
    const cancelAnimationFrameMock = vi.fn((id: number) => {
      frameCallbacks.delete(id);
    });

    vi.stubGlobal(
      "ResizeObserver",
      MockResizeObserver as unknown as typeof ResizeObserver
    );
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);

    const { patchResizeObserver } = await import("../patchResizeObserver");
    patchResizeObserver();

    const callback = vi.fn();
    const observer = new window.ResizeObserver(callback);
    const callbackFromNative = nativeCallback as unknown as NativeResizeCallback;
    const firstEntries = [
      { target: document.createElement("div") },
    ] as unknown as ResizeObserverEntry[];
    const latestEntries = [
      { target: document.createElement("span") },
    ] as unknown as ResizeObserverEntry[];

    callbackFromNative(firstEntries, observer as ResizeObserver);
    callbackFromNative(latestEntries, observer as ResizeObserver);

    // Only one frame should be queued — entries are accumulated, not replaced.
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrameMock).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();

    frameCallbacks.get(1)?.(performance.now());

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      [...firstEntries, ...latestEntries],
      observer
    );
  });

  it("queues a fresh frame after a flush when more entries arrive later", async () => {
    let nativeCallback: NativeResizeCallback | null = null;
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let frameId = 0;

    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        nativeCallback = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }

    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      frameId += 1;
      frameCallbacks.set(frameId, callback);
      return frameId;
    });
    const cancelAnimationFrameMock = vi.fn((id: number) => {
      frameCallbacks.delete(id);
    });

    vi.stubGlobal(
      "ResizeObserver",
      MockResizeObserver as unknown as typeof ResizeObserver
    );
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);

    const { patchResizeObserver } = await import("../patchResizeObserver");
    patchResizeObserver();

    const callback = vi.fn();
    const observer = new window.ResizeObserver(callback);
    const callbackFromNative = nativeCallback as unknown as NativeResizeCallback;
    const batchA = [
      { target: document.createElement("div") },
    ] as unknown as ResizeObserverEntry[];
    const batchB = [
      { target: document.createElement("span") },
    ] as unknown as ResizeObserverEntry[];

    callbackFromNative(batchA, observer as ResizeObserver);
    frameCallbacks.get(1)?.(performance.now());
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith(batchA, observer);

    callbackFromNative(batchB, observer as ResizeObserver);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(2);
    frameCallbacks.get(2)?.(performance.now());
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(batchB, observer);
  });
});
