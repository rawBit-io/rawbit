# Educational review — all 8 visible lessons (2026-07-02)

**Method:** one reviewer per lesson re-derived every protocol claim and every concrete byte against the flow's own computed nodes, the backend implementation, and (where relevant) live testnet4; each blocker/warning finding was then handed to an independent adversarial checker. Only what survived is reported below.

## Headline verdict

**The byte-level teaching is exceptionally trustworthy — zero factual blockers in ~60 verified claims across all eight lessons.** Signatures re-verify cryptographically, preimages recompute byte-for-byte, txids match live testnet4 confirmations, and the hard consensus-vs-policy distinctions (the classic way Bitcoin education goes wrong) are almost everywhere correct. Where the set needs work is **exercise executability** (five confirmed cases where following the instructions produces the *opposite* of the promised result) and **story shape** (a recurring front-loaded-intro / unnarrated-middle / missing-payoff pattern).

| # | Lesson | Text nodes | Factual | Story | Exercises |
|---|---|---|---|---|---|
| 0 | Intro P2PKH | 9 | ✅ clean (5 nits) | **8**/10 | **8**/10 |
| 1 | P2PK vs P2PKH | 3 | ✅ clean (4 nits) | 6/10 | 6/10 |
| 2 | P2PKH Multi-Input | 2 | ✅ spotless (3 nits) | 5/10 | 4/10 |
| 3 | Bare Multisig | 3 | ✅ clean (1 warn, 3 nits) | 6/10 | 7/10 |
| 4 | P2SH & Timelocks | 7 | ✅ clean (2 warn, 9 nits) | 7/10 | 5/10 |
| 5 | P2SH + OP_RETURN | 6 | ✅ clean (2 warn, 6 nits) | 6/10 | 7/10 |
| 6 | TX Malleability | 5 | ✅ clean (3 warn, 2 nits) | **8**/10 | 5/10 |
| 7 | Picture in P2SH (BIP110) | 4 | ✅ clean (2 warn, 6 nits) | 6/10 | 5/10 |

---

## Per-lesson findings

### p0 — Intro P2PKH (the strongest lesson)

**Verified:** address Base58Check round-trip, P2PKH template, the full preimage→sighash→signature chain (ECDSA independently re-verified; low-R/low-S DER), varint/push tables against the backend, and **both transactions live-confirmed on testnet4** (heights 133790/133798). An entry lesson whose every claim is checkable against real broadcast bytes is rare and valuable.

**Issues (all nits):**

- "nothing can be changed after signing" is overbroad — the scriptSig isn't committed, which is literally p6's topic (soften + forward-pointer). (`node_8ob6g1f`)
- The Encoding Primitives node misattributes `Uint32 → LE-4` to sequence/sighash — actually `4-Byte → Reversed` and `Sighash Type → LE-4`, neither explained. (`node_5wjzbcf`)
- "Final TX group" doesn't match the group's real name ("Final TX and Verify Script"). (`node_4yk5rwu`)
- The TX Field Extract "confirmation" shows the txid in **internal byte order** with no explanation — a learner comparing to an explorer sees a mismatch. (`node_dgaldLHe`)
- Stray space before colon after the SegWit/Taproot aside. (`node_8ob6g1f`)

**Story gap worth fixing:** txid byte order is relied on twice but never taught; HASH160 is never defined as RIPEMD160(SHA256(x)).

**Best missing exercise:** "change the output amount by 1 sat and predict which downstream bytes change before looking" — SIGHASH_ALL made visceral, zero cost.

### p1 — P2PK vs P2PKH

**Verified:** P2PK script, sig-only scriptSig, scriptCode substitution, verify trace — all match on-canvas artifacts.

**Issues (nits):**

