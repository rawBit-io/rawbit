import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import {
  makeEdgeIsLive,
  pruneDanglingEdges,
} from "@/lib/flow/pruneDanglingEdges";
import type { FlowNode } from "@/types";

// A transaction-template node whose OUTPUTS[] group has been reduced to a
// single instance (keys = [3000]) — so the second output's handles (3100/
// 3110/3120) no longer render. Mirrors p5's "Final Raw Transaction" builder.
function txTemplate(): FlowNode {
  return {
    id: "tx",
    type: "calculation",
    position: { x: 0, y: 0 },
    data: {
      functionName: "concat_all",
      inputStructure: {
        ungrouped: [{ index: 0, label: "VERSION[4]:" }],
        groups: [
          {
            baseIndex: 3000,
            title: "OUTPUTS[]",
            minInstances: 1,
            maxInstances: 10,
            expandable: true,
            fields: [
              { index: 0, label: "AMOUNT[8]:" },
              { index: 10, label: "SCRIPT_PUBKEY_LENGTH:" },
              { index: 20, label: "SCRIPT_PUBKEY[]:" },
            ],
          },
        ],
      },
      groupInstanceKeys: { "OUTPUTS[]": [3000] },
    },
  } as unknown as FlowNode;
}

function satNode(): FlowNode {
  return {
    id: "sat",
    type: "calculation",
    position: { x: 0, y: 0 },
    data: { functionName: "decimal_to_8_byte_le" },
  } as unknown as FlowNode;
}

describe("pruneDanglingEdges", () => {
  it("drops an edge to a removed group-instance handle (copy-paste then reduce outputs)", () => {
    const nodes = [satNode(), txTemplate()];
    const edges: Edge[] = [
      // valid: first output's amount handle still exists
      { id: "good", source: "sat", target: "tx", targetHandle: "input-3000" } as Edge,
      // dangling: second output was removed, handle 3100 no longer renders
      { id: "stale", source: "sat", target: "tx", targetHandle: "input-3100" } as Edge,
    ];

    const result = pruneDanglingEdges(nodes, edges);

    expect(result.removed.map((e) => e.id)).toEqual(["stale"]);
    expect(result.edges.map((e) => e.id)).toEqual(["good"]);
  });

  it("keeps edges that target valid handles untouched (same array reference)", () => {
    const nodes = [satNode(), txTemplate()];
    const edges: Edge[] = [
      { id: "v0", source: "sat", target: "tx", targetHandle: "input-0" } as Edge,
      { id: "v1", source: "sat", target: "tx", targetHandle: "input-3010" } as Edge,
    ];

    const result = pruneDanglingEdges(nodes, edges);

    expect(result.removed).toEqual([]);
    expect(result.edges).toBe(edges);
  });

  it("does not prune edges with an absent/empty target handle (legacy default handle)", () => {
    const nodes = [satNode(), txTemplate()];
    const edges: Edge[] = [
      { id: "default", source: "sat", target: "tx" } as Edge,
      { id: "blank", source: "sat", target: "tx", targetHandle: "   " } as Edge,
    ];

    const result = pruneDanglingEdges(nodes, edges);

    expect(result.removed).toEqual([]);
    expect(result.edges).toBe(edges);
  });

  it("does not prune when the target node is missing (orphan handled elsewhere)", () => {
    const nodes = [satNode()];
    const edges: Edge[] = [
      { id: "orphan", source: "sat", target: "ghost", targetHandle: "input-3100" } as Edge,
    ];

    const result = pruneDanglingEdges(nodes, edges);

    expect(result.removed).toEqual([]);
    expect(result.edges).toBe(edges);
  });

  it("returns the input array unchanged when there is nothing to prune", () => {
    expect(pruneDanglingEdges([], []).edges).toEqual([]);
  });
});

describe("makeEdgeIsLive (shared occupancy predicate)", () => {
  // The occupancy checks (Connect dialog, drag-connect, reconnect guard) use
  // this to ignore edges the projection hides — so a dangling edge no longer
  // parks on a visibly-free input (DA-11).
  it("treats an edge on a removed handle as NOT live", () => {
    const nodes = [satNode(), txTemplate()];
    // The tx template's second OUTPUTS instance was removed, so input-3100 no
    // longer renders — an edge landing on that handle is dangling (hidden by
    // the projection) yet would otherwise occupy the input.
    const dangling = {
      id: "e",
      source: "sat",
      target: "tx",
      targetHandle: "input-3100",
    } as Edge;
    expect(makeEdgeIsLive(nodes)(dangling)).toBe(false);
  });

  it("treats an edge on live handles at both ends as live", () => {
    const nodes = [satNode(), txTemplate()];
    const live = {
      id: "e",
      source: "sat",
      target: "tx",
      targetHandle: "input-0",
    } as Edge;
    expect(makeEdgeIsLive(nodes)(live)).toBe(true);
  });

  it("is conservative: an edge whose node cannot be enumerated is live", () => {
    const live = {
      id: "e",
      source: "ghost",
      target: "ghost2",
      targetHandle: "input-0",
    } as Edge;
    expect(makeEdgeIsLive([])(live)).toBe(true);
  });
});
