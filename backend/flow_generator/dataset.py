"""Assemble the rebuild dataset that feeds the legacy flow builder.

``assemble_dataset`` turns a raw transaction plus its funding transactions
into the plain-data description the builder consumes. Numeric values (sats,
sequence, version, locktime) come from the raw bytes via python-bitcointx —
exact integers, no JSON-float round-trips. Script *types* and addresses come
from Bitcoin Core's ``decoderawtransaction`` when a decode is supplied (the
live RPC path); offline (fixtures/tests) they are derived locally with the
same classification rules Core uses for legacy scripts.
"""

from __future__ import annotations

from bitcointx.core import CTransaction, b2lx, x

from calc_functions.calc_func import (
    hash160_to_p2pkh_address,
    hash160_to_p2sh_address,
)

from .script_parse import classify_spk, p2pkh_hash160, sighash_byte


class DatasetError(Exception):
    """The transaction or its funding data cannot be assembled."""


def _spk_info(spk_hex: str, network: str, core_spk: dict | None) -> dict:
    """Type + address for one scriptPubKey, preferring Core's decode.

    Falls back to local classification for whatever Core's decode does not
    carry (older Core versions, partial decodes).
    """
    core_spk = core_spk or {}
    spk_type = core_spk.get("type") or classify_spk(spk_hex)
    address = core_spk.get("address")
    if address is None:
        addresses = core_spk.get("addresses") or []
        address = addresses[0] if len(addresses) == 1 else None
    if address is None:
        if spk_type == "pubkeyhash" and p2pkh_hash160(spk_hex):
            address = hash160_to_p2pkh_address(p2pkh_hash160(spk_hex), network)
        elif spk_type == "scripthash" and len(spk_hex) == 46:
            address = hash160_to_p2sh_address(spk_hex[4:44], network)
    return {"spk_type": spk_type, "address": address}


def assemble_dataset(
    tx_hex: str,
    prev_txs: dict[str, str],
    network: str = "mainnet",
    decoded: dict | None = None,
    prev_decoded: dict[str, dict] | None = None,
) -> dict:
    """Build the dataset for ``tx_hex``.

    ``prev_txs`` maps display-order funding txids to their raw hex. Inputs
    whose funding tx is missing raise ``DatasetError`` (coinbase inputs need
    none). ``decoded``/``prev_decoded`` are optional Core
    ``decoderawtransaction`` results keyed the same way.
    """
    try:
        tx = CTransaction.deserialize(x(tx_hex))
    except Exception as exc:
        raise DatasetError(f"could not decode transaction: {exc}") from exc

    if tx.has_witness():
        raise DatasetError(
            "SegWit/Taproot transactions are not supported yet — legacy only."
        )

    decoded_vin = (decoded or {}).get("vin", [])
    vin = []
    for idx, txin in enumerate(tx.vin):
        if txin.prevout.is_null():
            vin.append(
                {
                    "coinbase": True,
                    "prev_txid": None,
                    "vout": None,
                    "sequence": txin.nSequence,
                    "scriptsig_hex": bytes(txin.scriptSig).hex(),
                    "sighash_type": None,
                    "prev_tx_hex": None,
                    "prev_value_sats": None,
                    "prev_scriptpubkey": None,
                    "prev_spk_type": None,
                    "prev_address": None,
                    "privkey_hex": None,
                }
            )
            continue

        prev_txid = b2lx(txin.prevout.hash)
        prev_hex = prev_txs.get(prev_txid)
        if prev_hex is None:
            raise DatasetError(
                f"funding transaction {prev_txid[:16]}… is missing — your node "
                "must know it (enable txindex=1 or use a wallet transaction)."
            )
        try:
            prev_tx = CTransaction.deserialize(x(prev_hex))
        except Exception as exc:
            raise DatasetError(
                f"could not decode funding tx {prev_txid[:16]}…: {exc}"
            ) from exc
        if txin.prevout.n >= len(prev_tx.vout):
            raise DatasetError(
                f"input {idx} spends output {txin.prevout.n} of {prev_txid[:16]}…, "
                f"which only has {len(prev_tx.vout)} outputs."
            )
        spent = prev_tx.vout[txin.prevout.n]
        prev_spk = bytes(spent.scriptPubKey).hex()
        core_prev_vout = None
        if prev_decoded and prev_txid in prev_decoded:
            outs = prev_decoded[prev_txid].get("vout", [])
            if txin.prevout.n < len(outs):
                core_prev_vout = outs[txin.prevout.n].get("scriptPubKey")
        info = _spk_info(prev_spk, network, core_prev_vout)
        scriptsig_hex = bytes(txin.scriptSig).hex()
        vin.append(
            {
                "coinbase": False,
                "prev_txid": prev_txid,
                "vout": txin.prevout.n,
                "sequence": txin.nSequence,
                "scriptsig_hex": scriptsig_hex,
                "sighash_type": sighash_byte(scriptsig_hex),
                "prev_tx_hex": prev_hex,
                "prev_value_sats": spent.nValue,
                "prev_scriptpubkey": prev_spk,
                "prev_spk_type": info["spk_type"],
                "prev_address": info["address"],
                "privkey_hex": None,
            }
        )
        # keep Core's decode authoritative where supplied
        if idx < len(decoded_vin):
            core_in = decoded_vin[idx]
            if "sequence" in core_in:
                vin[-1]["sequence"] = int(core_in["sequence"])
            core_sig = (core_in.get("scriptSig") or {}).get("hex")
            if core_sig is not None:
                vin[-1]["scriptsig_hex"] = core_sig

    decoded_vout = (decoded or {}).get("vout", [])
    vout = []
    for j, txout in enumerate(tx.vout):
        spk_hex = bytes(txout.scriptPubKey).hex()
        core_spk = (
            decoded_vout[j].get("scriptPubKey") if j < len(decoded_vout) else None
        )
        info = _spk_info(spk_hex, network, core_spk)
        vout.append(
            {
                "value_sats": txout.nValue,
                "scriptpubkey": spk_hex,
                "spk_type": info["spk_type"],
                "address": info["address"],
            }
        )

    version = (decoded or {}).get("version", tx.nVersion)
    locktime = (decoded or {}).get("locktime", tx.nLockTime)
    txid = (decoded or {}).get("txid", b2lx(tx.GetTxid()))
    return {
        "tx_hex": tx_hex,
        "txid": txid,
        "version": int(version),
        "locktime": int(locktime),
        "has_witness": False,
        "network": network,
        "vin": vin,
        "vout": vout,
    }
