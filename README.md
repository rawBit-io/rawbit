# rawBit

_A powerful, node-based visual editor for constructing and understanding Bitcoin transactions._

Drag and drop nodes on a canvas to build transactions visually — no coding knowledge required for most flows. At the same time, rawBit is built for power users who want to inspect the exact code behind every node and step through Bitcoin Script execution opcode by opcode.

**Try rawBit online:** [rawbit.io](https://rawbit.io) | **Run locally:** [Quick start](#quick-start-local)

## Flow Examples

rawBit ships with **16 hands-on example flows** that you can instantly load, tweak, and inspect.  
Just drag any flow from the sidebar’s **Flow Examples** section onto the canvas and start exploring.

Flows 1–14 progress from legacy transactions through SegWit and Taproot.  
Flows 15–16 cover standalone hardware-signing and contributor labs.

- **Flows 1–2:** P2PKH, P2PK, multisig, and P2SH fundamentals
- **Flows 3–4:** Timelocks (nLockTime / nSequence), CLTV/CSV patterns
- **Flows 5–6:** OP_RETURN anchors, Spilman payment channel
- **Flow 7:** Pre-SegWit malleability (why TXIDs changed)
- **Flow 8:** SegWit P2WPKH (BIP143 preimage, witness)
- **Flow 9:** SegWit P2WSH (multisig & conditional scripts)
- **Flow 10:** Fee savings: wrapped SegWit vs legacy
- **Flow 11:** Taproot key-path spend (P2TR, Schnorr)
- **Flow 12:** Taproot script-path spend (taptree, control block, tapscript)
- **Flow 13:** Taproot script-path multisig (NUMS + OP_CHECKSIGADD)
- **Flow 14:** MuSig2 multisig (BIP327, aggregated Schnorr)
- **Flow 15:** Trezor signing flow (BIP39/BIP32, RFC6979, hardware signing comparison)
- **Flow 16:** Summer of Bitcoin 2026 PoC flow

All flow transactions were broadcast on **testnet3/4**, so you can inspect them on-chain and compare the raw bytes yourself.

---

![rawBit editor screenshot](docu/overview.png)

---

## What rawBit does

- **Build complete transaction flows** — Assemble inputs, outputs, keys, scripts, signatures, witnesses, hashes, and serialization steps directly on the canvas.
- **Live updates on every change** — Modify keys, amounts, scripts, or witness data and instantly watch preimages, signatures, TXID/WTXID, fees, and weight recalculate in real time.
- **Inspect the exact code** — Click any calculation node to see the precise Python function that powers its result.
- **Integrated Script debugger** — Step through Bitcoin Script opcode by opcode, watch the stack change live, and instantly spot validation failures.
- **Powerful canvas tools** — Organize complex flows with groups, tabs, templates, clipboard, undo/redo history, search and minimap
- **Learn with built-in flows** — Explore P2PKH, P2SH, SegWit, Taproot, MuSig2, hardware signing, and contributor flows.
- **Export and share** — Save/load full graphs, create share links, export selected nodes, or generate LLM-ready bundles that include the backend code.

---

## Who is this for?

Educators, auditors, and protocol-curious developers who want to understand Bitcoin transactions at the **byte and script** level.

### Non-goals

rawBit is **not** a wallet, broadcaster, or custody tool. Keep real funds out of it.

> ⚠️ **Educational use only.** rawBit can assemble mainnet-valid transactions, but you **should not** broadcast them or handle real funds with this tool. Use **testnet** or **regtest** for anything you intend to send.

> 🌐 **Hosted [rawBit](https://rawbit.io) currently needs to send calculation data to the backend.** Users who require "nothing leaves my machine" should use the [local install](#quick-start-local).

---

## Prerequisites

- Node.js **18+**
- npm
- Python **3.12+** with `pip` (backend depends on the forked `python-bitcointx`)
- C compiler toolchain + `libsecp256k1` headers

---

## Quick start (local)

```bash
git clone https://github.com/rawBit-io/rawbit
cd rawbit

# 1) Frontend
npm install
npm run dev                    # Vite dev server → http://localhost:3041/

# 2) Backend (new terminal)
python3 -m venv .myenv
source .myenv/bin/activate     # Windows: .myenv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-special.txt
python3 backend/routes.py      # Flask API → http://localhost:5007/
```

Open [http://localhost:3041/](http://localhost:3041/). The frontend bundles flows from `src/my_tx_flows/` and sends calculations to `http://localhost:5007/bulk_calculate`. The backend also exposes `/flows`, `/code`, and `/healthz`.

> The backend uses a forked **python-bitcointx** pinned in `requirements-special.txt`. A virtualenv keeps those bindings isolated.

### Optional: environment tweaks

The tracked `.env` file provides local defaults for the app and tests. For private overrides, use shell environment variables or an ignored `*.local` env file such as `.env.development.local`. Local dev pages force remote API URLs back to `http://localhost:5007` unless `VITE_ALLOW_REMOTE_API=true`.

---

## Architecture (at a glance)

- **Frontend:** React + Vite + Tailwind + `@xyflow/react`. Handles the canvas, tabs, panels, templates, clipboard, search/minimap, and per-tab undo/redo.
- **Backend:** Flask + Python (with `python-bitcointx`). Evaluates calculation nodes, validates scripts/signatures, enforces a sliding computation-time budget, and exposes `/bulk_calculate`, `/flows`, `/code`, and `/healthz`.

See `/docu` for the deeper tours:

- [frontend-architecture.md](docu/frontend-architecture.md) – provider stack, hooks, canvas/panels/dialogs.
- [backend-overview.md](docu/backend-overview.md) – calculation pipeline, budgets, and API surface.

---

## Testing

```bash
# Frontend lint, typecheck & unit/integration
npm run lint
npm run typecheck
npm run test

# E2E (first run only: downloads browsers)
npx playwright install
npm run test:e2e

# Backend tests
source .myenv/bin/activate
python -m pytest backend/tests

# One command for everything (lint + typecheck + frontend + E2E + backend)
python3 run_all_tests.py        # add --e2e-browsers=all for FF/WebKit too
```

---

## Contributing

rawBit is a visual lab for Bitcoin transactions. The most useful contributions are **flows** that help others understand how things work.
For a broader list of possible contribution directions, see [docu/contribute.md](docu/contribute.md).
Community discussion: [Discord](https://discord.gg/HPSYkT9tq).

### Flows

- Lightning Network
- CoinJoin
- Mining and block construction
- Cross-chain swaps
- Covenant proposals

Keep flows small and focused on one concept.

### Code & bugs

Bug reports and fixes are welcome. We keep features minimal—changes should directly improve understanding or teaching of Bitcoin concepts.

---

## License

- **Code:** MIT (`LICENSE`)
- **Docs/tutorials:** CC BY 4.0 (`LICENSE-docs`)
