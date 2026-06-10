"""Assemble everything needed to rebuild a transaction, from a local node.

Given a signed transaction (hex or txid), fetch each input's funding
transaction and derive the spending private key from the wallet's descriptors,
so the canvas flow can recreate the signature itself — not just paste it.

Regtest only: deriving and returning private keys is gated to throwaway coins.
"""

from __future__ import annotations

import bitcointx
from bitcointx.core import CTransaction, b2lx, x
from bitcointx.wallet import CCoinExtKey

from calc_functions import calc_func as calc

_REGTEST = "bitcoin/regtest"


class RebuildError(Exception):
    """User-facing failure while assembling rebuild data."""


def _p2pkh_hash160(script_hex: str) -> str | None:
    s = script_hex.lower()
    if len(s) == 50 and s.startswith("76a914") and s.endswith("88ac"):
        return s[6:46]
    return None


def _parse_pkh_descriptor(desc: str) -> tuple[str, str] | None:
    """Return (xprv, relative_path_template) from a ``pkh(...)`` descriptor.

    The template is whatever follows the key — ``44h/1h/0h/0/*`` for a depth-0
    master export, or ``0/*`` when the descriptor embeds an account-level key.
    """
    if not desc.startswith("pkh("):
        return None
    inner = desc[4 : desc.rindex(")")]
    if inner.startswith("["):  # key origin [fingerprint/path]
        inner = inner[inner.index("]") + 1 :]
    key, _, template = inner.partition("/")
    if key[:4] not in ("tprv", "xprv"):
        return None
    return key, template


def _resolve_path(template: str, hdkeypath: str) -> str:
    """Partial derivation path on the descriptor's key for one address.

    The template's trailing ``*`` wildcard is the address index; replace it with
    the address's actual child index from ``hdkeypath``. Deriving the embedded
    key by this *relative* path works whether the key is the depth-0 master or an
    account-level key, where deriving the absolute hdkeypath would fail.
    """
    child_index = hdkeypath.rstrip("/").split("/")[-1]
    parts = template.split("/") if template else []
    if parts and parts[-1] == "*":
        parts[-1] = child_index
    elif not parts:
        parts = [child_index]
    return "/".join(parts)


def _derive_privkey(rpc, address: str) -> str | None:
    """Return the 32-byte hex private key for an owned address, or None."""
    info = rpc.call_gated("getaddressinfo", [address])
    if not info.get("ismine") or not info.get("hdkeypath"):
        return None
    want_pubkey = info.get("pubkey")
    hdkeypath = info["hdkeypath"]
    descriptors = rpc.call_gated("listdescriptors", [True]).get("descriptors", [])
    with bitcointx.ChainParams(_REGTEST):
        for entry in descriptors:
            parsed = _parse_pkh_descriptor(entry.get("desc", ""))
            if parsed is None:
                continue
            xprv, template = parsed
            try:
                child = CCoinExtKey(xprv).derive_path(_resolve_path(template, hdkeypath))
            except Exception:
                continue
            privkey_hex = child.priv.secret_bytes.hex()
            if calc.public_key_from_private_key(privkey_hex) == want_pubkey:
                return privkey_hex
    return None


def _sighash_type(scriptsig: bytes) -> int:
    """SIGHASH byte of the first push in a P2PKH scriptSig (default ALL)."""
    if not scriptsig:
        return 1
    push_len = scriptsig[0]
    if 1 <= push_len <= 75 and len(scriptsig) >= 1 + push_len:
        return scriptsig[push_len]  # last byte of the signature push
    return 1


def build_rebuild_dataset(rpc, tx_ref: str) -> dict:
    """Build the rebuild dataset for ``tx_ref`` (raw hex or a txid)."""
    if rpc.chain() != "regtest":
        raise RebuildError("Rebuilding with key recovery is only available on regtest.")

    tx_ref = tx_ref.strip()
    try:
        raw_hex = tx_ref if len(tx_ref) > 64 else rpc.call_gated("getrawtransaction", [tx_ref])
        tx = CTransaction.deserialize(x(raw_hex))
    except RebuildError:
        raise
    except Exception as exc:
        raise RebuildError(f"Could not decode transaction: {exc}")

    vin = []
    for txin in tx.vin:
        prev_txid = b2lx(txin.prevout.hash)
        try:
            prev_hex = rpc.call_gated("getrawtransaction", [prev_txid])
            prev_tx = CTransaction.deserialize(x(prev_hex))
        except Exception as exc:
            raise RebuildError(f"Could not fetch funding tx {prev_txid[:12]}…: {exc}")
        spent = prev_tx.vout[txin.prevout.n]
        prev_spk = spent.scriptPubKey.hex()
        privkey_hex = None
        hash160 = _p2pkh_hash160(prev_spk)
        if hash160 is not None:
            address = calc.hash160_to_p2pkh_address(hash160, "regtest")
            try:
                privkey_hex = _derive_privkey(rpc, address)
            except Exception:
                privkey_hex = None
        vin.append(
            {
                "prev_txid": prev_txid,
                "vout": txin.prevout.n,
                "sequence": txin.nSequence,
                "prev_tx_hex": prev_hex,
                "prev_scriptpubkey": prev_spk,
                "prev_value_sats": spent.nValue,
                "privkey_hex": privkey_hex,
            }
        )

    vout = [
        {"value_sats": o.nValue, "scriptpubkey": o.scriptPubKey.hex()} for o in tx.vout
    ]

    return {
        "tx_hex": raw_hex,
        "txid": b2lx(tx.GetTxid()),
        "version": tx.nVersion,
        "locktime": tx.nLockTime,
        "sighash_type": _sighash_type(bytes(tx.vin[0].scriptSig)) if tx.vin else 1,
        "vin": vin,
        "vout": vout,
        "network": "regtest",
    }
