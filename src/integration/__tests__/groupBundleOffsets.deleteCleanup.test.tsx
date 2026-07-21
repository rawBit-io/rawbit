// REGRESSION: deleting a shadcnGroup must prune surviving groups'
// `data.groupBundlePortOffsets` entries whose bundle key references the
// deleted group (pruneGroupBundleOffsetsForRemovedNodes, wired into
// useFlowInteractions.removeEdgesForRemovedNodes and the whole-group
// ungroup path in useNodeOperations).
//
// History: this file started as a pinned reproduction of the opposite
// behavior — the delete pipeline (GroupNode deleteGroup → rf.deleteElements
// → onNodesChange remove changes → Flow.tsx handleElementsDelete) cleaned
// edges and dirty flags but never touched groupBundlePortOffsets, so a
// surviving group kept `sourceByBundle["<survivor>-><deleted>"]` forever
// (observed in p15_Spilman.json lesson authoring: three sourceByBundle keys
// referencing the deleted Final-TX3 group node_ylKIH7H5). Import remap
// keeps unknown ids verbatim and export serializes node data as-is, so the
// keys were immortal once written. The prune closes that gap; these tests
// keep it closed.
//
// Entry point: the calc harness renders CalculationNode only (never
// GroupNode), so the GroupNode portal-menu "Delete Node" button cannot be
// clicked here. Instead we run the SAME canonical pipeline deleteElements
// runs: @xyflow/system's getElementsToRemove (the exact helper
// rf.deleteElements calls) computes the removal set (group + cascaded child
// via parentHit + connected edges), and the resulting remove changes are
// replayed through harness.onEdgesChange / harness.onNodesChange — the very
// handlers the ReactFlow store's triggerEdgeChanges/triggerNodeChanges
// invoke (see ReactFlowStoreBridge in calcPayloadHarness.tsx). Both the
// GroupNode delete button and keyboard delete route through deleteElements,
// so this exercises the identical production remove path.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import type { Edge, EdgeChange, NodeChange } from "@xyflow/react";
import { getElementsToRemove } from "@xyflow/system";

import {
  captureCalcPayload,
  captureStableBaseline,
  installCalcCapture,
  mutate,
  payloadHasNode,
  renderCalcHarness,
} from "@/integration/test-helpers/calcPayloadHarness";
import type { FlowNode, NodeData } from "@/types";

afterEach(() => {
  cleanup();
});

/* ────────────────────────────────────────────────────────────────────────
 * Minimal three-group flow (shapes mirror real lesson JSON, e.g.
 * p15_Spilman.json: shadcnGroup with isGroup/width/height/dragHandle,
 * children with parentId + extent:"parent" and relative positions).
 * Bundles: A->B (edge_ab) and A->C (edge_ac); group A carries dragged
 * per-bundle source port offsets for BOTH bundles.
 * ──────────────────────────────────────────────────────────────────────── */

const GROUP_A = "group_a";
const GROUP_B = "group_b";
const GROUP_C = "group_c";
const A_CHILD = "node_a_child";
const B_CHILD = "node_b_child";
const C_CHILD = "node_c_child";
const EDGE_AB = "edge_ab";
const EDGE_AC = "edge_ac";
const BUNDLE_AB = `${GROUP_A}->${GROUP_B}`;
const BUNDLE_AC = `${GROUP_A}->${GROUP_C}`;
const OFFSET_AB = 123.45;
const OFFSET_AC = 67.89;

const makeGroup = (
  id: string,
  title: string,
  x: number,
  y: number,
  extraData: Record<string, unknown> = {}
): FlowNode => ({
  id,
  type: "shadcnGroup",
  position: { x, y },
  width: 420,
  height: 320,
  dragHandle: "[data-drag-handle]",
  data: {
    isGroup: true,
    title,
    width: 420,
    height: 320,
    dirty: false,
    ...extraData,
  },
});

/** identity input node holding a manual value (mirrors intro "Sequence"). */
const makeSourceChild = (id: string, parentId: string): FlowNode => ({
  id,
  type: "calculation",
  position: { x: 32, y: 76 },
  parentId,
  extent: "parent",
  data: {
    functionName: "identity",
    title: "A source",
    showField: true,
    numInputs: 0,
    value: "aa",
    inputs: { val: "aa" },
    inputStructure: {
      ungrouped: [{ index: 0, label: "INPUT VALUE:", rows: 1 }],
    },
    groupInstances: {},
    dirty: false,
  },
});

/** concat_all consumer with one connectable input-0. */
const makeTargetChild = (
  id: string,
  title: string,
  parentId: string
): FlowNode => ({
  id,
  type: "calculation",
  position: { x: 32, y: 76 },
  parentId,
  extent: "parent",
  data: {
    functionName: "concat_all",
    title,
    paramExtraction: "multi_val",
    numInputs: 1,
    inputs: { vals: {} },
    inputStructure: {
      ungrouped: [{ index: 0, label: "DATA", rows: 1 }],
      groups: [],
    },
    dirty: false,
  },
});

