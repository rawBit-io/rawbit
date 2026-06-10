"""Build a rawBit flow for any legacy transaction — N inputs, M outputs.

Replicates the structure of the hand-authored multi-input lesson
(``p1_Intro_P2PKH_and_P2PK``): per-field constant nodes feed byte transforms,
everything converges on a TX-spine ``concat_all`` that serializes the
transaction, and a proof block compares the rebuilt bytes (and txid) against
the original on canvas.

Each input is rebuilt in one of three modes, downgraded independently until
the bytes match:

  sign  — the spending key is known (regtest wallet): the flow rebuilds the
          sighash preimage (per-input spine with ``__FORCE00__``/``__EMPTY__``
          sentinels, exactly like the lessons), hashes it, and re-signs with
          Bitcoin Core's low-R/RFC6979 algorithm. The signature on canvas is
          *recreated*, not pasted.
  wire  — the scriptSig's pushes are decomposed into signature/pubkey
          constants taken from the wire.
  raw   — the scriptSig is one constant carrying the raw wire bytes.

``generate_legacy_flow`` recalculates the whole graph through the real engine
and refuses to return anything that does not reproduce the source bytes.
"""

from __future__ import annotations

import copy

from .flow_builder import (
    PURPLE,
    SENTINEL_EMPTY,
    SENTINEL_FORCE00,
    SPINE_IN_SCRIPT_LEN,
    SPINE_IN_SCRIPT_SIG,
    SPINE_IN_SEQUENCE,
    SPINE_IN_TXID,
    SPINE_IN_VOUT,
    SPINE_INPUT_BASE,
    SPINE_LOCKTIME,
    SPINE_OUT_AMOUNT,
    SPINE_OUT_SPK,
    SPINE_OUT_SPK_LEN,
    SPINE_OUTPUT_BASE,
    SPINE_OUTPUT_COUNT,
    SPINE_STRIDE,
    YELLOW,
    FlowBuilder,
)
from .script_parse import (
    all_minimal_pushes,
    p2pk_pubkey,
    p2pkh_hash160,
    parse_multisig,
    parse_pushes,
    ScriptParseError,
)


class UnsupportedTransaction(Exception):
    """The transaction is not a shape this builder can rebuild yet."""


MAX_INPUTS = 10
MAX_OUTPUTS = 10

# Layout grid (pixels). Lesson nodes are ~360-420 px wide and bands in p1 sit
# ~420 px apart vertically, with ~480 px column pitch. Identity nodes grow
# with their field rows, so anything stacked below a 2-/3-row node needs the
# taller pitches (calibrated against rendered node heights).
COL = 500
ROW = 430
ROW_AFTER_2 = 1.4 * ROW  # next row below a rows=2 identity
ROW_AFTER_3 = 1.7 * ROW  # next row below a rows=3 identity
BAND_GAP = 260
# A TX-spine node renders one stacked text field per slot; reserve vertical
# room for it inside signing bands (calibrated against the rendered lessons).
SPINE_FIELD_H = 110
SPINE_BASE_H = 250
SPINE_WIDTH_COLS = 4  # horizontal room a spine node occupies in the grid

# Script types the script_verification evaluator handles for legacy spends.
_VERIFIABLE_TYPES = {"pubkeyhash", "pubkey", "multisig", "scripthash"}

# Standardness-only flags we may exclude so historical wire signatures (high-S,
# pre-BIP66 DER, …) still verify on canvas. Consensus flags are never excluded.
_RELAXABLE_FLAG_SETS = (
    "LOW_S",
    "LOW_S,DERSIG",
    "LOW_S,DERSIG,STRICTENC",
    "LOW_S,DERSIG,STRICTENC,MINIMALDATA,NULLDUMMY",
)

SIGHASH_ALL = 1


def _scriptsig_parses(scriptsig_hex: str) -> bool:
    try:
        parse_pushes(scriptsig_hex)
        return True
    except ScriptParseError:
        return False


class _Refs:
    """Node ids the gate (and tests) need to inspect after a calc run."""

    def __init__(self) -> None:
        self.final_tx: str = ""
        self.txid_display: str = ""
        self.bytes_match: str = ""
        self.txid_match: str = ""
        self.scriptsig: dict[int, str] = {}
        self.signature: dict[int, str] = {}
        self.spk: dict[int, str] = {}
        self.verify: dict[int, str] = {}
        self.modes: dict[int, str] = {}


def _op_byte_names(op_hex: str) -> list[str]:
    """Human names for a run of opcode bytes (for op_code_select display)."""
    from calc_functions.opcodes import OPCODE_TO_HEX

    rev: dict[str, str] = {}
    for name, hx in OPCODE_TO_HEX.items():
        rev.setdefault(str(hx).lower(), name)
    return [
        rev.get(op_hex[k : k + 2].lower(), f"0x{op_hex[k:k+2]}")
        for k in range(0, len(op_hex), 2)
    ]


def _wire_plan(inp: dict) -> dict:
    """Structured wire decomposition of one scriptSig, or raw.

    Kinds: ``p2pkh`` / ``p2pk`` (labelled sig/pubkey constants), ``pushes``
    (generic opcode-run + data-push decomposition, e.g. multisig or P2SH
    spends), ``raw`` (single constant with the wire bytes).
    """
    sig_hex = inp["scriptsig_hex"]
    if inp.get("coinbase") or not sig_hex:
        return {"kind": "raw"}
    try:
        ops = parse_pushes(sig_hex)
    except ScriptParseError:
        return {"kind": "raw"}
    if not all_minimal_pushes(ops):
        return {"kind": "raw"}
    pushes = [op["data"] for op in ops if op["data"]]
    prev_type = inp.get("prev_spk_type")
    if (
        prev_type == "pubkeyhash"
        and len(ops) == 2
        and len(pushes) == 2
        and pushes[0].startswith("30")
    ):
        return {"kind": "p2pkh", "sig": pushes[0], "pubkey": pushes[1]}
    if prev_type == "pubkey" and len(ops) == 1 and len(pushes) == 1:
        return {"kind": "p2pk", "sig": pushes[0]}

    # generic decomposition: merge consecutive non-push opcodes into runs
    items: list[dict] = []
    for op in ops:
        if op["data"] is None or op["data"] == "":
            op_hex = f"{op['op']:02x}"
            if items and items[-1]["t"] == "op":
                items[-1]["hex"] += op_hex
            else:
                items.append({"t": "op", "hex": op_hex})
        else:
            items.append({"t": "data", "hex": op["data"]})
    if any(item["t"] == "data" for item in items):
        return {"kind": "pushes", "items": items}
    return {"kind": "raw"}


