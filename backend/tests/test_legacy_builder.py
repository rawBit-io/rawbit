"""Golden tests for the general legacy flow builder.

Every test builds a synthetic legacy transaction (plus its funding
transactions), assembles the dataset offline, generates the flow, and asserts
the flow's own engine run reproduced the source bytes exactly — the same gate
that protects live rebuilds. Wire mode only: scriptSigs are placed from the
wire, so signatures need the right *shape* but not validity.
"""

import json
from pathlib import Path

import pytest

pytest.importorskip("bitcointx")

from bitcointx.core import (
    CMutableTransaction,
    CMutableTxIn,
    CMutableTxOut,
    COutPoint,
    b2lx,
    lx,
    x,
)
from bitcointx.core.script import CScript

from backend.flow_generator import (
    assemble_dataset,
    generate_legacy_flow,
    DatasetError,
    UnsupportedTransaction,
)
from backend.flow_generator.legacy_builder import build_legacy_flow

FIXTURE = (
    Path(__file__).resolve().parent / "fixtures" / "rebuild_p2pkh_1in1out.json"
)

# Realistic shapes (validity not required in wire mode)
SIG = "3044" + "0220" + "11" * 32 + "0220" + "22" * 32 + "01"  # 71B DER + ALL
PUBKEY = "02" + "ab" * 32
HASH160 = "33" * 20

P2PKH_SPK = "76a914" + HASH160 + "88ac"
P2PK_SPK = "21" + PUBKEY + "ac"
MULTISIG_SPK = "5221" + PUBKEY + "21" + "03" + "cd" * 32 + "52ae"  # 2-of-2
P2SH_SPK = "a914" + "44" * 20 + "87"
NULLDATA_SPK = "6a13" + b"rawBit rebuild test".hex()
NONSTANDARD_SPK = "51"  # OP_TRUE


def push(data_hex: str) -> str:
    """Minimal push encoding (direct length up to 75 bytes, then PUSHDATA1)."""
    n = len(data_hex) // 2
    if n <= 75:
        return f"{n:02x}" + data_hex
    assert n <= 255
    return "4c" + f"{n:02x}" + data_hex


def make_tx(vin, vout, version=2, locktime=0) -> str:
    tx = CMutableTransaction()
    tx.nVersion = version
    tx.nLockTime = locktime
    tx.vin = [
        CMutableTxIn(
            COutPoint(lx(txid), n), CScript(x(scriptsig)), nSequence=seq
        )
        for txid, n, scriptsig, seq in vin
    ]
    tx.vout = [CMutableTxOut(sats, CScript(x(spk))) for sats, spk in vout]
    return tx.serialize().hex()


def make_funding(spks, base_sats=100_000) -> tuple[str, str]:
    """A legacy funding tx with one output per scriptPubKey. Returns (txid, hex)."""
    hex_ = make_tx(
        [("ee" * 32, 0, "51", 0xFFFFFFFF)],
        [(base_sats + i, spk) for i, spk in enumerate(spks)],
    )
    tx = CMutableTransaction.deserialize(x(hex_))
    return b2lx(tx.GetTxid()), hex_


def rebuild_and_check(tx_hex, prev_txs, network="regtest"):
    dataset = assemble_dataset(tx_hex, prev_txs, network=network)
    flow = generate_legacy_flow(dataset)
    by_title = {}
    for n in flow["nodes"]:
        d = n.get("data") or {}
        by_title.setdefault(d.get("title", ""), []).append(d)
    final = by_title["Final Raw Transaction"][0]
    assert final["result"] == tx_hex  # byte-perfect reconstruction
    assert by_title["Rebuilt bytes match original?"][0]["result"] == "true"
    assert by_title["TXID matches?"][0]["result"] == "true"
    return flow, by_title


# ── shape matrix ─────────────────────────────────────────────────────────────

def test_multi_input_multi_output_p2pkh():
    ftxid, fhex = make_funding([P2PKH_SPK, P2PKH_SPK, P2PKH_SPK])
    scriptsig = push(SIG) + push(PUBKEY)
    tx_hex = make_tx(
        [(ftxid, n, scriptsig, 0xFFFFFFFD) for n in range(3)],
        [(50_000, P2PKH_SPK), (40_000, P2PKH_SPK)],
    )
    flow, by_title = rebuild_and_check(tx_hex, {ftxid: fhex})
    # every input got the structured sig/pubkey decomposition
    assert len(by_title["scriptSig (push sig & pubkey) — input 0"]) == 1
    assert len(by_title["scriptSig (push sig & pubkey) — input 2"]) == 1
    # spine carries 3 input groups / 2 output groups
    spine = by_title["Final Raw Transaction"][0]
    assert spine["groupInstances"] == {"INPUTS[]": 3, "OUTPUTS[]": 2}


