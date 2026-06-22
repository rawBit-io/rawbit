# Open findings — as of 2026-06-19

Snapshot of everything **still open** from the `docu/bug-audit-2026-06-16.md` audit
(34 `NB-*` + 7 `CODEX-*` findings), after the fix passes on 2026-06-18/19. Status was
re-verified against the working tree by an independent per-finding verification pass;
every "open" item below was confirmed to still reproduce in current code.

Full mechanism / evidence / proposed-fix detail for each lives in
**[bug-audit-2026-06-16.md](bug-audit-2026-06-16.md)** under the matching heading.

## Tally

| Status | Count | IDs |
|---|---|---|
| ✅ Fixed & verified | 24 | NB-01/02/03/04/05/08/09/10/11/12/15/16/17/19/20/21/22/23/24, CODEX-02/03/05/OOS-01/OOS-02 |
| ⚠️ Fixed with low residual | 2 | NB-14, NB-18 |
| 🟠 Open — medium | 1 | NB-13 |
| 🟡 Open — low | 13 | NB-06/07/25/26/27/28/29/30/31/32/33/34, CODEX-04 |
| ⏸️ Deferred (owner decision) | 1 | CODEX-01 |

**16 items need attention** (2 residual + 1 medium + 13 low), plus 1 deferred.

---

## ⚠️ Fixed, but with a low-severity residual gap

### NB-14 — ECIES two-time-pad: default path fixed, explicit-override path is not
- **Severity:** low · **Area:** backend/crypto
- **Location:** `backend/calc_functions/calc_func.py` — override path `ecies_encrypt` (~600-625); `_ecies_key_material` info derivation (~534-544, no plaintext component); keystream `_ecies_stream_xor` (~517-524).
- **What's fixed:** the **default** path now derives the ephemeral key + salt from `HMAC(recipient‖aad‖plaintext)` (`_ecies_deterministic_material`), so distinct plaintexts get distinct keystreams.
- **Residual:** the **explicit override** inputs `vals[3]` (ephemeral key) + `vals[4]` (salt) are unchanged — and that is the exact trigger the finding named. A crafted/imported flow that pins identical eph+salt+recipient+aad across two *different* plaintexts still yields identical keystreams → `C1^C2 = P1^P2`.
- **Suggested fix:** bind the plaintext into the HKDF `info` (kills reuse on every path, but changes the envelope → refresh p5 goldens), **or** drop the `vals[3]/vals[4]` override entirely, **or** keep them but document the hazard + refuse identical-eph-across-distinct-plaintext.

### NB-18 — validation fan-out DoS: primary fixed, empty-fields bypass remains
- **Severity:** low · **Area:** frontend/flow-lib
- **Location:** `src/lib/flow/validate.ts:301-353` (pre-check, `instanceCountFor`); amplifier `src/lib/nodes/ports.ts:~79-82` (`Array.from({length: N})`).
- **What's fixed:** the O(groups) fan-out pre-check rejects crafted `groupInstanceKeys`/`groupInstances` cross-products (`NODE_PORT_FANOUT_INVALID`) before `buildPorts` runs.
- **Residual:** a group with **empty `fields: []`** but a huge `groupInstances` count yields `count × 0 = 0`, so it slips the pre-check — yet `buildPorts` still does `Array.from({length: count})` unconditionally, bulk-allocating an N-element array on the main thread. Weaker than the original (bulk allocation, no per-element work, memory-capped), hence low.
- **Suggested fix:** cap the count-fallback length in `buildPorts` (`Math.min(count, MAX)`, mirroring the existing `numInputs` fallback cap), **and/or** also reject in the pre-check when a raw instance count alone exceeds the cap regardless of field count.

---

## 🟠 Open — Medium (1)