const buildGraph = (
  groupAOffsets: Record<string, unknown>
): { nodes: FlowNode[]; edges: Edge[] } => ({
  // parents MUST precede children (ReactFlow store contract)
  nodes: [
    makeGroup(GROUP_A, "Group A", 0, 0, {
      groupBundlePortOffsets: groupAOffsets,
    }),
    makeGroup(GROUP_B, "Group B", 700, 0),
    makeGroup(GROUP_C, "Group C", 700, 500),
    makeSourceChild(A_CHILD, GROUP_A),
    makeTargetChild(B_CHILD, "B sink", GROUP_B),
    makeTargetChild(C_CHILD, "C sink", GROUP_C),
  ],
  edges: [
    {
      id: EDGE_AB,
      source: A_CHILD,
      sourceHandle: null,
      target: B_CHILD,
      targetHandle: "input-0",
    },
    {
      id: EDGE_AC,
      source: A_CHILD,
      sourceHandle: null,
      target: C_CHILD,
      targetHandle: "input-0",
    },
  ],
});

const groupOffsets = (node: FlowNode) =>
  (node.data as NodeData).groupBundlePortOffsets;

/** Delete group C through the canonical deleteElements pipeline. */
const deleteGroupC = async (
  harness: Awaited<ReturnType<typeof renderCalcHarness>>,
  capture: ReturnType<typeof installCalcCapture>
) => {
  const removal = await getElementsToRemove<FlowNode, Edge>({
    nodesToRemove: [{ id: GROUP_C }],
    edgesToRemove: [],
    nodes: harness.getNodes(),
    edges: harness.getEdges(),
  });
  // deleteElements cascade sanity: the group, its child, and the A→C edge
  expect(removal.nodes.map((node) => node.id).sort()).toEqual([
    GROUP_C,
    C_CHILD,
  ]);
  expect(removal.edges.map((edge) => edge.id)).toEqual([EDGE_AC]);

  return captureCalcPayload(harness, capture, () =>
    mutate(() => {
      harness.onEdgesChange(
        removal.edges.map(
          (edge): EdgeChange => ({ type: "remove", id: edge.id })
        )
      );
      harness.onNodesChange(
        removal.nodes.map(
          (node): NodeChange<FlowNode> => ({ type: "remove", id: node.id })
        )
      );
    })
  );
};

describe("group deletion prunes stale groupBundlePortOffsets", () => {
  it("drops sourceByBundle['group_a->group_c'] when group C is deleted, keeping the live A->B entry", async () => {
    const capture = installCalcCapture();
    const harness = await renderCalcHarness(
      buildGraph({
        sourceByBundle: {
          [BUNDLE_AB]: OFFSET_AB,
          [BUNDLE_AC]: OFFSET_AC,
        },
      })
    );

    /* ── baseline: graph is live, both bundles exist on the wire ────── */
    const baseline = await captureStableBaseline(harness, capture);
    expect(payloadHasNode(baseline, C_CHILD)).toBe(true);
    expect(
      baseline.edges.some(
        (edge) => edge.source === A_CHILD && edge.target === C_CHILD
      )
    ).toBe(true);
    expect(groupOffsets(harness.getNode(GROUP_A))?.sourceByBundle).toEqual({
      [BUNDLE_AB]: OFFSET_AB,
      [BUNDLE_AC]: OFFSET_AC,
    });

    const afterDelete = await deleteGroupC(harness, capture);

    /* ── group C, its child and its edges are gone ──────────────────── */
    const survivingIds = new Set(harness.getNodes().map((node) => node.id));
    expect(survivingIds.has(GROUP_C)).toBe(false);
    expect(survivingIds.has(C_CHILD)).toBe(false);
    expect(survivingIds.has(GROUP_A)).toBe(true);
    expect(payloadHasNode(afterDelete, C_CHILD)).toBe(false);

    /* ── the stale entry is pruned; the live one survives untouched ─── */
    const offsetsAfter = groupOffsets(harness.getNode(GROUP_A));
    expect(offsetsAfter?.sourceByBundle?.[BUNDLE_AC]).toBeUndefined();
    expect(offsetsAfter?.sourceByBundle).toEqual({
      [BUNDLE_AB]: OFFSET_AB,
    });

    // the healthy A->B bundle is unaffected collateral-wise
    expect(
      harness
        .getEdges()
        .some((edge) => edge.source === A_CHILD && edge.target === B_CHILD)
    ).toBe(true);
    expect(groupOffsets(harness.getNode(GROUP_B))).toBeUndefined();
  });

  it("removes the whole groupBundlePortOffsets field when its only entry referenced the deleted group", async () => {
    const capture = installCalcCapture();
    const harness = await renderCalcHarness(
      buildGraph({
        sourceByBundle: {
          [BUNDLE_AC]: OFFSET_AC,
        },
      })
    );
    await captureStableBaseline(harness, capture);

    await deleteGroupC(harness, capture);

    // Empty maps must not linger: a stale-only per-bundle map would keep
    // suppressing the legacy scalar offset fallback (NB-19 guard in
    // groupEdgeBundling.ts) even though it points at nothing.
    expect(groupOffsets(harness.getNode(GROUP_A))).toBeUndefined();
  });
});
