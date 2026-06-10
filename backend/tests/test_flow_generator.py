"""The generated rebuild flow must recompute the source transaction byte-for-byte.

The fixture dataset was captured from a live regtest node (see
flow_generator.rebuild) so this test needs no node — it exercises the generator
and the calc engine only.
"""

import copy
import json
from pathlib import Path

import pytest

pytest.importorskip("bitcointx")

from backend import graph_logic
from backend.flow_generator import generate_flow
from backend.flow_generator.generator import UnsupportedTransaction

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "rebuild_p2pkh_1in1out.json"

FINAL_TX_NODE = "node_qMmh8Zrk"
VERIFY_NODE = "node_o6vul7a"


def _run_flow(flow: dict):
    calc_nodes = [n for n in flow["nodes"] if n.get("data", {}).get("functionName")]
    valid = {n["id"] for n in calc_nodes}
    calc_edges = [
        e for e in flow["edges"] if e["source"] in valid and e["target"] in valid
    ]
    updated, errors = graph_logic.bulk_calculate_logic(
        copy.deepcopy(calc_nodes), calc_edges
    )
    return {n["id"]: n for n in updated}, errors


def test_generated_flow_rebuilds_tx_byte_for_byte():
    dataset = json.loads(FIXTURE.read_text())
    flow = generate_flow(dataset)

    node_map, errors = _run_flow(flow)
    assert errors == []

    final_hex = node_map[FINAL_TX_NODE]["data"]["result"]
    assert final_hex == dataset["tx_hex"]  # byte-perfect reconstruction
    assert node_map[VERIFY_NODE]["data"]["result"] == "true"


def test_generated_flow_ships_with_results_precomputed():
    """The returned flow must already carry the rebuilt tx as a cached result,
    so the canvas shows the real transaction on load (not the template's)."""
    dataset = json.loads(FIXTURE.read_text())
    flow = generate_flow(dataset)
    by_id = {n["id"]: n for n in flow["nodes"]}
    assert by_id[FINAL_TX_NODE]["data"]["result"] == dataset["tx_hex"]
    assert by_id[VERIFY_NODE]["data"]["result"] == "true"


def test_signature_is_recreated_not_pasted():
    """The signer node must compute the DER signature from the private key."""
    dataset = json.loads(FIXTURE.read_text())
    flow = generate_flow(dataset)
    node_map, _ = _run_flow(flow)
    # node_b1GSXfdE is the low-R signer; its result is the DER signature that
    # appears (with the sighash byte) inside the final tx's scriptSig.
    der_sig = node_map["node_b1GSXfdE"]["data"]["result"]
    assert der_sig and der_sig in dataset["tx_hex"]


def test_flow_name_references_txid():
    dataset = json.loads(FIXTURE.read_text())
    flow = generate_flow(dataset)
    assert dataset["txid"][:12] in flow["name"]


def test_single_status_card_replaces_lesson_text():
    """The lesson's step cards are gone; exactly one status card remains, naming
    the rebuilt tx and reporting what was auto-filled."""
    dataset = json.loads(FIXTURE.read_text())
    flow = generate_flow(dataset)
    cards = [n for n in flow["nodes"] if n.get("type") == "shadcnTextInfo"]
    assert len(cards) == 1
    content = cards[0]["data"]["content"]
    assert dataset["txid"] in content
    assert "Funding transaction" in content
    assert "private key" in content


def test_rejects_multi_output():
    dataset = json.loads(FIXTURE.read_text())
    dataset["vout"] = dataset["vout"] * 2
    with pytest.raises(UnsupportedTransaction, match="1-input / 1-output"):
        generate_flow(dataset)


def test_rejects_missing_privkey():
    dataset = json.loads(FIXTURE.read_text())
    dataset["vin"][0]["privkey_hex"] = None
    with pytest.raises(UnsupportedTransaction, match="private key"):
        generate_flow(dataset)


def test_rejects_non_p2pkh_output():
    dataset = json.loads(FIXTURE.read_text())
    dataset["vout"][0]["scriptpubkey"] = "0014" + "00" * 20  # P2WPKH
    with pytest.raises(UnsupportedTransaction, match="P2PKH"):
        generate_flow(dataset)
