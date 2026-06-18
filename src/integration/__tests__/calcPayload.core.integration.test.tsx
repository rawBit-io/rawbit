// Calculation-behavior regression suite — P0 core (P0-1 … P0-4).
//
// The oracle for every assertion is the actual /bulk_calculate REQUEST
// PAYLOAD captured by MSW (plus, where stated, the application of the
// response) — never visible text. See calcPayloadHarness.tsx for the
// real-vs-stubbed breakdown of the harness.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  INTRO,
  captureCalcPayload,
  captureRecalcAllPayload,
  captureStableBaseline,
  editableTextareas,
  fieldCheckbox,
  groupControls,
  installCalcCapture,
  installRadixPointerPolyfills,
  loadIntroFlowGraph,
  mutate,
  nodeHost,
  payloadBytesWithoutVersion,
  payloadNode,
  projectCalcPayload,
  renderCalcHarness,
} from "@/integration/test-helpers/calcPayloadHarness";
import type { FlowNode } from "@/types";
import { SENTINEL_EMPTY, SENTINEL_FORCE00 } from "@/lib/nodes/constants";

installRadixPointerPolyfills();

afterEach(() => {
  cleanup();
});

const user = () => userEvent.setup();

describe("P0-1 concat group add/remove/re-add (node_Xoq2K65O 'Preimage')", () => {
  it("keeps groupInstanceKeys, sparse vals and removed values consistent on the wire", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.preimageConcat],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    const baseNode = payloadNode(baseline, INTRO.preimageConcat);
    expect(baseNode.data.groupInstanceKeys).toEqual({ "INPUTS[]": [0, 100] });
    expect(baseNode.data.groupInstances).toEqual({ "INPUTS[]": 2 });

    const host = nodeHost(harness.view, INTRO.preimageConcat);
    const { minus, plus } = groupControls(host, "INPUTS[]");

    /* add instance at offset 200 via the real "+" control, type "aa" */
    const afterAa = await captureCalcPayload(harness, capture, async () => {
      await u.click(plus);
      // offsets 0/100 are connected (read-only) — the new field is the
      // only editable textarea in the host
      const [field200] = editableTextareas(host);
      expect(field200).toBeDefined();
      await u.type(field200, "aa");
    });
    const nodeAa = payloadNode(afterAa, INTRO.preimageConcat);
    expect(nodeAa.data.groupInstanceKeys).toEqual({
      "INPUTS[]": [0, 100, 200],
    });
    expect(nodeAa.data.groupInstances).toEqual({ "INPUTS[]": 3 });
    expect(
      (nodeAa.data.inputs?.vals as Record<string, string>)["200"]
    ).toBe("aa");

    /* add a second instance at offset 300, type "bb" */
    const afterBb = await captureCalcPayload(harness, capture, async () => {
      await u.click(plus);
      const editable = editableTextareas(host);
      const field300 = editable[editable.length - 1];
      expect(field300.value).toBe(""); // brand-new instance starts empty
      await u.type(field300, "bb");
    });
    const nodeBb = payloadNode(afterBb, INTRO.preimageConcat);
    expect(nodeBb.data.groupInstanceKeys).toEqual({
      "INPUTS[]": [0, 100, 200, 300],
    });
    expect(
      (nodeBb.data.inputs?.vals as Record<string, string>)["300"]
    ).toBe("bb");

    /* remove the LAST instance via the real "–" control (strictly
       last-instance removal — keys.pop() in useGroupInstances) */
    const afterRemove = await captureCalcPayload(harness, capture, async () => {
      await u.click(minus);
    });
    const nodeRemoved = payloadNode(afterRemove, INTRO.preimageConcat);
    expect(nodeRemoved.data.groupInstanceKeys).toEqual({
      "INPUTS[]": [0, 100, 200],
    });
    expect(nodeRemoved.data.groupInstances).toEqual({ "INPUTS[]": 3 });
    // REGRESSION (fixed in useGroupInstances.handleGroupSize): the removed
    // offset's committed value must NOT linger in the wire payload.
    expect(
      nodeRemoved.data.inputs?.vals as Record<string, string>
    ).not.toHaveProperty("300");

    /* RE-ADD an instance → the old "bb" must not resurrect */
    const afterReAdd = await captureCalcPayload(harness, capture, async () => {
      await u.click(plus);
    });
    const nodeReAdded = payloadNode(afterReAdd, INTRO.preimageConcat);
    expect(nodeReAdded.data.groupInstanceKeys).toEqual({
      "INPUTS[]": [0, 100, 200, 300],
    });
    expect(
      nodeReAdded.data.inputs?.vals as Record<string, string>
    ).not.toHaveProperty("300");
    const editableAfterReAdd = editableTextareas(host);
    expect(editableAfterReAdd[editableAfterReAdd.length - 1].value).toBe("");

    /* restore the original layout/values → final payload projection
       equals the baseline golden */
    await captureCalcPayload(harness, capture, async () => {
      await u.click(minus); // drops 300
      await u.click(minus); // drops 200 (and its "aa")
    });
    const restored = await captureRecalcAllPayload(harness, capture);
    expect(projectCalcPayload(restored)).toEqual(projectCalcPayload(baseline));
  });
});