- "script verification is just a public-key push + OP_CHECKSIG" describes only the locking half. (`node_1jj7t0a`)
- The hard-break markdown class (see cross-cutting #2). (`node_79grnt7`)
- **Exercise 3 is order-ambiguous** — appending the pubkey push after the sig fails at OP_CHECKSIG (NULLFAIL) while prepending passes and fails only CLEANSTACK, a completely different lesson; the text specifies neither placement nor expected failure. (`node_1evdaey`)
- Trailing space after the "Try it yourself" heading. (`node_1evdaey`)

**Story gap:** no payoff text — the climax (TX2's verify returning true, closing the P2PK round trip) is never called out; and the comparison promised by the title is never landed in a summary.

**Best missing exercise:** deliberately use the exclude-flags input with CLEANSTACK to convert exercise 3's ambiguity into an explicit consensus-vs-standardness lesson.

### p2 — P2PKH Multi-Input Signing (weakest pedagogy, cleanest facts)

**Verified:** everything, down to both signatures; the per-input blanking (`00`) claim is literally visible in the two preimage bodies.

**Issues:** only wording nits in the exercise node (`node_0d0btic`: plural "exercises" for one exercise; "Start with fresh funding address" missing article; "transaction consolidation during low fees" phrasing).

**The real problem is density:** 2 text nodes for 85 nodes of build. The lesson's core proof — the mirrored scriptPubKey/`00` swap between the two preimage bodies (`node_APrSFn0t` / `node_th7Y747b`) — has **no text pointing at it**, and the single exercise is the expensive kind (fund 3 fresh UTXOs, rebuild ~15 nodes) with no cheap warm-up.

**Best missing exercises (both zero-cost):** cross-wire IN2's scriptPubKey into IN1's preimage and watch verify flip false; tamper one output amount and watch *both* input signatures die — proving each signature commits to all outputs.

### p3 — Bare Multisig

**Verified:** the 2-of-3 template, OP_0 dummy quirk, preimage placeholder, and the consensus-vs-standardness framing of the 3-pubkey limit — all correct against the real interpreter.

**Confirmed warning:** the TX1/TX2 pseudo-headings rely on two-space hard breaks that `markdown.ts` doesn't render — they collapse into run-on lines (renderer class, cross-cutting #2). (`node_55qr6do`)

**Exercises are genuinely live** (the TX1→txid→TX2 chain recomputes), but exercise 2 (swap signature order → fails) tests a rule — **CHECKMULTISIG requires pubkey-order matching** — that the lesson never states, and NULLFAIL's error message won't tell them. One sentence fixes it. (`node_rglftgr`)

**Best missing exercise:** change the dummy OP_0→OP_1, watch NULLDUMMY fail, then exclude NULLDUMMY via the verify node's flags to see it pass — the whole BIP147 story in two clicks.

### p4 — P2SH & Timelocks

**Verified:** the Lock/Unlock matrix's hard parts are right (MTP/BIP113, `fffffffd` disable bit, minimal-push-as-standardness, non-final sequence), plus the full byte chain (147-byte redeemScript, HASH160 match, `15000000`=21).

**Confirmed warnings (both about the exercise path):**

1. **"Set SEQUENCE[4] lower than the CSV delay → observe failure" is false as written** — the script delay and the sequence share one upstream "Block delay" node (`node_WvN674hE` feeds both `node_16frfbo` → redeemScript and `node_dMdA4QVa` → SEQUENCE[4]), so editing it changes both sides in lockstep and verification *stays true*. Needs one sentence: disconnect the shared feed first. (`node_43s3y5f`)
2. The multisig "fast path" description **omits the CHECKMULTISIG dummy element** — a learner assembling `<sig1> <sig2> <selector> <redeemScript>` per the text gets an unexplained failure under NULLDUMMY. (`node_vjl7qpa`)

**Nits:** several previously-deferred matrix items (`Input height` naming, "Same height →" hiding the `>=` rule, minimal-push chain missing the concat step, "must be 2" vs "≥ 2"); `node_8twykdm` pointing "below" to a matrix that actually sits *above and far left* — the learner is sent the wrong way to the lesson's best asset; `nSequence = 15000000` reads like decimal fifteen million; "length 93" invites reading the varint as 93 bytes (it's 147 = 0x93).

**Best missing exercises:** set TX version back to 1 (one click → BIP68 gate); exclude CHECKSEQUENCEVERIFY via flags (CSV degrades to NOP3 — history made visible).

### p5 — P2SH Recovery with OP_RETURN

**Verified:** the recovery story is real in the wiring (scriptSig genuinely fed from the decrypted OP_RETURN), push-minimality correct down to `4cf9` for the 249-byte envelope.

**Confirmed warnings:**

1. **Terminology clash:** one node (`node_x52rof9`) calls the two-output tx "the funding transaction" while the rest of the lesson (and the canvas group) uses "setup transaction" — with a group literally named "Funding TX" meaning a different tx, this actively confuses.
2. **The 249-byte OP_RETURN's standardness story is never told** — that payload was non-relayable under Core defaults for a decade and only relays by default since Core 30. For future developers this is a must-mention (and it dovetails with p7's policy theme).

