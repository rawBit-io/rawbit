"""Signing-mode golden tests: owned inputs re-sign on canvas, byte-for-byte.

The flow must *recreate* the signature (preimage spine → sha256d → low-R
RFC6979) rather than paste it, and still reproduce the exact wire bytes. The
``rebuild_p2pkh_1in1out`` fixture was captured from a real Bitcoin Core regtest
wallet, so it proves nonce-level compatibility with Core's signer.
"""

import json
from pathlib import Path

import pytest

pytest.importorskip("bitcointx")

from backend.flow_generator import assemble_dataset, generate_legacy_flow
from backend.flow_generator.legacy_builder import _auto_mode
from calc_functions.calc_func import (
    public_key_from_private_key,
    sign_as_bitcoin_core_low_r,
)

from test_legacy_builder import (
    P2PKH_SPK,
    P2PK_SPK,
    make_funding,
    make_tx,
    push,
)

FIXTURE = (
    Path(__file__).resolve().parent / "fixtures" / "rebuild_p2pkh_1in1out.json"
)

KEY_A = "aa" * 31 + "01"
KEY_B = "bb" * 31 + "02"


def sign_input(tx_fields, i, privkey, script_code):
    """Produce the legacy SIGHASH_ALL signature (DER + flag) for input i."""
    vin, vout, version, locktime = tx_fields
    preimage_vin = [
        (txid, n, script_code if k == i else "", seq)
        for k, (txid, n, _ss, seq) in enumerate(vin)
    ]
    preimage = make_tx(preimage_vin, vout, version, locktime) + "01000000"
    import hashlib

    digest = hashlib.sha256(
        hashlib.sha256(bytes.fromhex(preimage)).digest()
    ).hexdigest()
    return sign_as_bitcoin_core_low_r([privkey, digest]) + "01"


def make_signed_p2pkh_tx(keys, n_out=1):
    """A fully signed multi-input P2PKH tx where we own every key."""
    pubkeys = [public_key_from_private_key(k) for k in keys]
    import hashlib

    spks = []
    for pk in pubkeys:
        h160 = hashlib.new(
            "ripemd160", hashlib.sha256(bytes.fromhex(pk)).digest()
        ).hexdigest()
        spks.append("76a914" + h160 + "88ac")
    ftxid, fhex = make_funding(spks)
    vin = [(ftxid, n, "", 0xFFFFFFFD) for n in range(len(keys))]
    vout = [(40_000 + j, P2PKH_SPK) for j in range(n_out)]
    fields = (vin, vout, 2, 0)
    signed_vin = []
    for i, key in enumerate(keys):
        sig = sign_input(fields, i, key, spks[i])
        signed_vin.append(
            (ftxid, i, push(sig) + push(pubkeys[i]), 0xFFFFFFFD)
        )
    return make_tx(signed_vin, vout), {ftxid: fhex}


def dataset_with_keys(tx_hex, prev_txs, keys_by_input):
    dataset = assemble_dataset(tx_hex, prev_txs, network="regtest")
    for i, key in keys_by_input.items():
        dataset["vin"][i]["privkey_hex"] = key
    return dataset


def titles(flow):
    out = {}
    for n in flow["nodes"]:
        d = n.get("data") or {}
        out.setdefault(d.get("title", ""), []).append(d)
    return out


def assert_signature_recreated(flow, fix_tx_hex, i=0):
    by = titles(flow)
    sign_node = by[f"Sign TX (Low-R) — input {i}"][0]
    der = sign_node["result"]
    assert der and (der + "01") in fix_tx_hex  # the recreated sig is on the wire
    assert by[f"Verify Script — input {i}"][0]["result"] == "true"


# ── the Core-wallet golden fixture ───────────────────────────────────────────

def test_core_wallet_fixture_resigns_byte_for_byte():
    fix = json.loads(FIXTURE.read_text())
    prev = {fix["vin"][0]["prev_txid"]: fix["vin"][0]["prev_tx_hex"]}
    dataset = dataset_with_keys(
        fix["tx_hex"], prev, {0: fix["vin"][0]["privkey_hex"]}
    )
    assert _auto_mode(dataset["vin"][0]) == "sign"
    flow = generate_legacy_flow(dataset)
    by = titles(flow)
    assert by["Final Raw Transaction"][0]["result"] == fix["tx_hex"]
    assert by["Rebuilt bytes match original?"][0]["result"] == "true"
    assert_signature_recreated(flow, fix["tx_hex"])
    card = next(n for n in flow["nodes"] if n["type"] == "shadcnTextInfo")
    assert "recreated on the canvas" in card["data"]["content"]


# ── synthetic signing matrix ─────────────────────────────────────────────────

def test_two_owned_inputs_both_resign():
    tx_hex, prevs = make_signed_p2pkh_tx([KEY_A, KEY_B], n_out=2)
    dataset = dataset_with_keys(tx_hex, prevs, {0: KEY_A, 1: KEY_B})
    flow, by = rebuild_and_check_dataset(dataset, tx_hex)
    assert_signature_recreated(flow, tx_hex, 0)
    assert_signature_recreated(flow, tx_hex, 1)
    # two preimage spines with sentinels exist
    assert f"Unsigned TX (preimage) — input 0" in by
    assert f"Unsigned TX (preimage) — input 1" in by


