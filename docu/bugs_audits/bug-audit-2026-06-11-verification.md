# rawbit bug audit verification report

Date: 2026-06-11

Source audit: `docu/bug-audit-2026-06-11.md`

Scope: I verified the two HX branch findings and all RB-01 through RB-62 findings against the current workspace. The current checked-out branch is `main`; the `feature/hex-to-flow` branch exists locally and was inspected with `git show` without changing branches.

## Verification Method

I used three verification levels:

- Runtime-reproduced: I invoked the defective path with a focused Python or Vitest repro and observed the failure or faulty state.
- Source-confirmed: I traced the current code and confirmed the defective ordering, missing guard, unbounded operation, or stale-state path. This was used mainly for browser timing/race defects where a deterministic unit repro would require a full app harness.
- Branch-source-verified: The finding is branch-specific; I verified that the branch contains the documented fix shape.

Focused checks run:

- Backend repros with `.myenv/bin/python`, including `script_verification`, `taproot_sighash_default`, `bulk_calculate_logic`, Flask `/bulk_calculate`, Redis budget tracker fakes, and code-view expansion.
- Frontend repros with a temporary `tmp/codex-bug-audit-verification.test.ts` file and `npx vitest run tmp/codex-bug-audit-verification.test.ts --reporter=verbose`; that temporary file was removed after the run. The suite had 16 passing tests covering RB-09, RB-13, RB-23, RB-28, RB-29, RB-30, RB-31, RB-40, RB-41, RB-54, RB-55, RB-57, RB-58, RB-59, RB-60, and RB-61.
- Static branch checks with `git show feature/hex-to-flow:...` for HX-1/HX-2.

## Overall Conclusion

I did not find any finding that should be fully refuted. A few findings need wording refinements:

- RB-09 is missed by the existing synchronous unit mock, but the installed React Flow `useReactFlow().setNodes` batches functional updates, so the real app path is still vulnerable.
- RB-46 leaks `_preflightErrors` always on the timeout path; `_invalidEdge` leaks only if timeout occurs before that node is visited.
- RB-49 can technically omit Cancel by passing an empty string, but the Information dialog does not pass one, so the user-facing redundant Cancel is real.
- HX-1/HX-2 were source-verified on `feature/hex-to-flow`; I did not rerun that branch's Playwright render suite in this pass.

## Executive Overview

Priority mapping: P0 = critical data loss/security impact, P1 = high user or correctness impact, P2 = medium workflow/correctness impact, P3 = low polish, resilience, or bounded-impact defect.

