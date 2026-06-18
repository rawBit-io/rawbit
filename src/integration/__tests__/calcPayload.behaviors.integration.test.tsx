// Calculation-behavior regression suite — error paths and behaviors
// (P0-5, A-6 … A-10). Oracle: the captured /bulk_calculate request payload
// and, where stated, the application of the response into node state.

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";

import {
  INTRO,
  captureCalcPayload,
  captureRecalcAllPayload,
  captureStableBaseline,
  echoCalcResponse,
  fieldTextarea,
  hasDirtyCalculableNodes,
  installCalcCapture,
  installRadixPointerPolyfills,
  loadIntroFlowGraph,
  mutate,
  nodeHost,
  payloadHasNode,
  payloadNode,
  projectCalcPayload,
  renderCalcHarness,
} from "@/integration/test-helpers/calcPayloadHarness";
import type { CapturedCalcBody } from "@/integration/test-helpers/calcPayloadHarness";
import { CALCULATION_REQUEST_TIMEOUT_MESSAGE } from "@/lib/graphUtils";
import { getScriptSteps } from "@/lib/share/scriptStepsCache";
import type { FlowNode, ScriptExecutionResult } from "@/types";

installRadixPointerPolyfills();

afterEach(() => {
  cleanup();
});

const user = () => userEvent.setup();

/* ────────────────────────────────────────────────────────────────────────
 * P0-5 error paths
 * ──────────────────────────────────────────────────────────────────────── */

