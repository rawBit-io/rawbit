# hex-to-flow — Bitcoin Core integration & automatic TX rebuild on canvas

Status: draft plan (2026-06-10) · Branch: `feature/hex-to-flow`

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
- Bitcoin Core is the source of truth: `getrawtransaction` /
  `decoderawtransaction` deliver the transaction and its field values.
- rawBit rebuilds each field on canvas and reassembles the original hex.
- **Legacy transactions first** (P2PKH / P2PK). SegWit and Taproot follow the
  same pattern later.
- Layout quality comes from reusing the hand-made lesson building blocks, not
  from generic auto-layout.

## 3. Steps

**Step 1 — node connection.**
rawBit can reach the local node, knows which network it is on (regtest first,
loud warning on mainnet), and can fetch a transaction together with the
previous transactions its inputs spend. Read-only access, safe by default.

**Step 2 — rebuild each field.**
From a fetched (or pasted) legacy transaction, rawBit generates a flow where
every serialization field is a node: version, inputs, outputs, scripts,
locktime. The fields feed the standard TX spine, the flow recomputes the hex,
and a visible check confirms it matches the original — including the txid.

**Step 3 — make it look hand-made.**
Generated flows use the same groups, colors, spacing and reading direction as
the lessons (funding → preimage → signature → final tx). The result should be
indistinguishable from a flow the author placed by hand.

**Step 4 — full signing reconstruction (optional).**
When the user provides the private key, the flow additionally rebuilds the
sighash preimage and the signature itself and shows that the recomputed
signature matches the one on the wire.

**Step 5 — simple entry point in the UI.**
Paste a txid or raw hex (or pick from the node), get the rebuilt flow as a new
tab. No friction.

## 4. How we know it works

- Every generated flow must recompute to the exact source bytes (automated
  golden tests against reference transactions).
- The proof is visible on canvas: txid match, signature match, script
  verification — students see it, not just CI.
- A generated reference flow is checked visually so layout quality does not
  regress.

## 5. Scope of this iteration

In: legacy P2PKH/P2PKH multi-in/out and P2PK, SIGHASH_ALL, local install.
Out (planned later): SegWit/Taproot, PSBT, large transactions, hosted-version
bridge, embedded terminal, automatic "new tx detected" watch, course chapter
mapping.

## 6. Open questions

1. Generated-flow style: grouped (p0/p01 style) or band style (p1–p16)?
2. Where does "Rebuild TX" live in the UI — TopBar, sidebar, or Help menu?
3. How does the user point rawBit at their node — config file, env, or a small
   settings dialog?