| ID | Prio | Executive summary | What will go wrong |
|---|---:|---|---|
| HX-1 | P1 | Rebuilt transaction tabs could open with the wrong viewport. | Users see only a tiny corner of a large generated flow and may think the rebuild failed or produced missing nodes. |
| HX-2 | P2 | Generated hex-to-flow layouts used row spacing that ignored tall constants. | Rendered nodes overlap, making rebuilt transaction lessons hard to read and interact with. |
| RB-01 | P0 | Auto-refresh saves every inactive tab using the active canvas. | A version reload can permanently replace other tabs' flows with copies of the active tab. |
| RB-02 | P1 | Verify Script's no-transaction mode uses an invalid dummy tx. | Leaving tx hex blank always errors before script execution, breaking the documented standalone debugger mode. |
| RB-03 | P1 | The 2-of-3 multisig template has an extra `OP_2`. | Users can build invalid multisig scripts; funded outputs based on them would be unspendable. |
| RB-04 | P1 | Cycle markers are not cleared after a graph cycle is fixed. | Nodes remain disabled and in error state even after the user removes the cycle. |
| RB-05 | P1 | Shared-flow repair writes to the active tab without checking target tab. | A delayed import repair can overwrite the graph in whatever tab the user is viewing. |
| RB-06 | P1 | Script Steps reads an out-of-range trace step after recalculation shrinks steps. | Opening or keeping the dialog open can crash the app when trace length changes. |
| RB-07 | P1 | Calculation nodes subscribe with a fresh `Map` selector on every store update. | Large canvases can re-render every calculation node on unrelated changes, causing major UI slowdown. |
| RB-08 | P1 | Group/Text nodes push undo snapshots through the wrong path. | Edits can be treated like undo navigation, leaving stale dirty/calculation state and broken history behavior. |
| RB-09 | P1 | Removing a tx-extract output computes edge cleanup too late. | Edges connected to deleted output handles remain and point at invisible/nonexistent outputs. |
| RB-10 | P1 | Large selection deletion snapshots nodes and edges at different times. | Undo can restore a corrupted graph with pre-delete nodes and post-delete edges. |
| RB-11 | P1 | Pending after-calc history can be captured by the wrong tab. | The edited tab loses its intended history entry while another tab receives unrelated snapshot state. |
| RB-12 | P1 | Tab switching drops raw data while compression is still pending. | Switching back can restore stale compressed data and lose recent edits. |
| RB-13 | P1 | Import validation expands unbounded `numInputs`. | A small crafted file can freeze or exhaust the browser main thread. |
| RB-14 | P2 | Taproot sighash packs signed `nVersion` as unsigned without normalization. | Consensus-valid transactions with bit 31 set crash the Taproot sighash node. |
| RB-15 | P2 | Redis budget tracker exceptions are uncaught. | Temporary Redis failures return HTTP 500 and discard otherwise successful calculations. |
| RB-16 | P2 | Redis budget registry has no cleanup. | Per-client registry entries accumulate indefinitely and leak Redis memory. |
| RB-17 | P2 | Graph calculation assumes every node element is a valid object. | Malformed node payloads crash calculation instead of returning structured errors. |
| RB-18 | P2 | `/bulk_calculate` validates arrays but not array elements. | Bad nodes or edges elements produce HTTP 500 instead of a client-facing 400. |
| RB-19 | P2 | Autosave tick can collide after tab version rewind. | The next edit after switching tabs can fail to autosave silently. |
| RB-20 | P2 | First-run intro-drop timers keep running after the user starts working. | The demo flow can replace user-created work or load into the wrong active context. |
| RB-21 | P2 | Undo/redo restores nodes immediately but edges later without a generation guard. | Rapid history actions can combine nodes from one snapshot with edges from another. |
| RB-22 | P2 | Group curve migration marks itself complete before real tab data hydrates. | Existing flows may never receive the intended edge-offset migration. |
| RB-23 | P2 | Code dialog copy handler removes leading numbers from selected lines. | Copied code can be silently corrupted when legitimate lines start with digits. |
| RB-24 | P2 | Background tab close can activate the tab before the close dialog resolves. | Pressing Cancel leaves the user stranded on the wrong tab; confirming may jump unexpectedly. |
| RB-25 | P2 | Opcode removal uses display indexes after filtering unknown names. | Clicking remove can delete the wrong opcode from stored node data. |
| RB-26 | P2 | TextInfo edits live only in component state until blur/commit. | Scrolling the node out of view can unmount it and discard in-progress text. |
| RB-27 | P2 | Turnstile widget depends on unstable parent callback identity. | Verification can reset during parent renders and may allow duplicate share attempts. |
| RB-28 | P2 | Input nodes expose a connectable port that is not rendered. | Connect dialog can create invisible edges that override the typed input value. |
| RB-29 | P2 | P2WPKH Witness defaults are stored in unused field metadata. | Default count/length bytes are not inserted, producing invalid witness hex unless users fill them manually. |
| RB-30 | P2 | Export/share keeps edges whose endpoints were not exported. | Re-importing the file/share fails validation because edges reference missing nodes. |
| RB-31 | P2 | Cmd/Ctrl+Shift+Z is handled as undo. | Users using the standard redo shortcut accidentally undo instead. |
| RB-32 | P2 | Startup reparents all unparented nodes by geometry. | Nodes intentionally ungrouped can be silently put back into groups after reload. |
| RB-33 | P2 | Retrying the same failed share link does not change state. | The Load-Link dialog appears to do nothing on retry. |
| RB-34 | P2 | Deferred snapshots read live graph state after tab changes. | A previous or closed tab can receive a history entry containing another tab's graph. |
| RB-35 | P2 | Legacy archive migration removes the old archive even if per-tab writes fail. | Tabs can disappear on the next reload after a partial migration failure. |
| RB-36 | P2 | Archive persistence disables itself permanently after one quota error. | Later edits are not persisted even after storage pressure is gone. |
| RB-37 | P2 | Viewport fit retry timers are not cancelled across tab restores. | An old tab's fit operation can clobber the current tab's viewport. |
| RB-38 | P2 | Hydrated tab counter ignores existing numeric tab suffixes. | Adding a tab can reuse an existing tab id and corrupt tab/archive mapping. |
| RB-39 | P2 | Worker error fallback can serialize an empty archive. | A compression worker failure can overwrite real tab data with an empty graph. |
| RB-40 | P2 | Port builder invents dense handles for sparse structured inputs. | Users can connect to phantom inputs that do not render and are ignored by the node UI. |
| RB-41 | P2 | `setVal` assumes a missing value store is an array. | Nodes without `inputs.vals` can throw a TypeError while editing values. |
| RB-42 | P3 | Transaction deserialization cache is count-limited, not size-limited. | Many large unique transactions can pin excessive worker memory. |
| RB-43 | P3 | Tagged hash cache stores attacker-controlled tags forever. | Repeated unique tags can slowly grow backend memory. |
| RB-44 | P3 | Hex byte length does not validate hex and miscounts `0x` input. | Users get false byte counts for invalid or prefixed hex strings. |
| RB-45 | P3 | Code view pulls in the full BIP39 wordlist for generic HMAC users. | Code views become noisy and unnecessarily large for non-BIP39 functions. |
| RB-46 | P3 | Timeout returns before graph sentinel cleanup. | Stale preflight/invalid-edge state can persist into later calculations. |
| RB-47 | P3 | Flow catalog endpoints bypass rate limits. | Repeated requests can cause unbounded origin JSON/disk reads. |
| RB-48 | P3 | Script Steps Copy All uses zero-based numbering. | Copied traces disagree with the visible dialog and failure summaries. |
| RB-49 | P3 | Information dialog inherits a Cancel button. | Users see a redundant Cancel action next to OK. |
| RB-50 | P3 | Nested copy buttons do not stop keyboard events. | Pressing Enter/Space on Copy can also activate the row and jump the canvas. |
| RB-51 | P3 | Save-mode hold flags listen to modified `S`/`L` keys. | The Save button can run the wrong save/export action after shortcut key sequences. |
| RB-52 | P3 | Error tooltip stringifies missing error details. | Users see literal `undefined` instead of `Unknown error`. |
| RB-53 | P3 | Turnstile script loading has no error handling or dedupe. | A blocked CDN leaves the verification dialog blank; multiple opens can inject duplicate scripts. |
| RB-54 | P3 | MuSig2 Partial Sig Agg group indexes collide at the declared max. | The 10th pubkey instance cannot be added reliably because it overlaps partial-signature indexes. |
| RB-55 | P3 | Trezor dropdown fields are connectable. | Invisible connections can override dropdown selections such as script type. |
| RB-56 | P3 | Nested ungrouping uses only one parent offset. | Children of nested groups can jump to the wrong canvas position. |
| RB-57 | P3 | Bundle geometry treats `null` and empty string as numeric zero. | Invalid stored offsets block fallbacks and collapse bundle geometry. |
| RB-58 | P3 | Validator accepts group parent cycles. | A topologically impossible group graph can be passed into React Flow. |
| RB-59 | P3 | Import id remapping misses group-bundle offset keys. | Custom bundle-port positions are lost when importing/copying flows with fresh ids. |
| RB-60 | P3 | Markdown table parsing drops empty cells. | Tables with blank cells shift later columns into the wrong positions. |
| RB-61 | P3 | Tables are parsed before fenced code blocks are protected. | Markdown table text inside code fences becomes real table HTML inside `<pre>`. |
| RB-62 | P3 | Workspace reset does not stop in-flight persistence writers. | Cleared storage can be repopulated before reload, partially undoing the reset. |

