"""Minimal legacy-script introspection for the flow builder.

Parses scriptSig/scriptPubKey byte streams into pushes and classifies the
standard legacy output shapes. This only *describes* scripts so the builder
can choose node structures — all byte-level truth is re-established by the
generated flow itself and the byte-equality gate.
"""

from __future__ import annotations

OP_0 = 0x00
OP_PUSHDATA1 = 0x4C
OP_PUSHDATA2 = 0x4D
OP_PUSHDATA4 = 0x4E
OP_1 = 0x51
OP_16 = 0x60


class ScriptParseError(ValueError):
    """The script bytes could not be parsed as a push sequence."""


def parse_pushes(script_hex: str) -> list[dict]:
    """Parse a script into ops: [{"op": int, "data": hex|None, "minimal": bool}].

    ``data`` is set for push operations (including OP_0 → empty data) and None
    for non-push opcodes. ``minimal`` records whether a push used the shortest
    possible encoding — non-minimal pushes cannot be rebuilt with
    ``encode_script_push_data`` and force raw mode.
    """
    try:
        raw = bytes.fromhex(script_hex)
    except ValueError as exc:
        raise ScriptParseError(f"invalid script hex: {exc}") from exc

    ops: list[dict] = []
    i = 0
    while i < len(raw):
        op = raw[i]
        i += 1
        if op == OP_0:
            ops.append({"op": op, "data": "", "minimal": True})
        elif 1 <= op <= 75:
            data, i = _take(raw, i, op)
            ops.append({"op": op, "data": data.hex(), "minimal": True})
        elif op == OP_PUSHDATA1:
            (n,), i = _take(raw, i, 1)
            data, i = _take(raw, i, n)
            ops.append({"op": op, "data": data.hex(), "minimal": n > 75})
        elif op == OP_PUSHDATA2:
            two, i = _take(raw, i, 2)
            n = int.from_bytes(two, "little")
            data, i = _take(raw, i, n)
            ops.append({"op": op, "data": data.hex(), "minimal": n > 255})
        elif op == OP_PUSHDATA4:
            four, i = _take(raw, i, 4)
            n = int.from_bytes(four, "little")
            data, i = _take(raw, i, n)
            ops.append({"op": op, "data": data.hex(), "minimal": n > 65535})
        else:
            ops.append({"op": op, "data": None, "minimal": True})
    return ops


def _take(raw: bytes, i: int, n: int):
    if i + n > len(raw):
        raise ScriptParseError("script truncated inside a push")
    return raw[i : i + n], i + n


def data_pushes(ops: list[dict]) -> list[str]:
    """The hex payloads of all push operations, in order."""
    return [op["data"] for op in ops if op["data"] is not None]


def all_minimal_pushes(ops: list[dict]) -> bool:
    return all(op["minimal"] for op in ops)


# ── scriptPubKey classification ──────────────────────────────────────────────
# Mirrors Bitcoin Core's standard legacy types; `classify_spk` is only used
# when no Core decode is available (offline fixtures/tests). Live rebuilds use
# Core's own `scriptPubKey.type`.

def classify_spk(spk_hex: str) -> str:
    """Return Core-style type for a legacy scriptPubKey."""
    s = spk_hex.lower()
    n = len(s) // 2
    if (
        len(s) == 50
        and s.startswith("76a914")
        and s.endswith("88ac")
    ):
        return "pubkeyhash"
    if len(s) == 46 and s.startswith("a914") and s.endswith("87"):
        return "scripthash"
    if s.startswith("6a"):
        return "nulldata"
    try:
        ops = parse_pushes(s)
    except ScriptParseError:
        return "nonstandard"
    if (
        len(ops) == 2
        and ops[0]["data"] is not None
        and len(ops[0]["data"]) in (66, 130)
        and ops[1]["op"] == 0xAC  # OP_CHECKSIG
    ):
        return "pubkey"
    if (
        len(ops) >= 4
        and OP_1 <= ops[0]["op"] <= OP_16
        and OP_1 <= ops[-2]["op"] <= OP_16
        and ops[-1]["op"] == 0xAE  # OP_CHECKMULTISIG
        and all(o["data"] is not None for o in ops[1:-2])
        and n <= 520
    ):
        return "multisig"
    return "nonstandard"


def parse_multisig(script_hex: str) -> dict | None:
    """Parse an ``OP_m <pk>… OP_n OP_CHECKMULTISIG`` script.

    Returns {"m": int, "n": int, "pubkeys": [hex, …]} or None. Works for bare
    multisig scriptPubKeys and for P2SH redeemScripts alike.
    """
    try:
        ops = parse_pushes(script_hex)
    except ScriptParseError:
        return None
    if len(ops) < 4 or ops[-1]["op"] != 0xAE:
        return None
    if not (OP_1 <= ops[0]["op"] <= OP_16 and OP_1 <= ops[-2]["op"] <= OP_16):
        return None
    pubkeys = [o["data"] for o in ops[1:-2]]
    if not pubkeys or any(
        d is None or len(d) not in (66, 130) for d in pubkeys
    ):
        return None
    m = ops[0]["op"] - OP_1 + 1
    n = ops[-2]["op"] - OP_1 + 1
    if n != len(pubkeys) or not 1 <= m <= n:
        return None
    return {"m": m, "n": n, "pubkeys": pubkeys}


def p2pkh_hash160(spk_hex: str) -> str | None:
    s = spk_hex.lower()
    if len(s) == 50 and s.startswith("76a914") and s.endswith("88ac"):
        return s[6:46]
    return None


def p2pk_pubkey(spk_hex: str) -> str | None:
    try:
        ops = parse_pushes(spk_hex)
    except ScriptParseError:
        return None
    if len(ops) == 2 and ops[1]["op"] == 0xAC and ops[0]["data"]:
        return ops[0]["data"]
    return None


def sighash_byte(scriptsig_hex: str) -> int | None:
    """SIGHASH byte of the first signature push in a scriptSig, if any."""
    try:
        ops = parse_pushes(scriptsig_hex)
    except ScriptParseError:
        return None
    for op in ops:
        data = op["data"]
        # DER signatures start 0x30 and are 9–73 bytes incl. the sighash byte
        if data and data.startswith("30") and 18 <= len(data) <= 146:
            return int(data[-2:], 16)
    return None
