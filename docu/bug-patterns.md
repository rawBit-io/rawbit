# Bug patterns

Last updated: 2026-06-16

Purpose: reusable bug classes for future periodic audits. Each future audit should add new confirmed patterns and update stale ones.

## Production dependency advisory drift

Signals:

- `npm audit` fails with high or moderate advisories in the production dependency graph.
- Forced audit fix suggests a breaking downgrade or major upgrade.
- Existing `overrides` pin a version that is now below the advisory fixed range.
- Build-only or unused packages are listed under `dependencies`, so they appear in production audit output.

Audit checks:

- Run `npm audit --omit=dev --audit-level=moderate`.
- Inspect direct dependencies in `package.json`.
- Identify whether advisories sit in browser-facing product paths, server/build-only paths, or unused packages.
- Use import search and `npm ls --omit=dev <package>` to separate reachable product paths from cleanup/reclassification paths.
- Do not blindly apply `npm audit fix --force`.

Preferred fixes:

- Apply non-breaking audit fixes first.
- Upgrade direct dependencies when possible.
- Remove unused direct dependencies.
- Move build-only packages to dev dependencies when possible.
- Use `overrides` only with compatibility testing and an expiry/owner.
- Add a CI gate for high-severity production dependency advisories.

Regression gates:

- `npm audit --omit=dev --audit-level=high`
- `npm run build`
- `npm test`
- relevant product smoke tests for the touched package family

## Sidebar taxonomy drift

Signals:

- New sidebar nodes introduce a category/subcategory not present in the integrity-test taxonomy.
- `allSidebarNodes` renders a new group that was not intentionally added to docs/tests.
- Node labels are visible in the app but not represented in expected taxonomy sets.

Audit checks:

- Compare `src/components/sidebar-nodes.ts` categories/subcategories against `src/lib/__tests__/flowDataIntegrity.test.ts`.
- Treat a new subcategory as a product taxonomy decision, not just a test update.

Preferred fixes:

- Add the new subcategory to the allowed taxonomy when it is semantically correct.
- Otherwise move the node to the correct existing subcategory.
- Add a focused assertion for important new categories.

Regression gates:

- `npm test -- src/lib/__tests__/flowDataIntegrity.test.ts`
- Sidebar UI smoke check

## Entropy-aware golden tests

Signals:

- A function uses `secrets`, random nonces, current time, hardware wallet output, or external data.
- Saved flow JSON persists `data.result` for that function or downstream nodes.
- Golden tests compare byte-for-byte recomputation without tracking nondeterministic dependencies.

Audit checks:

- Search backend calculation functions for entropy sources.
- Compare entropy-using functions to `NONDETERMINISTIC_FUNCTIONS` or equivalent skip lists.
- Inspect downstream dependencies in saved fixture graphs.

Preferred fixes:

- Keep production cryptographic functions random by default.
- Make committed lesson fixtures deterministic with explicit nonce/salt/test entropy inputs when exact goldens are required.
- Or make the golden harness dependency-aware and skip the full nondeterministic downstream slice.

Regression gates:

- Direct deterministic/nondeterministic unit tests for the function.
- Golden test for a minimal fixture.
- Full `pytest backend/tests/test_flow_goldens.py`.

## Empty byte/text value semantics

Signals:

- A function can mathematically process empty bytes or empty text.
- Generic validation treats `""` as missing for all required params.
- Sidebar templates initialize the value to `""`, but graph execution reports missing input.

Audit checks:

- Compare direct function behavior with graph execution behavior.
- Review `FUNCTION_SPECS` for functions where required means "key must be present" rather than "non-empty string".

Preferred fixes:

- Add a narrow `allowEmpty` or equivalent spec flag.
- Keep strict blank rejection for keys, signatures, addresses, txids, scripts, and numeric fields unless the domain explicitly allows empty.

Regression gates:

- Backend graph-level tests through `bulk_calculate_logic`.
- Negative test proving security-sensitive blanks still fail.

## Audit artifact drift

Signals:

- The playbook references state or pattern files that are missing.
- New audit reports do not update reusable state.
- Previous findings must be reconstructed from historical reports.

Audit checks:

- Confirm `docu/audit-state.md` exists.
- Confirm `docu/bug-patterns.md` exists.
- Confirm the latest audit updates both files.

Preferred fixes:

- Keep a compact state ledger of open, closed, refuted, and out-of-scope findings.
- Keep this pattern library focused on reusable classes, not one-off incidents.

Regression gates:

- Manual docs check during every periodic audit.

---

# Structural code patterns (deep audit 2026-06-16)

Reusable code-level bug classes confirmed across the 2026-06-11 (`RB-*`) and
2026-06-16 (`NB-*`) audits. Every future audit greps code changed since the last
audit against all of these. Full instances: `docu/bug-audit-2026-06-16.md`.

## Tab-ownership on deferred / async writes

Signals:

- A `setTimeout`/`requestAnimationFrame`/`await`-continuation/worker callback
  writes nodes/edges/snapshots, and the only guard is a generation counter or
  nothing — no check that the active tab is still the tab that initiated it.
- Scheduler/persistence bookkeeping kept in a single `useRef` rather than a
  `Map<tabId, …>`.
- A live-canvas snapshot API (`getNodes()/getEdges()`) called with a tabId that
  may not be the active tab and no explicit `data`.

Audit checks:

- Grep `requestAnimationFrame(`, `setTimeout(`, `.then(` after an `await`, and
  `useRef(` in `useSnapshotScheduler`/`useTabs`/`Flow.tsx`/file-import paths.
- For each deferred write, confirm it captures the owning tab id at schedule time
  and re-checks `activeTabIdRef.current === ownerTabId` before writing.