## Finding Conclusions

### HX-1 - Rebuilt flows opened unfitted

Status: branch-source-verified.

Verification: On `feature/hex-to-flow`, `legacy_builder.py` writes `flow["viewport"]`, `useTabs.addTab` accepts an optional transform, and `Flow.handleRebuiltFlow` validates `data.viewport` and calls `addTab({ transform: viewport })`.

Conclusion: The documented race is real on the old design because tab restore and post-create fitting both write viewport. The branch fix addresses the source by making tab creation own the correct transform.

Suggested fix: Keep the branch approach. Also fix RB-37 on `main`, because uncancelled restore fit timers are the same class of bug.

### HX-2 - Node overlaps below multi-row constants

Status: branch-source-verified.

Verification: On `feature/hex-to-flow`, the generator defines `ROW_AFTER_2 = 1.4 * ROW`, `ROW_AFTER_3 = 1.7 * ROW`, and recomputes band height from those larger pitches.

Conclusion: The fixed branch no longer uses one uniform row pitch for tall text constants.

Suggested fix: Keep the size-aware row pitch and keep overlap checks in the render/e2e suite.

### RB-01 - Auto-refresh reload overwrites inactive tabs

Status: source-confirmed.

Verification: `useAutoRefreshVersion.triggerReload` still loops over every tab and calls `saveTabData(tab.id)`. `saveTabData` defaults to `getNodes()`/`getEdges()`, which are `Flow`'s active `nodesRef`/`edgesRef`.

Conclusion: Inactive tab saves can snapshot the active canvas. Persistence is timing-dependent on the worker path but deterministic on synchronous fallback and still severe.

Suggested fix: Save only the active tab before reload using explicit `{ force: true, immediate: true }`, and make `saveTabData` refuse inactive tab saves unless explicit data is provided.

### RB-02 - `script_verification` dummy transaction is unparseable

Status: runtime-reproduced.

Verification: `script_verification(["", "51", "", "0", "", ""])` raises `ValueError: Invalid transaction hex: Superfluous witness record`. The proposed legacy 1-input/1-output dummy deserializes with `vin=1`, `vout=1`.

Conclusion: The documented optional transaction mode is broken.

Suggested fix: Replace the segwit marker/flag zero-input dummy with the legacy 1-input/1-output dummy from the audit, and add a regression test for empty `tx_hex`.

### RB-03 - `2OF3_MULTISIG_SUFFIX` emits stray `OP_2`

Status: source-confirmed.

Verification: Backend and frontend catalogues still contain `2OF3_MULTISIG_SUFFIX: 5253ae`; the correct tail is `53ae`.

Conclusion: The catalogue composes structurally invalid 2-of-3 scripts.

Suggested fix: Change both `backend/calc_functions/opcodes.py` and `src/lib/opcodes.ts` to `53ae` and update the description to `OP_3 OP_CHECKMULTISIG`.

### RB-04 - Stale `_cycle` sentinel is never cleared

Status: runtime-reproduced.

Verification: I ran `bulk_calculate_logic` on a two-node cycle, then reran the returned mutated nodes with all edges removed. Both nodes retained `_cycle: true`, `error: true`, and `extendedError: "Cycle detected in graph"`.