describe("P0-2 sentinels", () => {
  it("(a) __EMPTY__ on node_o6vul7a field 5: untick drops the key, re-tick restores byte-equal payload", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.scriptVerify],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    const baseNode = payloadNode(baseline, INTRO.scriptVerify);
    expect(
      (baseNode.data.inputs?.vals as Record<string, string>)["5"]
    ).toBe(SENTINEL_EMPTY);

    const host = nodeHost(harness.view, INTRO.scriptVerify);
    // script_verification uppercases its field labels
    const checkbox = fieldCheckbox(host, "SPENT_AMOUNT_SATS");
    expect(checkbox).toHaveAttribute("data-state", "checked");

    /* untick → setFieldValue(5, "") → setVal DELETES the sparse key.
       Pinned actual behavior: the payload carries NO "5" entry at all
       (not an empty string). */
    const afterUntick = await captureCalcPayload(harness, capture, async () => {
      await u.click(checkbox);
    });
    const unticked = payloadNode(afterUntick, INTRO.scriptVerify);
    expect(
      unticked.data.inputs?.vals as Record<string, string>
    ).not.toHaveProperty("5");

    /* re-tick → "__EMPTY__" is back; full-graph payload is byte-equal to
       the baseline golden (modulo the always-incrementing version) */
    await captureCalcPayload(harness, capture, async () => {
      await u.click(fieldCheckbox(host, "SPENT_AMOUNT_SATS"));
    });
    const restored = await captureRecalcAllPayload(harness, capture);
    expect(
      (payloadNode(restored, INTRO.scriptVerify).data.inputs?.vals as Record<
        string,
        string
      >)["5"]
    ).toBe(SENTINEL_EMPTY);
    expect(payloadBytesWithoutVersion(restored)).toBe(
      payloadBytesWithoutVersion(baseline)
    );
    expect(restored.version).toBeGreaterThan(baseline.version);
  });

  it("(b) __FORCE00__ via the real checkbox on a synthetic allowEmpty00 field", async () => {
    const capture = installCalcCapture();
    const syntheticNode: FlowNode = {
      id: "node_force00",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "concat_all",
        title: "Force00 Node",
        paramExtraction: "multi_val",
        numInputs: 1,
        inputs: { vals: {} },
        inputStructure: {
          ungrouped: [
            { index: 0, label: "DATA", rows: 1, allowEmpty00: true },
          ],
          groups: [],
        },
        dirty: false,
      },
    };
    const harness = await renderCalcHarness({
      nodes: [syntheticNode],
      edges: [],
      renderIds: ["node_force00"],
    });
    const u = user();

    const host = nodeHost(harness.view, "node_force00");
    const checkbox = fieldCheckbox(host, "DATA");
    expect(checkbox).toHaveAttribute("data-state", "unchecked");

    /* set → vals[0] === "__FORCE00__" on the wire */
    const afterSet = await captureCalcPayload(harness, capture, async () => {
      await u.click(checkbox);
    });
    expect(
      (payloadNode(afterSet, "node_force00").data.inputs?.vals as Record<
        string,
        string
      >)["0"]
    ).toBe(SENTINEL_FORCE00);

    /* unset → no stale sentinel: the sparse key is deleted entirely */
    const afterUnset = await captureCalcPayload(harness, capture, async () => {
      await u.click(fieldCheckbox(host, "DATA"));
    });
    expect(
      payloadNode(afterUnset, "node_force00").data.inputs?.vals
    ).toEqual({});
  });

  it("(c) sentinel on a CONNECTED input ships BOTH the sentinel and the edge", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.scriptVerify],
    });
    const u = user();

    await captureStableBaseline(harness, capture);

    // field 0 (scriptSig_hex) has allowEmptyBlank AND an incoming edge
    // from node_gH7sxRGZ.
    const host = nodeHost(harness.view, INTRO.scriptVerify);
    const checkbox = fieldCheckbox(host, "SCRIPTSIG_HEX");
    expect(checkbox).toHaveAttribute("data-state", "unchecked");

    const afterTick = await captureCalcPayload(harness, capture, async () => {
      await u.click(checkbox);
    });

    // BACKEND PRECEDENCE CONTRACT (backend/graph_logic.py _multi_common):
    //   explicit sentinel  >  connected cable  >  manual value.
    // The frontend therefore must keep the edge in the payload while the
    // sentinel overrides it server-side — deleting either would change
    // semantics. Pin both.
    const node = payloadNode(afterTick, INTRO.scriptVerify);
    expect(
      (node.data.inputs?.vals as Record<string, string>)["0"]
    ).toBe(SENTINEL_EMPTY);
    expect(
      afterTick.edges.some(
        (edge) =>
          edge.source === "node_gH7sxRGZ" &&
          edge.target === INTRO.scriptVerify &&
          edge.targetHandle === "input-0"
      )
    ).toBe(true);
  });
});

