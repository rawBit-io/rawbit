# Flow Map - Logic Specification

## Overview

The flow map renders each group as a compact card with boundary nodes on two sides:
left (inputs, sources) and right (outputs, results). Internal processing nodes are
hidden. Cross-group data flow is shown as bundled connection lines between cards.

The goal is a protocol-level overview: what enters each group, what leaves, and where
it goes. The user clicks through to the canvas for internal details.

All classification is automatic, flow-agnostic, and deterministic.

---

## 1. Definitions

**Group** - a node with `type === "shadcnGroup"` unless its data has
`excludeFromFlowMap === true`.

**Internal node** - any non-group, non-`shadcnTextInfo` node where
`parentId === group.id`.

**Internal edge** - both endpoints are included internal nodes in the same group.

**Cross-group edge** - source and target are included nodes that belong to
different groups.

**Bundle** - all cross-group edges for one directed group pair `(A -> B)`.

---

## 2. Group Presentation

Each group is rendered in one of three presentation modes:

| Mode | When used | Purpose |
| --- | --- | --- |
| `full` | Default | Show visible boundary nodes and internal summary links. |
| `lanes` | Participant rows are detected with confidence >= 0.6 | Preserve Alice/Bob/etc. row structure in protocol flows. |
| `compressed` | Group has at least 18 nodes, or at least 10 sighash-like nodes | Collapse dense groups into semantic sections. |

Compressed sections are derived from node names, function names, comments, and
graph depth. Sighash-like groups prefer sections such as TX Inputs, Hash
Pipeline, Preimage Assembly, and Final Digest.

---

## 3. Per-Node Metrics

For each internal node `v`:

| Metric         | Definition                                          |
| -------------- | --------------------------------------------------- |
| `in_int(v)`    | Count of incoming internal edges                    |
| `out_int(v)`   | Count of outgoing internal edges                    |
| `in_cross(v)`  | `true` if `v` is targeted by any cross-group edge   |
| `out_cross(v)` | `true` if `v` is the source of any cross-group edge |

---

## 4. Classification Rules

Each node is classified by the first rule it matches (top to bottom). A node appears
on exactly one side, or is hidden.

| Priority | Role   | Side  | Condition                                 |
| -------- | ------ | ----- | ----------------------------------------- |
| 1        | Root   | Left  | `in_int = 0` and `in_cross = false`       |
| 2        | Sink   | Right | `out_int = 0` and `out_cross = false`     |
| 3        | Output | Right | `out_cross = true` and `in_cross = false` |
| 4        | Entry  | Left  | `in_cross = true` and `out_cross = false` |
| 5        | Dual   | Left  | `in_cross = true` and `out_cross = true`  |
| 6        | Hidden | -     | Everything else                           |

**Root** - no inputs at all. Constants, randoms, editable fields.

**Sink** - no outputs at all. Terminal results (Verify Script, TXID->Reversed).

**Output** - produces data consumed by other groups, fed only internally.

**Entry** - receives data from other groups, outputs stay internal.

**Dual** - both receives from and sends to other groups. Defaults to left because
the node's role as an entry point for external data takes visual priority.

**Hidden** - pure internal processing (encoders, hashes, concat nodes).

**Why Sink is above Entry:** a node with no outputs is always a terminal result,
regardless of where its inputs come from. Without this priority, nodes like
Verify Script (which receives cross-group data but produces nothing) would be
classified as Entry and placed on the left - misleading.

### 4.1 Empty-Right Recovery

After classification, if a group has zero right-side nodes, the Dual node with
the highest cross-group out-degree is promoted from left to right.

This prevents groups from appearing to have no outputs. Ties resolve by
canvas position `(y, x)` then `id`.

---

## 5. Ordering Within Groups

### 5.1 Left side

Sorted by canvas position `(y, x)` then `id`.

### 5.2 Right side

The node with the greatest canvas x-position is designated the **main output**.
It is sorted first (above other right-side nodes) and rendered with bold emphasis.
Ties resolve by `(y, id)`.

All remaining right-side nodes are sorted by `(y, x)` then `id`.