def _multisig_context(inp: dict) -> dict | None:
    """Multisig description for a P2MS or P2SH-multisig spend, else None.

    Returns {"redeem": hex|None, "script_code": hex, "ms": {...},
    "sigs": [hex, …]} where sigs are the wire signature pushes in order.
    """
    try:
        ops = parse_pushes(inp["scriptsig_hex"])
    except ScriptParseError:
        return None
    if not all_minimal_pushes(ops) or not ops or ops[0]["data"] != "":
        return None  # must start with the OP_CHECKMULTISIG dummy (OP_0)
    prev_type = inp.get("prev_spk_type")
    if prev_type == "multisig":
        sig_ops, redeem = ops[1:], None
        script_code = inp["prev_scriptpubkey"]
    elif prev_type == "scripthash" and len(ops) >= 3:
        sig_ops, redeem = ops[1:-1], ops[-1]["data"]
        if not redeem:
            return None
        script_code = redeem
    else:
        return None
    ms = parse_multisig(script_code)
    if ms is None:
        return None
    sigs = [o["data"] for o in sig_ops]
    if not sigs or any(not s or not s.startswith("30") for s in sigs):
        return None
    return {"redeem": redeem, "script_code": script_code, "ms": ms, "sigs": sigs}


def _legacy_sighash_digest(dataset: dict, i: int, script_code_hex: str) -> bytes:
    """The 32-byte SIGHASH_ALL digest for input ``i`` (legacy serialization)."""
    import hashlib
    import struct

    def varint(n: int) -> bytes:
        if n <= 0xFC:
            return bytes([n])
        if n <= 0xFFFF:
            return b"\xfd" + struct.pack("<H", n)
        return b"\xfe" + struct.pack("<I", n)

    parts = [struct.pack("<I", dataset["version"] & 0xFFFFFFFF)]
    parts.append(varint(len(dataset["vin"])))
    for k, inp in enumerate(dataset["vin"]):
        parts.append(bytes.fromhex(inp["prev_txid"])[::-1])
        parts.append(struct.pack("<I", inp["vout"]))
        code = bytes.fromhex(script_code_hex) if k == i else b""
        parts.append(varint(len(code)))
        parts.append(code)
        parts.append(struct.pack("<I", inp["sequence"] & 0xFFFFFFFF))
    parts.append(varint(len(dataset["vout"])))
    for out in dataset["vout"]:
        spk = bytes.fromhex(out["scriptpubkey"])
        parts.append(struct.pack("<Q", out["value_sats"]))
        parts.append(varint(len(spk)))
        parts.append(spk)
    parts.append(struct.pack("<I", dataset["locktime"] & 0xFFFFFFFF))
    parts.append(struct.pack("<I", SIGHASH_ALL))
    preimage = b"".join(parts)
    return hashlib.sha256(hashlib.sha256(preimage).digest()).digest()


def _match_sig_to_pubkey(
    digest: bytes, sig_with_flag: str, pubkeys: list[str]
) -> str | None:
    """Which of ``pubkeys`` made this signature over ``digest``? None if no
    match (foreign digest variant, non-strict DER, wrong sighash, …)."""
    from ecdsa import SECP256k1, VerifyingKey
    from ecdsa.util import sigdecode_der

    der = bytes.fromhex(sig_with_flag[:-2])
    for pubkey in pubkeys:
        try:
            vk = VerifyingKey.from_string(bytes.fromhex(pubkey), curve=SECP256k1)
            if vk.verify_digest(der, digest, sigdecode=sigdecode_der):
                return pubkey
        except Exception:
            continue
    return None


def _multisig_sign_plan(dataset: dict, i: int) -> dict | None:
    """A sign-ms plan when at least one wire signature's key is owned."""
    inp = dataset["vin"][i]
    keys = inp.get("privkeys_by_pubkey") or {}
    if not keys:
        return None
    ctx = _multisig_context(inp)
    if ctx is None:
        return None
    digest = _legacy_sighash_digest(dataset, i, ctx["script_code"])
    sigs = []
    owned = 0
    for sig in ctx["sigs"]:
        privkey = None
        if sig.endswith(f"{SIGHASH_ALL:02x}"):
            pubkey = _match_sig_to_pubkey(digest, sig, ctx["ms"]["pubkeys"])
            privkey = keys.get(pubkey) if pubkey else None
        if privkey:
            owned += 1
        sigs.append({"sig": sig, "privkey": privkey})
    if not owned:
        return None
    return {
        "kind": "sign-ms",
        "redeem": ctx["redeem"],
        "ms": ctx["ms"],
        "sigs": sigs,
        "owned": owned,
    }


def _auto_mode(inp: dict) -> str:
    """Pick the richest mode the input's data supports (plan-level checks for
    multisig happen in ``_scriptsig_plan`` — here a key just has to exist)."""
    if inp.get("coinbase"):
        return "wire"
    if (
        inp.get("privkey_hex")
        and inp.get("sighash_type") == SIGHASH_ALL
        and _wire_plan(inp)["kind"] in ("p2pkh", "p2pk")
    ):
        return "sign"
    if inp.get("privkeys_by_pubkey") and inp.get("prev_spk_type") in (
        "multisig",
        "scripthash",
    ):
        return "sign"
    return "wire"


def _scriptsig_plan(dataset: dict, i: int, mode: str) -> dict:
    """Resolve the build plan for one input under the given mode."""
    inp = dataset["vin"][i]
    if mode == "raw":
        return {"kind": "raw"}
    wire = _wire_plan(inp)
    if mode == "wire":
        return wire
    # mode == "sign"
    if wire["kind"] in ("p2pkh", "p2pk"):
        from calc_functions.calc_func import public_key_from_private_key

        plan = dict(wire)
        plan["kind"] = "sign-" + wire["kind"]
        if wire["kind"] == "p2pkh":
            derived = public_key_from_private_key(inp["privkey_hex"])
            plan["pubkey_derived"] = derived == wire["pubkey"]
        return plan
    ms_plan = _multisig_sign_plan(dataset, i)
    return ms_plan if ms_plan is not None else wire


def _band_height(plan: dict, n_in: int, n_out: int) -> float:
    """Vertical room one input band needs."""
    base = ROW_AFTER_3 + 2 * ROW  # funding / vout / sequence column
    if plan["kind"].startswith("sign-"):
        spine_fields = 2 + 5 * n_in + 1 + 3 * n_out + 1
        spine_h = SPINE_BASE_H + SPINE_FIELD_H * spine_fields
        chain_h = (
            ROW + len(plan["sigs"]) * ROW_AFTER_2 + ROW
            if plan["kind"] == "sign-ms"
            else ROW_AFTER_3 + 3 * ROW
        )
        return max(base, chain_h, spine_h + ROW)
    if plan["kind"] == "pushes":
        return max(base, len(plan["items"]) * ROW_AFTER_2 + ROW)
    return base


