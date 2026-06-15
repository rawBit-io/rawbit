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
  coarsePointer?: boolean;
  userAgentDataMobile?: boolean;
};

/**
 * Returns true when the current environment looks like a touch/mobile device
 * and the viewport width is below the desktop breakpoint.
 */
export function shouldBlockMobile(context: MobileBlockContext): boolean {
  const {
    width,
    userAgent = "",
    coarsePointer = false,
    userAgentDataMobile = false,
  } = context;

  if (!Number.isFinite(width) || width <= 0) {
    return false;
  }

  const uaLooksMobile = MOBILE_USER_AGENT_REGEX.test(userAgent);
  const isLikelyTouch = Boolean(
    coarsePointer || userAgentDataMobile || uaLooksMobile
  );

  return isLikelyTouch && width < DESKTOP_BREAKPOINT;
}
