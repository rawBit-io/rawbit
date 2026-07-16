# Audit state

Last updated: 2026-07-16

Primary playbook: `docu/periodic-bug-audit-playbook.md`

Latest full audit report: `docu/bug-audit-2026-06-16.md`

## DA-01..DA-21 fix pass — 2026-07-16 (all 21 FIXED)

The 2026-07-07 diff audit's 21 findings (DA-01..DA-21) were re-verified against
the current tree and fixed. Two were already fixed by intervening commits and
confirmed as such: DA-02/DA-03 (bundled-edge reconnect/delete resolved against
the canonical store by `880c30e`) and DA-09 (paste radio remap by `432fabd`).

Fixed in this pass:
- **Draft-flush class (DA-01/05/12/14/17)** — class-level unmount flush added to
  both `EditableLabel` variants and `TerminalField`; `common/EditableLabel`
  skips the self-flush when `onDraftChange` is set (GroupNode owns that flush).
  DA-05 got a `connected.hasEdge` guard in `ScriptViewerNode.handleValueBlur`;
  DA-17 a ref-held flush for the TX custom-field drafts in `CalculationNodeView`.
- **DA-04** — portal node-menu dismiss is now target-aware: the canvas
  pointerdown-capture skips `[data-node-portal-menu]` (menu container + anchor),
  so menu actions activate and the More toggle can close.
- **DA-06** — dynamic TX field extract ships per-field `outputErrors`
  (tombstoned, not popped); the row renders the error in destructive style
  instead of a silent `--`.
- **DA-07** — a dropped radio node is marked dirty and dirties its channel peers.
- **DA-08** — `getAffectedSubgraph` pulls in every radio node on an affected
  node's channel, so the backend sees the full channel population (fixes the
  duplicate-sender mis-match/mis-diagnosis; single-sender case was already fixed).
- **DA-10** — `buildSharePayload` prunes handle-dangling edges before export.
- **DA-11** — occupancy checks (`getOccupiedTargetHandles`, the drag-connect
  duplicate guard) ignore edges hidden as dangling by the render projection.
- **DA-13** — bip110 error paths ship the `showHandle:false` sentinel outputPorts
  instead of `[]` (which rendered a phantom "out" handle).
- **DA-15** — Script Viewer upstream-error banner no longer promises a stale
  result over a blank box (tombstoned upstreams ship `""`).
- **DA-16** — the TS and Python disassembler hex-cleaning whitespace class is
  pinned identically (BOM/NEL/file-separators) on both sides.
- **DA-18** — pasted radio channels are reserved so a fresh Send channel can't
  capture a kept pasted Receive.
- **DA-19** — GroupNode menu delete routes through `rf.deleteElements` so the
  shared `onDelete` pipeline (consumer + radio-peer dirtying) runs.
- **DA-20** — closing a tab discards its scheduler frames + pending after-calc
  entry (`discardTabSnapshots`), preventing post-close snapshots and state
  inherited by a recycled tab id.
- **DA-21** — `useNodeOperations.fitGroupToChildren` gained the NB-05 group-origin
  compensation its sibling `fitGroupToChildrenInNodes` already had (no jolt).

Gates (2026-07-16): typecheck Pass; lint Pass (0 warnings); vitest 797/797;
`pytest backend/tests` 505 passed, 2 failed — the 2 failures are the p13/p14
lesson-flow goldens added by 69de6ac and are **pre-existing/stale at that commit**
(they fail identically on a clean checkout, unrelated to these fixes; refresh
needed). `npm audit` unchanged (deferred CODEX-01).

## Current open findings

| ID | Severity | Area | Owner | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| RB-AUDIT-2026-06-16-01 | High | Production dependency graph | Unassigned | Open | Reduce `npm audit` advisories, starting with high severity product-runtime paths and removing/reclassifying unused or build-only production dependencies. |
| RB-AUDIT-2026-06-16-02 | Medium | Sidebar taxonomy | Unassigned | Open | Make ECIES node taxonomy and the integrity test agree. |
| RB-AUDIT-2026-06-16-03 | Medium | Flow goldens / ECIES entropy | Unassigned | Open | Define deterministic fixture policy or entropy-aware golden handling. |
| RB-AUDIT-2026-06-16-04 | Low | Empty byte/text input semantics | Unassigned | Open | Add narrow `allowEmpty` validation semantics and backend graph tests. |

