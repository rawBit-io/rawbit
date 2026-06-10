"""Multisig signing-mode golden tests: bare multisig and P2SH multisig.

Per wire signature the builder either recreates it (owned key, matched to its
pubkey by verifying against the sighash digest) or places it from the wire —
and the rebuilt bytes must equal the original either way.
"""

import hashlib

import pytest

pytest.importorskip("bitcointx")

from backend.flow_generator import assemble_dataset
from backend.flow_generator.legacy_builder import (
    _legacy_sighash_digest,
)
from calc_functions.calc_func import (
    public_key_from_private_key,
    sign_as_bitcoin_core_low_r,
)

from test_legacy_builder import P2PKH_SPK, make_funding, make_tx, push
from test_legacy_signing import rebuild_and_check_dataset, titles

KEY_1 = "11" * 31 + "01"
KEY_2 = "22" * 31 + "02"
KEY_3 = "33" * 31 + "03"


def multisig_spk(m, pubkeys):
    n = len(pubkeys)
    return (
        f"{0x50 + m:02x}"
        + "".join(push(pk) for pk in pubkeys)
        + f"{0x50 + n:02x}"
        + "ae"
    )


def p2sh_spk(redeem_hex):
    h160 = hashlib.new(
        "ripemd160", hashlib.sha256(bytes.fromhex(redeem_hex)).digest()
    ).hexdigest()
    return "a914" + h160 + "87"


def sign_digest(privkey, digest_hex):
    return sign_as_bitcoin_core_low_r([privkey, digest_hex]) + "01"


def make_ms_tx(keys_signing, all_keys, *, p2sh):
    """A 2-of-3 multisig spend (bare or P2SH) signed by ``keys_signing``."""
    pubkeys = [public_key_from_private_key(k) for k in all_keys]
    redeem = multisig_spk(2, pubkeys)
    spk = p2sh_spk(redeem) if p2sh else redeem
    ftxid, fhex = make_funding([spk])
    vin = [(ftxid, 0, "", 0xFFFFFFFF)]
    vout = [(40_000, P2PKH_SPK)]

    # digest over the scriptCode (redeem for p2sh, the spk itself for bare)
    preimage = make_tx([(ftxid, 0, redeem, 0xFFFFFFFF)], vout) + "01000000"
    digest = hashlib.sha256(
        hashlib.sha256(bytes.fromhex(preimage)).digest()
    ).hexdigest()
    sigs = [sign_digest(k, digest) for k in keys_signing]
    scriptsig = "00" + "".join(push(s) for s in sigs)
    if p2sh:
        scriptsig += push(redeem)
    tx_hex = make_tx([(ftxid, 0, scriptsig, 0xFFFFFFFF)], vout)
    return tx_hex, {ftxid: fhex}, pubkeys


def dataset_with_ms_keys(tx_hex, prevs, keys_by_pubkey):
    dataset = assemble_dataset(tx_hex, prevs, network="regtest")
    dataset["vin"][0]["privkeys_by_pubkey"] = keys_by_pubkey
    return dataset


@pytest.mark.parametrize("p2sh", [False, True], ids=["bare", "p2sh"])
def test_all_owned_keys_resign(p2sh):
    tx_hex, prevs, pubkeys = make_ms_tx([KEY_1, KEY_3], [KEY_1, KEY_2, KEY_3], p2sh=p2sh)
    dataset = dataset_with_ms_keys(
        tx_hex, prevs, {pubkeys[0]: KEY_1, pubkeys[2]: KEY_3}
    )
    flow, by = rebuild_and_check_dataset(dataset, tx_hex)
    assert len(by["Sign TX (Low-R) — input 0 sig 0"]) == 1
    assert len(by["Sign TX (Low-R) — input 0 sig 1"]) == 1
    assert by["Verify Script — input 0"][0]["result"] == "true"
    label = "P2SH multisig" if p2sh else "bare multisig"
    assert len(by[f"scriptSig ({label}) — input 0"]) == 1
    if p2sh:
        assert len(by["Redeem Script (from wire) — input 0"]) == 1
    card = next(n for n in flow["nodes"] if n["type"] == "shadcnTextInfo")
    assert "2 of 2 multisig signature(s)" in card["data"]["content"]


@pytest.mark.parametrize("p2sh", [False, True], ids=["bare", "p2sh"])
def test_partially_owned_keys_mix_recreated_and_wire(p2sh):
    tx_hex, prevs, pubkeys = make_ms_tx([KEY_1, KEY_3], [KEY_1, KEY_2, KEY_3], p2sh=p2sh)
    dataset = dataset_with_ms_keys(tx_hex, prevs, {pubkeys[2]: KEY_3})
    flow, by = rebuild_and_check_dataset(dataset, tx_hex)
    # sig 0 (KEY_1, foreign) is pasted; sig 1 (KEY_3, owned) is recreated
    assert "Sign TX (Low-R) — input 0 sig 0" not in by
    assert len(by["Signature 0 (from wire) — input 0"]) == 1
    assert len(by["Sign TX (Low-R) — input 0 sig 1"]) == 1
    card = next(n for n in flow["nodes"] if n["type"] == "shadcnTextInfo")
    assert "1 of 2 multisig signature(s)" in card["data"]["content"]
    assert "the rest placed from the wire" in card["data"]["content"]


def test_no_owned_keys_falls_back_to_decomposed_wire():
    tx_hex, prevs, pubkeys = make_ms_tx([KEY_1, KEY_2], [KEY_1, KEY_2, KEY_3], p2sh=True)
    dataset = dataset_with_ms_keys(tx_hex, prevs, {})
    flow, by = rebuild_and_check_dataset(dataset, tx_hex)
    assert len(by["scriptSig (decomposed) — input 0"]) == 1
    assert not any(t.startswith("Sign TX") for t in by)


def test_sighash_digest_matches_engine():
    """The plan-time digest helper must agree with the canvas preimage chain
    (it decides which signatures we claim we can recreate)."""
    tx_hex, prevs, pubkeys = make_ms_tx([KEY_1], [KEY_1, KEY_2, KEY_3], p2sh=False)
    dataset = dataset_with_ms_keys(tx_hex, prevs, {pubkeys[0]: KEY_1})
    digest = _legacy_sighash_digest(
        dataset, 0, dataset["vin"][0]["prev_scriptpubkey"]
    )
    flow, by = rebuild_and_check_dataset(dataset, tx_hex)
    assert by["Data → SHA-256d"]  # preimage hash node exists
    hashes = [
        d["result"]
        for d in by["Data → SHA-256d"]
        if d.get("borderColor") == "#eab308"
    ]
    assert digest.hex() in hashes
