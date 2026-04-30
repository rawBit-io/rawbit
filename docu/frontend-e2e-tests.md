# Frontend End-to-End Tests

The Playwright suite exercises the real editor in a browser. It focuses on
workflows that depend on canvas geometry, browser APIs, backend responses,
sharing, tab persistence, and keyboard behavior.

## Running

```bash
npm run test:e2e -- --project=chromium
```

Direct Playwright runs require the backend at `http://localhost:5007`. The
Playwright config starts the Vite dev server at `http://127.0.0.1:3041`.

For the normal local gate, prefer:

```bash
python3 run_all_tests.py
```

That helper starts the local backend when needed and runs Chromium E2E by
default. Add `--e2e-browsers=all` to run Chromium, Firefox, and WebKit
sequentially.

## Flow Regression Tests

- `flow.builder.spec.ts` uploads `tests/e2e/fixtures/hash-flow.json`, waits for
  `/bulk_calculate`, edits the identity node, and asserts the backend response
  contains the expected double SHA256 result.
- `flow.roundtrip.spec.ts` runs the hash flow, `p1_Intro_P2PKH_and_P2PK`, and
  `p13_Taproot_MultiSig`. Each scenario captures a baseline response, applies
  known `node_changes`, verifies the result changes, restores only those inputs,
  and checks that TXID and script/debug output return to baseline.
- `flow.manual-wiring.spec.ts` builds a small P2PKH address flow from sidebar
  drag/drop and manual handle connections, then verifies the calculated address.

## UI Workflow Coverage

- `app.smoke.spec.ts` checks shell boot, sidebar, toolbar, and canvas
  accessibility hooks.
- `topbar.interactions.spec.ts` covers sidebar toggling, search panel state, and
  theme persistence.
- `canvas.minimap.spec.ts` verifies viewport fitting and minimap offsets when
  panels open.
- `sidebar.palette.spec.ts` covers sidebar search, drag/drop creation, and undo
  history for new nodes.
- `grouping.color.spec.ts` covers group/ungroup, marquee selection, color
  changes, and undo snapshots.
- `node.backend.spec.ts` stubs backend validation errors and checks badges,
  error panels, and clipboard feedback.
- `protocol-diagram.spec.ts` checks the flow-map panel, grouped protocol layout,
  boundary labels, connection selection, and group focus behavior.
- `tabs.clipboard.spec.ts` covers tab lifecycle, copy/paste, script-step
  persistence, and selected-node simplified export.
- `panels.autoclose.spec.ts` verifies search/error/protocol panel coordination.
- `undo.snapshots.spec.ts` checks drag and edge reconnect undo snapshots.
- `file.accessibility.spec.ts` covers import validation, full save, keyboard
  access, and ARIA labels.
- `welcome.dialog.spec.ts` verifies the automated-test welcome-dialog behavior.

## Share and Persistence Coverage

- `connect.share.spec.ts` covers the connect dialog and share dialog. It stubs
  `POST /share` for success, soft-gate retry, and forbidden-origin responses.
- `script.debug.persistence.spec.ts` verifies script debug steps survive
  share/load cycles.
- `shared.edges.spec.ts` verifies shared-flow imports and reloads preserve edge
  topology, including larger shared graphs.

Shared helpers live in `tests/e2e/utils.ts`; they provide fixture loading,
bulk-response harnesses, node-edit helpers, and share stubs.
