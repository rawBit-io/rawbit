# Fix-impact review: python-bitcointx audit (B01–B38) vs rawBit and the lesson flows

**Date:** 2026-07-15
**Question answered:** *If the fixes proposed in the consolidated fork audit are applied, does anything change in how the library behaves inside rawBit, and do all flows in `src/my_tx_flows` still work?*
**Fork under review:** `rawBit-io/python-bitcointx` @ `435e481` (the commit pinned in [requirements-special.txt](../requirements-special.txt))
**rawBit tree reviewed:** current `main` (clean, `a60f72c`)

---

## 1. Verdict (TL;DR)

**Yes — the flows keep working, with three caveats you must plan for.**

All 18 behavior-changing library patches from the audit's fix list (B01, B02, B03, B04×3, B05, B08, B09×3, B11, B12, B13, B14, B26, B32×2) were actually implemented against the pinned commit, installed into a venv, and the **full rawBit backend suite passed 483/483**. Precisely: the 13 strict-golden flows reproduce their committed results *and traces* bit-for-bit; the 16 stale-allowlisted `old/` flows reproduce all committed *results* (their traces are only checked for results by design — see §4); and the one flow the corpus skips entirely (`old/p15_Trezor_signing_flow.json`, which *does* ship in the app as `flow-15`) is analyzed in §4.1 — its lone script_verification node is a plain P2PKH spend of exactly the shape the strict flows already prove unaffected. No committed flow exercises any of the fixed edge cases, so the consensus-correctness fixes are invisible to published content.

The three caveats:

1. **B32 (`CLEANSTACK ⇒ WITNESS` guard) needs two companion changes or it degrades a rawBit feature and breaks 4 of the fork's own tests.** Excluding only `WITNESS` in the UI (keeping `CLEANSTACK`) currently runs the script under pre-SegWit rules; with the guard it returns `isValid=false / "SCRIPT_VERIFY_CLEANSTACK requires SCRIPT_VERIFY_WITNESS"` instead. rawBit's flag cascade must also discard `CLEANSTACK` when `WITNESS` is excluded, and the fork's vector harnesses need Core-style flag normalization (§7.1).
2. **Any fix that changes the payload of *successful* traces breaks the golden corpus.** rawBit stores library trace steps verbatim and the golden tests compare with exact deep equality. A one-field probe (`branch_active`, B15) broke **14 backend tests** (all 13 strict-golden flows + the cross-contamination guard). B15 does this unconditionally; B17/B19/B30/B36 are golden-safe only under the conditions listed in §5 (failure-only events, no annex/OP_SUCCESS flows, taproot-only event, typing-only). Land the whole trace group as one batch with a single `UPDATE_FLOW_GOLDENS=1` refresh and diff review (§7.4).
3. **B23/B25 (flag exposure) live mostly in rawBit, not the lib, and also invalidate every golden** because `activeFlags` is embedded in each stored `scriptDebugSteps`. Bundle them with the trace batch to pay the golden refresh once (§7.5).

Also confirmed while testing: the audit's B06/B18 concern is **live in rawBit today** — the 5-second SIGALRM timeout (`CalculationTimeoutError`, a `RuntimeError` subclass) is swallowed by the fork's blanket `except Exception` in `VerifyScriptWithTrace` and turned into a normal `isValid=false` result, so the timeout cannot interrupt a long verification (§7.3).

---

## 2. What was actually done

| Step | Result |
|---|---|
| Built a clean venv (Python 3.12, Homebrew libsecp256k1 0.7.0) with `requirements.txt` + the pinned fork | installs cleanly |
| Baseline: `pytest backend/tests` with the **pinned, unpatched** fork | **483 passed** |
| Verified every audit fix site against the pinned source, implemented all 18 Phase-1/2/3 patches (exact snippets in §8.3), applied them to the installed package | all apply cleanly, `py_compile` clean |
| Re-ran `pytest backend/tests` with the **patched** fork | **483 passed** — all strict goldens byte-identical, zero result flips anywhere |
| Ran the **fork's own suite** (`bitcointx/tests` + `bitcointx/tests_core`) unpatched vs patched | 1999 passed / 3 skipped → **1995 passed / 5 failed / 2 skipped** (§6.2 — all 5 failures are known companion-test updates; the B05 fix un-skips and passes the previously skipped negate test) |
| Probed B15 by adding one field (`branch_active`) to per-opcode trace steps, re-ran goldens | **14 failed** (13 strict flows + `test_taproot_flow_does_not_leak_state_into_legacy_flow`) — then reverted, green again |
| Behavior probes on flag-exclusion configs (pristine vs patched) | §6.3 |
| Five parallel code-review passes over: rawBit's full lib-usage surface, all 31 flow JSONs + `customFlows.ts`, the golden harness, the frontend trace viewer, and the fork fix sites | facts below |

Everything in this report is either directly observed in code (cited `file:line`) or empirically reproduced.

---

## 3. How rawBit actually uses the fork (the facts that drive every verdict)

