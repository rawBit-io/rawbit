"""Generate a rawBit flow that rebuilds a transaction byte-for-byte.

Strategy: the hand-authored lesson ``p0_Intro_P2PKH.json`` is already a complete,
beautifully laid-out flow that funds, signs (low-R), assembles and verifies a
1-input / 1-output legacy P2PKH spend. Rather than synthesize a layout, we clone
that flow and substitute the real transaction's values into its constant nodes.

Only the 1-in / 1-out legacy P2PKH shape is supported in this first version;
anything else raises ``UnsupportedTransaction``.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_PATH = ROOT / "src" / "my_tx_flows" / "p0_Intro_P2PKH.json"

# Node ids in p0_Intro_P2PKH.json that the generator drives. Each is asserted to
# exist with the expected functionName at generation time, so the golden test
# catches any drift if the lesson is re-authored.
NODE = {
    "funding_raw_tx": ("node_xfz2u3e", "identity"),         # prev (funding) tx hex
    "vout": ("node_ljj3f78", "identity"),                   # spent output index
    "version": ("node_8QSOHj19", "identity"),               # tx version
    "input_count": ("node_1AL3tCpN", "identity"),
    "sequence": ("node_v7K1rBTw", "identity"),              # big-endian; reversed to wire LE
    "locktime": ("node_hHXC5ZW3", "identity"),
    "output_amount": ("node_IRajBmor", "identity"),         # satoshis
    "output_count": ("node_kSTGvvaL", "identity"),
    "sighash_flag": ("node_bkJNiVtV", "identity"),
    "spending_key": ("node_CWfi6O88", "random_256"),        # -> constant privkey
    "output_hash160": ("node_Lwo0cZDT", "hash160_hex"),     # -> constant hash160
}
# Recipient key-derivation nodes collapsed away (we only know the output hash160).
REMOVED_NODES = ("node_JMarfc2B", "node_opeFHAE6")


class UnsupportedTransaction(Exception):
    """The transaction is not a shape this generator can rebuild yet."""


def _load_template() -> dict:
    return json.loads(TEMPLATE_PATH.read_text())


def _index(flow: dict) -> dict:
    return {node["id"]: node for node in flow["nodes"]}


def _require(nodes: dict, key: str):
    node_id, expected_fn = NODE[key]
    node = nodes.get(node_id)
    if node is None:
        raise RuntimeError(f"template node {node_id} ({key}) is missing")
    actual = node.get("data", {}).get("functionName")
    if actual != expected_fn:
        raise RuntimeError(
            f"template node {node_id} ({key}) changed: expected {expected_fn}, got {actual}"
        )
    return node


def _set_value(node: dict, value: str) -> None:
    data = node["data"]
    data["value"] = value
    data.setdefault("inputs", {})["val"] = value
    data["result"] = value
    data["dirty"] = False


def _make_constant(node: dict, value: str) -> None:
    """Turn any node into a plain identity constant (drops function-specific data)."""
    data = node["data"]
    title = data.get("title", "")
    node["data"] = {
        "functionName": "identity",
        "showField": True,
        "numInputs": 0,
        "value": value,
        "dirty": False,
        "version": 0,
        "inputs": {"val": value},
        "result": value,
        "inputStructure": {"ungrouped": [{"index": 0, "label": "INPUT VALUE:", "rows": 1}]},
        "groupInstances": {},
        "title": title,
        "error": False,
        "showComment": False,
    }


def _classify_p2pkh(script_hex: str) -> str | None:
    """Return the 20-byte hash160 of a standard P2PKH scriptPubKey, else None."""
    s = script_hex.lower()
    if len(s) == 50 and s.startswith("76a914") and s.endswith("88ac"):
        return s[6:46]
    return None


def _status_card(dataset: dict, out: dict) -> dict:
    """A single info card summarizing what was rebuilt and what was auto-filled."""
    fee = dataset["vin"][0]["prev_value_sats"] - sum(
        o["value_sats"] for o in dataset["vout"]
    )
    content = (
        "# Rebuilt transaction\n\n"
        f"`{dataset['txid']}`\n\n"
        "This flow reconstructs the transaction above byte-for-byte and verifies "
        "its script.\n\n"
        "**Fetched from Bitcoin Core — nothing to add manually:**\n"
        "- ✓ Funding transaction (the spent UTXO)\n"
        "- ✓ Spending private key — the signature is **recreated on the canvas**, "
        "not pasted in\n\n"
        "**Shape:** 1 input (P2PKH) → 1 output (P2PKH)\n"
        f"- Output: {out['value_sats']:,} sats\n"
        f"- Fee: {fee:,} sats\n\n"
        "Edit any input node (output amount, vout, key…) and the whole flow recomputes."
    )
    return {
        "id": "node_rebuild_info",
        "type": "shadcnTextInfo",
        "position": {"x": 0, "y": 0},  # repositioned above the flow below
        "data": {
            "content": content,
            "fontSize": 28,
            "width": 1500,
            "height": 820,
            "title": "Rebuild info",
            "dirty": False,
        },
        "width": 1500,
        "height": 820,
    }


def _place_card_above_flow(flow: dict, card: dict) -> None:
    """Position the status card above the top-left of the (group) layout."""
    groups = [n for n in flow["nodes"] if n.get("type") == "shadcnGroup"]
    if groups:
        min_x = min(n["position"]["x"] for n in groups)
        min_y = min(n["position"]["y"] for n in groups)
        card["position"] = {"x": min_x, "y": min_y - card["height"] - 200}


def _precompute_results(flow: dict) -> None:
    """Run the flow through the calc engine and bake the results into the nodes.

    Lessons ship with cached results so they render correctly the instant they
    load; a generated flow must do the same, otherwise the canvas would show the
    template's stale values until the user triggers a recalculation.
    """
    import graph_logic  # local import: heavy deps, only needed here

    calc_nodes = [n for n in flow["nodes"] if n.get("data", {}).get("functionName")]
    valid = {n["id"] for n in calc_nodes}
    calc_edges = [
        e for e in flow["edges"] if e["source"] in valid and e["target"] in valid
    ]
    updated, _errors = graph_logic.bulk_calculate_logic(
        copy.deepcopy(calc_nodes), calc_edges
    )
    computed = {n["id"]: n["data"] for n in updated}
    for node in flow["nodes"]:
        if node["id"] in computed:
            node["data"] = computed[node["id"]]


def generate_flow(dataset: dict) -> dict:
    """Build FlowData rebuilding the dataset's transaction. See module docstring."""
    vin = dataset["vin"]
    vout = dataset["vout"]
    if len(vin) != 1 or len(vout) != 1:
        raise UnsupportedTransaction(
            f"only 1-input / 1-output transactions are supported yet "
            f"(got {len(vin)} in, {len(vout)} out)."
        )

    inp = vin[0]
    out = vout[0]
    if _classify_p2pkh(inp["prev_scriptpubkey"]) is None:
        raise UnsupportedTransaction("the spent output is not legacy P2PKH.")
    out_hash160 = _classify_p2pkh(out["scriptpubkey"])
    if out_hash160 is None:
        raise UnsupportedTransaction("the new output is not legacy P2PKH.")
    if inp.get("privkey_hex") is None:
        raise UnsupportedTransaction(
            "the spending private key is unavailable (not an owned regtest key)."
        )
    if dataset.get("sighash_type", 1) != 1:
        raise UnsupportedTransaction("only SIGHASH_ALL is supported yet.")

    flow = _load_template()
    nodes = _index(flow)

    _set_value(_require(nodes, "funding_raw_tx"), inp["prev_tx_hex"])
    _set_value(_require(nodes, "vout"), str(inp["vout"]))
    _set_value(_require(nodes, "version"), str(dataset["version"]))
    _set_value(_require(nodes, "input_count"), "1")
    _set_value(_require(nodes, "sequence"), format(inp["sequence"], "08x"))
    _set_value(_require(nodes, "locktime"), str(dataset["locktime"]))
    _set_value(_require(nodes, "output_amount"), str(out["value_sats"]))
    _set_value(_require(nodes, "output_count"), "1")
    _set_value(_require(nodes, "sighash_flag"), "01")

    _make_constant(_require(nodes, "spending_key"), inp["privkey_hex"])
    _make_constant(_require(nodes, "output_hash160"), out_hash160)

    # Drop the now-unused recipient key-derivation nodes and any edge touching
    # them, and replace the lesson's step-by-step cards with one status card.
    removed = set(REMOVED_NODES)
    flow["nodes"] = [
        n
        for n in flow["nodes"]
        if n["id"] not in removed and n.get("type") != "shadcnTextInfo"
    ]
    flow["edges"] = [
        e
        for e in flow["edges"]
        if e["source"] not in removed and e["target"] not in removed
    ]

    card = _status_card(dataset, out)
    _place_card_above_flow(flow, card)
    flow["nodes"].append(card)

    _precompute_results(flow)
    flow["name"] = f"Rebuild {dataset['txid'][:12]}…"
    return flow