## Current out-of-scope gate blockers

| ID | Scope | Area | Status | Next action |
| --- | --- | --- | --- | --- |
| RB-AUDIT-2026-06-16-OOS-01 | `src/my_tx_flows` | P5 graph handle | Open | Repair `edge_xRTVL33s` target handle for `node_k87GKtyf`. |
| RB-AUDIT-2026-06-16-OOS-02 | `src/my_tx_flows` | P5 committed goldens | Open | Refresh only after graph structure and ECIES entropy policy are fixed. |

## Process findings

| ID | Status | Note |
| --- | --- | --- |
| RB-AUDIT-2026-06-16-05 | Closed | `docu/audit-state.md` and `docu/bug-patterns.md` were missing and are now seeded. |

## Last verified gates

| Gate | Last result | Date | Notes |
| --- | --- | --- | --- |
| `npm run typecheck` | Pass | 2026-06-16 | TypeScript project references passed. |
| `npm run lint` | Pass | 2026-06-16 | ESLint passed with zero warnings. |
| `npm test` | Fail | 2026-06-16 | Fails on ECIES taxonomy and excluded P5 graph data. |
| `npm run build` | Pass with warnings | 2026-06-16 | Large chunk and mixed import warnings remain. |
| `npm run test:e2e -- --project=chromium` | Pass | 2026-06-16 | 58 tests passed. |
| `pytest backend/tests` | Fail | 2026-06-16 | Fails on excluded P5 flow goldens. |
| `pytest backend/tests --ignore=backend/tests/test_flow_goldens.py` | Pass | 2026-06-16 | 311 tests passed; coverage 91.99%. |
| `npm audit --omit=dev --audit-level=moderate` | Fail | 2026-06-16 | 30 vulnerabilities, including 7 high. |

## Refuted or not confirmed in latest audit

These classes were checked during the 2026-06-16 pass and were not reopened as confirmed bugs:

- Previous active-tab autosave overwrite class.
- Previous dynamic-input unbounded count class.
- Previous shared-graph stale reapply class.
- Previous markdown raw-HTML and unsafe-link XSS class.
- Previous group-parent cycle class.
- Previous backend timeout cleanup class.

## Next audit starting points

1. Start with this file, then read `docu/bug-patterns.md`, then the latest dated report.
2. Re-run all gates in the latest report.
3. Re-check the current open findings before looking for new classes.
4. Keep `src/my_tx_flows` scope explicit if a future user again excludes it, because several repo gates still load those files.

---

# Deep code audit — 2026-06-16 (NB-01..NB-34)

A separate, deeper multi-agent code audit ran the same day (full
finder → dedup → 3-lens verification-panel pipeline over all of `src/` except
`my_tx_flows` + `backend/`). Report:
[`bug-audit-2026-06-16.md`](bug-audit-2026-06-16.md). **34 confirmed
(0 critical, 4 high, 18 medium, 12 low); 11 refuted.** All 34 are **OPEN**
(no fixes applied). This complements the gate/dependency findings above; the IDs
do not overlap (`NB-*` vs `RB-AUDIT-*`).

**High-severity (act first):**

| ID | Area | Title |
|---|---|---|
| NB-01 | snapshot-undo | Global (non-per-tab) after-calc/coalesce refs: editing tab B abandons tab A's pending snapshot (multi-tab generalization of RB-11). |
| NB-02 | trezor | Failed `TrezorConnect.init()` caches the rejected promise → all Trezor actions dead for the session. |
| NB-08 | flow-core | History-load deferred `setEdges` has no tab-ownership guard → undo on one tab writes restored edges onto another tab after a switch. |
| NB-09 | flow-lib | `validateFlowData` never validates edge `sourceHandle` against the source node's outputs → clean-validating flows compute wrong/empty values. |

The full 34-row table, evidence, fixes, and per-finding panel votes are in the
report. Cross-cutting classes are in [`bug-patterns.md`](bug-patterns.md)
(patterns 1–9).