describe("P0-3 dynamic tx extract (node_kzcs3gx)", () => {
  it("keeps txExtractFields/outputPorts/outputValues and per-handle edges aligned through add → middle-removal → restore", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.txExtract],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    const baseNode = payloadNode(baseline, INTRO.txExtract);
    expect(baseNode.data.txExtractFields).toEqual(["txid", "vout.scriptPubKey"]);
    const baselineExtractEdges = baseline.edges.filter(
      (edge) => edge.source === INTRO.txExtract
    );
    expect(baselineExtractEdges).toHaveLength(5);

    const host = nodeHost(harness.view, INTRO.txExtract);

    /* add a field via the real "+" control */
    const afterAdd = await captureCalcPayload(harness, capture, async () => {
      await u.click(within(host).getByTitle("Add output"));
    });
    const added = payloadNode(afterAdd, INTRO.txExtract);
    expect(added.data.txExtractFields).toEqual([
      "txid",
      "vout.scriptPubKey",
      "vout.value",
    ]);
    expect(added.data.outputPorts).toEqual([
      { label: "txid", handleId: "output-0", showLabel: false },
      { label: "vout.scriptPubKey", handleId: "output-1", showLabel: false },
      { label: "vout.value", handleId: "output-2", showLabel: false },
    ]);
    // existing committed output values survive; the new port has none yet
    expect(added.data.outputValues).toEqual(baseNode.data.outputValues);
    // every pre-existing edge is intact with its original sourceHandle
    for (const edge of baselineExtractEdges) {
      expect(
        afterAdd.edges.some(
          (candidate) =>
            candidate.source === edge.source &&
            candidate.sourceHandle === edge.sourceHandle &&
            candidate.target === edge.target &&
            candidate.targetHandle === edge.targetHandle
        )
      ).toBe(true);
    }

    /* wire the new output-2 so the removal below has an edge to clean up */
    const afterConnect = await captureCalcPayload(harness, capture, () =>
      mutate(() =>
        harness.connect({
          source: INTRO.txExtract,
          sourceHandle: "output-2",
          target: INTRO.scriptVerify,
          targetHandle: "input-5",
        })
      )
    );
    expect(
      afterConnect.edges.some((edge) => edge.sourceHandle === "output-2")
    ).toBe(true);

    /* "remove a MIDDLE field": production removal is strictly positional
       (resizeTxFieldExtractFields pops the LAST output). Removing a middle
       SEMANTIC field therefore means re-assigning the middle position via
       the real dropdown and then removing the last position. Edges follow
       POSITIONS, not semantics — pinned below. */
    await captureCalcPayload(harness, capture, async () => {
      const selects = within(host).getAllByRole("combobox");
      await u.click(selects[1]); // position 1: "vout.scriptPubKey"
      await u.click(
        await within(document.body).findByRole("option", {
          name: "vout.value",
        })
      );
    });
    const afterRemove = await captureCalcPayload(harness, capture, async () => {
      await u.click(within(host).getByTitle("Remove output"));
    });
    const removed = payloadNode(afterRemove, INTRO.txExtract);
    expect(removed.data.txExtractFields).toEqual(["txid", "vout.value"]);
    expect(removed.data.outputPorts).toEqual([
      { label: "txid", handleId: "output-0", showLabel: false },
      { label: "vout.value", handleId: "output-1", showLabel: false },
    ]);
    // the edge wired to the dropped handle is GONE from the payload
    // (resizeTxFieldExtractFields also deletes connected edges)
    expect(
      afterRemove.edges.some(
        (edge) =>
          edge.source === INTRO.txExtract && edge.sourceHandle === "output-2"
      )
    ).toBe(false);
    // remaining handles still carry the surviving positional edges:
    // output-0 still feeds the same targets, output-1 edges now feed the
    // re-assigned field (positional contract)
    for (const edge of baselineExtractEdges) {
      expect(
        afterRemove.edges.some(
          (candidate) =>
            candidate.source === edge.source &&
            candidate.sourceHandle === edge.sourceHandle &&
            candidate.target === edge.target &&
            candidate.targetHandle === edge.targetHandle
        )
      ).toBe(true);
    }

    /* restore the original field assignment → baseline equality */
    await captureCalcPayload(harness, capture, async () => {
      const selects = within(host).getAllByRole("combobox");
      await u.click(selects[1]);
      await u.click(
        await within(document.body).findByRole("option", {
          name: "vout.scriptPubKey",
        })
      );
    });
    const restored = await captureRecalcAllPayload(harness, capture);
    // NB-04: changing a field type clears that output's cached value; only a
    // real backend recalc repopulates it, which the echo responder cannot — so
    // the round-tripped output-1 value is absent here (in production the next
    // recalc restores it). Everything else returns byte-equal to baseline.
    const projectedBaseline = projectCalcPayload(baseline);
    const expectedRestored = {
      ...projectedBaseline,
      nodes: projectedBaseline.nodes.map((node) => {
        if (node.id !== INTRO.txExtract) return node;
        const outputValues = node.data.outputValues as
          | Record<string, unknown>
          | undefined;
        if (!outputValues) return node;
        const nextOutputValues = { ...outputValues };
        delete nextOutputValues["output-1"];
        return {
          ...node,
          data: { ...node.data, outputValues: nextOutputValues },
        };
      }),
    };
    expect(projectCalcPayload(restored)).toEqual(expectedRestored);
  });
});

