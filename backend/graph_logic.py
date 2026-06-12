import contextlib
import json
import re
import signal
import threading
import time
_INT_RE = re.compile(r'^[+-]?\d+$')
from collections import deque

from calc_functions.calc_func import (
    identity,
    concat_all,
    random_256,
    entropy_to_bip39_mnemonic,
    bip39_mnemonic_to_seed,
    bip32_derive_private_key,
    build_trezor_sign_transaction_params,
  
    public_key_from_private_key,
   
 
    uint32_to_little_endian_4_bytes,
    sighash_type_to_le4,
    encode_varint,
    reverse_txid_bytes,

    satoshi_to_8_le,

    double_sha256_hex,
    sha256_hex,
    tagged_hash,
    sign_as_bitcoin_core_low_r,
    sign_tx_rfc6979,
    hash160_hex,
    varint_encoded_byte_length,
    script_verification,
  
    encode_script_push_data,
    op_code_select,
    int_to_script_bytes, 
    text_to_hex,
    blocks_to_sequence_number,
    xonly_pubkey_from_private_key,
    xonly_pubkey,
    even_y_private_key,
    p2tr_address_from_xonly,
    taproot_tweak_xonly_pubkey,
    taproot_tweaked_privkey,
    taproot_output_pubkey_from_xonly,
    taproot_tree_builder,
    schnorr_sign_bip340,
    schnorr_verify_bip340,
    taproot_sighash_default,
    musig2_aggregate_pubkeys,
    musig2_nonce_gen,
    musig2_nonce_agg,
    musig2_partial_sign,
    musig2_partial_sig_verify,
    musig2_partial_sig_agg,
    schnorr_batch_verify_demo,
    hash160_to_p2sh_address,
    date_to_unix_timestamp,
    reverse_bytes_4,
    hours_to_sequence_number,
    opcode_to_value,
    encode_sequence_block_flag,
    encode_sequence_time_flag,
    verify_signature,
    extract_tx_field,
    compare_equal,
    compare_numbers,
    math_operation,
    hash160_to_p2pkh_address,
    hash160_to_p2wpkh_address,
    sha256_to_p2wsh_address,
    hex_byte_length,
    address_to_scriptpubkey,
    bip67_sort_pubkeys,
    check_result,
)
from calc_functions.function_specs import FUNCTION_SPECS
from config import (
    CALCULATION_TIMEOUT_NODE_ID,
    CALCULATION_TIMEOUT_SECONDS,
)

SENTINEL_EMPTY   = "__EMPTY__"
SENTINEL_FORCE00 = "__FORCE00__"
SENTINEL_NULL    = "__NULL__"


