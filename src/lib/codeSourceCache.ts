const CODE_SOURCE_CACHE_BUST_KEY = "rawbit:code-source-cache-bust";

type CodeSourceWindow = Pick<Window, "sessionStorage">;

function getTargetWindow(targetWindow?: CodeSourceWindow): CodeSourceWindow | null {
  if (targetWindow) return targetWindow;
  return typeof window === "undefined" ? null : window;
}

export function markCodeSourceCacheBust(targetWindow?: CodeSourceWindow): void {
  const target = getTargetWindow(targetWindow);
  if (!target) return;

  try {
    const token = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2)}`;
    target.sessionStorage.setItem(CODE_SOURCE_CACHE_BUST_KEY, token);
  } catch (error) {
    console.warn("Failed to mark code source cache for refresh", error);
  }
}

export function getCodeSourceCacheBust(
  targetWindow?: CodeSourceWindow
): string | null {
  const target = getTargetWindow(targetWindow);
  if (!target) return null;

  try {
    return target.sessionStorage.getItem(CODE_SOURCE_CACHE_BUST_KEY);
  } catch {
    return null;
  }
}

export function buildCodeSourceUrl(
  baseUrl: string,
  functionName: string,
  targetWindow?: CodeSourceWindow
): string {
  const endpoint = new URL("/code", baseUrl);
  endpoint.searchParams.set("functionName", functionName);

  const cacheBust = getCodeSourceCacheBust(targetWindow);
  if (cacheBust) {
    endpoint.searchParams.set("cacheBust", cacheBust);
  }

  return endpoint.toString();
}
