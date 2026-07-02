/*  src/lib/scriptDisassembly.ts
    ---------------------------------------------------------------
    Pure, framework-free Bitcoin Script disassembler used by the
    read-only Script Viewer node. Turns a hex script into a list of
    indented lines (IF/ELSE/ENDIF nesting) with opcode names and
    friendly data-push placeholders.

    Kept React-free so it can be unit-tested directly and reused.
    --------------------------------------------------------------- */

import { OP_CODES, type OpCodeCategories } from "@/lib/opcodes";

export type DisasmKind = "opcode" | "push" | "unknown";

export interface DisasmLine {
  /** Nesting depth (drives indentation). */
  depth: number;
  /** Rendered token: opcode name, or the real pushed bytes for pushes. */
  text: string;
  kind: DisasmKind;
  /** Raw data hex for push lines (for copy / tooltip). */
  hex?: string;
  /** Push form, e.g. "PUSH(4)" or "OP_PUSHDATA1(4)" (push lines only). */
  pushOp?: string;
  /** True when the push uses a longer form than MINIMALDATA allows. */
  nonMinimal?: boolean;
}

export interface DisasmResult {
  ok: boolean;
  error?: string;
  lines: DisasmLine[];
  /**
   * Bytes seen by the parser: the full script length once the hex itself is
   * well-formed (including truncated-push failures); 0 only for empty,
   * non-hex, or odd-length input.
   */
  byteLength: number;
  /** Non-fatal structural issue, e.g. unbalanced OP_IF/OP_ENDIF. */
  warning?: string;
}

/* ------------------------------------------------------------------ */
/*  Opcode name lookup (built once from the shared OP_CODES catalogue) */
/* ------------------------------------------------------------------ */

// Only canonical opcode names enter the map — this excludes script-template
// aliases like "P2SH_SUFFIX" (0x87) and "OP_RETURN_PREFIX" (0x6a) as well as
// slash-aliases like "OP_0 / OP_FALSE", so map contents no longer depend on
// catalogue iteration order.
const CANONICAL_OP_NAME = /^OP_[A-Z0-9]+$/;

export const OPCODE_NAME_BY_BYTE: Map<number, string> = (() => {
  const map = new Map<number, string>();
  (Object.keys(OP_CODES) as OpCodeCategories[]).forEach((category) => {
    OP_CODES[category].forEach((item) => {
      if (item.hex.length !== 2) return; // skip multi-byte template entries
      if (!CANONICAL_OP_NAME.test(item.name)) return;
      const value = Number.parseInt(item.hex, 16);
      if (Number.isNaN(value)) return;
      map.set(value, item.name);
    });
  });
  // Canonical short names for the small-int bytes.
  map.set(0x00, "OP_0");
  map.set(0x4f, "OP_1NEGATE");
  for (let v = 0x51; v <= 0x60; v += 1) map.set(v, `OP_${v - 0x50}`);
  return map;
})();

/** PUSHDATA opcodes are handled structurally, not via the catalogue. */
const PUSHDATA_NAMES: Record<number, string> = {
  0x4c: "OP_PUSHDATA1",
  0x4d: "OP_PUSHDATA2",
  0x4e: "OP_PUSHDATA4",
};

/**
 * Bitcoin's consensus limit on script size (MAX_SCRIPT_SIZE, 10,000 bytes).
 * Anything larger is invalid by definition — and rejecting it also keeps a
 * hostile multi-MB input from janking the tab. Mirrored by the Python
 * reference implementation shown in "Show Code".
 */
const MAX_SCRIPT_HEX_CHARS = 20_000;

/**
 * MINIMALDATA / CheckMinimalPush (Bitcoin Core): is this push encoded in the
 * shortest possible form? `op` is the push opcode byte, `dataHex` the pushed
 * bytes.
 */