# ───────────────────────────────────────────────────────────────
#  mapping functionName → callable
# ───────────────────────────────────────────────────────────────
CALC_FUNCTIONS = {
   
    "identity": identity,
    "concat_all": concat_all,
    "random_256": random_256,
    "entropy_to_bip39_mnemonic": entropy_to_bip39_mnemonic,
    "bip39_mnemonic_to_seed": bip39_mnemonic_to_seed,
    "bip32_derive_private_key": bip32_derive_private_key,
    "build_trezor_sign_transaction_params": build_trezor_sign_transaction_params,
    "public_key_from_private_key": public_key_from_private_key,
  

    "uint32_to_little_endian_4_bytes": uint32_to_little_endian_4_bytes,
    "sighash_type_to_le4": sighash_type_to_le4,
    "encode_varint": encode_varint,
    "reverse_txid_bytes": reverse_txid_bytes,

    "satoshi_to_8_le": satoshi_to_8_le,

    "double_sha256_hex": double_sha256_hex,
    "tagged_hash": tagged_hash,
    "sign_as_bitcoin_core_low_r": sign_as_bitcoin_core_low_r,
    "sign_tx_rfc6979": sign_tx_rfc6979,
    "hash160_hex": hash160_hex,
    "varint_encoded_byte_length": varint_encoded_byte_length,
    "script_verification": script_verification,
    "sha256_hex": sha256_hex,
 
    "encode_script_push_data": encode_script_push_data,
    "op_code_select": op_code_select,
    "int_to_script_bytes": int_to_script_bytes,
    "text_to_hex": text_to_hex,
    "blocks_to_sequence_number": blocks_to_sequence_number,
    "xonly_pubkey_from_private_key": xonly_pubkey_from_private_key,
    "xonly_pubkey": xonly_pubkey,
    "even_y_private_key": even_y_private_key,
    "p2tr_address_from_xonly": p2tr_address_from_xonly,
    "taproot_tweak_xonly_pubkey": taproot_tweak_xonly_pubkey,
    "taproot_tweaked_privkey": taproot_tweaked_privkey,
    "taproot_output_pubkey_from_xonly": taproot_output_pubkey_from_xonly,
    "taproot_tree_builder": taproot_tree_builder,
    "schnorr_sign_bip340": schnorr_sign_bip340,
    "schnorr_verify_bip340": schnorr_verify_bip340,
    "taproot_sighash_default": taproot_sighash_default,
    "musig2_aggregate_pubkeys": musig2_aggregate_pubkeys,
    "musig2_nonce_gen": musig2_nonce_gen,
    "musig2_nonce_agg": musig2_nonce_agg,
    "musig2_partial_sign": musig2_partial_sign,
    "musig2_partial_sig_verify": musig2_partial_sig_verify,
    "musig2_partial_sig_agg": musig2_partial_sig_agg,
    "schnorr_batch_verify_demo": schnorr_batch_verify_demo,
    "hash160_to_p2sh_address": hash160_to_p2sh_address,
    "date_to_unix_timestamp": date_to_unix_timestamp,
    "reverse_bytes_4": reverse_bytes_4,
    "hours_to_sequence_number": hours_to_sequence_number,
    "opcode_to_value": opcode_to_value, 
    "encode_sequence_block_flag": encode_sequence_block_flag,
    "encode_sequence_time_flag": encode_sequence_time_flag,
    "verify_signature": verify_signature,
    "extract_tx_field": extract_tx_field, 
    "compare_equal": compare_equal,
    "compare_numbers": compare_numbers,
    "math_operation": math_operation,
    "hash160_to_p2pkh_address": hash160_to_p2pkh_address,
    "hash160_to_p2wpkh_address": hash160_to_p2wpkh_address, 
    "sha256_to_p2wsh_address": sha256_to_p2wsh_address,
    "hex_byte_length": hex_byte_length,
    "address_to_scriptpubkey": address_to_scriptpubkey,
    "bip67_sort_pubkeys": bip67_sort_pubkeys,
    "check_result": check_result,
}

_NO_ERROR_FUNCTIONS = {"random_256"}


_HAS_SIGALRM = hasattr(signal, "SIGALRM") and hasattr(signal, "setitimer")


def _can_use_sigalrm() -> bool:
    if not _HAS_SIGALRM:
        return False
    try:
        return threading.current_thread() is threading.main_thread()
    except RuntimeError:
        return False


class CalculationTimeoutError(RuntimeError):
    """Raised when a flow evaluation exceeds the allotted wall-clock budget."""


def _timeout_message(seconds: float) -> str:
    return (
        f"Flow evaluation exceeded the execution budget of {seconds:.1f} seconds"
        if seconds > 0
        else "Flow evaluation exceeded the execution budget"
    )


def _timeout_handler(signum, frame):  # pragma: no cover - invoked by the OS
    raise CalculationTimeoutError(_timeout_message(CALCULATION_TIMEOUT_SECONDS))


@contextlib.contextmanager
def _enforce_deadline(seconds: float):
    if seconds <= 0 or not _can_use_sigalrm():
        yield
        return

    previous = signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0.0)
        signal.signal(signal.SIGALRM, previous)


def _maybe_raise_deadline(deadline_at, seconds: float) -> None:
    if deadline_at is None:
        return
    if time.perf_counter() >= deadline_at:
        raise CalculationTimeoutError(_timeout_message(seconds))