def build_legacy_flow(
    dataset: dict,
    input_modes: dict[int, str] | None = None,
    raw_spk_outputs: frozenset[int] = frozenset(),
    verify_exclude_flags: dict[int, str] | None = None,
) -> tuple[dict, _Refs]:
    """Construct the flow (no recalculation). Returns (flow, refs)."""
    vin = dataset["vin"]
    vout = dataset["vout"]
    if not vin or not vout:
        raise UnsupportedTransaction("transaction has no inputs or no outputs.")
    if len(vin) > MAX_INPUTS or len(vout) > MAX_OUTPUTS:
        raise UnsupportedTransaction(
            f"too large to rebuild on canvas: {len(vin)} inputs / {len(vout)} "
            f"outputs (limit {MAX_INPUTS}/{MAX_OUTPUTS})."
        )
    if dataset.get("has_witness"):
        raise UnsupportedTransaction(
            "SegWit/Taproot transactions are not supported yet — legacy only."
        )

    modes = {
        i: (input_modes or {}).get(i) or _auto_mode(inp)
        for i, inp in enumerate(vin)
    }
    plans = {i: _scriptsig_plan(dataset, i, modes[i]) for i in range(len(vin))}
    n_in, n_out = len(vin), len(vout)

    b = FlowBuilder()
    refs = _Refs()
    refs.modes = modes

    # ── header band ──────────────────────────────────────────────────────────
    y = 0.0
    version_u32 = dataset["version"] & 0xFFFFFFFF
    n_version = b.identity("Transaction Version", str(version_u32), 0, y)
    n_version_le = b.fn("uint32_to_little_endian_4_bytes", "Uint32 → LE-4", COL, y)
    b.edge(n_version, n_version_le)
    n_incount = b.identity("Input Count", str(n_in), 2 * COL, y)
    n_incount_v = b.fn("encode_varint", "Int → VarInt", 3 * COL, y)
    b.edge(n_incount, n_incount_v)
    n_outcount = b.identity("Output Count", str(n_out), 4 * COL, y)
    n_outcount_v = b.fn("encode_varint", "Int → VarInt", 5 * COL, y)
    b.edge(n_outcount, n_outcount_v)
    n_locktime = b.identity("Locktime", str(dataset["locktime"]), 6 * COL, y)
    n_locktime_le = b.fn(
        "uint32_to_little_endian_4_bytes", "Uint32 → LE-4", 7 * COL, y
    )
    b.edge(n_locktime, n_locktime_le)
    y += ROW + BAND_GAP

    # ── final spine (positioned after the bands are laid out) ────────────────
    n_spine = b.tx_spine("Final Raw Transaction", n_in, n_out, 0, 0)
    refs.final_tx = n_spine
    spine_static: dict[int, str] = {}
    b.edge(n_version_le, n_spine, 0)
    b.edge(n_incount_v, n_spine, 10)
    b.edge(n_outcount_v, n_spine, SPINE_OUTPUT_COUNT)
    b.edge(n_locktime_le, n_spine, SPINE_LOCKTIME)

    # ── per-input field nodes (txid/vout/sequence sources, shared by every
    #    preimage spine and the final spine) ──────────────────────────────────
    in_fields: list[dict] = []
    band_tops: list[float] = []
    band_heights: list[float] = []
    for i, inp in enumerate(vin):
        band_top = y
        band_tops.append(band_top)
        coinbase = bool(inp.get("coinbase"))
        fields: dict = {"coinbase": coinbase}
        if not coinbase:
            n_funding = b.identity(
                f"Funding rawTX — input {i}",
                inp["prev_tx_hex"],
                0,
                band_top,
                rows=3,
            )
            n_extract = b.extract(
                f"Funding TX fields — input {i}",
                ["txid", "vout.scriptPubKey", "vout.value"],
                COL,
                band_top,
            )
            b.edge(n_funding, n_extract, 0)
            n_vout = b.identity(
                f"Output Index (vout) — input {i}",
                str(inp["vout"]),
                0,
                band_top + ROW_AFTER_3,
            )
            b.edge(n_vout, n_extract, 1)
            n_vout_le = b.fn(
                "uint32_to_little_endian_4_bytes",
                "Uint32 → LE-4",
                COL,
                band_top + ROW_AFTER_3,
            )
            b.edge(n_vout, n_vout_le)
            fields.update(extract=n_extract, vout_le=n_vout_le)
        n_seq = b.identity(
            f"Sequence — input {i}",
            format(inp["sequence"] & 0xFFFFFFFF, "08x"),
            0,
            band_top + ROW_AFTER_3 + ROW,
        )
        n_seq_rev = b.fn(
            "reverse_bytes_4", "4-Byte → Reversed", COL, band_top + ROW_AFTER_3 + ROW
        )
        b.edge(n_seq, n_seq_rev)
        fields["seq_rev"] = n_seq_rev
        in_fields.append(fields)

        height = _band_height(plans[i], n_in, n_out)
        band_heights.append(height)
        y += height + BAND_GAP

    # ── output bands ─────────────────────────────────────────────────────────
    out_fields: list[dict] = []
    for j, out in enumerate(vout):
        base = SPINE_OUTPUT_BASE + j * SPINE_STRIDE
        band_top = y
        n_amount = b.identity(
            f"Output Amount (satoshis) — output {j}",
            str(out["value_sats"]),
            0,
            band_top,
        )
        n_amount_le = b.fn("satoshi_to_8_le", "Satoshi → LE-8", COL, band_top)
        b.edge(n_amount, n_amount_le)
        b.edge(n_amount_le, n_spine, base + SPINE_OUT_AMOUNT)

        plan = _spk_plan(out, j in raw_spk_outputs)
        sx = 2 * COL
        if plan["kind"] == "p2pkh":
            n_op1 = b.op_codes(["OP_DUP", "OP_HASH160"], "76a9", sx, band_top)
            n_h160 = b.identity(
                f"PubKey HASH160 — output {j}", plan["hash160"], sx, band_top + ROW
            )
            n_push = b.fn(
                "encode_script_push_data",
                "Data → Push Opcode",
                sx + COL,
                band_top + ROW,
            )
            b.edge(n_h160, n_push)
            n_op2 = b.op_codes(
                ["OP_EQUALVERIFY", "OP_CHECKSIG"], "88ac", sx, band_top + 2 * ROW
            )
            n_spk = b.concat(
                f"scriptPubKey (P2PKH) — output {j}",
                ["OPCODES:", "PUSH_LEN:", "HASH160:", "OPCODES:"],
                sx + 2 * COL,
                band_top + ROW,
            )
            b.edge(n_op1, n_spk, 0)
            b.edge(n_push, n_spk, 100)
            b.edge(n_h160, n_spk, 200)
            b.edge(n_op2, n_spk, 300)
            rows_used = 3
        elif plan["kind"] == "p2pk":
            n_pk = b.identity(
                f"Public Key — output {j}", plan["pubkey"], sx, band_top, rows=2
            )
            n_push = b.fn(
                "encode_script_push_data", "Data → Push Opcode", sx + COL, band_top
            )
            b.edge(n_pk, n_push)
            n_op = b.op_codes(["OP_CHECKSIG"], "ac", sx, band_top + ROW_AFTER_2)
            n_spk = b.concat(
                f"scriptPubKey (P2PK) — output {j}",
                ["PUSH_LEN:", "PUBKEY:", "OPCODES:"],
                sx + 2 * COL,
                band_top + ROW_AFTER_2 / 2,
            )
            b.edge(n_push, n_spk, 0)
            b.edge(n_pk, n_spk, 100)
            b.edge(n_op, n_spk, 200)
            rows_used = 2
        else:
            label = {
                "scripthash": "P2SH",
                "multisig": "bare multisig",
                "nulldata": "OP_RETURN",
            }.get(out.get("spk_type") or "", "raw")
            n_spk = b.identity(
                f"scriptPubKey ({label}) — output {j}",
                out["scriptpubkey"],
                sx,
                band_top,
                rows=3,
            )
            rows_used = 1
        refs.spk[j] = n_spk

        n_spk_len = b.fn(
            "varint_encoded_byte_length",
            "Data → VarInt Length",
            sx + 3 * COL,
            band_top,
        )
        b.edge(n_spk, n_spk_len)
        b.edge(n_spk_len, n_spine, base + SPINE_OUT_SPK_LEN)
        b.edge(n_spk, n_spine, base + SPINE_OUT_SPK)
        out_fields.append({"amount_le": n_amount_le, "spk": n_spk, "spk_len": n_spk_len})

        y = band_top + rows_used * ROW + BAND_GAP

    # ── scriptSig clusters (wire constants or full signing chains) ───────────
    band_right = 6 * COL  # widest wire band (funding cols + cluster + varint)
    for i, inp in enumerate(vin):
        base = SPINE_INPUT_BASE + i * SPINE_STRIDE
        band_top = band_tops[i]
        plan = plans[i]
        coinbase = bool(inp.get("coinbase"))
        fields = in_fields[i]

        # wire the input's outpoint + sequence into the final spine
        if coinbase:
            spine_static[base + SPINE_IN_TXID] = "00" * 32
            spine_static[base + SPINE_IN_VOUT] = "ffffffff"
        else:
            b.edge(
                fields["extract"],
                n_spine,
                base + SPINE_IN_TXID,
                source_handle="output-0",
            )
            b.edge(fields["vout_le"], n_spine, base + SPINE_IN_VOUT)
        b.edge(fields["seq_rev"], n_spine, base + SPINE_IN_SEQUENCE)

        sx = 2 * COL
        sy = band_top
        header = (n_version_le, n_incount_v, n_outcount_v, n_locktime_le)
        if plan["kind"] == "sign-ms":
            n_scriptsig, right = _build_ms_signing_chain(
                b, refs, dataset, i, plan, in_fields, out_fields, header, sx, sy
            )
        elif plan["kind"].startswith("sign-"):
            n_scriptsig, right = _build_signing_chain(
                b, refs, dataset, i, plan, in_fields, out_fields, header, sx, sy
            )
        elif plan["kind"] == "pushes":
            n_scriptsig, right = _build_pushes_cluster(b, i, plan, sx, sy)
        elif plan["kind"] == "p2pkh":
            n_sig = b.identity(
                f"Signature (DER+flag, from wire) — input {i}",
                plan["sig"],
                sx,
                sy,
                color=YELLOW,
                rows=2,
            )
            n_sig_push = b.fn(
                "encode_script_push_data", "Data → Push Opcode", sx + COL, sy, YELLOW
            )
            b.edge(n_sig, n_sig_push)
            n_pk = b.identity(
                f"Public Key (from wire) — input {i}",
                plan["pubkey"],
                sx,
                sy + ROW_AFTER_2,
                color=YELLOW,
                rows=2,
            )
            n_pk_push = b.fn(
                "encode_script_push_data",
                "Data → Push Opcode",
                sx + COL,
                sy + ROW_AFTER_2,
                YELLOW,
            )
            b.edge(n_pk, n_pk_push)
            n_scriptsig = b.concat(
                f"scriptSig (push sig & pubkey) — input {i}",
                ["PUSH_SIG:", "SIGNATURE:", "PUSH_PK:", "PUBKEY:"],
                sx + 2 * COL,
                sy + ROW_AFTER_2 / 2,
                color=YELLOW,
            )
            b.edge(n_sig_push, n_scriptsig, 0)
            b.edge(n_sig, n_scriptsig, 100)
            b.edge(n_pk_push, n_scriptsig, 200)
            b.edge(n_pk, n_scriptsig, 300)
            right = sx + 3 * COL
        elif plan["kind"] == "p2pk":
            n_sig = b.identity(
                f"Signature (DER+flag, from wire) — input {i}",
                plan["sig"],
                sx,
                sy,
                color=YELLOW,
                rows=2,
            )
            n_sig_push = b.fn(
                "encode_script_push_data", "Data → Push Opcode", sx + COL, sy, YELLOW
            )
            b.edge(n_sig, n_sig_push)
            n_scriptsig = b.concat(
                f"scriptSig (push sig) — input {i}",
                ["PUSH_SIG:", "SIGNATURE:"],
                sx + 2 * COL,
                sy,
                color=YELLOW,
            )
            b.edge(n_sig_push, n_scriptsig, 0)
            b.edge(n_sig, n_scriptsig, 100)
            right = sx + 3 * COL
        else:
            title = (
                f"Coinbase scriptSig — input {i}"
                if coinbase
                else f"scriptSig (from wire) — input {i}"
            )
            n_scriptsig = b.identity(
                title, inp["scriptsig_hex"], sx, sy, color=YELLOW, rows=3
            )
            right = sx + COL
        refs.scriptsig[i] = n_scriptsig

        n_sig_len = b.fn(
            "varint_encoded_byte_length",
            "Data → VarInt Length",
            right,
            sy,
            YELLOW,
        )
        b.edge(n_scriptsig, n_sig_len)
        b.edge(n_sig_len, n_spine, base + SPINE_IN_SCRIPT_LEN)
        b.edge(n_scriptsig, n_spine, base + SPINE_IN_SCRIPT_SIG)
        band_right = max(band_right, right + COL)

    # ── verification nodes ───────────────────────────────────────────────────
    verify_x = band_right + COL
    for i, inp in enumerate(vin):
        if (
            inp.get("coinbase")
            or inp.get("prev_spk_type") not in _VERIFIABLE_TYPES
            or not _scriptsig_parses(inp["scriptsig_hex"])
        ):
            continue
        n_verify = b.multi(
            "script_verification",
            f"Verify Script — input {i}",
            _VERIFY_FIELDS,
            verify_x,
            band_tops[i] + ROW,
            color=PURPLE,
            static_vals={
                3: str(i),
                4: (verify_exclude_flags or {}).get(i, ""),
                5: SENTINEL_EMPTY,
            },
        )
        b.edge(refs.scriptsig[i], n_verify, 0)
        b.edge(in_fields[i]["extract"], n_verify, 1, source_handle="output-1")
        b.edge(n_spine, n_verify, 2)
        refs.verify[i] = n_verify

    # ── spine position + static slots ────────────────────────────────────────
    spine_node = next(n for n in b.nodes if n["id"] == n_spine)
    spine_node["position"] = {"x": band_right + 2.5 * COL, "y": ROW + BAND_GAP}
    spine_node["data"]["inputs"]["vals"].update(
        {str(k): v for k, v in spine_static.items()}
    )

    # ── txid + proof block ───────────────────────────────────────────────────
    px = band_right + 4 * COL
    n_sha = b.fn("double_sha256_hex", "Data → SHA-256d", px, ROW, PURPLE)
    b.edge(n_spine, n_sha)
    n_txid = b.fn("reverse_txid_bytes", "TXID → Reversed", px + COL, ROW, PURPLE)
    b.edge(n_sha, n_txid)
    refs.txid_display = n_txid

    n_expected_txid = b.identity(
        "Expected TXID (from node)",
        dataset["txid"],
        px,
        2 * ROW,
        color=PURPLE,
        rows=2,
    )
    n_txid_match = b.multi(
        "compare_equal",
        "TXID matches?",
        [
            {"index": 0, "label": "REBUILT TXID:", "rows": 2},
            {"index": 1, "label": "EXPECTED TXID:", "rows": 2},
        ],
        px + 2 * COL,
        1.5 * ROW,
        color=PURPLE,
    )
    b.edge(n_txid, n_txid_match, 0)
    b.edge(n_expected_txid, n_txid_match, 1)
    refs.txid_match = n_txid_match

    n_original = b.identity(
        "Original TX (from node)",
        dataset["tx_hex"],
        px,
        3.5 * ROW,
        color=PURPLE,
        rows=3,
    )
    n_bytes_match = b.multi(
        "compare_equal",
        "Rebuilt bytes match original?",
        [
            {"index": 0, "label": "REBUILT TX:", "rows": 3},
            {"index": 1, "label": "ORIGINAL TX:", "rows": 3},
        ],
        px + 2 * COL,
        3 * ROW,
        color=PURPLE,
    )
    b.edge(n_spine, n_bytes_match, 0)
    b.edge(n_original, n_bytes_match, 1)
    refs.bytes_match = n_bytes_match

    # ── info card ────────────────────────────────────────────────────────────
    card_x = -2 * COL - 1500
    b.text_info(
        _info_card_content(dataset, modes, plans, verify_exclude_flags or {}),
        card_x,
        0,
        width=1500,
        height=900,
        font_size=28,
        title="Rebuild info",
    )

    flow = b.flow(f"Rebuild {dataset['txid'][:12]}…")
    # Open on the info card at a readable zoom (screen = model·zoom + offset);
    # the reader then follows the flow left → right like a lesson.
    zoom = 0.5
    flow["viewport"] = {
        "x": 60 - (card_x - 60) * zoom,
        "y": 80 - (-60) * zoom,
        "zoom": zoom,
    }
    return flow, refs