function pushIsMinimal(op: number, dataHex: string): boolean {
  const dataLen = dataHex.length / 2;
  if (dataLen === 0) return false; // empty push must be OP_0
  if (dataLen === 1) {
    const value = Number.parseInt(dataHex, 16);
    if (value >= 1 && value <= 16) return false; // must be OP_1..OP_16
    if (value === 0x81) return false; // must be OP_1NEGATE
  }
  if (dataLen <= 75) return op >= 0x01 && op <= 0x4b; // direct push
  if (dataLen <= 255) return op === 0x4c; // OP_PUSHDATA1
  if (dataLen <= 65535) return op === 0x4d; // OP_PUSHDATA2
  return op === 0x4e;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const cleanHex = (hex = "") => hex.replace(/\s+/g, "").toLowerCase();

const toBytes = (hex: string) =>
  Array.from({ length: hex.length / 2 }, (_, i) => hex.slice(i * 2, i * 2 + 2));

/** Rendered text for a data push — the actual pushed bytes. */
function pushLabel(n: number, dataHex: string): string {
  return n === 0 ? "(empty)" : dataHex;
}

const OP_IF = 0x63;
const OP_NOTIF = 0x64;
const OP_ELSE = 0x67;
const OP_ENDIF = 0x68;
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_PUSHDATA4 = 0x4e;

/**
 * Parse a hex-encoded Bitcoin script into indented disassembly lines.
 * Never throws — invalid input returns `{ ok:false, error }` and any
 * lines decoded up to the failure point (best-effort).
 */
export function parseScriptDisassembly(hexRaw = ""): DisasmResult {
  const hex = cleanHex(hexRaw);
  if (!hex) return { ok: true, lines: [], byteLength: 0 };
  if (hex.length > MAX_SCRIPT_HEX_CHARS) {
    return {
      ok: false,
      error: `Script too large (max ${MAX_SCRIPT_HEX_CHARS / 2} bytes, Bitcoin's script-size limit).`,
      lines: [],
      byteLength: 0,
    };
  }
  if (/[^0-9a-f]/.test(hex)) {
    return { ok: false, error: "Not valid hex.", lines: [], byteLength: 0 };
  }
  if (hex.length % 2 !== 0) {
    return {
      ok: false,
      error: "Odd-length hex (incomplete byte).",
      lines: [],
      byteLength: 0,
    };
  }

  const bytes = toBytes(hex);
  const byteLength = bytes.length;
  const lines: DisasmLine[] = [];
  let i = 0;
  let depth = 0;
  let clampedControlFlow = false;

  const pushLine = (data: string, at: number, op: number) => {
    const dataLen = data.length / 2;
    const pushOp =
      op >= 0x01 && op <= 0x4b
        ? `PUSH(${dataLen})`
        : `${PUSHDATA_NAMES[op]}(${dataLen})`;
    const line: DisasmLine = {
      depth: at,
      text: pushLabel(dataLen, data),
      kind: "push",
      hex: data,
      pushOp,
    };
    if (!pushIsMinimal(op, data)) line.nonMinimal = true;
    lines.push(line);
  };

  while (i < byteLength) {
    const b = Number.parseInt(bytes[i], 16);

    // Direct data push (1..75 bytes)
    if (b >= 0x01 && b <= 0x4b) {
      const dataStart = i + 1;
      if (dataStart + b > byteLength) {
        return {
          ok: false,
          error: `Truncated push: opcode 0x${bytes[i]} needs ${b} bytes but only ${byteLength - dataStart} remain.`,
          lines,
          byteLength,
        };
      }
      pushLine(bytes.slice(dataStart, dataStart + b).join(""), depth, b);
      i = dataStart + b;
      continue;
    }

    // OP_PUSHDATA1/2/4 — length is little-endian
    if (b === OP_PUSHDATA1 || b === OP_PUSHDATA2 || b === OP_PUSHDATA4) {
      const widthBytes = b === OP_PUSHDATA1 ? 1 : b === OP_PUSHDATA2 ? 2 : 4;
      if (i + 1 + widthBytes > byteLength) {
        return {
          ok: false,
          error: `Truncated ${PUSHDATA_NAMES[b]} length prefix.`,
          lines,
          byteLength,
        };
      }
      let n = 0;
      for (let k = 0; k < widthBytes; k += 1) {
        n += Number.parseInt(bytes[i + 1 + k], 16) * 2 ** (8 * k);
      }
      const dataStart = i + 1 + widthBytes;
      if (dataStart + n > byteLength) {
        return {
          ok: false,
          error: `Truncated push: ${PUSHDATA_NAMES[b]} needs ${n} bytes but only ${byteLength - dataStart} remain.`,
          lines,
          byteLength,
        };
      }
      pushLine(bytes.slice(dataStart, dataStart + n).join(""), depth, b);
      i = dataStart + n;
      continue;
    }

    // Control flow (drives indentation)
    if (b === OP_IF || b === OP_NOTIF) {
      lines.push({ depth, text: OPCODE_NAME_BY_BYTE.get(b) as string, kind: "opcode" });
      depth += 1;
      i += 1;
      continue;
    }
    if (b === OP_ELSE) {
      if (depth === 0) clampedControlFlow = true;
      lines.push({ depth: Math.max(0, depth - 1), text: "OP_ELSE", kind: "opcode" });
      i += 1;
      continue;
    }
    if (b === OP_ENDIF) {
      if (depth === 0) clampedControlFlow = true;
      depth = Math.max(0, depth - 1);
      lines.push({ depth, text: "OP_ENDIF", kind: "opcode" });
      i += 1;
      continue;
    }

    // Any other known opcode
    const name = OPCODE_NAME_BY_BYTE.get(b);
    if (name) {
      lines.push({ depth, text: name, kind: "opcode" });
      i += 1;
      continue;
    }

    // Unknown / undefined byte — surface gracefully, don't abort the whole script
    lines.push({ depth, text: `UNKNOWN_0x${bytes[i]}`, kind: "unknown" });
    i += 1;
  }

  let warning: string | undefined;
  if (clampedControlFlow) {
    warning = "unbalanced OP_IF/OP_ENDIF — OP_ELSE/OP_ENDIF without a matching OP_IF";
  } else if (depth > 0) {
    warning = "unbalanced OP_IF/OP_ENDIF — missing OP_ENDIF";
  }

  return warning
    ? { ok: true, lines, byteLength, warning }
    : { ok: true, lines, byteLength };
}
