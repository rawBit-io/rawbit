// src/lib/share/index.ts
import { MAX_FLOW_BYTES, formatBytes } from "@/lib/flow/schema";
import type { SharePayload } from "@/types";

const SHARE_BASE = (import.meta.env.VITE_SHARE_BASE_URL || "").replace(
  /\/+$/,
  ""
);
const enc = new TextEncoder();

function byteLength(s: string) {
  return enc.encode(s).byteLength;
}

async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await res.json<T>();
  } catch {
    return null;
  }
}

export type ShareOk = { id: string; url: string; bytes: number };
export type ShareError = Error & { softGate?: boolean };

export function getShareJsonUrl(id: string): string | null {
  if (!SHARE_BASE) return null;
  return `${SHARE_BASE}/s/${encodeURIComponent(id)}`;
}

export async function shareFlow(
  exportObj: SharePayload,
  opts?: { turnstileToken?: string }
): Promise<ShareOk> {
  if (!SHARE_BASE) throw new Error("VITE_SHARE_BASE_URL is not set");

  const body = JSON.stringify(exportObj);
  const bytes = byteLength(body);
  if (bytes > MAX_FLOW_BYTES) {
    throw new Error(
      `Flow is ${bytes.toLocaleString()} bytes, over the ${formatBytes(MAX_FLOW_BYTES)} limit`
    );
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (opts?.turnstileToken) {
    // send both header names; your Worker allows either
    headers["x-turnstile-token"] = opts.turnstileToken;
    headers["cf-turnstile-response"] = opts.turnstileToken;
  }

  const res = await fetch(`${SHARE_BASE}/share`, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers,
    body,
  });

  const payload = await safeJson<Record<string, unknown>>(res);

  const readString = (key: string): string | undefined => {
    const value = payload?.[key];
    return typeof value === "string" ? value : undefined;
  };

  const readBoolean = (key: string): boolean | undefined => {
    const value = payload?.[key];
    return typeof value === "boolean" ? value : undefined;
  };

  if (res.ok) {
    const id = readString("id") ?? readString("shareId");
    if (!id) throw new Error("Share API succeeded but returned no id");
    const shareUrl = getShareJsonUrl(id);
    return { id, url: shareUrl ?? "", bytes };
  }

  if (res.status === 429) {
    const softGate = readBoolean("softGate") ?? false;
    const e: ShareError = new Error(
      softGate ? "Verification required" : "Rate limited"
    );
    e.softGate = softGate;
    throw e;
  }

  const errorCode = readString("error");

  if (res.status === 403 && errorCode === "turnstile_required") {
    const e: ShareError = new Error("Verification required");
    e.softGate = true;
    throw e;
  }

  if (res.status === 403 && errorCode === "forbidden_origin") {
    throw new Error(
      "This origin is not allowed to share (CORS). Add it to the Worker allowlist."
    );
  }
  if (res.status === 415 && errorCode === "json_required") {
    throw new Error("Share API requires JSON (application/json).");
  }
  if (res.status === 413) {
    throw new Error("Flow exceeds server limit.");
  }
  throw new Error(errorCode || `Share failed (${res.status})`);
}

export async function loadShared(id: string): Promise<SharePayload> {
  if (!SHARE_BASE) throw new Error("VITE_SHARE_BASE_URL is not set");

  const res = await fetch(`${SHARE_BASE}/s/${encodeURIComponent(id)}`, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to load shared flow (${res.status})`);
  return res.json<SharePayload>();
}