_VERIFY_FIELDS = [
    {
        "index": 0,
        "label": "scriptSig_hex",
        "placeholder": "Hex-encoded scriptSig",
        "rows": 3,
        "allowEmptyBlank": True,
    },
    {
        "index": 1,
        "label": "scriptPubKey_hex",
        "placeholder": "Hex-encoded scriptPubKey",
        "rows": 3,
    },
    {
        "index": 2,
        "label": "tx_hex",
        "placeholder": "Hex-encoded Transaction",
        "rows": 3,
    },
    {
        "index": 3,
        "label": "input_index_to_verify",
        "placeholder": "0",
        "rows": 1,
        "unconnectable": True,
    },
    {
        "index": 4,
        "label": "exclude_flags",
        "placeholder": "e.g., WITNESS,CLEANSTACK",
        "rows": 1,
        "unconnectable": True,
    },
    {
        "index": 5,
        "label": "spent_amount_sats",
        "placeholder": "Amount in satoshis (for SegWit/Taproot)",
        "rows": 1,
        "allowEmptyBlank": True,
    },
]


def _spk_plan(out: dict, raw_forced: bool) -> dict:
    """Decide how to rebuild one output's scriptPubKey."""
    spk = out["scriptpubkey"]
    if raw_forced:
        return {"kind": "raw"}
    h160 = p2pkh_hash160(spk)
    if out.get("spk_type") == "pubkeyhash" and h160:
        return {"kind": "p2pkh", "hash160": h160}
    pubkey = p2pk_pubkey(spk)
    if out.get("spk_type") == "pubkey" and pubkey:
        return {"kind": "p2pk", "pubkey": pubkey}
    return {"kind": "raw"}


