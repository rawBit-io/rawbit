# First-Time User Walkthrough Feature Spec

## Goal

Add a guided walkthrough for first-time rawBit users that teaches the core editor
workflow without requiring them to read documentation first.

The walkthrough should demonstrate the actual app surface:

- dragging nodes from the sidebar onto the canvas
- filling fields on a transaction template
- copying and pasting nodes
- grouping nodes
- adding a text info node
- using sidebar search and canvas search
- discovering operation nodes
- opening a real example flow in a new tab

The walkthrough should also be replayable from the topbar.

## Recommended Length

Target **45-60 seconds** for the automatic first-run version.

Thirty seconds is likely too short for a node editor because the user needs to
understand the sidebar, canvas, node fields, copy/paste, grouping, search, and
example flows. The walkthrough should still be user-controlled, with **Next**,
**Back**, **Skip**, and **Replay** support so users are not trapped in a timed
sequence.

## Entry Points

### First Run

Show the walkthrough automatically only when:

- local storage does not contain the walkthrough-complete flag
- the current URL is not a shared flow URL (`?s=` or `?share=`)
- the app is not running in an automation/test environment
- the current workspace is empty after initial hydration

Suggested storage key:

```text
rawbit.ui.walkthroughSeen
```

This should coexist with the current welcome/first-run logic in
[`Flow.tsx`](../src/components/Flow.tsx). Avoid double-opening both the existing
welcome dialog and the new walkthrough.

### Manual Replay

Add a topbar icon button for the walkthrough.

Suggested icon:

- `CircleHelp` from `lucide-react`, or
- `GraduationCap` from `lucide-react`

Suggested tooltip:

```text
Walkthrough
```

Suggested placement: near the existing Search / Minimap / Info Nodes controls,
because this is a learning/navigation action rather than file I/O.

## UX Model

Use a lightweight custom walkthrough component instead of a large tour
dependency. rawBit already owns the relevant state and can provide a better
experience by driving the canvas directly.

Suggested component:

```text
src/components/walkthrough/Walkthrough.tsx
```

The component should support:

- current step index
- target element selector or virtual canvas target
- spotlight/highlight layer
- short callout text
- Next / Back / Skip controls
- optional auto-advance
- pause on user interaction
- completion callback

The user should be able to skip at any point. Skipping should mark the
walkthrough as seen only if it was launched automatically. Manual replay should
not change existing saved workspace state unless the user chooses to run the
demo in a new tab.

## Workspace Strategy

Run the walkthrough in a temporary tab titled:

```text
Walkthrough
```

This avoids modifying the user's current flow when the walkthrough is replayed.
For first-time users, this still feels natural because the workspace starts
empty.

At the end, create or switch to a new tab containing the first example flow:

```text
Intro P2PKH
```

The final message should tell the user that this is a real flow they can edit
and explore.

## Walkthrough Sequence

### 1. Sidebar And Canvas

Highlight the sidebar and the empty canvas.

Message:

```text
Drag nodes from the sidebar onto the canvas to build Bitcoin flows.
```

### 2. Drop `TX Template legacy`

Programmatically place the `TX Template legacy` node on the canvas.

Prefer reusing the existing intro drop animation pattern already present in
`Flow.tsx` and `src/index.css`.

Message:

```text
A transaction template gives you structured fields for a raw legacy transaction.
```

### 3. Fill Basic Fields

Populate a few fields on the transaction template, for example:

- `VERSION[4]`: `01000000`
- `INPUT_COUNT (VarInt)`: `01`
- `OUTPUT_COUNT (VarInt)`: `01`
- `LOCKTIME[4]`: `00000000`

Message:

```text
Fields can be typed directly or connected from other nodes.
```

### 4. Copy And Paste Nodes

Select the transaction template, highlight the topbar Copy and Paste buttons,
and duplicate the node with a small offset.

Message:

```text
Use copy and paste to duplicate useful building blocks.
```

### 5. Group Nodes

