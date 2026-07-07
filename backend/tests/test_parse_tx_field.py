"""Tests for the self-contained all-tx-types parser (calc_functions.parse_tx_field)."""

import glob
import hashlib
import inspect
import json
from pathlib import Path

import pytest
from bitcointx.core import CTransaction

from calc_functions.calc_func import (
    extract_tx_field,
    parse_tx_field,
    _parse_tx_structure,
)

_REPO = Path(__file__).resolve().parents[2]

# A legacy P2PKH spend and a SegWit spend pulled from shipped lessons at
# collection time — real transactions the app itself verifies.


def _flow_tx_hexes() -> list:
    """Harvest every script_verification tx_hex from all lesson flows."""
    hexes = set()
    for pattern in ("src/my_tx_flows/*.json", "src/my_tx_flows/*/*.json"):
        for path in glob.glob(str(_REPO / pattern)):
            try:
                flow = json.loads(Path(path).read_text())
            except (OSError, json.JSONDecodeError):
                continue
            for node in flow.get("nodes", []):
                data = node.get("data", {})
                if data.get("functionName") != "script_verification":
                    continue
                vals = (data.get("inputs") or {}).get("vals") or {}
                tx_hex = vals.get("2") if isinstance(vals, dict) else None
                if isinstance(tx_hex, str) and len(tx_hex) >= 20:
                    hexes.add(tx_hex)
    return sorted(hexes)


_CORPUS = _flow_tx_hexes()
_LEGACY = [h for h in _CORPUS if h[8:12] != "0001"]
_SEGWIT = [h for h in _CORPUS if h[8:12] == "0001"]


def test_corpus_is_meaningful():
    """The lesson corpus must contain both serializations."""
    assert len(_LEGACY) >= 3, f"too few legacy vectors ({len(_LEGACY)})"
    assert len(_SEGWIT) >= 1, f"no segwit vectors found in lessons"


@pytest.mark.parametrize("tx_hex", _CORPUS)
def test_structural_parity_with_bitcointx(tx_hex):
    """Our parser must agree with python-bitcointx on every lesson tx."""
    tx = CTransaction.deserialize(bytes.fromhex(tx_hex))
    parsed = _parse_tx_structure(tx_hex)

    assert parsed["version"] == tx.nVersion
    assert parsed["locktime"] == tx.nLockTime
    assert parsed["txid"] == tx.GetTxid().hex()
    assert len(parsed["vin"]) == len(tx.vin)
    assert len(parsed["vout"]) == len(tx.vout)
    for i, txin in enumerate(tx.vin):
        assert parsed["vin"][i]["txid"] == txin.prevout.hash.hex()
        assert parsed["vin"][i]["vout"] == txin.prevout.n
        assert parsed["vin"][i]["script_sig"] == bytes(txin.scriptSig).hex()
        assert parsed["vin"][i]["sequence"] == txin.nSequence
    for i, txout in enumerate(tx.vout):
        assert parsed["vout"][i]["value"] == txout.nValue
        assert parsed["vout"][i]["script_pubkey"] == bytes(txout.scriptPubKey).hex()
    if parsed["segwit"]:
        for i in range(len(tx.vin)):
            stack = [bytes(x).hex() for x in tx.wit.vtxinwit[i].scriptWitness.stack]
            assert parsed["witness"][i] == stack
    # wtxid: independent recomputation from the input bytes
    expected_wtxid = (
        hashlib.sha256(hashlib.sha256(bytes.fromhex(tx_hex)).digest())
        .digest()
        .hex()
    )
    if parsed["segwit"]:
        assert parsed["wtxid"] == expected_wtxid
    else:
        assert parsed["wtxid"] == parsed["txid"] == expected_wtxid


@pytest.mark.parametrize("tx_hex", _LEGACY[:5])
def test_field_parity_with_extract_tx_field(tx_hex):
    """Shared fields must match the original node byte-for-byte on legacy txs."""
    shared = [
        "version", "locktime", "input_count", "output_count", "txid",
        "vin.txid", "vin.vout", "vin.scriptSig", "vin.sequence",
        "vout.value", "vout.scriptPubKey",
    ]
    for field in shared:
        old = extract_tx_field([tx_hex, field, "0"])
        new = parse_tx_field([tx_hex, field, "0", ""])
        assert new == old, f"parity mismatch on {field}"