def _build_preimage_hash(
    b: FlowBuilder,
    dataset: dict,
    i: int,
    in_fields: list[dict],
    out_fields: list[dict],
    header: tuple[str, str, str, str],
    code_src: tuple[str, str | None],
    sx: float,
    sy: float,
) -> tuple[str, str, float]:
    """Preimage spine + SIGHASH for input ``i``; the input's script slot
    carries the scriptCode from ``code_src`` (node id, source handle), every
    other input's slot is blanked by the lesson sentinels.

    Returns (hash_node, sighash_flag_node, next_x).
    """
    n_version_le, n_incount_v, n_outcount_v, n_locktime_le = header
    n_in, n_out = len(dataset["vin"]), len(dataset["vout"])
    code_node, code_handle = code_src

    n_sighash_flag = b.identity(
        f"SIGHASH_ALL flag — input {i}", "01", sx, sy + ROW_AFTER_3, color=YELLOW
    )
    n_sighash_le = b.fn(
        "uint32_to_little_endian_4_bytes",
        "Uint32 → LE-4",
        sx,
        sy + ROW_AFTER_3 + ROW,
        YELLOW,
    )
    b.edge(n_sighash_flag, n_sighash_le)
    n_code_len = b.fn(
        "varint_encoded_byte_length",
        "Data → VarInt Length",
        sx,
        sy + ROW_AFTER_3 + 2 * ROW,
        YELLOW,
    )
    b.edge(code_node, n_code_len, 0, source_handle=code_handle)

    preimage_static: dict[int, str] = {}
    n_preimage = b.tx_spine(
        f"Unsigned TX (preimage) — input {i}",
        n_in,
        n_out,
        sx + COL,
        sy,
        color=YELLOW,
    )
    b.edge(n_version_le, n_preimage, 0)
    b.edge(n_incount_v, n_preimage, 10)
    b.edge(n_outcount_v, n_preimage, SPINE_OUTPUT_COUNT)
    b.edge(n_locktime_le, n_preimage, SPINE_LOCKTIME)
    for k, fields in enumerate(in_fields):
        kbase = SPINE_INPUT_BASE + k * SPINE_STRIDE
        b.edge(
            fields["extract"], n_preimage, kbase + SPINE_IN_TXID, source_handle="output-0"
        )
        b.edge(fields["vout_le"], n_preimage, kbase + SPINE_IN_VOUT)
        b.edge(fields["seq_rev"], n_preimage, kbase + SPINE_IN_SEQUENCE)
        if k == i:
            b.edge(n_code_len, n_preimage, kbase + SPINE_IN_SCRIPT_LEN)
            b.edge(
                code_node,
                n_preimage,
                kbase + SPINE_IN_SCRIPT_SIG,
                source_handle=code_handle,
            )
        else:
            preimage_static[kbase + SPINE_IN_SCRIPT_LEN] = SENTINEL_FORCE00
            preimage_static[kbase + SPINE_IN_SCRIPT_SIG] = SENTINEL_EMPTY
    for jj, ofields in enumerate(out_fields):
        obase = SPINE_OUTPUT_BASE + jj * SPINE_STRIDE
        b.edge(ofields["amount_le"], n_preimage, obase + SPINE_OUT_AMOUNT)
        b.edge(ofields["spk_len"], n_preimage, obase + SPINE_OUT_SPK_LEN)
        b.edge(ofields["spk"], n_preimage, obase + SPINE_OUT_SPK)
    preimage_node = next(n for n in b.nodes if n["id"] == n_preimage)
    preimage_node["data"]["inputs"]["vals"].update(
        {str(k): v for k, v in preimage_static.items()}
    )

    px = sx + (1 + SPINE_WIDTH_COLS) * COL
    n_pre_sig = b.concat(
        f"Pre-image + SIGHASH — input {i}",
        ["TX:", "SIGHASH[4]:"],
        px,
        sy,
        color=YELLOW,
    )
    b.edge(n_preimage, n_pre_sig, 0)
    b.edge(n_sighash_le, n_pre_sig, 100)
    n_hash = b.fn("double_sha256_hex", "Data → SHA-256d", px + COL, sy, YELLOW)
    b.edge(n_pre_sig, n_hash)
    return n_hash, n_sighash_flag, px + 2 * COL