**Nits:** "per-heir encryption" overstates (it's a single owner-keyed envelope); the plaintext is ASCII-hex of the script (doubling the payload) without comment; field labels say "scriptpubkey hash" for what is the redeemScript hash (`node_2EIKuWvc`); double spaces; hard-break class.

**Story gap:** the lesson is named "Recovery" but the recovery sequence has zero text nodes — the climax must be reverse-engineered from node comments.

### p6 — TX Malleability

**Verified:** the taxonomy table is unusually careful and correct on the hard classifications (BIP66/147 as consensus, CLEANSTACK consensus-for-SegWit-only, push-only as policy).

**Confirmed warnings — all three "experiment" bullets mislead as written** (`node_1gw7gvr`):

1. Non-minimal push (`4c21`) → Verify returns **false** under default MINIMALDATA — contradicting the lesson's own table row #3, unless the learner excludes the flag (never mentioned).
2. "What you cannot do: change the amount" → in a **live dataflow that owns the key**, editing the amount re-signs everything and verification stays *true* — the opposite of the promise. Needs the "act as a third party: disconnect first" framing.
3. High-S flip → fails under default LOW_S; same exclude-flags remedy, never mentioned.

**Partial (downgraded to nit):** the intro's "Why it was fixed" (`node_l6fmh1z`) still lists strict-DER/NULLDUMMY as if relay-only; the table below it is correct, so it's an internal tension rather than uncorrected error.

**The one systemic fix rescues all three:** teach the verify node's `exclude_flags` input — it turns the lesson's core distinction (policy vs consensus) into something the learner can *toggle*.

### p7 — Picture in P2SH (BIP110)

**Verified:** byte-perfect demo — 374-byte 3×OP_DROP redeemScript, HASH160→funding-output linkage, 536-byte reveal tx, exactly-520-byte picture scripts, ~73 KiB/156-output scaling; BIP-110 claims accurate against the actual BIP text.

**Confirmed warnings:**

1. **The mechanism text describes a redeemScript the built demo never uses** (`node_flz6d1t`) — it presents the 240/240/OP_2DROP structure from the picture node, but the actual funding/reveal transactions use the 3-chunk text script. The learner's byte trace contradicts the narrative spine.
2. **"~540 bytes per output" is wrong as placed** (`node_0agwsdl`) — the redeemScript is 374 B and the output script 23 B; ~540 is the whole reveal *transaction*.

**Nits:** "Later in the flow" points the wrong direction (the referenced section is above); the binding 520-byte `MAX_SCRIPT_ELEMENT_SIZE` constraint (the reason chunks are 240 B) is never named; "each redeemScript carries 480 bytes" ignores the remainder script; "<73kB" vs the inclusive 73 KiB backend cap; hyphenation inconsistency BIP110/BIP-110.

**Exercise reality-check:** the "embed any image (<73 KiB)" exercise implies up to 41 hand-built per-input preimages with no warning — steer learners to a <480-byte file for a single-output run.

---

## Cross-cutting findings (the real priorities)

**1. Exercise-vs-default-verify-flags mismatch — the #1 class (5 confirmed cases: p6×3, p4×1, p1×1).** Every exercise that demonstrates a *policy* rule collides with the Verify Script node enforcing that policy by default, producing the opposite observation. The node already has the cure — the `exclude_flags` input — but **no visible lesson ever teaches it**. One reusable paragraph ("how to relax a policy flag to see consensus-validity") referenced from p1/p3/p4/p6 turns the whole class of broken exercises into the set's best feature.

**2. Markdown hard-breaks (p1, p3, p5, p6).** `mdToHtml` doesn't honor two-space breaks, so bold pseudo-headings collapse into run-on paragraphs. Fix it **once in the renderer** (convert `  \n` → `<br/>` outside code blocks) rather than editing four lessons — this was deferred at p1 review time; it's now confirmed to affect four published lessons.

**3. The story-shape pattern.** Seven of eight lessons front-load all narration, leave the build's middle unnarrated, and end without a payoff node ("you just spent a 2-of-3 multisig — here's what confirmed on-chain"). Also recurring: **Try-it-yourself placed spatially before the artifacts it references** (p2, p4, p6, p7). Cheap, high-leverage: one mid-build text node at each lesson's proof-artifact (p2's mirrored preimages is the most glaring) and one closing payoff node each.

**4. Small concepts relied on but never taught:** txid byte-order (p0 — depends on it twice), HASH160's definition (p0), CHECKMULTISIG's ordering rule (p3), the CHECKMULTISIG dummy (p4). Each is a one-sentence fix.

**5. Curriculum gap for "future Bitcoin developers": the visible set is 100% legacy/P2SH.** p0 says "SegWit/Taproot use different serialization rules," p6 crowns SegWit "the real fix," p3 points forward to P2WSH/Taproot — and then the visible curriculum ends. The SegWit/Taproot lessons exist only behind the hidden "Older flows" toggle. Given the audience, promoting refreshed versions of p8 (SegWit intro) and p11 (Taproot intro) into the visible set is the single biggest curriculum improvement available — and the new TX Parser node (wtxid, marker/flag, witness stacks) plus the Script Viewer make witness-dissection lessons dramatically easier to build now than when those old flows were written.

## Suggested fix order

1. **Exercise correctness** (misleads learners today): p6's three experiment bullets, p4's SEQUENCE exercise sentence, p4's missing dummy, p7's wrong-redeemScript paragraph and ~540 figure, p5's funding/setup naming.
2. **Renderer hard-break support** (one fix, four lessons).
3. **One-sentence concept patches:** p0 txid byte-order + HASH160, p3 ordering rule, p5 OP_RETURN policy paragraph.
4. **Story polish:** payoff nodes + mid-build commentary (start with p2), Try-it-yourself repositioning.
5. **Curriculum:** plan the SegWit/Taproot promotion.