def test_legacy_derived_fields():
    tx_hex = _LEGACY[0]
    assert parse_tx_field([tx_hex, "raw_no_witness"]) == tx_hex.lower()
    assert parse_tx_field([tx_hex, "wtxid"]) == parse_tx_field([tx_hex, "txid"])
    assert parse_tx_field([tx_hex, "marker_flag"]) == ""
    size = int(parse_tx_field([tx_hex, "size"]))
    assert size == len(tx_hex) // 2
    assert int(parse_tx_field([tx_hex, "weight"])) == size * 4
    assert int(parse_tx_field([tx_hex, "vsize"])) == size


def test_legacy_scriptsig_item_fields():
    tx_hex = next(
        tx
        for tx in _LEGACY
        if parse_tx_field([tx, "vin.scriptSig", "0"])
    )
    count = int(parse_tx_field([tx_hex, "vin.scriptSig_count", "0"]))
    assert count >= 1

    script_sig = parse_tx_field([tx_hex, "vin.scriptSig", "0"])
    items = [
        parse_tx_field([tx_hex, f"vin.scriptSig.item{j}", "0"])
        for j in range(count)
    ]

    assert parse_tx_field([tx_hex, "vin.scriptSig.last", "0"]) == items[-1]
    for item in items:
        if item:
            assert item in script_sig


def test_scriptsig_item_fields_parse_small_push_opcodes():
    # scriptSig bytes: OP_0 OP_1 PUSH(1) aa OP_1NEGATE
    tx_hex = (
        "02000000"
        "01"
        + "aa" * 32
        + "00000000"
        + "05"
        + "005101aa4f"
        + "ffffffff"
        + "01"
        + "e803000000000000"
        + "01"
        + "51"
        + "00000000"
    )

    assert parse_tx_field([tx_hex, "vin.scriptSig", "0"]) == "005101aa4f"
    assert parse_tx_field([tx_hex, "vin.scriptSig_count", "0"]) == "4"
    assert parse_tx_field([tx_hex, "vin.scriptSig.item0", "0"]) == ""
    assert parse_tx_field([tx_hex, "vin.scriptSig.item1", "0"]) == "01"
    assert parse_tx_field([tx_hex, "vin.scriptSig.item2", "0"]) == "aa"
    assert parse_tx_field([tx_hex, "vin.scriptSig.item3", "0"]) == "81"
    assert parse_tx_field([tx_hex, "vin.scriptSig.last", "0"]) == "81"


def test_scriptsig_item_index_out_of_range():
    tx_hex = next(
        tx
        for tx in _LEGACY
        if parse_tx_field([tx, "vin.scriptSig", "0"])
    )
    with pytest.raises(IndexError, match="scriptSig item index"):
        parse_tx_field([tx_hex, "vin.scriptSig.item99", "0"])


def test_unknown_scriptsig_subfield_rejected():
    with pytest.raises(ValueError, match="Unknown vin sub-field"):
        parse_tx_field([_LEGACY[0], "vin.scriptSig.itemX", "0"])


def test_scriptsig_item_fields_reject_non_push_opcodes():
    tx_hex = (
        "02000000"
        "01"
        + "aa" * 32
        + "00000000"
        + "01"
        + "76"
        + "ffffffff"
        + "01"
        + "e803000000000000"
        + "01"
        + "51"
        + "00000000"
    )

    with pytest.raises(ValueError, match="only push operations"):
        parse_tx_field([tx_hex, "vin.scriptSig.item0", "0"])


def test_segwit_witness_fields():
    tx_hex = _SEGWIT[0]
    assert parse_tx_field([tx_hex, "marker_flag"]) == "0001"
    assert parse_tx_field([tx_hex, "wtxid"]) != parse_tx_field([tx_hex, "txid"])

    count = int(parse_tx_field([tx_hex, "vin.witness_count", "0"]))
    assert count >= 1
    # items are individually addressable and re-compose into the wire hex
    wire = parse_tx_field([tx_hex, "vin.witness", "0"])
    items = [
        parse_tx_field([tx_hex, f"vin.witness.item{j}", "0"])
        for j in range(count)
    ]
    assert parse_tx_field([tx_hex, "vin.witness.last", "0"]) == items[-1]
    for item in items:
        assert item in wire
    # weight bookkeeping: base*3 + total
    base = len(parse_tx_field([tx_hex, "raw_no_witness"])) // 2
    total = int(parse_tx_field([tx_hex, "size"]))
    assert int(parse_tx_field([tx_hex, "weight"])) == base * 3 + total


def test_witness_fields_on_legacy_tx_error_clearly():
    tx_hex = _LEGACY[0]
    for field in (
        "vin.witness",
        "vin.witness_count",
        "vin.witness.item0",
        "vin.witness.last",
    ):
        with pytest.raises(ValueError, match="no witness data"):
            parse_tx_field([tx_hex, field, "0"])


