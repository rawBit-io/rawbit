import os
import sys
import hashlib
import logging
import struct
import binascii
import json
import secrets
from datetime import datetime
from typing import Any, Union, List, Sequence

from ecdsa import SigningKey, SECP256k1, ellipticcurve
import secp256k1

import re
_WS_RE = re.compile(r"\s+")

from decimal import Decimal, InvalidOperation, getcontext
getcontext().prec = 50  # plenty for money math

_INT_DEC_RE = re.compile(r'^[+-]?\d+$', re.ASCII)

_CURVE_ORDER = SECP256k1.order
_CURVE_GEN = SECP256k1.generator
_CURVE_P = SECP256k1.curve.p()

from bitcointx.core import CTransaction, CTxOut, b2x
from bitcointx.core.script import CScript
from bitcointx.core.scripteval import (
    VerifyScriptWithTrace 
)

from bitcointx.core.scripteval import (
    # flag constants
    SCRIPT_VERIFY_P2SH,
    SCRIPT_VERIFY_WITNESS,
    SCRIPT_VERIFY_CLEANSTACK,
    SCRIPT_VERIFY_DERSIG,
    SCRIPT_VERIFY_LOW_S,
    SCRIPT_VERIFY_STRICTENC,
    SCRIPT_VERIFY_NULLDUMMY,
    SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY,
    SCRIPT_VERIFY_CHECKSEQUENCEVERIFY,
    SCRIPT_VERIFY_MINIMALDATA,
    SCRIPT_VERIFY_SIGPUSHONLY,
    SCRIPT_VERIFY_MINIMALIF,
    SCRIPT_VERIFY_NULLFAIL,
    SCRIPT_VERIFY_DISCOURAGE_UPGRADABLE_NOPS,
    SCRIPT_VERIFY_DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM,
    SCRIPT_VERIFY_CONST_SCRIPTCODE,
    SCRIPT_VERIFY_WITNESS_PUBKEYTYPE,
    SCRIPT_VERIFY_TAPROOT,
    # convenience sets
    STANDARD_SCRIPT_VERIFY_FLAGS,
    UNHANDLED_SCRIPT_VERIFY_FLAGS,
)

# ===== ADDRESS ENCODING HELPERS (Base58Check + Bech32/Bech32m) =====
# Pure-Python, dependency-free. 

# --- Base58 / Base58Check -------------------------------------------------
_B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_B58_IDX = {c: i for i, c in enumerate(_B58_ALPHABET)}

def _b58encode(data: bytes) -> str:
    if not data:
        return ""
    num = int.from_bytes(data, "big")
    out = ""
    while num > 0:
        num, rem = divmod(num, 58)
        out = _B58_ALPHABET[rem] + out
    # preserve leading zero bytes as '1'
    pad = len(data) - len(data.lstrip(b"\x00"))
    return "1" * pad + out

def _b58decode(s: str) -> bytes:
    if not s:
        return b""
    num = 0
    for ch in s:
        if ch not in _B58_IDX:
            raise ValueError(f"Invalid Base58 character: '{ch}'")
        num = num * 58 + _B58_IDX[ch]
    # convert back to bytes
    full = num.to_bytes((num.bit_length() + 7) // 8, "big") if num else b""
    # restore leading '1' → 0x00
    pad = len(s) - len(s.lstrip("1"))
    return b"\x00" * pad + full


def _b58check_encode(versioned_payload: bytes) -> str:
    chk = hashlib.sha256(hashlib.sha256(versioned_payload).digest()).digest()[:4]
    return _b58encode(versioned_payload + chk)

def _b58check_decode(s: str) -> bytes:
    raw = _b58decode(s)
    if len(raw) < 5:
        raise ValueError("Invalid Base58Check length")
    payload, checksum = raw[:-4], raw[-4:]
    calc = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    if checksum != calc:
        raise ValueError("Invalid Base58Check checksum")
    return payload  # includes version byte at payload[0]

# --- Bech32 / Bech32m (BIP-173 / BIP-350) --------------------------------
_BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
_BECH32_IDX = {c: i for i, c in enumerate(_BECH32_CHARSET)}
_BECH32M_CONST = 0x2bc830a3

def _bech32_hrp_expand(hrp: str) -> list[int]:
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]

def _bech32_polymod(values: list[int]) -> int:
    GEN = (0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3)
    chk = 1
    for v in values:
        b = chk >> 25
        chk = ((chk & 0x1ffffff) << 5) ^ v
        for i in range(5):
            if (b >> i) & 1:
                chk ^= GEN[i]
    return chk

def _bech32_create_checksum(hrp: str, data: list[int], const: int) -> list[int]:
    vals = _bech32_hrp_expand(hrp) + data
    pm = _bech32_polymod(vals + [0, 0, 0, 0, 0, 0]) ^ const
    return [(pm >> 5 * (5 - i)) & 31 for i in range(6)]

def _convertbits(data: bytes | list[int], frombits: int, tobits: int, pad: bool) -> list[int]:
    acc = 0
    bits = 0
    ret: list[int] = []
    maxv = (1 << tobits) - 1
    max_acc = (1 << (frombits + tobits - 1)) - 1
    for b in data:
        if isinstance(b, bool):
            b = int(b)
        if b < 0 or (b >> frombits):
            raise ValueError("convertbits: invalid value")
        acc = ((acc << frombits) | b) & max_acc
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad:
        if bits:
            ret.append((acc << (tobits - bits)) & maxv)
    elif bits >= frombits or ((acc << (tobits - bits)) & maxv):
        raise ValueError("convertbits: invalid padding")
    return ret

def _bech32_encode(hrp: str, witver: int, prog: bytes) -> str:
    if not (0 <= witver <= 16):
        raise ValueError("Invalid witness version")
    if witver == 0 and len(prog) not in (20, 32):
        raise ValueError("v0 program must be 20 or 32 bytes")
    if not (2 <= len(prog) <= 40):
        # BIP-173/350 allow 2..40 (v0 restricted by rule above)
        raise ValueError("Invalid witness program length")
    # choose checksum constant
    const = 1 if witver == 0 else _BECH32M_CONST
    data = [witver] + _convertbits(prog, 8, 5, True)
    checksum = _bech32_create_checksum(hrp, data, const)
    return hrp + "1" + "".join(_BECH32_CHARSET[d] for d in (data + checksum))

def _bech32_decode(addr: str) -> tuple[str, int, bytes]:
    if any(ord(c) < 33 or ord(c) > 126 for c in addr):
        raise ValueError("Invalid Bech32 characters")
    if addr != addr.lower() and addr != addr.upper():
        raise ValueError("Mixed case not allowed")
    addr = addr.lower()
    pos = addr.rfind("1")
    if pos < 1 or pos + 7 > len(addr) or len(addr) > 90:
        raise ValueError("Invalid Bech32 position/length")
    hrp = addr[:pos]
    data = [ _BECH32_IDX.get(c, -1) for c in addr[pos+1:] ]
    if any(x == -1 for x in data):
        raise ValueError("Invalid Bech32 charset")
    if len(data) < 7:
        raise ValueError("Bech32 data too short")
    witver = data[0]
    payload = data[:-6]
    checksum = data[-6:]
    # verify checksum with both constants depending on version
    const = 1 if witver == 0 else _BECH32M_CONST
    calc = _bech32_create_checksum(hrp, payload, const)
    if calc != checksum:
        raise ValueError("Invalid Bech32 checksum")
    prog = bytes(_convertbits(payload[1:], 5, 8, False))
    if not (2 <= len(prog) <= 40):
        raise ValueError("Invalid witness program length")
    if witver == 0 and len(prog) not in (20, 32):
        raise ValueError("Invalid v0 program length")
    return hrp, witver, prog

def _hrp_for_network(selectedNetwork: str) -> str:
    return {
        "mainnet": "bc",
        "testnet": "tb",
        "regtest": "bcrt",
    }.get(selectedNetwork, "bcrt")
# ===== END ADDRESS ENCODING HELPERS =====


# ===== CONTEXT REUSE OPTIMIZATION =====
import atexit, threading
from functools import lru_cache

# Contexts reused per process
_SECP256K1_SIGN = None
_SECP256K1_VERIFY = None
_INIT_LOCK = threading.Lock()
_SIGN_LOCK = threading.Lock()
_VERIFY_LOCK = threading.Lock()

def _get_sign_ctx():
    global _SECP256K1_SIGN
    if _SECP256K1_SIGN is None:
        with _INIT_LOCK:
            if _SECP256K1_SIGN is None:
                SECP256K1_CONTEXT_SIGN = (1 << 0) | (1 << 9)
                ctx = secp256k1.lib.secp256k1_context_create(SECP256K1_CONTEXT_SIGN)
                # Randomize sign context once (side-channel hardening)
                seed = os.urandom(32)
                seed_c = secp256k1.ffi.new("unsigned char[32]", seed)
                secp256k1.lib.secp256k1_context_randomize(ctx, seed_c)
                _SECP256K1_SIGN = ctx
    return _SECP256K1_SIGN

def _get_verify_ctx():
    global _SECP256K1_VERIFY
    if _SECP256K1_VERIFY is None:
        with _INIT_LOCK:
            if _SECP256K1_VERIFY is None:
                SECP256K1_CONTEXT_VERIFY = (1 << 0) | (1 << 8)
                _SECP256K1_VERIFY = secp256k1.lib.secp256k1_context_create(SECP256K1_CONTEXT_VERIFY)
    return _SECP256K1_VERIFY

@atexit.register
def _destroy_ctxs():
    for ctx_ref_name in ("_SECP256K1_SIGN", "_SECP256K1_VERIFY"):
        ctx = globals().get(ctx_ref_name)
        if ctx:
            secp256k1.lib.secp256k1_context_destroy(ctx)
            globals()[ctx_ref_name] = None
# ===== END CONTEXT REUSE =====

# ===== TRANSACTION CACHE OPTIMIZATION =====
@lru_cache(maxsize=2048)
def _deserialize_tx_cached(raw_hex: str) -> CTransaction:
    """Cache parsed transactions to avoid redundant deserialization."""
    return CTransaction.deserialize(bytes.fromhex(raw_hex))
# ===== END TRANSACTION CACHE =====

# ----------------------------------------------------------------------
# Small util: validate & decode even-length hex strings
# ----------------------------------------------------------------------


def _bytes_from_even_hex(h: str, *, name: str = "value") -> bytes:
    # Remove spaces/tabs/newlines anywhere; optionally allow 0x prefix
    cleaned = _WS_RE.sub("", h)
    if cleaned.lower().startswith("0x"):
        cleaned = cleaned[2:]

    if len(cleaned) % 2:
        raise ValueError(
            f"{name} must have an *even* number of hex characters (got {len(cleaned)})"
        )
    try:
        return bytes.fromhex(cleaned)
    except ValueError as e:
        raise ValueError(f"{name} is not valid hexadecimal") from e

# ----------------------------------------------------------------------
# Tagged hash + Schnorr/Taproot helpers
# ----------------------------------------------------------------------
_TAG_HASH_CACHE: dict[str, bytes] = {}


def _tagged_hash_bytes(tag: str, data: bytes) -> bytes:
    """Return tagged_hash(tag, data) bytes."""
    if not isinstance(tag, str) or not tag:
        raise ValueError("Tag must be a non-empty string")

    tag_hash = _TAG_HASH_CACHE.get(tag)
    if tag_hash is None:
        t = hashlib.sha256(tag.encode("utf-8")).digest()
        _TAG_HASH_CACHE[tag] = t
        tag_hash = t
    return hashlib.sha256(tag_hash + tag_hash + data).digest()


def tagged_hash(vals: list[str]) -> str:
    """
    Compute a tagged hash: SHA256(SHA256(tag)||SHA256(tag)||data).

    vals[0]: tag (string)
    vals[1]: data (hex)
    """
    if len(vals) < 2:
        raise ValueError("Need [tag, dataHex]")
    tag = str(vals[0]).strip()
    data = _bytes_from_even_hex(vals[1], name="data")
    return _tagged_hash_bytes(tag, data).hex()


def _int_to_32(v: int) -> bytes:
    return v.to_bytes(32, "big")