def test_mixed_owned_and_foreign_inputs():
    tx_hex, prevs = make_signed_p2pkh_tx([KEY_A, KEY_B])
    dataset = dataset_with_keys(tx_hex, prevs, {0: KEY_A})  # input 1 foreign
    flow, by = rebuild_and_check_dataset(dataset, tx_hex)
    assert_signature_recreated(flow, tx_hex, 0)
    assert "Sign TX (Low-R) — input 1" not in by
    assert len(by["scriptSig (push sig & pubkey) — input 1"]) == 1
    card = next(n for n in flow["nodes"] if n["type"] == "shadcnTextInfo")
    assert "re-signs 1 of 2 input(s)" in card["data"]["content"]


def test_p2pk_owned_input_resigns():
    pubkey = public_key_from_private_key(KEY_A)
    spk = push(pubkey) + "ac"
    ftxid, fhex = make_funding([spk])
    vin = [(ftxid, 0, "", 0xFFFFFFFF)]
    vout = [(40_000, P2PK_SPK)]
    sig = sign_input((vin, vout, 2, 0), 0, KEY_A, spk)
    tx_hex = make_tx([(ftxid, 0, push(sig), 0xFFFFFFFF)], vout)
    dataset = dataset_with_keys(tx_hex, {ftxid: fhex}, {0: KEY_A})
    flow, by = rebuild_and_check_dataset(dataset, tx_hex)
    assert len(by["scriptSig (push sig) — input 0"]) == 1
    assert_signature_recreated(flow, tx_hex, 0)


def test_non_sighash_all_falls_back_to_wire():
    """A privkey is present but the wire sig uses SIGHASH_NONE — the builder
    must not pretend to re-sign and falls back to the wire signature."""
    tx_hex, prevs = make_signed_p2pkh_tx([KEY_A])
    dataset = dataset_with_keys(tx_hex, prevs, {0: KEY_A})
    dataset["vin"][0]["sighash_type"] = 2
    flow, by = rebuild_and_check_dataset(dataset, tx_hex)
    assert "Sign TX (Low-R) — input 0" not in by


def test_foreign_nonce_downgrades_to_wire():
    """The wire signature was made with a different nonce algorithm: the
    re-signed bytes differ, so the gate must downgrade to wire mode and still
    reproduce the original exactly."""
    tx_hex, prevs = make_signed_p2pkh_tx([KEY_A])
    dataset = dataset_with_keys(tx_hex, prevs, {0: KEY_B})  # wrong key!
    flow, by = rebuild_and_check_dataset(dataset, tx_hex)
    assert by["Final Raw Transaction"][0]["result"] == tx_hex
    assert "Sign TX (Low-R) — input 0" not in by  # downgraded
    assert len(by["scriptSig (push sig & pubkey) — input 0"]) == 1


def test_uncompressed_wire_pubkey_keeps_wire_pubkey_but_resigns():
    """Old wallets used uncompressed pubkeys; the derived (compressed) pubkey
    differs from the wire, so the pubkey is pasted while the signature is
    still recreated."""
    import hashlib

    from ecdsa import SigningKey, SECP256k1

    sk = SigningKey.from_string(bytes.fromhex(KEY_A), curve=SECP256k1)
    point = sk.get_verifying_key().pubkey.point
    pubkey_unc = (
        "04" + format(point.x(), "064x") + format(point.y(), "064x")
    )
    h160 = hashlib.new(
        "ripemd160", hashlib.sha256(bytes.fromhex(pubkey_unc)).digest()
    ).hexdigest()
    spk = "76a914" + h160 + "88ac"
    ftxid, fhex = make_funding([spk])
    vin = [(ftxid, 0, "", 0xFFFFFFFF)]
    vout = [(40_000, P2PKH_SPK)]
    sig = sign_input((vin, vout, 2, 0), 0, KEY_A, spk)
    tx_hex = make_tx([(ftxid, 0, push(sig) + push(pubkey_unc), 0xFFFFFFFF)], vout)
    dataset = dataset_with_keys(tx_hex, {ftxid: fhex}, {0: KEY_A})
    flow, by = rebuild_and_check_dataset(dataset, tx_hex)
    assert_signature_recreated(flow, tx_hex, 0)
    assert len(by["Public Key (from wire) — input 0"]) == 1
    assert "PrivKey → PubKey — input 0" not in by


def rebuild_and_check_dataset(dataset, tx_hex):
    flow = generate_legacy_flow(dataset)
    by = titles(flow)
    assert by["Final Raw Transaction"][0]["result"] == tx_hex
    assert by["Rebuilt bytes match original?"][0]["result"] == "true"
    assert by["TXID matches?"][0]["result"] == "true"
    return flow, by
