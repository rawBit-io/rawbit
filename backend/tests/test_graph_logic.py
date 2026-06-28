import copy
import json

import pytest

pytest.importorskip("bitcointx")
pytest.importorskip("secp256k1")

from backend import graph_logic
from backend.calc_functions import calc_func as calc
from config import (
    CALCULATION_TIMEOUT_NODE_ID,
)

SAMPLE_TX_HEX = (
    "02000000010000000000000000000000000000000000000000000000000000000000000000000000000151"
    "ffffffff01e803000000000000015100000000"
)


def test_validate_inputs_required_and_numeric_rules():
    with pytest.raises(ValueError) as missing:
        graph_logic.validate_inputs("uint32_to_little_endian_4_bytes", {})
    assert "Missing required param 'val'" in str(missing.value)

    with pytest.raises(ValueError) as not_integer:
        graph_logic.validate_inputs("uint32_to_little_endian_4_bytes", {"val": "abc"})
    assert "must be an integer" in str(not_integer.value)

    assert graph_logic.validate_inputs("encode_varint", {"val": ""})
    assert graph_logic.validate_inputs("sighash_type_to_le4", {"val": "81"})

    with pytest.raises(ValueError) as not_number:
        graph_logic.validate_inputs("hours_to_sequence_number", {"val": "n/a"})
    assert "must be a number" in str(not_number.value)


def test_build_single_val_params_rejects_multiple_upstreams():
    node = {"id": "dst", "data": {"functionName": "identity"}}
    edges = [
        {"source": "a", "target": "dst"},
        {"source": "b", "target": "dst"},
    ]
    node_map = {"a": {"data": {"result": "va"}}, "b": {"data": {"result": "vb"}}}

    with pytest.raises(ValueError, match="Multiple inputs connected"):
        graph_logic.build_single_val_params(
            node,
            edges,
            node_map,
            lambda nid: node_map[nid]["data"]["result"],
        )


def test_build_single_val_params_requires_value_when_no_upstream():
    node = {"id": "dst", "data": {"functionName": "identity"}}

    with pytest.raises(ValueError, match="Missing required input 'val'"):
        graph_logic.build_single_val_params(node, [], {}, lambda nid: None)


def test_build_single_val_params_prefers_upstream_over_manual_value():
    node = {
        "id": "dst",
        "data": {"functionName": "identity", "value": "manual"},
    }
    node_map = {"src": {"data": {"result": "from-edge"}}}
    edges = [{"source": "src", "target": "dst"}]

    params = graph_logic.build_single_val_params(
        node,
        edges,
        node_map,
        lambda nid: node_map[nid]["data"].get("result"),
    )

    assert params == {"val": "from-edge"}


def test_to_sparse_handles_lists_dicts_and_scalars():
    assert graph_logic._to_sparse(["keep", "", "also"]) == {"0": "keep", "2": "also"}
    assert graph_logic._to_sparse({"1": "value"}) == {"1": "value"}
    assert graph_logic._to_sparse("ignored") == {}


def test_build_multi_val_params_precedence(monkeypatch):
    source_node = {"id": "src", "data": {"result": "from-edge"}}
    target_node = {
        "id": "dst",
        "data": {
            "functionName": "concat_all",
            "inputStructure": {"ungrouped": [{"index": 0}, {"index": 1}, {"index": 2}, {"index": 3}]},
            "inputs": {"vals": {
                "0": graph_logic.SENTINEL_FORCE00,
                "1": graph_logic.SENTINEL_EMPTY,
                "3": "manual",
            }},
        },
    }
    nodes = {"src": source_node, "dst": target_node}
    edges = [{"source": "src", "target": "dst", "targetHandle": "dst-2"}]

    params = graph_logic.build_multi_val_params(
        target_node,
        edges,
        nodes,
        lambda nid: nodes[nid]["data"].get("result"),
    )

    assert params["vals"] == ["00", "", "from-edge", "manual"]
    assert params["_sparseVals"] == {
        "0": graph_logic.SENTINEL_FORCE00,
        "1": graph_logic.SENTINEL_EMPTY,
        "2": "from-edge",
        "3": "manual",
    }


def test_bulk_calculate_logic_opcode_node_uses_backend_opcode_names():
    node = {
        "id": "op",
        "type": "opCodeNode",
        "data": {
            "functionName": "op_code_select",
            "paramExtraction": "multi_val",
            "inputStructure": {
                "ungrouped": [{"index": 0}, {"index": 100}],
            },
            "inputs": {"vals": {"0": "OP_DUP", "100": "OP_HASH160"}},
        },
    }

    updated_nodes, errors = graph_logic.bulk_calculate_logic([node], [])

    assert errors == []
    updated = list(updated_nodes)[0]
    assert updated["data"]["result"] == "76a9"
    assert updated["data"]["inputs"]["vals"] == {
        "0": "OP_DUP",
        "100": "OP_HASH160",
    }


def test_bulk_calculate_logic_migrates_legacy_opcode_names():
    node = {
        "id": "op",
        "type": "opCodeNode",
        "data": {
            "functionName": "op_code_select",
            "paramExtraction": "single_val",
            "value": "76a9",
            "opSequenceNames": ["OP_DUP", "OP_HASH160"],
        },
    }

    updated_nodes, errors = graph_logic.bulk_calculate_logic([node], [])

    assert errors == []
    updated = list(updated_nodes)[0]
    assert updated["data"]["result"] == "76a9"
    assert updated["data"]["inputs"]["vals"] == {
        "0": "OP_DUP",
        "100": "OP_HASH160",
    }