Conclusion: Removing the cycle does not recover the nodes.

Suggested fix: Before marking cycles, clear `_cycle` and stale cycle errors on nodes that are now in topo order.

### RB-05 - `reapplyPendingSharedGraph` lacks active-tab guard

Status: source-confirmed.

Verification: `reapplyPendingSharedGraph` writes `setNodes`, `setEdges`, `rfSetNodes`, and `rfSetEdges` from `pendingSharedGraphRef` without checking `activeTabIdRef.current === pending.tabId`.

Conclusion: A delayed repair for one tab can mutate whichever tab is active.

Suggested fix: Add an active-tab guard before every parent/store graph write and clear or defer stale pending repairs on tab switch.

### RB-06 - Script Steps dialog crashes when trace shrinks

Status: source-confirmed.

Verification: The component resets `idx` in an effect when `steps.length` changes, but render reads `const step = steps[idx]` before that effect runs. If the old `idx` is out of range, `step.phase` throws.

Conclusion: The reset effect is too late for shrink-on-render.

Suggested fix: Clamp synchronously during render, e.g. `const safeIdx = Math.min(idx, steps.length - 1)`, and use `safeIdx` for all reads.

### RB-07 - Calculation node selector returns fresh `Map`

Status: source-confirmed.

Verification: `CalculationNode` calls `useStore` with a selector that creates a new `Map` every time and no equality function.

Conclusion: Store updates unrelated to a node still invalidate every calculation node subscriber.

Suggested fix: Return stable primitive metadata or pass an equality function that compares map entries.

### RB-08 - Group/Text nodes bypass `pushCleanState`

Status: source-confirmed with corrected mechanism.

Verification: `GroupNode` and `TextInfoNode` call undo context `pushState` directly after `setTimeout`. `pushCleanState` is the wrapper that sets `skipLoadRef.current = true`; these direct calls bypass it. Flow's pointer watcher can then treat the new snapshot like an undo/redo load.

Conclusion: The bug is real, but the "raw pushState" is the app undo context, not `window.history.pushState`.

Suggested fix: Route these node-local commits through `scheduleSnapshot` or `pushCleanState`, not direct context `pushState`.

### RB-09 - Tx-extract output removal does not delete connected edges

Status: runtime-reproduced.

Verification: The installed React Flow `useReactFlow().setNodes` queues functional updates through its batch provider. I reproduced that queueing in a focused hook test: `removedHandle` was assigned only when the queued updater later ran, so the immediate `if (!increment && removedHandle)` did not call `setEdges`.

Conclusion: Existing tests use a synchronous `setNodes` mock and miss the real app ordering.

Suggested fix: Compute the removed handle from current data before calling `setNodes`, then call `setEdges` from that precomputed value.

### RB-10 - Large selection deletion snapshots mixed graph state

Status: source-confirmed.

Verification: `removeEdgesForRemovedNodes` updates edges immediately, but for selected counts `>= 30`, non-position node changes are deferred to rAF. The removal snapshot is scheduled in the same call before the deferred node removal necessarily lands.

Conclusion: The snapshot can capture old nodes with new edges.

Suggested fix: Apply remove changes synchronously even in large-selection mode, or schedule the snapshot only after deferred non-position changes flush.

### RB-11 - After-calc snapshot consumed by wrong tab

Status: source-confirmed.

Verification: `handleAfterCalcStatusChange` calls `pushCleanState(state.nodes, state.edges, label)` without a tab id. After a tab switch, both the live state provider and undo context active tab can point at the wrong tab.

Conclusion: Pending after-calc history can land in the current tab instead of the tab that became dirty.

Suggested fix: Store `{ tabId, token }` with pending after-calc work and pass that tab id through to `pushCleanState`.

### RB-12 - `selectTab` drops raw snapshot while compression is pending

Status: source-confirmed.

Verification: `selectTab` calls `saveTabData(previousTabId, { force: true })`, then clears `previousEntry.raw` whenever `previousEntry.compressed` exists. The new compression result is asynchronous.

Conclusion: Switching back before compression completes can restore the old compressed payload.

Suggested fix: Do not clear `entry.raw` while `pendingRequestId` is present, or make tab switches use immediate compression for the departing tab.

### RB-13 - `validateFlowData` unbounded `numInputs`

Status: runtime-reproduced.

Verification: The focused Vitest repro validated one node with `numInputs: 100000`; `buildPorts` produced 100000 handles and validation took about 22-29 ms. The operation is linear and unbounded.

Conclusion: A small crafted file can force large main-thread work; larger values can freeze or exhaust memory.

Suggested fix: Add a hard maximum for `numInputs` during validation before calling `buildPorts`.

### RB-14 - Taproot sighash crashes on bit-31 `nVersion`

Status: runtime-reproduced.

Verification: A transaction with raw version `0x80000000` parsed as `tx.nVersion == -2147483648`; `taproot_sighash_default` then crashed at `struct.pack("<I", tx.nVersion)`.

Conclusion: Consensus-valid serialized versions with bit 31 set fail the implementation.

Suggested fix: Pack `tx.nVersion & 0xffffffff` for unsigned serialization.

