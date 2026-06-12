import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { installDomMocks } from "@/test-utils/dom";
import { clearSharedFlows, server } from "./msw/server";

if (typeof globalThis.fetch === "undefined") {
  await import("whatwg-fetch");
}

if (typeof window !== "undefined") {
  window.__RAWBIT_VERSION__ = window.__RAWBIT_VERSION__ ?? (__APP_VERSION__ || "test");
}

let restoreFetch: (() => void) | undefined;
const restoreDom = installDomMocks();

function isAbortSignalBrandError(error: unknown): boolean {
  return error instanceof TypeError && /AbortSignal/.test(error.message || "");
}

function createAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    reason.name = reason.name || "AbortError";
    return reason;
  }

  const error = new Error(reason ? String(reason) : "Aborted");
  error.name = "AbortError";
  return error;
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: "error" });

  if (!restoreFetch) {
    try {
      const mswFetch = globalThis.fetch;

      if (typeof mswFetch === "function") {
        const boundFetch = mswFetch.bind(globalThis);

        globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
          const responsePromise = boundFetch(input as RequestInfo, init) as Promise<Response>;

          if (!init || !init.signal) {
            return responsePromise;
          }

          const { signal: abortSignal, ...rest } = init;

          if (!abortSignal) {
            return responsePromise;
          }

          return responsePromise.catch((error: unknown) => {
            if (!isAbortSignalBrandError(error)) {
              throw error;
            }

            if (abortSignal.aborted) {
              return Promise.reject(createAbortError(abortSignal.reason));
            }

            return new Promise<Response>((resolve, reject) => {
              const abortHandler = () => {
                abortSignal.removeEventListener("abort", abortHandler);
                reject(createAbortError(abortSignal.reason));
              };

              abortSignal.addEventListener("abort", abortHandler);

              boundFetch(input as RequestInfo, rest)
                .then((response: Response) => {
                  abortSignal.removeEventListener("abort", abortHandler);
                  resolve(response);
                })
                .catch((fetchError: unknown) => {
                  abortSignal.removeEventListener("abort", abortHandler);
                  reject(fetchError);
                });
            });
          });
        }) as typeof fetch;

        restoreFetch = () => {
          globalThis.fetch = mswFetch;
        };
      }
    } catch {
      // failed to patch fetch; rely on default behaviour
    }
  }
});
afterEach(() => {
  server.resetHandlers();
  clearSharedFlows();
  vi.clearAllMocks();
  // Defensive: a test that enables fake timers and throws before its own
  // useRealTimers() must not poison the rest of the file (faked timers also
  // fake requestAnimationFrame, which silently breaks RAF-scheduled effects).
  vi.useRealTimers();
});
afterAll(() => {
  server.close();
  restoreFetch?.();
  restoreDom?.();
});