Preferred fixes:

- Capture owner tab id at initiation; re-check before every deferred/async write;
  track timers so a tab switch cancels them; key per-tab bookkeeping in a Map.

Regression gates:

- Tests that switch tabs while a deferred write/recalc is in flight (undo, file
  import, after-calc snapshot) and assert the inactive tab is untouched.

Instances: RB-01, RB-05, RB-11, RB-34, RB-39 · NB-01, NB-08, NB-24. Related
(unowned animation loops): RB-20, RB-37 · NB-20, NB-21.

## Handle/port enumeration vs render divergence (both endpoints)

Signals:

- `buildPorts` / Connect-dialog / `validateFlowData` enumerate handles from one
  source while nodes render from another (e.g. `groupInstanceKeys` vs
  `groupInstances`, `outputPorts` vs `output-<i>`).
- Edge validation checks the target handle but not the source handle (or vice
  versa); a dead `hasOutputHandle`/`unconnectable` flag that the renderer ignores.

Audit checks:

- Grep `buildPorts`, `sourceHandle`, `targetHandle`, `groupInstanceKeys`,
  `outputPorts`, `hasOutputHandle`, `unconnectable`.
- Confirm connectability + validation derive from one predicate matching the
  render rules, applied to BOTH edge endpoints.

Preferred fixes:

- One shared predicate; reject/strip edges whose handle resolves to no rendered
  handle on either endpoint; remove dead flags or honor them in the renderer.

Regression gates:

- Import a flow with a source/target handle that no longer exists and assert
  `validateFlowData` flags it; Connect-dialog target tests for legacy nodes.

Instances: RB-09, RB-28, RB-40, RB-54, RB-55 · NB-03, NB-09, NB-19, NB-34.

## Stale companion value / uncommitted edit on structural change

Signals:

- Removing/retyping a dynamic field or output leaves its `outputValues[...]`,
  edge, or cached value behind; index drift between display order and data order.
- An in-progress edit (`useState` draft + `onCommit` on blur/Enter) with no
  flush on unmount, in a node that can unmount off-viewport
  (`onlyRenderVisibleElements`).

Audit checks:

- Grep `outputValues`, `txExtractFields`, dynamic `+`/`-` handlers, `setNodes`
  updaters computing a removed handle inside the updater, and every
  `titleDraft`/draft `useState` + `onCommit` for an unmount flush.

Preferred fixes:

- Compute removed handle/value before mutating; clear companion value/edge in the
  same op; commit drafts on unmount; index by stable key not display position.

Regression gates:

- Retype/remove a dynamic field and assert no stale output; edit a title then
  scroll the node off-viewport and assert the edit persists.

Instances: RB-09, RB-25, RB-26, RB-30, RB-56, RB-57 · NB-04, NB-12, NB-15, NB-23.

## React context value identity churn

Signals:

- A context `Provider value={{ … }}` (or a value built without `useMemo`) is a
  fresh object every parent render, re-rendering all consumers (sometimes
  mid-drag).

Audit checks:

- Grep `Context.Provider value={` and `createContext` consumers; confirm the
  value is `useMemo`'d on stable deps.

Preferred fixes:

- `useMemo` the context value; stabilize callbacks with `useCallback`.

Regression gates:

- Render-count assertions for node components on an unrelated parent state change.

Instances: RB-07 · NB-17, NB-31.

## Backend resource bounds & typed errors on adversarial input

Signals:

- Per-client state (windows, caches, registry sets) that only grows; a
  check-then-record race; an expensive copy/serialize outside any timeout guard.
- Counts/sizes taken from the request without a cap (`numInputs`,
  `inputStructure`, `groupInstanceKeys`, `txExtractFields`).
- `struct.pack/unpack` or `bytes.fromhex` that throws an opaque error on
  consensus-valid-but-unusual or malformed input; `0x`-prefix handling that
  diverges between helpers.

Audit checks:

- Grep `_Window`, `@lru_cache`, module-level `set()/{}`, `struct.(pack|unpack)`,
  `bytes.fromhex`, `request.get_json`, and every request-derived count for a cap.

Preferred fixes:

- Bound every attacker-controlled count/size and per-client structure; make
  check-and-record atomic; validate shape and raise typed errors instead of
  letting `struct`/parse throw; share one hex-normalization helper.

Regression gates:

- Negative tests: oversized counts, malformed/odd/`0x`-prefixed hex,
  out-of-range amounts, and concurrent over-budget requests.

Instances: RB-13, RB-14, RB-15, RB-16, RB-42, RB-43, RB-44, RB-47 · NB-10, NB-11,
NB-18, NB-25, NB-26, NB-27, NB-28.

## Cryptographic correctness for educational crypto features

Signals:

- A verify function normalizes/relaxes its input before checking (e.g. high-S →
  low-S) so it accepts values the network would reject.
- A bespoke encryption construction (raw HMAC keystream, deterministic ephemeral
  key + salt) with no integrity tag and a keystream-reuse hazard.

Audit checks:

- Read every new `*_sign`/`*_verify`/`ecies_*`/`*_sighash_*` for: malleability
  acceptance, missing integrity, nonce/keystream reuse, and crashes on edge
  consensus values.

Preferred fixes:

- For an educational tool, surface (don't silently accept) non-canonical inputs;
  add integrity tags; default to non-deterministic ephemeral material; document
  the construction's guarantees.

Regression gates:

- Vectors: high-S signature rejected, ECIES tamper detected, repeated-nonce
  warning, BIP vectors green.

Instances: NB-13, NB-14 (and the robustness sibling RB-14 / NB-27).