describe("P0-4 disconnect/reconnect of a connected input holding a manual value", () => {
  it("drops the edge from the payload while the manual value survives, then re-ships the edge on reconnect", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.scriptVerify],
    });

    const baseline = await captureStableBaseline(harness, capture);
    // node_o6vul7a input-2 (tx_hex) is connected to node_qMmh8Zrk AND
    // holds a committed manual value in inputs.vals["2"].
    const manualValue = (
      payloadNode(baseline, INTRO.scriptVerify).data.inputs?.vals as Record<
        string,
        string
      >
    )["2"];
    expect(typeof manualValue).toBe("string");
    expect(manualValue.length).toBeGreaterThan(0);
    const edgeMatch = (edge: {
      source: string;
      target: string;
      targetHandle?: string | null;
    }) =>
      edge.source === INTRO.finalTxConcat &&
      edge.target === INTRO.scriptVerify &&
      edge.targetHandle === "input-2";
    const originalEdge = baseline.edges.find(edgeMatch);
    expect(originalEdge).toBeDefined();

    /* delete the edge through the production edge-change path (what
       ReactFlow emits when the user deletes a selected edge) */
    const afterDelete = await captureCalcPayload(harness, capture, () =>
      mutate(() =>
        harness.onEdgesChange([{ type: "remove", id: originalEdge!.id }])
      )
    );
    expect(afterDelete.edges.some(edgeMatch)).toBe(false);
    // PINNED frontend behavior: the manual value stays in inputs.vals —
    // disconnecting falls back to it (backend precedence: with no cable
    // and no sentinel, manual text is used).
    expect(
      (payloadNode(afterDelete, INTRO.scriptVerify).data.inputs?.vals as Record<
        string,
        string
      >)["2"]
    ).toBe(manualValue);
    // both endpoints of the removed edge are re-dirtied
    expect(payloadNode(afterDelete, INTRO.scriptVerify).data.dirty).toBe(true);

    /* reconnect through the production connect path */
    const afterReconnect = await captureCalcPayload(harness, capture, () =>
      mutate(() =>
        harness.connect({
          source: INTRO.finalTxConcat,
          sourceHandle: null,
          target: INTRO.scriptVerify,
          targetHandle: "input-2",
        })
      )
    );
    expect(afterReconnect.edges.some(edgeMatch)).toBe(true);
    // PINNED frontend behavior: reconnecting does NOT clear the manual
    // value — both ship; backend precedence makes the cable win
    // (backend/graph_logic.py _multi_common step ④ before step ⑤).
    expect(
      (
        payloadNode(afterReconnect, INTRO.scriptVerify).data.inputs
          ?.vals as Record<string, string>
      )["2"]
    ).toBe(manualValue);

    /* calc-relevant projection equals baseline again (edge ids differ —
       the projection compares connection tuples) */
    const restored = await captureRecalcAllPayload(harness, capture);
    expect(projectCalcPayload(restored)).toEqual(projectCalcPayload(baseline));
  });
});

