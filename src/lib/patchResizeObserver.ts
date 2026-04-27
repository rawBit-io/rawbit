let patched = false;

/**
 * Safari/WebKit can spam "ResizeObserver loop completed with undelivered notifications"
 * when a resize callback mutates layout synchronously. Wrapping the callback in
 * requestAnimationFrame breaks the sync loop while keeping the observer intact.
 *
 * Earlier versions of this patch *replaced* the pending batch with the latest
 * entries, which silently dropped resize events when the browser fired the
 * observer in multiple batches within one frame (common in Safari with many
 * observed elements). React Flow uses a single shared ResizeObserver for every
 * node, so a dropped batch leaves those nodes without `measured` dimensions and
 * any edges connected to them never render. We now coalesce entries across
 * rapid-fire calls and flush them together.
 */
export function patchResizeObserver() {
  if (patched) return;
  if (typeof window === "undefined" || typeof window.ResizeObserver === "undefined")
    return;

  const OriginalResizeObserver = window.ResizeObserver;
  const descriptor = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
  const isWritable =
    !descriptor || descriptor.writable === true || descriptor.configurable === true;
  if (!isWritable) {
    // In some test/jsdom environments ResizeObserver is non-writable; bail quietly.
    return;
  }
  const raf =
    window.requestAnimationFrame ||
    ((cb: FrameRequestCallback) => window.setTimeout(cb, 16));

  try {
    window.ResizeObserver = class extends OriginalResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        let frame = 0;
        let pendingEntries: ResizeObserverEntry[] = [];
        let pendingObserver: ResizeObserver | null = null;
        const flush = () => {
          const entries = pendingEntries;
          const observer = pendingObserver;
          pendingEntries = [];
          pendingObserver = null;
          frame = 0;
          if (entries.length > 0 && observer) {
            callback(entries, observer);
          }
        };
        const wrapped = (
          entries: ResizeObserverEntry[],
          observer: ResizeObserver
        ) => {
          pendingObserver = observer;
          for (const entry of entries) {
            pendingEntries.push(entry);
          }
          if (!frame) {
            frame = raf(flush);
          }
        };
        super(wrapped);
      }
    };
  } catch {
    // If assignment fails (frozen global), leave the native observer untouched.
    return;
  }

  patched = true;
}
