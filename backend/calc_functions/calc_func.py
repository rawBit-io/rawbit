import os
import sys
import hashlib
import hmac
import logging
import struct
import binascii
import json
import secrets
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any, Union, List, Sequence

from ecdsa import SigningKey, SECP256k1, ellipticcurve
import secp256k1

import re
_WS_RE = re.compile(r"\s+")
_HEX_RE = re.compile(r"^[0-9a-fA-F]+$")

from decimal import Decimal, InvalidOperation, getcontext
getcontext().prec = 50  # plenty for money math

_INT_DEC_RE = re.compile(r'^[+-]?\d+$', re.ASCII)
_STRICT_DECIMAL_RE = re.compile(
    r'^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$', re.ASCII
)

_LOOKS_LIKE_SCI_RE = re.compile(
    r'(^[+-]?\d+\.?\d*[eE])|(^[eE]\d+)', re.ASCII
)

_UINT_DEC_NO_LEADING_ZERO_RE = re.compile(r"^(0|[1-9]\d*)$", re.ASCII)

_CURVE_ORDER = SECP256k1.order
_CURVE_GEN = SECP256k1.generator
_CURVE_P = SECP256k1.curve.p()
_BIP32_HARDENED = 0x80000000
_ECIES_MAGIC = b"RBECIES1"
_ECIES_SALT_LEN = 16
_ECIES_TAG_LEN = 32
from bitcointx.core import CTransaction, CTxOut, b2x
from bitcointx.core.script import CScript
from .opcodes import opcode_sequence_to_hex, OPCODE_TO_HEX
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
    # canonical name -> flag map (source of truth for every verify flag,
    # incl. the Taproot policy flags rawBit used to omit)
    SCRIPT_VERIFY_FLAGS_BY_NAME,
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
        "signet": "tb",
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


def _load_bip39_english_wordlist() -> list[str]:
    path = Path(__file__).resolve().parent / "data" / "bip39_english.txt"
    words = path.read_text(encoding="utf-8").splitlines()
    if len(words) != 2048:
        raise RuntimeError("BIP39 English wordlist must contain exactly 2048 words")
    if len(set(words)) != 2048:
        raise RuntimeError("BIP39 English wordlist contains duplicate words")
    return words


_BIP39_ENGLISH_WORDLIST = _load_bip39_english_wordlist()
_BIP39_ENGLISH_INDEX = {word: index for index, word in enumerate(_BIP39_ENGLISH_WORDLIST)}


def _hmac_sha512(key: bytes, message: bytes) -> bytes:
    """
    Manual HMAC-SHA512.

    HMAC works by hashing the message twice with two different padded versions
    of the key:

      inner = SHA512((key XOR ipad) || message)
      outer = SHA512((key XOR opad) || inner)

    SHA512 has a 128-byte block size. Long keys are first compressed with one
    SHA512 hash, then short keys are padded with zero bytes to one block.
    """
    block_size = 128
    if len(key) > block_size:
        key = hashlib.sha512(key).digest()
    key = key.ljust(block_size, b"\x00")

    inner_pad = bytes(byte ^ 0x36 for byte in key)
    outer_pad = bytes(byte ^ 0x5C for byte in key)
    inner_hash = hashlib.sha512(inner_pad + message).digest()
    return hashlib.sha512(outer_pad + inner_hash).digest()


def _pbkdf2_hmac_sha512(
    password: bytes,
    salt: bytes,
    iterations: int,
    derived_key_length: int,
) -> bytes:
    """
    Manual PBKDF2-HMAC-SHA512.

    PBKDF2 derives output in 64-byte SHA512-sized blocks. For each block:

      U1 = HMAC(password, salt || block_number)
      U2 = HMAC(password, U1)
      ...
      Uc = HMAC(password, Uc-1)

    The final block is U1 XOR U2 XOR ... XOR Uc.
    BIP39 sets c = 2048 and asks for 64 output bytes.
    """
    if iterations <= 0:
        raise ValueError("PBKDF2 iterations must be positive")
    if derived_key_length <= 0:
        raise ValueError("PBKDF2 derived key length must be positive")

    hlen = 64
    blocks_needed = (derived_key_length + hlen - 1) // hlen
    derived = bytearray()

    for block_number in range(1, blocks_needed + 1):
        u = _hmac_sha512(password, salt + block_number.to_bytes(4, "big"))
        block = bytearray(u)

        for _ in range(1, iterations):
            u = _hmac_sha512(password, u)
            for i, byte in enumerate(u):
                block[i] ^= byte

        derived.extend(block)

    return bytes(derived[:derived_key_length])


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
# Entry count is capped by lru_cache, but bytes are not: requests may carry
# multi-MB transactions, so cache only small ones to bound retained memory.
_TX_CACHE_MAX_HEX_CHARS = 65536


@lru_cache(maxsize=2048)
def _deserialize_tx_small_cached(raw_hex: str) -> CTransaction:
    return CTransaction.deserialize(bytes.fromhex(raw_hex))


def _deserialize_tx_cached(raw_hex: str) -> CTransaction:
    """Cache parsed transactions to avoid redundant deserialization."""
    if len(raw_hex) > _TX_CACHE_MAX_HEX_CHARS:
        return CTransaction.deserialize(bytes.fromhex(raw_hex))
    return _deserialize_tx_small_cached(raw_hex)
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

# Only memoize known protocol tags; user-supplied tags would grow the cache
# without bound, and an extra sha256 per call is negligible.
_KNOWN_PROTOCOL_TAGS = frozenset(
    {
        "BIP0340/aux",
        "BIP0340/nonce",
        "BIP0340/challenge",
        "TapTweak",
        "TapLeaf",
        "TapBranch",
        "TapSighash",
        "KeyAgg list",
        "KeyAgg coefficient",
        "MuSig/aux",
        "MuSig/nonce",
        "MuSig/noncecoef",
        "BatchSchnorr",
    }
)


def _tagged_hash_bytes(tag: str, data: bytes) -> bytes:
    """Return tagged_hash(tag, data) bytes."""
    if not isinstance(tag, str) or not tag:
        raise ValueError("Tag must be a non-empty string")

    tag_hash = _TAG_HASH_CACHE.get(tag)
    if tag_hash is None:
        tag_hash = hashlib.sha256(tag.encode("utf-8")).digest()
        if tag in _KNOWN_PROTOCOL_TAGS:
            _TAG_HASH_CACHE[tag] = tag_hash
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


def _private_key_int_from_bytes(priv_bytes: bytes, *, name: str = "private key") -> int:
    if len(priv_bytes) != 32:
        raise ValueError(f"{name.capitalize()} must be exactly 32 bytes (64 hex characters)")
    d = int.from_bytes(priv_bytes, "big")
    if not 1 <= d < _CURVE_ORDER:
        raise ValueError(f"{name.capitalize()} integer must be in the range [1, n-1]")
    return d


def _point_from_public_key(pub: bytes) -> ellipticcurve.Point:
    if len(pub) == 33:
        return _point_from_compressed(pub)

    if len(pub) != 65 or pub[0] != 4:
        raise ValueError("Public key must be compressed 33-byte or uncompressed 65-byte hex")

    x = int.from_bytes(pub[1:33], "big")
    y = int.from_bytes(pub[33:], "big")
    if not (0 <= x < _CURVE_P and 0 <= y < _CURVE_P):
        raise ValueError("Public key coordinates out of range")
    if (y * y - (pow(x, 3, _CURVE_P) + 7)) % _CURVE_P != 0:
        raise ValueError("Public key point is not on secp256k1")
    return ellipticcurve.Point(SECP256k1.curve, x, y)


def _hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    if length <= 0:
        raise ValueError("HKDF length must be positive")

    prk = hmac.new(salt or b"\x00" * hashlib.sha256().digest_size, ikm, hashlib.sha256).digest()
    out = b""
    t = b""
    counter = 1
    while len(out) < length:
        t = hmac.new(prk, t + info + bytes([counter]), hashlib.sha256).digest()
        out += t
        counter += 1
    return out[:length]


def _ecies_stream_xor(key: bytes, data: bytes) -> bytes:
    stream = b""
    counter = 0
    while len(stream) < len(data):
        block_input = b"rawbit-ecies-stream-v1" + counter.to_bytes(4, "big")
        stream += hmac.new(key, block_input, hashlib.sha256).digest()
        counter += 1
    return bytes(a ^ b for a, b in zip(data, stream))


def _ecies_shared_secret(priv_int: int, peer_point: ellipticcurve.Point) -> bytes:
    shared = peer_point * priv_int
    if shared == ellipticcurve.INFINITY:
        raise ValueError("Invalid ECDH shared point")
    return _int_to_32(shared.x())


def _ecies_key_material(
    shared_secret: bytes,
    salt: bytes,
    ephemeral_pubkey: bytes,
    recipient_pubkey: bytes,
    aad: bytes,
) -> tuple[bytes, bytes, bytes]:
    aad_hash = hashlib.sha256(aad).digest()
    info = b"rawbit-ecies-v1" + ephemeral_pubkey + recipient_pubkey + aad_hash
    material = _hkdf_sha256(shared_secret, salt, info, 64)
    return material[:32], material[32:], aad_hash


def _ecies_deterministic_material(
    recipient_pubkey: bytes, plaintext: bytes, aad: bytes
) -> tuple[int, bytes]:
    """
    Derive the ephemeral scalar and salt deterministically from the message.

    RFC6979-style synthetic determinism: binding the ephemeral key + salt to
    (recipient || aad || plaintext) makes identical inputs reproduce byte-for-byte
    (essential for rawBit's reproducible flows), while ANY change in the recipient,
    plaintext, or aad yields fresh ephemeral material -- so the keystream is never
    reused across distinct messages (no two-time pad).
    """
    seed = hmac.new(
        b"rawbit-ecies-det-v1",
        recipient_pubkey + b"\x00" + hashlib.sha256(aad).digest() + b"\x00" + plaintext,
        hashlib.sha256,
    ).digest()
    eph_bytes = hmac.new(seed, b"ephemeral-key", hashlib.sha256).digest()
    eph_int = (int.from_bytes(eph_bytes, "big") % (_CURVE_ORDER - 1)) + 1
    salt = hmac.new(seed, b"salt", hashlib.sha256).digest()[:_ECIES_SALT_LEN]
    return eph_int, salt


def ecies_encrypt(vals: list[str]) -> str:
    """
    ECIES-style authenticated encryption on secp256k1.

    vals[0]: recipient public key, compressed or uncompressed hex
    vals[1]: plaintext hex
    vals[2]: optional associated data hex
    vals[3]: optional ephemeral private key hex (overrides the deterministic default)
    vals[4]: optional 16-byte salt hex (overrides the deterministic default)

    By default the ephemeral key and salt are derived deterministically from the
    message (recipient || aad || plaintext), so identical inputs always produce the
    identical envelope -- byte-exact reproducibility for rawBit flows -- while
    distinct messages still get distinct ephemeral material (no keystream reuse).
    vals[3]/vals[4] remain available to pin specific values for demos.

    Returns a hex envelope:
      magic || ephemeral_pubkey || salt || ciphertext || tag
    """
    if len(vals) < 2:
        raise ValueError(
            "Need [recipientPubKeyHex, plaintextHex, aadHex?, ephemeralPrivKeyHex?, saltHex?]"
        )

    recipient_raw = _bytes_from_even_hex(str(vals[0]).strip(), name="recipient public key")
    recipient_point = _point_from_public_key(recipient_raw)
    recipient_pubkey = _point_to_compressed(recipient_point)
    plaintext = _bytes_from_even_hex(str(vals[1]), name="plaintext")
    aad = _bytes_from_even_hex(str(vals[2]), name="associated data") if len(vals) > 2 and str(vals[2]).strip() else b""

    det_eph_int, det_salt = _ecies_deterministic_material(recipient_pubkey, plaintext, aad)

    eph_raw = str(vals[3]).strip() if len(vals) > 3 else ""
    if eph_raw:
        eph_int = _private_key_int_from_bytes(
            _bytes_from_even_hex(eph_raw, name="ephemeral private key"),
            name="ephemeral private key",
        )
    else:
        eph_int = det_eph_int

    salt_raw = str(vals[4]).strip() if len(vals) > 4 else ""
    salt = _bytes_from_even_hex(salt_raw, name="salt") if salt_raw else det_salt
    if len(salt) != _ECIES_SALT_LEN:
        raise ValueError("Salt must be exactly 16 bytes (32 hex characters)")

    ephemeral_pubkey = _point_to_compressed(_CURVE_GEN * eph_int)
    shared_secret = _ecies_shared_secret(eph_int, recipient_point)
    enc_key, mac_key, aad_hash = _ecies_key_material(
        shared_secret, salt, ephemeral_pubkey, recipient_pubkey, aad
    )

    ciphertext = _ecies_stream_xor(enc_key, plaintext)
    header = _ECIES_MAGIC + ephemeral_pubkey + salt
    tag = hmac.new(mac_key, header + aad_hash + ciphertext, hashlib.sha256).digest()
    return (header + ciphertext + tag).hex()