def _annotate_timeout_and_collect_errors(node_map, errors, message: str):
    errors.append({"nodeId": CALCULATION_TIMEOUT_NODE_ID, "error": message})
    for node in node_map.values():
        data = node.setdefault("data", {})
        if not isinstance(data, dict):
            continue
        if data.get("dirty"):
            data.update(
                {
                    "error": True,
                    "extendedError": message,
                    "dirty": False,
                }
            )
            errors.append({"nodeId": node.get("id"), "error": message})
        data.pop("scriptDebugSteps", None)


# ───────────────────────────────────────────────────────────────
#  DAG helpers
# ───────────────────────────────────────────────────────────────
def _mark_invalid_edge(node, message, errors, *, block_execution):
    """Annotate a node with an error triggered before execution."""
    data = node.setdefault("data", {})
    store = data.setdefault("_preflightErrors", [])
    store.append(message)
    data.update({
        "error": True,
        "extendedError": message,
        "dirty": False,
    })
    if block_execution:
        data["_invalidEdge"] = True

    errors.append({"nodeId": node.get("id"), "error": message})


def _normalize_nodes(nodes, errors):
    """Keep only dict nodes with a string id and coerce data to a dict."""
    valid = []
    for n in nodes:
        if not isinstance(n, dict) or not isinstance(n.get("id"), str):
            errors.append(
                {"nodeId": None, "error": "Malformed node: expected an object with a string 'id'"}
            )
            continue
        data = n.setdefault("data", {})
        if not isinstance(data, dict):
            n["data"] = {}
            errors.append({"nodeId": n["id"], "error": "Node 'data' must be an object"})
        # Drop the stale cycle sentinel so it only reflects this request.
        n["data"].pop("_cycle", None)
        valid.append(n)
    return valid


def _sanitize_edges(node_map, edges):
    """Drop edges that reference unknown nodes and collect errors."""
    valid = []
    errors = []

    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")

        has_src = src in node_map
        has_tgt = tgt in node_map

        if has_src and has_tgt:
            valid.append(edge)
            continue

        if has_src:
            message = f"Edge references unknown target '{tgt}'"
            _mark_invalid_edge(node_map[src], message, errors, block_execution=False)

        if has_tgt:
            message = f"Edge references unknown source '{src}'"
            _mark_invalid_edge(node_map[tgt], message, errors, block_execution=True)

    return valid, errors


def topological_sort(nodes, edges):
    incoming = {n["id"]: 0 for n in nodes}
    adj = {n["id"]: [] for n in nodes}
    for e in edges:
        src = e.get("source")
        tgt = e.get("target")
        if src not in adj or tgt not in incoming:
            continue
        adj[src].append(tgt)
        incoming[tgt] += 1
    queue = deque([nid for nid, c in incoming.items() if c == 0])
    order = []
    while queue:
        cur = queue.popleft()
        order.append(cur)
        for nb in adj[cur]:
            incoming[nb] -= 1
            if incoming[nb] == 0:
                queue.append(nb)
    return order


def _mark_cycle_errors(nodes, topo_order, errors):
    """Add _cycle flag + error markup to every node outside topo_order."""
    if len(topo_order) == len(nodes):
        return
    cyclic_ids = {n["id"] for n in nodes if n["id"] not in topo_order}
    for n in nodes:
        if n["id"] in cyclic_ids:
            n["data"].update(
                {
                    "_cycle": True,           # ← sentinel
                    "error": True,
                    "extendedError": "Cycle detected in graph",
                    "dirty": False,
                }
            )
            errors.append({"nodeId": n["id"], "error": "Cycle detected in graph"})

# ───────────────────────────────────────────────────────────────
#  validation helpers
# ───────────────────────────────────────────────────────────────

