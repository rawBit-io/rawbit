/**
 * Frontend client for the backend's Bitcoin Core endpoints (/bitcoin/*).
 *
 * Command lines are parsed bitcoin-cli style: whitespace-separated tokens with
 * quote support, each argument JSON-coerced when possible (numbers, booleans,
 * arrays, objects) and kept as a string otherwise. A leading `bitcoin-cli`
 * (plus its `-...` flags) is ignored so commands can be pasted verbatim from
 * course material.
 */

const DEFAULT_LOCAL_API = "http://localhost:5007";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function resolveApiBase(): string {
  const envBase =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
    DEFAULT_LOCAL_API;
  const allowRemote =
    (import.meta.env.VITE_ALLOW_REMOTE_API || "").toString().toLowerCase() === "true";
  try {
    const envUrl = new URL(envBase);
    const isPageLocal =
      typeof window !== "undefined" &&
      LOCAL_HOSTS.has(window.location.hostname.toLowerCase());
    const isEnvLocal = LOCAL_HOSTS.has(envUrl.hostname.toLowerCase());
    if (import.meta.env.DEV && isPageLocal && !isEnvLocal && !allowRemote) {
      return DEFAULT_LOCAL_API;
    }
    return envBase;
  } catch {
    return DEFAULT_LOCAL_API;
  }
}

export type BitcoinStatus = {
  connected: boolean;
  chain?: string;
  blocks?: number;
  headers?: number;
  initialBlockDownload?: boolean;
  warnings?: string[] | string;
  error?: string;
};

export type BitcoinRpcReply = {
  result?: unknown;
  error?: { code?: number; message: string };
};

export type RebuildReply = {
  flow?: unknown;
  txid?: string;
  error?: { message: string };
};

export async function fetchBitcoinStatus(): Promise<BitcoinStatus> {
  try {
    const res = await fetch(`${resolveApiBase()}/bitcoin/status`, {
      method: "GET",
      credentials: "omit",
    });
    if (!res.ok) {
      return {
        connected: false,
        error:
          res.status === 404
            ? "Bitcoin Core endpoints are disabled on this backend."
            : `Backend error (HTTP ${res.status}).`,
      };
    }
    return (await res.json()) as BitcoinStatus;
  } catch {
    return { connected: false, error: "rawBit backend is not reachable." };
  }
}

export async function sendBitcoinCommand(
  method: string,
  params: unknown[],
): Promise<BitcoinRpcReply> {
  let res: Response;
  try {
    res = await fetch(`${resolveApiBase()}/bitcoin/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ method, params }),
    });
  } catch {
    return { error: { message: "rawBit backend is not reachable." } };
  }
  try {
    const body = (await res.json()) as { result?: unknown; error?: unknown };
    // The backend's global handlers (rate limit, payload, 500) emit flat string
    // errors; normalize those into the { message } shape so the console never
    // renders a blank failure line.
    if (typeof body.error === "string") {
      const known: Record<string, string> = {
        not_found: "Bitcoin Core endpoints are disabled on this backend.",
        rate_limited: "Too many commands — slow down and try again.",
        payload_too_large: "Command payload too large.",
        internal_server_error: "The rawBit backend hit an internal error.",
      };
      return {
        error: { message: known[body.error] ?? `Backend error: ${body.error}.` },
      };
    }
    if (body.error && typeof body.error === "object") {
      return { error: body.error as BitcoinRpcReply["error"] };
    }
    if (!res.ok) {
      return { error: { message: `Backend error (HTTP ${res.status}).` } };
    }
    return { result: body.result };
  } catch {
    return { error: { message: `Unexpected backend response (HTTP ${res.status}).` } };
  }
}

type Token = { value: string; quoted: boolean };

export async function rebuildTransaction(tx: string): Promise<RebuildReply> {
  let res: Response;
  try {
    res = await fetch(`${resolveApiBase()}/bitcoin/rebuild`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ tx }),
    });
  } catch {
    return { error: { message: "rawBit backend is not reachable." } };
  }
  try {
    const body = (await res.json()) as { flow?: unknown; txid?: string; error?: unknown };
    if (body.error) {
      if (typeof body.error === "object" && body.error !== null && "message" in body.error) {
        return { error: { message: String((body.error as { message: unknown }).message) } };
      }
      // global handlers emit flat string codes (rate_limited, 500, …)
      const known: Record<string, string> = {
        not_found: "Bitcoin Core endpoints are disabled on this backend.",
        rate_limited: "Too many rebuild requests — slow down and try again.",
        payload_too_large: "Transaction payload too large.",
        internal_server_error: "Rebuild failed on the backend.",
      };
      const code = String(body.error);
      return { error: { message: known[code] ?? `Backend error: ${code}.` } };
    }
    if (!res.ok || !body.flow) {
      return { error: { message: `Rebuild failed (HTTP ${res.status}).` } };
    }
    return { flow: body.flow, txid: body.txid };
  } catch {
    return { error: { message: `Unexpected backend response (HTTP ${res.status}).` } };
  }
}

/** Split a command line into tokens, honoring single and double quotes. */
function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  let wasQuoted = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      wasQuoted = true;
    } else if (/\s/.test(ch)) {
      if (hasToken || current) {
        tokens.push({ value: current, quoted: wasQuoted });
        current = "";
        hasToken = false;
        wasQuoted = false;
      }
    } else {
      current += ch;
    }
  }
  if (hasToken || current) tokens.push({ value: current, quoted: wasQuoted });
  return tokens;
}

/**
 * bitcoin-cli style coercion. Quoted tokens always stay strings. Otherwise we
 * only coerce JSON containers, true/false/null, and numbers that round-trip
 * exactly — so hex blobs, numeric wallet names, and big integers reach the node
 * intact rather than being silently mangled by JSON.parse.
 */
function coerceParam(token: Token): unknown {
  const { value, quoted } = token;
  // JSON containers are always parsed — quoting them is the normal bitcoin-cli
  // idiom for passing arrays/objects.
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  // A quoted scalar is the user's way of forcing a string (e.g. "12345").
  if (quoted) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n) && String(n) === value) return n;
  }
  return value;
}

export function parseCommandLine(
  line: string,
): { method: string; params: unknown[] } | null {
  const tokens = tokenize(line.trim());
  if (tokens.length === 0) return null;
  if (
    !tokens[0].quoted &&
    (tokens[0].value === "bitcoin-cli" || tokens[0].value === "bitcoin-cli.exe")
  ) {
    tokens.shift();
    while (tokens.length > 0 && !tokens[0].quoted && tokens[0].value.startsWith("-")) {
      tokens.shift();
    }
  }
  const method = tokens.shift();
  if (!method) return null;
  return { method: method.value, params: tokens.map(coerceParam) };
}
