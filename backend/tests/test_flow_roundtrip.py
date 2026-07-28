"""Regression checks for saved flow JSONs.

We temporarily tweak specific nodes, assert the TXID + script trace change,
then restore the original values and expect the graph to return to baseline.

"""

import copy
from pathlib import Path

import pytest

pytest.importorskip("bitcointx")
pytest.importorskip("secp256k1")
pytest.importorskip("ecdsa")

from flow_test_utils import load_flow as _load_flow, run_flow

ROOT = Path(__file__).resolve().parents[2]
FLOW_SCENARIOS = [
    {
        "name": "hash_roundtrip.json",
        "path": ROOT
        / "backend"
        / "tests"
        / "my_tx_flows"
        / "hash_roundtrip.json",
        "node_changes": {
            "node_input": "deadbeef",
        },
        "txid_node": "node_hash",
        "script_node": "node_hash",
        "expected_results": {
            "txid": "9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50",
            "script": "9595c9df90075148eb06860365df33584b75bff782a510c6cd4883a419833d50",
        },
    },
    {
        "name": "p0_Intro_P2PKH.json",
        "path": ROOT / "src" / "my_tx_flows" / "p0_Intro_P2PKH.json",
        "node_changes": {
            "node_IRajBmor": "391001",
        },
        "txid_node": "node_24bD1CIj",
        "script_node": "node_o6vul7a",
        "expected_results": {
            "txid": "45ccc6b28d89eb93dd50544a145abcc30b17d9303eed3be180263ca5e98e2f54",
            "script": "true",
        },
    },
    {
        "name": "p1_P2PK_vs_P2PKH.json",
        "path": ROOT / "src" / "my_tx_flows" / "p1_P2PK_vs_P2PKH.json",
        "node_changes": {
            "node_Ty4ApQbe": "783001",
        },
        "txid_node": "node_1oB0mQPo",
        "script_node": "node_NwoZ2skX",
        "expected_results": {
            "txid": "64f2dc3219fbdd2aa7277509f59b4b2ff0119092ae88effadbe4041502c7acaf",
            "script": "true",
        },
    },
    {
        "name": "p2_P2PKH_multi_input_signing.json",
        "path": ROOT / "src" / "my_tx_flows" / "p2_P2PKH_multi_input_signing.json",
        "node_changes": {
            "node_IRajBmor": "15001",
        },
        "txid_node": "node_24bD1CIj",
        "script_node": "node_4fCFUxcV",
        "expected_results": {
            "txid": "c4df0750c3a627bb98a203c9a19ec32eb52edf21b3ad1929daaca320c57c4beb",
            "script": "true",
        },
    },
    {
        "name": "p3_Bare_MultiSig.json",
        "path": ROOT / "src" / "my_tx_flows" / "p3_Bare_MultiSig.json",
        # tx1's Output Amount ripples through tx1's txid into tx2's input,
        # changing tx2's txid (node_1oB0mQPo) — the bare-multisig spend.
        "node_changes": {
            "node_Ty4ApQbe": "240001",
        },
        "txid_node": "node_1oB0mQPo",
        "script_node": "node_NwoZ2skX",
        "expected_results": {
            "txid": "a2f6c0e52190aa8f57b3ae6e7835bd3ecf4699cad2bb98cecc6301460ebcbd2d",
            "script": "true",
        },
    },
]


def _run(nodes, edges):
    node_map, errors = run_flow(nodes, edges)
    assert errors == []
    return node_map


def _script_output_snapshot(node_map):
    outputs = {}
    for node_id, node in node_map.items():
        data = node.get("data") or {}
        if data.get("functionName") != "script_verification":
            continue
        outputs[node_id] = {
            "result": data.get("result"),
            "steps": copy.deepcopy(data.get("scriptDebugSteps")),
        }
    return outputs


def _set_node_value(nodes, node_id, value):
    for node in nodes:
        if node["id"] == node_id:
            node_data = node.setdefault("data", {})
            node_data["value"] = value
            node_data.setdefault("inputs", {})["val"] = value
            node_data["dirty"] = True
            return
    pytest.fail(f"Node {node_id} not found in flow")


@pytest.mark.parametrize("scenario", FLOW_SCENARIOS, ids=lambda s: s["name"])
def test_flow_roundtrip_restores_txid_and_script_steps(scenario):
    nodes, edges = _load_flow(scenario["path"])

    baseline_map = _run(nodes, edges)

    txid_node_id = scenario["txid_node"]
    script_node_id = scenario["script_node"]

    original_txid = baseline_map[txid_node_id]["data"]["result"]
    original_script_data = baseline_map[script_node_id]["data"]
    original_script_result = original_script_data["result"]
    original_script_steps = copy.deepcopy(original_script_data.get("scriptDebugSteps"))
    original_script_outputs = _script_output_snapshot(baseline_map)

    expected = scenario.get("expected_results")
    if expected:
        if expected.get("txid") is not None:
            assert original_txid == expected["txid"]
        if expected.get("script") is not None:
            assert original_script_result == expected["script"]

    # Record original node values so we can restore them later
    original_inputs = {
        node_id: baseline_map[node_id]["data"]["result"]
        for node_id in scenario["node_changes"].keys()
    }

    scenario_nodes = copy.deepcopy(nodes)

    for node_id, new_value in scenario["node_changes"].items():
        _set_node_value(scenario_nodes, node_id, new_value)

    modified_map = _run(scenario_nodes, edges)
    modified_txid = modified_map[txid_node_id]["data"]["result"]
    modified_script_data = modified_map[script_node_id]["data"]
    modified_script_result = modified_script_data["result"]
    modified_script_steps = modified_script_data.get("scriptDebugSteps")

    assert modified_txid != original_txid
    assert (
        modified_script_result != original_script_result
        or modified_script_steps != original_script_steps
    )

    for node_id, original_value in original_inputs.items():
        _set_node_value(scenario_nodes, node_id, original_value)

    final_map = _run(scenario_nodes, edges)
    final_script_data = final_map[script_node_id]["data"]
    final_script_outputs = _script_output_snapshot(final_map)

    assert final_map[txid_node_id]["data"]["result"] == original_txid
    assert final_script_data["result"] == original_script_result
    assert final_script_data.get("scriptDebugSteps") == original_script_steps
    assert final_script_outputs == original_script_outputs