def validate_inputs(func_name, inputs):
    specs = FUNCTION_SPECS.get(func_name)
    if not specs:
        raise ValueError(f"No specs for function {func_name}")

    for param, rules in specs["params"].items():
        if rules.get("required") and (param not in inputs or inputs[param] in ("", None)):
            raise ValueError(f"Missing required param '{param}'")

        typ = rules.get("type")
        if typ in ("integer", "number") and param in inputs:
            s = str(inputs[param]).strip()
            # Allow blank for optional numeric params (e.g., encode_varint)
            if not s:
                if rules.get("required"):
                    raise ValueError(f"Missing required param '{param}'")
                continue  # optional & blank is OK

            if typ == "integer":
                if not _INT_RE.fullmatch(s):
                    raise ValueError(f"Param '{param}' must be an integer")
            else:  # "number"
                try:
                    float(s)
                except Exception:
                    raise ValueError(f"Param '{param}' must be a number")

    return True



# ───────────────────────────────────────────────────────────────
#  sparse-dict helpers
# ───────────────────────────────────────────────────────────────
def _to_sparse(v):
    if isinstance(v, list):
        return {str(i): val for i, val in enumerate(v) if val != ""}
    return v if isinstance(v, dict) else {}


def _edge_index(edge):
    handle = (edge.get("targetHandle") or "").rsplit("-", 1)
    return int(handle[1]) if len(handle) == 2 and handle[1].isdigit() else None


def _visible_field_indices(node):
    struct = node.get("data", {}).get("inputStructure", {})
    vis = set()

    for key in ("ungrouped", "afterGroups"):
        for f in struct.get(key, []):
            vis.add(f["index"])

    gi = node["data"].get("groupInstanceKeys", {})
    for grp in struct.get("groups", []):
        for base in gi.get(grp["title"], []):
            for f in grp["fields"]:
                vis.add(base + f["index"])

    for arr in struct.get("betweenGroups", {}).values():
        for f in arr:
            vis.add(f["index"])

    return sorted(vis)

# ───────────────────────────────────────────────────────────────
#  param-builder helpers
# ───────────────────────────────────────────────────────────────
def build_none_params(*_):
    return {}


def _resolve_upstream(get_res, nid, handle=None):
    if handle in ("", None):
        return get_res(nid)
    try:
        return get_res(nid, handle)
    except TypeError:
        return get_res(nid)


def build_single_val_params(node, edges, _map, get_res):
    nid = node["id"]
    upstream = [
        _resolve_upstream(get_res, e["source"], e.get("sourceHandle"))
        for e in edges
        if e["target"] == nid
    ]
    
    if len(upstream) > 1:
        raise ValueError("Multiple inputs connected to single-value node")
    
    if upstream:
        val = upstream[0]
    elif "value" in node["data"]:
        val = node["data"]["value"]
    else:
        raise ValueError("Missing required input 'val'")
    
    # ── orphan-constant guard ─────────────────────────────────────
    # Check if node has outputs but no inputs, excluding:
    # - identity nodes (they're meant to be value sources)
    # - nodes with showField=True (they allow manual input)
    if not upstream:
        func_name = node["data"].get("functionName", "")
        show_field = node["data"].get("showField", False)
        
        if func_name != "identity" and not show_field:
            has_outgoing = any(e["source"] == nid for e in edges)
            if has_outgoing:
                raise ValueError(
                    "Unwired input: node has outputs but no incoming value"
                )
    
    return {"val": val}


def _legacy_opcode_names(node):
    data = node.get("data", {})
    names = data.get("opSequenceNames")
    if isinstance(names, list):
        return [str(name).strip() for name in names if str(name).strip()]
    return []