def ecies_decrypt(vals: list[str]) -> str:
    """
    Decrypt a rawBit ECIES envelope.

    vals[0]: recipient private key hex
    vals[1]: envelope hex from ECIES Encrypt
    vals[2]: optional associated data hex, must match encryption
    """
    if len(vals) < 2:
        raise ValueError("Need [recipientPrivKeyHex, envelopeHex, aadHex?]")

    priv_int = _private_key_int_from_bytes(
        _bytes_from_even_hex(str(vals[0]).strip(), name="recipient private key"),
        name="recipient private key",
    )
    envelope = _bytes_from_even_hex(str(vals[1]).strip(), name="envelope")
    min_len = len(_ECIES_MAGIC) + 33 + _ECIES_SALT_LEN + _ECIES_TAG_LEN
    if len(envelope) < min_len:
        raise ValueError("ECIES envelope is too short")
    if envelope[: len(_ECIES_MAGIC)] != _ECIES_MAGIC:
        raise ValueError("ECIES envelope has unknown magic/version")

    offset = len(_ECIES_MAGIC)
    ephemeral_pubkey = envelope[offset : offset + 33]
    offset += 33
    salt = envelope[offset : offset + _ECIES_SALT_LEN]
    offset += _ECIES_SALT_LEN
    ciphertext = envelope[offset:-_ECIES_TAG_LEN]
    tag = envelope[-_ECIES_TAG_LEN:]

    ephemeral_point = _point_from_compressed(ephemeral_pubkey)
    recipient_pubkey = _point_to_compressed(_CURVE_GEN * priv_int)
    aad = _bytes_from_even_hex(str(vals[2]), name="associated data") if len(vals) > 2 and str(vals[2]).strip() else b""

    shared_secret = _ecies_shared_secret(priv_int, ephemeral_point)
    enc_key, mac_key, aad_hash = _ecies_key_material(
        shared_secret, salt, ephemeral_pubkey, recipient_pubkey, aad
    )
    expected_tag = hmac.new(mac_key, envelope[:offset] + aad_hash + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expected_tag):
        raise ValueError("ECIES authentication failed")

    return _ecies_stream_xor(enc_key, ciphertext).hex()


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


_MAX_BLOCK_MERKLE_LEAVES = 99