Select the two template nodes, highlight the Group button, and wrap them in a
group node.

Message:

```text
Groups keep related parts of a flow readable as the graph grows.
```

### 6. Add Text Info Node

Drop a `Text Info Node` near the group and fill it with short markdown.

Suggested content:

```markdown
## Legacy transaction skeleton

This area builds the fixed parts of a raw transaction.
```

Message:

```text
Info nodes document why a section exists, directly on the canvas.
```

### 7. Show Search And Operations

Show both discovery paths:

- sidebar search for available nodes
- topbar Search panel for nodes already on the canvas

Suggested sidebar queries:

- `math` to show `Math Operation`
- `op` to show opcode-related operations
- `tx` to show transaction-related nodes

Message:

```text
Use sidebar search to find operations, and canvas search to find nodes in large flows.
```

### 8. Open The First Example Flow

Create a new tab and load the first example flow:

```text
flow-0 / Intro P2PKH
```

The final callout should be:

```text
This is a real example flow. Play with it, change fields, and follow the edges.
```

## Technical Integration Points

Likely files to touch:

- [`src/components/Flow.tsx`](../src/components/Flow.tsx)
- [`src/components/layout/TopBar.tsx`](../src/components/layout/TopBar.tsx)
- [`src/components/layout/Sidebar.tsx`](../src/components/layout/Sidebar.tsx)
- [`src/components/walkthrough/Walkthrough.tsx`](../src/components/walkthrough/Walkthrough.tsx)
- [`src/index.css`](../src/index.css)

Existing functionality to reuse:

- `addTab` from `useTabs`
- `loadExampleFlow` in `Flow.tsx`
- `placeFlowDataAtPosition`
- existing sidebar drag/drop data model
- existing intro drop animation CSS
- existing copy/paste and grouping handlers
- existing `FlowPanels` search panel
- existing `customFlows` entry for `flow-0`

## State And Safety

The walkthrough should not corrupt user state.

Implementation requirements:

- run demo edits in a new walkthrough tab
- do not overwrite a non-empty user canvas during automatic first run
- skip or completion should set `rawbit.ui.walkthroughSeen`
- shared links should suppress automatic walkthrough launch
- tests should be able to suppress automatic walkthrough launch
- replay from topbar should be explicit and reversible by closing the tab

## Acceptance Criteria

- First-time desktop users see the walkthrough once.
- The topbar contains a visible icon to replay the walkthrough.
- Users can skip the walkthrough.
- Users can step forward and backward.
- The walkthrough demonstrates dropping `TX Template legacy`.
- The walkthrough demonstrates field filling.
- The walkthrough demonstrates copy/paste.
- The walkthrough demonstrates grouping.
- The walkthrough demonstrates adding a `Text Info Node`.
- The walkthrough demonstrates sidebar search for available operations.
- The walkthrough demonstrates canvas search.
- The walkthrough ends by opening `Intro P2PKH` in a new tab.
- Shared-flow URLs do not show the automatic walkthrough.
- Existing saved workspaces are not modified by automatic first-run launch.

## Suggested Tests

Add focused tests rather than broad snapshot coverage.

Unit/component tests:

- walkthrough storage flag behavior
- topbar walkthrough button calls the replay handler
- step controls move through the expected sequence
- skip calls completion callback

Playwright test:

- clear relevant local storage
- load the app
- verify walkthrough appears
- skip walkthrough and verify it does not reappear on reload
- click the topbar walkthrough icon and verify it opens again
- run to final step and verify `Intro P2PKH` appears in a new tab

## Open Decisions

- Whether the automatic walkthrough should fully auto-play or default to manual
  Next controls with subtle auto-advance.
- Whether manual replay should always create a new tab or ask before creating
  one.
- Whether the existing `FirstRunDialog` should be replaced by this walkthrough
  or kept as a separate example-loader fallback.
- Whether mobile read-only mode should show a shortened walkthrough or continue
  using the current example-flow prompt.
