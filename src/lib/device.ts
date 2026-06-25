const MOBILE_USER_AGENT_REGEX =
  /Mobile|Android|iP(?:ad|hone|od)|Tablet|BlackBerry|IEMobile|Opera Mini/i;

/**
 * True for real Safari/WebKit (not Chrome/Edge/Firefox/Opera, not Android).
 * WebKit rasterizes SVG/layers differently enough from Blink that a couple of
 * group-drag performance mitigations are gated on this; other engines stay on
 * the default path.
 */
export function isSafariBrowser(userAgent?: string): boolean {
  const ua =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (!ua) return false;
  return (
    /\bVersion\//i.test(ua) &&
    /\bSafari\//i.test(ua) &&
    !/\b(Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|OPiOS)\//i.test(ua) &&
    !/\bAndroid\b/i.test(ua)
  );
}

export const DESKTOP_BREAKPOINT = 1280;

export type MobileBlockContext = {
  width: number;
  userAgent?: string;
  platform?: string;
  coarsePointer?: boolean;
  maxTouchPoints?: number;
  userAgentDataMobile?: boolean;
};

/**
 * Returns true when the current environment looks like a phone/tablet device.
 * Explicit mobile/tablet signals win at any viewport width; the desktop
 * breakpoint is only a fallback for ambiguous coarse-pointer environments.
 */
export function shouldBlockMobile(context: MobileBlockContext): boolean {
  const {
    width,
    userAgent = "",
    platform = "",
    coarsePointer = false,
    maxTouchPoints = 0,
    userAgentDataMobile = false,
  } = context;

  if (!Number.isFinite(width) || width <= 0) {
    return false;
  }

  const uaLooksMobile = MOBILE_USER_AGENT_REGEX.test(userAgent);
  const isIpadDesktopMode = Boolean(
    /\bMac/i.test(platform) && maxTouchPoints > 1
  );
  const hasExplicitMobileSignal = Boolean(
    userAgentDataMobile || uaLooksMobile || isIpadDesktopMode
  );

  if (hasExplicitMobileSignal) {
    return true;
  }

  return coarsePointer && width < DESKTOP_BREAKPOINT;
}