def _lift_x(x: int) -> ellipticcurve.Point:
    """Lift x-only pubkey to full point with even Y (BIP340)."""
    if not (0 <= x < _CURVE_P):
        raise ValueError("X coordinate out of range")
    alpha = (pow(x, 3, _CURVE_P) + 7) % _CURVE_P
    beta = pow(alpha, (_CURVE_P + 1) // 4, _CURVE_P)  # p % 4 == 3
    if (beta * beta - alpha) % _CURVE_P != 0:
        raise ValueError("X coordinate is not on secp256k1")
    y = beta if beta % 2 == 0 else _CURVE_P - beta
    return ellipticcurve.Point(SECP256k1.curve, x, y)


def _negate_point(pt: ellipticcurve.Point) -> ellipticcurve.Point:
    return ellipticcurve.Point(SECP256k1.curve, pt.x(), (-pt.y()) % _CURVE_P)


def _point_to_compressed(pt: ellipticcurve.Point) -> bytes:
    prefix = b"\x02" if (pt.y() & 1) == 0 else b"\x03"
    return prefix + _int_to_32(pt.x())


def _point_from_compressed(comp: bytes) -> ellipticcurve.Point:
    if len(comp) != 33:
        raise ValueError("Compressed point must be 33 bytes")
    prefix = comp[0]
    if prefix not in (2, 3):
        raise ValueError("Compressed point must start with 0x02 or 0x03")
    x = int.from_bytes(comp[1:], "big")
    pt = _lift_x(x)  # even-Y
    if (pt.y() & 1) != (prefix & 1):
        pt = _negate_point(pt)
    return pt

def _bip340_challenge(r_x: bytes, pub_x: bytes, msg: bytes) -> int:
    return int.from_bytes(
        _tagged_hash_bytes("BIP0340/challenge", r_x + pub_x + msg),
        "big",
    ) % _CURVE_ORDER


def _derive_even_pub(seckey_int: int) -> tuple[ellipticcurve.Point, int]:
    """Return (point with even Y, adjusted secret) per BIP340 rules."""
    pt = _CURVE_GEN * seckey_int
    if pt.y() & 1:
        seckey_int = (_CURVE_ORDER - seckey_int) % _CURVE_ORDER
        pt = _CURVE_GEN * seckey_int
    return pt, seckey_int


def xonly_pubkey_from_private_key(val: str) -> str:
    """
    Derive x-only public key and parity-adjusted secret.

    Returns JSON with:
      - xonly_pubkey (32B hex)
      - parity (0 even, 1 odd before adjustment)
      - secret_key (hex, adjusted so pubkey has even Y)
    """
    priv_bytes = _bytes_from_even_hex(val, name="private key")
    if len(priv_bytes) != 32:
        raise ValueError("Private key must be exactly 32 bytes (64 hex characters)")
    d = int.from_bytes(priv_bytes, "big")
    if not 1 <= d < _CURVE_ORDER:
        raise ValueError("Private key integer must be in the range [1, n-1]")

    pt = _CURVE_GEN * d
    parity = pt.y() & 1
    if parity:
        d = (_CURVE_ORDER - d) % _CURVE_ORDER
        pt = _CURVE_GEN * d

    result = {
        "xonly_pubkey": _int_to_32(pt.x()).hex(),
        "parity": parity,
        "secret_key": _int_to_32(d).hex(),
    }
    return json.dumps(result)


def xonly_pubkey(val: str) -> str:
    """
    Derive x-only public key (uses the input key as-is; no parity adjustment).
    """
    priv_bytes = _bytes_from_even_hex(val, name="private key")
    if len(priv_bytes) != 32:
        raise ValueError("Private key must be exactly 32 bytes (64 hex characters)")
    d = int.from_bytes(priv_bytes, "big")
    if not 1 <= d < _CURVE_ORDER:
        raise ValueError("Private key integer must be in the range [1, n-1]")
    pt = _CURVE_GEN * d
    return _int_to_32(pt.x()).hex()


def even_y_private_key(val: str) -> str:
    """
    Return parity-adjusted secret key (n - d if original Y is odd).
    """
    priv_bytes = _bytes_from_even_hex(val, name="private key")
    if len(priv_bytes) != 32:
        raise ValueError("Private key must be exactly 32 bytes (64 hex characters)")
    d = int.from_bytes(priv_bytes, "big")
    if not 1 <= d < _CURVE_ORDER:
        raise ValueError("Private key integer must be in the range [1, n-1]")
    pt = _CURVE_GEN * d
    if pt.y() & 1:
        d = (_CURVE_ORDER - d) % _CURVE_ORDER
    return _int_to_32(d).hex()


def p2tr_address_from_xonly(val: str, selectedNetwork: str = "regtest") -> str:
    """
    Build Taproot bech32m address from 32-byte x-only pubkey.
    """
    xonly = _bytes_from_even_hex(val, name="x-only pubkey")
    if len(xonly) != 32:
        raise ValueError("x-only pubkey must be exactly 32 bytes")
    hrp = _hrp_for_network(selectedNetwork)
    return _bech32_encode(hrp, 1, xonly)


def taproot_tweak_xonly_pubkey(vals: list[str]) -> str:
    """
    TapTweak: output key Q = P + H(P||merkle_root)G (public/verifier side, JSON bundle).

    vals[0]: internal x-only pubkey (32 bytes)
    vals[1]: optional merkle root (32 bytes) or empty for key-path only
    """
    if len(vals) < 1:
        raise ValueError("Need at least [internalXOnlyPubKeyHex]")
    xonly = _bytes_from_even_hex(vals[0], name="x-only pubkey")
    if len(xonly) != 32:
        raise ValueError("x-only pubkey must be 32 bytes")
    merkle_root = b""
    if len(vals) > 1 and str(vals[1]).strip():
        merkle_root = _bytes_from_even_hex(vals[1], name="merkle root")
        if len(merkle_root) != 32:
            raise ValueError("Merkle root must be 32 bytes when provided")

    internal_pt = _lift_x_from_bytes(xonly)
    tweak_bytes = _tagged_hash_bytes("TapTweak", xonly + merkle_root)
    tweak_int = int.from_bytes(tweak_bytes, "big")
    if tweak_int >= _CURVE_ORDER:
        raise ValueError("TapTweak scalar must be less than curve order")
    output_pt = internal_pt + (_CURVE_GEN * tweak_int)
    if output_pt == ellipticcurve.INFINITY:
        raise ValueError("Invalid tweak: resulting point at infinity")

    output_parity = output_pt.y() & 1
    return json.dumps(
        {
            "internal_xonly_pubkey": xonly.hex(),
            "tweak": tweak_bytes.hex(),
            "output_xonly_pubkey": _int_to_32(output_pt.x()).hex(),
            "output_parity": output_parity,
        }
    )


def taproot_tweaked_privkey(vals: list[str]) -> str:
    """
    Return tweaked (even-Y) secret key for Taproot key-path signing.
    """
    if len(vals) < 1:
        raise ValueError("Need at least [internalSecretKeyHex]")
    sk_bytes = _bytes_from_even_hex(vals[0], name="internal secret key")
    if len(sk_bytes) != 32:
        raise ValueError("Internal secret key must be 32 bytes")
    merkle_root = b""
    if len(vals) > 1 and str(vals[1]).strip():
        merkle_root = _bytes_from_even_hex(vals[1], name="merkle root")
        if len(merkle_root) != 32:
            raise ValueError("Merkle root must be 32 bytes when provided")

    d = int.from_bytes(sk_bytes, "big")
    if not 1 <= d < _CURVE_ORDER:
        raise ValueError("Secret key integer must be in the range [1, n-1]")

    internal_pt, d_even = _derive_even_pub(d)
    tweak_bytes = _tagged_hash_bytes("TapTweak", _int_to_32(internal_pt.x()) + merkle_root)
    tweak_int = int.from_bytes(tweak_bytes, "big")
    if tweak_int >= _CURVE_ORDER:
        raise ValueError("TapTweak scalar must be less than curve order")
    output_sk = (d_even + tweak_int) % _CURVE_ORDER
    if output_sk == 0:
        raise ValueError("Invalid tweak: resulting secret key is zero")

    # Ensure even-Y output key by flipping secret if needed
    output_pt = _CURVE_GEN * output_sk
    if output_pt.y() & 1:
        output_sk = (_CURVE_ORDER - output_sk) % _CURVE_ORDER

    return _int_to_32(output_sk).hex()


def taproot_output_pubkey_from_xonly(vals: list[str]) -> str:
    """
    Return Taproot output x-only pubkey Q from an internal x-only pubkey.
    """
    if len(vals) < 1:
        raise ValueError("Need at least [internalXOnlyPubKeyHex]")
    xonly = _bytes_from_even_hex(vals[0], name="x-only pubkey")
    if len(xonly) != 32:
        raise ValueError("x-only pubkey must be 32 bytes")
    merkle_root = b""
    if len(vals) > 1 and str(vals[1]).strip():
        merkle_root = _bytes_from_even_hex(vals[1], name="merkle root")
        if len(merkle_root) != 32:
            raise ValueError("Merkle root must be 32 bytes when provided")

    internal_pt = _lift_x_from_bytes(xonly)
    tweak_bytes = _tagged_hash_bytes("TapTweak", xonly + merkle_root)
    tweak_int = int.from_bytes(tweak_bytes, "big")
    if tweak_int >= _CURVE_ORDER:
        raise ValueError("TapTweak scalar must be less than curve order")
    output_pt = internal_pt + (_CURVE_GEN * tweak_int)
    if output_pt == ellipticcurve.INFINITY:
        raise ValueError("Invalid tweak: resulting point at infinity")

    return _int_to_32(output_pt.x()).hex()


def _tapbranch_hash(left_hash: bytes, right_hash: bytes) -> bytes:
    if len(left_hash) != 32 or len(right_hash) != 32:
        raise ValueError("TapBranch hashes must be 32 bytes each")
    left, right = sorted([left_hash, right_hash])
    return _tagged_hash_bytes("TapBranch", left + right)


def taproot_tree_builder(vals: list) -> str:
    """
    Build a Taproot taptree from TapLeaf hashes.

    vals[0+]: leaf hashes (hex, 32 bytes each, TapLeaf already applied).

    Merkle root construction:
    - Pair left-to-right at each level.
    - For each pair, compute TapBranch(tagged_hash("TapBranch", min||max)).
    - If a level has an odd node, carry it up unchanged.
    - Repeat until one hash remains (the merkle root).

    Returns JSON with:
        {
          "root": "<merkle root hex>",
          "leafCount": <int>,
          "leafHashes": ["<hex>", ...],
          "leafLabels": ["A", "B", ...],
          "paths": [["<hex>", ...], ...],  # merkle path for each leaf (bottom-up)
          "pathLabels": [["B", "C"], ...],
          "structure": "((A,B),C)",
          "display": "<ascii tree + paths>"
        }
    """
    if not vals:
        raise ValueError("Provide at least one leaf hash")

    leaf_hash_inputs = [str(v).strip() for v in vals]
    if any(h == "" for h in leaf_hash_inputs):
        raise ValueError("Leaf hashes cannot be empty")

    leaf_hashes = []
    for idx, leaf_hex in enumerate(leaf_hash_inputs):
        leaf_bytes = _bytes_from_even_hex(leaf_hex, name=f"leaf hash {idx}")
        if len(leaf_bytes) != 32:
            raise ValueError("Leaf hashes must be 32 bytes (64 hex characters)")
        leaf_hashes.append(leaf_bytes)
    leaf_count = len(leaf_hashes)
    paths: list[list[bytes]] = [[] for _ in range(leaf_count)]
    path_labels: list[list[str]] = [[] for _ in range(leaf_count)]

    def label_for_index(index: int) -> str:
        alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        label = ""
        n = index
        while True:
            n, rem = divmod(n, 26)
            label = alphabet[rem] + label
            if n == 0:
                break
            n -= 1
        return label

    leaf_labels = [label_for_index(i) for i in range(leaf_count)]
    nodes = [
        {"hash": leaf_hashes[i], "leaves": [i], "label": leaf_labels[i]}
        for i in range(leaf_count)
    ]
    levels: list[list[str]] = [leaf_labels[:]]

    while len(nodes) > 1:
        next_nodes = []
        next_level_labels: list[str] = []
        for idx in range(0, len(nodes), 2):
            if idx + 1 >= len(nodes):
                next_nodes.append(nodes[idx])
                next_level_labels.append(nodes[idx]["label"])
                continue

            left = nodes[idx]
            right = nodes[idx + 1]
            for leaf_idx in left["leaves"]:
                paths[leaf_idx].append(right["hash"])
                path_labels[leaf_idx].append(right["label"])
            for leaf_idx in right["leaves"]:
                paths[leaf_idx].append(left["hash"])
                path_labels[leaf_idx].append(left["label"])

            branch_hash = _tapbranch_hash(left["hash"], right["hash"])
            branch_label = f"({left['label']},{right['label']})"
            next_nodes.append(
                {
                    "hash": branch_hash,
                    "leaves": left["leaves"] + right["leaves"],
                    "label": branch_label,
                }
            )
            next_level_labels.append(branch_label)

        nodes = next_nodes
        levels.append(next_level_labels)

    root_hash = nodes[0]["hash"]
    structure = nodes[0]["label"]

    leaf_hashes_hex = [h.hex() for h in leaf_hashes]
    paths_hex = [[h.hex() for h in path] for path in paths]
    path_labels_serialized = [labels[:] for labels in path_labels]

    display_lines = [
        "Tree:",
        structure,
        "",
        "Levels:",
    ]
    for idx, level in enumerate(levels):
        display_lines.append(f"L{idx}: {'  '.join(level)}")
    display_lines.extend(
        [
            "",
            "Leaves:",
        ]
    )
    for idx, h in enumerate(leaf_hashes_hex):
        display_lines.append(f"{leaf_labels[idx]} = {h}")
    display_lines.append("")
    display_lines.append("Paths (labels):")
    for idx, labels in enumerate(path_labels_serialized):
        display_lines.append(
            f"{leaf_labels[idx]}: {', '.join(labels) if labels else '(none)'}"
        )
    display_lines.append("")
    display_lines.append("Paths (hashes):")
    for idx, path in enumerate(paths_hex):
        display_lines.append(
            f"{leaf_labels[idx]}: {', '.join(path) if path else '(none)'}"
        )

    return json.dumps(
        {
            "root": root_hash.hex(),
            "leafCount": leaf_count,
            "leafHashes": leaf_hashes_hex,
            "leafLabels": leaf_labels,
            "paths": paths_hex,
            "pathLabels": path_labels_serialized,
            "structure": structure,
            "display": "\n".join(display_lines),
        }
    )


def _bip340_sign(seckey: bytes, msg: bytes, aux: bytes) -> bytes:
    if len(seckey) != 32 or len(msg) != 32 or len(aux) != 32:
        raise ValueError("seckey, msg, and aux must be 32 bytes each")
    d = int.from_bytes(seckey, "big")
    if not 1 <= d < _CURVE_ORDER:
        raise ValueError("Secret key integer must be in the range [1, n-1]")

    pub_pt, d_even = _derive_even_pub(d)
    d_bytes = _int_to_32(d_even)
    t = bytes(a ^ b for a, b in zip(d_bytes, _tagged_hash_bytes("BIP0340/aux", aux)))

    k = int.from_bytes(
        _tagged_hash_bytes("BIP0340/nonce", t + _int_to_32(pub_pt.x()) + msg),
        "big",
    ) % _CURVE_ORDER
    if k == 0:
        raise ValueError("Nonce generation failed (k == 0)")

    R = _CURVE_GEN * k
    if R.y() & 1:
        k = (_CURVE_ORDER - k) % _CURVE_ORDER
        R = _CURVE_GEN * k

    r_bytes = _int_to_32(R.x())
    e = _bip340_challenge(r_bytes, _int_to_32(pub_pt.x()), msg)
    s = (k + e * d_even) % _CURVE_ORDER
    return r_bytes + _int_to_32(s)


def schnorr_sign_bip340(vals: list[str]) -> str:
    """
    Create a 64-byte BIP340 Schnorr signature.

    vals[0]: private key hex (32 bytes)
    vals[1]: message hash hex (32 bytes)
    vals[2]: optional aux_rand hex (32 bytes). Defaults to 0x00..00 for determinism.
    """
    if len(vals) < 2:
        raise ValueError("Need [privateKeyHex, msg32Hex, auxRandHex?]")
    seckey = _bytes_from_even_hex(vals[0], name="private key")
    msg = _bytes_from_even_hex(vals[1], name="message hash")
    if len(seckey) != 32:
        raise ValueError("Private key must be 32 bytes")
    if len(msg) != 32:
        raise ValueError("Message hash must be 32 bytes")
    aux = b"\x00" * 32
    if len(vals) > 2 and str(vals[2]).strip():
        aux = _bytes_from_even_hex(vals[2], name="aux_rand")
        if len(aux) != 32:
            raise ValueError("aux_rand must be 32 bytes when provided")
    sig = _bip340_sign(seckey, msg, aux)
    return sig.hex()


def _lift_x_from_bytes(xonly: bytes) -> ellipticcurve.Point:
    if len(xonly) != 32:
        raise ValueError("x-only pubkey must be 32 bytes")
    return _lift_x(int.from_bytes(xonly, "big"))


def schnorr_verify_bip340(vals: list[str]) -> str:
    """
    Verify a 64-byte BIP340 Schnorr signature.

    vals[0]: x-only public key hex (32 bytes)
    vals[1]: message hash hex (32 bytes)
    vals[2]: signature hex (64 bytes)
    """
    if len(vals) < 3:
        raise ValueError("Need [xonlyPubKeyHex, msg32Hex, sig64Hex]")
    pub_bytes = _bytes_from_even_hex(vals[0], name="x-only pubkey")
    msg = _bytes_from_even_hex(vals[1], name="message hash")
    sig = _bytes_from_even_hex(vals[2], name="signature")
    if len(pub_bytes) != 32 or len(msg) != 32 or len(sig) != 64:
        raise ValueError("x-only pubkey, msg, and signature must be 32, 32, 64 bytes")

    r = int.from_bytes(sig[:32], "big")
    s = int.from_bytes(sig[32:], "big")
    if r >= _CURVE_P or s >= _CURVE_ORDER:
        return "false"

    try:
        P = _lift_x_from_bytes(pub_bytes)
    except ValueError:
        return "false"

    e = _bip340_challenge(sig[:32], pub_bytes, msg)
    sG = _CURVE_GEN * s
    eP = P * e
    R = sG + _negate_point(eP)

    if R == ellipticcurve.INFINITY:
        return "false"
    if R.y() & 1:
        return "false"
    return "true" if R.x() == r else "false"


def taproot_sighash_default(vals: list[str]) -> str:
    """
    Compute BIP341 key-path (SIGHASH_DEFAULT) digest.

    vals[0]: raw transaction hex
    vals[1]: input index (int)
    vals[2]: input amounts (JSON array or comma-separated sats for *all* inputs)
    vals[3]: input scriptPubKeys (JSON array or comma-separated hex for *all* inputs)
    """
    if len(vals) < 4:
        raise ValueError("Need [txHex, inputIndex, amounts[], scriptPubKeys[]]")

    tx_hex = (vals[0] or "").strip()
    if not tx_hex:
        raise ValueError("Transaction hex cannot be empty")
    try:
        tx = _deserialize_tx_cached(tx_hex)
    except Exception as e:
        raise ValueError(f"Invalid transaction hex: {e}")

    input_index = int(vals[1])
    vin = list(tx.vin)  # type: ignore[arg-type]
    vout = list(tx.vout)  # type: ignore[arg-type]
    if input_index < 0 or input_index >= len(vin):
        raise ValueError(f"Input index {input_index} out of range (have {len(vin)})")

    def _parse_list(raw_val, expected_len: int, name: str):
        if raw_val is None:
            raise ValueError(f"{name} cannot be empty")
        raw_str = str(raw_val).strip()
        if not raw_str:
            raise ValueError(f"{name} cannot be empty")
        parsed = None
        try:
            parsed = json.loads(raw_str)
            if not isinstance(parsed, list):
                parsed = None
        except Exception:
            parsed = None
        if parsed is None:
            parsed = [item.strip() for item in raw_str.split(",") if item.strip()]
        if len(parsed) != expected_len:
            raise ValueError(f"{name} must have {expected_len} entries, got {len(parsed)}")
        return parsed

    amounts_raw = _parse_list(vals[2], len(vin), "amounts")
    scriptpubkeys_raw = _parse_list(vals[3], len(vin), "scriptPubKeys")

    try:
        amounts = [int(a) for a in amounts_raw]
    except Exception:
        raise ValueError("All amounts must be integers (satoshis)")

    scriptpubkeys = []
    for idx, spk in enumerate(scriptpubkeys_raw):
        spk_bytes = _bytes_from_even_hex(str(spk), name=f"scriptPubKey[{idx}]")
        scriptpubkeys.append(spk_bytes)

    def _ser_varint(n: int) -> bytes:
        return bytes.fromhex(encode_varint(n))

    # === Sub-hashes ===
    prevouts_ser = b"".join(
        txin.prevout.serialize()  # type: ignore[attr-defined]
        if hasattr(txin.prevout, "serialize")
        else bytes(txin.prevout.hash) + struct.pack("<I", txin.prevout.n)
        for txin in vin
    )
    sha_prevouts = hashlib.sha256(prevouts_ser).digest()

    sha_amounts = hashlib.sha256(
        b"".join(struct.pack("<Q", amt) for amt in amounts)
    ).digest()

    sha_scriptpubkeys = hashlib.sha256(
        b"".join(_ser_varint(len(spk)) + spk for spk in scriptpubkeys)
    ).digest()

    sha_sequences = hashlib.sha256(
        b"".join(struct.pack("<I", txin.nSequence) for txin in vin)
    ).digest()

    outputs_ser = b"".join(
        struct.pack("<Q", txout.nValue)
        + _ser_varint(len(bytes(txout.scriptPubKey)))
        + bytes(txout.scriptPubKey)
        for txout in vout
    )
    sha_outputs = hashlib.sha256(outputs_ser).digest()

    # === SigMsg (SIGHASH_DEFAULT, ext_flag=0, no annex, no ACP) ===
    hash_type = 0x00
    spend_type = 0x00  # ext_flag*2 + annex_present
    sigmsg = (
        bytes([hash_type])
        + struct.pack("<I", tx.nVersion)
        + struct.pack("<I", tx.nLockTime)
        + sha_prevouts
        + sha_amounts
        + sha_scriptpubkeys
        + sha_sequences
        + sha_outputs
        + bytes([spend_type])
        + struct.pack("<I", input_index)
    )

    preimage = b"\x00" + sigmsg  # epoch = 0x00
    sighash = _tagged_hash_bytes("TapSighash", preimage).hex()

    return json.dumps(
        {
            "sighash": sighash,
            "hash_type": hash_type,
            "sha_prevouts": sha_prevouts.hex(),
            "sha_amounts": sha_amounts.hex(),
            "sha_scriptpubkeys": sha_scriptpubkeys.hex(),
            "sha_sequences": sha_sequences.hex(),
            "sha_outputs": sha_outputs.hex(),
            "spend_type": spend_type,
            "input_index": input_index,
            "preimage": preimage.hex(),
        }
    )

def _musig2_is_infinite(pt: Any) -> bool:
    return pt == ellipticcurve.INFINITY


def _point_from_compressed_ext(comp: bytes, *, name: str = "point") -> Any:
    if len(comp) != 33:
        raise ValueError(f"{name} must be 33 bytes")
    if comp == b"\x00" * 33:
        return ellipticcurve.INFINITY
    return _point_from_compressed(comp)


def _point_to_compressed_ext(pt: Any) -> bytes:
    if _musig2_is_infinite(pt):
        return b"\x00" * 33
    return _point_to_compressed(pt)


def _musig2_keyagg_details(pubkeys_hex: list[str]) -> dict:
    if len(pubkeys_hex) < 1:
        raise ValueError("Provide at least one compressed pubkey")

    plain_list: list[bytes] = []
    points: list[Any] = []
    for i, pk_hex in enumerate(pubkeys_hex):
        pk = _bytes_from_even_hex(pk_hex, name=f"pubkey[{i}]")
        if len(pk) != 33:
            raise ValueError(f"pubkey[{i}] must be 33 bytes (got {len(pk)})")
        P = _point_from_compressed(pk)
        plain_list.append(pk)
        points.append(P)

    u = len(plain_list)
    L = _tagged_hash_bytes("KeyAgg list", b"".join(plain_list))

    pk2 = b"\x00" * 33
    for j in range(1, u):
        if plain_list[j] != plain_list[0]:
            pk2 = plain_list[j]
            break

    coeffs_info: list[dict] = []
    coeffs: list[int] = []
    agg_pt: Any = ellipticcurve.INFINITY

    for i, (pk_i, P_i) in enumerate(zip(plain_list, points)):
        if pk_i == pk2:
            a_i = 1
            is_second = True
        else:
            a_i = int.from_bytes(
                _tagged_hash_bytes("KeyAgg coefficient", L + pk_i), "big"
            ) % _CURVE_ORDER
            is_second = False

        agg_pt = agg_pt + (P_i * a_i)
        coeffs.append(a_i)
        coeffs_info.append(
            {
                "pubkey_compressed": pk_i.hex(),
                "pubkey_xonly": _int_to_32(P_i.x()).hex(),
                "coefficient": hex(a_i),
                "is_second_key": is_second,
            }
        )

    if _musig2_is_infinite(agg_pt):
        raise ValueError("Key aggregation resulted in point at infinity")

    return {
        "plain_list": plain_list,
        "points": points,
        "coeffs": coeffs,
        "coeffs_info": coeffs_info,
        "agg_pt": agg_pt,
        "L": L,
        "pk2": pk2,
        "num_pubkeys": u,
    }


def _musig2_coeff_for_pubkey(details: dict, signer_pk: bytes) -> int:
    for i, pk in enumerate(details["plain_list"]):
        if pk == signer_pk:
            return details["coeffs"][i]
    raise ValueError("Signer pubkey not found in pubkeys list")


def musig2_aggregate_pubkeys(vals: list[str]) -> str:
    """
    BIP327 KeyAgg for compressed pubkeys.

    Inputs: list of 33-byte compressed pubkeys (hex).
    Returns JSON with aggregate x-only pubkey and debugging details.
    """
    pubkeys_hex = [str(v).strip() for v in vals if str(v).strip()]
    details = _musig2_keyagg_details(pubkeys_hex)

    agg_pt = details["agg_pt"]
    agg_parity = 0 if agg_pt.y() % 2 == 0 else 1
    agg_xonly = _int_to_32(agg_pt.x()).hex()

    return json.dumps({
        "aggregated_pubkey": agg_xonly,
        "parity":            agg_parity,
        "gacc":              "01",
        "tacc":              "00" * 32,
        "coefficients":      details["coeffs_info"],
        "L":                 details["L"].hex(),
        "second_key":        details["pk2"].hex() if details["pk2"] != b"\x00" * 33 else "none",
        "num_pubkeys":       details["num_pubkeys"],
    })


def _musig2_apply_tweak_to_point(
    agg_pt: ellipticcurve.Point, tweak_bytes: bytes
) -> tuple[ellipticcurve.Point, int, int]:
    """
    BIP327 ApplyTweak for a single Taproot x-only tweak.

    Returns (Q, gacc, tacc), where Q keeps its actual parity.
    """
    gacc = 1
    tacc = 0
    Q = agg_pt

    if not tweak_bytes:
        return Q, gacc, tacc
    if len(tweak_bytes) != 32:
        raise ValueError("Taproot tweak must be 32 bytes")

    t = int.from_bytes(tweak_bytes, "big")
    if t >= _CURVE_ORDER:
        raise ValueError("Taproot tweak must be less than curve order")

    g = 1 if (Q.y() & 1) == 0 else (_CURVE_ORDER - 1)
    gQ = Q if g == 1 else _negate_point(Q)
    Q_prime = gQ + (_CURVE_GEN * t)
    if _musig2_is_infinite(Q_prime):
        raise ValueError("Tweaked key is point at infinity")

    gacc = (g * gacc) % _CURVE_ORDER
    tacc = (t + (g * tacc)) % _CURVE_ORDER
    return Q_prime, gacc, tacc


def _musig2_nonce_coeff(aggnonce: bytes, agg_xonly: bytes, msg: bytes) -> int:
    return int.from_bytes(
        _tagged_hash_bytes("MuSig/noncecoef", aggnonce + agg_xonly + msg),
        "big",
    ) % _CURVE_ORDER


def _musig2_get_session_values(
    aggnonce: bytes,
    msg: bytes,
    details: dict,
    tweak_bytes: bytes,
) -> dict:
    if len(aggnonce) != 66:
        raise ValueError("Aggnonce must be 66 bytes")

    Q, gacc, tacc = _musig2_apply_tweak_to_point(details["agg_pt"], tweak_bytes)
    agg_xonly = _int_to_32(Q.x())

    b = _musig2_nonce_coeff(aggnonce, agg_xonly, msg)
    R1 = _point_from_compressed_ext(aggnonce[:33], name="aggnonce R1")
    R2 = _point_from_compressed_ext(aggnonce[33:], name="aggnonce R2")
    R_prime = R1 + (R2 * b)
    R = _CURVE_GEN if _musig2_is_infinite(R_prime) else R_prime

    e = _bip340_challenge(_int_to_32(R.x()), agg_xonly, msg)
    return {
        "Q": Q,
        "gacc": gacc,
        "tacc": tacc,
        "b": b,
        "R": R,
        "e": e,
        "agg_xonly": agg_xonly,
    }


def _musig2_partial_sig_verify_internal(
    partial_sig: int,
    signer_pubnonce: bytes,
    signer_pubkey: bytes,
    details: dict,
    session: dict,
) -> bool:
    if len(signer_pubnonce) != 66:
        raise ValueError("Signer pubnonce must be 66 bytes")
    if len(signer_pubkey) != 33:
        raise ValueError("Signer pubkey must be 33 bytes")
    if partial_sig >= _CURVE_ORDER:
        return False

    b = session["b"]
    R = session["R"]
    Q = session["Q"]
    e = session["e"]
    gacc = session["gacc"]

    R1_i = _point_from_compressed(signer_pubnonce[:33])
    R2_i = _point_from_compressed(signer_pubnonce[33:])
    R_i = R1_i + (R2_i * b)
    Re_i = R_i if (R.y() & 1) == 0 else _negate_point(R_i)

    P_i = _point_from_compressed(signer_pubkey)
    a_i = _musig2_coeff_for_pubkey(details, signer_pubkey)
    g = 1 if (Q.y() & 1) == 0 else (_CURVE_ORDER - 1)

    lhs = _CURVE_GEN * partial_sig
    rhs = Re_i + (P_i * ((e * a_i * g * gacc) % _CURVE_ORDER))
    return lhs == rhs


def musig2_nonce_gen(vals: list[str]) -> str:
    """
    Generate MuSig2 nonces (BIP327 NonceGen).

    Accepted call layouts:
      - Flow layout: [sk, aggpk, msg, rand, pk, extra_in?]
      - Spec-like:   [sk?, pk, aggpk?, msg?, rand, extra_in?]
    """
    if len(vals) < 2:
        raise ValueError("Need [secretKey?, signerPubKey, aggpk?, msg?, rand?, extra_in?]")

    def _parse_optional_hex(raw: Any, *, name: str) -> bytes | None:
        if raw is None:
            return None
        if isinstance(raw, str):
            candidate = raw.strip()
            if candidate == "":
                return None
            return _bytes_from_even_hex(candidate, name=name)
        return _bytes_from_even_hex(str(raw), name=name)

    def _looks_like_compressed_pubkey(raw: Any) -> bool:
        b = _parse_optional_hex(raw, name="pubkey")
        return b is not None and len(b) == 33 and b[0] in (2, 3)

    spec_order = _looks_like_compressed_pubkey(vals[1])
    if spec_order:
        sk_raw = vals[0] if len(vals) > 0 else None
        pk_raw = vals[1] if len(vals) > 1 else None
        aggpk_raw = vals[2] if len(vals) > 2 else None
        msg_raw = vals[3] if len(vals) > 3 else None
        rand_raw = vals[4] if len(vals) > 4 else None
        extra_in_raw = vals[5] if len(vals) > 5 else None
    else:
        sk_raw = vals[0] if len(vals) > 0 else None
        aggpk_raw = vals[1] if len(vals) > 1 else None
        msg_raw = vals[2] if len(vals) > 2 else None
        rand_raw = vals[3] if len(vals) > 3 else None
        pk_raw = vals[4] if len(vals) > 4 else None
        extra_in_raw = vals[5] if len(vals) > 5 else None

    seckey = _parse_optional_hex(sk_raw, name="secret key")
    d: int | None = None
    if seckey is not None:
        if len(seckey) != 32:
            raise ValueError("Secret key must be 32 bytes")
        d = int.from_bytes(seckey, "big")
        if not 1 <= d < _CURVE_ORDER:
            raise ValueError("Secret key integer must be in the range [1, n-1]")

    pk_bytes = _parse_optional_hex(pk_raw, name="signer pubkey")
    if pk_bytes is None and d is not None:
        pk_bytes = _point_to_compressed(_CURVE_GEN * d)
    if pk_bytes is None:
        raise ValueError("Signer pubkey is required")
    if len(pk_bytes) != 33:
        raise ValueError("Signer pubkey must be 33 bytes")
    _point_from_compressed(pk_bytes)

    if d is not None:
        signer_from_sk = _CURVE_GEN * d
        if _point_to_compressed(signer_from_sk) != pk_bytes:
            raise ValueError("Signer pubkey does not match secret key")

    aggpk = _parse_optional_hex(aggpk_raw, name="aggregate pubkey")
    if aggpk is not None and len(aggpk) != 32:
        raise ValueError("Aggregate pubkey must be 32 bytes")
    aggpk_bytes = aggpk if aggpk is not None else b""

    has_msg = msg_raw is not None
    msg = b""
    if has_msg:
        if isinstance(msg_raw, str):
            msg = _bytes_from_even_hex(msg_raw, name="message")
        else:
            msg = _bytes_from_even_hex(str(msg_raw), name="message")
    msg_prefixed = (
        b"\x01" + len(msg).to_bytes(8, "big") + msg if has_msg else b"\x00"
    )

    extra_in = _parse_optional_hex(extra_in_raw, name="extra input")
    extra_bytes = extra_in if extra_in is not None else b""
    if len(extra_bytes) > 0xFFFFFFFF:
        raise ValueError("extra input cannot exceed 2^32-1 bytes")

    rand_input = _parse_optional_hex(rand_raw, name="rand")
    if rand_input is None:
        raise ValueError("rand input is required")
    rand_prime = rand_input
    if len(rand_prime) != 32:
        raise ValueError("rand must be 32 bytes")

    if seckey is not None:
        rand = bytes(a ^ b for a, b in zip(seckey, _tagged_hash_bytes("MuSig/aux", rand_prime)))
    else:
        rand = rand_prime

    seed = (
        rand
        + bytes([len(pk_bytes)])
        + pk_bytes
        + bytes([len(aggpk_bytes)])
        + aggpk_bytes
        + msg_prefixed
        + len(extra_bytes).to_bytes(4, "big")
        + extra_bytes
    )

    k1 = int.from_bytes(_tagged_hash_bytes("MuSig/nonce", seed + b"\x00"), "big") % _CURVE_ORDER
    k2 = int.from_bytes(_tagged_hash_bytes("MuSig/nonce", seed + b"\x01"), "big") % _CURVE_ORDER
    if k1 == 0 or k2 == 0:
        raise ValueError("Nonce generation failed (k == 0)")

    R1 = _CURVE_GEN * k1
    R2 = _CURVE_GEN * k2

    pubnonce = _point_to_compressed(R1) + _point_to_compressed(R2)
    secnonce = _int_to_32(k1) + _int_to_32(k2) + pk_bytes

    return json.dumps(
        {
            "pubnonce": pubnonce.hex(),
            "secnonce": secnonce.hex(),
        }
    )


def musig2_nonce_agg(vals: list[str]) -> str:
    """
    Aggregate MuSig2 pubnonces.

    vals: list of pubnonces (66B hex each)
    Returns: aggnonce (66B hex)
    """
    pubnonces_hex = [str(v).strip() for v in vals if str(v).strip()]
    if len(pubnonces_hex) < 1:
        raise ValueError("Provide at least one pubnonce")

    agg_R1: Any = ellipticcurve.INFINITY
    agg_R2: Any = ellipticcurve.INFINITY

    for i, pn_hex in enumerate(pubnonces_hex):
        pn = _bytes_from_even_hex(pn_hex, name=f"pubnonce[{i}]")
        if len(pn) != 66:
            raise ValueError(f"pubnonce[{i}] must be 66 bytes")
        R1 = _point_from_compressed(pn[:33])
        R2 = _point_from_compressed(pn[33:])
        agg_R1 = agg_R1 + R1
        agg_R2 = agg_R2 + R2

    aggnonce = _point_to_compressed_ext(agg_R1) + _point_to_compressed_ext(agg_R2)
    return aggnonce.hex()


def musig2_partial_sign(vals: list[str]) -> str:
    """
    Create a MuSig2 partial signature.

    Inputs:
      vals[0]: secret key (32B hex)
      vals[1]: secnonce (97B hex)
      vals[2]: aggnonce (66B hex)
      vals[3]: message (hex)
      vals[4]: taproot tweak (32B hex, optional)
      vals[5:]: compressed pubkeys list (33B hex each)

    Returns: partial_sig (32B hex)
    """
    if len(vals) < 5:
        raise ValueError("Need [secretKey, secnonce, aggnonce, msg, tweak?, pubkeys...]")

    seckey = _bytes_from_even_hex(vals[0], name="secret key")
    secnonce = _bytes_from_even_hex(vals[1], name="secnonce")
    aggnonce = _bytes_from_even_hex(vals[2], name="aggnonce")
    msg = _bytes_from_even_hex(vals[3], name="message")
    if len(seckey) != 32:
        raise ValueError("Secret key must be 32 bytes")
    if len(secnonce) != 97:
        raise ValueError("Secnonce must be 97 bytes")
    if len(aggnonce) != 66:
        raise ValueError("Aggnonce must be 66 bytes")

    tweak_bytes = b""
    if len(vals) > 4 and str(vals[4]).strip():
        tweak_bytes = _bytes_from_even_hex(vals[4], name="taproot tweak")

    pubkeys_hex = [
        str(v).strip().lower() for v in vals[5:] if str(v).strip()
    ]
    details = _musig2_keyagg_details(pubkeys_hex)

    d_prime = int.from_bytes(seckey, "big")
    if not 1 <= d_prime < _CURVE_ORDER:
        raise ValueError("Secret key integer must be in the range [1, n-1]")

    signer_pt = _CURVE_GEN * d_prime
    signer_pk = _point_to_compressed(signer_pt)
    if signer_pk != secnonce[64:97]:
        raise ValueError("Secnonce does not match secret key pubkey")

    k1_prime = int.from_bytes(secnonce[:32], "big")
    k2_prime = int.from_bytes(secnonce[32:64], "big")
    if not (1 <= k1_prime < _CURVE_ORDER) or not (1 <= k2_prime < _CURVE_ORDER):
        raise ValueError("Secnonce contains invalid scalar")

    sess = _musig2_get_session_values(aggnonce, msg, details, tweak_bytes)
    R = sess["R"]
    Q = sess["Q"]
    b = sess["b"]
    e = sess["e"]
    gacc = sess["gacc"]

    if (R.y() & 1) == 0:
        k1 = k1_prime
        k2 = k2_prime
    else:
        k1 = (_CURVE_ORDER - k1_prime) % _CURVE_ORDER
        k2 = (_CURVE_ORDER - k2_prime) % _CURVE_ORDER

    a_i = _musig2_coeff_for_pubkey(details, signer_pk)
    g = 1 if (Q.y() & 1) == 0 else (_CURVE_ORDER - 1)
    d = (g * gacc * d_prime) % _CURVE_ORDER
    s_i = (k1 + (b * k2) + (e * a_i * d)) % _CURVE_ORDER

    signer_pubnonce = _point_to_compressed(_CURVE_GEN * k1_prime) + _point_to_compressed(
        _CURVE_GEN * k2_prime
    )
    if not _musig2_partial_sig_verify_internal(
        s_i, signer_pubnonce, signer_pk, details, sess
    ):
        raise ValueError("Internal partial signature verification failed")

    return _int_to_32(s_i).hex()


def musig2_partial_sig_verify(vals: list[str]) -> str:
    """
    Verify one MuSig2 partial signature.

    Inputs:
      vals[0]: partial sig (32B hex)
      vals[1]: signer pubnonce (66B hex)
      vals[2]: signer compressed pubkey (33B hex)
      vals[3]: aggnonce (66B hex)
      vals[4]: message (hex)
      vals[5]: taproot tweak (32B hex, optional)
      vals[6:]: compressed pubkeys list (33B hex each, KeyAgg order)

    Returns: "true" or "false"
    """
    if len(vals) < 7:
        raise ValueError(
            "Need [partialSig, signerPubnonce, signerPubKey, aggnonce, msg, tweak?, pubkeys...]"
        )

    partial_sig_bytes = _bytes_from_even_hex(vals[0], name="partial signature")
    if len(partial_sig_bytes) != 32:
        raise ValueError("Partial signature must be 32 bytes")
    partial_sig = int.from_bytes(partial_sig_bytes, "big")

    signer_pubnonce = _bytes_from_even_hex(vals[1], name="signer pubnonce")
    if len(signer_pubnonce) != 66:
        raise ValueError("Signer pubnonce must be 66 bytes")

    signer_pubkey = _bytes_from_even_hex(vals[2], name="signer pubkey")
    if len(signer_pubkey) != 33:
        raise ValueError("Signer pubkey must be 33 bytes")
    _point_from_compressed(signer_pubkey)

    aggnonce = _bytes_from_even_hex(vals[3], name="aggnonce")
    if len(aggnonce) != 66:
        raise ValueError("Aggnonce must be 66 bytes")

    msg = _bytes_from_even_hex(vals[4], name="message")

    tweak_bytes = b""
    if len(vals) > 5 and str(vals[5]).strip():
        tweak_bytes = _bytes_from_even_hex(vals[5], name="taproot tweak")

    pubkeys_hex = [
        str(v).strip().lower() for v in vals[6:] if str(v).strip()
    ]
    if len(pubkeys_hex) < 1:
        raise ValueError("Provide at least one compressed pubkey")

    details = _musig2_keyagg_details(pubkeys_hex)

    # Wiring mistake if signer key is not included in the same ordered key list.
    _musig2_coeff_for_pubkey(details, signer_pubkey)

    sess = _musig2_get_session_values(aggnonce, msg, details, tweak_bytes)
    ok = _musig2_partial_sig_verify_internal(
        partial_sig, signer_pubnonce, signer_pubkey, details, sess
    )
    return "true" if ok else "false"


def musig2_partial_sig_agg(vals: list[str]) -> str:
    """
    Aggregate MuSig2 partial signatures into a final Schnorr signature.

    Inputs:
      vals[0]: aggnonce (66B hex)
      vals[1]: message (hex)
      vals[2]: taproot tweak (32B hex, optional)
      vals[3:]: first half = compressed pubkeys, second half = partial sigs

    Returns: signature (64B hex)
    """
    if len(vals) < 5:
        raise ValueError("Need [aggnonce, msg, tweak?, pubkeys..., partialSigs...]")

    aggnonce = _bytes_from_even_hex(vals[0], name="aggnonce")
    msg = _bytes_from_even_hex(vals[1], name="message")
    if len(aggnonce) != 66:
        raise ValueError("Aggnonce must be 66 bytes")

    tweak_bytes = b""
    if len(vals) > 2 and str(vals[2]).strip():
        tweak_bytes = _bytes_from_even_hex(vals[2], name="taproot tweak")

    remaining = [str(v).strip() for v in vals[3:]]
    if len(remaining) % 2 != 0:
        raise ValueError("Pubkeys and partial sigs must be provided in equal counts")
    half = len(remaining) // 2
    pubkeys_hex = [v.lower() for v in remaining[:half]]
    sigs_hex = remaining[half:]

    if len(pubkeys_hex) < 1:
        raise ValueError("Provide at least one pubkey and partial sig")
    if any(not v for v in pubkeys_hex) or any(not v for v in sigs_hex):
        raise ValueError("Pubkeys and partial sigs cannot be empty")

    details = _musig2_keyagg_details(pubkeys_hex)
    sess = _musig2_get_session_values(aggnonce, msg, details, tweak_bytes)
    Q = sess["Q"]
    tacc = sess["tacc"]
    R = sess["R"]
    e = sess["e"]

    s = 0
    for i, sig_hex in enumerate(sigs_hex):
        sb = _bytes_from_even_hex(sig_hex, name=f"partial_sig[{i}]")
        if len(sb) != 32:
            raise ValueError(f"partial_sig[{i}] must be 32 bytes")
        s_i = int.from_bytes(sb, "big")
        if s_i >= _CURVE_ORDER:
            raise ValueError(f"partial_sig[{i}] must be less than curve order")
        s = (s + s_i) % _CURVE_ORDER

    g = 1 if (Q.y() & 1) == 0 else (_CURVE_ORDER - 1)
    s = (s + (e * g * tacc)) % _CURVE_ORDER

    return (_int_to_32(R.x()) + _int_to_32(s)).hex()


def musig2_apply_tweak(vals: list[str]) -> str:
    """
    BIP327 ApplyTweak — update a key_agg_ctx with a tweak.

    vals[0]: key_agg_ctx JSON (output of musig2_aggregate_pubkeys)
    vals[1]: tweak (32-byte hex — from taproot_tweak_xonly_pubkey .tweak)
    vals[2]: is_xonly ("true" for Taproot x-only tweak, "false" for plain)

    BIP327 algorithm:
      if is_xonly and Q has odd Y:  g = −1 mod n
      else:                         g =  1
      Q' = g·Q + t·G
      gacc' = g · gacc  mod n
      tacc' = t + g·tacc mod n          ← NOTE: g, NOT gacc

    Returns updated key_agg_ctx JSON with all original fields preserved
    plus new debug fields (pre_tweak_pubkey, g_value, etc.).

    On canvas, Sign and SigAgg nodes recompute this internally
    from the tweak bytes and pubkey list. This function is mainly for demonstration and testing of the BIP327 formulas.
    """
    if len(vals) < 3:
        raise ValueError("Need [key_agg_ctx_json, tweak_hex, is_xonly]")

    ctx = json.loads(str(vals[0]).strip())
    tweak_bytes = _bytes_from_even_hex(vals[1], name="tweak")
    if len(tweak_bytes) != 32:
        raise ValueError("Tweak must be 32 bytes")
    is_xonly = str(vals[2]).strip().lower() in ("true", "1", "yes")

    t = int.from_bytes(tweak_bytes, "big")
    if t >= _CURVE_ORDER:
        raise ValueError("Tweak is not a valid scalar (≥ curve order)")

    # ── Recover current aggregate point Q ─────────────────────────────
    Q_xonly = bytes.fromhex(ctx["aggregated_pubkey"])
    Q = _lift_x_from_bytes(Q_xonly)          # always even Y
    if ctx["parity"] == 1:
        Q = _negate_point(Q)                 # restore actual parity

    # ── Parse accumulators ────────────────────────────────────────────
    gacc_raw = ctx["gacc"]
    # gacc is stored compactly: "01" for 1, or full 32-byte hex
    if len(gacc_raw) <= 2:
        gacc = int(gacc_raw, 16)
    else:
        gacc = int.from_bytes(bytes.fromhex(gacc_raw), "big")
    gacc = gacc % _CURVE_ORDER

    tacc = int.from_bytes(bytes.fromhex(ctx["tacc"]), "big") % _CURVE_ORDER

    # ── BIP327 ApplyTweak ─────────────────────────────────────────────
    Q_has_even_y = (Q.y() % 2 == 0)
    if is_xonly and not Q_has_even_y:
        g = _CURVE_ORDER - 1                # −1 mod n
    else:
        g = 1

    # Q' = g·Q + t·G
    gQ = Q if g == 1 else _negate_point(Q)
    Q_prime = gQ + (_CURVE_GEN * t)
    if Q_prime == ellipticcurve.INFINITY:
        raise ValueError("Tweaked key is point at infinity")

    # Update accumulators (BIP327 formulas)
    gacc_new = (g * gacc) % _CURVE_ORDER
    tacc_new = (t + g * tacc) % _CURVE_ORDER

    parity_new = 0 if Q_prime.y() % 2 == 0 else 1

    # ── Build output ──────────────────────────────────────────────────
    result = dict(ctx)                       # preserve original fields
    result.update({
        "aggregated_pubkey": _int_to_32(Q_prime.x()).hex(),
        "parity":            parity_new,
        "gacc":              _int_to_32(gacc_new).hex(),
        "tacc":              _int_to_32(tacc_new).hex(),
        # ── debug fields ──
        "tweak_applied": tweak_bytes.hex(),
        "tweak_mode":    "xonly" if is_xonly else "plain",
        "pre_tweak_pubkey": Q_xonly.hex(),
        "pre_tweak_parity": ctx["parity"],
        "g_value":       "1" if g == 1 else "-1",
    })
    return json.dumps(result)



def schnorr_batch_verify_demo(vals: list[str]) -> str:
    """
    Demonstrate batch verify combination for BIP340 signatures.

    vals: flattened list [pk1, msg1, sig1, pk2, msg2, sig2, ...]
    Returns combined scalar (left side) and combined point (right side).
    """
    if len(vals) % 3 != 0 or len(vals) == 0:
        raise ValueError("Provide triples of [xonlyPubKeyHex, msg32Hex, sig64Hex]")

    triples = []
    for i in range(0, len(vals), 3):
        pk = _bytes_from_even_hex(vals[i], name=f"pubkey[{i//3}]")
        msg = _bytes_from_even_hex(vals[i + 1], name=f"message[{i//3}]")
        sig = _bytes_from_even_hex(vals[i + 2], name=f"signature[{i//3}]")
        if len(pk) != 32 or len(msg) != 32 or len(sig) != 64:
            raise ValueError("Each triple must be 32-byte pk, 32-byte msg, 64-byte sig")
        triples.append((pk, msg, sig))

    left_scalar = 0
    right_pt: ellipticcurve.Point | None = None
    weights = []

    for idx, (pk, msg, sig) in enumerate(triples):
        r = int.from_bytes(sig[:32], "big")
        s = int.from_bytes(sig[32:], "big")
        if r >= _CURVE_P or s >= _CURVE_ORDER:
            raise ValueError(f"Signature[{idx}] is out of range")

        P = _lift_x_from_bytes(pk)
        e = _bip340_challenge(sig[:32], pk, msg)
        # Deterministic weight per entry
        weight = int.from_bytes(
            _tagged_hash_bytes("BatchSchnorr", pk + sig + msg + struct.pack("<I", idx)),
            "big",
        ) % _CURVE_ORDER
        if weight == 0:
            weight = 1
        weights.append(weight)

        left_scalar = (left_scalar + weight * s) % _CURVE_ORDER

        R = _lift_x(r)
        term = (R + (P * e)) * weight
        right_pt = term if right_pt is None else right_pt + term

    if right_pt is None:
        raise ValueError("Batch combination failed")

    combined = {
        "left_scalar": hex(left_scalar),
        "right_xonly": _int_to_32(right_pt.x()).hex(),
        "right_parity": right_pt.y() & 1,
        "weights": weights,
    }
    return json.dumps(combined)



def identity(val: Any) -> Any:
    """Return the input value as-is."""
    return val


def concat_all(vals: list) -> str:
    """Concatenate all given values into a single string."""
    return "".join(str(v) for v in vals)


def random_256() -> str:
    """
    Return 256 bits (32 bytes) of valid secp256k1 private key as hex.
    Ensures the value is in range [1, n-1].
    """
    # secp256k1 curve order
    n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    
    while True:
        key_bytes = secrets.token_bytes(32)
        key_int = int.from_bytes(key_bytes, 'big')
        
        if 1 <= key_int < n:
            return key_bytes.hex()


# --------------------------------------------------------------------------------
# Public Key from Private Key (elliptic curve + compression)
# --------------------------------------------------------------------------------
def public_key_from_private_key(val: str) -> str:
    """
    Derive a **compressed** public key from a 32-byte private key.

    • Rejects odd-length / non-hex strings early  
    • Rejects keys outside [1, n-1] where *n* is the curve order
    """
    priv_bytes = _bytes_from_even_hex(val, name="private key")

    if len(priv_bytes) != 32:
        raise ValueError("Private key must be exactly 32 bytes (64 hex characters)")

    priv_int = int.from_bytes(priv_bytes, "big")
    curve_order = SECP256k1.order
    if not 1 <= priv_int < curve_order:
        raise ValueError("Private key integer must be in the range [1, n-1]")

    sk = SigningKey.from_string(priv_bytes, curve=SECP256k1)
    vk = sk.get_verifying_key()
    if vk is None:
        raise RuntimeError("verifying key is None")
    x, y = vk.to_string()[:32], vk.to_string()[32:]
    prefix = b"\x02" if (y[-1] & 1) == 0 else b"\x03"
    return (prefix + x).hex()



def uint32_to_little_endian_4_bytes(val: int) -> str:
    """
    Convert a 32-bit unsigned integer into 4-byte little-endian hex.
    
    Used for multiple Bitcoin transaction fields:
    - Version: Transaction version number (usually 1 or 2)
    - Locktime: Transaction time lock
      * < 500,000,000: Interpreted as block height
      * ≥ 500,000,000: Interpreted as Unix timestamp (seconds since 1970-01-01)
    - Vout: Output index in previous transaction (0-based)
    - Sequence: Input sequence number
      * 0xffffffff: Final, locktime disabled
      * 0xfffffffe: Locktime enabled, non-replaceable
      * < 0xfffffffe: RBF-signaling, locktime enabled
    
    Args:
        val: Integer value (0 to 4,294,967,295)
    
    Returns:
        4-byte little-endian hex string
        
    Examples:
        1 → "01000000"
        850000 → "50cf0c00" (block height for locktime)
        4294967295 → "ffffffff" (0xffffffff for sequence)
    """
    if val < 0 or val > 0xffffffff:
        raise ValueError(f"Value must be 0-4294967295, got {val}")
        
    packed = struct.pack("<I", val)  # 4 bytes in little-endian
    return packed.hex()



def encode_varint(val: int | str | None) -> str:
    if val == "" or val is None:
        return "00"
    if isinstance(val, str):
        val = int(val.strip())
    if val < 0:
        raise ValueError("VarInt cannot be negative")
    if val <= 0xfc:
        return f"{val:02x}"
    if val <= 0xffff:
        return "fd" + struct.pack("<H", val).hex()
    if val <= 0xffffffff:
        return "fe" + struct.pack("<I", val).hex()
    if val <= 0xffffffffffffffff:
        return "ff" + struct.pack("<Q", val).hex()
    raise ValueError("VarInt cannot exceed 2^64-1")



    
def reverse_txid_bytes(val: str) -> str:
    """
    Convert a human-readable TXID (big-endian) to the 32-byte little-endian form.
    """
    raw = _bytes_from_even_hex(val, name="txid")
    if len(raw) != 32:
        raise ValueError("TXID must be exactly 32 bytes (64 hex characters)")
    return raw[::-1].hex()


def satoshi_to_8_le(val: int) -> str:
    if val < 0 or val > 2**64 - 1:
        raise ValueError(f"Value must be 0 to {2**64-1}, got {val}")
    return struct.pack("<Q", val).hex()


def double_sha256_hex(val: str) -> str:
    """
    Perform SHA256(SHA256(val_bytes)) and return the digest hex.
    """
    raw = _bytes_from_even_hex(val, name="input")
    return hashlib.sha256(hashlib.sha256(raw).digest()).hexdigest()

def sign_as_bitcoin_core_low_r(vals: list[str]) -> str:
    """
    Return a DER-encoded ECDSA signature with low-R grinding, mimicking
    Bitcoin Core. Uses a reused secp256k1 context for performance.
    """
    if len(vals) < 2:
        raise ValueError("Need [privateKeyHex, messageHashHex]")

    priv_bytes = _bytes_from_even_hex(vals[0].strip(), name="private key")
    msg_bytes = _bytes_from_even_hex(vals[1].strip(), name="message hash")

    if len(priv_bytes) != 32 or len(msg_bytes) != 32:
        raise ValueError("Private key and message hash must be 32 bytes each")

    ctx = _get_sign_ctx()
    MAX_ATTEMPTS = 64

    with _SIGN_LOCK:
        priv_c = secp256k1.ffi.new("unsigned char[32]", priv_bytes)
        msg_c  = secp256k1.ffi.new("unsigned char[32]", msg_bytes)
        sig    = secp256k1.ffi.new("secp256k1_ecdsa_signature *")

        rfc6979 = secp256k1.ffi.addressof(
            secp256k1.lib, "secp256k1_nonce_function_rfc6979"
        )

        # First attempt (no extra entropy)
        if secp256k1.lib.secp256k1_ecdsa_sign(ctx, sig, msg_c,
                                              priv_c, rfc6979,
                                              secp256k1.ffi.NULL) != 1:
            raise RuntimeError("ECDSA sign failed")

        secp256k1.lib.secp256k1_ecdsa_signature_normalize(ctx, sig, sig)

        if _is_low_r(ctx, sig):
            return _serialize_der(ctx, sig)

        # Grind for low-R with limit
        counter = 0
        extra = secp256k1.ffi.new("unsigned char[32]", b"\x00" * 32)
        while counter < MAX_ATTEMPTS:  # Changed condition
            counter += 1
            _write_le32(extra, counter)
            if secp256k1.lib.secp256k1_ecdsa_sign(ctx, sig, msg_c,
                                                  priv_c, rfc6979, extra) != 1:
                raise RuntimeError(f"ECDSA sign failed (counter={counter})")

            secp256k1.lib.secp256k1_ecdsa_signature_normalize(ctx, sig, sig)

            if _is_low_r(ctx, sig):
                return _serialize_der(ctx, sig)
        
        # If we get here, we couldn't find low-R in reasonable attempts
        # Return the last signature anyway (it's valid, just not low-R)
        return _serialize_der(ctx, sig)
# Helper methods
def _write_le32(byte_array, val):
    """Write 32-bit 'val' into the first 4 bytes of 'byte_array' (little-endian)."""
    struct.pack_into("<I", secp256k1.ffi.buffer(byte_array), 0, val)


def _is_low_r(ctx, sig_ptr):
    """Check if signature has a 'low R' value (first byte of R < 0x80)."""
    compact = secp256k1.ffi.new("unsigned char[64]")
    ret = secp256k1.lib.secp256k1_ecdsa_signature_serialize_compact(ctx, compact, sig_ptr)
    if ret != 1:
        raise RuntimeError("Failed to serialize compact signature!")
    return compact[0] < 0x80


def _serialize_der(ctx, sig_ptr):
    """Serialize signature to DER format as hex string."""
    der_buf = secp256k1.ffi.new("unsigned char[72]")
    der_len_ptr = secp256k1.ffi.new("size_t *", 72)
    ret = secp256k1.lib.secp256k1_ecdsa_signature_serialize_der(ctx, der_buf, der_len_ptr, sig_ptr)
    if ret != 1:
        raise RuntimeError("Failed to serialize DER")
    der_len = der_len_ptr[0]
    buffer = secp256k1.ffi.buffer(der_buf, der_len)
    return binascii.hexlify(buffer).decode()


def hash160_hex(val: str) -> str:
    """
    HASH160 = RIPEMD160(SHA256(data)).
    """
    raw = _bytes_from_even_hex(val, name="input")
    return hashlib.new("ripemd160",
                       hashlib.sha256(raw).digest()
                      ).hexdigest()


def varint_encoded_byte_length(val: str) -> str:
    """
    Return the VarInt-encoded byte length of the provided hex string.
    """
    length = len(_bytes_from_even_hex(val, name="input"))

    if length <= 0xfc:
        return f"{length:02x}"
    if length <= 0xffff:
        return "fd" + struct.pack("<H", length).hex()
    if length <= 0xffffffff:
        return "fe" + struct.pack("<I", length).hex()
    return "ff" + struct.pack("<Q", length).hex()


def _build_taproot_prevouts(extra_vals: Sequence[Any], expected_inputs: int) -> List[CTxOut]:
    """
    Build vin-ordered prevouts for Taproot verification from paired extra inputs:
    [amount_0, spk_0, amount_1, spk_1, ...]. Empty pairs are ignored.
    """
    outputs: List[CTxOut] = []
    for idx in range(0, len(extra_vals), 2):
        amt_raw = extra_vals[idx]
        spk_raw = extra_vals[idx + 1] if idx + 1 < len(extra_vals) else ""

        amt_str = str(amt_raw).strip() if amt_raw is not None else ""
        spk_str = str(spk_raw).strip() if spk_raw is not None else ""

        if not amt_str and not spk_str:
            continue  # skip empty slots
        if not amt_str or not spk_str:
            raise ValueError(f"taproot prevout[{idx//2}] needs both amount and scriptPubKey")

        try:
            amount_int = int(amt_str)
        except ValueError:
            raise ValueError(f"taproot prevout[{idx//2}].amount must be an integer")
        if amount_int < 0:
            raise ValueError(f"taproot prevout[{idx//2}].amount must be non-negative")

        spk_bytes = _bytes_from_even_hex(spk_str, name=f"taproot prevout[{idx//2}] scriptPubKey")
        outputs.append(CTxOut(amount_int, CScript(spk_bytes)))

    if outputs and expected_inputs and len(outputs) != expected_inputs:
        raise ValueError(
            f"Taproot prevouts must cover all inputs: expected {expected_inputs}, got {len(outputs)}"
        )

    return outputs


def script_verification(vals: list) -> str:
    """
    vals[0] – scriptSig hex
    vals[1] – scriptPubKey hex
    vals[2] – (optional) full raw transaction hex
    vals[3] – (optional) input index to verify; default = 0
    vals[4] – (optional) comma-separated flags to EXCLUDE from validation
    vals[5] – (optional) spent amount in satoshis (REQUIRED for SegWit/Taproot verification)
    vals[6+] – (optional, Taproot) per-vin prevouts: amount_0, scriptPubKey_0, amount_1, scriptPubKey_1, ...
    
    Available flags to exclude:
    - P2SH: Pay-to-Script-Hash validation (BIP16, activated 2012)
    - WITNESS: Segregated Witness validation (BIP141, activated 2017)
    - CLEANSTACK: Require exactly one stack item after execution
    - DERSIG: Strict DER signature encoding (BIP66)
    - LOW_S: Low S values in signatures (BIP146)
    - STRICTENC: Strict encoding for signatures and pubkeys
    - NULLDUMMY: OP_CHECKMULTISIG dummy element must be empty (BIP147)
    - CHECKLOCKTIMEVERIFY: Enable OP_CLTV (BIP65)
    - CHECKSEQUENCEVERIFY: Enable OP_CSV (BIP112)
    - DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM: Discourage unknown witness versions
    - WITNESS_PUBKEYTYPE: Witness pubkeys must be compressed
    - MINIMALDATA: Minimal push operation encoding
    - SIGPUSHONLY: Only push operations allowed in scriptSig
    - MINIMALIF: Minimal IF/NOTIF argument (only 0 or 1)
    - NULLFAIL: Signatures must be empty on failed checks
    - DISCOURAGE_UPGRADABLE_NOPS: Discourage use of NOPs reserved for upgrades
    - CONST_SCRIPTCODE: OP_CODESEPARATOR changes nothing in segwit
    - TAPROOT: Taproot validation (BIP341, activated 2021)
    
    Example combinations:
    - "WITNESS,CLEANSTACK" - See anyone-can-spend behavior
    - "P2SH" - Pre-2012 behavior
    - "WITNESS" - Pre-SegWit behavior (auto-excludes dependent flags)
    
    IMPORTANT: For SegWit/Taproot verification, you MUST provide the spent amount (vals[5])
    or verification will fail. Taproot spends with multiple inputs additionally
    require the full vin-ordered prevouts (vals[6]).
     ⚠️  Tip: If witness validation fails with the generic message
    “signature check failed, and signature is not empty”, **one possible
    cause** is that the amount you supplied here is off by even a single
    satoshi.
    
    Returns a JSON string with:
        {
          "isValid": <bool>,
          "steps": [ …opcode-by-opcode trace… ],
          "scriptSig": "<hex>",
          "scriptPubKey": "<hex>",
          "redeemScript": "<hex>",      # P2SH spends only
          "witnessScript": "<hex>",     # SegWit / Taproot script-path only
          "excludedFlags": ["..."],     # Which flags were excluded
          "activeFlags": ["..."],       # Which flags remain active
          "usesWitness": <bool>,        # Whether witness rules are active
          "amountUsed": <int>,          # Amount used in verification (if witness active)
          "error": "<message>"          # present only when isValid == False
        }
    """
    # Import at runtime to avoid type checking issues
    from typing import Any, Callable, cast
    import importlib

    # Ensure Taproot tagged hashers exist (needed for script-path verification)
    try:
        core_mod = importlib.import_module("bitcointx.core")

        def _make_tagged_hasher(tag: str) -> Callable[[bytes], bytes]:
            taghash = hashlib.sha256(tag.encode()).digest()

            def _hasher(msg: bytes) -> bytes:
                return hashlib.sha256(taghash + taghash + msg).digest()

            return staticmethod(_hasher)

        if not hasattr(core_mod.CoreCoinParams, "tap_sighash_hasher"):
            core_mod.CoreCoinParams.tap_sighash_hasher = _make_tagged_hasher(
                "TapSighash"
            )
        if not hasattr(core_mod.CoreCoinParams, "tapleaf_hasher"):
            core_mod.CoreCoinParams.tapleaf_hasher = _make_tagged_hasher("TapLeaf")
        if not hasattr(core_mod.CoreCoinParams, "tapbranch_hasher"):
            core_mod.CoreCoinParams.tapbranch_hasher = _make_tagged_hasher("TapBranch")
        if not hasattr(core_mod.CoreCoinParams, "taptweak_hasher"):
            core_mod.CoreCoinParams.taptweak_hasher = _make_tagged_hasher("TapTweak")
    except Exception:
        pass
    
    # Create explicit flag map for educational clarity
    FLAG_BY_NAME = {
        "P2SH": SCRIPT_VERIFY_P2SH,
        "WITNESS": SCRIPT_VERIFY_WITNESS,
        "CLEANSTACK": SCRIPT_VERIFY_CLEANSTACK,
        "DERSIG": SCRIPT_VERIFY_DERSIG,
        "LOW_S": SCRIPT_VERIFY_LOW_S,
        "STRICTENC": SCRIPT_VERIFY_STRICTENC,
        "NULLDUMMY": SCRIPT_VERIFY_NULLDUMMY,
        "CHECKLOCKTIMEVERIFY": SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY,
        "CHECKSEQUENCEVERIFY": SCRIPT_VERIFY_CHECKSEQUENCEVERIFY,
        "DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM": SCRIPT_VERIFY_DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM,
        "WITNESS_PUBKEYTYPE": SCRIPT_VERIFY_WITNESS_PUBKEYTYPE,
        "MINIMALDATA": SCRIPT_VERIFY_MINIMALDATA,
        "SIGPUSHONLY": SCRIPT_VERIFY_SIGPUSHONLY,
        "MINIMALIF": SCRIPT_VERIFY_MINIMALIF,
        "NULLFAIL": SCRIPT_VERIFY_NULLFAIL,
        "DISCOURAGE_UPGRADABLE_NOPS": SCRIPT_VERIFY_DISCOURAGE_UPGRADABLE_NOPS,
        "CONST_SCRIPTCODE": SCRIPT_VERIFY_CONST_SCRIPTCODE,
        "TAPROOT": SCRIPT_VERIFY_TAPROOT,
    }
    
    # ------------------------------------------------------------------
    # 1.  Parameter sanity
    # ------------------------------------------------------------------
    if len(vals) < 2:
        raise ValueError(
            "Need at least scriptSigHex and scriptPubKeyHex "
            "(optionally txHex, inputIndex, excludeFlags, and amount)."
        )

    scriptSig_hex    = (vals[0] or "").strip()
    scriptPubKey_hex = (vals[1] or "").strip()
    tx_hex           = (vals[2] or "").strip() if len(vals) > 2 else ""
    in_idx           = int(vals[3]) if len(vals) > 3 and str(vals[3]).strip() else 0
    exclude_flags    = (vals[4] or "").strip() if len(vals) > 4 else ""
    taproot_prevout_vals = vals[6:] if len(vals) > 6 else []

    if in_idx < 0:
        raise ValueError("Input index must be non-negative")
    
    # Parse actual amount for SegWit
    amount_param = 0
    amount_raw = str(vals[5]).strip() if len(vals) > 5 and vals[5] is not None else ""
    amount_supplied = bool(amount_raw)
    if amount_supplied:
        try:
            amount_param = int(amount_raw)
            # Validate amount is non-negative
            if amount_param < 0:
                raise ValueError("Amount must be non-negative")
        except ValueError as e:
            if "non-negative" in str(e):
                raise
            raise ValueError(f"Invalid amount value: '{vals[5]}' must be an integer (satoshis)")

    # ------------------------------------------------------------------
    # 2.  Provide a dummy tx if none was supplied
    # ------------------------------------------------------------------
    if not tx_hex:
        tx_hex = (
            "010000000001"  # version 1 | marker+flag
            "00"            # 0 inputs
            "00"            # 0 outputs
            "00000000"      # lock-time
        )

    try:
        tx = _deserialize_tx_cached(tx_hex)
    except Exception as e:
        raise ValueError(f"Invalid transaction hex: {str(e)}")

    # Normalize scripts up front for reuse
    script_sig_obj = CScript(_bytes_from_even_hex(scriptSig_hex, name="scriptSig"))
    script_pubkey_obj = CScript(_bytes_from_even_hex(scriptPubKey_hex, name="scriptPubKey"))

    # ------------------------------------------------------------------
    # 3.  Flags - Build as integer bitmask with STRICT validation
    # ------------------------------------------------------------------
    # Start with standard flags excluding unhandled
    flags = STANDARD_SCRIPT_VERIFY_FLAGS - UNHANDLED_SCRIPT_VERIFY_FLAGS
    
    # Always add these
    flags = flags.union({SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY, SCRIPT_VERIFY_CHECKSEQUENCEVERIFY})
    
    # Parse and remove excluded flags
    excluded_names = []
    
    if exclude_flags:
        for flag_name in exclude_flags.split(','):
            flag_name = flag_name.strip()
            if not flag_name:  # Skip empty strings
                continue
                
            # Convert to uppercase for matching
            flag_name_upper = flag_name.upper()
            
            if flag_name_upper in FLAG_BY_NAME:
                flag_value = FLAG_BY_NAME[flag_name_upper]
                flags.discard(flag_value)
                excluded_names.append(flag_name_upper)
            else:
                # STRICT VALIDATION: Raise immediately on unknown flag
                raise ValueError(
                    f"Unknown flag: '{flag_name}'. "
                    f"Valid flags are: {', '.join(sorted(FLAG_BY_NAME.keys()))}"
                )
    
    # Auto-clear dependent flags when WITNESS is excluded
    if "WITNESS" in excluded_names:
        dependent_flags = [
            "WITNESS_PUBKEYTYPE",
            "DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM"
        ]
        for dep_flag in dependent_flags:
            if dep_flag in FLAG_BY_NAME:
                flags.discard(FLAG_BY_NAME[dep_flag])
                if dep_flag not in excluded_names:
                    excluded_names.append(dep_flag)
    
    # Build list of active flags
    active_flags = sorted([name for name, value in FLAG_BY_NAME.items() if value in flags])
    # ------------------------------------------------------------------
    # 3.5  Extract witness AFTER flags are defined
    # ------------------------------------------------------------------
    witness_obj = None
    uses_witness = SCRIPT_VERIFY_WITNESS in flags
    
    if uses_witness and hasattr(tx, 'wit') and tx.wit is not None:
        try:
            # Cast to Any to bypass type checker
            wit = cast(Any, tx.wit)
            
            # Access vtxinwit which is a tuple
            if hasattr(wit, 'vtxinwit'):
                vtxinwit = wit.vtxinwit
                if in_idx < len(vtxinwit):
                    wit_item = vtxinwit[in_idx]
                    if hasattr(wit_item, 'scriptWitness'):
                        witness_obj = wit_item.scriptWitness
        except (AttributeError, IndexError, TypeError):
            # Continue with witness_obj = None
            pass

    is_witness_program = script_pubkey_obj.is_witness_scriptpubkey()
    wit_version = script_pubkey_obj.witness_version() if is_witness_program else None
    wit_program = script_pubkey_obj.witness_program() if is_witness_program else b""
    needs_taproot_prevouts = (
        uses_witness
        and SCRIPT_VERIFY_TAPROOT in flags
        and is_witness_program
        and wit_version == 1
        and len(wit_program) == 32
    )

    spent_outputs = _build_taproot_prevouts(taproot_prevout_vals, len(tx.vin))
    if needs_taproot_prevouts:
        if len(tx.vin) > 1 and not spent_outputs:
            raise ValueError(
                "Taproot verification for multi-input transactions requires vin-ordered prevouts "
                "(amount + scriptPubKey for each input). Add them in the Taproot prevouts section."
            )
        if not spent_outputs:
            spent_outputs = [CTxOut(amount_param, script_pubkey_obj)]

    # ------------------------------------------------------------------
    # 4.  Execute with tracing - include amount if witness active
    # ------------------------------------------------------------------
    amount = amount_param if uses_witness else 0
    if uses_witness and amount == 0 and spent_outputs is not None:
        try:
            amount = spent_outputs[in_idx].nValue
        except IndexError:
            pass

    is_valid, steps, err_msg = VerifyScriptWithTrace(
        script_sig_obj,
        script_pubkey_obj,
        tx,
        inIdx=in_idx,
        flags=flags,
        witness=witness_obj,
        amount=amount,
        spent_outputs=spent_outputs
    )

    # ------------------------------------------------------------------
    # 5.  Assemble JSON for the UI
    # ------------------------------------------------------------------
    result = {
        "isValid":      is_valid,
        "steps":        steps,
        "scriptSig":    scriptSig_hex,
        "scriptPubKey": scriptPubKey_hex,
        "excludedFlags": sorted(excluded_names),
        "activeFlags":   active_flags,
        "usesWitness":   uses_witness,  # For UI highlighting
    }
    
    # Add amount info if witness is active
    if uses_witness:
        result["amountUsed"] = amount

    # Surface the raw witness stack (useful for Taproot key-path flows)
    if uses_witness and witness_obj is not None:
        try:
            stack_items = getattr(witness_obj, "stack", [])
            if stack_items:
                result["witnessStack"] = [b2x(bytes(it)) for it in stack_items]
        except Exception:
            pass
    
    # harvest optional inner scripts (added by the tracer)
    for st in steps:
        ph = st.get("phase")
        script_hex = st.get("script_hex")
        if ph in ("redeemScript", "witnessScript", "taproot") and script_hex:
            key = "redeemScript" if ph == "redeemScript" else "witnessScript"
            if key not in result:
                result[key] = script_hex

    # Handle errors
    if not is_valid:
        result["error"] = err_msg or "Unknown script verification error"
        
        # Add helpful hint if witness is active but no amount provided
        if uses_witness and not amount_supplied and not spent_outputs:
            result["error"] += " (Note: SegWit/Taproot verification requires the spent amount in satoshis)"

    return json.dumps(result)

def sha256_hex(val: str) -> str:
    """
    Perform a single SHA-256 on `val` (which is hex-encoded).
    Return the 32-byte digest in hex.
    """
    raw = _bytes_from_even_hex(val, name="input")  
    digest = hashlib.sha256(raw).digest()
    return digest.hex()


def encode_script_push_data(val: str) -> str:
    """
    Return only the appropriate push-opcode(s) for the given hex data.
    """
    data_len = len(_bytes_from_even_hex(val, name="script data"))

    if data_len == 0:
        return "00"                 # OP_0
    if data_len <= 75:
        return f"{data_len:02x}"    # direct length
    if data_len <= 255:
        return "4c" + f"{data_len:02x}"
    if data_len <= 65535:
        return "4d" + data_len.to_bytes(2, "little").hex()
    return "4e" + data_len.to_bytes(4, "little").hex()


def op_code_select(val: str) -> str:
    """
    Takes a hex string that was pre-concatenated in the frontend
    and returns it as-is. This allows the OpCodeNode to follow
    the same pattern as other calculation nodes while avoiding
    data duplication.

    Args:
        val: A pre-concatenated hex string
             Example: "76a988ac" (OP_DUP + OP_HASH160 + OP_EQUALVERIFY + OP_CHECKSIG)

    Returns:
        The same hex string

    Examples:
        >>> op_code_select("76a914")
        "76a914"

        >>> op_code_select("76a91488ac")
        "76a91488ac"

        >>> op_code_select("6a")  # OP_RETURN
        "6a"
    """
    return val


def int_to_script_bytes(val: Union[int, str]) -> str:
    """
    Convert a non-negative integer to Bitcoin-Script's minimal
    little-endian, signed-magnitude byte string (no push-opcode).
    Returns lowercase hex, e.g. 4404774  ->  '263643'.
    """
    if isinstance(val, str):
        if not val.isdigit():
            raise ValueError("decimal string expected")
        val = int(val, 10)
    if not isinstance(val, int) or val < 0:
        raise ValueError("val must be a non-negative integer")

    if val == 0:
        return ""                       # minimal encoding of zero

    b = []
    v = val
    while v:
        b.append(v & 0xFF)
        v >>= 8
    if b[-1] & 0x80:                    # keep sign-bit positive
        b.append(0x00)

    return bytes(b).hex()


def text_to_hex(val: str) -> str:
    """
    Convert UTF-8 text string to hex.
    
    Examples:
        "2009" -> "32303039"
        "banks" -> "62616e6b73"
        "satoshi" -> "7361746f736869"
    """
    return val.encode('utf-8').hex()


def blocks_to_sequence_number(val: int) -> int:
    """
    Convert block delay to BIP 68 sequence number value.
    Returns decimal integer (not hex, not LE).
    
    Examples:
        10 -> 10
        144 -> 144
        4320 -> 4320
    """
    if val < 0:
        raise ValueError("Delay must be non-negative")
    if val > 0xffff:  # 16-bit limit for block-based
        raise ValueError("Block delay must be <= 65535")
    
    # Just return the value - let Uint32→LE-4 handle encoding
    return val

def hash160_to_p2sh_address(val: str, selectedNetwork: str = "regtest") -> str:
    """
    Generate a Base58Check P2SH address from a 20-byte HASH160.
    mainnet: 0x05, testnet/regtest: 0xc4
    """
    script_hash = _bytes_from_even_hex(val, name="script hash")
    if len(script_hash) != 20:
        raise ValueError("Script HASH160 must be exactly 20 bytes (40 hex characters)")
    version = b"\x05" if selectedNetwork == "mainnet" else b"\xc4"
    return _b58check_encode(version + script_hash)

def date_to_unix_timestamp(val: str) -> str:
    """
    Convert ISO date string to Unix timestamp for CHECKLOCKTIMEVERIFY.
    
    Accepts various formats:
    - "2025-01-01T00:00:00Z" (ISO with Z)
    - "2025-01-01T00:00:00+00:00" (ISO with timezone)
    - "2025-01-01 00:00:00" (space separator)
    - "2025-01-01" (date only, assumes 00:00:00 UTC)
    
    Returns Unix timestamp as string.
    """
    # Clean up the input
    val = val.strip()
    
    if not val:
        raise ValueError("Date cannot be empty")
    
    # Common mistake fixes
    if "/" in val:
        raise ValueError("Use dashes, not slashes: '2025-01-01' not '2025/01/01'")
    
    if val.count("-") == 1:
        raise ValueError("Invalid date format. Use YYYY-MM-DD format")
    
    # Handle date-only format
    if 'T' not in val and ' ' not in val:
        if len(val) == 10:  # YYYY-MM-DD
            val += "T00:00:00Z"
        else:
            raise ValueError("Date should be YYYY-MM-DD or full ISO format")
    
    # Replace Z with explicit UTC offset
    val = val.replace('Z', '+00:00')
    
    # Replace space with T if needed
    val = val.replace(' ', 'T')
    
    # Add timezone if missing
    if not re.search(r'([+-]\d{2}:\d{2})$', val):
        val += '+00:00'
    
    try:
        # Parse and convert to timestamp
        dt = datetime.fromisoformat(val)
        timestamp = int(dt.timestamp())
        
        # Verify it's >= 500,000,000 (for CLTV)
        if timestamp < 500_000_000:
            dt_min = datetime.fromtimestamp(500_000_000)
            raise ValueError(
                f"Date {dt.strftime('%Y-%m-%d')} is too early. "
                f"Must be after {dt_min.strftime('%Y-%m-%d')} to avoid "
                f"confusion with block heights"
            )
        
        # Check max timestamp (uint32 limit)
        if timestamp > 4_294_967_295:  # Max uint32
            dt_max = datetime.fromtimestamp(4_294_967_295)
            raise ValueError(
                f"Date {dt.strftime('%Y-%m-%d')} is too far in the future. "
                f"Bitcoin's locktime cannot store dates after "
                f"{dt_max.strftime('%Y-%m-%d %H:%M:%S')} UTC"
            )
            
        return str(timestamp)
        
    except ValueError as e:
        # Re-raise our custom errors
        if "too early" in str(e) or "too far" in str(e) or "Use dashes" in str(e):
            raise
        
        # Provide helpful message for parsing errors
        raise ValueError(
            f"Invalid date format: '{val}'\n"
            f"Accepted formats:\n"
            f"  • 2025-01-01T00:00:00Z\n"
            f"  • 2025-01-01T00:00:00+00:00\n"
            f"  • 2025-01-01 00:00:00\n"
            f"  • 2025-01-01"
        ) from e

    
def reverse_bytes_4(val: str) -> str:
    """
    Reverse byte order of a 4-byte hex string.
    Makes endianness conversion explicit in transaction building.
    
    Examples:
        fffffffd → fdffffff (sequence byte order)
        01000000 → 00000001 (version display format)
        16685f00 → 005f6816 (locktime display format)
    """
    raw = _bytes_from_even_hex(val, name="input")
    if len(raw) != 4:
        raise ValueError("Input must be exactly 4 bytes (8 hex characters)")
    return raw[::-1].hex()


def hours_to_sequence_number(val: Union[float, str]) -> int:
    """
    Convert hours to CSV time units (512-second units).
    Returns unit count only, NOT the nSequence value.
    
    Examples:
        0.5 -> 4 units (≈ 34 minutes)
        1 -> 7 units (≈ 60 minutes)
        1.5 -> 11 units (≈ 94 minutes)
        720 -> 5063 units (30 days)
    """
    if isinstance(val, str):
        try:
            val = float(val)
        except ValueError:
            raise ValueError(f"Invalid hours value: '{val}' is not a valid number")

    if val < 0:
        raise ValueError("Hours must be non-negative")

    # 512-second units, rounded with Python's round (ties to even)
    units = round(val * 3600.0 / 512.0)

    if units > 0xffff:
        max_hours = 0xffff * 512 / 3600  # keep float for consistent messaging
        raise ValueError(f"Time delay must be <= {max_hours:.1f} hours (~388 days)")

    return int(units)


def encode_sequence_block_flag(val: Union[int, str]) -> int:
    """
    Pass through sequence value for block-based CSV (no flags).
    
    Args:
        val: The sequence value in blocks
        
    Returns:
        Same value (no modification needed for blocks)
        
    Examples:
        10 -> 10
        144 -> 144
        4320 -> 4320
    """
    if isinstance(val, str):
        try:
            val = int(val)
        except ValueError:
            raise ValueError(f"Invalid sequence value: '{val}' must be an integer")
    
    if val < 0:
        raise ValueError("Sequence value must be non-negative")
    if val > 0xffff:
        raise ValueError(f"Sequence value must be <= 65535, got {val}")
    
    # For block-based, just return as-is
    return val


def encode_sequence_time_flag(val: Union[int, str]) -> int:
    """
    Add time-based flag (bit 22) to sequence value for time-based CSV.
    
    Args:
        val: The sequence value in time units (512-second units)
        
    Returns:
        Value with bit 22 set for time-based locks
        
    Examples:
        8 -> 4194312
        5063 -> 4199367
    """
    if isinstance(val, str):
        try:
            val = int(val)
        except ValueError:
            raise ValueError(f"Invalid sequence value: '{val}' must be an integer")
    
    if val < 0:
        raise ValueError("Sequence value must be non-negative")
    if val > 0xffff:
        raise ValueError(f"Sequence value must be <= 65535, got {val}")
    
    # Set bit 22 for time-based
    return val | (1 << 22)  # 0x400000


def opcode_to_value(val: str) -> int:
    """
    Convert a Bitcoin Script opcode to its numeric value.
    
    Only handles opcodes that represent direct numeric values:
    - OP_0 (0x00) → 0
    - OP_1NEGATE (0x4f) → -1
    - OP_1 through OP_16 (0x51-0x60) → 1 through 16
    
    Args:
        val: Two-character hex string representing an opcode
        
    Returns:
        The numeric value represented by the opcode
        
    Raises:
        ValueError: If input is not a valid numeric opcode
        
    Examples:
        >>> opcode_to_value("00")
        0
        >>> opcode_to_value("5a")
        10
        >>> opcode_to_value("60")
        16
        >>> opcode_to_value("4f")
        -1
    """
    # Map of opcode (hex) to numeric value
    OPCODE_TO_VALUE = {
        "00": 0,    # OP_0 / OP_FALSE
        "4f": -1,   # OP_1NEGATE
        "51": 1,    # OP_1 / OP_TRUE
        "52": 2,    # OP_2
        "53": 3,    # OP_3
        "54": 4,    # OP_4
        "55": 5,    # OP_5
        "56": 6,    # OP_6
        "57": 7,    # OP_7
        "58": 8,    # OP_8
        "59": 9,    # OP_9
        "5a": 10,   # OP_10
        "5b": 11,   # OP_11
        "5c": 12,   # OP_12
        "5d": 13,   # OP_13
        "5e": 14,   # OP_14
        "5f": 15,   # OP_15
        "60": 16,   # OP_16
    }
    
    # Normalize to lowercase
    val = val.strip().lower()
    
    # Validate input format
    if len(val) != 2:
        raise ValueError(f"Opcode must be exactly 2 hex characters, got '{val}'")
    
    # Check if it's valid hex
    try:
        int(val, 16)
    except ValueError:
        raise ValueError(f"Invalid hex string: '{val}'")
    
    # Look up the value
    if val not in OPCODE_TO_VALUE:
        raise ValueError(
            f"Opcode 0x{val} does not represent a numeric value. "
            f"Valid opcodes are: OP_0 (0x00), OP_1NEGATE (0x4f), "
            f"and OP_1 through OP_16 (0x51-0x60)"
        )
    
    return OPCODE_TO_VALUE[val]


def verify_signature(vals: list[str]) -> str:
    """
    Verify an ECDSA signature produced by Bitcoin-Core-style signing.

    Parameters
    ----------
    vals[0] : hex-encoded public key (33-byte compressed **or** 65-byte uncompressed)
    vals[1] : hex-encoded 32-byte message hash (little/big-endian OK as long as it
              matches what was actually signed)
    vals[2] : hex-encoded DER signature

    Returns
    -------
    str
        "true" if the signature is valid, otherwise "false".
    """
    if len(vals) < 3:
        raise ValueError("Need [pubKeyHex, messageHashHex, signatureDerHex]")

    pub_bytes = _bytes_from_even_hex(vals[0].strip(), name="public key")
    msg_bytes = _bytes_from_even_hex(vals[1].strip(), name="message hash")
    sig_bytes = _bytes_from_even_hex(vals[2].strip(), name="signature")

    if len(msg_bytes) != 32:
        raise ValueError("Message hash must be exactly 32 bytes")

    # -------- create VERIFY-only context ---------------------------------
    ctx = _get_verify_ctx()

    with _VERIFY_LOCK:
        # ----- parse public key ------------------------------------------
        pubkey = secp256k1.ffi.new("secp256k1_pubkey *")
        if secp256k1.lib.secp256k1_ec_pubkey_parse(
            ctx, pubkey, pub_bytes, len(pub_bytes)
        ) != 1:
            raise ValueError("Invalid public key")

        # ----- parse DER signature ---------------------------------------
        sig = secp256k1.ffi.new("secp256k1_ecdsa_signature *")
        if secp256k1.lib.secp256k1_ecdsa_signature_parse_der(
            ctx, sig, sig_bytes, len(sig_bytes)
        ) != 1:
            raise ValueError("Invalid DER signature")

        # ----- normalize to low-S to mirror Core behaviour ---------------
        secp256k1.lib.secp256k1_ecdsa_signature_normalize(ctx, sig, sig)

        # ----- verify ----------------------------------------------------
        ok = secp256k1.lib.secp256k1_ecdsa_verify(ctx, sig, msg_bytes, pubkey)
        return "true" if ok == 1 else "false"


# ----------------------------------------------------------------------
# TX-Field Extract  –  Pylance-friendly version
# ----------------------------------------------------------------------
def extract_tx_field(vals: list[str]) -> str:
    """
    Quick, stateless accessor for common parts of a raw transaction.

    Parameters
    ----------
    vals[0]  raw_tx_hex              – full transaction in hex
    vals[1]  field_name              – see list below
    vals[2]  (optional) index/int    – only used for vin[] / vout[] look-ups
    """
    if len(vals) < 2:
        raise ValueError("Need at least rawTxHex and fieldName")

    raw_hex   = vals[0].strip()
    field     = vals[1].strip()
    index     = int(vals[2]) if len(vals) > 2 and vals[2] != "" else 0

    tx: CTransaction = _deserialize_tx_cached(raw_hex)

    # Convert ReadOnlyField → plain list so it's 'Sized' and sub-scriptable
    vin:  List = list(tx.vin)   # type: ignore[arg-type]
    vout: List = list(tx.vout)  # type: ignore[arg-type]

    # -------- helpers -------------------------------------------------
    def assert_idx(arr: Sequence, i: int, what: str) -> None:
        if i < 0 or i >= len(arr):
            raise IndexError(f"{what} index {i} out of range (have {len(arr)})")

    # -------- top-level fields ----------------------------------------
    if field == "version":
        return str(tx.nVersion)
    if field == "locktime":
        return str(tx.nLockTime)
    if field == "input_count":
        return str(len(vin))
    if field == "output_count":
        return str(len(vout))
    if field == "txid":
        return tx.GetTxid().hex()

    # -------- per-input fields ----------------------------------------
    if field.startswith("vin."):
        assert_idx(vin, index, "vin")
        txin = vin[index]
        sub = field[4:]
        if sub == "txid":
            return txin.prevout.hash.hex()
        if sub == "vout":
            return str(txin.prevout.n)
        if sub == "scriptSig":
            return bytes(txin.scriptSig).hex()
        if sub == "sequence":
            return str(txin.nSequence)
        raise ValueError(f"Unknown vin sub-field '{sub}'")

    # -------- per-output fields ---------------------------------------
    if field.startswith("vout."):
        assert_idx(vout, index, "vout")
        txout = vout[index]
        sub = field[5:]
        if sub == "value":
            return str(txout.nValue)
        if sub == "scriptPubKey":
            return bytes(txout.scriptPubKey).hex()
        raise ValueError(f"Unknown vout sub-field '{sub}'")

    # -------- miscellany ----------------------------------------------
    if field == "raw_no_witness":
        # Pylance doesn't know this helper – tell it to ignore.
        return b2x(tx.serialize_without_witness())  # type: ignore[attr-defined]

    raise ValueError(f"Unsupported field '{field}'")


def compare_equal(vals: list[str]) -> str:
    """
    Return \"true\" if ALL provided vals are identical, else \"false\".
    Accepts two or more inputs.
    """
    if len(vals) < 2:
        raise ValueError("Need at least two inputs to compare")

    first = vals[0]
    ok = all(v == first for v in vals[1:])
    return "true" if ok else "false"


# ----------------------------------------------------------------------
#  Compare two numbers with a chosen operator
# ----------------------------------------------------------------------
# ----------------------------------------------------------------------
#  Numeric comparison with input-sanitising
# ----------------------------------------------------------------------
def _parse_numeric_exact(raw: str):
    """
    Return int for integers/hex; Decimal for fractional/exp notation.
    Supports:
      - decimal ints: '144', '+10', '-7'
      - hex: '0x90', '90' with A–F present (e.g. 'deadbeef')
      - decimal with fraction/exp: '12.5', '1e6', '0.1'
    """
    s = str(raw).strip()
    if not s:
        raise ValueError("empty number")

    # hex?
    if s.lower().startswith("0x") or (
        all(c in "0123456789abcdefABCDEF" for c in s)
        and any(c in "abcdefABCDEF" for c in s)
    ):
        return int(s, 16)

    # plain integer?
    if _INT_DEC_RE.fullmatch(s):
        return int(s, 10)

    # decimal/exp → Decimal
    try:
        return Decimal(s)
    except InvalidOperation:
        raise ValueError(f"'{raw}' is not a valid number")

def _coerce_for_op(a, b):
    """Promote to Decimal if either is Decimal; keep ints otherwise."""
    if isinstance(a, int) and isinstance(b, int):
        return a, b
    if isinstance(a, int):
        a = Decimal(a)
    if isinstance(b, int):
        b = Decimal(b)
    return a, b

def _num_to_str(x):
    """Nice string form without scientific notation or trailing .0."""
    if isinstance(x, int):
        return str(x)
    # Decimal
    if x == x.to_integral_value():
        return str(int(x))
    return format(x.normalize(), 'f')

def compare_numbers(vals: list[str]) -> str:
    if len(vals) < 3:
        raise ValueError("Need [left, operator, right]")
    a = _parse_numeric_exact(vals[0])
    b = _parse_numeric_exact(vals[2])
    a, b = _coerce_for_op(a, b)

    op = vals[1].strip()
    if op == "<":
        res = a < b
    elif op == ">":
        res = a > b
    elif op == "<=":
        res = a <= b
    elif op == ">=":
        res = a >= b
    else:
        raise ValueError(f"Unsupported operator '{op}'")
    return "true" if res else "false"

def math_operation(vals: list[str]) -> str:
    if len(vals) < 3:
        raise ValueError("Need [left, operator, right]")
    a = _parse_numeric_exact(vals[0])
    b = _parse_numeric_exact(vals[2])
    a, b = _coerce_for_op(a, b)

    op = vals[1].strip()
    if op == "+":
        res = a + b
    elif op == "-":
        res = a - b
    elif op == "*":
        res = a * b
    elif op == "/":
        if (b == 0) or (isinstance(b, Decimal) and b.is_zero()):
            raise ValueError("Division by zero")
        # force Decimal division for exactness if both ints
        if isinstance(a, int) and isinstance(b, int):
            res = Decimal(a) / Decimal(b)
        else:
            res = a / b
    else:
        raise ValueError(f"Unsupported operator '{op}'")

    return _num_to_str(res)

def hash160_to_p2pkh_address(val: str, selectedNetwork: str = "regtest") -> str:
    """
    Generate a Base58Check P2PKH address from a 20-byte HASH160.
    mainnet: 0x00, testnet/regtest: 0x6f
    """
    h160 = _bytes_from_even_hex(val, name="hash160")
    if len(h160) != 20:
        raise ValueError("HASH160 must be exactly 20 bytes (40 hex characters)")
    version = b"\x00" if selectedNetwork == "mainnet" else b"\x6f"
    return _b58check_encode(version + h160)

def hash160_to_p2wpkh_address(val: str, selectedNetwork: str = "regtest") -> str:
    """
    Convert a 20-byte HASH160 into a bech32 P2WPKH (v0) address.
    """
    prog = _bytes_from_even_hex(val, name="hash160")
    if len(prog) != 20:
        raise ValueError("HASH160 must be exactly 20 bytes (40 hex characters)")
    hrp = _hrp_for_network(selectedNetwork)
    return _bech32_encode(hrp, 0, prog)

def sha256_to_p2wsh_address(val: str, selectedNetwork: str = "regtest") -> str:
    """
    Convert a 32-byte SHA256 into a bech32 P2WSH (v0) address.
    """
    prog = _bytes_from_even_hex(val, name="sha256")
    if len(prog) != 32:
        raise ValueError("SHA256 must be exactly 32 bytes (64 hex characters)")
    hrp = _hrp_for_network(selectedNetwork)
    return _bech32_encode(hrp, 0, prog)

# ──────────────────────────────────────────────────────────────────────────────
#  Hex → Byte Length
# ──────────────────────────────────────────────────────────────────────────────
def hex_byte_length(val: str) -> int:
    """
    Return the size (in *bytes*) of a hex‑encoded string.

    • Whitespace (spaces, new‑lines, tabs) is ignored.
    • Raises ValueError if the cleaned hex has an odd number of characters.

    Example
    -------
    >>> hex_byte_length("0200000001 … 000000")
    192
    """
    cleaned = "".join(val.split())           # tolerate whitespace & new‑lines
    if len(cleaned) % 2:
        raise ValueError(
            f"Hex string must have an even number of characters (got {len(cleaned)})"
        )
    return len(cleaned) // 2

def address_to_scriptpubkey(val: str) -> str:
    """
    Convert a Bitcoin address to its scriptPubKey (hex).
    Supports:
      - Base58 P2PKH (0x00, 0x6f)          → 76a914{h160}88ac
      - Base58 P2SH  (0x05, 0xc4)          → a914{h160}87
      - Bech32 v0 (20)  P2WPKH             → 0014{h160}
      - Bech32 v0 (32)  P2WSH              → 0020{sha256}
      - Bech32m v1 (32) P2TR (Taproot)     → 5120{xonly}
      - Bech32m v2..16 (2..40) future      → {0x50+v}{len}{prog}
    Networks (HRP):
      - Mainnet:  'bc'
      - Testnet:  'tb'  (also accept 'tbs' for signet variants)
      - Regtest:  'bcrt'
    """
    addr = val.strip()
    if not addr:
        raise ValueError("Address cannot be empty")
    
    # --- Try Bech32/Bech32m first -------------------------------------------
    try:
        hrp, v, prog = _bech32_decode(addr)  # Returns (hrp, v, prog) tuple
    except Exception:
        # Fall through to Base58Check if Bech32 decoding fails altogether
        pass
    else:
        # _bech32_decode enforces correct checksum internally
        # Just infer which type based on version
        encoding = "bech32" if v == 0 else "bech32m"

        # Normalize program to bytes
        if not isinstance(prog, (bytes, bytearray)):
            prog = bytes(prog)

        # Accept standard HRPs (+ 'tbs' for signet variants)
        if hrp not in ("bc", "tb", "tbs", "bcrt"):
            raise ValueError(f"Unsupported HRP '{hrp}' for Bitcoin networks")

        # Build scriptPubKey for witnesses
        if v == 0:
            if len(prog) == 20:
                return "0014" + prog.hex()  # P2WPKH
            if len(prog) == 32:
                return "0020" + prog.hex()  # P2WSH
            raise ValueError(f"v0 witness program must be 20 or 32 bytes, got {len(prog)}")

        if 1 <= v <= 16:
            if v == 1:
                if len(prog) != 32:
                    raise ValueError(f"Taproot (v1) witness program must be 32 bytes, got {len(prog)}")
                return "5120" + prog.hex()  # P2TR
            # v2..v16 future
            if not (2 <= len(prog) <= 40):
                raise ValueError(f"v{v} witness program must be 2..40 bytes, got {len(prog)}")
            return f"{0x50 + v:02x}{len(prog):02x}" + prog.hex()

        raise ValueError(f"Witness version must be 0..16, got {v}")

    # --- Try Base58Check (P2PKH / P2SH) --------------------------------------
    try:
        payload = _b58check_decode(addr)  # version (1) + payload (20)
        if len(payload) != 21:
            raise ValueError(f"Invalid Base58 payload length: {len(payload)}")

        ver = payload[0]
        h160 = payload[1:]

        # P2PKH (mainnet 0x00, test/signet/regtest 0x6f)
        if ver in (0x00, 0x6f):
            if len(h160) != 20:
                raise ValueError(f"P2PKH payload must be 20 bytes, got {len(h160)}")
            return "76a914" + h160.hex() + "88ac"

        # P2SH (mainnet 0x05, test/signet/regtest 0xc4)
        if ver in (0x05, 0xc4):
            if len(h160) != 20:
                raise ValueError(f"P2SH payload must be 20 bytes, got {len(h160)}")
            return "a914" + h160.hex() + "87"

        raise ValueError(f"Unknown Base58 version byte: 0x{ver:02x}")

    except ValueError as exc:
        msg = str(exc)
        known_prefixes = (
            "Unknown Base58 version byte",
            "P2PKH payload must be",
            "P2SH payload must be",
            "Invalid Base58 payload length",
            "Invalid Base58Check checksum",
        )
        if msg.startswith(known_prefixes) or msg.startswith("Address cannot be"):
            raise
        raise ValueError(
            "Unrecognized address format. Supported: "
            "P2PKH (1.../m.../n...), P2SH (3.../2...), "
            "P2WPKH/P2WSH (bc1q.../tb1q.../bcrt1q...), "
            "P2TR (bc1p.../tb1p.../bcrt1p...), and v2–v16 witness."
        ) from exc
    except Exception as e:
        raise ValueError(
            "Unrecognized address format. Supported: "
            "P2PKH (1.../m.../n...), P2SH (3.../2...), "
            "P2WPKH/P2WSH (bc1q.../tb1q.../bcrt1q...), "
            "P2TR (bc1p.../tb1p.../bcrt1p...), and v2–v16 witness."
        ) from e
def bip67_sort_pubkeys(vals: list) -> str:
    """
    Return comma-separated 1-based positions after BIP-67 lexicographic sort.
    
    BIP-67 specifies deterministic sorting of COMPRESSED public keys only
    for creating consistent multisig addresses.
    
    Args:
        vals: List of hex-encoded compressed public keys (33 bytes, 02/03 prefix)
    
    Returns:
        Comma-separated string of original positions after sorting.
        Example: "2,4,1,3" means 2nd key comes first, then 4th, then 1st, then 3rd
        
    Raises:
        ValueError: If any key is not a valid 33-byte compressed public key
    """
    if not vals:
        return ""
    
    items = []
    for i, key in enumerate(vals, start=1):
        if not key:
            continue
            
        key = str(key).strip()
        
        # Validate hex and convert to bytes
        if len(key) % 2 != 0:
            raise ValueError(f"Public key {i}: Odd number of hex characters")
        
        try:
            key_bytes = bytes.fromhex(key)
        except ValueError:
            raise ValueError(f"Public key {i}: Invalid hexadecimal")
        
        # BIP-67 strict validation: ONLY compressed keys
        if len(key_bytes) != 33:
            raise ValueError(
                f"Public key {i}: BIP-67 requires exactly 33-byte compressed keys "
                f"(got {len(key_bytes)} bytes)"
            )
        
        if key_bytes[0] not in (0x02, 0x03):
            raise ValueError(
                f"Public key {i}: Must start with 02 or 03 for compressed key "
                f"(got {key_bytes[0]:02x})"
            )
        
        items.append((key_bytes, i))
    
    if not items:
        return ""
    
    # Sort lexicographically by raw bytes (BIP-67 standard)
    items.sort(key=lambda t: t[0])
    
    # Return original positions in sorted order
    return ",".join(str(idx) for _, idx in items)

def _encode_minimal_le(n: int) -> bytes:
    """Encode integer as minimal signed little-endian bytes (CScriptNum encoding)."""
    if n == 0:
        return b'\x00'
    result = []
    neg = n < 0
    absn = abs(n)
    while absn > 0:
        result.append(absn & 0xff)
        absn >>= 8
    if result[-1] & 0x80:
        result.append(0x80 if neg else 0x00)
    elif neg:
        result[-1] |= 0x80
    return bytes(result)


def coinbase_script_height(val: str) -> str:
    """
    Encode a block height as the minimal-push serialized script prefix
    required by BIP34.

    val: decimal block height as a string (e.g., "840000")
    Returns: hex-encoded minimal push of that height,
             e.g., "0340d10c" (OP_PUSHBYTES_3 followed by height in minimal LE)
    """
    height = int(val)
    if height < 0:
        raise ValueError("block height must be non-negative")
    height_bytes = _encode_minimal_le(height)
    push_op = bytes([len(height_bytes)])
    return (push_op + height_bytes).hex()


def block_subsidy_satoshis(val: str) -> str:
    """
    Compute the block reward in satoshis for a given block height,
    applying the halving schedule.

    val: decimal block height as a string
    Returns: decimal satoshi reward as a string (e.g., "312500000" at height 840000)
    """
    height = int(val)
    INITIAL_SUBSIDY_SATS = 50 * 100_000_000  # 5_000_000_000
    HALVING_INTERVAL = 210_000
    halvings = height // HALVING_INTERVAL
    if halvings >= 64:
        return "0"
    return str(INITIAL_SUBSIDY_SATS >> halvings)


def merkle_root_from_txids(vals: list) -> str:
    """
    Compute the Merkle root from an ordered list of TXIDs.

    vals: ordered list of TXID hex strings in display format (big-endian)
    Returns: Merkle root in display format (big-endian hex)
    """
    if not vals or all(v.strip() == "" for v in vals):
        raise ValueError("at least one TXID is required")

    def _dsha256(data: bytes) -> bytes:
        return hashlib.sha256(hashlib.sha256(data).digest()).digest()

    # Convert display TXIDs (big-endian) to internal byte order (little-endian)
    hashes = [bytes.fromhex(txid)[::-1] for txid in vals]

    while len(hashes) > 1:
        if len(hashes) % 2 == 1:
            hashes.append(hashes[-1])  # BIP rule: duplicate last if odd
        hashes = [
            _dsha256(hashes[i] + hashes[i + 1])
            for i in range(0, len(hashes), 2)
        ]

    # Return root in display byte order (big-endian)
    return hashes[0][::-1].hex()


def encode_nbits(val: str) -> str:
    """
    Convert a 256-bit difficulty target (64-char hex) to Bitcoin's compact
    nBits 4-byte representation (little-endian hex as stored in the block header).

    val: 64-character hex string representing the full 256-bit target
    Returns: 4-byte little-endian nBits hex

    Example:
        target = "00000000ffff0000000000000000000000000000000000000000000000000000"
        → nBits = "ffff001d"
    """
    target_int = int(val, 16)
    if target_int == 0:
        return "00000000"

    nbytes = (target_int.bit_length() + 7) // 8
    
    if nbytes >= 3:
        coef = target_int >> (8 * (nbytes - 3))
    else:
        coef = target_int << (8 * (3 - nbytes))
    if coef & 0x800000:
        coef >>= 8
        nbytes += 1
    # Compact: exponent byte || 3-byte coefficient, stored as LE 4-byte field
    compact = (nbytes << 24) | (coef & 0xFFFFFF)
    return compact.to_bytes(4, "little").hex()


def meets_target(vals: list) -> str:
    """
    Check whether a block hash satisfies the difficulty target encoded in nBits.

    vals[0]: block hash as 64-char hex (big-endian display format)
    vals[1]: nBits as 4-byte little-endian hex
    Returns: "TRUE" if hash <= target, else "FALSE - hash > target"
    """
    block_hash_int = int(vals[0], 16)

    nbits_bytes = bytes.fromhex(vals[1])
    compact = int.from_bytes(nbits_bytes, "little")
    exponent = (compact >> 24) & 0xFF
    coefficient = compact & 0x00FFFFFF
    target_int = coefficient * (2 ** (8 * (exponent - 3)))

    if block_hash_int <= target_int:
        return "TRUE"
    else:
        return f"FALSE - hash {vals[0][:16]}... > target"


def check_result(vals: list[str]) -> str:
    """
    Check that ALL non-empty inputs evaluate to 'true' (case-insensitive).
    Returns "true" if all non-empty inputs are true, "false" if any are not.
    Empty inputs are ignored.
    Used to convert comparison results into errors when needed.
    
    Args:
        vals: List of values to check (should be "true" or "false" strings)
    
    Returns:
        "true" if all non-empty inputs are "true", "false" otherwise
    """
    # Filter out empty values
    non_empty_vals = [v for v in vals if str(v).strip()]
    
    if not non_empty_vals:
        # If all inputs are empty, return true (no checks to fail)
        return "true"
    
    # Check if all non-empty values are "true" (case-insensitive)
    for val in non_empty_vals:
        if str(val).strip().lower() != "true":
            return "false"
    
    return "true"