_SIGN_FIELDS = [
    {"index": 0, "label": "Private Key (32 bytes hex):", "rows": 2},
    {"index": 1, "label": "Message Hash (32 bytes hex):", "rows": 2},
]


def _build_signing_chain(
    b: FlowBuilder,
    refs: _Refs,
    dataset: dict,
    i: int,
    plan: dict,
    in_fields: list[dict],
    out_fields: list[dict],
    header: tuple[str, str, str, str],
    sx: float,
    sy: float,
) -> tuple[str, float]:
    """The full re-signing chain for a P2PKH/P2PK input: preimage spine →
    sighash → low-R signature → scriptSig. Returns (scriptsig_node, right_x)."""
    inp = dataset["vin"][i]

    n_privkey = b.identity(
        f"Spending Private Key — input {i}",
        inp["privkey_hex"],
        sx,
        sy,
        color=YELLOW,
        rows=2,
    )
    n_hash, n_sighash_flag, px = _build_preimage_hash(
        b,
        dataset,
        i,
        in_fields,
        out_fields,
        header,
        (in_fields[i]["extract"], "output-1"),
        sx,
        sy,
    )
    n_sign = b.multi(
        "sign_as_bitcoin_core_low_r",
        f"Sign TX (Low-R) — input {i}",
        _SIGN_FIELDS,
        px,
        sy,
        color=YELLOW,
    )
    b.edge(n_privkey, n_sign, 0)
    b.edge(n_hash, n_sign, 1)
    refs.signature[i] = n_sign

    n_sig_flag = b.concat(
        f"Signature + Flag — input {i}",
        ["DER_SIG:", "SIGHASH:"],
        px + COL,
        sy,
        color=YELLOW,
    )
    b.edge(n_sign, n_sig_flag, 0)
    b.edge(n_sighash_flag, n_sig_flag, 100)
    n_sig_push = b.fn(
        "encode_script_push_data", "Data → Push Opcode", px + 2 * COL, sy, YELLOW
    )
    b.edge(n_sig_flag, n_sig_push)

    if plan["kind"] == "sign-p2pkh":
        if plan.get("pubkey_derived"):
            n_pk = b.fn(
                "public_key_from_private_key",
                f"PrivKey → PubKey — input {i}",
                px + COL,
                sy + ROW_AFTER_2,
                YELLOW,
            )
            b.edge(n_privkey, n_pk)
        else:
            n_pk = b.identity(
                f"Public Key (from wire) — input {i}",
                plan["pubkey"],
                px + COL,
                sy + ROW_AFTER_2,
                color=YELLOW,
                rows=2,
            )
        n_pk_push = b.fn(
            "encode_script_push_data",
            "Data → Push Opcode",
            px + 2 * COL,
            sy + ROW_AFTER_2,
            YELLOW,
        )
        b.edge(n_pk, n_pk_push)
        n_scriptsig = b.concat(
            f"scriptSig (push sig & pubkey) — input {i}",
            ["PUSH_SIG:", "SIGNATURE:", "PUSH_PK:", "PUBKEY:"],
            px + 3 * COL,
            sy + ROW_AFTER_2 / 2,
            color=YELLOW,
        )
        b.edge(n_sig_push, n_scriptsig, 0)
        b.edge(n_sig_flag, n_scriptsig, 100)
        b.edge(n_pk_push, n_scriptsig, 200)
        b.edge(n_pk, n_scriptsig, 300)
    else:  # sign-p2pk
        n_scriptsig = b.concat(
            f"scriptSig (push sig) — input {i}",
            ["PUSH_SIG:", "SIGNATURE:"],
            px + 3 * COL,
            sy,
            color=YELLOW,
        )
        b.edge(n_sig_push, n_scriptsig, 0)
        b.edge(n_sig_flag, n_scriptsig, 100)

    return n_scriptsig, px + 4 * COL


