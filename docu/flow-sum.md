# Flow 1: Building and Signing Legacy Transactions (P2PKH, P2PK)

- Generate keypairs and derive standard P2PKH addresses.
- Build and sign a basic P2PKH spend: construct the sighash preimage and produce a valid ECDSA signature for the scriptSig.
- Spend to a legacy P2PK output and note the script differences vs. P2PKH.
- Create a multi‑output transaction (payment + change).
- Spend from multiple inputs in one transaction, signing each input with its own correct preimage.
- Verify each example by evaluating scriptSig + scriptPubKey to ensure it’s valid for broadcast.

# Flow 2: Multisig and P2SH

- Construct a 2‑of‑3 bare multisig (P2MS) locking script with public keys directly in the script.
- Fund the P2MS output from a standard P2PKH input.
- Build a separate 2‑of‑3 redeem script for P2SH.
- Create the P2SH output: `OP_HASH160 <redeemScriptHash> OP_EQUAL`.
- Spend from bare multisig using the required scriptSig format: `OP_0 <sig1> <sig2>` (the leading `OP_0` accounts for the CHECKMULTISIG quirk).
- Spend from the P2SH multisig by providing `<OP_0> <sigs…> <full redeemScript>` in the scriptSig, then pay back to a single‑sig output.

# Flow 3: Absolute and Relative Timelocks

- Absolute lock by block height: set `nLocktime` to a future height.
- Absolute lock by timestamp: set `nLocktime` to a Unix time (evaluated via Median Time Past).
- Relative lock by blocks: use BIP68 semantics in `nSequence` so the spend is valid only after N blocks since confirmation.
- Relative lock by time: use the time‑based BIP68 form (units of 512 seconds).
- Activation details: set at least one input’s `nSequence` to a value less than `0xffffffff`; relative timelocks require transaction version 2.
- Verification: transactions are valid but will be rejected as “non‑final” if broadcast before the lock expires.

# Flow 4: Script‑Level Locks and Simple Contracts (CLTV, CSV, Hashlocks)

- Implement `OP_CHECKLOCKTIMEVERIFY` (CLTV) in a P2SH script to enforce an absolute block‑height unlock while allowing immediate funding.
- Implement `OP_CHECKSEQUENCEVERIFY` (CSV) to enforce a confirmation‑relative delay (e.g., 10 blocks) for controlled “cold → hot” movement.
- Add conditional branches with `OP_IF / OP_ELSE` (e.g., owner spends immediately; heir waits for a timelock).
- Add a hashlock with `OP_HASH160` so spending requires revealing a preimage.
- Combine conditions (hashlock + CSV + branches) to build an HTLC‑style “digital goods” guarantee.
- Wrap complex scripts in P2SH and verify every spending path.

# Flow 5: OP_RETURN for On‑Chain Data

- Explain `OP_RETURN`: create a provably unspendable output to commit data to the chain.
- Convert a text string to hex and prepare it for push‑data encoding.
- Build the `OP_RETURN` scriptPubKey: `OP_RETURN <push opcode> <hex data>`.
- Include both a normal spendable output (e.g., P2PKH) and a zero‑value `OP_RETURN` output in the same transaction.
- Use a zero‑value for `OP_RETURN` outputs (standard relay policy). Any value sent there is effectively burned and cannot be recovered.
- Sign and verify the full transaction so it’s ready to broadcast and permanently commit the message once mined.

# Flow 6: Spilman (Unidirectional) Payment Channel

- Create a 2‑of‑2 multisig redeem script and its P2SH address for the channel (Alice + Bob).
- Prepare a refund transaction from the yet‑to‑be‑funded multisig back to Alice, using a relative timelock (`nSequence`/CSV) as a safety timeout.
- Have Bob verify and co‑sign the refund before any funds are committed.
- Fund the multisig on‑chain after the refund is secured.
- Make off‑chain payments by updating a “latest commitment” transaction that splits funds; Alice signs and sends it to Bob.
- Bob can complete the signature and broadcast the most recent commitment at any time before the timeout to settle on‑chain.

# Flow 7: Transaction Malleability (Pre‑SegWit) and the Fix

