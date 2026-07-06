import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import {
  getScriptSteps,
  restoreScriptSteps,
} from "@/lib/share/scriptStepsCache";
import type { Edge, Node } from "@xyflow/react";
import type { CalculationNodeData } from "@/types";
import { buildScriptExecutionResult } from "@/test-utils/types";

const defaultHealthHandler = http.get("http://localhost:5007/healthz", () =>
  HttpResponse.json({
    limits: {
      maxPayloadBytes: 5_000_000,
    },
  })
);

function createNode(
  id: string,
  data: Partial<CalculationNodeData> = {}
): Node<CalculationNodeData> {
  return {
    id,
    type: "calculation",
    position: { x: 0, y: 0 },
    data: { dirty: true, functionName: "identity", ...data },
  } as Node<CalculationNodeData>;
}

function createEdge(source: string, target: string): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: "input-0",
    targetHandle: `${target}-0`,
  } as Edge;
}

async function loadGraphUtils() {
  vi.resetModules();
  return await import("../graphUtils");
}

interface BulkCalculationRequest {
  nodes: Array<{
    id: string;
    data?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  version: number;
}

describe("recalculateGraph", () => {
  beforeEach(() => {
    server.use(defaultHealthHandler);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns backend response when request succeeds", async () => {
    const { recalculateGraph } = await loadGraphUtils();

    server.use(
      http.post("http://localhost:5007/bulk_calculate", async ({ request }) => {
        const body = (await request.json()) as BulkCalculationRequest;
        const nodes = body.nodes.map((node) => ({
          ...node,
          data: { ...node.data, dirty: false, result: "ok" },
        }));
        return HttpResponse.json({
          nodes,
          version: body.version + 1,
          errors: [],
        });
      })
    );

    const nodes = [createNode("a")];
    const edges: Edge[] = [];

    const result = await recalculateGraph(nodes, edges, 7);

    expect(result.errors).toEqual([]);
    expect(result.version).toBe(8);
    expect(result.nodes[0].data.result).toBe("ok");
  });

  it("marks dirty nodes when payload exceeds backend limit", async () => {
    server.use(
      http.get("http://localhost:5007/healthz", () =>
        HttpResponse.json({ limits: { maxPayloadBytes: 10 } })
      )
    );
    const { recalculateGraph } = await loadGraphUtils();

    const nodes = [createNode("oversize", { value: "x".repeat(16) })];
    const edges: Edge[] = [];

    const response = await recalculateGraph(nodes, edges, 1);

    expect(response.errors).toHaveLength(1);
    expect(response.errors?.[0].nodeId).toBe("__payload_limit__");
    expect(response.nodes[0].data.error).toBe(true);
    expect(response.nodes[0].data.extendedError).toContain("over the server limit");
  });

  it("stamps dirty nodes when backend returns malformed JSON", async () => {
    const { recalculateGraph } = await loadGraphUtils();

    server.use(
      http.post(
        "http://localhost:5007/bulk_calculate",
        () => new HttpResponse("not json", { status: 200, headers: { "Content-Type": "text/plain" } })
      )
    );

    const nodes = [createNode("broken"), createNode("clean", { dirty: false })];
    const edges: Edge[] = [];

    const response = await recalculateGraph(nodes, edges, 0);

    expect(response.errors).toEqual([]);
    expect(response.nodes[0].data.error).toBe(true);
    expect(response.nodes[0].data.extendedError).toMatch(/Backend not running/);
    expect(response.nodes[1].data?.error).not.toBe(true);
  });

  it("aborts when the backend call exceeds the default request timeout", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;
        if (url.endsWith("/healthz")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ limits: { maxPayloadBytes: 5_000_000 } }),
              {
                headers: { "Content-Type": "application/json" },
              }
            )
          );
        }
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortError = new Error("Aborted") as Error & { name: string };
            abortError.name = "AbortError";
            reject(abortError);
          });
        });
      });

    const { recalculateGraph } = await loadGraphUtils();
    const nodes = [createNode("timeout")];

    try {
      const promise = recalculateGraph(nodes, [], 0);
      await vi.advanceTimersByTimeAsync(15_100);
      const result = await promise;

      expect(result.errors).toEqual([]);
      expect(result.nodes[0].data.error).toBe(true);
      expect(result.nodes[0].data.extendedError).toMatch(
        /Calculation request timed out after 15 s/
      );
    } finally {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("uses the configured request timeout when provided", async () => {
    vi.stubEnv("VITE_CALCULATION_REQUEST_TIMEOUT_MS", "1200");
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;
        if (url.endsWith("/healthz")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ limits: { maxPayloadBytes: 5_000_000 } }),
              {
                headers: { "Content-Type": "application/json" },
              }
            )
          );
        }
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortError = new Error("Aborted") as Error & { name: string };
            abortError.name = "AbortError";
            reject(abortError);
          });
        });
      });

    const { recalculateGraph } = await loadGraphUtils();
    const nodes = [createNode("timeout")];

    try {
      const promise = recalculateGraph(nodes, [], 0);
      await vi.advanceTimersByTimeAsync(1_300);
      const result = await promise;

      expect(result.nodes[0].data.extendedError).toMatch(
        /Calculation request timed out after 1.2 s/
      );
    } finally {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("graph traversal helpers", () => {
  beforeEach(() => {
    restoreScriptSteps([]);
  });

  it("includes upstream and downstream dependencies for dirty nodes", async () => {
    const { getAffectedSubgraph } = await loadGraphUtils();

    const nodes = [
      createNode("a"),
      createNode("b"),
      createNode("c"),
      createNode("concat", { functionName: "concat_all" }),
    ];
    nodes[1].data.dirty = true; // b dirty
    const edges = [
      createEdge("a", "b"),
      createEdge("b", "c"),
      createEdge("c", "concat"),
      createEdge("a", "concat"),
    ];

    const { affectedNodes, affectedEdges } = getAffectedSubgraph(
      nodes,
      edges
    );

    const ids = affectedNodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["a", "b", "c", "concat"]));
    expect(affectedEdges).toHaveLength(4);
  });

  it("uses radio virtual edges for affected subgraph traversal", async () => {
    const { buildRadioVirtualEdges, getAffectedSubgraph } =
      await loadGraphUtils();

    const nodes = [
      createNode("source"),
      createNode("send", {
        dirty: false,
        functionName: "radio_send",
        title: "Radio Send #7",
        radioChannel: "1",
      }),
      createNode("recv", {
        dirty: false,
        functionName: "radio_receive",
        title: "Radio Receive #7",
        radioChannel: "1",
      }),
      createNode("sink", { dirty: false }),
    ];
    nodes[0].data.dirty = true;
    const edges = [createEdge("source", "send"), createEdge("recv", "sink")];

    const virtualEdges = buildRadioVirtualEdges(nodes);
    expect(virtualEdges).toHaveLength(1);
    expect(virtualEdges[0]).toMatchObject({
      source: "send",
      target: "recv",
      targetHandle: "input-0",
      data: { virtualRadio: true, channel: "7" },
    });

    const { affectedNodes, affectedEdges } = getAffectedSubgraph(nodes, edges);

    expect(affectedNodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["source", "send", "recv", "sink"])
    );
    expect(affectedEdges.map((edge) => `${edge.source}->${edge.target}`)).toEqual(
      expect.arrayContaining(["source->send", "send->recv", "recv->sink"])
    );
    expect(affectedEdges.some((edge) => edge.data?.virtualRadio)).toBe(true);
  });

  it("does not create radio virtual edges for duplicate senders", async () => {
    const { buildRadioVirtualEdges } = await loadGraphUtils();
    const nodes = [
      createNode("send-a", {
        functionName: "radio_send",
        title: "Radio Send #1",
      }),
      createNode("send-b", {
        functionName: "radio_send",
        title: "Radio Send #1",
      }),
      createNode("recv", {
        functionName: "radio_receive",
        title: "Radio Receive #1",
      }),
    ];

    expect(buildRadioVirtualEdges(nodes)).toEqual([]);
  });

  it("normalizes radio channels to two numeric digits", async () => {
    const { buildRadioVirtualEdges, radioChannelFromData } =
      await loadGraphUtils();

    expect(
      radioChannelFromData({
        functionName: "radio_send",
        title: "Radio Send #123",
      } as CalculationNodeData)
    ).toBe("12");
    expect(
      radioChannelFromData({
        functionName: "radio_send",
        title: "Radio Send 98",
      } as CalculationNodeData)
    ).toBe("98");
    expect(
      radioChannelFromData({
        functionName: "radio_send",
        radioChannel: "abc",
      } as CalculationNodeData)
    ).toBe("1");

    const nodes = [
      createNode("send", {
        functionName: "radio_send",
        title: "Radio Send #123",
      }),
      createNode("recv", {
        functionName: "radio_receive",
        radioChannel: "12",
      }),
    ];

    expect(buildRadioVirtualEdges(nodes)[0]).toMatchObject({
      source: "send",
      target: "recv",
      data: { channel: "12" },
    });
  });

  it("detects cycles and returns true without mutating input nodes", async () => {
    const { checkForCyclesAndMarkErrors } = await loadGraphUtils();
    const nodes = [createNode("x"), createNode("y")];
    nodes.forEach((n) => (n.data.dirty = false));
    const edges = [createEdge("x", "y"), createEdge("y", "x")];

    const hasCycle = checkForCyclesAndMarkErrors(nodes, edges);

    expect(hasCycle).toBe(true);
    // input nodes must not be mutated – caller owns state updates
    nodes.forEach((node) => {
      expect(node.data.error).toBeUndefined();
      expect(node.data.extendedError).toBeUndefined();
    });
  });
});

describe("mergePartialResultsIntoFullGraph", () => {
  beforeEach(() => {
    restoreScriptSteps([]);
  });

  it("merges errors and clears script verification results", async () => {
    const { mergePartialResultsIntoFullGraph } = await loadGraphUtils();

    const full = [createNode("sv", { functionName: "script_verification" })];
    const updated = [
      {
        ...full[0],
        data: {
          ...full[0].data,
          result: "false",
          scriptDebugSteps: buildScriptExecutionResult({ steps: [] }),
          error: true,
        },
      },
    ] as Node<CalculationNodeData>[];

    const merged = mergePartialResultsIntoFullGraph(full, updated, [
      { nodeId: "sv", error: "boom" },
    ]);

    expect(merged[0].data.error).toBe(true);
    expect(merged[0].data.extendedError).toBe("boom");
    expect(merged[0].data.result).toBeUndefined();
    expect(getScriptSteps("sv")).toBeNull();
  });
});
