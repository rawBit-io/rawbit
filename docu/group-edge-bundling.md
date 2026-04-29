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
readability direction. It targets the most obvious dense case: repeated edges
crossing from one group to another. MuSig2 (`flow-14`, `p14_MuSig2.json`) is the
main regression fixture.

## Design Goals

1. Reduce visual noise without hiding real dependencies.
2. Keep normal node-to-node edges for ordinary local flow.
3. Bundle repeated cross-group traffic into one outside connection per directed
   group pair.
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
- hidden versions of the original cross-group edges
- normal React Flow segment edges inside each group
- one custom outside bundle edge between the boundary ports

An edge is bundleable when its source belongs to one group, its target belongs to
another group, and at least two edges share that same directed group pair. Single
cross-group edges stay normal.

## Implemented So Far

- Cross-group bundle detection for repeated edges between the same directed
  group pair.
- Render-layer hiding of the represented raw cross-group edges.
- One custom outside bundle edge between generated boundary ports.
- Generated boundary port nodes that are invisible infrastructure, not user
  graph state.
- Normal React Flow segment edges from source nodes to source boundary ports and
  from target boundary ports to target nodes.
- Click/highlight behavior that maps bundle visuals back to the represented
  original edge ids.
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

- Do not draw inside-group bundle legs manually in `GroupBundleEdge`.
- Do not persist generated port nodes or generated visual edges.
- Do not make generated port nodes selectable, draggable, connectable, or
  deletable.
- Preserve original edge ids in generated edge data.
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