### RB-15 - Redis budget errors return HTTP 500

Status: runtime-reproduced.

Verification: Replacing the route budget tracker with fakes that raise in `check` or `record` made `/bulk_calculate` return `500 {"error":"internal_server_error"}`.

Conclusion: Transient Redis failures discard otherwise valid requests/results.

Suggested fix: Catch budget tracker exceptions in the route and fail open or fall back to in-memory accounting with logging.

### RB-16 - Redis budget registry grows without bound

Status: runtime-reproduced with fake Redis.

Verification: `record` calls `expire` on each per-identity sorted set but only `sadd` on the registry. The fake Redis run showed registry members accumulating with no TTL on the registry key.

Conclusion: The registry keeps dead identity keys forever.

Suggested fix: Give the registry a TTL, prune it opportunistically, or avoid a permanent registry set.

### RB-17 - Malformed node objects crash graph logic

Status: runtime-reproduced.

Verification: `bulk_calculate_logic` with missing `id`, missing `data`, or a non-dict node raised `KeyError`/`TypeError` before producing structured validation errors.

Conclusion: Graph logic assumes trusted node object shape.

Suggested fix: Validate node objects at route boundary and in `bulk_calculate_logic` before building `node_map`.

### RB-18 - Malformed nodes/edges elements crash `/bulk_calculate`

Status: runtime-reproduced.

Verification: Flask test client requests with `nodes: ["bad"]` or `edges: ["bad"]` returned HTTP 500.

Conclusion: The route validates only that `nodes` and `edges` are arrays, not that their elements are objects.

Suggested fix: Add element-level schema validation and return HTTP 400 with specific issue codes.

### RB-19 - `revTick` collision suppresses autosave

Status: source-confirmed.

Verification: `graphRev.current` is described as monotonic but is reset/rewound to tab versions on tab restore. `incrementGraphRev` sets `revTick` to that value, and autosave depends on `revTick`. Reusing the same tick value can suppress the effect.

Conclusion: Per-tab graph version and global React save tick are conflated.

Suggested fix: Use a separate monotonic `saveTick` that never rewinds, or make autosave observe graph content signatures instead of only `revTick`.

### RB-20 - Intro-drop animation can overwrite later user work

Status: source-confirmed.

Verification: The effect schedules multiple timeouts. The drop timeout calls `loadExampleFlow` directly and the callbacks do not recheck whether the canvas is still empty or whether the animation was cancelled.

Conclusion: User edits after scheduling remain vulnerable until timeout cleanup.

Suggested fix: Store a cancellation token and recheck active tab plus empty graph before every scheduled callback, especially before `loadExampleFlow`.

### RB-21 - Deferred edge restore can interleave undo/redo

Status: source-confirmed.

Verification: The history-load effect sets nodes immediately, then conditionally restores edges inside nested rAF/setTimeout callbacks. No generation token guards the deferred edge write.

Conclusion: A rapid second history action can receive edges from the first action.

Suggested fix: Attach a restore generation id and ignore deferred edge writes if the pointer/tab changed.

### RB-22 - Group-curve migration marks done before hydration

Status: source-confirmed.

Verification: `FlowCanvas` sets `hasRunGroupCurveOffsetResetRef.current = true` before verifying there are hydrated graph edges needing migration.

Conclusion: If the first render is pre-hydration, the one-time migration is consumed.

Suggested fix: Mark the migration as run only after hydration and after actually scanning/migrating a real graph.

### RB-23 - NodeCodeDialog copy strips leading numbers

Status: runtime-reproduced.

Verification: The copy handler applies `/^\s*\d+\s*/gm`. A focused repro showed legitimate leading numeric code is removed/corrupted.

Conclusion: Numeric literals at line starts are treated as line numbers.

Suggested fix: Remove only line-number gutter text from DOM-specific spans, or require a delimiter pattern that cannot match source code.

### RB-24 - Closing a background tab activates it first

Status: source-confirmed.

Verification: The tab close icon stops only `click` propagation. It is nested inside a Radix `TabsTrigger`, whose selection can occur on pointer interaction before the child click.

Conclusion: Cancel can leave the user on the tab they attempted to close.

Suggested fix: Make the close control a real button outside the trigger or stop `pointerdown`/`mousedown` propagation and default behavior.

### RB-25 - OpCodeNode removes wrong opcode with unknown stored names

Status: source-confirmed.

Verification: `selectedOps` maps stored names through `findOpItemByName` and filters out unknown names. `OpcodeMiniView` passes the compacted display index to `removeOp`, which filters the unfiltered stored names by that index.

Conclusion: Unknown names before a visible opcode shift removal.

Suggested fix: Remove by stable stored index or opcode id, not display index after filtering.

### RB-26 - TextInfo edits are discarded on virtualization unmount

Status: source-confirmed.

Verification: Text edits live in component state and commit only through explicit commit/blur paths. There is no cleanup effect that commits or preserves `draft` on unmount.

Conclusion: `onlyRenderVisibleElements` can unmount the editor without firing blur.

Suggested fix: Persist draft into node data during editing, or commit draft in a cleanup effect when editing is active.

