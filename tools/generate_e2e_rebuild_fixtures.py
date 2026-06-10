#!/usr/bin/env python3
"""Generate real rebuilt-flow fixtures for the e2e render tests.

Runs the actual generator over three representative datasets and writes the
resulting flows to tests/e2e/fixtures/. Re-run after changing the builder:

    python3 tools/generate_e2e_rebuild_fixtures.py
"""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

from backend.flow_generator import assemble_dataset, generate_legacy_flow  # noqa: E402

OUT_DIR = ROOT / "tests" / "e2e" / "fixtures"
CORPUS = ROOT / "backend" / "tests" / "fixtures" / "legacy_corpus"
SIGN_FIXTURE = ROOT / "backend" / "tests" / "fixtures" / "rebuild_p2pkh_1in1out.json"


def write(name: str, flow: dict, txid: str) -> None:
    path = OUT_DIR / f"{name}.json"
    path.write_text(json.dumps({"flow": flow, "txid": txid}) + "\n")
    print(f"wrote {path} ({len(flow['nodes'])} nodes, {len(flow['edges'])} edges)")


def signing_flow() -> None:
    fix = json.loads(SIGN_FIXTURE.read_text())
    prev = {fix["vin"][0]["prev_txid"]: fix["vin"][0]["prev_tx_hex"]}
    dataset = assemble_dataset(fix["tx_hex"], prev, network="regtest")
    dataset["vin"][0]["privkey_hex"] = fix["vin"][0]["privkey_hex"]
    write("rebuilt_flow_sign_p2pkh", generate_legacy_flow(dataset), fix["txid"])


def mainnet_multi_input_flow() -> None:
    fix = json.loads((CORPUS / "mixed_4in_2016.json").read_text())
    dataset = assemble_dataset(fix["tx_hex"], fix["prev_txs"], network="mainnet")
    write("rebuilt_flow_wire_4in", generate_legacy_flow(dataset), fix["txid"])


def p2sh_multisig_signing_flow() -> None:
    from calc_functions.calc_func import (  # noqa: E402
        public_key_from_private_key,
        sign_as_bitcoin_core_low_r,
    )
    from test_legacy_builder import P2PKH_SPK, make_funding, make_tx, push  # noqa: E402

    keys = ["11" * 31 + "01", "33" * 31 + "03"]
    all_keys = [keys[0], "22" * 31 + "02", keys[1]]
    pubkeys = [public_key_from_private_key(k) for k in all_keys]
    redeem = (
        "52" + "".join(push(pk) for pk in pubkeys) + "53" + "ae"
    )
    h160 = hashlib.new(
        "ripemd160", hashlib.sha256(bytes.fromhex(redeem)).digest()
    ).hexdigest()
    spk = "a914" + h160 + "87"
    ftxid, fhex = make_funding([spk])
    vin = [(ftxid, 0, "", 0xFFFFFFFF)]
    vout = [(40_000, P2PKH_SPK)]
    preimage = make_tx([(ftxid, 0, redeem, 0xFFFFFFFF)], vout) + "01000000"
    digest = hashlib.sha256(
        hashlib.sha256(bytes.fromhex(preimage)).digest()
    ).hexdigest()
    sigs = [sign_as_bitcoin_core_low_r([k, digest]) + "01" for k in keys]
    scriptsig = "00" + "".join(push(s) for s in sigs) + push(redeem)
    tx_hex = make_tx([(ftxid, 0, scriptsig, 0xFFFFFFFF)], vout)
    dataset = assemble_dataset(tx_hex, {ftxid: fhex}, network="regtest")
    # one owned key, one foreign: mixes recreated and wire signatures
    dataset["vin"][0]["privkeys_by_pubkey"] = {pubkeys[0]: keys[0]}
    write(
        "rebuilt_flow_p2sh_ms_sign",
        generate_legacy_flow(dataset),
        dataset["txid"],
    )


if __name__ == "__main__":
    signing_flow()
    mainnet_multi_input_flow()
    p2sh_multisig_signing_flow()