def _multi_common(node, edges, get_res):
    """
    Consolidate input values for multi-input nodes.

    Precedence (highest → lowest):
        1. SENTINEL_FORCE00  – checkbox-forced “00”
        2. SENTINEL_EMPTY    – checkbox-forced empty
        3. SENTINEL_NULL     – checkbox-forced null (function-specific)
        4. Cable value
        5. Manual text
    """
    nid          = node["id"]
    sparse_local = _to_sparse(node["data"].get("inputs", {}).get("vals", {}))

    # ─── incoming cables by index ────────────────────────────────────────────
    edge_by: dict[int, dict] = {}
    for e in (e for e in edges if e["target"] == nid):
        idx = _edge_index(e)
        if idx is None:
            raise ValueError(f"Malformed targetHandle '{e.get('targetHandle')}'")
        if idx in edge_by:
            raise ValueError(f"Multiple cables connected to input index {idx}")
        edge_by[idx] = e

    sparse_out: dict[str, str] = {}
    ordered:     list[str]     = []

    for idx in _visible_field_indices(node):
        explicit = sparse_local.get(str(idx))      # may be None / str

        # ───────────── precedence resolution ────────────────────────────────
        if explicit == SENTINEL_FORCE00:           # ①
            v = "00"
            sparse_out[str(idx)] = SENTINEL_FORCE00

        elif explicit == SENTINEL_EMPTY:           # ②
            v = ""
            sparse_out[str(idx)] = SENTINEL_EMPTY

        elif explicit == SENTINEL_NULL:            # ③
            v = SENTINEL_NULL
            sparse_out[str(idx)] = SENTINEL_NULL

        elif idx in edge_by:                       # ④
            edge = edge_by[idx]
            v = _resolve_upstream(get_res, edge["source"], edge.get("sourceHandle"))
            sparse_out[str(idx)] = v               # keep for display

        else:                                      # ⑤
            v = explicit or ""
            if explicit:
                sparse_out[str(idx)] = explicit

        ordered.append(v)

    return sparse_out, ordered

def build_multi_val_params(node, edges, _map, get_res):
    if (
        node.get("data", {}).get("functionName") == "op_code_select"
        and not _visible_field_indices(node)
    ):
        names = _legacy_opcode_names(node)
        return {
            "vals": names,
            "_sparseVals": {
                str(index * 100): name for index, name in enumerate(names)
            },
        }

    sparse_out, ordered = _multi_common(node, edges, get_res)
    return {"vals": ordered, "_sparseVals": sparse_out}


def build_multi_val_indexed_params(node, edges, _map, get_res):
    """
    Like multi_val, but pass values keyed by their visible input index.

    This is used by grouped builders whose group sizes are represented by
    input indices, not by editable count fields.
    """
    nid = node["id"]
    sparse_local = _to_sparse(node["data"].get("inputs", {}).get("vals", {}))

    edge_by: dict[int, dict] = {}
    for e in (e for e in edges if e["target"] == nid):
        idx = _edge_index(e)
        if idx is None:
            raise ValueError(f"Malformed targetHandle '{e.get('targetHandle')}'")
        if idx in edge_by:
            raise ValueError(f"Multiple cables connected to input index {idx}")
        edge_by[idx] = e

    sparse_out: dict[str, str] = {}
    indexed: dict[str, str] = {}

    for idx in _visible_field_indices(node):
        explicit = sparse_local.get(str(idx))

        if explicit == SENTINEL_FORCE00:
            v = "00"
            sparse_out[str(idx)] = SENTINEL_FORCE00
        elif explicit == SENTINEL_EMPTY:
            v = ""
            sparse_out[str(idx)] = SENTINEL_EMPTY
        elif explicit == SENTINEL_NULL:
            v = SENTINEL_NULL
            sparse_out[str(idx)] = SENTINEL_NULL
        elif idx in edge_by:
            edge = edge_by[idx]
            v = _resolve_upstream(get_res, edge["source"], edge.get("sourceHandle"))
            sparse_out[str(idx)] = v
        else:
            v = explicit or ""
            if explicit:
                sparse_out[str(idx)] = explicit

        indexed[str(idx)] = v

    return {"vals": indexed, "_sparseVals": sparse_out}


def build_val_with_network_params(node, edges, _map, get_res):
    base = build_single_val_params(node, edges, _map, get_res)
    base["selectedNetwork"] = node["data"].get("selectedNetwork", "regtest")
    return base


def build_multi_val_with_network_params(node, edges, _map, get_res):
    sparse_out, ordered = _multi_common(node, edges, get_res)
    try:
        base_val = json.loads(node["data"].get("value", "{}"))
    except Exception:
        base_val = {}
    if not isinstance(base_val, dict):
        base_val = {}
    base_val["addresses"] = [str(v) for v in ordered]
    return {
        "vals": ordered,
        "_sparseVals": sparse_out,
        "val": base_val,
        "selectedNetwork": node["data"].get("selectedNetwork", "regtest"),
    }