The backend's production surface of the library is small and goes through **one call**:

- `VerifyScriptWithTrace(...)` — the **only** verification entry point ([calc_func.py:3375-3384](../backend/calc_functions/calc_func.py#L3375-L3384)); the three required args are positional, every optional arg (`inIdx`, `flags`, `witness`, `amount`, `spent_outputs`) is passed by keyword, and no `on_step` callback is ever passed. Plain `VerifyScript` is never called.
- `CTransaction.deserialize` (cached, [calc_func.py:356-362](../backend/calc_functions/calc_func.py#L356-L362)), `CTxOut`/`CScript` construction for prevouts, `b2x`. That's it.
- **Not used in production:** `CKey` (so `negated()`/`sub()` — B05), `VerifySignature` (B34), `SignatureHash`/`SignatureHashSchnorr` (tests only), `EvalScript` directly, positional `VerifyWitnessProgram` calls (B33). All signing/EC math is in-house (`ecdsa` + direct secp256k1 CFFI); the taproot key-path sighash is computed by rawBit's own `taproot_sighash_default` ([calc_func.py:1108-1232](../backend/calc_functions/calc_func.py#L1108)).
- `bitcointx.core.ValidationError` is **never imported or caught** — any exception the lib raises lands in `graph_logic.py`'s per-node blanket handler ([graph_logic.py:1108-1126](../backend/graph_logic.py#L1108-L1126)) and becomes a node error + HTTP 400. Exception-**type** changes (B04) are therefore invisible to rawBit; only message text differs.
- Flags: `STANDARD − UNHANDLED ∪ {CLTV, CSV}` ([calc_func.py:3269-3272](../backend/calc_functions/calc_func.py#L3269-L3272)) = 19 active flags, of which only the 18 in the hand-written `FLAG_BY_NAME` ([calc_func.py:3185-3204](../backend/calc_functions/calc_func.py#L3185-L3204)) are user-excludable/reported (B23: the 3 Taproot discourage flags are active but hidden). Excluding `WITNESS` cascades to `WITNESS_PUBKEYTYPE` + `DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM` — **but not `CLEANSTACK`** ([calc_func.py:3297-3307](../backend/calc_functions/calc_func.py#L3297-L3307)); excluding `P2SH` cascades nothing. This is exactly the surface B08/B32 guard changes touch.
- `spent_outputs`: for **non-Taproot** spends rawBit passes an **empty list `[]`, never `None`** ([calc_func.py:3355](../backend/calc_functions/calc_func.py#L3355)); for single-input P2TR it synthesizes `[CTxOut(amount, spk)]`, for multi-input P2TR it preflights and raises its own `ValueError` before the lib is ever called ([calc_func.py:3347-3363](../backend/calc_functions/calc_func.py#L3347-L3363)). ⚠️ Any lib fix must keep testing `spent_outputs is None`, not truthiness — `if not spent_outputs` would misfire on rawBit's `[]` for every legacy/SegWit-v0 verification.
- Trace steps pass through **verbatim**: the only transformation is `"unknown opcode"` → `"PUSH n bytes"` for opcodes 0x01–0x4B (the normalizer reads `opcode`/`opcode_name`, [calc_func.py:3079-3092](../backend/calc_functions/calc_func.py#L3079-L3092)). Beyond that, the backend *reads* only `phase`, `step`, `script_hex` — to harvest `scriptCode` from `step=="scriptcode_derive"` and `witnessScript` from `step=="witness_script_check"` / taproot phases ([calc_func.py:3415-3431](../backend/calc_functions/calc_func.py#L3415-L3431)). **Renaming those two step identifiers would silently break the `scriptCode`/`witnessScript` response fields** (B16's "do not rename" adjudication is correct for the v0 names too).
- The whole parsed verification payload (steps + `activeFlags` + `excludedFlags` + `scriptCode`/`witnessScript` + `error` + …) is stored as `data.scriptDebugSteps` on the node ([graph_logic.py:1007-1015](../backend/graph_logic.py#L1007)) — this is what the goldens pin.

Frontend (context for the trace-fix group):
- Validator-step predicate: `step.kind === "validator" || step.pc < 0` ([ScriptExecutionSteps.tsx:76-77](../src/components/dialog/ScriptExecutionSteps.tsx#L76-L77)). The fork's `leaf_version` event has neither `pc` nor `kind` → misclassified as an engine opcode → `opcodeExplanation(undefined).startsWith` throws (tsx:407-410 via 771-774). **There is no React error boundary anywhere in `src/`** — this is a whole-app white screen, which upgrades the audit's B07 severity for rawBit.
- Curated-explanation dispatch is `step.step ?? step.opcode_name` (tsx:85-86) with cases for `witness_program_match`, `witness_load`, `scriptcode_derive`, `witness_script_check`, `witness_script`, `taproot_witness`, `taproot_sighash`, `taproot_schnorr_verify`. The live taproot events carry `step: "witness_stack" | "sighash" | "schnorr_verify" | "control_block"`, so **all of them hit the default branch today** — the curated `taproot_*` cases are dead code even for the cached lessons (B16 confirmed, in both directions).
- Every step with `phase == "witness"` is filtered from both the walker and Copy-All (tsx:637-641, 680-682) — B37 confirmed; but `witnessSpend` detection and the failure-summary scan use the **unfiltered** list (tsx:760-766, 815-818), so the steps must keep being generated.

---

## 4. What the golden corpus actually pins (breakage mechanics)

- `test_flow_goldens.py` compares `data.result` and the entire `data.scriptDebugSteps` dict with **plain `!=` deep equality — no subset matching, no ignored fields** ([test_flow_goldens.py:185-193](../backend/tests/test_flow_goldens.py#L185-L193)). Any added/removed/renamed key on any step, any inserted step, any `activeFlags` change ⇒ mismatch.
- Corpus = all of `src/my_tx_flows/*.json` + `misc/` + `old/` except `old/empty.json` and `old/p15_Trezor_signing_flow.json`. **Strict trace goldens:** the 10 current lessons, both `misc/` flows, and `old/non_standard.json` (13 flows). **Every other `old/` flow — including all four Taproot lessons — is in `STALE_STEPS_NODES`** (trace mismatch tolerated, *result* still strict), because a previous trace-format change already happened; the allowlist has a reverse guard that forces shrinking when a node heals. One further carve-out: `STALE_RESULT_NODES` tolerates stale *results* on two `old/p10` `math_operation` nodes (float→Decimal migration — not script-related, but a Wave-4 refresh will rewrite them too, see §7.4).
- Shipped vs corpus: [customFlows.ts](../src/my_tx_flows/customFlows.ts) ships 28 flows to users, **including** the corpus-skipped `old/p15_Trezor_signing_flow.json` (`flow-15`) and **excluding** three corpus-only files (`old/empty.json`, `old/non_standard.json`, `old/p0_Intro.json`). So the golden gate covers everything users see except the Trezor flow (§4.1), and additionally pins one flow users never see.
- `backend/tests/pytest.ini` runs with `--maxfail=1` — a mass golden break surfaces as a single failing flow, which understates blast radius, and it also shapes the refresh procedure (§7.4). (The 14-failure count in §6.1 was measured with the limit lifted.)
- Corpus-wide feature facts (verified by parsing all 31 JSONs): **no `OP_CODESEPARATOR` anywhere; every tx is `nVersion=2`; max `nLockTime` 1 753 359 636 < 2³¹; ECDSA only `SIGHASH_ALL`, Schnorr only 64-byte `SIGHASH_DEFAULT`; no annex, no OP_SUCCESS, no P2A, no SIGHASH_SINGLE.** The only flag-exclusion configs committed anywhere: `WITNESS, CLEANSTACK` (3 nodes, old/p8) and `TAPROOT, DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM` (old/p11). Largest trace = 24 steps.
- This is *why* the consensus fixes are provably invisible to flows — and why nothing in the corpus (or the fork's always-prevouts QA corpus) would have caught B01/B08/B09 in the first place. Worth keeping the audit's regression vectors in the fork.

### 4.1 The one shipped flow the tests skip: `old/p15_Trezor_signing_flow.json`

The corpus skips this flow because its signing nodes need a connected Trezor, so no empirical run covers it. Its library exposure is nonetheless fully analyzable: it contains exactly **one** `script_verification` node (`node_5sul83i`), a plain single-input P2PKH spend with `nVersion=2`, `nLockTime=0`, `SIGHASH_ALL`, no conditionals, no codesep — the same shape as the P2PKH verifications the strict flows prove unchanged (p0/p1/p2 reproduce bit-for-bit under the patched lib). The Trezor nodes themselves never touch bitcointx. Verdict: Wave-1 fixes cannot change this flow; the Wave-4 trace batch changes its *recalculated* trace like every other flow (its stored trace is old-format and outside the golden gate anyway).

---

## 5. Per-bug impact matrix

Legend — **rawBit runtime:** does the fix change any behavior reachable through rawBit? **Flows/goldens:** do the 29 committed flows still reproduce? **Companion:** changes required outside the lib fix itself. ✅ = safe as proposed, ⚠️ = safe with the noted companion, 🔶 = plan a golden refresh.

| ID | Fix (short) | rawBit runtime | Flows/goldens | Companion needed |
|---|---|---|---|---|
| B01 | codesep `sop_pc+1` | Only user-authored P2WSH codesep scripts (now Core-correct) | ✅ verified green — no flow uses codesep | none |
| B02 | unsigned CSV `nVersion` | only tx version ≥ 2³¹ (none in flows) | ✅ green | none |
| B03 | BIP143 `<I` locktime | crash→works for post-2038 locktimes; byte-identical sighash below 2³¹ | ✅ green | none |
| B04 | 3 exception leaks → `ValidationError` | invisible (blanket handler); message text only | ✅ green | ⚠️ fork test `test_sighash_single_without_output_fails` must expect `ValidationError` (fails today, §6.2) |
| B05 | secp256k1 negate binder | **none** — rawBit never uses `CKey` | ✅ green; fork's skipped negate test un-skips and **passes** on libsecp 0.7.0 | restore the deleted negative-path asserts (lib repo) |
| B06 | trace caps + re-raise resource/timeout | **required for rawBit**: today the SIGALRM timeout is swallowed (§7.3); lesson traces (≤24 steps) never truncate | ✅ if caps are sane; a `trace_truncated` event must use full validator schema and not `phase:"witness"` | rawBit request caps; timeout test |
| B07 | full-schema `leaf_version` event | prevents a **whole-app white screen** (no error boundary) | ✅ green — no golden stores this event | frontend defensive fix + error boundary independently recommended |
| B08 | `WITNESS⇒P2SH` guard in trace path | exclude `P2SH, CLEANSTACK` flips silent `true` → explicit error (§6.3) | ✅ green — no lesson excludes P2SH | none (use return-False convention, as VerifyScriptWithTrace does elsewhere) |
| B09 | remove global tapscript prevout gate | none by itself — rawBit synthesizes/preflights first | ✅ green | to get the UX win, also relax [calc_func.py:3357-3363](../backend/calc_functions/calc_func.py#L3357); **keep `is None` checks** (rawBit passes `[]`) |
| B10 | fix CI | none | n/a | add rawBit backend suite as downstream job (it *is* the declared acceptance gate) |
| B11 | pubkey checks before empty-sig return | user-authored malformed-pubkey scripts under STRICTENC now fail (Core policy) | ✅ green | none — one `_CheckSig` patch covers CHECKMULTISIG (it delegates per pair) |
| B12 | P2A carve-out | P2A demos become possible | ✅ green | none |
| B13 | native v1-32B, TAPROOT unset → success | excluding `TAPROOT` alone now succeeds like Core | ✅ green — old/p11 already excludes the discourage flag too | none |
| B14 | disabled CLTV/CSV = plain NOP | only configs excluding CLTV/CSV while keeping discourage-NOPs | ✅ green — rawBit defaults always enable CLTV/CSV | none |
| B15 | `branch_active`/processed on steps | UI ignores new fields until frontend work | 🔶 **empirically breaks 13 strict flows + 1** — batch + refresh (§7.4) | frontend rendering; golden refresh |
| B16 | step-name aliases (rawBit side) | fixes dead curated taproot explanations | ✅ lib unchanged | rawBit alias map; **never rename `scriptcode_derive`/`witness_script_check`** (backend harvest) |
| B17 | terminal `failed:true` events | failure UX improves | ✅ green *if* only failing traces change (only 2 failing goldens, both allowlisted) | avoid `phase:"witness"` on failure events, else invisible + off-by-k footer (§7.4) |
| B18 | classify wrapper exceptions | internal errors become node errors instead of fake `isValid=false`; **prerequisite for the timeout to work** | ✅ green | pair with B06; decide the re-raise set = "everything not ValidationError" |
| B19 | `op_success` + `taproot_annex` events | new uncurated-but-rendered steps | ✅ green — no annex/OP_SUCCESS in corpus | emit annex event **after** `witness_stack` or accept the witnessStack-pane source shifting |
| B20 | CLEANSTACK error identity in lib | error **text** changes for user-authored failing scripts (verdicts unchanged) | ✅ both failing goldens allowlisted; error strings live inside the allowlisted trace payload | none |
| B21 | strict QA gates (no runtime xfail) | none | n/a | fork suite currently has **67 XPASS** that `xfail_strict` will surface — triage when landing |
| B22 | taproot trace tests | none | n/a | land **before** the Phase-4 trace batch |
| B23 | expose 3 hidden taproot flags | rawBit-side; users gain toggles | 🔶 `activeFlags` is inside **every** golden → full refresh | keep old exclusion names working; decide TAPROOT-exclusion cascade for the 3 discourage flags; bundle with B25 |
| B24 | wheel packaging | **none** — rawBit installs from git source | n/a | none |
| B25 | implement CONST_SCRIPTCODE | leaves `UNHANDLED_…` → **silently joins rawBit's default flag set** and `activeFlags` | 🔶 golden-wide refresh; behavior change for user codesep scripts | bundle refresh with B23; docstring at calc_func.py:3122 already advertises it |
| B26 | name `OP_CHECKSIGADD` | trace naming only; frontend already compensates client-side | ✅ green — 0xba appears only in old/p13 (allowlisted) | also missing from `OPCODES_BY_NAME` (audit scope gap) |
| B27 | Python ≥3.8 metadata | none (rawBit on 3.12) | n/a | none |
| B28/B29 | QA corpus/docs | none | n/a | none |
| B30 | witness_script candidate/committed state | backend still harvests candidates; booleans ignored | ✅ if only the **taproot** `witness_script` event changes; ⚠️ touching v0 `witness_script_check` breaks strict p11_SegWit_P2SH golden | don't move/remove the event (backend + tapscript pane depend on it) |
| B31 | on_step raise handling | none — rawBit's collector callback doesn't raise | ✅ | none |
| B32 | `CLEANSTACK⇒WITNESS` + ordering | **exclude-WITNESS-only flips valid→error** (§6.3) | ✅ green — old/p8 excludes both together | **required:** rawBit cascade + unit-test update; fork harness flag normalization (§7.1) |
| B33 | positional callback shim | **none** — rawBit passes all optional args by keyword and no callback | ✅ | none |
| B34 | VerifySignature taproot | **none** — never used | ✅ | none |
| B35 | CHECKSIGADD ordering vs Core | error-path edge cases only; old/p13's empty-sig path identical either way | ✅ | none |
| B36 | TraceStep typing | **as proposed by the audit (TypedDict variants + `Literal` + exports): typing-only, zero runtime payload change → no impact.** Only an implementation that also adds/renames *emitted* fields (e.g. stamping `kind` on all steps) becomes B15-class | ✅ as proposed / 🔶 if fields are emitted | if fields are emitted, put it in the trace batch |
| B37 | witness-steps visibility | product decision; **keep generation** (backend harvest + witnessSpend + failure summary read raw steps) | ✅ as documented choice; making them walkable breaks pinned e2e/vitest step counts | see §7.4 |
| B38 | fork metadata/provenance | none | n/a | tag a release; keep pinning by commit in requirements-special.txt |

---

## 6. Empirical evidence

### 6.1 rawBit backend suite

| Configuration | Result |
|---|---|
| Pinned fork `435e481`, unpatched | **483 passed** |
| + all 18 consensus/API patches (B01–B14, B26, B32 families) | **483 passed** — every golden reproduces exactly |
| + B15 probe (`branch_active` field on opcode steps) | **14 failed** / 17 passed in `test_flow_goldens.py` (probe then reverted → green) |

The 14 failures: `p0_Intro_P2PKH, p1_P2PK_vs_P2PKH, p2_P2PKH_multi_input_signing, p3_Bare_MultiSig, p4_P2SH_and_Timelocks, p5_P2SH_and_OP_Return, p8_Atomic Swap (HTLC Coinswap), p9_SegWit, p10_SegWit_2in_1out, p11_SegWit_P2SH, misc/p6_TX_Malleability, misc/p7_BIP110, old/non_standard.json` + `test_taproot_flow_does_not_leak_state_into_legacy_flow`. Exactly the 13 strict-golden flows — the `old/` flows survive only because their traces are already stale-allowlisted.

### 6.2 Fork's own suite (`bitcointx/tests` + `bitcointx/tests_core`)

| Configuration | Result |
|---|---|
| Unpatched @ `435e481` | 1999 passed, 3 skipped, 3 xfailed, **67 xpassed** |
| Patched (all 18) | 1995 passed, **5 failed**, 2 skipped, 3 xfailed, 67 xpassed |

The delta decomposes exactly:
- **+1 un-skipped and passing:** B05 makes the modern-libsecp negate test run (3→2 skipped) and pass on Homebrew libsecp256k1 0.7.0.
- **4 failures from B32:** `tests/test_scripteval.py::Test_EvalScript::test_script` and `tests_core/test_script_vectors.py` cases 1069/1071/1072 (“P2PK/P2SH with unnecessary input”, “P2SH with CLEANSTACK”). These vectors carry `CLEANSTACK` without `WITNESS`; Bitcoin Core's own `script_tests.cpp` **normalizes flags before calling VerifyScript** (`CLEANSTACK ⟹ +P2SH +WITNESS`) — a high-confidence inference from the vendored Core vectors themselves (Core ships CLEANSTACK-without-WITNESS vectors that its own `assert` would otherwise abort on), double-check against Core source when implementing. The fork's harnesses don't normalize — they must gain the same normalization when B32 lands (§7.1).
- **1 failure from B04c:** `tests_core/test_taproot_keypath.py::test_sighash_single_without_output_fails` asserts `pytest.raises((ValueError, IndexError))`; the fix now raises `bitcointx.core.ValidationError`. Updating this expectation is precisely what audit item B21 prescribes anyway.
- The persistent **67 XPASS / 3 XFAIL** confirm B21: those markers are stale and will surface as failures under `xfail_strict`.

### 6.3 Flag-exclusion behavior probes (`script_verification`, sample legacy tx, pristine vs patched)

| User exclusion input | Pinned fork | Patched | Cause |
|---|---|---|---|
| `WITNESS` (only) | `isValid=true` (runs pre-SegWit rules) | `isValid=false` — `SCRIPT_VERIFY_CLEANSTACK requires SCRIPT_VERIFY_WITNESS` | **B32** — needs rawBit cascade (§7.1) |
| `WITNESS, CLEANSTACK` (the old/p8 lesson config) | `true` | `true` — unchanged | — |
| `P2SH` (only) | `false` — `CLEANSTACK requires P2SH` | same — unchanged | pre-existing check |
| `P2SH, CLEANSTACK` | **`isValid=true`** (trace path silently diverged from `VerifyScript`, which raises) | `false` — `SCRIPT_VERIFY_WITNESS requires SCRIPT_VERIFY_P2SH` | **B08 working as intended** |

`backend/tests/test_calc_func.py::test_script_verification_excluding_witness_clears_dependents` passes both before and after **only because it never asserts `isValid`** ([test_calc_func.py:1594-1604](../backend/tests/test_calc_func.py#L1594-L1604)) — tighten it when the cascade change lands.

### 6.4 Timeout-swallowing confirmation (B06/B18)

`CalculationTimeoutError(RuntimeError)` ([graph_logic.py:200](../backend/graph_logic.py#L200)) is raised by SIGALRM *inside* whatever code is running — if that's `VerifyScriptWithTrace`, the fork's blanket `except Exception: return False, steps, str(e)` (scripteval.py:2173 and five phase-level copies) converts the timeout into a normal “script failed” result. graph_logic's re-raise logic ([graph_logic.py:1109](../backend/graph_logic.py#L1109)) never sees it, the request continues, and the (possibly huge) steps list is still serialized. B18's classification fix (re-raise everything that is not a `ValidationError`) is therefore not just cleanliness — it is what makes rawBit's per-request timeout effective during script verification.

B18 is also golden-safe on the two committed *failing* goldens: both fail via `VerifyScriptError` (a `ValidationError` subclass) — `"invalid schnorr signature size"` (scripteval.py:747) for old/p11's `node_OG0Z4ug8` and `"witness program mismatch"` (scripteval.py:650/668) for old/p8's `node_oa93jkt` — so re-raising non-`ValidationError` exceptions cannot convert either into a node error. (Side observation: old/p8's *stored* error text, `"witness program mismatch (need 2 items for P2WPKH)"`, no longer matches what the pinned lib emits — one more pre-existing mismatch absorbed by the stale-trace allowlist, and direct evidence that lib error-message changes are tolerated there.)

---

## 7. The details that need care

### 7.1 B32/B08 — the guard fixes are right, but land three companions with them

The guards themselves are two-line, Core-faithful, and verified: no committed lesson hits them (old/p8 excludes `WITNESS` and `CLEANSTACK` *together*; nothing excludes `P2SH`). But:

1. **rawBit cascade** — [calc_func.py:3297-3307](../backend/calc_functions/calc_func.py#L3297-L3307) must also discard `CLEANSTACK` when the user excludes `WITNESS` (mirroring how it already discards `WITNESS_PUBKEYTYPE` and `DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM`). Otherwise the “what if SegWit rules were off?” teaching move silently turns into a flag-dependency error. Update the expected set in [test_calc_func.py:1597-1601](../backend/tests/test_calc_func.py#L1597-L1601) (add `CLEANSTACK`) and add an `isValid` assertion. Note the stored `excludedFlags` for old/p8 already contains `CLEANSTACK` (it was explicit), so **goldens don't change**.
2. **Fork vector harnesses** — add Core's normalization (`if CLEANSTACK in flags: flags |= {P2SH, WITNESS}`) to the legacy `test_scripteval.py` runner and `tests_core/test_script_vectors.py` flag parsing, exactly as Core's `script_tests.cpp` does. Without it, 4 tests fail (§6.2).
3. **Convention** — implement the trace-path guards with the `(False, steps, msg)` return convention (as probed here), not a raise: rawBit then shows a graceful in-node error rather than a `Calculation failed:` node crash, and acceptance parity with `VerifyScript` is restored either way.

### 7.2 B09 — the lib fix is a no-op for rawBit until the preflight is relaxed; and one landmine

Removing the global gate changes nothing for rawBit (it synthesizes a single-input prevout and pre-blocks multi-input P2TR itself). To actually unlock signatureless multi-input tapscript demos, relax [calc_func.py:3357-3363](../backend/calc_functions/calc_func.py#L3357) to pass `None` and let the (new, clearer) per-site errors surface when a sighash is genuinely needed. **Landmine:** rawBit passes `spent_outputs=[]` for every non-Taproot verification — the lib's `is None` checks must never become truthiness checks, and the tapscript CHECKSIG/CHECKSIGADD sites already have their own `None` guards (so removing the global gate cannot crash; verified).

### 7.3 B06/B18 — order matters: classification first, then caps

Land B18's wrapper classification (re-raise non-`ValidationError`) *before or with* B06's caps, because it is what lets `CalculationTimeoutError`, `MemoryError`, and `RecursionError` escape to graph_logic (§6.4). When adding a `trace_truncated` event, emit the full validator schema (`pc:-1`, `kind:"validator"`, `opcode_name`, stacks) and give it a non-`"witness"` phase — a `phase:"witness"` event is invisible in the UI (filtered) and a schema-less event is the B07 crash class. Lesson flows (max 24 steps) will never truncate, so goldens are safe for any sane cap.

### 7.4 The trace-schema batch (B15, B17, B19, B30, B36, B16-aliases, B37) — one refresh, not six

Mechanics recap: steps are stored verbatim, goldens are exact-equality, so *any* payload change to successful traces breaks all 13 strict flows at once (empirically demonstrated, §6.1). Therefore:

- Land B15 + B17 + B19 + B30 (+ any B36 runtime schema effects) in **one fork release**, bump the pin, then refresh. Mind the harness mechanics: in update mode each mismatching flow still ends in `pytest.fail`, and `backend/tests/pytest.ini` carries `--maxfail=1` and coverage gates — so a naive run rewrites **one** flow and stops. Use something like `UPDATE_FLOW_GOLDENS=1 .myenv/bin/python -m pytest backend/tests/test_flow_goldens.py -o addopts= -q` (drops `--maxfail=1` and the `--cov` args) to rewrite everything in one pass, review the surgical diffs, then re-run the whole suite clean plus `tests/e2e/flow.roundtrip.spec.ts` and the frontend vitest suites.
- That refresh also rewrites the stale `old/` traces to the current format — the reverse-allowlist guard will then force `STALE_STEPS_NODES` to shrink, which is the designed outcome. It will additionally rewrite the two `old/p10` float-era math results (update mode rewrites *every* mismatching node, allowlisted or not), so `STALE_RESULT_NODES` empties too. Budget review time for that diff (it includes B26's `OP_CHECKSIGADD` rename in old/p13 and the taproot vocabulary).
- B17 caveat: give failure events a walkable phase (not `"witness"`), or first fix the frontend failure-summary indexing — it scans the **unfiltered** list (tsx:815-818) while the walker numbers the **filtered** list, so a witness-phase failure step yields a `FAILED STEP N` pointing at a step the user can't navigate to.
- B16: implement as **frontend aliases** (`witness_stack`→`taproot_witness` case, etc.). The curated taproot explanations are dead code today for *all* traces, cached ones included — aliasing is pure win with zero golden impact. Never touch `scriptcode_derive`/`witness_script_check` names (backend harvest, §3).
- B37: if you make witness steps walkable, the pinned counts in [segwit.script-steps.spec.ts](../tests/e2e/segwit.script-steps.spec.ts) (`Step 1/7`, `Step 7/7`, zero `Rule:` occurrences) and the vitest step-count assertions break — treat that as a deliberate product change with its own test updates, or just document the current filtering.
- B07's lib fix is in this family but is safe to land **early** (no golden stores a `leaf_version` event); pair it with the frontend defensive change and, ideally, an error boundary — today the failure mode is a whole-app white screen.

### 7.5 B23/B25 — mostly rawBit work, and the other golden-wide refresh

- B23: derive `FLAG_BY_NAME` from the lib's `SCRIPT_VERIFY_FLAGS_BY_NAME` (assert every active flag has a display entry), keep the two committed exclusion strings working (`WITNESS, CLEANSTACK`; `TAPROOT, DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM`), and decide whether excluding `TAPROOT` should cascade the three taproot-discourage flags (recommended, by symmetry with the WITNESS cascade).
- B25: the moment CONST_SCRIPTCODE leaves `UNHANDLED_SCRIPT_VERIFY_FLAGS`, rawBit's default set gains it automatically ([calc_func.py:3269](../backend/calc_functions/calc_func.py#L3269)) and it starts appearing in `activeFlags` — plus legacy codesep scripts get policy-rejected under defaults. That's correct standard-policy behavior, but it is a **behavior + golden change**; the exclusion toggle (already in `FLAG_BY_NAME`, currently a no-op) starts working, which the docstring already promises.
- Both changes rewrite `activeFlags` inside every stored `scriptDebugSteps` → schedule them **with** the §7.4 refresh to pay the golden-review cost once.

### 7.6 No-impact bucket (land freely in the fork)

B05 (verified: rawBit does no `CKey` math), B10, B21, B22, B24 (rawBit installs from git, not wheels), B27 (backend is 3.10+ syntax anyway), B28, B29, B31, B33 (rawBit's call site passes all optional args by keyword), B34, B35, B38. None of these can change rawBit behavior; B10/B21/B22 materially raise the chance that the *next* fork regression is caught before a pin bump. (B20 sits just outside this bucket: verdicts never change, but its error-identity work can change error *text* on user-authored failing scripts — lessons are unaffected, see the matrix row.)

---

## 8. Recommended landing order (adapted to rawBit)

**Wave 1 — consensus & API correctness (no golden impact, verified green):**
B01, B02, B03, B04(+fork-test update), B05(+restored tests), B08, B09(lib), B11, B12, B13, B14, B26, B32(+fork harness normalization) → **plus rawBit companion:** WITNESS-exclusion cascade adds CLEANSTACK + tightened unit test. (The cascade companion was *not* part of the empirical run; its golden-neutrality follows from old/p8's stored `excludedFlags` already containing `CLEANSTACK` — re-run the suite after making it, as always.) Bump the pin in `requirements-special.txt`; acceptance = `pytest backend/tests` (483) + fork suite fully green. Environment notes for whoever bumps the pin: `requirements-special.txt` rebuilds the `secp256k1` CFFI package from source (`--no-binary`), so a C toolchain is needed; and the fork-suite pass/skip counts in §6.2 are specific to a modern system libsecp256k1 (0.7.0 here) — an older system lib changes which key tests run.

**Wave 2 — service hardening + early crash-class lib fix:** B18 classification, then B06 caps + rawBit request/trace limits (add a test that a timed-out verification actually returns the timeout error, not `isValid=false`); plus the **B07 lib fix** (full-schema `leaf_version` event) — golden-safe, no reason to hold it for the trace batch.

**Wave 3 — frontend defense (no lib change):** B07 defensive rendering + error boundary; failure-summary indexing fix (pre-work for B17). Acceptance: `npm run test` (the ScriptExecutionSteps vitest fixtures pin current rendering and will need updates alongside).

**Wave 4 — trace schema batch + flag exposure (single golden refresh):** B15, B17, B19, B30, B36(if it emits fields), B16-aliases, optionally B37-as-product-change, B23, B25 → one `UPDATE_FLOW_GOLDENS=1` run (see §7.4 for the exact command — the default `--maxfail=1` makes a naive run refresh only one flow), diff review, `STALE_STEPS_NODES`/`STALE_RESULT_NODES` shrink, e2e roundtrip + segwit step specs + vitest re-run.

**Anytime, fork-only:** B10, B20 (error-text note in matrix), B21 (triage the 67 XPASS), B22 (before Wave 4), B24, B27, B28, B29, B31, B33, B34, B35, B38.

**Bottom line:** the audit's fixes are sound for rawBit. Nothing in Waves 1–3 moves a single golden — empirically proven for Wave 1's 18 lib patches, argued from stored goldens for the small rawBit-side companions (B18's safety on the two failing goldens is pinned to their `VerifyScriptError` provenance, §6.4); the entire migration cost is concentrated in the one planned Wave-4 refresh, plus the three §7.1 companions that must ship together with B32.

---

## Appendix A — patch set used for the empirical runs

All 18 patches (exact old/new snippets, verified unique against the pinned source, smoke-tested individually and as a set) are committed alongside this report as [claude_script_bugs_patches.json](./claude_script_bugs_patches.json) — each entry has `bug_id`, `file`, verbatim `old_code`/`new_code`, and implementation notes, so they can be replayed mechanically. Summary of what was applied to `bitcointx/core/`:

- `scripteval.py`: B01 (`pbegincodehash = sop_pc + 1`), B02 (`(txTo.nVersion & 0xFFFFFFFF) < 2`), B04a (x-only validity pre-check → `VerifyScriptError("witness program mismatch")`), B04b (OP_SUCCESS pre-scan wrapped, `CScriptInvalidError` → `VerifyScriptError("tapscript is not decodable")`), B08 (trace-path `WITNESS⇒P2SH`, return-False convention), B09a/b/c (global gate removed; per-site `spent_outputs is None` → clear `VerifyScriptError` at the two tapscript sighash sites), B11 (`_CheckSig` reorder: pubkey-encoding checks before the empty-sig return; empty sig skips DER/hashtype/LOW_S; covers CHECKMULTISIG via delegation), B12 (P2A `0x4e73` carve-out, native-only), B13 (native v1-32B TAPROOT-unset → immediate success), B14 (CLTV/CSV discourage-NOPs branches removed), B32a/b (`CLEANSTACK⇒WITNESS` in both entry points, each in its native error convention).
- `script.py`: B03 (`<I` for BIP143 nLockTime), B04c (SIGHASH_SINGLE out-of-range → `bitcointx.core.ValidationError`), B26 (`OP_CHECKSIGADD` in `OPCODE_NAMES`).
- `secp256k1.py`: B05 (optional dual-symbol negate binder, `has_privkey_negate` derived from the resolved callable).

Two audit line-number corrections found while verifying: the B05 site is `secp256k1.py:228-231` (the audit's `:217` points at the existing tweak_add alias — the fork already ships the `_bind` dual-symbol helper, it was just never applied to negate), and B11 needs no separate CHECKMULTISIG patch (it delegates every pair to `_CheckSig` at scripteval.py:1042-1043).

## Appendix B — environment

- Python 3.12 (Homebrew), venv with `requirements.txt` + `requirements-special.txt` (fork built from git at the pin; libsecp256k1 0.7.0 system lib — note this is the modern-lib configuration where the B05 defect is live).
- rawBit backend suite: 483 tests; golden corpus 29 flows / 80 script_verification nodes (an 81st sits in the corpus-skipped Trezor flow); strict trace goldens on 13 flows.
- Fork suite: 2072 collected (tests + tests_core).
