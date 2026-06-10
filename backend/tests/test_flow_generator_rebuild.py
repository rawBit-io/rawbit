"""Tests for the rebuild dataset builder, with a fake RPC (no node needed)."""

import json
from pathlib import Path

import pytest

pytest.importorskip("bitcointx")

import bitcointx
from bitcointx.wallet import CCoinExtKey

from backend.flow_generator.rebuild import (
    build_rebuild_dataset,
    _parse_pkh_descriptor,
    _resolve_path,
    _derive_privkey,
    RebuildError,
)
from backend.calc_functions import calc_func as calc

FIXTURE = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "rebuild_p2pkh_1in1out.json").read_text()
)


def _decode(raw_hex: str) -> dict:
    """Stand-in for Bitcoin Core's decoderawtransaction in the fake RPC."""
    from bitcointx.core import CTransaction, b2lx, x

    tx = CTransaction.deserialize(x(raw_hex))
    vin = []
    for txin in tx.vin:
        if txin.prevout.is_null():
            vin.append({"coinbase": bytes(txin.scriptSig).hex()})
            continue
        vin.append(
            {
                "txid": b2lx(txin.prevout.hash),
                "vout": txin.prevout.n,
                "scriptSig": {"hex": bytes(txin.scriptSig).hex()},
                "sequence": txin.nSequence,
            }
        )
    vout = [
        {
            "value": o.nValue / 1e8,
            "n": n,
            "scriptPubKey": {"hex": bytes(o.scriptPubKey).hex()},
        }
        for n, o in enumerate(tx.vout)
    ]
    return {
        "txid": b2lx(tx.GetTxid()),
        "version": tx.nVersion,
        "locktime": tx.nLockTime,
        "vin": vin,
        "vout": vout,
    }


class FakeRPC:
    """Replays the RPC calls build_rebuild_dataset makes for the fixture tx."""

    def __init__(self, chain="regtest"):
        self._chain = chain
        prev = FIXTURE["vin"][0]
        self._responses = {
            ("getrawtransaction", prev["prev_txid"]): prev["prev_tx_hex"],
        }
        self.calls = []

    def chain(self):
        return self._chain

    def call_gated(self, method, params=None):
        params = params or []
        self.calls.append(method)
        if method == "getrawtransaction":
            try:
                return self._responses[("getrawtransaction", params[0])]
            except KeyError:
                raise RuntimeError(f"No such mempool or blockchain transaction")
        if method == "decoderawtransaction":
            return _decode(params[0])
        if method == "getaddressinfo":
            return {"ismine": False}  # skip key derivation in this unit test
        if method == "listdescriptors":
            return {"descriptors": []}
        raise KeyError(method)


def test_build_dataset_shape_from_hex():
    dataset = build_rebuild_dataset(FakeRPC(), FIXTURE["tx_hex"])
    assert dataset["txid"] == FIXTURE["txid"]
    assert dataset["version"] == FIXTURE["version"]
    assert dataset["locktime"] == FIXTURE["locktime"]
    assert len(dataset["vin"]) == 1 and len(dataset["vout"]) == 1
    inp = dataset["vin"][0]
    assert inp["sighash_type"] == 1
    assert inp["prev_scriptpubkey"] == FIXTURE["vin"][0]["prev_scriptpubkey"]
    assert inp["prev_spk_type"] == "pubkeyhash"
    assert inp["vout"] == FIXTURE["vin"][0]["vout"]
    assert inp["privkey_hex"] is None  # wallet said ismine: False
    assert dataset["vout"][0]["scriptpubkey"] == FIXTURE["vout"][0]["scriptpubkey"]


def test_core_decode_is_requested():
    """decoderawtransaction is the parser of record for the tx and its
    funding transactions."""
    rpc = FakeRPC()
    build_rebuild_dataset(rpc, FIXTURE["tx_hex"])
    assert rpc.calls.count("decoderawtransaction") == 2  # tx + 1 funding tx


def test_wire_rebuild_works_outside_regtest_without_keys():
    rpc = FakeRPC(chain="main")
    dataset = build_rebuild_dataset(rpc, FIXTURE["tx_hex"])
    assert dataset["network"] == "mainnet"
    assert dataset["vin"][0]["privkey_hex"] is None
    assert "getaddressinfo" not in rpc.calls  # no key derivation off-regtest