This highlights the group's primary result - for example, `Data -> SHA-256` (the
tagged sighash) in PREIMAGE, or `MuSig2 Nonce Agg` in ROUND 1.

---

## 6. Hidden Endpoint Remapping

Cross-group edges may connect to hidden internal nodes. These endpoints are remapped
to the nearest visible boundary node so that connection lines land on something the
user can see and click.

### 6.1 Outbound remap (source is hidden)

1. Candidates: visible right-side nodes in the source group.
2. If the source node is already visible on the right, use it directly.
3. Otherwise: shortest path forward through the directed internal graph to a candidate.
4. Fallback: shortest path through undirected internal graph.
5. If no candidate found: edge stays in the bundle but no line renders.

### 6.2 Inbound remap (target is hidden)

1. Candidates: visible left-side nodes in the target group.
2. If the target node is already visible on the left, use it directly.
3. Otherwise: shortest path backward (reverse directed) to a candidate.
4. Fallback: shortest path through undirected internal graph.
5. If no candidate found: edge stays in the bundle but no line renders.

---

## 7. Cross-Group Connection Lines

1. Bundle key: directed group pair `(sourceGroupId, targetGroupId)`.
2. One bundle per directed pair.
3. Each bundle stores raw edge references (`edgeId`, `sourceNodeId`, `targetNodeId`).
4. Lines are resolved from remapped endpoints (section 6).
5. One rendered line per unique `(sourceBoundaryNode, targetBoundaryNode)` pair.
6. Multiple raw edges mapping to the same pair merge into one line.
7. No edge labels or count badges.

---

## 8. Intra-Group Summary Links

Thin internal lines connect left-side nodes to right-side nodes they can reach:

1. For each visible left node `i`, compute forward reachability in the internal graph.
2. For each visible right node `o` reachable from `i`, add a summary link `i -> o`.
3. Deduplicate and cap at 24 links per group.

---

## 9. Noise Controls

| Limit                         | Value |
| ----------------------------- | ----- |
| Max left-side boundary nodes  | 16    |
| Max right-side boundary nodes | 8     |
| Max intra-group summary links | 24    |

When a side exceeds its limit, overflow is collapsed into a `+ N more` chip
(non-interactive).

---

## 10. Layout

1. Groups arranged left-to-right using a dependency DAG derived from bundles.
2. Cycles or unresolved dependencies: fallback to canvas x-position with
   dependency-based lower bounds.
3. Left and right boundary nodes are row-aligned inside each card.

---

## 11. Interaction

| Action                          | Effect                                                                    |
| ------------------------------- | ------------------------------------------------------------------------- |
| Click group header/card         | Focus group on canvas (fitView, tight framing)                            |
| Click boundary node             | Focus that node on canvas                                                 |
| Click connection line           | Select matching canvas edges, focus endpoints                             |
| Click empty panel / close panel | Clear selected panel connection (and corresponding selected canvas edges) |
| Canvas edge selection cleared   | Panel connection selection cleared to stay in sync                        |
| Group comment icon              | Toggle comment expand/collapse                                            |

Panel supports pan, zoom, fit-view, resize, and group drag (3px threshold to
distinguish click from drag).

---

## 12. Determinism

All ordering is stable across renders:

1. Groups: computed level (topological layering) first, then canvas position `(y, x)` then `id` within
   level. Cycles fall back to x-position heuristic with dependency-based lower bounds.
2. Left-side nodes: `(y, x)` then `id`.
3. Right-side nodes: main output first, then `(y, x)` then `id` (see section 5).
4. Adjacency lists: deduplicated and lexicographically sorted.

---

## 13. Planned - Not Yet Implemented

### Role-tier grouping (left side)

Currently left-side nodes interleave by canvas position regardless of role. In
ROUND 1: NONCES this causes Random and NonceGen nodes to alternate.

Proposed: sort left side by role tier first, then canvas position within tier.

**Tiers:** Root -> Entry -> Dual

This would group same-role nodes together (all Randoms, then all NonceGens).
Same principle could apply to the right side: Main output -> Sink -> Output.