def _build_ms_signing_chain(
    b: FlowBuilder,
    refs: _Refs,
    dataset: dict,
    i: int,
    plan: dict,
    in_fields: list[dict],
    out_fields: list[dict],
    header: tuple[str, str, str, str],
    sx: float,
    sy: float,
) -> tuple[str, float]:
    """Multisig re-signing (bare or P2SH): one shared preimage/hash, then per
    wire signature either a sign chain (owned key) or a wire constant."""
    redeem = plan.get("redeem")
    if redeem:
        n_redeem = b.identity(
            f"Redeem Script (from wire) — input {i}",
            redeem,
            sx,
            sy,
            color=YELLOW,
            rows=3,
        )
        code_src = (n_redeem, None)
    else:
        code_src = (in_fields[i]["extract"], "output-1")

    n_hash, n_sighash_flag, px = _build_preimage_hash(
        b, dataset, i, in_fields, out_fields, header, code_src, sx, sy
    )

    n_op0 = b.op_codes(["OP_0"], "00", px, sy)
    concat_labels = ["OP_0 (dummy):"]
    concat_sources: list[tuple[str, str | None]] = [(n_op0, None)]
    m = plan["ms"]["m"]
    for k, entry in enumerate(plan["sigs"]):
        row_y = sy + ROW + k * ROW_AFTER_2
        if entry["privkey"]:
            n_privkey = b.identity(
                f"Spending Private Key — input {i} sig {k}",
                entry["privkey"],
                px,
                row_y,
                color=YELLOW,
                rows=2,
            )
            n_sign = b.multi(
                "sign_as_bitcoin_core_low_r",
                f"Sign TX (Low-R) — input {i} sig {k}",
                _SIGN_FIELDS,
                px + COL,
                row_y,
                color=YELLOW,
            )
            b.edge(n_privkey, n_sign, 0)
            b.edge(n_hash, n_sign, 1)
            refs.signature.setdefault(i, n_sign)
            n_sig_flag = b.concat(
                f"Signature + Flag — input {i} sig {k}",
                ["DER_SIG:", "SIGHASH:"],
                px + 2 * COL,
                row_y,
                color=YELLOW,
            )
            b.edge(n_sign, n_sig_flag, 0)
            b.edge(n_sighash_flag, n_sig_flag, 100)
            n_sig = n_sig_flag
        else:
            n_sig = b.identity(
                f"Signature {k} (from wire) — input {i}",
                entry["sig"],
                px + 2 * COL,
                row_y,
                color=YELLOW,
                rows=2,
            )
        n_push = b.fn(
            "encode_script_push_data", "Data → Push Opcode", px + 3 * COL, row_y, YELLOW
        )
        b.edge(n_sig, n_push)
        concat_labels += [f"PUSH_SIG_{k}:", f"SIGNATURE_{k} (of {m} required):"]
        concat_sources += [(n_push, None), (n_sig, None)]

    if redeem:
        n_redeem_push = b.fn(
            "encode_script_push_data",
            "Data → Push Opcode",
            px + 3 * COL,
            sy,
            YELLOW,
        )
        b.edge(n_redeem, n_redeem_push)
        concat_labels += ["PUSH_REDEEM:", "REDEEM_SCRIPT:"]
        concat_sources += [(n_redeem_push, None), (n_redeem, None)]

    label = "P2SH multisig" if redeem else "bare multisig"
    n_scriptsig = b.concat(
        f"scriptSig ({label}) — input {i}",
        concat_labels,
        px + 4 * COL,
        sy + ROW,
        color=YELLOW,
    )
    for idx, (src, handle) in enumerate(concat_sources):
        b.edge(src, n_scriptsig, idx * 100, source_handle=handle)

    return n_scriptsig, px + 5 * COL


def _build_pushes_cluster(
    b: FlowBuilder, i: int, plan: dict, sx: float, sy: float
) -> tuple[str, float]:
    """Generic wire decomposition: opcode runs + data pushes → concat."""
    concat_labels: list[str] = []
    concat_sources: list[str] = []
    for k, item in enumerate(plan["items"]):
        row_y = sy + k * ROW_AFTER_2
        if item["t"] == "op":
            n_item = b.op_codes(_op_byte_names(item["hex"]), item["hex"], sx, row_y)
            concat_labels.append("OPCODES:")
            concat_sources.append(n_item)
        else:
            n_data = b.identity(
                f"scriptSig data {k} (from wire) — input {i}",
                item["hex"],
                sx,
                row_y,
                color=YELLOW,
                rows=2,
            )
            n_push = b.fn(
                "encode_script_push_data", "Data → Push Opcode", sx + COL, row_y, YELLOW
            )
            b.edge(n_data, n_push)
            concat_labels += ["PUSH_LEN:", "DATA:"]
            concat_sources += [n_push, n_data]
    n_scriptsig = b.concat(
        f"scriptSig (decomposed) — input {i}",
        concat_labels,
        sx + 2 * COL,
        sy,
        color=YELLOW,
    )
    for idx, src in enumerate(concat_sources):
        b.edge(src, n_scriptsig, idx * 100)
    return n_scriptsig, sx + 3 * COL