def bitcoin_merkle_tree(vals: list) -> str:
    """
    Build Bitcoin's ordered transaction Merkle tree from internal hash bytes.

    ``vals`` contains transaction hashes in block order. Each value is already
    a 32-byte SHA256d digest in the byte order used internally by the block
    header; displayed TXIDs must therefore be reversed before they are passed
    here.

    At every level, adjacent entries are paired without sorting and each parent
    is ``SHA256d(left || right)``. If the level has an odd number of entries,
    its final entry is duplicated before hashing.

    ``mutated`` matches Bitcoin Core's ``ComputeMerkleRoot`` rule: equality is
    checked only for aligned, caller-supplied pairs before odd-level padding.
    A synthetic duplicate never sets the flag, while identical real pairs at
    any level do (CVE-2012-2459). Like Core, this function only *reports* the
    mutation — the graph layer plays CheckBlock and refuses to hand the
    colliding root to downstream nodes.
    """
    if not vals:
        raise ValueError("Provide at least one transaction hash")
    if len(vals) > _MAX_BLOCK_MERKLE_LEAVES:
        raise ValueError(
            f"Bitcoin Block Merkle Tree supports at most "
            f"{_MAX_BLOCK_MERKLE_LEAVES} transaction hashes"
        )

    leaf_hash_inputs = [str(value).strip() for value in vals]
    if any(value == "" for value in leaf_hash_inputs):
        raise ValueError("Transaction hashes cannot be empty")

    leaf_hashes: list[bytes] = []
    for index, hash_hex in enumerate(leaf_hash_inputs):
        hash_bytes = _bytes_from_even_hex(
            hash_hex, name=f"transaction hash {index}"
        )
        if len(hash_bytes) != 32:
            raise ValueError(
                "Transaction hashes must be 32 bytes (64 hex characters)"
            )
        leaf_hashes.append(hash_bytes)

    def make_leaf(index: int, hash_bytes: bytes) -> dict[str, Any]:
        label = f"TX{index}"
        return {
            "hash": hash_bytes,
            "label": label,
            "structure": label,
            "leafIndex": index,
        }

    def make_duplicate(node: dict[str, Any]) -> dict[str, Any]:
        # The duplicate is a copy of the hash at this level, not another input.
        # Keep it collapsed in the structured tree so a large copied subtree is
        # clearly represented as one synthetic node rather than repeated data.
        return {
            "hash": node["hash"],
            "label": node["label"],
            "structure": node["structure"],
            "duplicated": True,
            "duplicateOf": node["label"],
        }

    def serialize_node(node: dict[str, Any]) -> dict[str, Any]:
        serialized: dict[str, Any] = {
            "hash": node["hash"].hex(),
            "label": node["label"],
        }
        for key in ("leafIndex", "duplicated", "duplicateOf"):
            if key in node:
                serialized[key] = node[key]
        if "left" in node:
            serialized["left"] = serialize_node(node["left"])
            serialized["right"] = serialize_node(node["right"])
        return serialized

    def abbreviated(hash_bytes: bytes) -> str:
        return f"{hash_bytes.hex()[:12]}…"

    current = [
        make_leaf(index, hash_bytes)
        for index, hash_bytes in enumerate(leaf_hashes)
    ]
    levels: list[list[str]] = []
    level_labels: list[list[str]] = []
    duplicated_indices: list[list[int]] = []
    odd_duplications: list[dict[str, Any]] = []
    pairs: list[dict[str, Any]] = []
    mutated_pairs: list[dict[str, Any]] = []
    mutated = False
    level_index = 0

    while len(current) > 1:
        # Bitcoin Core checks equality before adding the synthetic odd entry.
        for pair_start in range(0, len(current) - 1, 2):
            if current[pair_start]["hash"] == current[pair_start + 1]["hash"]:
                mutated = True
                mutated_pairs.append(
                    {
                        "level": level_index,
                        "leftIndex": pair_start,
                        "rightIndex": pair_start + 1,
                        "hash": current[pair_start]["hash"].hex(),
                    }
                )

        working = list(current)
        duplicate_positions: list[int] = []
        if len(working) % 2:
            source = working[-1]
            duplicate = make_duplicate(source)
            working.append(duplicate)
            duplicate_index = len(working) - 1
            duplicate_positions.append(duplicate_index)
            odd_duplications.append(
                {
                    "level": level_index,
                    "sourceIndex": duplicate_index - 1,
                    "duplicateIndex": duplicate_index,
                    "hash": source["hash"].hex(),
                    "label": source["label"],
                }
            )

        levels.append([node["hash"].hex() for node in working])
        level_labels.append([node["label"] for node in working])
        duplicated_indices.append(duplicate_positions)

        next_level: list[dict[str, Any]] = []
        pair_count = len(working) // 2
        for pair_index in range(pair_count):
            left_index = pair_index * 2
            right_index = left_index + 1
            left = working[left_index]
            right = working[right_index]
            parent_hash = hashlib.sha256(
                hashlib.sha256(left["hash"] + right["hash"]).digest()
            ).digest()
            is_root = pair_count == 1
            parent_label = "ROOT" if is_root else f"H{level_index + 1}.{pair_index}"
            parent = {
                "hash": parent_hash,
                "label": parent_label,
                "structure": f"({left['structure']},{right['structure']})",
                "left": left,
                "right": right,
            }
            next_level.append(parent)

            synthetic_right = bool(right.get("duplicated"))
            pair_record = {
                "level": level_index,
                "pairIndex": pair_index,
                "leftIndex": left_index,
                "rightIndex": right_index,
                "leftHash": left["hash"].hex(),
                "rightHash": right["hash"].hex(),
                "parentHash": parent_hash.hex(),
                "syntheticRight": synthetic_right,
                "equal": left["hash"] == right["hash"],
                "mutation": (
                    left["hash"] == right["hash"] and not synthetic_right
                ),
            }
            pairs.append(pair_record)

        current = next_level
        level_index += 1

    root_node = current[0]
    root_node["label"] = "ROOT"
    levels.append([root_node["hash"].hex()])
    level_labels.append(["ROOT"])
    duplicated_indices.append([])

    tree = serialize_node(root_node)

    display_lines = [
        f"Transactions: {len(leaf_hashes)}",
        f"Odd duplications: {len(odd_duplications)}",
        f"Mutated: {'true' if mutated else 'false'}",
        f"Merkle root (internal): {root_node['hash'].hex()}",
        "",
        "Tree:",
    ]

    def append_ascii(
        node: dict[str, Any],
        prefix: str = "",
        is_last: bool = True,
        is_root: bool = True,
    ) -> None:
        connector = "" if is_root else ("└─ " if is_last else "├─ ")
        display_label = node["label"]
        if node.get("duplicated"):
            display_label = f"{display_label} (duplicate)"
        display_lines.append(
            f"{prefix}{connector}{display_label}  {abbreviated(node['hash'])}"
        )
        if "left" not in node:
            return
        child_prefix = prefix if is_root else prefix + ("   " if is_last else "│  ")
        append_ascii(node["left"], child_prefix, False, False)
        append_ascii(node["right"], child_prefix, True, False)

    append_ascii(root_node)

    return json.dumps(
        {
            "root": root_node["hash"].hex(),
            "mutated": mutated,
            "leafCount": len(leaf_hashes),
            "leafHashes": [hash_bytes.hex() for hash_bytes in leaf_hashes],
            "levels": levels,
            "levelLabels": level_labels,
            "duplicatedIndices": duplicated_indices,
            "duplicateCount": len(odd_duplications),
            "oddDuplications": odd_duplications,
            "pairs": pairs,
            "mutatedPairs": mutated_pairs,
            "structure": root_node["structure"],
            "tree": tree,
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

    # bitcointx parses nValue/nVersion signed ("<q"/"<i"); pack the same way
    # so bit-63/bit-31 values round-trip instead of raising struct.error.
    outputs_ser = b"".join(
        struct.pack("<q", txout.nValue)
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
        + struct.pack("<i", tx.nVersion)
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


def radio_send(vals: list) -> str:
    """Publish the first value for a wireless canvas link."""
    if not vals:
        return ""
    return "" if vals[0] is None else str(vals[0])


def radio_receive(val: Any) -> Any:
    """Return the value received from a matching wireless canvas link."""
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


def entropy_to_bip39_mnemonic(val: str) -> str:
    """
    Convert BIP39 entropy hex into an English mnemonic.

    BIP39 accepts entropy lengths of 128, 160, 192, 224, or 256 bits.
    A 32-byte entropy input produces a 24-word mnemonic.
    """
    entropy = _bytes_from_even_hex(val, name="entropy")
    if len(entropy) not in (16, 20, 24, 28, 32):
        raise ValueError(
            "BIP39 entropy must be 16, 20, 24, 28, or 32 bytes "
            f"(got {len(entropy)})"
        )

    entropy_bit_len = len(entropy) * 8
    checksum_bit_len = entropy_bit_len // 32
    checksum = hashlib.sha256(entropy).digest()

    entropy_bits = f"{int.from_bytes(entropy, 'big'):0{entropy_bit_len}b}"
    checksum_bits = f"{checksum[0]:08b}"[:checksum_bit_len]
    mnemonic_bits = entropy_bits + checksum_bits

    words = [
        _BIP39_ENGLISH_WORDLIST[int(mnemonic_bits[offset : offset + 11], 2)]
        for offset in range(0, len(mnemonic_bits), 11)
    ]
    return " ".join(words)


def _bip39_mnemonic_to_entropy(mnemonic: str) -> bytes:
    words = mnemonic.split()
    if len(words) not in (12, 15, 18, 21, 24):
        raise ValueError("BIP39 mnemonic must contain 12, 15, 18, 21, or 24 words")

    bits = ""
    for word in words:
        index = _BIP39_ENGLISH_INDEX.get(word)
        if index is None:
            raise ValueError(f"Unknown BIP39 word: {word!r}")
        bits += f"{index:011b}"

    checksum_bit_len = len(words) // 3
    entropy_bit_len = len(bits) - checksum_bit_len
    entropy_bits = bits[:entropy_bit_len]
    checksum_bits = bits[entropy_bit_len:]

    entropy = int(entropy_bits, 2).to_bytes(entropy_bit_len // 8, "big")
    expected_checksum = f"{hashlib.sha256(entropy).digest()[0]:08b}"[:checksum_bit_len]
    if checksum_bits != expected_checksum:
        raise ValueError("Invalid BIP39 mnemonic checksum")
    return entropy


def bip39_mnemonic_to_seed(vals: list[str]) -> str:
    """
    Derive the 64-byte BIP39 seed from an English mnemonic.

    vals[0]: mnemonic words
    vals[1]: optional passphrase

    BIP39 uses PBKDF2-HMAC-SHA512 with 2048 rounds and salt
    "mnemonic" + passphrase, with both strings NFKD-normalized.
    """
    if not vals:
        raise ValueError("Need [mnemonic, passphrase?]")

    mnemonic = " ".join(str(vals[0]).strip().split())
    if not mnemonic:
        raise ValueError("Mnemonic is required")
    try:
        _bip39_mnemonic_to_entropy(mnemonic)
    except ValueError as exc:
        raise ValueError(f"Invalid BIP39 mnemonic or checksum: {exc}") from exc

    passphrase = "" if len(vals) < 2 or vals[1] is None else str(vals[1])
    password = unicodedata.normalize("NFKD", mnemonic).encode("utf-8")
    salt = unicodedata.normalize("NFKD", "mnemonic" + passphrase).encode("utf-8")
    return _pbkdf2_hmac_sha512(password, salt, 2048, 64).hex()


def _parse_bip32_path(path: str) -> list[int]:
    path = str(path).strip()
    if path in ("", "m", "M"):
        return []
    if not path.startswith(("m/", "M/")):
        raise ValueError("BIP32 path must start with m/")

    out: list[int] = []
    for raw_part in path[2:].split("/"):
        part = raw_part.strip()
        if not part:
            raise ValueError("BIP32 path contains an empty component")

        hardened = part[-1:] in ("'", "h", "H")
        if hardened:
            part = part[:-1]
        if not part.isdigit():
            raise ValueError(f"Invalid BIP32 path component: {raw_part!r}")

        index = int(part, 10)
        if index >= _BIP32_HARDENED:
            raise ValueError("BIP32 path index must be less than 2^31")
        out.append(index + (_BIP32_HARDENED if hardened else 0))
    return out


def _bip32_master_from_seed(seed: bytes) -> tuple[int, bytes]:
    if not (16 <= len(seed) <= 64):
        raise ValueError(f"BIP32 seed must be 16 to 64 bytes (got {len(seed)})")
    digest = _hmac_sha512(b"Bitcoin seed", seed)
    priv_int = int.from_bytes(digest[:32], "big")
    if not 1 <= priv_int < _CURVE_ORDER:
        raise ValueError("Invalid BIP32 master key derived from seed")
    return priv_int, digest[32:]


def _bip32_ckd_priv(parent_priv: int, parent_chain_code: bytes, index: int) -> tuple[int, bytes]:
    if index >= _BIP32_HARDENED:
        data = b"\x00" + _int_to_32(parent_priv) + index.to_bytes(4, "big")
    else:
        data = _point_to_compressed(_CURVE_GEN * parent_priv) + index.to_bytes(4, "big")

    digest = _hmac_sha512(parent_chain_code, data)
    left_int = int.from_bytes(digest[:32], "big")
    child_priv = (left_int + parent_priv) % _CURVE_ORDER
    if left_int >= _CURVE_ORDER or child_priv == 0:
        raise ValueError("Invalid BIP32 child key derived at this path")
    return child_priv, digest[32:]


def bip32_derive_private_key(vals: list[str]) -> str:
    """
    Derive a BIP32 child private key from a seed and path.

    vals[0]: seed hex, typically the 64-byte BIP39 seed
    vals[1]: derivation path, e.g. m/44'/1'/0'/0/0
    """
    if len(vals) < 2:
        raise ValueError("Need [seedHex, path]")

    seed = _bytes_from_even_hex(vals[0], name="BIP32 seed")
    path = str(vals[1]).strip()
    priv_int, chain_code = _bip32_master_from_seed(seed)
    for index in _parse_bip32_path(path):
        priv_int, chain_code = _bip32_ckd_priv(priv_int, chain_code, index)
    return _int_to_32(priv_int).hex()


_TREZOR_GROUP_STRIDE = 100
_TREZOR_UINT32_MAX = 0xFFFFFFFF
_TREZOR_INPUT_SCRIPT_TYPES = {
    "SPENDADDRESS",
    "SPENDWITNESS",
    "SPENDP2SHWITNESS",
    "SPENDTAPROOT",
}
_TREZOR_OUTPUT_SCRIPT_TYPES = {
    "PAYTOADDRESS",
    "PAYTOWITNESS",
    "PAYTOP2SHWITNESS",
    "PAYTOTAPROOT",
}


def _trezor_raw_value(vals: Any, index: int) -> str:
    if isinstance(vals, dict):
        raw = vals.get(str(index), vals.get(index, ""))
    elif isinstance(vals, list):
        raw = vals[index] if index < len(vals) else ""
    else:
        raw = ""
    if raw in ("__EMPTY__", "__NULL__", None):
        return ""
    return str(raw)


def _trezor_group_bases(
    vals: Any,
    *,
    start: int,
    end: int,
    field_offsets: set[int],
) -> list[int]:
    if not isinstance(vals, dict):
        return []

    bases: set[int] = set()
    for key in vals:
        try:
            index = int(key)
        except Exception:
            continue
        if index < start or index >= end:
            continue
        for offset in field_offsets:
            base = index - offset
            if base >= start and base < end and (base - start) % _TREZOR_GROUP_STRIDE == 0:
                bases.add(base)
    return sorted(bases)


def _parse_trezor_uint(
    val: Any,
    *,
    name: str,
    max_value: int,
    required: bool = True,
) -> int | None:
    raw = "" if val is None else str(val).strip()
    if not raw:
        if required:
            raise ValueError(f"{name} is required")
        return None
    compact = _WS_RE.sub("", raw)
    if not _INT_DEC_RE.match(compact):
        raise ValueError(f"{name} must be a decimal integer")
    parsed = int(compact, 10)
    if not 0 <= parsed <= max_value:
        raise ValueError(f"{name} must be between 0 and {max_value}")
    return parsed


def _parse_trezor_sequence(val: Any, *, name: str = "sequence") -> int:
    raw = "" if val is None else str(val).strip()
    if not raw:
        return _TREZOR_UINT32_MAX
    compact = _WS_RE.sub("", raw)
    lower = compact.lower()
    format_hint = (
        f"{name} must be decimal or 8-character display-order hex "
        "such as ffffffff or fffffffd"
    )

    if lower.startswith(("le:", "0x")):
        raise ValueError(format_hint)

    if _INT_DEC_RE.match(compact):
        if not _UINT_DEC_NO_LEADING_ZERO_RE.match(compact):
            raise ValueError(
                f"{name} decimal form must not use leading zeroes; "
                "use display-order hex such as fffffffd for common policy values"
            )
        parsed = int(compact, 10)
        if not 0 <= parsed <= _TREZOR_UINT32_MAX:
            raise ValueError(f"{name} must be between 0 and {_TREZOR_UINT32_MAX}")
        return parsed

    if _HEX_RE.match(compact):
        if len(compact) != 8:
            raise ValueError(f"{name} hex must be exactly 8 characters")
        if not lower.startswith("ffff"):
            raise ValueError(
                f"{name} hex must be display-order policy hex like fffffffd; "
                "use decimal for custom sequence values and do not use serialized little-endian bytes"
            )
        return int(lower, 16)
    raise ValueError(format_hint)


def _looks_like_bip32_path(raw: Any) -> bool:
    value = "" if raw is None else str(raw).strip()
    return value in ("m", "M") or value.startswith(("m/", "M/"))


def _parse_trezor_path_address_n(path: str, *, name: str = "Derivation path") -> list[int]:
    value = str(path).strip()
    if not value:
        raise ValueError(f"{name} is required")
    return [int(index) for index in _parse_bip32_path(value)]


def _trezor_path_purpose(address_n: list[int]) -> int | None:
    if not address_n:
        return None
    first = address_n[0]
    if first < _BIP32_HARDENED:
        return None
    return first - _BIP32_HARDENED


def _infer_trezor_input_script_type(address_n: list[int]) -> str:
    purpose = _trezor_path_purpose(address_n)
    if purpose == 49:
        return "SPENDP2SHWITNESS"
    if purpose == 84:
        return "SPENDWITNESS"
    if purpose == 86:
        return "SPENDTAPROOT"
    return "SPENDADDRESS"


def _infer_trezor_output_script_type(address_n: list[int]) -> str:
    purpose = _trezor_path_purpose(address_n)
    if purpose == 49:
        return "PAYTOP2SHWITNESS"
    if purpose == 84:
        return "PAYTOWITNESS"
    if purpose == 86:
        return "PAYTOTAPROOT"
    return "PAYTOADDRESS"


def _trezor_script_type(
    raw: Any,
    *,
    inferred: str,
    allowed: set[str],
    name: str,
) -> str:
    value = "" if raw is None else str(raw).strip().upper()
    if not value or value == "AUTO":
        return inferred
    if value not in allowed:
        raise ValueError(f"{name} must be one of: AUTO, {', '.join(sorted(allowed))}")
    return value


def _clean_required_trezor_hex(raw: Any, *, name: str, byte_len: int | None = None) -> str:
    value = _WS_RE.sub("", "" if raw is None else str(raw).strip()).lower()
    if not value:
        raise ValueError(f"{name} is required")
    data = _bytes_from_even_hex(value, name=name)
    if byte_len is not None and len(data) != byte_len:
        raise ValueError(f"{name} must be exactly {byte_len} bytes")
    return data.hex()


def _reverse_hex_bytes(hex_value: str) -> str:
    return bytes.fromhex(hex_value)[::-1].hex()


class _TrezorTxReader:
    def __init__(self, data: bytes):
        self.data = data
        self.offset = 0

    @property
    def remaining(self) -> int:
        return len(self.data) - self.offset

    def peek(self, index: int = 0) -> int:
        return self.data[self.offset + index]

    def read(self, length: int) -> bytes:
        if length < 0 or self.offset + length > len(self.data):
            raise ValueError("previous raw transaction ended unexpectedly")
        out = self.data[self.offset : self.offset + length]
        self.offset += length
        return out

    def read_u32_le(self) -> int:
        return int.from_bytes(self.read(4), "little")

    def read_u64_le(self) -> int:
        return int.from_bytes(self.read(8), "little")

    def read_varint(self) -> int:
        first = self.read(1)[0]
        if first < 0xFD:
            return first
        if first == 0xFD:
            return int.from_bytes(self.read(2), "little")
        if first == 0xFE:
            return self.read_u32_le()
        value = self.read_u64_le()
        if value > 2**53 - 1:
            raise ValueError("CompactSize value is too large")
        return value


def _parse_previous_raw_transaction(raw_tx_hex: Any) -> dict[str, Any]:
    raw_hex = _clean_required_trezor_hex(raw_tx_hex, name="previous raw transaction")
    raw = bytes.fromhex(raw_hex)
    reader = _TrezorTxReader(raw)
    version = reader.read_u32_le()

    has_witness = False
    if reader.remaining >= 2 and reader.peek(0) == 0x00 and reader.peek(1) != 0x00:
        reader.read(2)
        has_witness = True

    input_output_start = reader.offset
    input_count = reader.read_varint()
    inputs: list[dict[str, Any]] = []
    for input_number in range(input_count):
        prev_hash = reader.read(32)[::-1].hex()
        prev_index = reader.read_u32_le()
        script_len = reader.read_varint()
        script_sig = reader.read(script_len).hex()
        sequence = reader.read_u32_le()
        tx_input: dict[str, Any] = {
            "prev_hash": prev_hash,
            "prev_index": prev_index,
            "sequence": sequence,
            "script_sig": script_sig,
        }
        inputs.append(tx_input)

    output_count = reader.read_varint()
    bin_outputs: list[dict[str, Any]] = []
    for output_number in range(output_count):
        amount = reader.read_u64_le()
        script_len = reader.read_varint()
        script_pubkey = reader.read(script_len).hex()
        bin_outputs.append({"amount": amount, "script_pubkey": script_pubkey})

    input_output_end = reader.offset
    if has_witness:
        for input_number in range(input_count):
            item_count = reader.read_varint()
            for item_number in range(item_count):
                item_len = reader.read_varint()
                reader.read(item_len)

    locktime_start = reader.offset
    lock_time = reader.read_u32_le()
    if reader.remaining:
        raise ValueError("previous raw transaction has trailing bytes")

    if has_witness:
        raw_no_witness = (
            raw[:4] + raw[input_output_start:input_output_end] + raw[locktime_start:locktime_start + 4]
        )
    else:
        raw_no_witness = raw
    txid = hashlib.sha256(hashlib.sha256(raw_no_witness).digest()).digest()[::-1].hex()

    return {
        "hash": txid,
        "version": version,
        "lock_time": lock_time,
        "inputs": inputs,
        "bin_outputs": bin_outputs,
    }


def _build_trezor_input(vals: Any, base: int, input_number: int, refs_by_hash: dict[str, dict[str, Any]]) -> dict[str, Any]:
    address_n = _parse_trezor_path_address_n(
        _trezor_raw_value(vals, base),
        name=f"input[{input_number}] derivation path",
    )
    prev_hash = _clean_required_trezor_hex(
        _trezor_raw_value(vals, base + 10),
        name=f"input[{input_number}] previous txid",
        byte_len=32,
    )
    prev_index = _parse_trezor_uint(
        _trezor_raw_value(vals, base + 20),
        name=f"input[{input_number}] previous output index",
        max_value=_TREZOR_UINT32_MAX,
    )
    amount = _parse_trezor_uint(
        _trezor_raw_value(vals, base + 30),
        name=f"input[{input_number}] amount",
        max_value=2**64 - 1,
    )
    sequence = _parse_trezor_sequence(
        _trezor_raw_value(vals, base + 40),
        name=f"input[{input_number}] sequence",
    )
    script_type = _trezor_script_type(
        _trezor_raw_value(vals, base + 50),
        inferred=_infer_trezor_input_script_type(address_n),
        allowed=_TREZOR_INPUT_SCRIPT_TYPES,
        name=f"input[{input_number}] script type",
    )

    ref_tx = refs_by_hash.get(prev_hash)
    reversed_ref_tx = refs_by_hash.get(_reverse_hex_bytes(prev_hash))
    if ref_tx:
        outputs = ref_tx.get("bin_outputs", [])
        if prev_index is None or prev_index >= len(outputs):
            raise ValueError(
                f"input[{input_number}] previous output index is out of range for previous raw transaction"
            )
        if outputs[prev_index]["amount"] != amount:
            raise ValueError(
                f"input[{input_number}] amount does not match previous raw transaction output amount"
            )
    elif script_type != "SPENDTAPROOT":
        if reversed_ref_tx:
            raise ValueError(
                f"input[{input_number}] previous txid appears byte-reversed; use display-order txid {reversed_ref_tx['hash']}"
            )
        raise ValueError(f"previous raw transaction for input[{input_number}] is required")

    return {
        "address_n": address_n,
        "prev_hash": prev_hash,
        "prev_index": prev_index,
        "amount": amount,
        "sequence": sequence,
        "script_type": script_type,
    }


def _build_trezor_output(vals: Any, base: int, output_number: int) -> dict[str, Any]:
    destination = _trezor_raw_value(vals, base).strip()
    if not destination:
        raise ValueError(f"output[{output_number}] destination is required")
    amount = _parse_trezor_uint(
        _trezor_raw_value(vals, base + 10),
        name=f"output[{output_number}] amount",
        max_value=2**64 - 1,
    )

    if not _looks_like_bip32_path(destination):
        requested = _trezor_raw_value(vals, base + 20).strip().upper()
        if requested and requested not in ("AUTO", "PAYTOADDRESS"):
            raise ValueError(f"output[{output_number}] address outputs must use AUTO or PAYTOADDRESS")
        return {
            "address": destination,
            "amount": amount,
            "script_type": "PAYTOADDRESS",
        }

    address_n = _parse_trezor_path_address_n(
        destination,
        name=f"output[{output_number}] change path",
    )
    return {
        "address_n": address_n,
        "amount": amount,
        "script_type": _trezor_script_type(
            _trezor_raw_value(vals, base + 20),
            inferred=_infer_trezor_output_script_type(address_n),
            allowed=_TREZOR_OUTPUT_SCRIPT_TYPES,
            name=f"output[{output_number}] script type",
        ),
    }


def build_trezor_sign_transaction_params(vals: Any) -> str:
    """
    Build the exact Trezor Connect signTransaction params JSON.

    This node intentionally uses dynamic INPUTS[] / OUTPUTS[] groups as the
    source of truth. There are no editable count fields.
    """
    if not isinstance(vals, dict):
        raise ValueError("Trezor signTransaction params builder requires indexed inputs")

    coin = _trezor_raw_value(vals, 0).strip() or "testnet"
    version = _parse_trezor_uint(_trezor_raw_value(vals, 1), name="version", max_value=_TREZOR_UINT32_MAX)
    locktime = _parse_trezor_uint(_trezor_raw_value(vals, 2), name="locktime", max_value=_TREZOR_UINT32_MAX)

    input_bases = _trezor_group_bases(
        vals,
        start=1000,
        end=3000,
        field_offsets={0, 10, 20, 30, 40, 50},
    )
    output_bases = _trezor_group_bases(
        vals,
        start=3000,
        end=5000,
        field_offsets={0, 10, 20},
    )
    raw_tx_bases = _trezor_group_bases(vals, start=5000, end=7000, field_offsets={0})

    if not input_bases:
        raise ValueError("INPUTS[] must contain at least one item")
    if not output_bases:
        raise ValueError("OUTPUTS[] must contain at least one item")

    ref_txs: list[dict[str, Any]] = []
    refs_by_hash: dict[str, dict[str, Any]] = {}
    for base in raw_tx_bases:
        raw_tx = _trezor_raw_value(vals, base).strip()
        if not raw_tx:
            continue
        ref_tx = _parse_previous_raw_transaction(raw_tx)
        if ref_tx["hash"] not in refs_by_hash:
            refs_by_hash[ref_tx["hash"]] = ref_tx
            ref_txs.append(ref_tx)

    params = {
        "coin": coin,
        "version": version,
        "locktime": locktime,
        "inputs": [
            _build_trezor_input(vals, base, input_number, refs_by_hash)
            for input_number, base in enumerate(input_bases)
        ],
        "outputs": [
            _build_trezor_output(vals, base, output_number)
            for output_number, base in enumerate(output_bases)
        ],
        "refTxs": ref_txs,
    }
    return json.dumps(params, indent=2)


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


def sighash_type_to_le4(val: str) -> str:
    """
    Convert a standard legacy/SegWit ECDSA SIGHASH type byte to the
    4-byte little-endian uint32 suffix appended to the signing preimage.

    This accepts the one-byte hex forms used in signatures, e.g.:
    - 01: SIGHASH_ALL
    - 02: SIGHASH_NONE
    - 03: SIGHASH_SINGLE
    - 81: SIGHASH_ALL | ANYONECANPAY
    - 82: SIGHASH_NONE | ANYONECANPAY
    - 83: SIGHASH_SINGLE | ANYONECANPAY
    """
    raw = str(val).strip().lower()
    if raw.startswith("0x"):
        raw = raw[2:]

    if not raw:
        raise ValueError("SIGHASH type is required")
    if len(raw) != 2:
        raise ValueError("SIGHASH type must be exactly one byte, e.g. 01 or 81")

    try:
        sighash_type = int(raw, 16)
    except ValueError as exc:
        raise ValueError("SIGHASH type must be hex, e.g. 01 or 81") from exc

    base_type = sighash_type & 0x1F
    allowed_extra_bits = 0x80
    extra_bits = sighash_type & ~0x1F

    if base_type not in {0x01, 0x02, 0x03} or extra_bits not in {0, allowed_extra_bits}:
        raise ValueError(
            "Unsupported SIGHASH type. Use 01, 02, 03, 81, 82, or 83 "
            "for legacy/SegWit ECDSA signatures."
        )

    return sighash_type.to_bytes(4, "little").hex()



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


# Bitcoin's difficulty-1 target (the target encoded by 0x1d00ffff).
_DIFFICULTY_ONE_TARGET = 0x00000000FFFF0000000000000000000000000000000000000000000000000000
_MAX_MINING_ATTEMPTS = 100
_MAX_UINT32 = 0xFFFFFFFF


def _fixed_hex_bytes(value: Any, *, name: str, byte_length: int) -> bytes:
    """Decode a fixed-width hex field while retaining the shared clear errors."""
    raw = _bytes_from_even_hex(str(value), name=name)
    if len(raw) != byte_length:
        raise ValueError(
            f"{name} must be exactly {byte_length} bytes "
            f"({byte_length * 2} hex characters)"
        )
    return raw


def _decode_compact_target(bits_value: Any) -> tuple[int, int, int]:
    """Decode Bitcoin's human/display-order compact target representation."""
    bits_raw = _fixed_hex_bytes(bits_value, name="compact bits", byte_length=4)
    compact = int.from_bytes(bits_raw, "big")
    exponent = compact >> 24
    encoded_mantissa = compact & 0x00FFFFFF
    mantissa = encoded_mantissa & 0x007FFFFF

    if (encoded_mantissa & 0x00800000) and mantissa != 0:
        raise ValueError(
            "Compact bits encodes a negative target: "
            "mantissa sign bit 0x00800000 is set"
        )
    # Match Bitcoin Core's SetCompact overflow rules. Sizes 33 and 34 can
    # still fit in 256 bits when the mantissa is correspondingly small.
    overflows = mantissa != 0 and (
        exponent > 34
        or (mantissa > 0xFF and exponent > 33)
        or (mantissa > 0xFFFF and exponent > 32)
    )
    if overflows:
        raise ValueError(
            f"Compact bits exponent {exponent} overflows a 256-bit target "
            f"with mantissa 0x{mantissa:06x}"
        )

    if exponent <= 3:
        target = mantissa >> (8 * (3 - exponent))
    else:
        target = mantissa << (8 * (exponent - 3))

    if target == 0:
        raise ValueError("Compact bits encodes a zero target")
    if target.bit_length() > 256:
        raise ValueError("Compact bits target overflows 256 bits")

    return target, exponent, mantissa


def _encode_compact_target(target: int) -> int:
    """Encode a positive uint256 using Bitcoin Core's GetCompact rules."""
    if target <= 0:
        raise ValueError("Target must be greater than zero")
    if target.bit_length() > 256:
        raise ValueError("Target overflows 256 bits")

    exponent = (target.bit_length() + 7) // 8
    if exponent <= 3:
        mantissa = target << (8 * (3 - exponent))
    else:
        mantissa = target >> (8 * (exponent - 3))

    # Compact targets reserve bit 23 as a sign bit. If the unsigned
    # coefficient would set it, shift the coefficient right by one byte and
    # increase the exponent, matching arith_uint256::GetCompact(false).
    if mantissa & 0x00800000:
        mantissa >>= 8
        exponent += 1

    return (exponent << 24) | (mantissa & 0x007FFFFF)


def _format_mining_difficulty(target: int) -> str:
    """Format difficulty without rounding easy teaching targets down to 0.00."""
    difficulty = Decimal(_DIFFICULTY_ONE_TARGET) / Decimal(target)
    if Decimal("0.01") <= difficulty < Decimal("1000000000000"):
        return format(difficulty, ".2f")
    return format(difficulty, ".8g")


def target_to_bits(vals: list[str]) -> str:
    """
    Encode a 256-bit proof-of-work target as compact display-order ``nBits``.

    vals[0]: target in 32-byte numeric/display-order hexadecimal

    Compact encoding retains only the target's most significant coefficient
    bytes. Consumers should decode the returned nBits with ``bits_to_target``
    and use that effective target for mining and proof-of-work validation.
    """
    if not vals or not str(vals[0]).strip():
        raise ValueError("Need [targetHex]")

    target_raw = _bytes_from_even_hex(str(vals[0]), name="target")
    if len(target_raw) != 32:
        candidate = int.from_bytes(target_raw, "big")
        if candidate.bit_length() > 256:
            raise ValueError("Target overflows 256 bits")
        raise ValueError(
            "target must be exactly 32 bytes (64 hex characters)"
        )
    target = int.from_bytes(target_raw, "big")
    compact = _encode_compact_target(target)
    return f"{compact:08x}"


def bits_to_target(vals: list[str]) -> str:
    """
    Expand Bitcoin compact ``nBits`` into a 256-bit target.

    vals[0]: compact bits in display order (4 bytes / 8 hex characters)

    The JSON bundle lets graph_logic expose the target as the main result and
    the derived difficulty through ``output-1``.
    """
    if not vals or not str(vals[0]).strip():
        raise ValueError("Need [compactBitsHex]")

    target, exponent, mantissa = _decode_compact_target(vals[0])
    target_hex = f"{target:064x}"
    return json.dumps(
        {
            "target": target_hex,
            "difficulty": _format_mining_difficulty(target),
            "exponent": exponent,
            "mantissa": f"{mantissa:06x}",
        },
        separators=(",", ":"),
    )


def _parse_mining_uint(value: Any, *, name: str) -> int:
    text = str(value).strip()
    if not _UINT_DEC_NO_LEADING_ZERO_RE.fullmatch(text):
        raise ValueError(f"{name} must be an unsigned decimal integer")
    return int(text, 10)


def mine_nonce_range(vals: list[str]) -> str:
    """
    Double-SHA256 a deterministic contiguous range of block-header nonces.

    vals[0]: 76-byte serialized header prefix (everything except nonce)
    vals[1]: starting nonce, unsigned decimal
    vals[2]: number of attempts, unsigned decimal (blank => 100; capped at 100)
    vals[3]: expanded 32-byte target, display-order hex
    """
    if len(vals) < 4:
        raise ValueError(
            "Need [headerPrefix76Hex, startNonce, attemptsPerBatch, targetHex]"
        )

    prefix = _fixed_hex_bytes(vals[0], name="header prefix", byte_length=76)
    start = _parse_mining_uint(vals[1], name="Start nonce")
    if start > _MAX_UINT32:
        raise ValueError(
            f"Start nonce must be between 0 and {_MAX_UINT32}; "
            "the 32-bit nonce space is exhausted"
        )

    attempts_text = str(vals[2]).strip()
    attempts_requested = (
        100
        if not attempts_text
        else _parse_mining_uint(attempts_text, name="Attempts")
    )
    if attempts_requested < 1:
        raise ValueError("Attempts must be at least 1")
    attempts = min(attempts_requested, _MAX_MINING_ATTEMPTS)

    target_bytes = _fixed_hex_bytes(vals[3], name="target", byte_length=32)
    target = int.from_bytes(target_bytes, "big")
    if target == 0:
        raise ValueError("Target must be greater than zero")

    # Do not wrap the uint32 nonce: exhausting it is the teachable point at
    # which miners must change coinbase extraNonce/time/version.
    stop = min(start + attempts, _MAX_UINT32 + 1)
    found_nonce: int | None = None
    found_hash = ""
    last_nonce = start
    last_hash = ""

    for nonce in range(start, stop):
        digest = hashlib.sha256(
            hashlib.sha256(prefix + struct.pack("<I", nonce)).digest()
        ).digest()
        last_nonce = nonce
        last_hash = digest[::-1].hex()
        if int.from_bytes(digest, "little") <= target:
            found_nonce = nonce
            found_hash = last_hash
            break

    # ``stop`` is always greater than ``start`` because attempts >= 1 and the
    # start nonce is constrained to uint32.
    tried_end = found_nonce if found_nonce is not None else last_nonce
    next_start = tried_end + 1
    found = found_nonce is not None
    nonce_display = str(found_nonce) if found else "-"
    hash_display = found_hash if found else "-"
    summary = "\n".join(
        (
            f"found: {'true' if found else 'false'}",
            f"nonce (decimal): {nonce_display}",
            f"block hash: {hash_display}",
            f"tried: {start}\u2026{tried_end}",
            f"next start: {next_start}",
        )
    )

    return json.dumps(
        {
            "summary": summary,
            "found": found,
            "nonce": found_nonce,
            "nonce_le": struct.pack("<I", found_nonce).hex() if found else "",
            "block_hash": found_hash,
            "last_hash": last_hash,
            "tried_start": start,
            "tried_end": tried_end,
            "attempts_requested": attempts_requested,
            "attempts": tried_end - start + 1,
            "attempts_cap": _MAX_MINING_ATTEMPTS,
            "next_start": next_start,
        },
        separators=(",", ":"),
    )


def check_pow(vals: list[str]) -> str:
    """
    Check a serialized 80-byte Bitcoin block header against an expanded target.

    The digest is interpreted little-endian for the numeric comparison and
    reversed for the conventional block-hash display.
    """
    if len(vals) < 2:
        raise ValueError("Need [blockHeader80Hex, targetHex]")

    header = _fixed_hex_bytes(vals[0], name="block header", byte_length=80)
    target_bytes = _fixed_hex_bytes(vals[1], name="target", byte_length=32)
    target = int.from_bytes(target_bytes, "big")
    if target == 0:
        raise ValueError("Target must be greater than zero")

    digest = hashlib.sha256(hashlib.sha256(header).digest()).digest()
    valid = int.from_bytes(digest, "little") <= target
    return json.dumps(
        {
            "valid": valid,
            "block_hash": digest[::-1].hex(),
        },
        separators=(",", ":"),
    )


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


def sign_tx_rfc6979(vals: list[str]) -> str:
    """
    Return a DER-encoded ECDSA signature using one RFC6979 nonce.

    This intentionally does not perform Bitcoin Core-style low-R grinding.
    The signature is still normalized to low-S before DER serialization.
    """
    if len(vals) < 2:
        raise ValueError("Need [privateKeyHex, messageHashHex]")

    priv_bytes = _bytes_from_even_hex(vals[0].strip(), name="private key")
    msg_bytes = _bytes_from_even_hex(vals[1].strip(), name="message hash")

    if len(priv_bytes) != 32 or len(msg_bytes) != 32:
        raise ValueError("Private key and message hash must be 32 bytes each")

    ctx = _get_sign_ctx()

    with _SIGN_LOCK:
        priv_c = secp256k1.ffi.new("unsigned char[32]", priv_bytes)
        msg_c = secp256k1.ffi.new("unsigned char[32]", msg_bytes)
        sig = secp256k1.ffi.new("secp256k1_ecdsa_signature *")
        rfc6979 = secp256k1.ffi.addressof(
            secp256k1.lib, "secp256k1_nonce_function_rfc6979"
        )

        if secp256k1.lib.secp256k1_ecdsa_sign(
            ctx, sig, msg_c, priv_c, rfc6979, secp256k1.ffi.NULL
        ) != 1:
            raise RuntimeError("ECDSA sign failed")

        secp256k1.lib.secp256k1_ecdsa_signature_normalize(ctx, sig, sig)
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


def _script_opcode_name_by_byte() -> dict:
    """
    byte -> opcode name, derived from the shared OPCODE_TO_HEX catalogue.
    Only canonical OP_* names enter the map (template aliases like
    "P2SH_SUFFIX" or "OP_RETURN_PREFIX" are skipped), then small ints are
    pinned to their canonical short names (OP_0, OP_1NEGATE, OP_1 .. OP_16).
    """
    name_by_byte: dict = {}
    for name, hexval in OPCODE_TO_HEX.items():
        if len(hexval) != 2:
            continue  # skip multi-byte template entries (e.g. P2PKH_PREFIX)
        # skip aliases ("OP_0 / OP_FALSE") and non-OP template names
        if not name.startswith("OP_") or " " in name or "/" in name:
            continue
        name_by_byte.setdefault(int(hexval, 16), name)
    name_by_byte[0x00] = "OP_0"
    name_by_byte[0x4F] = "OP_1NEGATE"
    for b in range(0x51, 0x61):
        name_by_byte[b] = f"OP_{b - 0x50}"
    return name_by_byte


def _push_is_minimal(op: int, data_hex: str) -> bool:
    """
    MINIMALDATA / CheckMinimalPush (Bitcoin Core): is this push encoded in the
    shortest possible form? `op` is the push opcode byte, `data_hex` the
    pushed bytes.
    """
    data_len = len(data_hex) // 2
    if data_len == 0:
        return False  # empty push must be OP_0
    if data_len == 1:
        value = int(data_hex, 16)
        if 1 <= value <= 16:
            return False  # must be OP_1..OP_16
        if value == 0x81:
            return False  # must be OP_1NEGATE
    if data_len <= 75:
        return 0x01 <= op <= 0x4B  # direct push
    if data_len <= 255:
        return op == 0x4C  # OP_PUSHDATA1
    if data_len <= 65535:
        return op == 0x4D  # OP_PUSHDATA2
    return op == 0x4E


def script_viewer(val) -> str:
    """
    Disassemble a hex-encoded Bitcoin script into an indented, human-readable
    listing: one opcode / data push per line, with IF/ELSE/ENDIF nesting and
    the real pushed bytes shown verbatim. Structurally unbalanced IF/ENDIF is
    reported as a trailing "# warning: ..." line.

    Reference implementation shown in the Script Viewer node's "Show Code"
    dialog. The node renders the disassembly directly in the UI and produces
    no output value, so this is never executed as part of a flow.
    """
    # Bitcoin's consensus limit on script size (MAX_SCRIPT_SIZE = 10,000 bytes).
    # Anything larger is invalid by definition — and rejecting it also keeps
    # hostile inputs from building huge response strings. Kept local so the
    # "Show Code" view is fully self-contained and runnable as displayed.
    max_hex_chars = 20_000
    pushdata_names = {0x4C: "OP_PUSHDATA1", 0x4D: "OP_PUSHDATA2", 0x4E: "OP_PUSHDATA4"}

    # Strip whitespace (spaces/tabs/newlines) so multi-line pasted hex works.
    # Explicit class, byte-for-byte identical with the TS disassembler's
    # cleanHex - str.split() and JS \s disagree on U+0085/U+001C-1F/U+FEFF.
    hex_str = re.sub(
        "[ \t\r\n\v\f\x1c-\x1f\x85\u00a0\u1680\u2000-\u200a"
        "\u2028\u2029\u202f\u205f\u3000\ufeff]+",
        "",
        str(val if val is not None else ""),
    ).lower()
    if not hex_str:
        return ""
    if len(hex_str) > max_hex_chars:
        raise ValueError(
            f"Script too large (max {max_hex_chars // 2} bytes, "
            "Bitcoin's script-size limit)."
        )
    if any(c not in "0123456789abcdef" for c in hex_str):
        raise ValueError("Not valid hex.")
    if len(hex_str) % 2 != 0:
        raise ValueError("Odd-length hex (incomplete byte).")

    data = bytes.fromhex(hex_str)
    name_by_byte = _script_opcode_name_by_byte()

    lines: List = []  # (depth, text)
    i = 0
    depth = 0
    clamped_control_flow = False
    n = len(data)

    while i < n:
        op = data[i]

        # Direct data push (1..75 bytes)
        if 0x01 <= op <= 0x4B:
            start = i + 1
            if start + op > n:
                raise ValueError(
                    f"Truncated push: opcode 0x{op:02x} needs {op} bytes "
                    f"but only {n - start} remain."
                )
            chunk = data[start:start + op].hex()
            text_line = f"PUSH({op}) {chunk if chunk else '(empty)'}"
            if not _push_is_minimal(op, chunk):
                text_line += " · non-minimal"
            lines.append((depth, text_line))
            i = start + op
            continue

        # OP_PUSHDATA1/2/4 (little-endian length prefix)
        if op in pushdata_names:
            width = {0x4C: 1, 0x4D: 2, 0x4E: 4}[op]
            if i + 1 + width > n:
                raise ValueError(f"Truncated {pushdata_names[op]} length prefix.")
            length = int.from_bytes(data[i + 1:i + 1 + width], "little")
            start = i + 1 + width
            if start + length > n:
                raise ValueError(
                    f"Truncated push: {pushdata_names[op]} needs {length} bytes "
                    f"but only {n - start} remain."
                )
            chunk = data[start:start + length].hex()
            text_line = f"{pushdata_names[op]}({length}) {chunk if chunk else '(empty)'}"
            if not _push_is_minimal(op, chunk):
                text_line += " · non-minimal"
            lines.append((depth, text_line))
            i = start + length
            continue

        # Control flow drives indentation
        if op in (0x63, 0x64):  # OP_IF / OP_NOTIF
            lines.append((depth, name_by_byte.get(op, f"UNKNOWN_0x{op:02x}")))
            depth += 1
        elif op == 0x67:  # OP_ELSE (dedent the keyword to line up with its IF)
            if depth == 0:
                clamped_control_flow = True
            lines.append((max(0, depth - 1), "OP_ELSE"))
        elif op == 0x68:  # OP_ENDIF
            if depth == 0:
                clamped_control_flow = True
            depth = max(0, depth - 1)
            lines.append((depth, "OP_ENDIF"))
        else:
            lines.append((depth, name_by_byte.get(op, f"UNKNOWN_0x{op:02x}")))
        i += 1

    text = "\n".join("    " * d + line_text for d, line_text in lines)
    if clamped_control_flow:
        text += "\n# warning: unbalanced OP_IF/OP_ENDIF — OP_ELSE/OP_ENDIF without a matching OP_IF"
    elif depth > 0:
        text += "\n# warning: unbalanced OP_IF/OP_ENDIF — missing OP_ENDIF"
    return text


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


def _script_pushes_witness_program(script: CScript) -> bool:
    """Return true when a script pushes a witness program, as in P2SH-P2WPKH/P2WSH."""
    try:
        for item in script:
            if isinstance(item, bytes) and CScript(item).is_witness_scriptpubkey():
                return True
    except Exception:
        return False
    return False


def _has_witness_stack_items(witness: Any) -> bool:
    try:
        return bool(getattr(witness, "stack", []))
    except Exception:
        return False


def _normalize_script_trace_steps(steps: list) -> list:
    normalized = []
    for step in steps:
        next_step = dict(step)
        opcode = next_step.get("opcode")
        opcode_name = str(next_step.get("opcode_name", ""))
        if (
            isinstance(opcode, int)
            and 1 <= opcode <= 0x4B
            and opcode_name.lower() == "unknown opcode"
        ):
            next_step["opcode_name"] = f"PUSH {opcode} bytes"
        normalized.append(next_step)
    return normalized


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
          "witnessScript": "<hex>",     # P2WSH / Taproot script-path only
          "scriptCode": "<hex>",        # P2WPKH only: implied P2PKH template (BIP143), never transmitted
          "excludedFlags": ["..."],     # Which flags were excluded
          "activeFlags": ["..."],       # Which flags remain active
          "usesWitness": <bool>,        # Whether this spend actually uses witness data/rules
          "witnessRulesEnabled": <bool>, # Whether witness verification rules were enabled
          "amountUsed": <int>,          # Amount used in verification (if witness is used)
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
    
    # Derive the exclude/display map from the library's canonical name->flag
    # table so every verify flag the engine actually applies is disclosable
    # to the user — including the Taproot policy flags
    # (DISCOURAGE_UPGRADABLE_TAPROOT_VERSION, DISCOURAGE_OP_SUCCESS,
    # DISCOURAGE_UPGRADABLE_PUBKEYTYPE) that a hand-written map used to omit.
    FLAG_BY_NAME = dict(SCRIPT_VERIFY_FLAGS_BY_NAME)

    # Flags whose meaning is gated on TAPROOT: excluding TAPROOT must also
    # drop them, mirroring how excluding WITNESS drops its dependents.
    TAPROOT_DEPENDENT_FLAGS = [
        "DISCOURAGE_UPGRADABLE_TAPROOT_VERSION",
        "DISCOURAGE_OP_SUCCESS",
        "DISCOURAGE_UPGRADABLE_PUBKEYTYPE",
    ]
    
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
            # Bitcoin amounts are always whole satoshis; reject any non-integer
            amount_param = int(amount_raw)
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
        # Legacy serialization: a segwit-flagged 0-input tx is rejected as
        # "Superfluous witness record"; one null input keeps inIdx=0 valid.
        tx_hex = (
            "01000000"            # version 1 (legacy, no marker/flag)
            "01" + "00" * 32 +    # 1 input, null prevout hash
            "ffffffff"            # prevout index
            "00"                  # empty scriptSig
            "ffffffff"            # sequence
            "01" + "0000000000000000" + "00"  # 1 output, 0 sats, empty script
            "00000000"            # lock-time
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
            "DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM",
            # Core requires CLEANSTACK => WITNESS (and P2SH); the library
            # enforces this, so CLEANSTACK cannot stay active once witness
            # rules are turned off
            "CLEANSTACK"
        ]
        for dep_flag in dependent_flags:
            if dep_flag in FLAG_BY_NAME:
                flags.discard(FLAG_BY_NAME[dep_flag])
                if dep_flag not in excluded_names:
                    excluded_names.append(dep_flag)

    # Excluding TAPROOT drops the Taproot-only policy flags too: they have no
    # meaning once BIP341/342 validation is off.
    if "TAPROOT" in excluded_names:
        for dep_flag in TAPROOT_DEPENDENT_FLAGS:
            if dep_flag in FLAG_BY_NAME:
                flags.discard(FLAG_BY_NAME[dep_flag])
                if dep_flag not in excluded_names:
                    excluded_names.append(dep_flag)

    # Build list of active flags. Every active flag has a name because the
    # map is derived from the library's canonical table; fail hard (a bare
    # assert would be stripped under `python -O`) so a future library flag
    # can never again be silently undisclosed.
    displayable = {value for value in FLAG_BY_NAME.values()}
    if not flags <= displayable:
        raise RuntimeError(
            "active verify flags without a display name: "
            f"{flags - displayable}"
        )
    active_flags = sorted([name for name, value in FLAG_BY_NAME.items() if value in flags])
    # ------------------------------------------------------------------
    # 3.5  Extract witness AFTER flags are defined
    # ------------------------------------------------------------------
    witness_obj = None
    witness_rules_enabled = SCRIPT_VERIFY_WITNESS in flags
    
    if witness_rules_enabled and hasattr(tx, 'wit') and tx.wit is not None:
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
    is_p2sh_wrapped_witness = (
        script_pubkey_obj.is_p2sh() and _script_pushes_witness_program(script_sig_obj)
    )
    actual_uses_witness = (
        witness_rules_enabled
        and (
            is_witness_program
            or is_p2sh_wrapped_witness
            or _has_witness_stack_items(witness_obj)
        )
    )
    is_taproot_spend = (
        witness_rules_enabled
        and SCRIPT_VERIFY_TAPROOT in flags
        and is_witness_program
        and wit_version == 1
        and len(wit_program) == 32
    )

    built_prevouts = _build_taproot_prevouts(taproot_prevout_vals, len(tx.vin))
    # Pass None (never []) when the user supplied no prevouts: the library
    # checks `spent_outputs is None` and requires prevouts only when a
    # Taproot signature hash is actually computed (key path or a tapscript
    # sig-check). Signatureless tapscripts verify without them (B09) — the
    # MISSING_SPENT_OUTPUTS translation below handles the cases that do
    # need them, instead of predicting the need from the output envelope.
    spent_outputs = built_prevouts if built_prevouts else None
    if is_taproot_spend and spent_outputs is None and len(tx.vin) == 1:
        # Educational convenience: for single-input spends, synthesize the
        # one prevout from the scriptPubKey and amount already at hand.
        spent_outputs = [CTxOut(amount_param, script_pubkey_obj)]

    # ------------------------------------------------------------------
    # 4.  Execute with tracing - include amount if witness active
    # ------------------------------------------------------------------
    amount = amount_param if witness_rules_enabled else 0
    if witness_rules_enabled and amount == 0 and spent_outputs is not None:
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
    steps = _normalize_script_trace_steps(steps)

    # Missing prevouts is a configuration gap, not a script verdict: the
    # library rejects with the structural MISSING_SPENT_OUTPUTS code (on
    # the key-path gate's validator event or the failing tapscript
    # sig-check opcode step). Surface it as the same friendly node error
    # the old envelope-based preflight used to raise.
    if not is_valid:
        terminal = next(
            (s for s in reversed(steps) if s.get("failed") is True), None
        )
        if (
            terminal is not None
            and terminal.get("error_code") == "MISSING_SPENT_OUTPUTS"
        ):
            raise ValueError(
                "Taproot signature verification requires vin-ordered prevouts "
                "(amount + scriptPubKey for each input). Add them in the "
                "Taproot prevouts section."
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
        "usesWitness":   actual_uses_witness,
        "witnessRulesEnabled": witness_rules_enabled,
    }
    
    # Add amount info if this spend actually uses witness validation.
    if actual_uses_witness:
        result["amountUsed"] = amount

    # Surface the raw witness stack (useful for Taproot key-path flows)
    if actual_uses_witness and witness_obj is not None:
        try:
            stack_items = getattr(witness_obj, "stack", [])
            if stack_items:
                result["witnessStack"] = [b2x(bytes(it)) for it in stack_items]
        except Exception:
            pass
    
    # harvest optional inner scripts (added by the tracer)
    for st in steps:
        ph = st.get("phase")
        step_name = st.get("step")
        script_hex = st.get("script_hex")
        if script_hex is None:
            continue
        if not script_hex and step_name != "witness_script":
            # Only a taproot leaf (the witness_script event) may be
            # legitimately empty — the key must still reach the UI so an
            # empty tapscript is not mistaken for a key-path spend.
            continue
        if step_name == "scriptcode_derive":
            # P2WPKH: implied P2PKH template conjured by the validator
            # (BIP143 scriptCode) — deliberately NOT a witnessScript.
            result.setdefault("scriptCode", script_hex)
        elif step_name == "witness_script_check":
            # P2WSH: last witness item, hash-checked against the program.
            result.setdefault("witnessScript", script_hex)
        elif ph in ("redeemScript", "witnessScript", "taproot"):
            key = "redeemScript" if ph == "redeemScript" else "witnessScript"
            if key not in result:
                result[key] = script_hex

    # Handle errors
    if not is_valid:
        result["error"] = err_msg or "Unknown script verification error"
        
        # Add helpful hint if this spend uses witness validation but no amount was provided.
        if actual_uses_witness and not amount_supplied and not spent_outputs:
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


def _script_push_bytes(data: bytes) -> str:
    data_len = len(data)
    if data_len == 0:
        return "00"
    if data_len <= 75:
        return f"{data_len:02x}" + data.hex()
    if data_len <= 255:
        return "4c" + f"{data_len:02x}" + data.hex()
    if data_len <= 65535:
        return "4d" + data_len.to_bytes(2, "little").hex() + data.hex()
    return "4e" + data_len.to_bytes(4, "little").hex() + data.hex()


def bip110_picture_p2sh_scripts(vals: Any) -> str:
    """
    Split image bytes into BIP110-sized data chunks and build P2SH redeemScripts.

    Each full redeemScript is:
        <240B data> <240B data> OP_2DROP <33B pubkey> OP_CHECKSIG

    With two 240-byte pushes the redeemScript is exactly 520 bytes, so it stays
    within the P2SH script element limit while each individual data push remains
    below BIP110's 256-byte push limit.
    """
    if not isinstance(vals, (list, tuple)) or len(vals) < 2:
        raise ValueError("Need [picture hex, compressed pubkey]")

    picture = _bytes_from_even_hex(str(vals[0] or ""), name="picture hex")
    pubkey = _bytes_from_even_hex(str(vals[1] or ""), name="compressed pubkey")

    max_picture_bytes = 73 * 1024
    chunk_bytes = 240
    payload_per_script = chunk_bytes * 2
    max_outputs = 156

    if not picture:
        raise ValueError("picture hex is empty")
    if len(picture) > max_picture_bytes:
        raise ValueError(
            f"picture must be at most {max_picture_bytes} bytes (73 KiB)"
        )
    if len(pubkey) != 33 or pubkey[0] not in (2, 3):
        raise ValueError("compressed pubkey must be 33 bytes and start with 02 or 03")

    scripts = []
    for index, start in enumerate(range(0, len(picture), payload_per_script)):
        if index >= max_outputs:
            raise ValueError(f"picture needs more than {max_outputs} P2SH outputs")

        group = picture[start : start + payload_per_script]
        chunk1 = group[:chunk_bytes]
        chunk2 = group[chunk_bytes:]
        redeem_script = (
            _script_push_bytes(chunk1)
            + _script_push_bytes(chunk2)
            + "6d"  # OP_2DROP
            + _script_push_bytes(pubkey)
            + "ac"  # OP_CHECKSIG
        )
        scripts.append(
            {
                "index": index,
                "payload_bytes": len(group),
                "chunk1_bytes": len(chunk1),
                "chunk2_bytes": len(chunk2),
                "script_bytes": len(bytes.fromhex(redeem_script)),
                "script": redeem_script,
            }
        )

    return json.dumps(
        {
            "count": len(scripts),
            "total_bytes": len(picture),
            "max_bytes": max_picture_bytes,
            "chunk_bytes": chunk_bytes,
            "payload_bytes_per_full_script": payload_per_script,
            "max_outputs": max_outputs,
            "scripts": scripts,
        },
        separators=(",", ":"),
    )


def op_code_select(vals: Any) -> str:
    """
    Convert an ordered Script template/opcode list into serialized script hex.

    Each selected item is a human-readable opcode name such as OP_DUP or
    OP_CHECKSIG, or a rawBit template shortcut such as P2PKH_PREFIX. The result
    is the byte sequence that appears inside a Bitcoin script.
    """
    return opcode_sequence_to_hex(vals)


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


def hex_to_text(val: str) -> str:
    """
    Convert hex-encoded UTF-8 bytes to text.

    Examples:
        "32303039" -> "2009"
        "62616e6b73" -> "banks"
        "7361746f736869" -> "satoshi"
    """
    raw = _bytes_from_even_hex(val, name="text hex")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("Text hex is not valid UTF-8") from exc


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
    mainnet: 0x05, testnet/signet/regtest: 0xc4
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

    def read_push(script: bytes, offset: int) -> tuple[bytes, int]:
        if offset >= len(script):
            return b"", offset

        opcode = script[offset]
        offset += 1

        if opcode <= 0x4B:
            size = opcode
        elif opcode == 0x4C:
            if offset + 1 > len(script):
                raise ValueError("Malformed OP_RETURN PUSHDATA1 length")
            size = script[offset]
            offset += 1
        elif opcode == 0x4D:
            if offset + 2 > len(script):
                raise ValueError("Malformed OP_RETURN PUSHDATA2 length")
            size = int.from_bytes(script[offset : offset + 2], "little")
            offset += 2
        elif opcode == 0x4E:
            if offset + 4 > len(script):
                raise ValueError("Malformed OP_RETURN PUSHDATA4 length")
            size = int.from_bytes(script[offset : offset + 4], "little")
            offset += 4
        else:
            raise ValueError(
                f"OP_RETURN payload contains non-push opcode 0x{opcode:02x}"
            )

        end = offset + size
        if end > len(script):
            raise ValueError("Malformed OP_RETURN push: length exceeds script size")
        return script[offset:end], end

    def op_return_payload(script: bytes) -> bytes:
        offset = 1  # skip OP_RETURN
        chunks: list[bytes] = []
        while offset < len(script):
            chunk, offset = read_push(script, offset)
            chunks.append(chunk)
        return b"".join(chunks)

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

    # -------- OP_RETURN fields ----------------------------------------
    if field.startswith("op_return."):
        assert_idx(vout, index, "vout")
        txout = vout[index]
        script = bytes(txout.scriptPubKey)
        if not script.startswith(b"\x6a"):
            raise ValueError(f"vout index {index} is not an OP_RETURN output")
        sub = field[len("op_return.") :]
        if sub == "data":
            return op_return_payload(script).hex()
        raise ValueError(f"Unknown op_return sub-field '{sub}'")

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


def _parse_tx_structure(raw_tx_hex: str) -> dict:
    """
    Parse a raw Bitcoin transaction byte-by-byte — no library.

    Understands both serializations:
      legacy:  version | vins | vouts | locktime
      BIP144:  version | 0x00 0x01 | vins | vouts | witness stacks | locktime

    Returns a dict with every wire component plus derived values
    (txid, wtxid, sizes, weight). All hashes are in internal byte
    order, exactly as the bytes appear on the wire.
    """
    hex_str = "".join(str(raw_tx_hex or "").split()).lower()
    if not hex_str:
        raise ValueError("Raw transaction hex is empty.")
    if len(hex_str) > 2_000_000:
        raise ValueError("Transaction too large (max 1,000,000 bytes).")
    if any(c not in "0123456789abcdef" for c in hex_str):
        raise ValueError("Not valid hex.")
    if len(hex_str) % 2 != 0:
        raise ValueError("Odd-length hex (incomplete byte).")

    raw = bytes.fromhex(hex_str)
    pos = 0

    def take(n: int, what: str) -> bytes:
        nonlocal pos
        if pos + n > len(raw):
            raise ValueError(f"Transaction truncated in {what}.")
        chunk = raw[pos:pos + n]
        pos += n
        return chunk

    def read_u32(what: str) -> int:
        return int.from_bytes(take(4, what), "little")

    def read_u64(what: str) -> int:
        return int.from_bytes(take(8, what), "little")

    def read_varint(what: str) -> int:
        # Canonical CompactSize (matches Bitcoin Core's ReadCompactSize):
        # each form is only valid for values that don't fit the shorter one.
        first = take(1, what)[0]
        if first < 0xFD:
            return first
        if first == 0xFD:
            value = int.from_bytes(take(2, what), "little")
            if value < 0xFD:
                raise ValueError(f"Non-canonical CompactSize in {what}.")
            return value
        if first == 0xFE:
            value = int.from_bytes(take(4, what), "little")
            if value < 0x1_0000:
                raise ValueError(f"Non-canonical CompactSize in {what}.")
            return value
        value = int.from_bytes(take(8, what), "little")
        if value < 0x1_0000_0000:
            raise ValueError(f"Non-canonical CompactSize in {what}.")
        if value > 2**53 - 1:
            raise ValueError(f"CompactSize in {what} is too large.")
        return value

    version = read_u32("version")

    # BIP144 detection: a zero byte here cannot be a real input count (a
    # transaction with 0 inputs is invalid), so it must be the SegWit marker.
    segwit = pos < len(raw) and raw[pos] == 0x00
    marker_flag = ""
    if segwit:
        take(1, "SegWit marker")
        flag = take(1, "SegWit flag")[0]
        if flag != 0x01:
            raise ValueError(
                f"Invalid SegWit flag 0x{flag:02x} (BIP144 requires 0x01)."
            )
        marker_flag = "0001"

    in_out_start = pos

    input_count = read_varint("input count")
    # Each input needs at least 32+4+1+4 bytes — reject absurd counts before
    # looping so hostile hex cannot spin the parser.
    if input_count > (len(raw) - pos) // 41:
        raise ValueError(f"Input count {input_count} exceeds remaining bytes.")
    vins = []
    for i in range(input_count):
        prev_txid = take(32, f"input {i} previous txid").hex()
        prev_vout = read_u32(f"input {i} previous vout")
        script_len = read_varint(f"input {i} scriptSig length")
        script_sig = take(script_len, f"input {i} scriptSig").hex()
        sequence = read_u32(f"input {i} sequence")
        vins.append(
            {
                "txid": prev_txid,
                "vout": prev_vout,
                "script_sig": script_sig,
                "sequence": sequence,
            }
        )

    output_count = read_varint("output count")
    if output_count > (len(raw) - pos) // 9:
        raise ValueError(f"Output count {output_count} exceeds remaining bytes.")
    vouts = []
    for i in range(output_count):
        value = read_u64(f"output {i} amount")
        script_len = read_varint(f"output {i} scriptPubKey length")
        script_pubkey = take(script_len, f"output {i} scriptPubKey").hex()
        vouts.append({"value": value, "script_pubkey": script_pubkey})

    in_out_end = pos

    witness: list = []
    witness_wire: list = []
    if segwit:
        for i in range(input_count):
            item_start = pos
            item_count = read_varint(f"input {i} witness item count")
            if item_count > (len(raw) - pos):
                raise ValueError(
                    f"Witness item count {item_count} exceeds remaining bytes."
                )
            items = []
            for j in range(item_count):
                item_len = read_varint(f"input {i} witness item {j} length")
                items.append(take(item_len, f"input {i} witness item {j}").hex())
            witness.append(items)
            witness_wire.append(raw[item_start:pos].hex())

        # Core rejects marker/flag serialization whose witness section is
        # entirely empty ("Superfluous witness record") — such a transaction
        # must use the legacy serialization instead.
        if all(len(items) == 0 for items in witness):
            raise ValueError(
                "Superfluous witness record: marker/flag present "
                "but every witness stack is empty."
            )

    locktime_start = pos
    locktime = read_u32("locktime")
    if pos != len(raw):
        raise ValueError(f"Transaction has {len(raw) - pos} trailing byte(s).")

    # txid always commits to the stripped (no-witness) serialization.
    if segwit:
        stripped = (
            raw[:4]
            + raw[in_out_start:in_out_end]
            + raw[locktime_start:locktime_start + 4]
        )
    else:
        stripped = raw

    txid = hashlib.sha256(hashlib.sha256(stripped).digest()).digest().hex()
    wtxid = (
        hashlib.sha256(hashlib.sha256(raw).digest()).digest().hex()
        if segwit
        else txid
    )

    base_size = len(stripped)
    total_size = len(raw)
    weight = base_size * 3 + total_size

    return {
        "version": version,
        "segwit": segwit,
        "marker_flag": marker_flag,
        "vin": vins,
        "vout": vouts,
        "witness": witness,
        "witness_wire": witness_wire,
        "locktime": locktime,
        "stripped_hex": stripped.hex(),
        "txid": txid,
        "wtxid": wtxid,
        "base_size": base_size,
        "total_size": total_size,
        "weight": weight,
        "vsize": (weight + 3) // 4,
    }


def _tx_op_return_data(script: bytes) -> str:
    """Concatenate the data pushes of an OP_RETURN scriptPubKey (hex)."""

    def read_push(offset: int) -> tuple:
        opcode = script[offset]
        offset += 1
        if opcode <= 0x4B:
            size = opcode
        elif opcode == 0x4C:
            if offset + 1 > len(script):
                raise ValueError("Malformed OP_RETURN PUSHDATA1 length")
            size = script[offset]
            offset += 1
        elif opcode == 0x4D:
            if offset + 2 > len(script):
                raise ValueError("Malformed OP_RETURN PUSHDATA2 length")
            size = int.from_bytes(script[offset:offset + 2], "little")
            offset += 2
        elif opcode == 0x4E:
            if offset + 4 > len(script):
                raise ValueError("Malformed OP_RETURN PUSHDATA4 length")
            size = int.from_bytes(script[offset:offset + 4], "little")
            offset += 4
        else:
            raise ValueError(
                f"OP_RETURN payload contains non-push opcode 0x{opcode:02x}"
            )
        end = offset + size
        if end > len(script):
            raise ValueError("Malformed OP_RETURN push: length exceeds script size")
        return script[offset:end], end

    offset = 1  # skip OP_RETURN
    chunks = []
    while offset < len(script):
        chunk, offset = read_push(offset)
        chunks.append(chunk)
    return b"".join(chunks).hex()


def _script_sig_stack_items(script_hex: str) -> list[str]:
    """Return the stack items pushed by a legacy scriptSig."""
    script = bytes.fromhex(script_hex)
    offset = 0
    items: list[str] = []

    while offset < len(script):
        opcode_offset = offset
        opcode = script[offset]
        offset += 1

        if opcode == 0x00:  # OP_0 pushes an empty item.
            items.append("")
            continue

        if 0x01 <= opcode <= 0x4B:
            size = opcode
        elif opcode == 0x4C:  # OP_PUSHDATA1
            if offset + 1 > len(script):
                raise ValueError("Malformed scriptSig PUSHDATA1 length")
            size = script[offset]
            offset += 1
        elif opcode == 0x4D:  # OP_PUSHDATA2
            if offset + 2 > len(script):
                raise ValueError("Malformed scriptSig PUSHDATA2 length")
            size = int.from_bytes(script[offset:offset + 2], "little")
            offset += 2
        elif opcode == 0x4E:  # OP_PUSHDATA4
            if offset + 4 > len(script):
                raise ValueError("Malformed scriptSig PUSHDATA4 length")
            size = int.from_bytes(script[offset:offset + 4], "little")
            offset += 4
        elif opcode == 0x4F:  # OP_1NEGATE
            items.append("81")
            continue
        elif 0x51 <= opcode <= 0x60:  # OP_1 .. OP_16
            items.append(f"{opcode - 0x50:02x}")
            continue
        else:
            raise ValueError(
                "scriptSig item extraction supports only push operations; "
                f"found opcode 0x{opcode:02x} at byte {opcode_offset}."
            )

        end = offset + size
        if end > len(script):
            raise ValueError("Malformed scriptSig push: length exceeds script size")
        items.append(script[offset:end].hex())
        offset = end

    return items


def parse_tx_field(vals: list) -> str:
    """
    Extract a field from a raw Bitcoin transaction of ANY type — legacy,
    SegWit, or Taproot-spending — using rawBit's own byte-by-byte parser
    (see _parse_tx_structure) instead of an external library.

    scriptSig and witness stack items are addressed positionally in the field
    name itself: `vin.scriptSig.item0`, `vin.witness.item0`, … (any itemN works)
    and `.last`. The stack's meaning is defined by the script being spent, so
    positional names are the only honest general addressing.

    Parameters
    ----------
    vals[0]  raw_tx_hex        – full transaction in hex
    vals[1]  field_name        – see dispatch below
    vals[2]  (optional) index  – vin[] / vout[] look-ups (default 0)
    """
    if len(vals) < 2:
        raise ValueError("Need at least rawTxHex and fieldName")

    raw_hex = str(vals[0]).strip()
    field = str(vals[1]).strip()
    index = int(vals[2]) if len(vals) > 2 and vals[2] != "" else 0

    tx = _parse_tx_structure(raw_hex)

    def assert_idx(arr, i: int, what: str) -> None:
        if i < 0 or i >= len(arr):
            raise IndexError(f"{what} index {i} out of range (have {len(arr)})")

    # -------- top-level fields ----------------------------------------
    if field == "version":
        return str(tx["version"])
    if field == "locktime":
        return str(tx["locktime"])
    if field == "input_count":
        return str(len(tx["vin"]))
    if field == "output_count":
        return str(len(tx["vout"]))
    if field == "txid":
        return tx["txid"]
    if field == "wtxid":
        return tx["wtxid"]
    if field == "marker_flag":
        return tx["marker_flag"]
    if field == "size":
        return str(tx["total_size"])
    if field == "vsize":
        return str(tx["vsize"])
    if field == "weight":
        return str(tx["weight"])
    if field == "raw_no_witness":
        return tx["stripped_hex"]

    # -------- OP_RETURN fields ----------------------------------------
    if field.startswith("op_return."):
        assert_idx(tx["vout"], index, "vout")
        script = bytes.fromhex(tx["vout"][index]["script_pubkey"])
        if not script.startswith(b"\x6a"):
            raise ValueError(f"vout index {index} is not an OP_RETURN output")
        sub = field[len("op_return."):]
        if sub == "data":
            return _tx_op_return_data(script)
        raise ValueError(f"Unknown op_return sub-field '{sub}'")

    # -------- per-input fields ----------------------------------------
    if field.startswith("vin."):
        assert_idx(tx["vin"], index, "vin")
        txin = tx["vin"][index]
        sub = field[4:]
        if sub == "txid":
            return txin["txid"]
        if sub == "vout":
            return str(txin["vout"])
        if sub == "scriptSig":
            return txin["script_sig"]
        if sub == "scriptSig_count":
            return str(len(_script_sig_stack_items(txin["script_sig"])))
        if sub == "scriptSig.last":
            items = _script_sig_stack_items(txin["script_sig"])
            if not items:
                raise IndexError(
                    f"vin index {index} has an empty scriptSig stack"
                )
            return items[-1]
        if sub.startswith("scriptSig.item"):
            suffix = sub[len("scriptSig.item"):]
            if suffix.isdigit():
                items = _script_sig_stack_items(txin["script_sig"])
                assert_idx(items, int(suffix), "scriptSig item")
                return items[int(suffix)]
            raise ValueError(f"Unknown vin sub-field '{sub}'")
        if sub == "sequence":
            return str(txin["sequence"])
        if sub in ("witness", "witness_count") or sub.startswith("witness."):
            if not tx["segwit"]:
                raise ValueError(
                    "Transaction has no witness data (legacy serialization)"
                )
            if sub == "witness":
                return tx["witness_wire"][index]
            if sub == "witness_count":
                return str(len(tx["witness"][index]))
            if sub == "witness.last":
                items = tx["witness"][index]
                if not items:
                    raise IndexError(
                        f"vin index {index} has an empty witness stack"
                    )
                return items[-1]
            if sub.startswith("witness.item"):
                suffix = sub[len("witness.item"):]
                if suffix.isdigit():
                    items = tx["witness"][index]
                    assert_idx(items, int(suffix), "witness item")
                    return items[int(suffix)]
            raise ValueError(f"Unknown vin sub-field '{sub}'")
        raise ValueError(f"Unknown vin sub-field '{sub}'")

    # -------- per-output fields ---------------------------------------
    if field.startswith("vout."):
        assert_idx(tx["vout"], index, "vout")
        txout = tx["vout"][index]
        sub = field[5:]
        if sub == "value":
            return str(txout["value"])
        if sub == "scriptPubKey":
            return txout["script_pubkey"]
        raise ValueError(f"Unknown vout sub-field '{sub}'")

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
    Raises ValueError for any input that does not fit a supported format
    exactly, including NaN, Infinity, underscores, binary literals, trailing
    dots, and malformed scientific-notation strings.
    """
    s = str(raw).strip()
    if not s:
        raise ValueError("empty number")

    # explicit hex prefix – always hex
    if s.lower().startswith("0x"):
        return int(s, 16)

    if s.lower().startswith("0b"):
        raise ValueError(f"'{raw}' is not a valid number")

    # plain integer
    if _INT_DEC_RE.fullmatch(s):
        return int(s, 10)

    # decimal / fraction / scientific-notation → Decimal
    if _STRICT_DECIMAL_RE.fullmatch(s):
        return Decimal(s)

    # Ambiguous hex: all hex digits, at least one a–f letter, no recognised
    if (
        all(c in "0123456789abcdefABCDEF" for c in s)
        and any(c in "abcdefABCDEF" for c in s)
        and not _LOOKS_LIKE_SCI_RE.search(s)
    ):
        return int(s, 16)

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

def _parse_decimal_strict(raw: str):
    """
    Decimal notation only: ints ('144', '+10', '-7') and fraction/scientific
    notation ('12.5', '1e6'). Hex is rejected — use _parse_hex_uint instead.
    """
    s = str(raw).strip()
    if not s:
        raise ValueError("empty number")
    if _INT_DEC_RE.fullmatch(s):
        return int(s, 10)
    if _STRICT_DECIMAL_RE.fullmatch(s):
        return Decimal(s)
    raise ValueError(f"'{raw}' is not a valid decimal number")


def _parse_hex_uint(raw: str) -> int:
    """Unsigned hexadecimal integer, optional 0x prefix."""
    s = str(raw).strip()
    if s.lower().startswith("0x"):
        s = s[2:]
    if not s or not _HEX_RE.fullmatch(s):
        raise ValueError(f"'{raw}' is not a valid hex number")
    return int(s, 16)


def compare_numbers(vals: list[str]) -> str:
    """
    Test a numeric relation between two values.

    vals[0]: left value
    vals[1]: operator (<, >, <=, >=)
    vals[2]: right value
    vals[3]: parse mode 'decimal' or 'hex' (blank/missing => 'decimal')

    'decimal' accepts ints and fraction/scientific notation; 'hex' accepts
    unsigned hex with optional 0x prefix. The mode is explicit so a value
    like '1e8' or an all-digit hex string can never be parsed ambiguously.
    """
    if len(vals) < 3:
        raise ValueError("Need [left, operator, right]")
    mode = (str(vals[3]).strip().lower() if len(vals) > 3 else "") or "decimal"
    if mode == "hex":
        a = _parse_hex_uint(vals[0])
        b = _parse_hex_uint(vals[2])
    elif mode == "decimal":
        a = _parse_decimal_strict(vals[0])
        b = _parse_decimal_strict(vals[2])
        a, b = _coerce_for_op(a, b)
    else:
        raise ValueError(f"Unsupported mode '{vals[3]}'")

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

def counter(vals: list[str]) -> str:
    """
    Manually stepped value: echo the current value unchanged.

    vals[0]: current value, decimal integer

    The canvas +1 button increments the field client-side; the backend only
    validates and returns the canonical current value so downstream nodes
    always consume a clean decimal integer.
    """
    if len(vals) < 1:
        raise ValueError("Need [value]")

    value_text = str(vals[0]).strip()
    if not _INT_DEC_RE.fullmatch(value_text):
        raise ValueError(f"Value must be a decimal integer, got '{vals[0]}'")

    return str(int(value_text, 10))


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
    mainnet: 0x00, testnet/signet/regtest: 0x6f
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

    • Whitespace (spaces, new‑lines, tabs) is ignored, a 0x prefix is allowed.
    • Raises ValueError on odd-length or non-hex input.

    Example
    -------
    >>> hex_byte_length("0200000001 … 000000")
    192
    """
    return len(_bytes_from_even_hex(val, name="input"))

def scriptpubkey_to_scriptcode(val: str) -> str:
    """
    Derive the BIP143 scriptCode from a P2WPKH scriptPubKey.

    A SegWit validator recognizes the version-0 witness-program pattern
    0014{20-byte hash} in the output being spent and expands it to the
    implied P2PKH template:

        76a914 {hash} 88ac

    That template — the scriptCode — is what actually executes and what the
    BIP143 sighash commits to. It is never transmitted; both the signer and
    the validator derive it from the spent output's scriptPubKey.

    Only P2WPKH is derivable:
      - P2WSH (0020{sha256}) commits to the witnessScript by hash, so its
        scriptCode is the witnessScript itself, supplied by the spender.
      - Taproot (5120{x-only key}) has no scriptCode at all (BIP341).
    """
    spk = re.sub(r"\s+", "", str(val)).lower()
    if not spk:
        raise ValueError("scriptPubKey cannot be empty")
    if re.fullmatch(r"0014[0-9a-f]{40}", spk):
        return "76a914" + spk[4:] + "88ac"
    if re.fullmatch(r"0020[0-9a-f]{64}", spk):
        raise ValueError(
            "P2WSH has no derived scriptCode — the witnessScript itself is "
            "the scriptCode (the scriptPubKey only commits to its SHA256)"
        )
    if re.fullmatch(r"5120[0-9a-f]{64}", spk):
        raise ValueError(
            "Taproot has no scriptCode — the BIP341 sighash commits to the "
            "spent outputs and tapleaf instead"
        )
    raise ValueError(
        "Not a P2WPKH scriptPubKey (expected 0014 + 20-byte hash)"
    )


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