def test_witness_item_index_out_of_range():
    tx_hex = _SEGWIT[0]
    with pytest.raises(IndexError, match="witness item index"):
        parse_tx_field([tx_hex, "vin.witness.item99", "0"])


def test_unknown_witness_subfield_rejected():
    with pytest.raises(ValueError, match="Unknown vin sub-field"):
        parse_tx_field([_SEGWIT[0], "vin.witness.itemX", "0"])


def test_op_return_parity():
    # p5 lesson has an OP_RETURN output; find it
    for tx_hex in _CORPUS:
        try:
            parsed = _parse_tx_structure(tx_hex)
        except ValueError:
            continue
        for vout_index, out in enumerate(parsed["vout"]):
            if out["script_pubkey"].startswith("6a"):
                old = extract_tx_field([tx_hex, "op_return.data", str(vout_index)])
                new = parse_tx_field([tx_hex, "op_return.data", str(vout_index), ""])
                assert new == old
                return
    pytest.skip("no OP_RETURN output found in lesson corpus")


@pytest.mark.parametrize(
    "bad,needle",
    [
        ("", "empty"),
        ("zz", "Not valid hex"),
        ("abc", "Odd-length"),
        ("02000000", "truncated"),
        ("0200000000020102", "Invalid SegWit flag"),
        ("020000000001", "truncated"),
    ],
)
def test_error_paths(bad, needle):
    with pytest.raises(ValueError) as exc:
        parse_tx_field([bad, "txid"])
    assert needle.lower() in str(exc.value).lower()


def test_trailing_bytes_rejected():
    with pytest.raises(ValueError, match="trailing"):
        parse_tx_field([_LEGACY[0] + "00", "txid"])


def test_hostile_counts_rejected_fast():
    # varint claims 2^32-ish inputs — must be rejected before looping
    hostile = "02000000" + "feffffffff" + "00" * 40
    with pytest.raises(ValueError, match="exceeds remaining bytes"):
        parse_tx_field([hostile, "txid"])


def test_size_cap():
    with pytest.raises(ValueError, match="too large"):
        parse_tx_field(["00" * 1_000_001, "txid"])


def _with_noncanonical_input_count(tx_hex: str) -> str:
    """Re-encode a single-input legacy tx's input count 01 as fd0100."""
    assert tx_hex[8:10] == "01", "expected single-input legacy tx"
    return tx_hex[:8] + "fd0100" + tx_hex[10:]


def test_non_canonical_compactsize_rejected():
    """Core's ReadCompactSize rejects padded encodings; so must we."""
    single_input = next(h for h in _LEGACY if h[8:10] == "01")
    mutated = _with_noncanonical_input_count(single_input)
    with pytest.raises(ValueError, match="Non-canonical CompactSize"):
        parse_tx_field([mutated, "txid"])
    # parity: bitcointx rejects the same serialization
    with pytest.raises(Exception):
        CTransaction.deserialize(bytes.fromhex(mutated))


def test_non_canonical_compactsize_fe_ff_forms():
    # fe form used for a value that fits fd
    with pytest.raises(ValueError, match="Non-canonical CompactSize"):
        parse_tx_field(["02000000" + "fe01000000" + "00" * 60, "txid"])
    # ff form used for a value that fits fe
    with pytest.raises(ValueError, match="Non-canonical CompactSize"):
        parse_tx_field(["02000000" + "ff0100000000000000" + "00" * 60, "txid"])


def test_superfluous_witness_rejected():
    """Marker/flag with all-empty witness stacks must use legacy serialization."""
    superfluous = (
        "02000000"          # version
        + "0001"            # marker/flag
        + "01"              # 1 input
        + "aa" * 32 + "00000000" + "00" + "ffffffff"  # prevout/scriptSig/sequence
        + "01"              # 1 output
        + "e803000000000000" + "01" + "51"            # 1000 sats, OP_TRUE
        + "00"              # witness stack for input 0: EMPTY
        + "00000000"        # locktime
    )
    with pytest.raises(ValueError, match="Superfluous witness"):
        parse_tx_field([superfluous, "txid"])
    # parity: bitcointx rejects the same serialization
    with pytest.raises(Exception):
        CTransaction.deserialize(bytes.fromhex(superfluous))


