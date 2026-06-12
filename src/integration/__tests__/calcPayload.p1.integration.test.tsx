// Calculation-behavior regression suite — P1 (B-11, B-12, B-13/14).
// Oracle: the captured /bulk_calculate request payload.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  INTRO,
  captureCalcPayload,
  captureRecalcAllPayload,
  captureSavedFlowJson,
  captureStableBaseline,
  editableTextareas,
  fieldCheckbox,
  groupControls,
  importFlowJson,
  installCalcCapture,
  installRadixPointerPolyfills,
  loadIntroFlowGraph,
  mutate,
  nodeHost,
  payloadNode,
  projectCalcPayload,
  renderCalcHarness,
} from "@/integration/test-helpers/calcPayloadHarness";
import { restoreScriptSteps } from "@/lib/share/scriptStepsCache";
import { SENTINEL_EMPTY } from "@/lib/nodes/constants";

installRadixPointerPolyfills();

afterEach(() => {
  cleanup();
});

const user = () => userEvent.setup();

describe("B-11 selectedNetwork roundtrip (node_GJptZvmY)", () => {
  it("ships selectedNetwork on every change and returns byte-stable to baseline", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.address],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    expect(payloadNode(baseline, INTRO.address).data.selectedNetwork).toBe(
      "testnet"
    );

    const host = nodeHost(harness.view, INTRO.address);
    const trigger = within(host).getByRole("combobox");
    expect(trigger).toHaveTextContent("Testnet");

    /* testnet → mainnet via the real dropdown */
    const afterMainnet = await captureCalcPayload(harness, capture, async () => {
      await u.click(trigger);
      await u.click(
        await within(document.body).findByRole("option", { name: "Mainnet" })
      );
    });
    expect(payloadNode(afterMainnet, INTRO.address).data.selectedNetwork).toBe(
      "mainnet"
    );

    /* mainnet → testnet */
    const afterTestnet = await captureCalcPayload(harness, capture, async () => {
      await u.click(within(host).getByRole("combobox"));
      await u.click(
        await within(document.body).findByRole("option", { name: "Testnet" })
      );
    });
    expect(payloadNode(afterTestnet, INTRO.address).data.selectedNetwork).toBe(
      "testnet"
    );

    /* final payload equals baseline */
    const restored = await captureRecalcAllPayload(harness, capture);
    expect(projectCalcPayload(restored)).toEqual(projectCalcPayload(baseline));
  });
});

describe("B-12 undo/redo with recalc (real UndoRedoProvider history)", () => {
  // The harness hosts the REAL UndoRedoProvider: pushState/undo/redo and
  // snapshot cloning are production code. The only replicated piece is
  // Flow.tsx's pointer-watching restore effect (apply history[pointer]
  // with dirty cleared), which lives in the harness because the original
  // is inseparable from Flow's tab machinery.
  it("undo returns the payload to baseline, redo to the edited state", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.scriptVerify],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    await mutate(() => harness.initializeHistory());

    /* edit: untick the __EMPTY__ sentinel on field 5 */
    const host = nodeHost(harness.view, INTRO.scriptVerify);
    const edited = await captureCalcPayload(harness, capture, async () => {
      await u.click(fieldCheckbox(host, "SPENT_AMOUNT_SATS"));
    });
    expect(
      payloadNode(edited, INTRO.scriptVerify).data.inputs?.vals
    ).not.toHaveProperty("5");

    const editedGolden = await captureRecalcAllPayload(harness, capture);
    await mutate(() => harness.pushHistory("Sentinel edit"));

    /* undo → payload equals baseline */
    await mutate(() => harness.undo());
    await waitFor(() =>
      expect(
        (
          harness.getNode(INTRO.scriptVerify).data.inputs?.vals as Record<
            string,
            string
          >
        )["5"]
      ).toBe(SENTINEL_EMPTY)
    );
    const afterUndo = await captureRecalcAllPayload(harness, capture);
    expect(projectCalcPayload(afterUndo)).toEqual(
      projectCalcPayload(baseline)
    );

    /* redo → payload equals the edited golden again */
    await mutate(() => harness.redo());
    await waitFor(() =>
      expect(
        harness.getNode(INTRO.scriptVerify).data.inputs?.vals as Record<
          string,
          string
        >
      ).not.toHaveProperty("5")
    );
    const afterRedo = await captureRecalcAllPayload(harness, capture);
    expect(projectCalcPayload(afterRedo)).toEqual(
      projectCalcPayload(editedGolden)
    );
  });
});

describe("B-13/14 save → import roundtrip after edits", () => {
  it("the saveFlow export re-imported through the real pipeline preserves the calc-relevant projection", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.preimageConcat, INTRO.scriptVerify],
    });
    const u = user();

    await captureStableBaseline(harness, capture);

    /* real mutations: add a group instance with a value + sentinel change */
    const concatHost = nodeHost(harness.view, INTRO.preimageConcat);
    const { plus } = groupControls(concatHost, "INPUTS[]");
    await captureCalcPayload(harness, capture, async () => {
      await u.click(plus);
      const [newField] = editableTextareas(concatHost);
      await u.type(newField, "aa");
    });

    const verifyHost = nodeHost(harness.view, INTRO.scriptVerify);
    await captureCalcPayload(harness, capture, async () => {
      await u.click(fieldCheckbox(verifyHost, "SPENT_AMOUNT_SATS"));
    });

    /* golden payload of the EDITED state */
    const editedGolden = await captureRecalcAllPayload(harness, capture);
    const editedNode = payloadNode(editedGolden, INTRO.preimageConcat);
    expect(
      (editedNode.data.inputs?.vals as Record<string, string>)["200"]
    ).toBe("aa");

    /* real export path */
    const json = await captureSavedFlowJson(harness);
    const parsed = JSON.parse(json) as { nodes: unknown[]; edges: unknown[] };
    expect(parsed.nodes.length).toBe(graph.nodes.length);

    /* fresh canvas, then the real import pipeline (handleFileSelect) */
    await mutate(() => {
      harness.setRenderIds([]);
      harness.setNodes([]);
      harness.setEdges([]);
      restoreScriptSteps([]);
    });
    await importFlowJson(harness, json, graph.nodes.length);

    /* calc-relevant projection is unchanged vs the edited state */
    const reimported = await captureRecalcAllPayload(harness, capture);
    expect(projectCalcPayload(reimported)).toEqual(
      projectCalcPayload(editedGolden)
    );
    // spot-check the edits actually made the trip
    expect(
      (
        payloadNode(reimported, INTRO.preimageConcat).data.inputs
          ?.vals as Record<string, string>
      )["200"]
    ).toBe("aa");
    expect(
      payloadNode(reimported, INTRO.scriptVerify).data.inputs?.vals
    ).not.toHaveProperty("5");
  });
});
