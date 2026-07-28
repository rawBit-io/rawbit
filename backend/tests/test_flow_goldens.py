"""Golden-corpus regression tests for every saved lesson flow.

The committed lesson JSONs persist computed node results in ``data.result``
(and script traces in ``data.scriptDebugSteps``), so the files themselves are
goldens: recalculating a flow with bulk_calculate_logic must reproduce the
committed values byte-for-byte. Any divergence means a calculation regression
(or an intentional backend change, in which case refresh the goldens).

Refresh mode: run with ``UPDATE_FLOW_GOLDENS=1`` to rewrite stale
``data.result`` / ``data.scriptDebugSteps`` values in the lesson JSONs with
freshly calculated ones (formatting preserved). The test then fails on
purpose so the rewritten diff gets reviewed before committing.
"""

import copy
import json
import os
from pathlib import Path

import pytest

pytest.importorskip("bitcointx")
pytest.importorskip("secp256k1")
pytest.importorskip("ecdsa")

from flow_test_utils import (
    FLOW_DIR,
    load_flow,
    rewrite_committed_node_outputs,
    run_flow,
)

UPDATE_FLOW_GOLDENS = os.environ.get("UPDATE_FLOW_GOLDENS") == "1"

# Functions whose output is inherently nondeterministic (fresh entropy per
# call — see secrets.token_bytes in calc_func.random_256). Saved flows keep
# their cached value via hasRegenerate, but never pin these as goldens.
NONDETERMINISTIC_FUNCTIONS = {"random_256"}

# Flows that are never evaluated against their committed goldens.
# (Currently empty; nodeless placeholders like misc/empty.json are already
# excluded by the _discover_flows nodes check.)
SKIPPED_FLOWS: dict[str, str] = {}

# Committed values that predate backend changes and no longer reproduce.
# Every entry is a known-stale golden, kept on purpose until the lesson files
# are refreshed (UPDATE_FLOW_GOLDENS=1) — do NOT add entries to silence new
# regressions in visible lessons.
#
# 2026-07-28: the entire stale backlog was refreshed in one batch alongside
# the taproot trace-granularity rework (control_block_extract row, explicit
# witness_script pop, passthrough stacks on the commitment check), so both
# allowlists are empty. Keep them that way.
STALE_RESULT_NODES: dict[str, set[str]] = {}
STALE_STEPS_NODES: dict[str, set[str]] = {}


def _flow_key(path: Path) -> str:
    return path.relative_to(FLOW_DIR).as_posix()


def _discover_flows():
    paths = (
        sorted(FLOW_DIR.glob("*.json"))
        + sorted((FLOW_DIR / "misc").glob("*.json"))
    )
    flows = []
    for path in paths:
        if _flow_key(path) in SKIPPED_FLOWS:
            continue
        if not json.loads(path.read_text()).get("nodes"):
            continue
        flows.append(path)
    return flows


FLOW_PATHS = _discover_flows()


def _truncate(value, limit=100):
    text = repr(value)
    return text if len(text) <= limit else text[: limit - 3] + "..."