### NB-13 — verify_signature normalizes high-S before verifying → malleated sigs report "true"
- **Location:** `backend/calc_functions/calc_func.py:~3698` (`..._normalize(ctx, sig, sig)` in place, verifies the normalized form at ~3701).
- **Real usage:** drop a **Verify Signature** node, give a valid pubkey + msg hash + a DER signature whose `S` was negated mod n (high-S). It returns `true` even though that signature is non-standard and would be rejected by consensus (LOW_S). For a teaching tool about exactly this, it's a misleading false positive.
- **Suggested fix:** verify the signature **as-given** (don't normalize before verifying), or explicitly reject high-S with a clear "non-standard (high-S) signature" message.

---

## 🟡 Open — Low (13)

### NB-06 — useConnectPorts returns stale cached ports while the Connect dialog is open
- **Location:** `src/hooks/useConnectPorts.ts:~45` (`portCacheRef`), short-circuit + cache effect.
- **Real usage:** open the Connect dialog on a node whose ports change via recalc (e.g. dynamic `extract_tx_field`); targets lag the node's actual handles by one render.
- **Suggested fix:** delete the ref cache; derive ports with `useMemo` over `nodes` (buildPorts is pure).

### NB-07 — coalesce refs never cleared on undo/redo; clearPendingAfterCalc is dead code
- **Location:** `src/hooks/useSnapshotScheduler.ts` (`clearPendingAfterCalc` has no production caller); undo effect `src/components/Flow.tsx:~3236-3321`.
- **Real usage:** latent — largely defused by the NB-01 per-tab rework (tokens are monotonic so a stale coalesce token can't re-match), but the dead API + uncleared refs remain.
- **Suggested fix:** add a `resetCoalesce()` wired into the history-load effect, or delete the now-dead `clearPendingAfterCalc` API + its mocks.

### NB-25 — budget check-then-record race admits concurrent over-budget calculations
- **Location:** `backend/routes.py:~287` (check before work; record in `finally`).
- **Real usage:** one IP fires `cpu_count()+` concurrent `/bulk_calculate` near the per-request timeout; all are admitted because none has booked its cost yet.
- **Suggested fix:** reserve/record an estimated cost at admission, or hold a per-IP concurrency gate.

### NB-26 — dynamic TX-extract trusts unbounded `txExtractFields` from the request
- **Location:** `backend/graph_logic.py` (`_tx_field_extract_fields` / `_calculate_dynamic_tx_field_extract`).
- **Real usage:** POST a node with `txExtractFields: [...5000 strings...]`; the backend returns a node with 5000 output ports/values (amplification; the frontend caps the UI, the backend doesn't).
- **Suggested fix:** cap the field count server-side (mirror the frontend `TX_FIELD_EXTRACT_MAX_OUTPUTS`).

### NB-27 — taproot_sighash_default opaque crash on out-of-range/negative amounts
- **Location:** `backend/calc_functions/calc_func.py:~1156-1159` (`amounts = [int(a) for a in amounts_raw]`).
- **Real usage:** pass an amount of `-1` or `≥ 2^64`; the node dies with an opaque `struct.error: argument out of range` instead of a clear validation message.
- **Suggested fix:** validate each amount is an integer in `[0, 2^64)` and raise a clear error.

### NB-28 — extract_tx_field rejects 0x-prefixed (or odd-length) tx hex
- **Location:** `backend/calc_functions/calc_func.py:~3721-3725` (`raw_hex` passed straight to `_deserialize_tx_cached`).
- **Real usage:** paste a tx hex with a leading `0x`; it raises a cryptic `non-hexadecimal number found in fromhex()` — even though other nodes accept the `0x` prefix.
- **Suggested fix:** route `raw_hex` through `_bytes_from_even_hex` (strips `0x`, validates) like the rest.

### NB-29 — logConfig ships with `nodeOperations` + `flow` channels enabled by default
- **Location:** `src/lib/logConfig.ts:~15` (`nodeOperations: true`), `:~19` (`flow: true`).
- **Real usage:** any non-production build spams the console on each recalc, contradicting the file's own "opt-in, never opt-out" contract. (Now actively used by the dangling-edge prune log.)
- **Suggested fix:** default both channels to `false`.

### NB-30 — ScriptExecutionSteps shows a stale step when a recalc yields the same step count
- **Location:** `src/components/dialog/ScriptExecutionSteps.tsx:~400-403` (reset effect deps `[steps?.length, open]` — content-blind).
- **Real usage:** open the steps dialog at step 3, edit an input so a different trace with the same step count is computed; the dialog keeps index 3 over the new trace's data.
- **Suggested fix:** key the reset on a content signature of the trace, not just its length.

### NB-31 — FlowActionsContext value is a new object literal every Flow render
- **Location:** `src/contexts/FlowActionsContext.tsx` provider; value source in `Flow.tsx`.
- **Real usage:** dragging re-renders Flow each frame, minting a new `{groupWithUndo, ungroupWithUndo}` and re-rendering every GroupNode consumer (same family as the now-fixed NB-17).
- **Suggested fix:** `useMemo` the context value (and stabilize its callbacks), exactly like the NB-17 fix.

### NB-32 — markdown block-stash sentinel collides with user text
- **Location:** `src/lib/markdown.ts:16` (`BLOCK_TOKEN`), `:~247` (sentinel template). *(The NB-22 fix added a second namespace `@@RAWBIT_MD_INLINE_N@@`, so fix both together.)*
- **Real usage:** a TextInfoNode containing the literal `@@RAWBIT_MD_BLOCK_0@@` renders with that line dropped or replaced by an unrelated code fence.
- **Suggested fix:** use a non-typeable sentinel (e.g. a private-use Unicode marker) for both block and inline stashes.

### NB-33 — dead `fieldCountToAdd` group-definition field
- **Location:** `src/types/flow.ts:32` (decl); `src/components/sidebar-nodes.ts` (~27 literals); consumed nowhere.
- **Real usage:** "add a Taproot prevout instance" on Verify Script adds 2 fields though `fieldCountToAdd` claims 1; the flag is dead and misleading.
- **Suggested fix:** remove the field (and its literals), or wire it into the group-grow logic.

### NB-34 — bip67_sort_pubkeys `hasOutputHandle: false` is a dead flag
- **Location:** `src/components/sidebar-nodes.ts:3869` (zero consumers repo-wide).
- **Real usage:** the node still renders a connectable output; wiring it into a hex-expecting input sends the non-hex string `"2,4,1,3"` downstream with no warning.
- **Suggested fix:** honor the flag (suppress the output handle) or make the node terminal/informational.

### CODEX-04 — empty byte/text values blocked by the generic required-input gate
- **Location:** `backend/graph_logic.py:~359` (`inputs[param] in ("", None)` rejects `""` for every required param).
- **Real usage:** `text_to_hex("")`, `hash160_hex("")`, `encode_script_push_data("")` are mathematically valid (`""`, a real digest, `"00"`) but the node returns `Missing required param 'val'`.
- **Suggested fix:** add an `allowEmpty` flag in `FUNCTION_SPECS` and accept `""` only for byte/text helpers where empty is domain-valid; keep strict rejection for keys/sigs/addresses/scripts. *(Or close as `wontfix` if blank = "not ready" is intended policy.)*

---

## ⏸️ Deferred (owner decision)

### CODEX-01 — npm high-severity advisories (transitive)
- **Severity:** high (hygiene) · **Status:** deliberately deferred ("not touching Trezor bugs for now").
- **Source:** 4 advisories via `@trezor/connect-web` (axios/ws/form-data/protobufjs — bundled altcoin libs, mostly inert in the browser bundle); 3 via `tailwindcss-animate → tailwindcss` build toolchain (glob/minimatch/picomatch — build-time only). You're already on the latest `@trezor/connect-web`, so there's no version to bump.
- **Suggested fix:** a `package.json` `overrides` block forcing the in-major patched versions (`axios ^1.18`, `ws ^8.21`, `form-data ^4.0.6`, `protobufjs ^7.6.4`, `picomatch ^2.3.2` → clears 5 of 7), then smoke-test the Trezor flow. Do **not** run `npm audit fix --force` (it downgrades Trezor). The 2 major-only ones (glob/minimatch) are build-time — document as accepted or bump Tailwind.

---

*Re-verification method: independent per-finding pass that read the cited code in the
current tree and judged fix-present-and-complete vs still-reproduces; the two residuals
(NB-14, NB-18) were surfaced by that pass, not by the original audit.*