- Build a baseline valid P2PKH transaction and record its TXID.
- Create functionally identical variants by modifying the scriptSig with benign operations (e.g., `OP_NOP`, `OP_0 OP_DROP`, multiple `OP_NOP`s).
- Show that each variant changes the serialized bytes and thus produces a different TXID, despite spending the same input to the same output.
- Discuss why this broke protocols that chained unconfirmed TXIDs.
- Explain SegWit’s fix: signatures live in the witness (excluded from TXID), so the TXID is stable; the witness hash (wtxid) reflects witness changes.
- Verify that all variants are still valid under consensus rules, even though their TXIDs differ.

# Flow 8: Segregated Witness (SegWit) Transactions

- **Explain the SegWit soft-fork:** Demonstrate how a P2WPKH (Pay-to-Witness-Public-Key-Hash) output appears as "anyone-can-spend" to legacy nodes but is enforced by SegWit-aware nodes, which require a valid witness.
- **Build and sign a valid P2WPKH spend:** Construct the full BIP143 sighash preimage, which crucially includes the value of the output being spent to prevent fee attacks.
- **Create the Witness:** Move the signature and public key from the scriptSig into a separate witness structure appended to the end of the transaction.
- **Understand the new serialization format:** Assemble a transaction with the SegWit marker (`0x00`) and flag (`0x01`), an empty scriptSig for the witness input, and the witness data.
- **Fix transaction malleability:** Show that because the signature is no longer part of the data hashed to create the TXID, third-party signature malleability is eliminated, resulting in stable, predictable transaction IDs.
- **Handle complex transactions:** Construct and sign transactions with multiple SegWit inputs and outputs, correctly calculating the shared `hashPrevouts`, `hashSequence`, and `hashOutputs` fields for the sighash preimage.

# Flow 9: Advanced SegWit Scripts (P2WSH)

- **Fund a P2WSH output:** Create and sign a transaction that spends a standard P2WPKH input to fund the new P2WSH address.
- **Construct a P2WSH multisig:** Build a 2-of-3 `witnessScript` and derive its 32-byte `SHA256` hash to create a native SegWit multisignature output (`OP_0 <script_hash>`).
- **Spend a P2WSH multisig output:** Construct the correct witness, including the `NULLDUMMY` byte, the required number of signatures, and the full `witnessScript` as the final stack item.
- **Implement conditional logic with timelocks:** Create a complex inheritance script using `OP_IF`/`OP_ELSE` that allows an owner to spend immediately or an heir to spend only after a specific `OP_CHECKLOCKTIMEVERIFY` timelock has passed.
- **Spend from a conditional P2WSH script:** Provide the correct witness to satisfy a specific spending path, using either `OP_1` (for the `IF` path) or `OP_0` (for the `ELSE` path) as the selector, along with the required signature(s) and the full `witnessScript`.

# Flow 10: Fee Savings with Wrapped SegWit (P2SH-P2WPKH & P2SH-P2WSH)

This flow demonstrates the fee-saving advantages of Segregated Witness by conducting two similar transactions that compare legacy scripts with their modern "wrapped" SegWit equivalents. It highlights how these wrapped addresses provided a crucial, backward-compatible path for the network to adopt SegWit's efficiencies.

### Part 1: Single-Signature Savings (P2PKH vs. P2SH-P2WPKH)

This flow establishes a baseline for SegWit's benefits in the most common transaction type.

- **The Test:** A standard, legacy **P2PKH** transaction is compared against a **P2SH-wrapped P2WPKH** transaction.
- **The Mechanism:** In the wrapped version, the bulky signature and public key are moved from the `scriptSig` into a separate **witness** field, which receives a 75% fee discount. The `scriptSig` is reduced to a small pointer to this witness program.
- **The Result:** A significant fee reduction of approximately **30%**. This shows the fundamental efficiency gain for everyday transactions while using a legacy-compatible P2SH address.

### Part 2: Multi-Signature & Complex Script Savings (P2SH vs. P2SH-P2WSH)

This flow demonstrates that SegWit's advantages become even more pronounced as script complexity increases.