def test_build_multi_val_indexed_params_keeps_visible_indices():
    source_node = {"id": "src", "data": {"result": "from-edge"}}
    target_node = {
        "id": "dst",
        "data": {
            "functionName": "build_trezor_sign_transaction_params",
            "inputStructure": {
                "ungrouped": [{"index": 0}],
                "groups": [
                    {
                        "title": "INPUTS[]",
                        "baseIndex": 1000,
                        "fields": [{"index": 0}, {"index": 10}],
                    }
                ],
            },
            "groupInstanceKeys": {"INPUTS[]": [1000]},
            "inputs": {
                "vals": {
                    "0": "testnet",
                    "1010": "manual",
                }
            },
        },
    }
    nodes = {"src": source_node, "dst": target_node}
    edges = [{"source": "src", "target": "dst", "targetHandle": "dst-1000"}]

    params = graph_logic.build_multi_val_indexed_params(
        target_node,
        edges,
        nodes,
        lambda nid: nodes[nid]["data"].get("result"),
    )

    assert params["vals"] == {
        "0": "testnet",
        "1000": "from-edge",
        "1010": "manual",
    }
    assert params["_sparseVals"] == {
        "0": "testnet",
        "1000": "from-edge",
        "1010": "manual",
    }


def test_bulk_calculate_logic_musig2_nonce_gen_message_null_sentinel():
    rand = "0f" * 32
    signer_pubkey = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"

    node_template = {
        "id": "nonce",
        "type": "calculation",
        "data": {
            "functionName": "musig2_nonce_gen",
            "paramExtraction": "multi_val",
            "inputStructure": {
                "ungrouped": [
                    {"index": 0},
                    {"index": 1},
                    {"index": 2},
                    {"index": 3},
                    {"index": 4},
                ]
            },
            "inputs": {"vals": {}},
            "groupInstances": {},
        },
    }

    node_null = copy.deepcopy(node_template)
    node_null["data"]["inputs"]["vals"] = {
        "2": graph_logic.SENTINEL_NULL,
        "3": rand,
        "4": signer_pubkey,
    }
    nodes_null, errors_null = graph_logic.bulk_calculate_logic([node_null], [])
    assert errors_null == []
    data_null = list(nodes_null)[0]["data"]

    assert data_null["result"] == (
        "02c96e7cb1e8aa5dac64d872947914198f607d90ecde5200de52978ad5ded63c00"
        "0299ec5117c2d29edee8a2092587c3909be694d5cff0667d6c02ea4059f7cd9786"
    )
    assert data_null["outputValues"]["output-1"] == (
        "89bdd787d0284e5e4d5fc572e49e316bab7e21e3b1830de37dfe80156fa41a6d"
        "0b17ae8d024c53679699a6fd7944d9c4a366b514baf43088e0708b1023dd2897"
        "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
    )
    assert data_null["inputs"]["vals"]["2"] == graph_logic.SENTINEL_NULL

    node_empty = copy.deepcopy(node_template)
    node_empty["data"]["inputs"]["vals"] = {
        "2": "",
        "3": rand,
        "4": signer_pubkey,
    }
    nodes_empty, errors_empty = graph_logic.bulk_calculate_logic([node_empty], [])
    assert errors_empty == []
    data_empty = list(nodes_empty)[0]["data"]

    assert data_empty["result"] == (
        "0316711283776c75b2c43e2badd8dcdc3b97ac549db870a614c2776554acbee830"
        "0393836bea014fdef432ebd4fa94a8e74fbbe52a081dceb9491aebca86f6fe76ad"
    )
    assert data_empty["result"] != data_null["result"]


@pytest.mark.parametrize(
    "leaf_index, expected_path",
    [
        (
            0,
            "a7ff651bdc752b612bd6266420bf5a4ff1b87fec33a396ba0d5037c336332aba"
            "c9e9e0619c989bbd70d5153879acc2a692d8d7f8b4c5919c6089491fbcf77405",
        ),
        (
            1,
            "62dd3a7a192e65aa45d23c1516e54de59191037294c6b20d993a63daae764c60"
            "c9e9e0619c989bbd70d5153879acc2a692d8d7f8b4c5919c6089491fbcf77405",
        ),
    ],
)
def test_taproot_tree_builder_output_values_selected_leaf(leaf_index, expected_path):
    leaf_a = "62dd3a7a192e65aa45d23c1516e54de59191037294c6b20d993a63daae764c60"
    leaf_b = "a7ff651bdc752b612bd6266420bf5a4ff1b87fec33a396ba0d5037c336332aba"
    leaf_c = "c9e9e0619c989bbd70d5153879acc2a692d8d7f8b4c5919c6089491fbcf77405"

    node = {
        "id": "tree",
        "type": "calculation",
        "data": {
            "functionName": "taproot_tree_builder",
            "taprootLeafIndex": leaf_index,
            "inputs": {
                "vals": {
                    "0": leaf_a,
                    "1": leaf_b,
                    "2": leaf_c,
                }
            },
            "inputStructure": {
                "ungrouped": [
                    {"index": 0},
                    {"index": 1},
                    {"index": 2},
                ]
            },
        },
    }

    nodes, errors = graph_logic.bulk_calculate_logic([node], [])
    assert errors == []
    data = list(nodes)[0]["data"]
    assert data["outputValues"]["output-1"] == expected_path


def test_taproot_tree_builder_output_values_leaf_c_path():
    leaf_a = "62dd3a7a192e65aa45d23c1516e54de59191037294c6b20d993a63daae764c60"
    leaf_b = "a7ff651bdc752b612bd6266420bf5a4ff1b87fec33a396ba0d5037c336332aba"
    leaf_c = "c9e9e0619c989bbd70d5153879acc2a692d8d7f8b4c5919c6089491fbcf77405"

    left = bytes.fromhex(leaf_a)
    right = bytes.fromhex(leaf_b)
    left, right = sorted([left, right])
    expected_path = calc.tagged_hash(["TapBranch", (left + right).hex()])

    node = {
        "id": "tree",
        "type": "calculation",
        "data": {
            "functionName": "taproot_tree_builder",
            "taprootLeafIndex": 2,
            "inputs": {
                "vals": {
                    "0": leaf_a,
                    "1": leaf_b,
                    "2": leaf_c,
                }
            },
            "inputStructure": {
                "ungrouped": [
                    {"index": 0},
                    {"index": 1},
                    {"index": 2},
                ]
            },
        },
    }

    nodes, errors = graph_logic.bulk_calculate_logic([node], [])
    assert errors == []
    data = list(nodes)[0]["data"]
    assert data["outputValues"]["output-1"] == expected_path