def _tx_field_extract_fields(data):
    fields = data.get("txExtractFields")
    if not isinstance(fields, list):
        return ["txid", "vout.scriptPubKey"]

    normalized = [str(field).strip() for field in fields if str(field).strip()]
    return normalized or ["txid", "vout.scriptPubKey"]


def _tx_field_extract_output_ports(fields):
    return [
        {
            "label": field,
            "handleId": f"output-{index}",
            "showLabel": False,
        }
        for index, field in enumerate(fields)
    ]


def _calculate_dynamic_tx_field_extract(data, inp_dict):
    vals = inp_dict.get("vals") or []
    raw_tx_hex = vals[0] if len(vals) > 0 else ""
    index = vals[1] if len(vals) > 1 else ""
    fields = _tx_field_extract_fields(data)

    output_values = {}
    result_lines = []
    for output_index, field in enumerate(fields):
        handle_id = f"output-{output_index}"
        value = extract_tx_field([str(raw_tx_hex), field, str(index or "")])
        output_values[handle_id] = value
        result_lines.append(f"{field}: {value}")

    data["txExtractFields"] = fields
    data["outputPorts"] = _tx_field_extract_output_ports(fields)
    data["outputValues"] = output_values
    data["result"] = "\n".join(result_lines)


PARAM_BUILDERS = {
    "none": build_none_params,
    "single_val": build_single_val_params,
    "multi_val": build_multi_val_params,
    "multi_val_indexed": build_multi_val_indexed_params,
    "val_with_network": build_val_with_network_params,
    "multi_val_with_network": build_multi_val_with_network_params,
}