## Coverage ledger (deep audit)

Rotation = oldest `last audited` wins; next-due reflects risk (security/crypto,
data-loss-prone, dynamic-technique-pending rotate first).

| Area | Last audited | Found | Next due |
|---|---|---|---|
| Tabs / persistence / archive | 2026-06-16 | 0 | 2026-07-14 |
| Flow.tsx core (history-load, snapshot wiring) | 2026-06-16 | 1 (NB-08) | 2026-06-30 |
| Canvas / panels / dialog-layer / flow contexts | 2026-06-16 | 2 (NB-17, NB-31) | 2026-07-14 |
| Snapshot scheduler + undo/redo (+ coalesce) | 2026-06-16 | 2 (NB-01, NB-07) | 2026-06-30 |
| Flow interactions / connect / hotkeys | 2026-06-16 | 1 (NB-06) | 2026-07-14 |
| Node operations / highlight | 2026-06-16 | 0 | 2026-07-21 |
| Copy / paste (group parenting) | 2026-06-16 | 1 (NB-05) | 2026-07-14 |
| Calc-node mutations / derived / group-instances / field-extract | 2026-06-16 | 2 (NB-03, NB-04) | 2026-06-30 |
| CalculationNode view + field components | 2026-06-16 | 0 | 2026-07-21 |
| Calculation hook / limit recovery / log config | 2026-06-16 | 1 (NB-29) | 2026-07-14 |
| Flow lib (validate / schema / graph / id-utils) | 2026-06-16 | 2 (NB-09, NB-18) | 2026-06-30 |
| Group edge bundling (+ Safari segment edge) | 2026-06-16 | 1 (NB-19) | 2026-07-14 |
| Group / TextInfo / OpCode node components | 2026-06-16 | 1 (NB-23) | 2026-07-14 |
| Share / file-ops / shared-flow loader | 2026-06-16 | 1 (NB-24) | 2026-06-30 |
| Dialogs (Connect / ScriptSteps / NodeCode / Share / SoftGate) | 2026-06-16 | 2 (NB-16, NB-30) | 2026-07-14 |
| Layout / UI panels (TopBar / Sidebar / Search / Save / theme) | 2026-06-16 | 0 | 2026-07-21 |
| `sidebar-nodes.ts` templates (3 line-range slices) | 2026-06-16 | 2 (NB-33, NB-34) | 2026-07-14 |
| Help system (menu / demos / runtime) | 2026-06-16 | 2 (NB-20, NB-21) | 2026-07-21 |
| Markdown / opcodes / utils / device / app-shell | 2026-06-16 | 2 (NB-22, NB-32) | 2026-07-21 |
| Trezor connect | 2026-06-16 | 1 (NB-02) | 2026-07-14 |
| Backend API / routes / budget / config | 2026-06-16 | 3 (NB-10, NB-11, NB-25) | 2026-06-30 |
| Backend `graph_logic.py` | 2026-06-16 | 2 (NB-12, NB-26) | 2026-06-30 |
| `calc_func.py` crypto / sighash / ECIES | 2026-06-16 | 3 (NB-13, NB-14, NB-27) | 2026-06-30 |
| `calc_func.py` script-exec / tx-parse / op_return / hex | 2026-06-16 | 2 (NB-15, NB-28) | 2026-06-30 |
| Backend `function_specs.py` / `codeview_expander.py` | 2026-06-16 | 0 | 2026-07-21 |
| `src/my_tx_flows/` (lesson flows) | — | excluded | per release audit |

**Dynamic techniques not yet run** (highest-value next step, esp. backend
parse/crypto): Hypothesis property fuzzing of parse/serialize roundtrips ·
mutation testing of `calc_functions/` + `graph_logic.py` + `src/lib/flow/` ·
prod-build e2e · long-session heap/listener smoke.

## Refuted registry (deep audit, 3-lens panel)

Reported by a finder but **not confirmed** (<2 real votes). Fed into future finder
prompts as "known, do not re-report". Full write-ups: report's Dropped-findings.

