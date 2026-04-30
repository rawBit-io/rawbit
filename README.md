# rawBit

_rawBit is a visual, node-based editor for constructing Bitcoin transactions and understanding how they are validated. Build transactions from inputs, keys, scripts, signatures, hashes, and witnesses, then step through Bitcoin Script execution opcode by opcode._

**Try rawBit online:** [rawbit.io](https://rawbit.io) | **Run locally:** [Quick start](#quick-start-local)

## Flow Examples

rawBit ships with **16 hands-on example lessons** you can load, tweak, and inspect. Drop a lesson from the sidebar's **Flow Examples** section onto the canvas and start learning. Lessons 1-14 progress from legacy transactions through SegWit and Taproot; lessons 15-16 add standalone hardware-signing and contributor labs.

- **Lessons 1–2:** P2PKH, P2PK, multisig, and P2SH fundamentals
- **Lessons 3–4:** Timelocks (nLockTime / nSequence), CLTV/CSV patterns
- **Lessons 5–6:** OP_RETURN anchors, Spilman payment channel
- **Lesson 7:** Pre-SegWit malleability (why TXIDs changed)
- **Lesson 8:** SegWit P2WPKH (BIP143 preimage, witness)
- **Lesson 9:** SegWit P2WSH (multisig & conditional scripts)
- **Lesson 10:** Fee savings: wrapped SegWit vs legacy
- **Lesson 11:** Taproot key-path spend (P2TR, Schnorr)
- **Lesson 12:** Taproot script-path spend (taptree, control block, tapscript)
- **Lesson 13:** Taproot script-path multisig (NUMS + OP_CHECKSIGADD)
- **Lesson 14:** MuSig2 multisig (BIP327, aggregated Schnorr)
- **Lesson 15:** Trezor signing flow (BIP39/BIP32, RFC6979, hardware signing comparison)
- **Lesson 16:** Summer of Bitcoin 2026 PoC flow

The lesson transactions were broadcast on **testnet3**, so you can inspect them on-chain and compare the raw bytes yourself.

**Lesson notes:** [docu/l-sum.md](docu/l-sum.md) summarizes all 16 lessons.

---

![rawBit editor screenshot](docu/overview.png)

---

## What rawBit does

- **Build complete transaction flows:** Assemble inputs, outputs, keys, scripts, signatures, witnesses, hashes, and serialization steps on a canvas.
- **Edit inputs and watch results update:** Change keys, amounts, scripts, or witness data and see preimages, signatures, TXID/WTXID recalculate.
- **Inspect the backend logic:** Open any calculation node to see the exact Python function that produced its result.
- **Debug Bitcoin Script execution:** Step through opcodes, stack changes, and validation failures with the integrated debugger.
- **Use powerful canvas tools:** Organize and explore Bitcoin flows with groups, tabs, templates, clipboard, history, search, minimap, and the protocol flow map.
- **Learn through built-in lessons:** Explore P2PKH, P2SH, SegWit, Taproot, MuSig2, hardware signing, and contributor challenge flows.
- **Export and share your work:** Save/load full graphs, create share links, export selected nodes, or generate LLM-ready bundles with backend code.

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

Open [http://localhost:3041/](http://localhost:3041/). The frontend bundles lesson flows from `src/my_tx_flows/` and sends calculations to `http://localhost:5007/bulk_calculate`. The backend also exposes `/flows`, `/code`, and `/healthz`.

> The backend uses a forked **python-bitcointx** pinned in `requirements-special.txt`. A virtualenv keeps those bindings isolated.

### Optional: environment tweaks

The tracked `.env` file provides local defaults for the app and tests. For private overrides, use shell environment variables or an ignored `*.local` env file such as `.env.development.local`. Local dev pages force remote API URLs back to `http://localhost:5007` unless `VITE_ALLOW_REMOTE_API=true`.

---

## Architecture (at a glance)

- **Frontend:** React + Vite + Tailwind + `@xyflow/react`. Handles the canvas, tabs, panels, templates, clipboard, protocol flow map, search/minimap, and per-tab undo/redo.
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

rawBit is a visual lab for Bitcoin transactions. The most useful contributions are **flows and lessons** that help others understand how things work.
For a broader list of possible contribution directions, see [docu/contribute.md](docu/contribute.md).
Community discussion: [Discord](https://discord.gg/HPSYkT9tq).

### Flows and lessons

- Lightning Network
- CoinJoin
- PSBT
- Miniscript
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