def test_p2pk_spend_and_p2pk_output():
    ftxid, fhex = make_funding([P2PK_SPK])
    tx_hex = make_tx(
        [(ftxid, 0, push(SIG), 0xFFFFFFFF)],
        [(90_000, P2PK_SPK)],
    )
    flow, by_title = rebuild_and_check(tx_hex, {ftxid: fhex})
    assert len(by_title["scriptSig (push sig) — input 0"]) == 1
    assert len(by_title["scriptPubKey (P2PK) — output 0"]) == 1


def test_op_return_output():
    ftxid, fhex = make_funding([P2PKH_SPK])
    tx_hex = make_tx(
        [(ftxid, 0, push(SIG) + push(PUBKEY), 0xFFFFFFFF)],
        [(0, NULLDATA_SPK), (80_000, P2PKH_SPK)],
    )
    flow, by_title = rebuild_and_check(tx_hex, {ftxid: fhex})
    assert len(by_title["scriptPubKey (OP_RETURN) — output 0"]) == 1


def test_bare_multisig_spend_and_output():
    ftxid, fhex = make_funding([MULTISIG_SPK])
    scriptsig = "00" + push(SIG) + push(SIG)  # OP_0 <sig> <sig>
    tx_hex = make_tx(
        [(ftxid, 0, scriptsig, 0xFFFFFFFF)],
        [(70_000, MULTISIG_SPK)],
    )
    flow, by_title = rebuild_and_check(tx_hex, {ftxid: fhex})
    # wire mode: the multisig scriptSig decomposes into OP_0 + sig pushes
    assert len(by_title["scriptSig (decomposed) — input 0"]) == 1
    assert len(by_title["scriptPubKey (bare multisig) — output 0"]) == 1


def test_p2sh_spend_and_output():
    redeem = MULTISIG_SPK
    ftxid, fhex = make_funding([P2SH_SPK])
    scriptsig = "00" + push(SIG) + push(SIG) + push(redeem)
    tx_hex = make_tx(
        [(ftxid, 0, scriptsig, 0xFFFFFFFF)],
        [(60_000, P2SH_SPK)],
    )
    flow, by_title = rebuild_and_check(tx_hex, {ftxid: fhex})
    # wire mode: OP_0 + sig pushes + redeemScript push, each its own node
    assert len(by_title["scriptSig (decomposed) — input 0"]) == 1
    assert len(by_title["scriptPubKey (P2SH) — output 0"]) == 1


def test_coinbase_transaction():
    tx_hex = make_tx(
        [("00" * 32, 0xFFFFFFFF, "0303ab0d" + "00" * 8, 0xFFFFFFFF)],
        [(5_000_000_000, P2PKH_SPK), (0, NULLDATA_SPK)],
    )
    flow, by_title = rebuild_and_check(tx_hex, {})
    assert len(by_title["Coinbase scriptSig — input 0"]) == 1
    # no funding block and no verification for a coinbase input
    assert "Funding rawTX — input 0" not in by_title
    assert "Verify Script — input 0" not in by_title


def test_nonstandard_scripts_fall_back_to_raw():
    ftxid, fhex = make_funding([NONSTANDARD_SPK])
    tx_hex = make_tx(
        [(ftxid, 0, "5151", 0xFFFFFFFF)],  # OP_1 OP_1 — no pushes
        [(10_000, NONSTANDARD_SPK)],
    )
    flow, by_title = rebuild_and_check(tx_hex, {ftxid: fhex})
    assert len(by_title["scriptSig (from wire) — input 0"]) == 1
    assert len(by_title["scriptPubKey (raw) — output 0"]) == 1
    assert "Verify Script — input 0" not in by_title


def test_non_minimal_push_downgrades_to_raw():
    """A PUSHDATA1-encoded 71-byte push can't be rebuilt with minimal push
    nodes — the byte-equality gate must fall back to the raw scriptSig."""
    ftxid, fhex = make_funding([P2PKH_SPK])
    scriptsig = "4c" + f"{len(SIG)//2:02x}" + SIG + push(PUBKEY)
    tx_hex = make_tx(
        [(ftxid, 0, scriptsig, 0xFFFFFFFF)],
        [(50_000, P2PKH_SPK)],
    )
    flow, by_title = rebuild_and_check(tx_hex, {ftxid: fhex})
    assert len(by_title["scriptSig (from wire) — input 0"]) == 1


def test_locktime_version_and_sequence_variants():
    ftxid, fhex = make_funding([P2PKH_SPK])
    tx_hex = make_tx(
        [(ftxid, 0, push(SIG) + push(PUBKEY), 0xFFFFFFFE)],
        [(50_000, P2PKH_SPK)],
        version=1,
        locktime=654_321,
    )
    rebuild_and_check(tx_hex, {ftxid: fhex})