@pytest.mark.parametrize("flow_path", FLOW_PATHS, ids=_flow_key)
def test_flow_reproduces_committed_goldens(flow_path):
    flow_key = _flow_key(flow_path)
    stale_results = STALE_RESULT_NODES.get(flow_key, set())
    stale_steps = STALE_STEPS_NODES.get(flow_key, set())

    nodes, edges = load_flow(flow_path)
    committed_results = {}
    committed_steps = {}
    function_names = {}
    for node in nodes:
        data = node["data"]
        function_names[node["id"]] = data["functionName"]
        result = data.get("result")
        if isinstance(result, str) and result:
            committed_results[node["id"]] = result
        if data.get("scriptDebugSteps") is not None:
            committed_steps[node["id"]] = copy.deepcopy(data["scriptDebugSteps"])

    recalced, errors = run_flow(nodes, edges)
    assert errors == [], f"{flow_key}: recalculation reported errors: {errors}"

    mismatches = []  # (node_id, key, committed, recalculated, allowlisted)
    for node_id, committed in committed_results.items():
        if function_names[node_id] in NONDETERMINISTIC_FUNCTIONS:
            continue
        actual = recalced[node_id]["data"].get("result")
        if actual != committed:
            mismatches.append(
                (node_id, "result", committed, actual, node_id in stale_results)
            )
    for node_id, committed in committed_steps.items():
        actual = recalced[node_id]["data"].get("scriptDebugSteps")
        if actual != committed:
            mismatches.append(
                (
                    node_id,
                    "scriptDebugSteps",
                    "<committed trace>",
                    "<recalculated trace differs>",
                    node_id in stale_steps,
                )
            )

    if UPDATE_FLOW_GOLDENS:
        updates = {}
        for node_id, key, _, _, _ in mismatches:
            fresh = recalced[node_id]["data"].get(
                "result" if key == "result" else "scriptDebugSteps"
            )
            if fresh is None:
                continue
            updates.setdefault(node_id, {})[key] = fresh
        if updates:
            rewritten = rewrite_committed_node_outputs(flow_path, updates)
            pytest.fail(
                f"UPDATE_FLOW_GOLDENS=1: refreshed {len(rewritten)} committed "
                f"value(s) in {flow_path}. Review the diff, drop any stale "
                "allowlist entries in test_flow_goldens.py, and re-run "
                "without UPDATE_FLOW_GOLDENS."
            )
        return

    unexpected = [m for m in mismatches if not m[4]]
    if unexpected:
        lines = [
            f"{flow_key}: {len(unexpected)} committed golden value(s) no longer "
            "reproduce (calculation regression, or refresh the lesson via "
            "UPDATE_FLOW_GOLDENS=1):"
        ]
        for node_id, key, committed, actual, _ in unexpected:
            lines.append(
                f"  {node_id} [{function_names[node_id]}] {key}: "
                f"committed={_truncate(committed)} recalculated={_truncate(actual)}"
            )
        pytest.fail("\n".join(lines))

    # The allowlists must shrink, never linger: drop entries that reproduce.
    healed_results = stale_results - {
        node_id for node_id, key, *_ in mismatches if key == "result"
    }
    healed_steps = stale_steps - {
        node_id for node_id, key, *_ in mismatches if key == "scriptDebugSteps"
    }
    assert not healed_results and not healed_steps, (
        f"{flow_key}: allowlisted nodes now reproduce their committed values; "
        f"remove them from STALE_RESULT_NODES/STALE_STEPS_NODES: "
        f"{sorted(healed_results | healed_steps)}"
    )


# ───────────────────────────────────────────────────────────────
#  cross-contamination guards (module-level caches / sentinels)
# ───────────────────────────────────────────────────────────────
# Real bugs of this class existed: a stale _cycle sentinel, an unbounded
# _TAG_HASH_CACHE, and the lru tx-deserialization cache. A flow calculation
# must never change the outcome of another (or a repeated) calculation.
TAPROOT_MUSIG_FLOW = FLOW_DIR / "p19_MuSig2.json"
LEGACY_FLOW = FLOW_DIR / "p0_Intro_P2PKH.json"


def _calc_snapshot(node_map):
    return {
        node_id: (
            node["data"].get("result"),
            node["data"].get("scriptDebugSteps"),
            node["data"].get("outputValues"),
        )
        for node_id, node in node_map.items()
    }


def test_recalculating_same_flow_twice_is_idempotent():
    nodes, edges = load_flow(TAPROOT_MUSIG_FLOW)
    first, first_errors = run_flow(nodes, edges)
    second, second_errors = run_flow(nodes, edges)
    assert first_errors == [] and second_errors == []
    assert _calc_snapshot(first) == _calc_snapshot(second), (
        "Recalculating the same flow twice in one process produced different "
        "results; some module-level cache or sentinel leaks state between runs"
    )


def test_taproot_flow_does_not_leak_state_into_legacy_flow():
    legacy_nodes, legacy_edges = load_flow(LEGACY_FLOW)
    committed = {
        node["id"]: (
            node["data"].get("result"),
            copy.deepcopy(node["data"].get("scriptDebugSteps")),
        )
        for node in legacy_nodes
        if node["data"]["functionName"] not in NONDETERMINISTIC_FUNCTIONS
    }

    baseline, baseline_errors = run_flow(legacy_nodes, legacy_edges)
    assert baseline_errors == []

    taproot_nodes, taproot_edges = load_flow(TAPROOT_MUSIG_FLOW)
    _, taproot_errors = run_flow(taproot_nodes, taproot_edges)
    assert taproot_errors == []

    after, after_errors = run_flow(legacy_nodes, legacy_edges)
    assert after_errors == []

    assert _calc_snapshot(after) == _calc_snapshot(baseline), (
        "Calculating a taproot/MuSig2 flow changed the results of a "
        "subsequently calculated legacy flow (cross-flow state leak)"
    )
    for node_id, (result, steps) in committed.items():
        data = after[node_id]["data"]
        assert data.get("result") == result, node_id
        assert data.get("scriptDebugSteps") == steps, node_id