- **closeOtherTabs discards active tab's unsaved edits when keeping a background tab** (`useTabs.ts`, claimed medium, 0/3) — by design: the active tab is one of the tabs the user explicitly chose to close; proposed save is a no-op (archive deleted immediately after).
- **useFlowHotkeys double-paste (keydown 'v' + native 'paste')** (`useFlowHotkeys.ts`, medium, 1/3) — the two handlers are mutually guarded; no real double-paste path.
- **clearHighlights leaves node.selected stuck-selected** (`useHighlight.ts`, low, 1/3) — selection reset on the normal paths; no reachable stuck state.
- **Copy/paste drops node↔group bundle-port offsets** (`useCopyPaste.ts`, medium, 1/2) — premise false: users cannot produce a node↔group offset key (only group↔group persisted).
- **connectionStatus over-counts inputs on group-instance offset collision** (`useCalcNodeDerived.ts`, low, 0/1) — dedup asymmetry real but symptom/trigger wrong; no visible miscount.
- **Empty Script Type defaults to SPENDADDRESS** (`connect.ts`, medium, 0/3) — empty-coercion path unreachable via the only production caller.
- **Taproot "Merkle Path Leaf" clamp vs backend reset mismatch** (`CalculationNodeView.tsx`, medium, 0/3) — dropdown cannot emit an out-of-range index in practice.
- **Identity-node edit leaves stale `extendedError`** (`useCalculation.ts`, low, 0/3) — cosmetic only; not rendered when `error:false`.
- **checkForCyclesAndMarkErrors TypeError on dangling edge** (`graphUtils.ts`, medium, 1/3) — affectedNodes always includes both endpoints on reachable paths; no crash.
- **GroupBundleSegmentEdge renders NaN SVG path** (`GroupBundleSegmentEdge.tsx`, medium, 0/3) — React Flow v12.3.5 never invokes the custom edge with NaN coords for fresh nodes.
- **Tab rename Escape/Enter double-commit** (`TopBar.tsx`, low, 1/3) — commit is idempotent on the real teardown order; no double-commit.

## Deferred registry (deep audit)

- **`markdown.ts` hard-breaks behavior** — flagged in p01 review, deferred again; distinct from RB-60/RB-61 (fixed) and NB-22/NB-32 (new, open). Owner decision pending.
- **UI audit findings (contrast / a11y / topbar)** — proposed 2026-06-10, tracked separately, not implemented.
- **NB-13 / NB-14 (ECIES + verify_signature crypto design)** — confirmed but are *design judgments* for an educational tool: whether to reject high-S ECDSA signatures and add an ECIES integrity tag / non-deterministic ephemeral key. Owner decision pending before fixing.

## Flake quarantine (deep audit)

| Test | Observed | Suspected mechanism | Last re-verified |
|---|---|---|---|
| `Flow.selectionMode.test.tsx` › "renders the intro flow directly in mobile read-only mode" | 2026-06-11 | timing-sensitive spy on scheduled `setViewport` (~1/3 full runs); pattern-2 family; a generation-checked viewport apply would likely stabilize it | 2026-06-11 |
| `script.debug.persistence.spec.ts` › "shared flow retains script steps after reload" | 2026-06-11 | load-dependent reload timing; failed once in a full e2e run, passed in isolation | 2026-06-11 |

## Escapes (deep audit)

- **NB-23 — regression of RB-26.** RB-26 (in-progress edits lost on viewport unmount) was fixed 2026-06-12 but did not cover the **GroupNode title** edit path, which still drops the draft on off-viewport unmount. *Missed because* the RB-26 fix was scoped to calc-node fields / TextInfo comments; GroupNode's separate `titleDraft` commit path was excluded. *Action:* re-grep all `useState` edit-draft + `onCommit` paths for an unmount flush (pattern 6).
- **NB-09 — source-side handle validation gap.** The prior audit found RB-30 (dangling edges) and RB-09 (target-side stale handles) but missed that `validateFlowData` never validates `sourceHandle` at all. *Action:* pattern 3 now requires both endpoints.
- **NB-03 / NB-18 / NB-19** — pre-existing handle-enumeration / validation-bound gaps in code present at the prior audit; legacy/un-migrated-node and non-`numInputs` count paths were outside the prior finders' explicit triggers.
