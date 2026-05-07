# Frontend Architecture Guide

The frontend is a React + Vite visual editor built on React Flow. Its main job
is to keep the canvas, tabs, calculations, exports, sharing, and side panels in
sync without hiding the Bitcoin data being inspected.

## Runtime Shape

[`Flow.tsx`](../src/components/Flow.tsx) is the main orchestration point.

- `ReactFlowProvider` wraps the editor so graph hooks can access React Flow.
- `UndoRedoProvider` stores per-tab history, calculation state, and script-step
  snapshots.
- `FlowContent` owns the active canvas state, tab state, dialog state, backend
  calculation state, and panel state.
- `SnapshotProvider` exposes the active snapshot scheduler.
- `FlowActionsProvider` exposes shared group and ungroup actions to descendants.

The editor surface is split into three shells:

- `FlowCanvas` renders React Flow, nodes, edges, viewport handlers, and minimap.
- `FlowPanels` renders undo, error, and search panels.
- `FlowDialogLayer` renders confirmation, connect, share, soft-gate, and export
  dialogs.

## Core Hooks

- `useNodeOperations` owns node/edge mutation, drag/drop, grouping, template
  placement, graph import, and group resizing.
- `useFlowInteractions` coordinates undo-friendly edits, reconnects, dirty state,
  paste behavior, tab tooltips, and snapshot throttling.
- `useGlobalCalculationLogic` debounces dirty calculable nodes, sends partial
  graphs to `/bulk_calculate`, discards stale responses by version, and merges
  results/errors back into nodes.
- `useSnapshotScheduler` batches history writes and avoids duplicate snapshots
  during drags, calculations, imports, and grouped operations.
- `useTabs` persists multi-tab metadata and archived graph snapshots in
  `localStorage`.
- `useSharedFlowLoader` imports `?s=` and `?share=` links, merges shared graphs,
  and restores script steps.

## Data and Calculation Flow

1. A user action updates nodes or edges through `useNodeOperations` or
   `useFlowInteractions`.
2. Affected calculation nodes are marked dirty and a snapshot is scheduled.
3. `useGlobalCalculationLogic` builds the recalculation payload and calls the
   backend.
4. Backend results update node `result`, `outputValues`, error fields, and
   `scriptDebugSteps`.
5. Clean snapshots are pushed into `UndoRedoProvider` so undo/redo restores both
   graph shape and debugger state.

## File, Share, and Export Paths

`useFileOperations` handles full-flow saves, imports, simplified exports, and
LLM exports.

- Full-flow saves preserve node positions, edges, tab metadata, script steps, and
  canvas layout.
- Simplified exports omit canvas layout and keep the selected subgraph when
  nodes are selected; otherwise they export the full graph.
- LLM exports use the simplified shape plus runtime semantics and backend Python
  source code for each unique exported node function.
- Simplified and LLM exports are intentionally not importable back into the
  editor because they omit layout data.

Sharing is handled by `useShareFlow`, `buildSharePayload`, and
`src/lib/share`. Share links require an external service configured with
`VITE_SHARE_BASE_URL`; tests stub the share endpoints.

## Source Code Views

Calculation and opcode nodes can open `NodeCodeDialog`, which asks the backend
`/code` endpoint for the Python helper source. This keeps the UI focused on the
actual runtime implementation instead of a duplicated frontend description.

## Extension Points

- Add calculation behavior in the backend first, then expose it through frontend
  node metadata and palette entries.
- Route canvas mutations through the existing hooks so undo, dirty state, and
  recalculation stay consistent.
- Preserve script-step cache handling when importing, copying, sharing, or
  exporting nodes.
- Update Playwright coverage when a workflow changes visible behavior across
  files, tabs, dialogs, panels, or backend responses.