describe("P0-5 error paths", () => {
  it("backend per-node error → error/extendedError stored; restore → cleared, result back to baseline", async () => {
    let mode: "echo" | "invalid" = "echo";
    const capture = installCalcCapture((body) => {
      if (mode === "invalid") {
        return HttpResponse.json(
          {
            nodes: body.nodes,
            version: body.version,
            errors: [{ nodeId: INTRO.sequence, error: "invalid hex" }],
          },
          { status: 422 }
        );
      }
      return echoCalcResponse(body);
    });
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.sequence],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    const baselineValue = payloadNode(baseline, INTRO.sequence).data
      .value as string;
    const baselineResult = payloadNode(baseline, INTRO.sequence).data.result;

    const host = nodeHost(harness.view, INTRO.sequence);
    const textarea = fieldTextarea(host, "INPUT VALUE:");
    expect(textarea.value).toBe(baselineValue);

    /* invalid input + backend error response */
    mode = "invalid";
    const errorPayload = await captureCalcPayload(harness, capture, async () => {
      await u.clear(textarea);
      await u.type(textarea, "zz");
    });
    expect(payloadNode(errorPayload, INTRO.sequence).data.value).toBe("zz");

    const erroredNode = harness.getNode(INTRO.sequence);
    expect(erroredNode.data.error).toBe(true);
    expect(erroredNode.data.extendedError).toBe("invalid hex");
    expect(harness.status()).toBe("ERROR");
    expect(
      harness.errors().some(
        (entry) =>
          entry.nodeId === INTRO.sequence && entry.error === "invalid hex"
      )
    ).toBe(true);
    // input value survives the error round-trip uncorrupted
    expect(erroredNode.data.value).toBe("zz");

    /* restore value + MSW success → both cleared, result back to baseline */
    mode = "echo";
    await captureCalcPayload(harness, capture, async () => {
      await u.clear(textarea);
      await u.type(textarea, baselineValue);
    });
    const restoredNode = harness.getNode(INTRO.sequence);
    expect(restoredNode.data.error).toBe(false);
    expect(restoredNode.data.extendedError).toBeUndefined();
    expect(restoredNode.data.result).toEqual(baselineResult);
    expect(harness.status()).toBe("OK");

    const restored = await captureRecalcAllPayload(harness, capture);
    expect(projectCalcPayload(restored)).toEqual(projectCalcPayload(baseline));
  });

  it("HTTP 429 budget-style response marks nodes with the budget detail and keeps inputs uncorrupted", async () => {
    const budgetDetail =
      "Calculation requests are limited to 10.0 seconds of server-side work per 60-second window";
    let mode: "echo" | "budget" = "echo";
    const capture = installCalcCapture((body) => {
      if (mode === "budget") {
        // exact backend shape: routes.py _calculation_budget_error — O(1), no
        // echoed `nodes` array (NB-11). The client annotates its own nodes from
        // the single synthetic error entry.
        return HttpResponse.json(
          {
            error: "calculation_time_limited",
            detail: budgetDetail,
            observedSeconds: 11.2,
            version: body.version,
            errors: [
              { nodeId: "__calculation_budget__", error: budgetDetail },
            ],
          },
          { status: 429 }
        );
      }
      return echoCalcResponse(body);
    });
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.sequence],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    const baselineValue = payloadNode(baseline, INTRO.sequence).data
      .value as string;
    const host = nodeHost(harness.view, INTRO.sequence);
    const textarea = fieldTextarea(host, "INPUT VALUE:");

    mode = "budget";
    await captureCalcPayload(harness, capture, async () => {
      await u.clear(textarea);
      await u.type(textarea, "00000000");
    });
    const limited = harness.getNode(INTRO.sequence);
    expect(limited.data.error).toBe(true);
    expect(limited.data.extendedError).toBe(budgetDetail);
    expect(harness.status()).toBe("ERROR");
    // the edited input survives the 429 uncorrupted
    expect(limited.data.value).toBe("00000000");
    expect(limited.data.inputs?.val).toBe("00000000");

    // The cheap budget rejection (NB-11) annotates the dirty nodes locally
    // instead of echoing an error-annotated graph, so — exactly like the
    // network/timeout error paths — it does NOT null other nodes' cached
    // script steps.
    expect(getScriptSteps(INTRO.scriptVerify)).not.toBeNull();

    mode = "echo";
    await captureCalcPayload(harness, capture, async () => {
      await u.clear(textarea);
      await u.type(textarea, baselineValue);
    });
    const restored = await captureRecalcAllPayload(harness, capture);
    expect(projectCalcPayload(restored)).toEqual(projectCalcPayload(baseline));
    expect(harness.status()).toBe("OK");
  });

  it("network error annotates dirty nodes with the local-backend hint; values survive; success clears", async () => {
    let mode: "echo" | "network" = "echo";
    const capture = installCalcCapture((body) => {
      if (mode === "network") return HttpResponse.error();
      return echoCalcResponse(body);
    });
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.sequence],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    const baselineValue = payloadNode(baseline, INTRO.sequence).data
      .value as string;
    const host = nodeHost(harness.view, INTRO.sequence);
    const textarea = fieldTextarea(host, "INPUT VALUE:");

    mode = "network";
    await captureCalcPayload(harness, capture, async () => {
      await u.clear(textarea);
      await u.type(textarea, "deadbeef");
    });
    const failed = harness.getNode(INTRO.sequence);
    expect(failed.data.error).toBe(true);
    // graphUtils maps connection failures against a localhost API base to
    // the local-backend hint (recalculateGraph catch path)
    expect(failed.data.extendedError).toBe(
      "Backend not running. Start it with: python routes.py"
    );
    expect(failed.data.value).toBe("deadbeef");
    expect(harness.status()).toBe("ERROR");

    mode = "echo";
    await captureCalcPayload(harness, capture, async () => {
      await u.clear(textarea);
      await u.type(textarea, baselineValue);
    });
    const restored = await captureRecalcAllPayload(harness, capture);
    expect(projectCalcPayload(restored)).toEqual(projectCalcPayload(baseline));
    expect(harness.status()).toBe("OK");
  });

  it("request timeout (AbortError) maps to the timeout message; values survive; retry clears", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.sequence],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    const baselineValue = payloadNode(baseline, INTRO.sequence).data
      .value as string;
    const host = nodeHost(harness.view, INTRO.sequence);
    const textarea = fieldTextarea(host, "INPUT VALUE:");

    // Deterministic AbortError without waiting out the 15 s budget: reject
    // the /bulk_calculate fetch exactly like an aborted request would.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(
        input instanceof Request ? input.url : input
      );
      if (url.includes("/bulk_calculate")) {
        const abort = new Error("aborted");
        abort.name = "AbortError";
        return Promise.reject(abort);
      }
      return originalFetch(input as RequestInfo, init);
    }) as typeof fetch;

    try {
      await u.clear(textarea);
      await u.type(textarea, "cafebabe");
      await waitFor(
        () => {
          const node = harness.getNode(INTRO.sequence);
          expect(node.data.error).toBe(true);
          expect(hasDirtyCalculableNodes(harness)).toBe(false);
        },
        { timeout: 8000 }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const timedOut = harness.getNode(INTRO.sequence);
    expect(timedOut.data.extendedError).toBe(
      CALCULATION_REQUEST_TIMEOUT_MESSAGE
    );
    expect(timedOut.data.value).toBe("cafebabe");
    expect(harness.status()).toBe("ERROR");

    await captureCalcPayload(harness, capture, async () => {
      await u.clear(textarea);
      await u.type(textarea, baselineValue);
    });
    const restored = await captureRecalcAllPayload(harness, capture);
    expect(projectCalcPayload(restored)).toEqual(projectCalcPayload(baseline));
    expect(harness.status()).toBe("OK");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * A-6 stale-response race
 * ──────────────────────────────────────────────────────────────────────── */

describe("A-6 stale-response race", () => {
  it("a delayed first response never overwrites results from a later edit", async () => {
    const makeIdentity = (id: string, value: string): FlowNode => ({
      id,
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "identity",
        title: id,
        showField: true,
        paramExtraction: "single_val",
        numInputs: 1,
        value,
        inputs: { val: value },
        result: value,
        dirty: false,
      },
    });

    let release: ((response: Response) => void) | null = null;
    let firstBody: CapturedCalcBody | null = null;
    let calls = 0;
    const capture = installCalcCapture((body) => {
      calls += 1;
      if (calls === 1) {
        firstBody = body;
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return HttpResponse.json({
        nodes: body.nodes.map((node) => ({
          ...node,
          data: { ...node.data, result: `fresh-${node.id}` },
        })),
        version: body.version,
        errors: [],
      });
    });

    const harness = await renderCalcHarness({
      nodes: [makeIdentity("node_raceA", "aa"), makeIdentity("node_raceB", "bb")],
      edges: [],
      renderIds: ["node_raceA", "node_raceB"],
    });
    const u = user();

    const hostA = nodeHost(harness.view, "node_raceA");
    const hostB = nodeHost(harness.view, "node_raceB");
    const taA = fieldTextarea(hostA, "INPUT VALUE:");
    const taB = fieldTextarea(hostB, "INPUT VALUE:");

    /* edit A — its request is held open by the deferred responder */
    await u.type(taA, "1"); // "aa1", single keystroke → single request
    await waitFor(() => expect(capture.bodies.length).toBe(1));
    expect(payloadNode(capture.bodies[0], "node_raceA").data.value).toBe("aa1");
    // A is still dirty: its in-flight request has not resolved
    expect(harness.getNode("node_raceA").data.dirty).toBe(true);

    /* edit B — triggers a second request that includes the still-dirty A */
    await u.type(taB, "1");
    await waitFor(
      () => {
        expect(capture.bodies.length).toBe(2);
        expect(hasDirtyCalculableNodes(harness)).toBe(false);
        expect(harness.getNode("node_raceA").data.result).toBe(
          "fresh-node_raceA"
        );
        expect(harness.getNode("node_raceB").data.result).toBe(
          "fresh-node_raceB"
        );
      },
      { timeout: 8000 }
    );
    expect(payloadHasNode(capture.bodies[1], "node_raceA")).toBe(true);
    expect(payloadHasNode(capture.bodies[1], "node_raceB")).toBe(true);

    /* release the STALE response for the first request */
    expect(release).not.toBeNull();
    expect(firstBody).not.toBeNull();
    await act(async () => {
      release!(
        HttpResponse.json({
          nodes: firstBody!.nodes.map((node) => ({
            ...node,
            data: { ...node.data, result: "STALE" },
          })),
          version: firstBody!.version,
          errors: [],
        })
      );
      // let the resolved fetch settle
      await Promise.resolve();
    });
    await act(async () => {});

    // useGlobalCalculationLogic guards stale responses twice: the effect
    // re-run cancels the superseded run (isCurrentRun) and the response
    // version is compared against versionRef. The stale "STALE" result
    // must not land anywhere.
    expect(harness.getNode("node_raceA").data.result).toBe("fresh-node_raceA");
    expect(harness.getNode("node_raceB").data.result).toBe("fresh-node_raceB");
    expect(harness.getNode("node_raceA").data.value).toBe("aa1");
    expect(harness.getNode("node_raceB").data.value).toBe("bb1");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * A-7 copy/paste aliasing
 * ──────────────────────────────────────────────────────────────────────── */

describe("A-7 copy/paste aliasing", () => {
  it("editing a pasted clone never mutates the original node's payload entries", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.preimageConcat],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    const baselineVals = payloadNode(baseline, INTRO.preimageConcat).data
      .inputs?.vals as Record<string, string>;

    /* select + copy + paste through the real clipboard hook */
    await mutate(() =>
      harness.onNodesChange([
        { type: "select", id: INTRO.preimageConcat, selected: true },
      ])
    );
    await mutate(() => harness.copyNodes());
    await mutate(() => harness.pasteNodes({ x: 5000, y: 5000 }));

    const clone = harness
      .getNodes()
      .find(
        (node) =>
          node.id !== INTRO.preimageConcat &&
          node.type === "calculation" &&
          node.data?.functionName === "concat_all" &&
          node.data?.title === "Preimage"
      );
    expect(clone).toBeDefined();
    const cloneId = clone!.id;

    /* render the clone and edit its first field (the clone has no edges,
       so its fields are editable) */
    await mutate(() =>
      harness.setRenderIds([INTRO.preimageConcat, cloneId])
    );
    const cloneHost = nodeHost(harness.view, cloneId);
    const cloneField = cloneHost.querySelector("textarea");
    expect(cloneField).not.toBeNull();
    await u.clear(cloneField as HTMLTextAreaElement);
    await u.type(cloneField as HTMLTextAreaElement, "ff");

    await waitFor(() => expect(hasDirtyCalculableNodes(harness)).toBe(false), {
      timeout: 8000,
    });

    /* state-level: no shared inputs.vals object after the edit */
    const original = harness.getNode(INTRO.preimageConcat);
    const editedClone = harness.getNode(cloneId);
    expect(
      (editedClone.data.inputs?.vals as Record<string, string>)["0"]
    ).toBe("ff");
    expect(editedClone.data.inputs?.vals).not.toBe(original.data.inputs?.vals);

    /* wire-level: the ORIGINAL node's payload entries are unchanged */
    const final = await captureRecalcAllPayload(harness, capture);
    expect(
      payloadNode(final, INTRO.preimageConcat).data.inputs?.vals
    ).toEqual(baselineVals);
    expect(
      (payloadNode(final, cloneId).data.inputs?.vals as Record<string, string>)[
        "0"
      ]
    ).toBe("ff");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * A-8 upstream node deletion
 * ──────────────────────────────────────────────────────────────────────── */

describe("A-8 upstream node deletion", () => {
  it("deleting the feeding node removes the edge from the payload and the input falls back to its manual value", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.sighashLe4],
    });
    const u = user();

    const baseline = await captureStableBaseline(harness, capture);
    // node_p0kp4lg feeds node_Xoq2K65O input-100, which also holds the
    // committed manual value "01000000".
    expect(
      (payloadNode(baseline, INTRO.preimageConcat).data.inputs?.vals as Record<
        string,
        string
      >)["100"]
    ).toBe("01000000");

    /* delete the upstream node through the real node menu */
    const host = nodeHost(harness.view, INTRO.sighashLe4);
    const deletionPayload = await captureCalcPayload(
      harness,
      capture,
      async () => {
        await u.click(
          within(host).getByRole("button", { name: /menu/i })
        );
        await u.click(
          await within(document.body).findByText("Delete Node")
        );
      }
    );

    /* the node and every edge touching it are gone from the payload
       (deleteNode removes the edges; the edge-removal change marks the
       surviving endpoint dirty, which is what triggered this capture) */
    expect(payloadHasNode(deletionPayload, INTRO.sighashLe4)).toBe(false);
    expect(
      deletionPayload.edges.some(
        (edge) =>
          edge.source === INTRO.sighashLe4 || edge.target === INTRO.sighashLe4
      )
    ).toBe(false);
    // the downstream node ships with its manual value as the fallback —
    // with the cable gone (and no sentinel) the backend uses manual text
    // (backend/graph_logic.py _multi_common step ⑤)
    expect(
      (
        payloadNode(deletionPayload, INTRO.preimageConcat).data.inputs
          ?.vals as Record<string, string>
      )["100"]
    ).toBe("01000000");

    /* state-level: the node really is gone and no dangling edge remains */
    expect(
      harness.getNodes().some((node) => node.id === INTRO.sighashLe4)
    ).toBe(false);
    expect(
      harness
        .getEdges()
        .some(
          (edge) =>
            edge.source === INTRO.sighashLe4 ||
            edge.target === INTRO.sighashLe4
        )
    ).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * A-9 dirty-flag contract
 * ──────────────────────────────────────────────────────────────────────── */

describe("A-9 dirty-flag contract", () => {
  it("after a single field edit exactly the edited node carries dirty:true in the payload", async () => {
    const capture = installCalcCapture();
    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({
      ...graph,
      renderIds: [INTRO.sequence],
    });
    const u = user();

    await captureStableBaseline(harness, capture);

    const host = nodeHost(harness.view, INTRO.sequence);
    const textarea = fieldTextarea(host, "INPUT VALUE:");
    const payload = await captureCalcPayload(harness, capture, async () => {
      await u.type(textarea, "0"); // single keystroke
    });

    // PINNED CONTRACT: only the edited node is flagged dirty on the wire.
    // The rest of the affected subgraph (upstream feeds + downstream
    // dependents, expanded once more around concat_all nodes) is shipped
    // dirty:false — the backend recomputes the whole submitted subgraph
    // regardless; `dirty` only seeds getAffectedSubgraph client-side.
    const dirtyIds = payload.nodes
      .filter((node) => node.data.dirty === true)
      .map((node) => node.id);
    expect(dirtyIds).toEqual([INTRO.sequence]);

    // downstream dependents of the edited node ride along, undirtied
    const downstreamTargets = payload.edges
      .filter((edge) => edge.source === INTRO.sequence)
      .map((edge) => edge.target);
    expect(downstreamTargets.length).toBeGreaterThan(0);
    for (const target of downstreamTargets) {
      expect(payloadHasNode(payload, target)).toBe(true);
      expect(payloadNode(payload, target).data.dirty).not.toBe(true);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * A-10 response application
 * ──────────────────────────────────────────────────────────────────────── */

describe("A-10 response application", () => {
  it("lands results on the correct nodes, routes scriptDebugSteps into the cache, and preserves UI-only fields", async () => {
    const cannedSteps: ScriptExecutionResult = {
      isValid: true,
      steps: [
        {
          pc: 0,
          opcode: 118,
          opcode_name: "OP_DUP",
          stack_before: [],
          stack_after: ["aa"],
        },
      ],
    };

    let mode: "echo" | "canned" = "echo";
    const capture = installCalcCapture((body) => {
      if (mode === "canned") {
        return HttpResponse.json({
          nodes: body.nodes.map((node) => {
            if (node.id === INTRO.version) {
              return {
                ...node,
                data: { ...node.data, result: "CANNED-RESULT" },
              };
            }
            if (node.id === INTRO.scriptVerify) {
              return {
                ...node,
                data: {
                  ...node.data,
                  result: true,
                  scriptDebugSteps: cannedSteps,
                },
              };
            }
            return node;
          }),
          version: body.version,
          errors: [],
        });
      }
      return echoCalcResponse(body);
    });

    const graph = loadIntroFlowGraph();
    const harness = await renderCalcHarness({ ...graph, renderIds: [] });

    await captureStableBaseline(harness, capture);

    /* UI-only fields set on the node before the calc round */
    await mutate(() =>
      harness.setNodes((nodes) =>
        nodes.map((node) =>
          node.id === INTRO.version
            ? {
                ...node,
                data: {
                  ...node.data,
                  banner: "ui-banner",
                  tooltip: "ui-tooltip",
                },
              }
            : node
        )
      )
    );

    mode = "canned";
    const payload = await captureRecalcAllPayload(harness, capture);

    // UI-only fields never reach the wire (stripNodeForBackend)
    const wireVersionNode = payloadNode(payload, INTRO.version);
    expect(wireVersionNode.data).not.toHaveProperty("banner");
    expect(wireVersionNode.data).not.toHaveProperty("tooltip");
    expect(payloadNode(payload, INTRO.txExtract).data).not.toHaveProperty(
      "comment"
    );
    expect(payloadNode(payload, INTRO.scriptVerify).data).not.toHaveProperty(
      "scriptDebugSteps"
    );

    /* canned results land on the correct nodes */
    const versionNode = harness.getNode(INTRO.version);
    expect(versionNode.data.result).toBe("CANNED-RESULT");
    expect(harness.getNode(INTRO.sequence).data.result).not.toBe(
      "CANNED-RESULT"
    );

    /* scriptDebugSteps are routed into the scriptStepsCache and removed
       from node data (mergePartialResultsIntoFullGraph) */
    expect(getScriptSteps(INTRO.scriptVerify)).toEqual(cannedSteps);
    const verifyNode = harness.getNode(INTRO.scriptVerify);
    expect(verifyNode.data).not.toHaveProperty("scriptDebugSteps");
    expect(verifyNode.data.result).toBe(true);

    /* UI-only fields survive the merge */
    expect(versionNode.data.banner).toBe("ui-banner");
    expect(versionNode.data.tooltip).toBe("ui-tooltip");
    expect(harness.getNode(INTRO.txExtract).data.comment).toBeDefined();
  });
});