- **The Test:** A legacy **2-of-3 P2SH multisig** spend is compared against a **P2SH-wrapped P2WSH** spend for the same 2-of-3 policy.
- **The Mechanism:** The savings are amplified. Not only are the multiple signatures moved to the discounted witness field, but the **entire 105-byte multisig script (`witnessScript`)** is also moved. In the legacy version, this large script had to be included in the costly `scriptSig`.
- **The Result:** A dramatic fee reduction of over **46%**. This proves that P2WSH is vastly more efficient for smart contracts, multisig, and other complex transactions than its P2SH predecessor

# Flow 11: Taproot Key-Path Spends

- Taproot combines three BIPs: BIP340 (Schnorr), BIP341 (P2TR), BIP342 (Tapscript).
- Generate a key, normalize to even‑Y, and derive the 32‑byte x‑only pubkey.
- Tweak it: `Q = P + tagged_hash("TapTweak", P) · G` → bech32m address.
- Build the BIP341 sighash (commits to all inputs’ amounts and scriptPubKeys).
- Sign with the tweaked privkey → 64‑byte Schnorr signature; witness = `[signature]`.
- Also covers multi‑input signing, soft‑fork compatibility, and the BIP86 proof‑of‑no‑scripts.

# Flow 12: Taproot Script-Path Spends

Flow 11 used key-path — just a signature. Now we add scripts.

This flow builds a 3-leaf inheritance tree and spends via script-path:

1. Create tapleaves (tagged hash of version + script)
2. Build Merkle tree (sort siblings, hash branches)
3. Tweak internal key with merkle root → output key Q
4. Spend: reveal one script + control block + merkle proof
5. Other leaves stay hidden forever

Covers: control block parity, script-path sighash (SPEND_TYPE = 02).

# Flow 13: Taproot Multisig

## What We Built

**Flow 1** — Locked coins to a 2-of-3 multisig address using:

- NUMS internal key (disables key-path — nobody can bypass the script)
- OP_CHECKSIGADD threshold script (any 2 of 3 signers)

**Flow 2** — Spent with Bob + Charlie (Alice absent):

- Signatures in REVERSE order of pubkeys in script
- Missing signer = empty byte vector (not OP_0)
- Witness: 271 bytes (2 sigs + empty + script + control block)

## Key Takeaway

The internal key is a spending condition, not just metadata. Whoever controls it can bypass all scripts. NUMS ensures nobody has that power.

## What's Different from Legacy Multisig

OP_CHECKSIGADD replaces OP_CHECKMULTISIG — each signature maps to exactly one pubkey. No dummy element bug, no guessing which sig matches which key.

# Flow 14: MuSig2 Key-Path Multisig (BIP327)

## N-of-N: When Everyone Must Agree

Some Bitcoin setups require all parties to sign every spend:
joint custody between partners, corporate treasury, or
Lightning channels where both sides agree on every state update.

For these n-of-n cases, Taproot offers something powerful:
aggregate all keys into one output key with MuSig2, spend via
key-path. One signature, 64 bytes, nothing revealed on-chain.
Indistinguishable from a single-signer spend — compared to
~271 bytes and full policy disclosure with CHECKSIGADD (L13).

For fallback — someone unavailable — define script leaves with
smaller quorums, timelocks, or recovery keys (see previous flow examples).
None visible unless used.

## Why It Works

Schnorr signatures have a property called linearity: partial
signatures from multiple signers can be summed into one valid
signature for the aggregate key — without anyone ever knowing
that key's private key. Each signer uses only their own secret.

ECDSA doesn't have this property — which is why MuSig2
requires Schnorr (BIP340) and wasn't possible before Taproot.

## Drawbacks

All signers must be online together for two interactive rounds.
If anyone drops out mid-session, it restarts. CHECKSIGADD
signers act independently — no coordination needed.

Each signing session requires fresh random nonces — generated,
used once, destroyed. Nonce reuse across different transactions can expose the signer's private key (see Exercise 2 below).

## What This Flow Builds

A complete 3-of-3 MuSig2 key-path spend in six stages:

    SIGNERS → KEYAGG → PREIMAGE → ROUND 1 → ROUND 2 → TRANSACTION