def test_equivalent_legacy_serialization_still_parses():
    """The same tx WITHOUT the superfluous witness section is valid."""
    legacy = (
        "02000000"
        + "01"
        + "aa" * 32 + "00000000" + "00" + "ffffffff"
        + "01"
        + "e803000000000000" + "01" + "51"
        + "00000000"
    )
    assert parse_tx_field([legacy, "input_count"]) == "1"
    assert parse_tx_field([legacy, "marker_flag"]) == ""


def test_show_code_is_self_contained():
    """The expanded Show Code source must compile and run on its own."""
    from codeview_expander import expand_function_source
    from graph_logic import CALC_FUNCTIONS

    func = CALC_FUNCTIONS["parse_tx_field"]
    src = expand_function_source(func, inspect.getsource(func))
    assert "def _parse_tx_structure" in src
    assert "def _tx_op_return_data" in src
    namespace = {"hashlib": hashlib}
    exec(compile(src, "<showcode>", "exec"), namespace)  # noqa: S102 - test-only
    assert namespace["parse_tx_field"]([_LEGACY[0], "input_count"]) == \
        extract_tx_field([_LEGACY[0], "input_count"])


def test_dynamic_graph_outputs_shape():
    """parse_tx_field nodes get the same dynamic outputValues plumbing."""
    from graph_logic import bulk_calculate_logic

    tx_hex = _SEGWIT[0]
    node = {
        "id": "parse1",
        "type": "calculation",
        "data": {
            "functionName": "parse_tx_field",
            "txFieldExtractMode": "dynamic",
            "txExtractFields": ["txid", "wtxid", "vin.witness", "op_return.data"],
            "paramExtraction": "multi_val",
            "numInputs": 2,
            "inputStructure": {
                "ungrouped": [
                    {"index": 0, "label": "Raw TX (hex):"},
                    {"index": 1, "label": "VIN/VOUT Index:"},
                ]
            },
            "inputs": {"vals": {"0": tx_hex, "1": "0"}},
            "dirty": True,
        },
    }
    nodes, errors = bulk_calculate_logic([node], [])
    nodes = list(nodes)
    assert not errors
    data = nodes[0]["data"]
    values = data["outputValues"]
    assert set(values.keys()) == {"output-0", "output-1", "output-2", "output-3"}
    assert values["output-0"] == parse_tx_field([tx_hex, "txid"])
    assert values["output-1"] == parse_tx_field([tx_hex, "wtxid"])
    assert values["output-2"] == parse_tx_field([tx_hex, "vin.witness", "0"])
    # per-field isolation: no OP_RETURN in this tx -> empty value + error line
    assert values["output-3"] == ""
    assert "<error:" in data["result"]
    assert [p["handleId"] for p in data["outputPorts"]] == [
        "output-0", "output-1", "output-2", "output-3",
    ]
    assert data["dirty"] is False


def test_dynamic_graph_default_fields():
    from graph_logic import bulk_calculate_logic

    node = {
        "id": "parse2",
        "type": "calculation",
        "data": {
            "functionName": "parse_tx_field",
            "txFieldExtractMode": "dynamic",
            "paramExtraction": "multi_val",
            "numInputs": 2,
            "inputStructure": {
                "ungrouped": [
                    {"index": 0, "label": "Raw TX (hex):"},
                    {"index": 1, "label": "VIN/VOUT Index:"},
                ]
            },
            "inputs": {"vals": {"0": _SEGWIT[0], "1": "0"}},
            "dirty": True,
        },
    }
    nodes, errors = bulk_calculate_logic([node], [])
    nodes = list(nodes)
    assert not errors
    assert nodes[0]["data"]["txExtractFields"] == ["txid", "wtxid", "vin.witness"]


def test_dynamic_graph_stale_outputs_cleared_on_bad_input():
    from graph_logic import bulk_calculate_logic

    node = {
        "id": "parse3",
        "type": "calculation",
        "data": {
            "functionName": "parse_tx_field",
            "txFieldExtractMode": "dynamic",
            "txExtractFields": ["txid"],
            "paramExtraction": "multi_val",
            "numInputs": 2,
            "inputStructure": {
                "ungrouped": [
                    {"index": 0, "label": "Raw TX (hex):"},
                    {"index": 1, "label": "VIN/VOUT Index:"},
                ]
            },
            "inputs": {"vals": {"0": "zz-not-hex", "1": "0"}},
            "outputValues": {"output-0": "stale-value"},
            "dirty": True,
        },
    }
    nodes, _errors = bulk_calculate_logic([node], [])
    nodes = list(nodes)
    data = nodes[0]["data"]
    # per-field isolation converts the parse error into an empty output
    assert data["outputValues"]["output-0"] == ""
    assert "stale-value" not in json.dumps(data["outputValues"])