def test_enforce_deadline_skips_signal_when_not_main(monkeypatch):
    monkeypatch.setattr(graph_logic, "_can_use_sigalrm", lambda: False)

    called = {"signalled": False}

    def boom(*args, **kwargs):
        called["signalled"] = True
        raise AssertionError("signal.signal should not be called")

    monkeypatch.setattr(graph_logic.signal, "signal", boom)

    with graph_logic._enforce_deadline(0.1):
        pass

    assert not called["signalled"], "signal.signal must be skipped off main thread"


def test_enforce_deadline_arms_and_restores_signal(monkeypatch):
    monkeypatch.setattr(graph_logic, "_can_use_sigalrm", lambda: True)

    events = {"set": [], "timer": []}

    def fake_getsignal(sig):
        assert sig == graph_logic.signal.SIGALRM
        return "previous"

    def fake_signal(sig, handler):
        events["set"].append((sig, handler))

    def fake_setitimer(which, value):
        events["timer"].append((which, value))

    monkeypatch.setattr(graph_logic.signal, "getsignal", fake_getsignal)
    monkeypatch.setattr(graph_logic.signal, "signal", fake_signal)
    monkeypatch.setattr(graph_logic.signal, "setitimer", fake_setitimer)

    with graph_logic._enforce_deadline(0.5):
        pass

    assert events["timer"][0] == (graph_logic.signal.ITIMER_REAL, 0.5)
    # Final call clears the timer
    assert events["timer"][-1] == (graph_logic.signal.ITIMER_REAL, 0.0)
    # Handler restored to previous value
    assert events["set"][-1] == (graph_logic.signal.SIGALRM, "previous")


def test_sanitize_edges_marks_unknown_target(monkeypatch):
    node_map = {"src": {"id": "src", "data": {}}}
    edges = [{"source": "src", "target": "missing"}]

    valid, errors = graph_logic._sanitize_edges(node_map, edges)

    assert valid == []
    assert errors == [
        {"nodeId": "src", "error": "Edge references unknown target 'missing'"}
    ]
    data = node_map["src"]["data"]
    assert data["_preflightErrors"] == ["Edge references unknown target 'missing'"]
    assert "_invalidEdge" not in data


def test_sanitize_edges_blocks_unknown_source():
    node_map = {"dst": {"id": "dst", "data": {}}}
    edges = [{"source": "ghost", "target": "dst"}]

    valid, errors = graph_logic._sanitize_edges(node_map, edges)

    assert valid == []
    assert errors == [
        {"nodeId": "dst", "error": "Edge references unknown source 'ghost'"}
    ]
    data = node_map["dst"]["data"]
    assert data["_preflightErrors"] == ["Edge references unknown source 'ghost'"]
    assert data.get("_invalidEdge") is True


def test_build_multi_val_with_network_params_invalid_json_falls_back():
    node = {
        "id": "multi",
        "data": {
            "functionName": "wallet_rpc_general",
            "inputStructure": {"ungrouped": [{"index": 0}]},
            "inputs": {"vals": {"0": "edge"}},
            "value": "{\"invalid",  # broken JSON string
            "selectedNetwork": "regtest",
        },
    }
    node_map = {"src": {"data": {"result": "edge"}}}
    edges = [{"source": "src", "target": "multi", "targetHandle": "multi-0"}]

    params = graph_logic.build_multi_val_with_network_params(
        node,
        edges,
        node_map,
        lambda nid: node_map[nid]["data"].get("result"),
    )

    assert params["val"] == {"addresses": ["edge"]}
    assert params["vals"] == ["edge"]
    assert params["selectedNetwork"] == "regtest"


def test_build_multi_val_with_network_params_non_dict_falls_back():
    node = {
        "id": "multi",
        "data": {
            "functionName": "wallet_rpc_general",
            "inputStructure": {"ungrouped": [{"index": 0}, {"index": 1}]},
            "inputs": {"vals": {"0": "manual"}},
            "value": json.dumps("just a string"),
            "selectedNetwork": "mainnet",
        },
    }
    node_map = {"src": {"data": {"result": "edge"}}}
    edges = [{"source": "src", "target": "multi", "targetHandle": "multi-1"}]

    params = graph_logic.build_multi_val_with_network_params(
        node,
        edges,
        node_map,
        lambda nid: node_map[nid]["data"].get("result"),
    )

    assert params["val"] == {"addresses": ["manual", "edge"]}
    assert params["_sparseVals"] == {"0": "manual", "1": "edge"}
    assert params["selectedNetwork"] == "mainnet"

def test_build_multi_val_params_invalid_handle(monkeypatch):
    target_node = {
        "id": "dst",
        "data": {
            "functionName": "concat_all",
            "inputStructure": {"ungrouped": [{"index": 0}]},
            "inputs": {"vals": {}},
        },
    }
    edges = [{"source": "src", "target": "dst", "targetHandle": "no-index"}]

    with pytest.raises(ValueError) as exc:
        graph_logic.build_multi_val_params(
            target_node,
            edges,
            {},
            lambda nid: None,
        )
    assert "Malformed targetHandle" in str(exc.value)


