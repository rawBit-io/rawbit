import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server, seedSharedFlow } from "@/test/msw/server";
import {
  ingestScriptSteps,
  restoreScriptSteps,
  getScriptSteps,
  hydrateNodesWithScriptSteps,
} from "@/lib/share/scriptStepsCache";
import type { FlowNode, SharePayload, ScriptExecutionResult } from "@/types";
import { FLOW_SCHEMA_VERSION } from "@/lib/flow/schema";
import { buildScriptExecutionResult } from "@/test-utils/types";

declare module "vitest" {
  interface TestContext {
    restoreEnv?: () => void;
  }
}

function stubShareBase(url: string) {
  vi.stubEnv("VITE_SHARE_BASE_URL", url);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("shareFlow", () => {
  beforeEach(() => {
    stubShareBase("https://share.local");
  });

  it("returns share metadata on success", async () => {
    const { shareFlow } = await import("../share");

    server.use(
      http.post("https://share.local/share", async ({ request }) => {
        const json = await request.json();
        return HttpResponse.json({ id: "abc123", url: "https://share.local/s/abc123", bytes: JSON.stringify(json).length });
      })
    );

    const payload: SharePayload = {
      name: "flow",
      schemaVersion: FLOW_SCHEMA_VERSION,
      nodes: [],
      edges: [],
    };
    const result = await shareFlow(payload);

    expect(result).toEqual({ id: "abc123", url: "https://share.local/s/abc123", bytes: expect.any(Number) });
  });

  it("sends turnstile headers when token provided", async () => {
    const { shareFlow } = await import("../share");
    const spy = vi.fn();

    server.use(
      http.post("https://share.local/share", async ({ request }) => {
        spy(request.headers.get("cf-turnstile-response"));
        spy(request.headers.get("x-turnstile-token"));
        return HttpResponse.json({ id: "tok", url: "https://share.local/s/tok", bytes: 0 });
      })
    );

    const payload: SharePayload = {
      name: "flow",
      schemaVersion: FLOW_SCHEMA_VERSION,
      nodes: [],
      edges: [],
    };

    await shareFlow(payload, { turnstileToken: "token-123" });
    expect(spy).toHaveBeenNthCalledWith(1, "token-123");
    expect(spy).toHaveBeenNthCalledWith(2, "token-123");
  });

  it("throws soft-gate error on 429", async () => {
    const { shareFlow } = await import("../share");

    server.use(
      http.post("https://share.local/share", () =>
        HttpResponse.json({ softGate: true }, { status: 429 })
      )
    );

    const payload: SharePayload = {
      name: "flow",
      schemaVersion: FLOW_SCHEMA_VERSION,
      nodes: [],
      edges: [],
    };

    await expect(shareFlow(payload)).rejects.toMatchObject({
      message: "Verification required",
      softGate: true,
    });
  });

  it("rejects when payload exceeds limit", async () => {
    vi.doMock("@/lib/flow/schema", () => ({
      MAX_FLOW_BYTES: 10,
      formatBytes: (bytes: number) => `${bytes} B`,
    }));

    const { shareFlow } = await import("../share");

    const payload: SharePayload = {
      name: "flow",
      schemaVersion: FLOW_SCHEMA_VERSION,
      nodes: [
        {
          id: "node",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: { value: "x".repeat(20) },
        },
      ],
      edges: [],
    };

    await expect(shareFlow(payload)).rejects.toThrow(/over the 10 B limit/);

    vi.doUnmock("@/lib/flow/schema");
  });
});

describe("buildSharePayload", () => {
  it("strips UI fields while keeping script steps", async () => {
    const { buildSharePayload } = await import("../share/buildSharePayload");

    const scriptSteps: ScriptExecutionResult = buildScriptExecutionResult({
      steps: [
        {
          pc: 0,
          opcode: 118,
          opcode_name: "NOP",
          stack_before: [],
          stack_after: [],
        },
      ],
    });

    const nodeWithSteps: FlowNode = {
      id: "n1",
      type: "calculation",
      position: { x: 1, y: 2 },
      data: {
        functionName: "identity",
        scriptDebugSteps: scriptSteps,
        searchMark: { term: "foo", ts: Date.now() },
        isHighlighted: true,
      },
    };

    restoreScriptSteps([]);
    const ingested = ingestScriptSteps([nodeWithSteps]);
    expect(getScriptSteps("n1")).toEqual(scriptSteps);
    const hydrated = hydrateNodesWithScriptSteps(ingested);
    expect(hydrated[0].data?.scriptDebugSteps).toEqual(scriptSteps);

    const payload = buildSharePayload(hydrated, []);

    expect(payload.nodes[0].data.scriptDebugSteps).toEqual(scriptSteps);
    expect(payload.nodes[0].data.searchMark).toBeUndefined();
    expect(payload.nodes[0].data.isHighlighted).toBeUndefined();
    expect(payload.schemaVersion).toBeDefined();
  });
});

describe("loadShared", () => {
  beforeEach(() => {
    stubShareBase("https://share.local");
  });

  it("throws when share base is not configured", async () => {
    vi.stubEnv("VITE_SHARE_BASE_URL", "");
    const { loadShared } = await import("../share");

    await expect(loadShared("flow-1")).rejects.toThrow(
      "VITE_SHARE_BASE_URL is not set"
    );
  });

  it("fetches shared payloads by id", async () => {
    const { loadShared } = await import("../share");
    seedSharedFlow("flow-1", {
      name: "flow",
      schemaVersion: FLOW_SCHEMA_VERSION,
      nodes: [{ id: "n", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });

    const data = await loadShared("flow-1");
    expect(data).toEqual({
      name: "flow",
      schemaVersion: FLOW_SCHEMA_VERSION,
      nodes: [{ id: "n", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
  });
});
