# hex-to-flow — Bitcoin Core integration & automatic TX rebuild on canvas

Status: implemented for legacy transactions (2026-06-10) · Branch: `feature/hex-to-flow`

## 1. What we want to achieve

rawBit connects to the user's locally installed Bitcoin Core node. A user picks
any transaction from their node and rawBit rebuilds it automatically on the
canvas — every field as a node, properly grouped and placed, looking like a
hand-made lesson. The rebuilt flow recomputes the transaction and arrives at
the **exact same bytes** the node returned: the canvas proves itself.

Long-term: Bitcoin CLI cohort courses run on local regtest nodes. When every
transaction a student creates in their course can be opened and explored byte
by byte in rawBit, rawBit becomes the visual companion to those courses.

## 2. Approach

- rawBit's backend talks to the node over JSON-RPC (a browser cannot reach
  bitcoind directly). Local install first; hosted rawbit.io comes later.
- Bitcoin Core is the parser of record: `getrawtransaction` /
  `decoderawtransaction` deliver the transaction and its field values.
- A **general flow builder** (`backend/flow_generator/`) stamps the same
  building blocks the hand-made lessons use — field constants, byte
  transforms, per-input preimage spines with the lesson sentinels, the TX
  spine, script verification — sized to whatever transaction comes in
  (N inputs / M outputs, capped at 10/10 for canvas sanity).
- Every input is rebuilt in the richest mode its data supports and downgraded
  independently until the bytes match:
  - **sign** — the spending key is derivable from the regtest wallet's
    descriptors: the flow rebuilds the sighash preimage and re-signs with
    Core's low-R/RFC6979 algorithm. The signature is *recreated*, not pasted.
    Covers P2PKH, P2PK, and multisig (bare + P2SH, per co-signer key).
  - **wire** — signatures/pubkeys/redeemScripts are decomposed into labelled
    constants taken from the wire (works on any chain, no keys involved).
  - **raw** — the scriptSig as one wire constant (nonstandard scripts,
    non-minimal pushes, coinbase).
- The proof is on the canvas: the rebuilt hex and txid are compared against
  the originals with `compare_equal` nodes, and each standard input carries a
  `script_verification` node. Historical signatures (high-S, pre-BIP66) verify
  via automatic standardness-only flag relaxation, noted on the info card.
- The backend never returns a flow that does not reproduce the source bytes:
  the whole graph is recalculated through the real engine and gated on byte
  equality before it leaves `/bitcoin/rebuild`.
- Outputs without an address (P2PK, bare multisig, OP_RETURN, nonstandard)
  show their scriptPubKey instead.

## 3. What shipped

**Node connection** — Bitcoin Core CLI console panel (TopBar terminal icon):
status, chain warning, command console. Endpoints are loopback-only and
disabled on hosted deployments (`backend/bitcoin_rpc.py`, `/bitcoin/*` routes).

**Rebuild on canvas** — paste a txid or raw hex in the panel (or click an
incoming-transaction chip): the backend assembles the dataset
(`rebuild.py` → `dataset.py`), generates the flow (`legacy_builder.py` +
`flow_builder.py`), and the frontend opens it in a new tab, with the viewport
anchored on the info card.

**Signing reconstruction** — on regtest, keys are derived from the wallet's
descriptors (single-sig and multisig co-signer keys); recreated signatures are
byte-identical to Core's (proven against a live-wallet fixture).

**Incoming-transaction watch** — while the panel is open on regtest, new
wallet/mempool transactions surface as one-click "rebuild" chips
(`listsinceblock` + `getrawmempool` polling).

## 4. How we know it works

- Golden tests recompute every generated flow through the real calc engine
  and assert byte equality: a synthetic shape matrix
  (`test_legacy_builder.py`), real mainnet transactions including block-170
  P2PK and a 4-input mixed spend (`test_legacy_corpus.py`,
  fixtures via `tools/fetch_legacy_fixture.py`), and signing-mode suites
  (`test_legacy_signing.py`, `test_legacy_multisig_signing.py`).
- Render verification: `tests/e2e/bitcoin.rebuild.render.spec.ts` opens real
  generated flows (fixtures via `tools/generate_e2e_rebuild_fixtures.py`)
  and asserts every node renders without overlaps.
- The proof is visible on canvas: txid match, byte match, script verification.

## 5. Out of scope (planned later)

SegWit/Taproot rebuilds, PSBT, transactions beyond 10 inputs/outputs,
non-SIGHASH_ALL signing reconstruction (wire mode covers those inputs),
hosted-version bridge, course chapter mapping.
