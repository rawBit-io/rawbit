import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import type { Edge, Node } from "@xyflow/react";
import type { CalculationNodeData } from "@/types";

/**
 * Wire-contract test for the /bulk_calculate request built by
 * recalculateGraph (src/lib/graphUtils.ts). Pins:
 *   - the exact top-level body shape: { nodes, edges, version }
 *   - that calc-relevant node data passes through untouched
 *   - that only the documented UI-only fields are stripped
 *   - that edges pass through verbatim
 */

const healthHandler = http.get("http://localhost:5007/healthz", () =>
  HttpResponse.json({ limits: { maxPayloadBytes: 5_000_000 } })
);

async function loadGraphUtils() {
  vi.resetModules();
  return await import("../graphUtils");
}

describe("/bulk_calculate request contract", () => {
  beforeEach(() => {
    server.use(healthHandler);
  });

  it("posts { nodes, edges, version } keeping calc-relevant fields and stripping only UI-only ones", async () => {
    const { recalculateGraph } = await loadGraphUtils();

    let captured: Record<string, unknown> | undefined;
    server.use(
      http.post("http://localhost:5007/bulk_calculate", async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          nodes: captured.nodes,
          version: 9,
          errors: [],
        });
      })
    );

    const node: Node<CalculationNodeData> = {
      id: "calc-1",
      type: "calculation",
      position: { x: 12, y: 34 },
      data: {
        // calc-relevant fields: the backend computes from these
        dirty: true,
        functionName: "hash_sha256",
        title: "SHA256",
        numInputs: 2,
        value: "deadbeef",
        inputs: { vals: { 0: "00", 1: "ff" } },
        inputStructure: {
          ungrouped: [{ index: 0, label: "Data:", rows: 1 }],
          groups: [],
          betweenGroups: {},
          afterGroups: [],
        },
        groupInstances: { Inputs: 1 },
        groupInstanceKeys: { Inputs: [0] },
        paramExtraction: "multi_val",
        result: "stale-result",
        version: 3,
        error: false,
        // UI-only fields: stripNodeForBackend removes exactly these
        extendedError: "old error",
        scriptDebugSteps: null,
        scriptSteps: null,
        blockMerkleTree: { root: "cd" },
        taprootTree: { root: "ab" },
        banner: "banner",
        tooltip: "tooltip",
        comment: "a note",
        showComment: true,
        searchMark: { term: "sha", ts: 1 },
        groupFlash: true,
      },
    };

    const edges: Edge[] = [
      {
        id: "e1",
        source: "calc-0",
        sourceHandle: "output",
        target: "calc-1",
        targetHandle: "input-0",
        data: { customMeta: { x: 1, y: 2 } },
      },
    ];

    const result = await recalculateGraph([node], edges, 8);

    expect(captured).toBeDefined();
    const body = captured as Record<string, unknown>;

    // Exact top-level request shape.
    expect(Object.keys(body).sort()).toEqual(["edges", "nodes", "version"]);
    expect(body.version).toBe(8);

    // Edges pass through verbatim (handles included).
    expect(body.edges).toEqual([
      {
        id: "e1",
        source: "calc-0",
        sourceHandle: "output",
        target: "calc-1",
        targetHandle: "input-0",
        data: { customMeta: { x: 1, y: 2 } },
      },
    ]);

    // Exact node payload: calc-relevant data intact, UI-only fields gone.
    expect(body.nodes).toEqual([
      {
        id: "calc-1",
        type: "calculation",
        position: { x: 12, y: 34 },
        data: {
          dirty: true,
          functionName: "hash_sha256",
          title: "SHA256",
          numInputs: 2,
          value: "deadbeef",
          inputs: { vals: { 0: "00", 1: "ff" } },
          inputStructure: {
            ungrouped: [{ index: 0, label: "Data:", rows: 1 }],
            groups: [],
            betweenGroups: {},
            afterGroups: [],
          },
          groupInstances: { Inputs: 1 },
          groupInstanceKeys: { Inputs: [0] },
          paramExtraction: "multi_val",
          result: "stale-result",
          version: 3,
          error: false,
        },
      },
    ]);

    // Stripping must not mutate the caller's node.
    expect(node.data.extendedError).toBe("old error");
    expect(node.data.comment).toBe("a note");
    expect(node.data.blockMerkleTree).toEqual({ root: "cd" });

    // Backend response passes through.
    expect(result.version).toBe(9);
    expect(result.errors).toEqual([]);
  });
});