describe("regression: group-instance removal drops committed values (useGroupInstances)", () => {
  it("clears every field value of the removed instance from inputs.vals", async () => {
    const capture = installCalcCapture();
    const syntheticNode: FlowNode = {
      id: "node_groupvals",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "concat_all",
        title: "Grouped",
        paramExtraction: "multi_val",
        inputs: { vals: { 0: "00", 1: "11", 100: "aa", 101: "bb" } },
        inputStructure: {
          ungrouped: [],
          groups: [
            {
              title: "ITEMS[]",
              baseIndex: 0,
              expandable: true,
              minInstances: 1,
              fields: [
                { index: 0, label: "First", rows: 1 },
                { index: 1, label: "Second", rows: 1 },
              ],
            },
          ],
        },
        groupInstances: { "ITEMS[]": 2 },
        groupInstanceKeys: { "ITEMS[]": [0, 100] },
        dirty: false,
      },
    };
    const harness = await renderCalcHarness({
      nodes: [syntheticNode],
      edges: [],
      renderIds: ["node_groupvals"],
    });
    const u = user();

    const host = nodeHost(harness.view, "node_groupvals");
    const { minus } = groupControls(host, "ITEMS[]");

    const afterRemove = await captureCalcPayload(harness, capture, async () => {
      await u.click(minus);
    });
    const node = payloadNode(afterRemove, "node_groupvals");
    expect(node.data.groupInstanceKeys).toEqual({ "ITEMS[]": [0] });
    // BOTH field values of the removed instance (offsets 100 and 101)
    // are gone; the surviving instance is untouched.
    expect(node.data.inputs?.vals).toEqual({ "0": "00", "1": "11" });
  });
});