def test_mixed_shapes_one_transaction():
    ftxid, fhex = make_funding([P2PKH_SPK, P2PK_SPK, MULTISIG_SPK])
    tx_hex = make_tx(
        [
            (ftxid, 0, push(SIG) + push(PUBKEY), 0xFFFFFFFF),
            (ftxid, 1, push(SIG), 0xFFFFFFFF),
            (ftxid, 2, "00" + push(SIG) + push(SIG), 0xFFFFFFFF),
        ],
        [
            (10_000, P2PKH_SPK),
            (20_000, P2PK_SPK),
            (0, NULLDATA_SPK),
            (30_000, P2SH_SPK),
        ],
    )
    flow, by_title = rebuild_and_check(tx_hex, {ftxid: fhex})
    spine = by_title["Final Raw Transaction"][0]
    assert spine["groupInstances"] == {"INPUTS[]": 3, "OUTPUTS[]": 4}


def test_fixture_dataset_still_byte_perfect():
    fix = json.loads(FIXTURE.read_text())
    prev = {fix["vin"][0]["prev_txid"]: fix["vin"][0]["prev_tx_hex"]}
    flow, by_title = rebuild_and_check(fix["tx_hex"], prev, network="regtest")
    assert by_title["Verify Script — input 0"][0]["result"] == "true"


# ── rejection paths ──────────────────────────────────────────────────────────

def test_rejects_witness_transaction():
    # minimal P2WPKH-shaped tx: marker+flag and one witness item
    wtx = (
        "02000000"
        "0001"
        "01" + "aa" * 32 + "00000000" + "00" + "ffffffff"
        "01" + "1027000000000000" + "16" + "0014" + "55" * 20 +
        "01" + "01" + "00" +
        "00000000"
    )
    with pytest.raises(DatasetError, match="SegWit"):
        assemble_dataset(wtx, {})


def test_rejects_missing_funding_tx():
    ftxid, _ = make_funding([P2PKH_SPK])
    tx_hex = make_tx(
        [(ftxid, 0, push(SIG) + push(PUBKEY), 0xFFFFFFFF)],
        [(50_000, P2PKH_SPK)],
    )
    with pytest.raises(DatasetError, match="txindex"):
        assemble_dataset(tx_hex, {})


def test_rejects_out_of_range_vout():
    ftxid, fhex = make_funding([P2PKH_SPK])
    tx_hex = make_tx(
        [(ftxid, 5, push(SIG) + push(PUBKEY), 0xFFFFFFFF)],
        [(50_000, P2PKH_SPK)],
    )
    with pytest.raises(DatasetError, match="only has"):
        assemble_dataset(tx_hex, {ftxid: fhex})


def test_rejects_oversized_transaction():
    ftxid, fhex = make_funding([P2PKH_SPK] * 11, base_sats=10_000)
    tx_hex = make_tx(
        [(ftxid, n, push(SIG) + push(PUBKEY), 0xFFFFFFFF) for n in range(11)],
        [(5_000, P2PKH_SPK)],
    )
    dataset = assemble_dataset(tx_hex, {ftxid: fhex})
    with pytest.raises(UnsupportedTransaction, match="too large"):
        generate_legacy_flow(dataset)


# ── flow hygiene ─────────────────────────────────────────────────────────────

def test_flow_structure_is_well_formed():
    ftxid, fhex = make_funding([P2PKH_SPK, P2PK_SPK])
    tx_hex = make_tx(
        [
            (ftxid, 0, push(SIG) + push(PUBKEY), 0xFFFFFFFF),
            (ftxid, 1, push(SIG), 0xFFFFFFFF),
        ],
        [(10_000, P2PKH_SPK), (0, NULLDATA_SPK)],
    )
    dataset = assemble_dataset(tx_hex, {ftxid: fhex})
    flow, _refs = build_legacy_flow(dataset)

    ids = [n["id"] for n in flow["nodes"]]
    assert len(ids) == len(set(ids))  # unique node ids
    id_set = set(ids)
    seen_handles = set()
    for e in flow["edges"]:
        assert e["source"] in id_set and e["target"] in id_set
        key = (e["target"], e["targetHandle"])
        assert key not in seen_handles  # one cable per input handle
        seen_handles.add(key)

    # no two calculation nodes share a position (overlap guard)
    positions = [
        (n["position"]["x"], n["position"]["y"])
        for n in flow["nodes"]
        if n["type"] == "calculation"
    ]
    assert len(positions) == len(set(positions))

    # exactly one info card, naming the txid
    cards = [n for n in flow["nodes"] if n["type"] == "shadcnTextInfo"]
    assert len(cards) == 1
    assert dataset["txid"] in cards[0]["data"]["content"]