### RB-27 - Turnstile widget is recreated on parent render

Status: source-confirmed.

Verification: The render effect depends on `onVerified`. If the parent passes an unstable callback, cleanup removes the widget and the effect renders a new one.

Conclusion: Verification can be interrupted and callbacks duplicated.

Suggested fix: Store `onVerified` in a ref and remove it from the Turnstile render effect dependencies.

### RB-28 - Input template exposes invisible connectable port

Status: runtime-reproduced.

Verification: The `Input` template has `numInputs: 0` but an `inputStructure.ungrouped` field at index 0. `buildPorts` returns `input-0`.

Conclusion: Connect dialog sees a connectable handle that the node UI does not render.

Suggested fix: Mark the `INPUT VALUE` field `unconnectable: true` or make the rendered node expose a matching handle.

### RB-29 - P2WPKH Witness defaults are dead field values

Status: runtime-reproduced.

Verification: The template has `inputs: { vals: [] }`; `ITEM_COUNT` and `PUBKEY_LENGTH` defaults exist only as `FieldDefinition.value`, which the runtime value path does not consume.

Conclusion: Default witness count/length bytes are not applied.

Suggested fix: Seed `inputs.vals` at the correct sparse indexes, or teach node initialization to hydrate `FieldDefinition.value`.

### RB-30 - Export/share keeps dangling edges

Status: runtime-reproduced.

Verification: A selected-node export saved only node `a` but `buildSharePayload` kept edge `a-b`. `validateFlowData` rejected the payload with `EDGE_TARGET_MISSING`.

Conclusion: Exported/share payloads can be self-inconsistent.

Suggested fix: Filter edges to the saved node id set in both file export and share payload construction.

### RB-31 - Cmd/Ctrl+Shift+Z performs undo

Status: runtime-reproduced.

Verification: The hook checks only `key === "z"` before `key === "y"` and ignores `shiftKey`. A focused hook test dispatched Meta+Shift+Z and called undo, not redo.

Conclusion: Standard redo shortcut is wired to undo.

Suggested fix: Handle `key === "z" && evt.shiftKey` as redo before the undo branch.

### RB-32 - `onInit` requeues top-level nodes for group adoption

Status: source-confirmed.

Verification: `onInit` adds every unparented non-group node to `pendingIds`; on first dimensions event, `attemptToParentNode` reparents by geometric intersection.

Conclusion: Explicitly ungrouped nodes inside a group rectangle can be reparented after reload.

Suggested fix: Queue only newly created/imported nodes that are eligible for auto-adoption, or persist an explicit ungroup/no-adopt marker.

### RB-33 - Retrying a failed shared-flow link is a no-op

Status: source-confirmed.

Verification: A failed load leaves `sharedId` state unchanged. The Load-Link dialog pushes the same `?s=` URL and dispatches `popstate`; `setSharedId` receives the same value, so React does not rerun the effect.

Conclusion: The retry button can be silent after a failed attempt.

Suggested fix: Track a retry nonce, clear `sharedId` on failure, or provide a `reloadSharedId(sharedId)` function that bypasses React's same-value state suppression.

### RB-34 - rAF `scheduleSnapshot` writes live post-switch graph into old tab

Status: source-confirmed.

Verification: `scheduleSnapshot` defers with rAF and then reads `options.state ?? getSnapshotState() ?? storeApi.getState()`. If `options.tabId` refers to the old tab but state is read after a switch, old history receives new graph state.

Conclusion: The tab id can be stale while graph data is live/current.

Suggested fix: Capture nodes/edges and tab id at scheduling time, or cancel scheduled snapshots on tab switch/close.

### RB-35 - Legacy archive migration deletes source after failed writes

Status: source-confirmed.

Verification: During migration, per-tab `localStorage.setItem` failures are caught and ignored; after the loop, the legacy archive key is removed if `legacyArchive.size > 0`.

Conclusion: Failed per-tab migration can still delete the only good archive copy.

Suggested fix: Track per-tab migration success and remove the legacy blob only after all required writes succeeded.

### RB-36 - Archive persistence disabled permanently after quota error

Status: source-confirmed.

Verification: `persistTabCompressed` sets `archivePersistDisabledRef.current = true` on quota exceeded and there is no recovery path that retries smaller/future writes.

Conclusion: Once quota is hit, later tab archive persistence is silently skipped for the session.

Suggested fix: Mirror metadata persistence behavior: remember payload sizes, retry if a later payload is smaller, and surface a warning.

### RB-37 - Uncancelled fitView retries clobber later viewport

Status: source-confirmed.

Verification: `runViewportRestore` schedules `RESTORE_FIT_RETRIES.forEach(window.setTimeout(runFit, delay))` with no timer tracking and no active-tab/restore-token guard.

Conclusion: Old restore timers can write viewport after a tab switch.

Suggested fix: Track/cancel restore timers and require a restore generation id before applying `fitView`.

### RB-38 - Tab id collision from hydrated counter fallback

Status: source-confirmed.

Verification: `hydrateCounter` returns `tabs.length || 1` if stored counter is missing/invalid, ignoring existing `tab-N` suffixes. `addTab` then uses `tab-${tabCounter + 1}`.

