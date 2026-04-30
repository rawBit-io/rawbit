# Edge Readability And Group Edge Bundling

## Background

Edge readability is one of rawBit's core UX problems. Even without groups, dense
flows become hard to read when nodes fan out to many consumers, many inputs
converge into one calculation, or long edges cross large parts of the canvas.

rawBit also has the Protocol Map, which gives a higher-level view of grouped
flows. That helps, but it does not fully solve the problem:

- not every user opens or notices the Protocol Map
- not every flow is organized enough for the map to carry the experience
- users still need the main canvas to stay readable while editing and learning
- overloaded canvas edges remain visually distracting even when a secondary map
  exists

Group edge bundling is the first concrete implementation in a broader edge
readability direction. It targets cross-group edges so connections between
groups leave and enter through stable boundary points. MuSig2 (`flow-14`,
`p14_MuSig2.json`) is the main regression fixture.

## Design Goals

1. Reduce visual noise without hiding real dependencies.
2. Keep normal node-to-node edges for ordinary local flow.
3. Route all cross-group traffic through one outside connection per directed
   group pair, even when there is only one edge.
4. Keep one visible outgoing port on the right group boundary and one visible
   incoming port on the left group boundary.
5. Let React Flow render and update inside-group edges.
6. Keep all helper nodes and helper edges out of saved flow data.

## What We Implemented

The implementation is a render-layer projection. The saved graph remains the
real graph; `FlowCanvas` builds a visual graph for React Flow to render.

Main files:

- `src/lib/flow/groupEdgeBundling.ts`
- `src/components/FlowCanvas.tsx`
- `src/components/edges/GroupBundleEdge.tsx`
- `src/components/nodes/GroupBundlePortNode.tsx`
- `src/index.css`

For every bundleable directed group pair, the builder creates:

- two invisible boundary port nodes
- no rendered copy of the represented raw cross-group edges
- normal React Flow segment edges inside each group
- one custom outside bundle edge between the boundary ports

An edge is bundleable when its source belongs to one group and its target belongs
to another group. Single cross-group edges are still routed through the generated
boundary ports so no edge crosses group boundaries on its own.

## Implemented So Far

- Cross-group bundle detection for edges between directed group pairs, including
  single-edge pairs.
- Render-layer removal of the represented raw cross-group edges, with their
  canonical data preserved on the outside bundle edge.
- One custom outside bundle edge between generated boundary ports.
- Generated boundary port nodes that are invisible infrastructure, not user
  graph state.
- Normal React Flow segment edges from source nodes to source boundary ports and
  from target boundary ports to target nodes.
- Click/highlight behavior that maps bundle visuals back to the represented
  original edge ids.
- Snapshot/state sanitizing that strips generated visuals and restores
  represented raw edges before data reaches canonical graph state.
- Delete handling for selected bundled raw edges that are not currently rendered
  as normal edges.
- Bundle selection is scoped through the local canvas provider, not a global
  browser event, so future secondary canvases do not receive each other's clicks.
- Tests for bundle construction, render-layer filtering, segment clicks, and
  outside bundle selection.

## Why Inside Edges Use React Flow

The first version drew inside-group bundle legs manually inside the custom bundle
edge renderer. That created stale-looking path fragments during node drag and
group resize because React Flow owned node measurement while the custom SVG code
owned part of the edge geometry.

The current version treats inside legs as normal React Flow edges:

- original source node handle -> generated source boundary port
- generated target boundary port -> original target node handle

This lets React Flow handle movement, resize invalidation, handle positions, and
view culling. The custom renderer is now only responsible for the outside
group-to-group bundle path.

## Possible Performance Optimization

If profiling proves React Flow segment edges are the bottleneck, we can draw the
inside bundle legs as inline SVG paths inside `GroupBundleEdge` instead. This
would reduce React Flow edge objects, but adds custom geometry, hit testing,
highlight mapping, and tighter coupling to React Flow internals. Keep the
simpler segment-edge model unless the deployed app needs this.

## Selection Behavior

Bundled visuals remain clickable:

- clicking an inside segment selects its represented original edge
- clicking the outside bundle selects all represented original edges
- selected bundle visuals highlight consistently with normal selected edges

Generated segment edge data stores the original edge ids:

```ts
data: {
  bundledEdgeIds: ["original-edge-id"],
  selectedEdgeIds: [...]
}
```

This mapping is important for highlighting, debugging, Protocol Map links, and
future edge tooling.

## Constraints For Future Work

- Do not draw inside-group bundle legs manually in `GroupBundleEdge` unless
  profiling proves React Flow segment edges are the bottleneck.
- Do not persist generated port nodes or generated visual edges.
- Do not make generated port nodes selectable, draggable, connectable, or
  deletable.
- Preserve original edge ids in generated edge data.
- Keep bundle render data small; add metadata only when current rendering or
  selection code consumes it.
- Keep generated ids deterministic.
- Treat MuSig2 as the primary visual regression fixture.

## Open Direction

Group bundling is not the whole edge-readability solution. Future work should
also explore dense non-group flows:

- fan-in/fan-out hubs
- bus-style routing
- semantic edge grouping
- edge visibility or focus modes
- better routing to reduce canvas-wide crossings
- render-layer projections that do not require persisted dummy nodes

The principle should stay the same: simplify the visual layer while preserving
the real graph and making every represented dependency discoverable.