def _info_card_content(
    dataset: dict,
    modes: dict[int, str],
    plans: dict[int, dict],
    relaxed_flags: dict[int, str],
) -> str:
    vin, vout = dataset["vin"], dataset["vout"]
    in_lines = []
    signed_count = 0
    for i, inp in enumerate(vin):
        if inp.get("coinbase"):
            in_lines.append(f"- Input {i}: coinbase (new coins, nothing spent)")
            continue
        src = inp.get("prev_address") or f"`{inp.get('prev_scriptpubkey', '')[:40]}…`"
        kind = inp.get("prev_spk_type") or "unknown"
        if plans[i]["kind"] == "sign-ms":
            signed_count += 1
            owned, total = plans[i]["owned"], len(plans[i]["sigs"])
            how = (
                f"{owned} of {total} multisig signature(s) **recreated on the "
                "canvas** from the wallet's keys"
                + (", the rest placed from the wire" if owned < total else "")
            )
        elif plans[i]["kind"].startswith("sign-"):
            signed_count += 1
            how = (
                "signature **recreated on the canvas** from the wallet's "
                "private key"
            )
        else:
            how = "signature placed from the wire"
        note = ""
        if relaxed_flags.get(i):
            note = f" (historical signature — verified without {relaxed_flags[i]})"
        in_lines.append(f"- Input {i}: spends {kind} {src} — {how}{note}")
    out_lines = []
    for j, out in enumerate(vout):
        dst = out.get("address") or f"`{out.get('scriptpubkey', '')[:40]}…`"
        out_lines.append(
            f"- Output {j}: {out['value_sats']:,} sats → {out.get('spk_type')} {dst}"
        )
    prev_total = sum(
        inp.get("prev_value_sats") or 0 for inp in vin if not inp.get("coinbase")
    )
    fee = (
        prev_total - sum(o["value_sats"] for o in vout)
        if all(
            not inp.get("coinbase") and inp.get("prev_value_sats") is not None
            for inp in vin
        )
        else None
    )
    fee_line = f"\n**Fee:** {fee:,} sats\n" if fee is not None else "\n"
    headline = (
        "This flow reconstructs the transaction byte-for-byte from its fields"
    )
    if signed_count:
        headline += (
            f" and re-signs {signed_count} of {len(vin)} input(s) from scratch"
        )
    return (
        "# Rebuilt transaction\n\n"
        f"`{dataset['txid']}`\n\n"
        + headline
        + ". The proof is on the canvas: the rebuilt hex and txid are compared "
        "against the originals.\n\n"
        f"**Inputs ({len(vin)}):**\n" + "\n".join(in_lines) + "\n\n"
        f"**Outputs ({len(vout)}):**\n" + "\n".join(out_lines) + "\n"
        + fee_line
        + "\nEdit any constant node and the whole flow recomputes."
    )


def _relax_verification(dataset: dict, i: int) -> str | None:
    """Smallest standardness-only flag exclusion that validates input ``i``.

    Historical signatures (high-S, pre-BIP66 DER) fail today's standardness
    flags while remaining consensus-valid. Returns a comma list for the verify
    node's ``exclude_flags`` field, or None if no whitelisted set helps.
    """
    import json as _json

    from calc_functions.calc_func import script_verification

    inp = dataset["vin"][i]
    for flags in _RELAXABLE_FLAG_SETS:
        try:
            result = _json.loads(
                script_verification(
                    [
                        inp["scriptsig_hex"],
                        inp["prev_scriptpubkey"],
                        dataset["tx_hex"],
                        str(i),
                        flags,
                        "",
                    ]
                )
            )
        except Exception:
            return None
        if result.get("isValid"):
            return flags
    return None


def _run_flow(flow: dict):
    import graph_logic  # local import: heavy deps, only needed here

    calc_nodes = [n for n in flow["nodes"] if n.get("data", {}).get("functionName")]
    valid = {n["id"] for n in calc_nodes}
    calc_edges = [
        e for e in flow["edges"] if e["source"] in valid and e["target"] in valid
    ]
    updated, errors = graph_logic.bulk_calculate_logic(
        copy.deepcopy(calc_nodes), calc_edges
    )
    return {n["id"]: n for n in updated}, errors


_DOWNGRADE = {"sign": "wire", "wire": "raw", "raw": "raw"}


def generate_legacy_flow(dataset: dict) -> dict:
    """Build the flow, run it through the engine, and gate on byte equality.

    Inputs start in the richest mode their data supports (sign → wire → raw)
    and are downgraded independently whenever their rebuilt scriptSig differs
    from the wire bytes — e.g. a foreign signer whose nonce isn't low-R RFC6979
    keeps its wire signature instead. The returned flow always carries fully
    computed results and reproduces ``tx_hex`` exactly; otherwise
    ``UnsupportedTransaction`` is raised.
    """
    modes: dict[int, str] = {
        i: _auto_mode(inp) for i, inp in enumerate(dataset["vin"])
    }
    raw_out: set[int] = set()
    # worst case every input walks sign → wire → raw
    for _attempt in range(2 * len(dataset["vin"]) + 2):
        flow, refs = build_legacy_flow(
            dataset,
            input_modes=modes,
            raw_spk_outputs=frozenset(raw_out),
        )
        node_map, errors = _run_flow(flow)
        if errors:
            if any(m != "raw" for m in modes.values()) or len(raw_out) < len(
                dataset["vout"]
            ):
                modes = {i: "raw" for i in modes}
                raw_out = set(range(len(dataset["vout"])))
                continue
            raise UnsupportedTransaction(
                f"the rebuilt flow failed to compute: {errors[:3]}"
            )

        final_hex = node_map[refs.final_tx]["data"].get("result")
        if final_hex == dataset["tx_hex"]:
            # Historical signatures: relax standardness-only verification flags
            # for inputs whose wire signature fails today's rules, then re-run.
            relax = {
                i: flags
                for i, nid in refs.verify.items()
                if node_map[nid]["data"].get("result") == "false"
                and (flags := _relax_verification(dataset, i))
            }
            if relax:
                flow, refs = build_legacy_flow(
                    dataset,
                    input_modes=modes,
                    raw_spk_outputs=frozenset(raw_out),
                    verify_exclude_flags=relax,
                )
                node_map, errors = _run_flow(flow)
                if (
                    errors
                    or node_map[refs.final_tx]["data"].get("result")
                    != dataset["tx_hex"]
                ):
                    raise UnsupportedTransaction(
                        "internal error: verification relaxation broke the rebuild."
                    )
            computed = {n["id"]: n["data"] for n in node_map.values()}
            for node in flow["nodes"]:
                if node["id"] in computed:
                    node["data"] = computed[node["id"]]
            return flow

        # Targeted downgrade: any block whose bytes differ from the wire steps
        # down one mode; if nothing changed there is no further fallback.
        changed = False
        for i, nid in refs.scriptsig.items():
            if (
                node_map[nid]["data"].get("result")
                != dataset["vin"][i]["scriptsig_hex"]
                and modes[i] != "raw"
            ):
                modes[i] = _DOWNGRADE[modes[i]]
                changed = True
        for j, nid in refs.spk.items():
            if (
                j not in raw_out
                and node_map[nid]["data"].get("result")
                != dataset["vout"][j]["scriptpubkey"]
            ):
                raw_out.add(j)
                changed = True
        if not changed:
            raise UnsupportedTransaction(
                "rebuilt bytes do not match the original transaction."
            )
    raise UnsupportedTransaction(
        "rebuilt bytes do not match the original transaction."
    )