Conclusion: A stored tab like `tab-2` with one tab and no counter can collide on next add.

Suggested fix: Hydrate the counter as `max(tabs.length, maxNumericTabSuffix)`.

### RB-39 - Worker error fallback can persist empty archive over real data

Status: source-confirmed.

Verification: Worker error fallback serializes `entry?.raw ?? createEmptyArchive()`. `selectTab` can clear `entry.raw` while a request is pending if an older compressed payload exists.

Conclusion: A worker error after raw was cleared can write an empty archive.

Suggested fix: Keep raw while a pending request exists and fall back to previous compressed data rather than a newly empty archive.

### RB-40 - `buildPorts` invents phantom dense input ports

Status: runtime-reproduced.

Verification: A node with sparse ungrouped input index 10 and `numInputs: 3` produced handles `input-10`, `input-0`, `input-1`, `input-2`.

Conclusion: Sparse structured nodes can expose invisible phantom inputs.

Suggested fix: Treat any `inputStructure` as authoritative, including ungrouped fields, and do not fill dense `numInputs` fallbacks when structure exists.

### RB-41 - `setVal` crashes on absent `inputs.vals`

Status: runtime-reproduced.

Verification: `setVal(undefined, 0, "x")` throws `TypeError` because it calls `.map` on the missing store.

Conclusion: Callers must not be required to pre-seed `vals`.

Suggested fix: Treat `undefined` as an empty array/object before normalization.

### RB-42 - `_deserialize_tx_cached` pins large transactions

Status: source-confirmed.

Verification: `_deserialize_tx_cached` is an unweighted `@lru_cache(maxsize=2048)` keyed by raw hex. Entries can be multi-megabyte transactions.

Conclusion: The cache has a high memory ceiling under attacker-controlled input diversity.

Suggested fix: Reject oversize tx hex before caching and/or use a byte-weighted cache.

### RB-43 - `_TAG_HASH_CACHE` grows without bound

Status: runtime-reproduced.

Verification: Calling `tagged_hash` with 25 distinct user tags left 25 entries in `_TAG_HASH_CACHE`; there is no max size.

Conclusion: User-controlled tag strings can grow process memory.

Suggested fix: Use `functools.lru_cache(maxsize=...)` for tag hashes or avoid caching arbitrary tags.

### RB-44 - `hex_byte_length` does not validate hex and mishandles `0x`

Status: runtime-reproduced.

Verification: `hex_byte_length("zz")` returned `1`, and `hex_byte_length("0x00")` returned `2`.

Conclusion: The function reports byte lengths for invalid/non-normalized strings.

Suggested fix: Use `_bytes_from_even_hex` and return `len(decoded)`.

### RB-45 - Code view prepends BIP39 wordlist to HMAC users

Status: runtime-reproduced.

Verification: Expanding `bip32_derive_private_key` produced about 32 KB of code and included `_BIP39_ENGLISH_WORDLIST` and `"abandon"` even though BIP32 derivation does not need the wordlist.

Conclusion: `_hmac_sha512` is treated as a BIP39 symbol too broadly.

Suggested fix: Separate generic HMAC/PBKDF helpers from BIP39 wordlist/index expansion.

### RB-46 - Timeout path skips sentinel cleanup

Status: runtime-reproduced with nuance.

Verification: For an invalid-edge node plus forced timeout, `_preflightErrors` survived the timeout return. If timeout happened before the invalid-edge node was visited, `_invalidEdge` also survived.

Conclusion: The timeout early return bypasses the normal cleanup/finalization loop.

Suggested fix: Run sentinel cleanup in a `finally` block or call the same cleanup function before returning from the timeout handler.

### RB-47 - `/flows` endpoints exempt from rate limiting

Status: source-confirmed.

Verification: Both `/flows` and `/flows/<slug>` are decorated with `@limiter.exempt`.

Conclusion: Flow catalog/file reads are unbounded by the limiter.

Suggested fix: Apply a low-cost rate limit or cache-backed static serving policy rather than full exemption.

### RB-48 - Script Steps Copy All is 0-based

Status: source-confirmed.

Verification: Copy All uses `Step #${i}` while the dialog uses `idx + 1` in its visible step counter.

Conclusion: Copied step numbers disagree with UI numbering.

Suggested fix: Use `i + 1` in Copy All.

### RB-49 - Information dialog shows redundant Cancel

Status: source-confirmed with wording nuance.

Verification: `ConfirmationDialog` defaults `cancelText = "Cancel"`. The Information dialog passes `confirmText="OK"` but no `cancelText`, so Cancel is rendered. Passing `cancelText=""` would omit it, so "can never be omitted" is too strong.

Conclusion: The shipped Information dialog has redundant Cancel.

Suggested fix: Pass `cancelText=""` for the Information dialog, or change the component default to no cancel button unless explicitly requested.

### RB-50 - Nested Copy button key events also trigger row action

Status: source-confirmed.

Verification: SearchPanel and ErrorPanel row wrappers handle Enter/Space on `onKeyDown`. The nested copy buttons stop propagation only on mouse `onClick`, not keyboard events.

