"""Golden corpus: real mainnet transactions rebuild byte-for-byte.

Fixtures live in ``fixtures/legacy_corpus`` (fetched once with
``tools/fetch_legacy_fixture.py``). Every one must survive the full
pipeline — dataset assembly, flow generation, engine recalculation — and
reproduce the exact wire bytes and txid on canvas.
"""

import json
from pathlib import Path

import pytest

pytest.importorskip("bitcointx")

from backend.flow_generator import assemble_dataset, generate_legacy_flow

CORPUS_DIR = Path(__file__).resolve().parent / "fixtures" / "legacy_corpus"
CORPUS = sorted(CORPUS_DIR.glob("*.json"))


def _by_title(flow):
    out = {}
    for n in flow["nodes"]:
        d = n.get("data") or {}
        out.setdefault(d.get("title", ""), []).append(d)
    return out


@pytest.fixture(scope="module", params=CORPUS, ids=lambda p: p.stem)
def corpus_flow(request):
    fix = json.loads(request.param.read_text())
    dataset = assemble_dataset(
        fix["tx_hex"], fix["prev_txs"], network=fix["network"]
    )
    flow = generate_legacy_flow(dataset)
    return fix, dataset, flow


def test_corpus_count():
    assert len(CORPUS) >= 6, "legacy corpus fixtures are missing"


def test_rebuilds_byte_for_byte(corpus_flow):
    fix, _dataset, flow = corpus_flow
    titles = _by_title(flow)
    assert titles["Final Raw Transaction"][0]["result"] == fix["tx_hex"]
    assert titles["Rebuilt bytes match original?"][0]["result"] == "true"
    assert titles["TXID matches?"][0]["result"] == "true"


def test_txid_is_the_known_one(corpus_flow):
    fix, dataset, _flow = corpus_flow
    assert dataset["txid"] == fix["txid"]


def test_every_standard_input_verifies_on_canvas(corpus_flow):
    """Real wire signatures must pass script verification — historical ones
    via the automatic standardness relaxation (noted on the info card)."""
    _fix, dataset, flow = corpus_flow
    verdicts = [
        d["result"]
        for n in flow["nodes"]
        if (d := n.get("data") or {}).get("title", "").startswith("Verify Script")
    ]
    expected = sum(
        1
        for inp in dataset["vin"]
        if not inp.get("coinbase")
        and inp.get("prev_spk_type")
        in ("pubkeyhash", "pubkey", "multisig", "scripthash")
    )
    assert len(verdicts) == expected
    assert verdicts == ["true"] * expected


def test_info_card_names_every_input_and_output(corpus_flow):
    fix, dataset, flow = corpus_flow
    cards = [n for n in flow["nodes"] if n["type"] == "shadcnTextInfo"]
    assert len(cards) == 1
    content = cards[0]["data"]["content"]
    assert fix["txid"] in content
    for i in range(len(dataset["vin"])):
        assert f"Input {i}:" in content
    for j in range(len(dataset["vout"])):
        assert f"Output {j}:" in content


def test_outputs_without_address_show_script(corpus_flow):
    _fix, dataset, flow = corpus_flow
    content = next(
        n for n in flow["nodes"] if n["type"] == "shadcnTextInfo"
    )["data"]["content"]
    for j, out in enumerate(dataset["vout"]):
        if not out.get("address"):
            assert out["scriptpubkey"][:40] in content
