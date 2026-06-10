#!/usr/bin/env python3
"""Fetch a mainnet transaction + its funding txs as a rebuild-corpus fixture.

Usage:
    python3 tools/fetch_legacy_fixture.py <txid> <name> [out_dir]

Writes ``<out_dir>/<name>.json`` (default backend/tests/fixtures/legacy_corpus)
with {name, network, txid, tx_hex, prev_txs} — everything the offline golden
tests need to rebuild the transaction without a node. Rejects transactions
with witness data: the corpus is legacy-only by design.
"""

import json
import sys
import urllib.request
from pathlib import Path

API = "https://blockstream.info/api"


def fetch(path: str) -> str:
    with urllib.request.urlopen(f"{API}{path}", timeout=30) as resp:
        return resp.read().decode()


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    txid, name = sys.argv[1], sys.argv[2]
    out_dir = Path(
        sys.argv[3]
        if len(sys.argv) > 3
        else Path(__file__).resolve().parents[1]
        / "backend"
        / "tests"
        / "fixtures"
        / "legacy_corpus"
    )

    tx_hex = fetch(f"/tx/{txid}/hex").strip()
    if tx_hex[8:12] == "0001":
        print(f"refusing {txid}: segwit-serialized (corpus is legacy-only)")
        return 1
    decoded = json.loads(fetch(f"/tx/{txid}"))

    prev_txs: dict[str, str] = {}
    for vin in decoded["vin"]:
        if vin.get("is_coinbase"):
            continue
        prev_txid = vin["txid"]
        if prev_txid not in prev_txs:
            prev_txs[prev_txid] = fetch(f"/tx/{prev_txid}/hex").strip()

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{name}.json"
    out_path.write_text(
        json.dumps(
            {
                "name": name,
                "network": "mainnet",
                "txid": txid,
                "tx_hex": tx_hex,
                "prev_txs": prev_txs,
            },
            indent=1,
        )
        + "\n"
    )
    print(
        f"wrote {out_path} ({len(decoded['vin'])} in / {len(decoded['vout'])} out, "
        f"{len(prev_txs)} funding txs)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