def test_build_dataset_rejects_garbage_hex():
    with pytest.raises(RebuildError, match="decode"):
        build_rebuild_dataset(FakeRPC(), "zz" * 40)


def test_missing_funding_tx_mentions_txindex():
    fixture_prev = FIXTURE["vin"][0]["prev_txid"]
    rpc = FakeRPC()
    rpc._responses.pop(("getrawtransaction", fixture_prev))
    with pytest.raises(RebuildError, match="txindex"):
        build_rebuild_dataset(rpc, FIXTURE["tx_hex"])


def test_parse_pkh_descriptor():
    master = (
        "pkh(tprv8ZgxMBicQKsPfGeiVtKVzyAYWjP5KgG7LuigpSRVE1XK7TPn3wnhY8Qf"
        "GT3V5PJqzcAwd1fLDcCXbdUqUGP9iBmZn9U5P8erV59GRgHcZLm/44h/1h/0h/0/*)#wek3ex9z"
    )
    xprv, template = _parse_pkh_descriptor(master)
    assert xprv.startswith("tprv") and "/" not in xprv
    assert template == "44h/1h/0h/0/*"
    # account-level export with key-origin prefix
    assert _parse_pkh_descriptor("pkh([35466ecd/44h/1h/0h]tprv9xyz/0/*)#abc") == (
        "tprv9xyz",
        "0/*",
    )
    # non-pkh descriptors are ignored
    assert _parse_pkh_descriptor("wpkh(tprv.../0/*)") is None


def test_resolve_path_substitutes_child_index():
    assert _resolve_path("44h/1h/0h/0/*", "m/44h/1h/0h/0/5") == "44h/1h/0h/0/5"
    assert _resolve_path("0/*", "m/44h/1h/0h/0/7") == "0/7"


@pytest.mark.parametrize("export", ["master", "account"])
def test_derive_privkey_for_master_and_account_level_descriptors(export):
    """Both a depth-0 master export and an account-level export must derive."""
    with bitcointx.ChainParams("bitcoin/regtest"):
        master = CCoinExtKey.from_seed(b"\x00" * 32)
        target = master.derive_path("m/44h/1h/0h/0/5")
        want_pubkey = calc.public_key_from_private_key(target.priv.secret_bytes.hex())
        if export == "master":
            desc = f"pkh({master}/44h/1h/0h/0/*)#xxxxxxxx"
        else:
            account = master.derive_path("m/44h/1h/0h")
            desc = f"pkh([deadbeef/44h/1h/0h]{account}/0/*)#xxxxxxxx"

    class FakeKeyRPC:
        def call_gated(self, method, params=None):
            if method == "getaddressinfo":
                return {
                    "ismine": True,
                    "hdkeypath": "m/44h/1h/0h/0/5",
                    "pubkey": want_pubkey,
                }
            if method == "listdescriptors":
                return {"descriptors": [{"desc": desc}]}
            raise KeyError(method)

    privkey = _derive_privkey(FakeKeyRPC(), "irrelevant-address")
    assert privkey == target.priv.secret_bytes.hex()


def test_owned_p2pkh_key_lands_in_dataset():
    """End-to-end through build_rebuild_dataset: a wallet whose descriptor
    derives the spending key attaches it to the dataset on regtest."""
    with bitcointx.ChainParams("bitcoin/regtest"):
        master = CCoinExtKey.from_seed(b"\x01" * 32)
        child = master.derive_path("m/44h/1h/0h/0/3")
        want_key = child.priv.secret_bytes.hex()
        desc = f"pkh({master}/44h/1h/0h/0/*)#xxxxxxxx"
    want_pubkey = calc.public_key_from_private_key(want_key)

    class FakeOwnedRPC(FakeRPC):
        def call_gated(self, method, params=None):
            if method == "getaddressinfo":
                self.calls.append(method)
                return {
                    "ismine": True,
                    "hdkeypath": "m/44h/1h/0h/0/3",
                    "pubkey": want_pubkey,
                }
            if method == "listdescriptors":
                self.calls.append(method)
                return {"descriptors": [{"desc": desc}]}
            return super().call_gated(method, params)

    rpc = FakeOwnedRPC()
    dataset = build_rebuild_dataset(rpc, FIXTURE["tx_hex"])
    assert "getaddressinfo" in rpc.calls
    assert dataset["vin"][0]["privkey_hex"] == want_key
