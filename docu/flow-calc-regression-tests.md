# Flow calculation regression tests

Published lesson flows persist their computed values (`data.result`, `scriptDebugSteps`) in
`src/my_tx_flows/*.json` — the committed file is itself a golden. Three test tiers verify
that backend calculation and the frontend rules that shape what the backend receives still
reproduce those published values, and that a tweak → recalc → restore → recalc cycle
returns to them exactly.

## The three tiers

| Tier | Where | What it catches | Run with |
|---|---|---|---|
| Backend golden corpus | `backend/tests/test_flow_goldens.py` | Any backend calc change that alters a published result or script trace; cross-flow cache/sentinel leakage; recalc non-idempotence | `.myenv/bin/python -m pytest backend/tests -q` (repo root) |
| Backend roundtrip | `backend/tests/test_flow_roundtrip.py` | Tweak → assert results change → restore → recalc → equals committed goldens, per lesson | same |
| Frontend canonical snapshots | `src/lib/__tests__/calcGraphCanonical.test.ts`, `shareRoundtripIntegrity.test.ts`, `bulkCalculateContract.test.ts` | Changes to the import/normalization pipeline (what the backend *receives*), export→share→import mutation of calc-relevant data, and the exact `/bulk_calculate` request body shape | `npx vitest run src/lib/__tests__` |
| Frontend calc-behavior payloads | `src/integration/__tests__/calcPayload.{core,behaviors,p1}.integration.test.tsx` (+ `calcPayloadHarness.tsx`) | What the frontend sends *after realistic interactions* on the intro flow: group add/remove/re-add hygiene, sentinel set/unset (incl. on connected inputs), dynamic tx-extract field add/remove with edge hygiene, disconnect/reconnect fallback, error rounds (calc error / 429 / network / timeout) leaving inputs uncorrupted, stale-response race, copy/paste aliasing, dirty-flag contract, response application, network selector / undo-redo / save-share roundtrips — all asserted on the captured `/bulk_calculate` request body | `npx vitest run src/integration/__tests__` |
| E2E golden roundtrip | `tests/e2e/flow.roundtrip.spec.ts` | The whole chain through the real UI and real backend for every current p0–p11 lesson: first full calculation must reproduce every committed result and the full script trace; then value tweak → recalc → changed → restore → recalc → equals committed (every `script_verification` trace compared, not just the anchor) | `npx playwright test tests/e2e/flow.roundtrip.spec.ts --project=chromium` (requires the backend: `.myenv/bin/python backend/routes.py`; the spec skips with a message if `/healthz` is unreachable). Chromium-only by design: the goldens pin backend results, which engines cannot influence, and per-engine runs contend for the backend's per-IP calculation budget. Waits use `waitForSettledBulkResponse` (no-errors + full node set + anchor results), never the first raw response. |

Shared backend test helpers (lesson loading, literal backfill) live in
`backend/tests/flow_test_utils.py`.

Supporting guards (in `backend/tests/test_calc_func.py`):

- **Determinism canaries** — ECDSA (`sign_tx_rfc6979`, `sign_as_bitcoin_core_low_r`) and
  Schnorr signing must produce identical signatures for identical inputs. All goldens depend
  on deterministic nonces; these fail with an explanatory message if that ever changes.
- **Official vectors** — BIP143 (Native P2WPKH example, intermediates + sighash + published
  signature) and BIP341 (`taproot_sighash_default`, keyPathSpending input 4) pin
  *correctness*, not just stability: goldens alone would enshrine a bug that existed when
  they were captured; the BIP vectors anchor the sighash primitives to the spec.
- **Cross-contamination** — calculating flow A then flow B in one process must equal B
  calculated alone, and calculating the same flow twice must be identical (guards
  module-level caches and sentinels).

The only nondeterministic node function is `random_256` (`secrets.token_bytes`); it is
excluded from golden comparison. The Trezor lesson (hardware) and `empty.json` are skipped.

## Updating goldens deliberately

When a calculation change is *intentional* (fixed bug, new trace format), refresh the
published lessons explicitly:

```
UPDATE_FLOW_GOLDENS=1 .myenv/bin/python -m pytest backend/tests/test_flow_goldens.py -q
```

This rewrites stale `data.result` / `scriptDebugSteps` values in the lesson JSONs with a
formatting-preserving writer (validated byte-for-byte against the existing files, so diffs
are surgical), then fails with a message telling you to review the diff. Lesson changes
therefore always appear as reviewable diffs of the published files in the PR — never as
silent test edits. The allowlists in `test_flow_goldens.py` (`STALE_STEPS_NODES`, the
`old/p10` float-precision entries) also assert in reverse: if an allowlisted node *starts*
reproducing, the test demands removing it, so the lists can only shrink.

## Bugs found by these suites

- **Group-instance removal left stale values (fixed 2026-06-12).** `useGroupInstances.handleGroupSize`
  popped `groupInstanceKeys` on remove but kept the instance's committed values in `inputs.vals`:
  the stale value shipped in every subsequent `/bulk_calculate` payload and silently *resurrected*
  when an instance was re-added (the next-gap index reuses the removed offset). Fixed in the
  decrement branch (values cleared via `setVal`); pinned by the wire-level P0-1 assertions and a
  focused multi-field regression test.
- **Pinned, not a bug, but worth knowing:** any error round wipes a `script_verification` node's
  result and nulls its cached steps (`mergePartialResultsIntoFullGraph`); a successful recompute
  restores them. Asserted explicitly in the 429 test.

## Known drift (recorded 2026-06-12, lessons intentionally not auto-fixed)

- **`old/p10_Wrapped_Addresses.json`** — two `math_operation` results were committed in the
  float era (`0.3075916230366492`) while the backend now computes with `Decimal`
  (`0.30759162303664921465…`). Results-level drift in published (old) content.
- **53 nodes across 16 `old/` lessons** carry `scriptDebugSteps` in the pre-current debugger
  format (`"unknown opcode"` instead of `"PUSH n bytes"`, missing
  `witnessRulesEnabled`/`MINIMALDATA`, removed `amountUsed`). Their *results* all still
  reproduce — only the stored traces are stale. Listed per flow in `STALE_STEPS_NODES`.
- **All twelve current p0–p11 lessons reproduce 100%** — results and complete traces.

Running the `UPDATE_FLOW_GOLDENS` command above and reviewing the diff resolves both points
when desired.