# ───────────────────────────────────────────────────────────────
#  main entry
# ───────────────────────────────────────────────────────────────
def bulk_calculate_logic(nodes, edges):
    errors = []
    nodes = _normalize_nodes(nodes, errors)
    node_map = {n["id"]: n for n in nodes}

    edges, preflight_errors = _sanitize_edges(node_map, edges)

    order = topological_sort(nodes, edges)
    _mark_cycle_errors(nodes, order, errors)

    if preflight_errors:
        errors.extend(preflight_errors)

    # VS Code greys this because it's *nested* and only referenced
    # inside builder functions via closure; it IS used at runtime.
    def get_res(nid, handle=None):
        data = node_map[nid]["data"]
        if handle:
            outputs = data.get("outputValues")
            if isinstance(outputs, dict) and handle in outputs:
                return outputs.get(handle)
            return None
        return data.get("result")

    timeout_seconds = CALCULATION_TIMEOUT_SECONDS
    deadline_at = (
        time.perf_counter() + timeout_seconds if timeout_seconds > 0 else None
    )

    try:
        with _enforce_deadline(timeout_seconds):
            # walk in topo order
            for nid in order:
                _maybe_raise_deadline(deadline_at, timeout_seconds)

                node, data = node_map[nid], node_map[nid]["data"]

                if node.get("type") in {"shadcnGroup", "shadcnTextInfo"}:
                    data["dirty"] = False
                    data.pop("error", None)
                    data.pop("extendedError", None)
                    continue

                if node.get("type") == "trezorAction":
                    data["dirty"] = False
                    continue

                if data.get("_cycle"):
                    continue  # cyclic nodes are skipped

                if data.pop("_invalidEdge", False):
                    continue

                fn_name = data.get("functionName")
                data.pop("scriptDebugSteps", None)
                data.pop("extendedError", None)
                if fn_name == "taproot_tree_builder":
                    data["taprootTree"] = None
                    data.pop("outputValues", None)

                func = CALC_FUNCTIONS.get(fn_name)
                if not func:
                    data.update(
                        {
                            "error": True,
                            "extendedError": f"No such function '{fn_name}'",
                            "dirty": False,
                        }
                    )
                    errors.append({"nodeId": nid, "error": f"No function {fn_name}"})
                    continue

                # ─── regenerate shortcuts ───────────────────────────────────
                if data.get("hasRegenerate") and not data.get("forceRegenerate"):
                    data["dirty"] = False
                    data.pop("error", None)
                    continue

                if data.pop("forceRegenerate", False):
                    try:
                        data.update({"result": func(), "dirty": False})
                    except Exception as e:
                        if fn_name in _NO_ERROR_FUNCTIONS:
                            data["dirty"] = False
                            data.pop("error", None)
                            data.pop("extendedError", None)
                        else:
                            data.update(
                                {
                                    "error": True,
                                    "extendedError": f"Regenerate fail: {e}",
                                    "dirty": False,
                                }
                            )
                            errors.append({"nodeId": nid, "error": str(e)})
                    continue

                # ─── build inputs ───────────────────────────────────────────
                mode = FUNCTION_SPECS.get(fn_name, {}).get(
                    "paramExtraction", "single_val"
                )
                builder = PARAM_BUILDERS[mode]

                try:
                    inp_dict = builder(node, edges, node_map, get_res)
                    if fn_name == "musig2_nonce_gen":
                        vals = inp_dict.get("vals")
                        if isinstance(vals, list) and len(vals) > 2 and vals[2] == SENTINEL_NULL:
                            vals_copy = list(vals)
                            vals_copy[2] = None
                            inp_dict["vals"] = vals_copy
                    validate_inputs(fn_name, inp_dict)

                    if (
                        fn_name == "extract_tx_field"
                        and data.get("txFieldExtractMode") == "dynamic"
                    ):
                        _calculate_dynamic_tx_field_extract(data, inp_dict)
                        store_inputs = inp_dict.copy()
                        if "_sparseVals" in store_inputs:
                            store_inputs["vals"] = store_inputs.pop("_sparseVals")
                        data.update({"inputs": store_inputs, "dirty": False})
                        data.pop("error", None)
                        continue

                    # numeric casts according to spec
                    for p, spec in FUNCTION_SPECS.get(fn_name, {}).get(
                        "params", {}
                    ).items():
                        typ = spec.get("type")
                        if (
                            typ == "integer"
                            and p in inp_dict
                            and inp_dict[p] not in ("", None)
                        ):
                            inp_dict[p] = int(str(inp_dict[p]).strip())
                        elif (
                            typ == "number"
                            and p in inp_dict
                            and inp_dict[p] not in ("", None)
                        ):
                            inp_dict[p] = float(str(inp_dict[p]).strip())

                    _maybe_raise_deadline(deadline_at, timeout_seconds)

                    # ─── call function ─────────────────────────────────────
                    result = func(
                        **{k: v for k, v in inp_dict.items() if not k.startswith("_")}
                    )

                    _maybe_raise_deadline(deadline_at, timeout_seconds)

                    if fn_name == "script_verification":
                        try:
                            parsed = json.loads(result)
                            data["result"] = (
                                "true" if parsed.get("isValid") else "false"
                            )
                            data["scriptDebugSteps"] = parsed
                        except Exception:
                            data["result"] = result
                    elif fn_name == "taproot_tweak_xonly_pubkey":
                        try:
                            parsed = json.loads(result)
                            output_xonly = parsed.get("output_xonly_pubkey", result)
                            parity_bit = parsed.get("output_parity")
                            parity_byte = "c1" if str(parity_bit) == "1" else "c0"
                            data["result"] = output_xonly
                            output_values = {"output-1": parity_byte}
                            tweak_val = parsed.get("tweak")
                            if tweak_val:
                                output_values["output-2"] = tweak_val
                            data["outputValues"] = output_values
                        except Exception:
                            data["result"] = result
                            data.pop("outputValues", None)
                    elif fn_name == "taproot_tree_builder":
                        try:
                            parsed = json.loads(result)
                            data["result"] = parsed.get("root", result)
                            data["taprootTree"] = parsed
                            data.pop("outputValues", None)
                            paths = parsed.get("paths") or []
                            try:
                                leaf_index = int(data.get("taprootLeafIndex", 0))
                            except Exception:
                                leaf_index = 0
                            if leaf_index < 0 or leaf_index >= len(paths):
                                leaf_index = 0
                            data["taprootLeafIndex"] = leaf_index
                            path_hex = "".join(paths[leaf_index]) if paths else ""
                            data["outputValues"] = {"output-1": path_hex}
                        except Exception:
                            data["result"] = result
                    elif fn_name == "musig2_aggregate_pubkeys":
                        try:
                            parsed = json.loads(result)
                            data["result"] = parsed.get("aggregated_pubkey", result)
                            data.pop("outputValues", None)
                        except Exception:
                            data["result"] = result
                            data.pop("outputValues", None)
                    elif fn_name == "musig2_nonce_gen":
                        try:
                            parsed = json.loads(result)
                            data["result"] = parsed.get("pubnonce", result)
                            secnonce = parsed.get("secnonce")
                            if secnonce is not None:
                                data["outputValues"] = {"output-1": secnonce}
                            else:
                                data.pop("outputValues", None)
                        except Exception:
                            data["result"] = result
                            data.pop("outputValues", None)
                    else:
                        data["result"] = result

                    # ─── store inputs & reset error flag from previous run ─
                    store_inputs = inp_dict.copy()
                    if "_sparseVals" in store_inputs:
                        store_inputs["vals"] = store_inputs.pop("_sparseVals")
                    data.update({"inputs": store_inputs, "dirty": False})
                    data.pop("error", None)  # clear OLD error

                    # ─── custom post-hooks (after pop) ─────────────────────
                    if fn_name == "check_result" and str(data["result"]).lower() == "false":
                        data.update(
                            {
                                "error": True,
                                "extendedError": "Check failed: at least one input is not true",
                            }
                        )

                    # propagate per-row errors from wallet_rpc_general nodes
                    if mode == "multi_val_with_network":
                        errs = [ln for ln in str(result).split("\n") if "(error=" in ln]
                        if errs:
                            joined = "\n".join(errs)
                            data.update(
                                {
                                    "error": True,
                                    "extendedError": "Some inputs caused errors:\n" + joined,
                                }
                            )
                            errors.append({"nodeId": nid, "error": joined})

                except Exception as exc:
                    if isinstance(exc, CalculationTimeoutError):
                        raise
                    if fn_name in _NO_ERROR_FUNCTIONS:
                        data["dirty"] = False
                        data.pop("error", None)
                        data.pop("extendedError", None)
                    else:
                        if fn_name == "build_trezor_sign_transaction_params":
                            data["result"] = ""
                            data.pop("outputValues", None)
                        data.update(
                            {
                                "error": True,
                                "extendedError": f"Calculation failed: {exc}",
                                "dirty": False,
                            }
                        )
                        errors.append({"nodeId": nid, "error": str(exc)})

    except CalculationTimeoutError as exc:
        message = str(exc) if str(exc) else _timeout_message(timeout_seconds)
        _annotate_timeout_and_collect_errors(node_map, errors, message)
        # Drop internal sentinels here too; the timeout annotation already
        # overrides node errors, so no preflight re-annotation is needed.
        for node in node_map.values():
            data = node.get("data") or {}
            data.pop("_preflightErrors", None)
            data.pop("_invalidEdge", None)
            data.pop("_cycle", None)
        return node_map.values(), errors

    for node in node_map.values():
        data = node.get("data") or {}
        data.pop("_cycle", None)
        preflight = data.pop("_preflightErrors", None)
        if not preflight:
            data.pop("_invalidEdge", None)
            continue

        # Deduplicate while preserving order
        deduped = list(dict.fromkeys(preflight))
        message = "\n".join(deduped)

        existing = data.get("extendedError")
        if data.get("error") and existing:
            if message not in existing:
                data["extendedError"] = f"{existing}\n{message}"
        else:
            data["error"] = True
            data["extendedError"] = message
        data["dirty"] = False
        data.pop("_invalidEdge", None)

    return node_map.values(), errors

    