Conclusion: Keyboard activation of the copy button can also select/jump to the row.

Suggested fix: Add `onKeyDown={(e) => e.stopPropagation()}` to the nested copy buttons or make rows/buttons non-nested.

### RB-51 - Save shortcut hold flags set for modified key combos

Status: source-confirmed.

Verification: TopBar's key listeners set hold flags for any `s` or `l` keydown, regardless of modifier keys, and clear only on keyup.

Conclusion: Modified shortcuts can arm the Save button's alternate behavior unexpectedly, especially around macOS/meta key event loss.

Suggested fix: Only set hold flags for plain unmodified `s`/`l`, and clear flags on blur/visibilitychange/meta keyup.

### RB-52 - Error tooltip renders literal `undefined`

Status: source-confirmed.

Verification: Tooltip content uses `{String(data.extendedError) || "Unknown error"}`. `String(undefined)` is `"undefined"`, which is truthy.

Conclusion: The fallback is unreachable for undefined errors.

Suggested fix: Use `data.extendedError ? String(data.extendedError) : "Unknown error"`.

### RB-53 - Turnstile script loader lacks error handling/deduplication

Status: source-confirmed.

Verification: SoftGateDialog creates a new script tag whenever opened before `window.turnstile` exists, resolves only on load, and ignores `error-callback`.

Conclusion: Blocked CDN can leave the dialog blank, and concurrent opens/renders can duplicate script tags.

Suggested fix: Use a module-level script loading promise, attach `onerror`, and render an actionable failure state.

### RB-54 - MuSig2 Partial Sig Agg max instance collision

Status: runtime-reproduced.

Verification: `PUBKEYS[]` has base index 100 and max 10; with stride 100, the 10th instance starts at 1000, colliding with `PARTIAL_SIGS[]` base index 1000.

Conclusion: The declared max cannot be reached safely.

Suggested fix: Move `PARTIAL_SIGS[]` to a non-overlapping base index or lower `PUBKEYS[]` max.

### RB-55 - Trezor dropdown fields are connectable

Status: runtime-reproduced.

Verification: `Show On Trezor:` and `Input Script Type:` have `options` but no `unconnectable`; `buildPorts` treats them like connectable fields.

Conclusion: Connect dialog can wire invisible/semantic dropdown inputs.

Suggested fix: Mark option/dropdown-only fields `unconnectable: true`.

### RB-56 - Nested ungroup uses single-level offset

Status: source-confirmed.

Verification: `ungroupSelectedNodes` computes child absolute position as `parent.position + child.position` for direct children only. It does not accumulate ancestor offsets.

Conclusion: Children of nested groups can be teleported when lifted.

Suggested fix: Resolve absolute position by walking the full parent chain or using React Flow absolute internals.

### RB-57 - `asFiniteNumber` coerces null/empty string to zero

Status: runtime-reproduced.

Verification: A group with `source: 40` and per-bundle `sourceByBundle[bundle] = null` produced boundary y=100, proving null became offset 0 instead of falling back to 40.

Conclusion: Null/empty persisted values block fallback offsets.

Suggested fix: Require `typeof value === "number" && Number.isFinite(value)` before accepting offsets/sizes.

### RB-58 - Group parent cycles pass validation

Status: runtime-reproduced.

Verification: `validateFlowData` accepted two groups parented to each other with `ok: true` and no errors.

Conclusion: The validator checks parent existence/type but not acyclicity.

Suggested fix: Add DFS/visited validation over parent links and reject cycles.

### RB-59 - `importWithFreshIds` does not remap bundle keys

Status: runtime-reproduced.

Verification: Importing groups with `groupBundlePortOffsets.sourceByBundle["group-a->group-b"]` and `renameMode: "always"` remapped node ids but left the old key unchanged.

Conclusion: Custom bundle port offsets are lost after import.

Suggested fix: Remap `sourceByBundle`/`targetByBundle` keys through the same `idMap` used for nodes and edges.

### RB-60 - Markdown tables drop empty cells

Status: runtime-reproduced.

Verification: `mdToHtml("| a | b | c |\n| - | - | - |\n| 1 | | 3 |")` emitted `<td>1</td><td>3</td>` and no empty middle cell.

Conclusion: Empty cells shift later columns left.

Suggested fix: Preserve interior empty cells when splitting table rows; only trim the leading/trailing pipe sentinels.

### RB-61 - Tables inside fenced code render as table HTML

Status: runtime-reproduced.

Verification: A fenced table rendered as `<pre><code><table>...`, because table replacement runs before code-block stashing.

Conclusion: Code content is interpreted as markdown table HTML.

Suggested fix: Stash code blocks before table parsing.

### RB-62 - Workspace reset can be undone by in-flight writers

Status: source-confirmed.

Verification: `resetWorkspaceStorageAndReload` clears local/session storage, then awaits IndexedDB and cache cleanup before `location.reload()`. Existing autosave/compression callbacks are not disabled during that window.

Conclusion: A pending writer can recreate storage keys after clear but before reload.

Suggested fix: Set a global reset-in-progress flag checked by all persistence writers, cancel pending workers/timers, then reload after storage cleanup.
