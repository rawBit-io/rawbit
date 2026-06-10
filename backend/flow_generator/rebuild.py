"""Assemble everything needed to rebuild a transaction, from a local node.

Given a transaction (raw hex or txid), Bitcoin Core is the parser of record:
``decoderawtransaction`` describes the fields, ``getrawtransaction`` supplies
the funding transactions. On regtest the wallet's descriptors additionally
yield the spending private keys (single-sig and multisig co-signer keys), so
the canvas flow can recreate the signatures itself — not just paste them.

Wire-mode rebuilds (no keys) work on any chain; key derivation is gated to
regtest where coins are throwaway by definition.
"""

from __future__ import annotations

import bitcointx
from bitcointx.wallet import CCoinExtKey

from calc_functions import calc_func as calc

from .dataset import assemble_dataset, DatasetError
from .script_parse import (
    p2pk_pubkey,
    p2pkh_hash160,
    parse_multisig,
    parse_pushes,
    ScriptParseError,
)

_REGTEST = "bitcoin/regtest"

# Bitcoin Core's getblockchaininfo chain names → rawBit network names
_NETWORKS = {"main": "mainnet", "test": "testnet"}


class RebuildError(Exception):
    """User-facing failure while assembling rebuild data."""


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


def _try_derive_for_hash160(rpc, h160: str) -> str | None:
    try:
        address = calc.hash160_to_p2pkh_address(h160, "regtest")
        return _derive_privkey(rpc, address)
    except Exception:
        return None


def _redeem_from_scriptsig(scriptsig_hex: str) -> str | None:
    try:
        ops = parse_pushes(scriptsig_hex)
    except ScriptParseError:
        return None
    return ops[-1]["data"] if ops and ops[-1]["data"] else None


def _derive_input_keys(rpc, dataset: dict) -> None:
    """Attach every derivable spending key to the dataset (regtest only).

    Descriptor wallets index the P2PKH address of each derived key, so a
    pubkey owned by the wallet — whether it locks a P2PKH, P2PK, or multisig
    output — resolves through ``getaddressinfo`` on its P2PKH form.
    """
    for inp in dataset["vin"]:
        if inp.get("coinbase"):
            continue
        spk_type = inp.get("prev_spk_type")
        spk = inp["prev_scriptpubkey"]
        if spk_type == "pubkeyhash":
            h160 = p2pkh_hash160(spk)
            if h160:
                inp["privkey_hex"] = _try_derive_for_hash160(rpc, h160)
        elif spk_type == "pubkey":
            pubkey = p2pk_pubkey(spk)
            if pubkey:
                inp["privkey_hex"] = _try_derive_for_hash160(
                    rpc, calc.hash160_hex(pubkey)
                )
        elif spk_type in ("multisig", "scripthash"):
            script = (
                spk
                if spk_type == "multisig"
                else _redeem_from_scriptsig(inp["scriptsig_hex"])
            )
            ms = parse_multisig(script) if script else None
            if ms is None:
                continue
            keys = {}
            for pubkey in ms["pubkeys"]:
                privkey = _try_derive_for_hash160(rpc, calc.hash160_hex(pubkey))
                if privkey:
                    keys[pubkey] = privkey
            if keys:
                inp["privkeys_by_pubkey"] = keys


def build_rebuild_dataset(rpc, tx_ref: str) -> dict:
    """Build the rebuild dataset for ``tx_ref`` (raw hex or a txid)."""
    tx_ref = (tx_ref or "").strip()
    chain = rpc.chain()
    network = _NETWORKS.get(chain, chain)

    if len(tx_ref) > 64:
        raw_hex = tx_ref
    else:
        try:
            raw_hex = rpc.call_gated("getrawtransaction", [tx_ref])
        except Exception as exc:
            raise RebuildError(
                f"Could not fetch transaction {tx_ref[:16]}…: {exc}"
            ) from exc
    try:
        decoded = rpc.call_gated("decoderawtransaction", [raw_hex])
    except Exception as exc:
        raise RebuildError(f"Could not decode transaction: {exc}") from exc

    prev_txs: dict[str, str] = {}
    prev_decoded: dict[str, dict] = {}
    for vin in decoded.get("vin", []):
        if "coinbase" in vin or vin.get("txid") is None:
            continue
        prev_txid = vin["txid"]
        if prev_txid in prev_txs:
            continue
        try:
            prev_hex = rpc.call_gated("getrawtransaction", [prev_txid])
        except Exception as exc:
            raise RebuildError(
                f"Could not fetch funding tx {prev_txid[:16]}…: {exc} — the "
                "node must know it (enable txindex=1 or use a wallet "
                "transaction)."
            ) from exc
        prev_txs[prev_txid] = prev_hex
        try:
            prev_decoded[prev_txid] = rpc.call_gated(
                "decoderawtransaction", [prev_hex]
            )
        except Exception:
            pass  # local classification covers it

    try:
        dataset = assemble_dataset(
            raw_hex,
            prev_txs,
            network=network,
            decoded=decoded,
            prev_decoded=prev_decoded,
        )
    except DatasetError as exc:
        raise RebuildError(str(exc)) from exc

    if chain == "regtest":
        _derive_input_keys(rpc, dataset)
    return dataset