def test_build_multi_val_params_duplicate_cables_raise():
    target_node = {
        "id": "dst",
        "data": {
            "functionName": "concat_all",
            "inputStructure": {"ungrouped": [{"index": 0}]},
            "inputs": {"vals": {}},
        },
    }
    edges = [
        {"source": "a", "target": "dst", "targetHandle": "dst-0"},
        {"source": "b", "target": "dst", "targetHandle": "dst-0"},
    ]

    with pytest.raises(ValueError, match="Multiple cables connected"):
        graph_logic.build_multi_val_params(
            target_node,
            edges,
            {"a": {"data": {"result": ""}}, "b": {"data": {"result": ""}}},
            lambda nid: "",
        )


def test_visible_field_indices_with_groups_and_between():
    node = {
        "id": "grp",
        "data": {
            "functionName": "concat_all",
            "inputStructure": {
                "ungrouped": [{"index": 5}],
                "groups": [
                    {"title": "ROWS[]", "fields": [{"index": 0}, {"index": 1}]}
                ],
                "betweenGroups": {"ROWS[]": [{"index": 900}]},
                "afterGroups": [{"index": 1000}],
            },
            "groupInstanceKeys": {"ROWS[]": [10, 20]},
            "inputs": {"vals": {"5": "front", "1000": "tail"}},
        },
    }

    edges = [
        {"source": "a", "target": "grp", "targetHandle": "grp-10"},
        {"source": "b", "target": "grp", "targetHandle": "grp-11"},
        {"source": "c", "target": "grp", "targetHandle": "grp-20"},
        {"source": "d", "target": "grp", "targetHandle": "grp-21"},
        {"source": "e", "target": "grp", "targetHandle": "grp-900"},
    ]
    node_map = {
        "a": {"data": {"result": "g1a"}},
        "b": {"data": {"result": "g1b"}},
        "c": {"data": {"result": "g2a"}},
        "d": {"data": {"result": "g2b"}},
        "e": {"data": {"result": "bridge"}},
    }

    indices = graph_logic._visible_field_indices(node)
    assert indices == [5, 10, 11, 20, 21, 900, 1000]

    params = graph_logic.build_multi_val_params(
        node,
        edges,
        node_map,
        lambda nid: node_map[nid]["data"].get("result"),
    )

    assert params["vals"] == [
        "front",
        "g1a",
        "g1b",
        "g2a",
        "g2b",
        "bridge",
        "tail",
    ]


def test_bulk_calculate_logic_happy_path():
    nodes = [
        {
            "id": "src",
            "data": {
                "functionName": "identity",
                "value": "abc",
                "dirty": True,
            },
        },
        {
            "id": "dst",
            "data": {
                "functionName": "concat_all",
                "dirty": True,
                "inputStructure": {"ungrouped": [{"index": 0}, {"index": 1}]},
                "inputs": {"vals": {"1": "manual"}},
            },
        },
    ]
    edges = [{"source": "src", "target": "dst", "targetHandle": "dst-0"}]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), edges)
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == []
    assert updated["src"]["data"]["result"] == "abc"
    assert updated["src"]["data"].get("dirty") is False
    assert updated["dst"]["data"]["result"] == "abcmanual"
    assert updated["dst"]["data"]["inputs"] == {"vals": {"0": "abc", "1": "manual"}}
    assert updated["dst"]["data"].get("dirty") is False


def test_bulk_calculate_logic_skips_trezor_action_nodes_but_uses_their_result():
    nodes = [
        {
            "id": "trezor",
            "type": "trezorAction",
            "data": {
                "functionName": "trezor_get_address",
                "result": "tb1qdummyaddress",
                "dirty": False,
            },
        },
        {
            "id": "cmp",
            "type": "calculation",
            "data": {
                "functionName": "compare_equal",
                "dirty": True,
                "inputStructure": {"ungrouped": [{"index": 0}, {"index": 1}]},
                "inputs": {"vals": {"1": "tb1qdummyaddress"}},
            },
        },
    ]
    edges = [
        {
            "source": "trezor",
            "target": "cmp",
            "sourceHandle": "",
            "targetHandle": "input-0",
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), edges)
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == []
    assert updated["trezor"]["data"]["result"] == "tb1qdummyaddress"
    assert updated["trezor"]["data"].get("dirty") is False
    assert updated["cmp"]["data"]["result"] == "true"
    assert updated["cmp"]["data"]["inputs"] == {
        "vals": {"0": "tb1qdummyaddress", "1": "tb1qdummyaddress"}
    }


