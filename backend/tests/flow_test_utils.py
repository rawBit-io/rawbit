"""Shared helpers for the saved-flow regression tests.

Centralises the lesson-JSON loader (with its literal-backfill quirks), the
bulk-calculation runner, and a formatting-preserving writer used by the
UPDATE_FLOW_GOLDENS refresh mode of test_flow_goldens.py.
"""

import copy
import json
from pathlib import Path

from backend import graph_logic

ROOT = Path(__file__).resolve().parents[2]
FLOW_DIR = ROOT / "src" / "my_tx_flows"


def load_flow(path: Path):
    """Return (calc_nodes, calc_edges) for a saved lesson JSON.

    Backfills literal values for nodes that were saved with cached results but
    no upstream cable. Older fixtures sometimes rely on inputs["val"] without
    mirroring it into the "value" field, which causes graph_logic to treat the
    node as unwired and raise. Copy that cached literal so the node behaves as
    a constant source during regression runs.
    """
    flow = json.loads(path.read_text())
    calc_nodes = [
        node
        for node in flow["nodes"]
        if node.get("data", {}).get("functionName")
    ]
    valid_ids = {node["id"] for node in calc_nodes}
    calc_edges = [
        edge
        for edge in flow["edges"]
        if edge.get("source") in valid_ids and edge.get("target") in valid_ids
    ]
    incoming_by_target = {}
    for edge in calc_edges:
        incoming_by_target.setdefault(edge["target"], 0)
        incoming_by_target[edge["target"]] += 1
    for node in calc_nodes:
        data = node.get("data") or {}
        node_id = node.get("id")
        has_incoming = incoming_by_target.get(node_id, 0) > 0
        if has_incoming:
            continue
        if data.get("showField"):
            continue
        if "value" in data:
            continue
        literal = data.get("inputs", {}).get("val")
        if literal is not None:
            data["value"] = literal
    return calc_nodes, calc_edges


def run_flow(nodes, edges):
    """Run bulk_calculate_logic on a deep copy and return ({id: node}, errors)."""
    updated_nodes, errors = graph_logic.bulk_calculate_logic(
        copy.deepcopy(nodes), edges
    )
    return {node["id"]: node for node in updated_nodes}, errors


# ───────────────────────────────────────────────────────────────
#  formatting-preserving golden refresh (UPDATE_FLOW_GOLDENS=1)
# ───────────────────────────────────────────────────────────────
_WHITESPACE = " \t\n\r"
_DECODER = json.JSONDecoder()


def _skip_ws(text: str, i: int) -> int:
    while i < len(text) and text[i] in _WHITESPACE:
        i += 1
    return i


def _object_member_spans(text: str, i: int):
    """text[i] must be '{'. Return ({key: (value_start, value_end)}, end)."""
    if text[i] != "{":
        raise ValueError(f"Expected object at offset {i}")
    spans = {}
    i = _skip_ws(text, i + 1)
    if text[i] == "}":
        return spans, i + 1
    while True:
        key, i = json.decoder.scanstring(text, i + 1)
        i = _skip_ws(text, i)
        if text[i] != ":":
            raise ValueError(f"Expected ':' at offset {i}")
        value_start = _skip_ws(text, i + 1)
        _, value_end = _DECODER.raw_decode(text, value_start)
        spans[key] = (value_start, value_end)
        i = _skip_ws(text, value_end)
        if text[i] == ",":
            i = _skip_ws(text, i + 1)
        elif text[i] == "}":
            return spans, i + 1
        else:
            raise ValueError(f"Malformed object at offset {i}")


def _array_item_spans(text: str, i: int):
    """text[i] must be '['. Return ([(value_start, value_end), ...], end)."""
    if text[i] != "[":
        raise ValueError(f"Expected array at offset {i}")
    spans = []
    i = _skip_ws(text, i + 1)
    if text[i] == "]":
        return spans, i + 1
    while True:
        value_start = i
        _, value_end = _DECODER.raw_decode(text, value_start)
        spans.append((value_start, value_end))
        i = _skip_ws(text, value_end)
        if text[i] == ",":
            i = _skip_ws(text, i + 1)
        elif text[i] == "]":
            return spans, i + 1
        else:
            raise ValueError(f"Malformed array at offset {i}")


def format_flow_value(value, indent: int, width: int = 80) -> str:
    """Serialize a JSON value the way the committed lesson files are formatted.

    Two-space indentation, objects always expanded, arrays of scalars kept on
    one line while they fit within the print width (Prettier-style). Validated
    byte-for-byte against the committed data.result / scriptDebugSteps spans.
    """
    pad = " " * indent
    child_pad = " " * (indent + 2)
    if isinstance(value, dict):
        if not value:
            return "{}"
        inner = ",\n".join(
            child_pad
            + json.dumps(key, ensure_ascii=False)
            + ": "
            + format_flow_value(item, indent + 2, width)
            for key, item in value.items()
        )
        return "{\n" + inner + "\n" + pad + "}"
    if isinstance(value, list):
        if not value:
            return "[]"
        if all(not isinstance(item, (dict, list)) for item in value):
            inline = (
                "["
                + ", ".join(json.dumps(item, ensure_ascii=False) for item in value)
                + "]"
            )
            if indent + len(inline) <= width:
                return inline
        inner = ",\n".join(
            child_pad + format_flow_value(item, indent + 2, width) for item in value
        )
        return "[\n" + inner + "\n" + pad + "]"
    return json.dumps(value, ensure_ascii=False)


def rewrite_committed_node_outputs(path: Path, updates: dict) -> list:
    """Surgically rewrite data.result / data.scriptDebugSteps for given nodes.

    ``updates`` maps node id -> {"result": ..., "scriptDebugSteps": ...} (each
    key optional). Only values whose key already exists in the committed node
    data are replaced, so the rest of the file keeps its exact formatting.
    Returns the list of (node_id, key) pairs that were rewritten.
    """
    text = path.read_text()
    root_spans, _ = _object_member_spans(text, _skip_ws(text, 0))
    node_spans, _ = _array_item_spans(text, root_spans["nodes"][0])

    replacements = []  # (start, end, new_text, node_id, key)
    for node_start, _node_end in node_spans:
        member_spans, _ = _object_member_spans(text, node_start)
        if "id" not in member_spans or "data" not in member_spans:
            continue
        id_start, id_end = member_spans["id"]
        node_id = json.loads(text[id_start:id_end])
        if node_id not in updates:
            continue
        data_spans, _ = _object_member_spans(text, member_spans["data"][0])
        for key, new_value in updates[node_id].items():
            if key not in data_spans:
                continue
            value_start, value_end = data_spans[key]
            line_start = text.rfind("\n", 0, value_start) + 1
            line = text[line_start:]
            indent = len(line) - len(line.lstrip(" "))
            new_text = format_flow_value(new_value, indent)
            replacements.append((value_start, value_end, new_text, node_id, key))

    rewritten = []
    for start, end, new_text, node_id, key in sorted(replacements, reverse=True):
        text = text[:start] + new_text + text[end:]
        rewritten.append((node_id, key))
    if rewritten:
        path.write_text(text)
    return rewritten