def test_bulk_calculate_logic_preserves_trezor_action_error_state():
    nodes = [
        {
            "id": "trezor",
            "type": "trezorAction",
            "data": {
                "functionName": "trezor_sign_transaction",
                "result": "",
                "dirty": True,
                "error": True,
                "extendedError": "Trezor rejected signing",
                "hardwareStatus": "error",
                "hardwareStatusText": "Trezor rejected signing",
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == []
    assert updated["trezor"]["data"]["dirty"] is False
    assert updated["trezor"]["data"]["error"] is True
    assert updated["trezor"]["data"]["extendedError"] == "Trezor rejected signing"
    assert updated["trezor"]["data"]["hardwareStatus"] == "error"


def test_bulk_calculate_logic_clears_stale_trezor_params_result_on_error():
    nodes = [
        {
            "id": "params",
            "type": "calculation",
            "data": {
                "functionName": "build_trezor_sign_transaction_params",
                "dirty": True,
                "result": '{"coin":"testnet","inputs":[{"stale":true}],"outputs":[]}',
                "inputStructure": {
                    "ungrouped": [{"index": 0}, {"index": 1}, {"index": 2}],
                    "groups": [
                        {
                            "title": "INPUTS[]",
                            "baseIndex": 1000,
                            "fields": [
                                {"index": 0},
                                {"index": 10},
                                {"index": 20},
                                {"index": 30},
                                {"index": 40},
                                {"index": 50},
                            ],
                        },
                        {
                            "title": "OUTPUTS[]",
                            "baseIndex": 3000,
                            "fields": [{"index": 0}, {"index": 10}, {"index": 20}],
                        },
                    ],
                },
                "groupInstanceKeys": {
                    "INPUTS[]": [1000],
                    "OUTPUTS[]": [3000],
                },
                "inputs": {
                    "vals": {
                        "0": "testnet",
                        "1": "2",
                        "2": "0",
                        "1000": "",
                        "1010": "00" * 32,
                        "1020": "0",
                        "1030": "1",
                        "1040": "ffffffff",
                        "1050": "AUTO",
                        "3000": "mtAoaTyXBeksZbMtwk6yG5M1xCYUDpNNU9",
                        "3010": "1",
                        "3020": "AUTO",
                    }
                },
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    updated = {node["id"]: node for node in updated_nodes}

    assert errors
    assert updated["params"]["data"]["result"] == ""
    assert updated["params"]["data"]["error"] is True
    assert "input[0] derivation path is required" in updated["params"]["data"]["extendedError"]


def test_bulk_calculate_logic_handles_unknown_source_edges():
    nodes = [
        {
            "id": "dst",
            "data": {
                "functionName": "identity",
                "dirty": True,
            },
        }
    ]
    edges = [
        {"source": "ghost", "target": "dst", "targetHandle": "dst-0"},
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), edges)
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == [
        {"nodeId": "dst", "error": "Edge references unknown source 'ghost'"},
    ]

    dst_data = updated["dst"]["data"]
    assert dst_data["error"] is True
    assert "Edge references unknown source 'ghost'" in dst_data["extendedError"]
    assert dst_data.get("dirty") is False


def test_bulk_calculate_logic_times_out(monkeypatch):
    nodes = [
        {
            "id": "slow",
            "data": {
                "functionName": "identity",
                "value": "payload",
                "dirty": True,
            },
        }
    ]

    monkeypatch.setattr(graph_logic, "CALCULATION_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(graph_logic, "_HAS_SIGALRM", False)

    call_counter = {"count": 0}

    def fake_perf_counter():
        call_counter["count"] += 1
        if call_counter["count"] <= 3:
            return 0.0
        return 0.02

    monkeypatch.setattr(graph_logic.time, "perf_counter", fake_perf_counter)

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    updated = {node["id"]: node for node in updated_nodes}

    timeout_errors = [err for err in errors if err["nodeId"] == CALCULATION_TIMEOUT_NODE_ID]
    assert timeout_errors, "expected a timeout sentinel error"
    assert any(err["nodeId"] == "slow" for err in errors)

    slow_data = updated["slow"]["data"]
    assert slow_data["error"] is True
    assert slow_data["dirty"] is False
    assert slow_data["extendedError"].startswith("Flow evaluation exceeded")


def test_bulk_calculate_logic_timeout_cleans_sentinels(monkeypatch):
    nodes = [
        {
            # Executes first and trips the deadline while "dst" still carries
            # its preflight sentinels.
            "id": "slow",
            "data": {"functionName": "identity", "value": "payload", "dirty": True},
        },
        {
            "id": "dst",
            "data": {"functionName": "identity", "dirty": True},
        },
    ]
    edges = [{"source": "ghost", "target": "dst", "targetHandle": "dst-0"}]

    monkeypatch.setattr(graph_logic, "CALCULATION_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(graph_logic, "_HAS_SIGALRM", False)

    call_counter = {"count": 0}

    def fake_perf_counter():
        call_counter["count"] += 1
        if call_counter["count"] <= 3:
            return 0.0
        return 0.02

    monkeypatch.setattr(graph_logic.time, "perf_counter", fake_perf_counter)

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), edges)
    updated = {node["id"]: node for node in updated_nodes}

    assert any(err["nodeId"] == CALCULATION_TIMEOUT_NODE_ID for err in errors)
    dst_data = updated["dst"]["data"]
    assert "_preflightErrors" not in dst_data
    assert "_invalidEdge" not in dst_data
    assert "_cycle" not in dst_data


def test_bulk_calculate_logic_handles_malformed_nodes():
    nodes = [
        "garbage",
        {"data": {"functionName": "identity", "value": "2"}},
        {"id": "bad-data", "data": "nope"},
        {"id": "ok", "data": {"functionName": "identity", "value": "1", "dirty": True}},
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(nodes, [])
    updated = {node["id"]: node for node in updated_nodes}

    assert updated["ok"]["data"]["result"] == "1"
    rejected = [err for err in errors if err["nodeId"] is None]
    assert len(rejected) == 2
    assert all("string 'id'" in err["error"] for err in rejected)
    assert any(
        err["nodeId"] == "bad-data" and "must be an object" in err["error"]
        for err in errors
    )


def test_bulk_calculate_logic_missing_function_sets_error():
    nodes = [{"id": "bad", "data": {"functionName": "does_not_exist", "dirty": True}}]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == [{"nodeId": "bad", "error": "No function does_not_exist"}]
    assert updated["bad"]["data"]["error"] is True
    assert "No such function" in updated["bad"]["data"]["extendedError"]
    assert updated["bad"]["data"].get("dirty") is False


def test_bulk_calculate_logic_dynamic_tx_field_extract_outputs():
    nodes = [
        {
            "id": "extract",
            "type": "calculation",
            "data": {
                "functionName": "extract_tx_field",
                "paramExtraction": "multi_val",
                "txFieldExtractMode": "dynamic",
                "txExtractFields": ["txid", "vout.scriptPubKey", "vout.value"],
                "inputStructure": {
                    "ungrouped": [
                        {"index": 0, "label": "Raw TX (hex):"},
                        {"index": 1, "label": "VIN/VOUT Index:"},
                    ]
                },
                "inputs": {"vals": {"0": SAMPLE_TX_HEX, "1": "0"}},
                "dirty": True,
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    data = list(updated_nodes)[0]["data"]

    assert errors == []
    assert data["dirty"] is False
    assert data["outputValues"] == {
        "output-0": calc.extract_tx_field([SAMPLE_TX_HEX, "txid", "0"]),
        "output-1": "51",
        "output-2": "1000",
    }
    assert data["outputPorts"] == [
        {"label": "txid", "handleId": "output-0", "showLabel": False},
        {
            "label": "vout.scriptPubKey",
            "handleId": "output-1",
            "showLabel": False,
        },
        {"label": "vout.value", "handleId": "output-2", "showLabel": False},
    ]
    assert "vout.scriptPubKey: 51" in data["result"]


def test_bulk_calculate_logic_picture_p2sh_dynamic_outputs():
    pubkey = "02" + "11" * 32
    picture_hex = "ab" * 481
    nodes = [
        {
            "id": "picture",
            "type": "calculation",
            "data": {
                "functionName": "bip110_picture_p2sh_scripts",
                "paramExtraction": "multi_val",
                "inputStructure": {
                    "ungrouped": [
                        {"index": 0, "label": "Picture hex:"},
                        {"index": 1, "label": "Compressed pubkey:"},
                    ]
                },
                "inputs": {"vals": {"0": picture_hex, "1": pubkey}},
                "dirty": True,
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    data = list(updated_nodes)[0]["data"]

    assert errors == []
    assert data["dirty"] is False
    assert data["outputPorts"] == [
        {"label": "script 1", "handleId": "output-0", "showLabel": False},
        {"label": "script 2", "handleId": "output-1", "showLabel": False},
    ]
    assert set(data["outputValues"]) == {"output-0", "output-1"}
    assert len(bytes.fromhex(data["outputValues"]["output-0"])) == 520
    assert data["outputValues"]["output-1"] == "01ab006d21" + pubkey + "ac"
    assert "2 P2SH redeemScripts" in data["result"]
    assert "481 picture bytes" in data["result"]
    assert (
        "<240B data> <240B data> OP_2DROP <pubkey> OP_CHECKSIG"
        in data["result"]
    )


def _dynamic_extract_node(fields, vals):
    return {
        "id": "extract",
        "type": "calculation",
        "data": {
            "functionName": "extract_tx_field",
            "paramExtraction": "multi_val",
            "txFieldExtractMode": "dynamic",
            "txExtractFields": list(fields),
            "inputStructure": {
                "ungrouped": [
                    {"index": 0, "label": "Raw TX (hex):"},
                    {"index": 1, "label": "VIN/VOUT Index:"},
                ]
            },
            "inputs": {"vals": dict(vals)},
            "dirty": True,
        },
    }


def test_dynamic_tx_field_extract_failing_field_keeps_sibling_outputs():
    # NB-15: an op_return.data field whose indexed vout is not OP_RETURN must not
    # wipe the sibling fields — it gets an empty value and an inline error line.
    node = _dynamic_extract_node(
        ["txid", "op_return.data"], {"0": SAMPLE_TX_HEX, "1": "0"}
    )

    updated_nodes, errors = graph_logic.bulk_calculate_logic([node], [])
    data = list(updated_nodes)[0]["data"]

    assert errors == []
    assert data["dirty"] is False
    assert data["outputValues"]["output-0"] == calc.extract_tx_field(
        [SAMPLE_TX_HEX, "txid", "0"]
    )
    assert data["outputValues"]["output-1"] == ""
    assert "txid:" in data["result"]
    assert "op_return.data: <error:" in data["result"]


def test_dynamic_tx_field_extract_clears_stale_outputs_on_bad_input():
    # NB-12: after a successful run populates outputValues, re-running the same
    # node with invalid input must not leave the previous value behind for a
    # downstream consumer to read as current.
    first_nodes, _ = graph_logic.bulk_calculate_logic(
        [_dynamic_extract_node(["txid"], {"0": SAMPLE_TX_HEX, "1": "0"})], []
    )
    populated = list(first_nodes)[0]
    good_txid = populated["data"]["outputValues"]["output-0"]
    assert good_txid

    # Same node data, now fed an undeserializable tx hex, marked dirty again.
    populated["data"]["inputs"]["vals"]["0"] = "00"
    populated["data"]["dirty"] = True
    second_nodes, _ = graph_logic.bulk_calculate_logic([populated], [])
    data2 = list(second_nodes)[0]["data"]

    assert data2["outputValues"]["output-0"] != good_txid
    assert data2["outputValues"]["output-0"] == ""


def test_build_val_with_network_params_includes_selected_network():
    node = {
        "id": "addr",
        "data": {
            "functionName": "hash160_to_p2pkh_address",
            "value": "deadbeef",
            "selectedNetwork": "testnet",
        },
    }

    params = graph_logic.build_val_with_network_params(node, [], {}, lambda _nid: None)

    assert params == {"val": "deadbeef", "selectedNetwork": "testnet"}


def test_build_multi_val_with_network_params_merges_inputs_and_addresses():
    node = {
        "id": "dst",
        "data": {
            "functionName": "wallet_rpc_general",
            "inputStructure": {"ungrouped": [{"index": 0}, {"index": 1}]},
            "inputs": {"vals": {"0": "manual"}},
            "value": json.dumps({"note": "keep"}),
            "selectedNetwork": "mainnet",
        },
    }
    edges = [{"source": "src", "target": "dst", "targetHandle": "dst-1"}]
    node_map = {
        "src": {"id": "src", "data": {"result": "edge"}},
    }

    params = graph_logic.build_multi_val_with_network_params(
        node,
        edges,
        node_map,
        lambda nid: node_map[nid]["data"].get("result"),
    )

    assert params["vals"] == ["manual", "edge"]
    assert params["selectedNetwork"] == "mainnet"
    assert params["val"]["note"] == "keep"
    assert params["val"]["addresses"] == ["manual", "edge"]
    assert params["_sparseVals"] == {"0": "manual", "1": "edge"}


def test_bulk_calculate_logic_marks_cycles():
    nodes = [
        {
            "id": "a",
            "data": {"functionName": "identity", "value": "1", "dirty": True},
        },
        {
            "id": "b",
            "data": {"functionName": "identity", "value": "2", "dirty": True},
        },
    ]
    edges = [
        {"source": "a", "target": "b", "targetHandle": "b-0"},
        {"source": "b", "target": "a", "targetHandle": "a-0"},
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), edges)
    updated = {node["id"]: node for node in updated_nodes}

    assert sorted(err["nodeId"] for err in errors) == ["a", "b"]
    assert all(err["error"] == "Cycle detected in graph" for err in errors)
    for nid in ("a", "b"):
        data = updated[nid]["data"]
        assert "_cycle" not in data  # sentinel must not leak to clients
        assert data["error"] is True
        assert data["extendedError"] == "Cycle detected in graph"
        assert data["dirty"] is False


def test_bulk_calculate_logic_recovers_after_cycle_removed():
    nodes = [
        {
            "id": "a",
            "data": {"functionName": "identity", "value": "1", "dirty": True},
        },
        {
            "id": "b",
            "data": {"functionName": "identity", "value": "2", "dirty": True},
        },
    ]
    cyclic_edges = [
        {"source": "a", "target": "b", "targetHandle": "b-0"},
        {"source": "b", "target": "a", "targetHandle": "a-0"},
    ]

    first_nodes, _ = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), cyclic_edges)
    resent = copy.deepcopy(list(first_nodes))
    # Simulate a stale client-side sentinel surviving the round trip.
    for node in resent:
        node["data"]["_cycle"] = True

    second_nodes, errors = graph_logic.bulk_calculate_logic(
        resent, [{"source": "a", "target": "b", "targetHandle": "b-0"}]
    )
    updated = {node["id"]: node for node in second_nodes}

    assert errors == []
    for nid in ("a", "b"):
        data = updated[nid]["data"]
        assert "_cycle" not in data
        assert "error" not in data
    assert updated["a"]["data"]["result"] == "1"


def test_bulk_calculate_logic_rejects_unwired_outputs():
    nodes = [
        {
            "id": "src",
            "data": {
                "functionName": "encode_varint",
                "value": "1",
                "dirty": True,
            },
        },
        {
            "id": "dst",
            "data": {
                "functionName": "identity",
                "dirty": True,
            },
        },
    ]
    edges = [{"source": "src", "target": "dst", "targetHandle": "dst-0"}]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), edges)
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == [{"nodeId": "src", "error": "Unwired input: node has outputs but no incoming value"}]
    src_data = updated["src"]["data"]
    assert src_data["error"] is True
    assert "Unwired input" in src_data["extendedError"]
    assert src_data["dirty"] is False


def test_bulk_calculate_logic_skips_nodes_marked_has_regenerate():
    nodes = [
        {
            "id": "regen",
            "data": {
                "functionName": "random_256",
                "hasRegenerate": True,
                "dirty": True,
                "result": "keep-me",
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == []
    data = updated["regen"]["data"]
    assert data["result"] == "keep-me"
    assert data["dirty"] is False


def test_bulk_calculate_logic_force_regenerate_calls_function(monkeypatch):
    monkeypatch.setitem(graph_logic.CALC_FUNCTIONS, "random_256", lambda: "stubbed")

    nodes = [
        {
            "id": "regen",
            "data": {
                "functionName": "random_256",
                "forceRegenerate": True,
                "dirty": True,
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == []
    data = updated["regen"]["data"]
    assert data["result"] == "stubbed"
    assert data["dirty"] is False


def test_bulk_calculate_logic_force_regenerate_failure_suppresses_error(monkeypatch):
    def boom():
        raise RuntimeError("fail")

    monkeypatch.setitem(graph_logic.CALC_FUNCTIONS, "random_256", boom)

    nodes = [
        {
            "id": "regen",
            "data": {
                "functionName": "random_256",
                "forceRegenerate": True,
                "dirty": True,
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    data = {node["id"]: node for node in updated_nodes}["regen"]["data"]

    assert errors == []
    assert "error" not in data
    assert data["dirty"] is False


def test_force_regenerate_failure_records_error_for_other_functions(monkeypatch):
    def boom():
        raise RuntimeError("fail")

    monkeypatch.setitem(graph_logic.CALC_FUNCTIONS, "dummy_force", boom)

    nodes = [
        {
            "id": "regen",
            "data": {
                "functionName": "dummy_force",
                "forceRegenerate": True,
                "dirty": True,
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    data = {node["id"]: node for node in updated_nodes}["regen"]["data"]

    assert errors == [{"nodeId": "regen", "error": "fail"}]
    assert data["error"] is True
    assert data["dirty"] is False
    assert "Regenerate fail: fail" in data["extendedError"]


def test_random_node_failure_does_not_mark_error(monkeypatch):
    def boom():
        raise RuntimeError("fail")

    monkeypatch.setitem(graph_logic.CALC_FUNCTIONS, "random_256", boom)

    nodes = [
        {
            "id": "rand",
            "data": {
                "functionName": "random_256",
                "dirty": True,
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    data = {node["id"]: node for node in updated_nodes}["rand"]["data"]

    assert errors == []
    assert "error" not in data
    assert data["dirty"] is False


def test_bulk_calculate_logic_records_function_failure(monkeypatch):
    def flop(val):
        raise ValueError("kaboom")

    monkeypatch.setitem(graph_logic.CALC_FUNCTIONS, "identity", flop)

    nodes = [
        {
            "id": "boom",
            "data": {
                "functionName": "identity",
                "value": "input",
                "dirty": True,
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    data = {node["id"]: node for node in updated_nodes}["boom"]["data"]

    assert errors == [{"nodeId": "boom", "error": "kaboom"}]
    assert data["error"] is True
    assert data["dirty"] is False
    assert "Calculation failed: kaboom" in data["extendedError"]


def test_bulk_calculate_logic_reports_multiple_inputs_error():
    nodes = [
        {
            "id": "a",
            "data": {
                "functionName": "identity",
                "value": "first",
                "dirty": True,
            },
        },
        {
            "id": "b",
            "data": {
                "functionName": "identity",
                "value": "second",
                "dirty": True,
            },
        },
        {
            "id": "dst",
            "data": {
                "functionName": "identity",
                "dirty": True,
            },
        },
    ]
    edges = [
        {"source": "a", "target": "dst", "targetHandle": "dst-0"},
        {"source": "b", "target": "dst", "targetHandle": "dst-0"},
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), edges)
    data = {node["id"]: node for node in updated_nodes}["dst"]["data"]

    assert errors == [{"nodeId": "dst", "error": "Multiple inputs connected to single-value node"}]
    assert data["error"] is True
    assert "Calculation failed: Multiple inputs connected" in data["extendedError"]
    assert data["dirty"] is False


def test_bulk_calculate_logic_casts_integer_params(monkeypatch):
    captured = {}

    def fake_uint32(val):
        captured["val"] = val
        return "ok"

    monkeypatch.setitem(
        graph_logic.CALC_FUNCTIONS,
        "uint32_to_little_endian_4_bytes",
        fake_uint32,
    )

    nodes = [
        {
            "id": "n1",
            "data": {
                "functionName": "uint32_to_little_endian_4_bytes",
                "value": "42",
                "dirty": True,
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == []
    assert captured["val"] == 42
    assert updated["n1"]["data"]["result"] == "ok"


def test_bulk_calculate_logic_casts_number_params(monkeypatch):
    captured = {}

    def fake_hours(val):
        captured["val"] = val
        return "done"

    monkeypatch.setitem(graph_logic.CALC_FUNCTIONS, "hours_to_sequence_number", fake_hours)

    nodes = [
        {
            "id": "n1",
            "data": {
                "functionName": "hours_to_sequence_number",
                "value": "1.75",
                "dirty": True,
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == []
    assert isinstance(captured["val"], float)
    assert captured["val"] == pytest.approx(1.75)
    assert updated["n1"]["data"]["result"] == "done"


def test_bulk_calculate_logic_multi_val_with_network_error_propagation(monkeypatch):
    def fake_wallet_rpc(vals, val, selectedNetwork):
        return "row ok\naddr1 (error=boom)\naddr2 (error=bad)"

    monkeypatch.setitem(graph_logic.CALC_FUNCTIONS, "wallet_rpc_general", fake_wallet_rpc)
    monkeypatch.setitem(
        graph_logic.FUNCTION_SPECS,
        "wallet_rpc_general",
        {
            "paramExtraction": "multi_val_with_network",
            "params": {
                "vals": {"type": "any", "required": True},
                "val": {"type": "any", "required": True},
                "selectedNetwork": {"type": "string", "required": False},
            },
        },
    )

    nodes = [
        {
            "id": "calc",
            "data": {
                "functionName": "wallet_rpc_general",
                "dirty": True,
                "inputStructure": {"ungrouped": [{"index": 0}, {"index": 1}]},
                "inputs": {"vals": {"0": "addr0", "1": "addr1"}},
                "value": json.dumps({"memo": "keep"}),
                "selectedNetwork": "mainnet",
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    updated = {node["id"]: node for node in updated_nodes}

    data = updated["calc"]["data"]
    assert data["error"] is True
    assert "addr1 (error=boom)" in data["extendedError"]
    assert data["inputs"]["val"]["addresses"] == ["addr0", "addr1"]
    assert errors and "addr1 (error=boom)" in errors[0]["error"]


def test_check_result_marks_error_in_graph():
    nodes = [
        {
            "id": "chk",
            "data": {
                "functionName": "check_result",
                "dirty": True,
                "inputStructure": {"ungrouped": [{"index": 0}, {"index": 1}]},
                "inputs": {"vals": {"0": "true", "1": "false"}},
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    data = {node["id"]: node for node in updated_nodes}["chk"]["data"]

    assert errors == []
    assert data["result"] == "false"
    assert data["error"] is True
    assert "Check failed" in data["extendedError"]


def test_show_field_bypasses_unwired_guard():
    nodes = [
        {
            "id": "n1",
            "data": {
                "functionName": "encode_varint",
                "value": "1",
                "showField": True,
                "dirty": True,
            },
        },
        {
            "id": "n2",
            "data": {"functionName": "identity", "dirty": True},
        },
    ]
    edges = [{"source": "n1", "target": "n2", "targetHandle": "input-0"}]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), edges)
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == []
    assert updated["n1"]["data"]["result"] == "01"
    assert updated["n2"]["data"]["result"] == "01"
    assert "error" not in updated["n1"]["data"]


def test_bulk_calculate_logic_strips_malformed_script_debug_steps():
    nodes = [
        {
            "id": "script",
            "data": {
                "functionName": "identity",
                "value": "keep",
                "dirty": True,
                "scriptDebugSteps": "corrupted",
            },
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    updated = {node["id"]: node for node in updated_nodes}

    assert errors == []
    data = updated["script"]["data"]
    assert data["result"] == "keep"
    assert data["dirty"] is False
    assert "scriptDebugSteps" not in data


def test_random_256_via_none_builder():
    nodes = [
        {
            "id": "rand",
            "data": {"functionName": "random_256", "dirty": True},
        }
    ]

    updated_nodes, errors = graph_logic.bulk_calculate_logic(copy.deepcopy(nodes), [])
    assert errors == []
    data = list(updated_nodes)[0]["data"]
    assert len(data["result"]) == 64
    assert int(data["result"], 16) > 0


def test_function_specs_cover_calc_functions():
    funcs = set(graph_logic.CALC_FUNCTIONS.keys())
    specs = set(graph_logic.FUNCTION_SPECS.keys())
    assert funcs == specs
