import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ChangeEvent } from "react";
import type { FlowNode, FlowData } from "@/types";
import type { Edge, NodeChange, EdgeChange } from "@xyflow/react";
import { buildEdge, buildFlowNode } from "@/test-utils/types";
import { MAX_FLOW_BYTES } from "@/lib/flow/schema";
import { buildGroupBundledElements } from "@/lib/flow/groupEdgeBundling";
import * as flowValidate from "@/lib/flow/validate";
import type { FlowValidationIssue } from "@/lib/flow/validate";
import { restoreScriptSteps } from "@/lib/share/scriptStepsCache";
import { useFileOperations } from "../useFileOperations";

const createFileReaderMock = () => {
  class MockFileReader {
    onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null = null;
    result: string | ArrayBuffer | null = null;

    readAsText(file: Blob) {
      file.text().then((text) => {
        this.result = text;
        this.onload?.call(this as unknown as FileReader, {
          target: { result: text },
        } as ProgressEvent<FileReader>);
      });
    }
  }

  return MockFileReader;
};

const readDownloadedBlobText = async (blob: Blob): Promise<string> => {
  if (typeof blob.text === "function") {
    return blob.text();
  }
  if (typeof blob.arrayBuffer === "function") {
    const bytes = await blob.arrayBuffer();
    return new TextDecoder().decode(bytes);
  }
  try {
    return await new Response(blob as unknown as BodyInit).text();
  } catch {
    // fall through to explicit error
  }
  throw new Error("Unable to read downloaded blob content");
};

describe("useFileOperations", () => {
  beforeEach(() => {
    vi.stubGlobal("FileReader", createFileReaderMock());
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          status: 200,
          json: async () => ({
            code: "def identity(val):\n    return val",
          }),
        } as unknown as Response;
      })
    );
    restoreScriptSteps([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderUseFileOperations = (options?: {
    initialNodes?: FlowNode[];
    initialEdges?: Edge[];
    tabTitle?: string;
  }) => {
    const nodes: FlowNode[] =
      options?.initialNodes ?? [
        buildFlowNode({
          id: "existing",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: { functionName: "identity" },
        }),
      ];
    const edges: Edge[] = options?.initialEdges ?? [];
    const onNodesChange = vi.fn<(changes: NodeChange<FlowNode>[]) => void>();
    const onEdgesChange = vi.fn<(changes: EdgeChange[]) => void>();
    const scheduleSnapshot = vi.fn();
    const fitView = vi.fn();
    const onTooltip = vi.fn();
    const onError = vi.fn();
    const renameActiveTab = vi.fn();
    const getNodes = () => nodes;
    const getEdges = () => edges;
    const getActiveTabTitle = options?.tabTitle
      ? () => options.tabTitle
      : undefined;

    const { result } = renderHook(() =>
      useFileOperations(nodes, edges, onNodesChange, onEdgesChange, {
        getNodes,
        getEdges,
        getActiveTabTitle,
        scheduleSnapshot,
        fitView,
        onTooltip,
        onError,
        renameActiveTab,
      })
    );

    return {
      result,
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      scheduleSnapshot,
      fitView,
      onTooltip,
      onError,
      renameActiveTab,
      getNodes,
      getEdges,
    };
  };

  const setupDownloadCapture = () => {
    const anchors: Array<HTMLAnchorElement> = [];
    const blobs: Blob[] = [];
    const originalBlob = globalThis.Blob;

    class MockBlob {
      readonly size: number;
      readonly type: string;
      private readonly rawText: string;

      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        this.rawText = parts
          .map((part) => {
            if (typeof part === "string") return part;
            if (part instanceof ArrayBuffer) {
              return new TextDecoder().decode(part);
            }
            if (ArrayBuffer.isView(part)) {
              return new TextDecoder().decode(part);
            }
            return String(part);
          })
          .join("");
        this.size = this.rawText.length;
        this.type = options?.type ?? "";
      }

      async text(): Promise<string> {
        return this.rawText;
      }
    }

    vi.stubGlobal("Blob", MockBlob as unknown as typeof Blob);

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName: string) => {
        if (tagName.toLowerCase() === "a") {
          const anchor = originalCreateElement("a") as HTMLAnchorElement;
          Object.defineProperty(anchor, "click", {
            configurable: true,
            value: vi.fn(),
          });
          anchors.push(anchor);
          return anchor;
        }
        return originalCreateElement(tagName);
      });

    const mutableURL = URL as typeof URL & {
      createObjectURL?: (blob: Blob) => string;
      revokeObjectURL?: (url: string) => void;
    };
    const originalCreateObjectURL = mutableURL.createObjectURL;
    const originalRevokeObjectURL = mutableURL.revokeObjectURL;
    Object.defineProperty(mutableURL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return `blob:mock-${blobs.length}`;
      }) as typeof mutableURL.createObjectURL,
    });
    Object.defineProperty(mutableURL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn() as typeof mutableURL.revokeObjectURL,
    });

    const restore = () => {
      createElementSpy.mockRestore();
      if (originalCreateObjectURL) {
        Object.defineProperty(mutableURL, "createObjectURL", {
          configurable: true,
          writable: true,
          value: originalCreateObjectURL,
        });
      } else {
        Reflect.deleteProperty(mutableURL, "createObjectURL");
      }
      if (originalRevokeObjectURL) {
        Object.defineProperty(mutableURL, "revokeObjectURL", {
          configurable: true,
          writable: true,
          value: originalRevokeObjectURL,
        });
      } else {
        Reflect.deleteProperty(mutableURL, "revokeObjectURL");
      }
      if (originalBlob) {
        vi.stubGlobal("Blob", originalBlob);
      } else {
        Reflect.deleteProperty(globalThis, "Blob");
      }
    };

    return { anchors, blobs, restore };
  };

  it("notifies error when file exceeds byte limit", async () => {
    const { result, onError } = renderUseFileOperations();
    const bigContent = "x".repeat(MAX_FLOW_BYTES + 1);
    const file = new File([bigContent], "big-flow.json", { type: "application/json" });

    const event = {
      target: { files: [file] },
    } as unknown as ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleFileSelect(event);
    });

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("over the"));
  });

  it("imports flow JSON and triggers post-import callbacks", async () => {
    const validationSpy = vi
      .spyOn(flowValidate, "validateFlowData")
      .mockReturnValue({
        ok: true,
        schemaVersion: 1,
        issues: [],
        errors: [],
        warnings: [],
      });

    const { result, onNodesChange, onEdgesChange, scheduleSnapshot, fitView, onTooltip } =
      renderUseFileOperations();

    const payload: FlowData = {
      nodes: [
        {
          id: "imported",
          type: "calculation",
          position: { x: 10, y: 20 },
          data: {
            functionName: "identity",
            scriptDebugSteps: { trace: [1] },
          },
        } as FlowNode,
      ],
      edges: [],
      schemaVersion: 1,
    };

    const json = JSON.stringify(payload);
    const file = {
      name: "flow.json",
      size: json.length,
      text: () => Promise.resolve(json),
    } as unknown as File;

    const event = {
      target: { files: [file] },
    } as unknown as ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleFileSelect(event);
    });

    await waitFor(() => expect(onNodesChange).toHaveBeenCalled());
    expect(onEdgesChange).toHaveBeenCalledWith([]);
    expect(scheduleSnapshot).toHaveBeenCalledWith("Import file", { refresh: true });
    expect(fitView).toHaveBeenCalled();
    expect(onTooltip).toHaveBeenCalledWith("flow.json");
    expect(validationSpy).toHaveBeenCalled();
  });

  it("skips simplified snapshots without positions", async () => {
    const { result, onNodesChange, scheduleSnapshot, onTooltip, onError } =
      renderUseFileOperations();

    const simplified = {
      nodes: [{ id: "a" }],
      edges: [],
    };

    const simpleText = JSON.stringify(simplified);
    const file = {
      name: "simple.json",
      size: simpleText.length,
      text: () => Promise.resolve(simpleText),
    } as unknown as File;

    const event = {
      target: { files: [file] },
    } as unknown as ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleFileSelect(event);
    });

    expect(onNodesChange).not.toHaveBeenCalled();
    expect(scheduleSnapshot).not.toHaveBeenCalled();
    expect(onTooltip).not.toHaveBeenCalled();
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("omit layout data")
    );
  });

  it("notifies parse errors for malformed JSON", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { result, onNodesChange, onEdgesChange, onError } =
      renderUseFileOperations();

    const file = {
      name: "broken.json",
      size: 12,
      text: () => Promise.resolve("{invalid"),
    } as unknown as File;

    const event = {
      target: { files: [file] },
    } as unknown as ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleFileSelect(event);
    });

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    const [message] = consoleError.mock.calls.at(-1) ?? [];
    expect(String(message)).toContain("Error parsing flow JSON");
    expect(onNodesChange).not.toHaveBeenCalled();
    expect(onEdgesChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("not valid JSON")
    );
  });

  it("surfaces schema validation issues", async () => {
    const validationErrors: FlowValidationIssue[] = [
      {
        level: "error",
        code: "test_missing_data",
        message: "nodes[0]: Missing data",
        nodeId: "node-a",
      },
      {
        level: "error",
        code: "test_bad_edge",
        message: "edges[0]: Bad edge",
      },
    ];

    const validationSpy = vi
      .spyOn(flowValidate, "validateFlowData")
      .mockReturnValue({
        ok: false,
        schemaVersion: 1,
        issues: validationErrors,
        errors: validationErrors,
        warnings: [],
      });

    const { result, onNodesChange, onEdgesChange, onError } =
      renderUseFileOperations();

    const payload = {
      nodes: [
        {
          id: "node-a",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: { functionName: "identity" },
        },
      ],
      edges: [],
    };

    const file = {
      name: "invalid-schema.json",
      size: 200,
      text: () => Promise.resolve(JSON.stringify(payload)),
    } as unknown as File;

    const event = {
      target: { files: [file] },
    } as unknown as ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleFileSelect(event);
    });

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onNodesChange).not.toHaveBeenCalled();
    expect(onEdgesChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Missing data"),
      validationErrors,
    );
    expect(validationSpy).toHaveBeenCalled();
  });

  it("rejects payloads without nodes or edges arrays", async () => {
    const { result, onError, onNodesChange } = renderUseFileOperations();

    const payload = {
      nodes: null,
      edges: {},
    };

    const file = {
      name: "missing-collections.json",
      size: 200,
      text: () => Promise.resolve(JSON.stringify(payload)),
    } as unknown as File;

    const event = {
      target: { files: [file] },
    } as unknown as ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleFileSelect(event);
    });

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onNodesChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("missing required nodes")
    );
  });

  it("rejects unreadable file contents", async () => {
    const { result, onError } = renderUseFileOperations();

    const file = {
      name: "binary.flow",
      size: 10,
      text: () => Promise.resolve({ not: "a string" } as unknown as string),
    } as unknown as File;

    const event = {
      target: { files: [file] },
    } as unknown as ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleFileSelect(event);
    });

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Could not read flow file contents")
    );
  });

  it("fetches function source only once per unique function in LLM export", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    const { restore } = setupDownloadCapture();

    try {
      const { result } = renderUseFileOperations({
        initialNodes: [
          buildFlowNode({
            id: "node-a",
            type: "calculation",
            data: { functionName: "identity" },
            selected: true,
          }),
          buildFlowNode({
            id: "node-b",
            type: "calculation",
            data: { functionName: "identity" },
            selected: true,
          }),
        ],
      });

      await act(async () => {
        await result.current.saveLlmExport();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        "/code?functionName=identity"
      );
    } finally {
      restore();
    }
  });

  it("does not fetch function sources for simplified export", () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const { restore } = setupDownloadCapture();

    try {
      const { result } = renderUseFileOperations({
        initialNodes: [
          buildFlowNode({
            id: "node-a",
            type: "calculation",
            data: { functionName: "identity" },
            selected: true,
          }),
        ],
      });

      act(() => {
        result.current.saveSimplifiedFlow();
      });

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("exports selected groups with their children and original group edges", async () => {
    const sourceNodes: FlowNode[] = [
      buildFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "Group A", width: 300, height: 200 },
        selected: true,
      }),
      buildFlowNode({
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "Group B", width: 300, height: 200 },
        selected: true,
      }),
      buildFlowNode({
        id: "a1",
        parentId: "group-a",
        data: { functionName: "identity", title: "A1" },
      }),
      buildFlowNode({
        id: "a2",
        parentId: "group-a",
        data: { functionName: "identity", title: "A2" },
      }),
      buildFlowNode({
        id: "b1",
        parentId: "group-b",
        data: { functionName: "identity", title: "B1" },
      }),
      buildFlowNode({
        id: "b2",
        parentId: "group-b",
        data: { functionName: "identity", title: "B2" },
      }),
      buildFlowNode({
        id: "outside",
        data: { functionName: "identity", title: "Outside" },
      }),
    ];
    const sourceEdges: Edge[] = [
      buildEdge({ id: "edge-a-internal", source: "a1", target: "a2" }),
      buildEdge({ id: "edge-b-internal", source: "b1", target: "b2" }),
      buildEdge({ id: "edge-cross-1", source: "a1", target: "b1" }),
      buildEdge({ id: "edge-cross-2", source: "a2", target: "b2" }),
      buildEdge({ id: "edge-outside", source: "a2", target: "outside" }),
    ];
    const renderedGraph = buildGroupBundledElements({
      nodes: sourceNodes,
      edges: sourceEdges,
    });
    const { blobs, restore } = setupDownloadCapture();

    try {
      const { result } = renderUseFileOperations({
        initialNodes: renderedGraph.nodes,
        initialEdges: renderedGraph.edges,
      });

      act(() => {
        result.current.saveSimplifiedFlow();
      });
      await act(async () => {
        await result.current.saveLlmExport();
      });

      expect(blobs).toHaveLength(2);

      type ExportPayload = {
        nodes: Array<{ id: string; group?: string }>;
        edges: Array<{ id: string; source: string; target: string }>;
      };

      const [simplified, llm] = await Promise.all(
        blobs.map(
          async (blob) =>
            JSON.parse(await readDownloadedBlobText(blob)) as ExportPayload
        )
      );
      const expectedNodeIds = [
        "a1",
        "a2",
        "b1",
        "b2",
        "group-a",
        "group-b",
      ];
      const expectedEdgeIds = [
        "edge-a-internal",
        "edge-b-internal",
        "edge-cross-1",
        "edge-cross-2",
      ];

      for (const payload of [simplified, llm]) {
        expect(payload.nodes.map((node) => node.id).sort()).toEqual(
          expectedNodeIds
        );
        expect(payload.edges.map((edge) => edge.id).sort()).toEqual(
          expectedEdgeIds
        );
        expect(payload.nodes.some((node) => node.id === "outside")).toBe(false);
        expect(
          payload.nodes.some((node) => node.id.startsWith("__group_bundle"))
        ).toBe(false);
        expect(
          payload.edges.some((edge) => edge.id.startsWith("__group_bundle"))
        ).toBe(false);
        expect(payload.nodes.find((node) => node.id === "a1")?.group).toBe(
          "group-a"
        );
        expect(payload.nodes.find((node) => node.id === "b1")?.group).toBe(
          "group-b"
        );
        expect(payload.edges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "edge-cross-1",
              source: "a1",
              target: "b1",
            }),
            expect.objectContaining({
              id: "edge-cross-2",
              source: "a2",
              target: "b2",
            }),
          ])
        );
      }
    } finally {
      restore();
    }
  });

  it("adds runtime semantics metadata to full, simplified, and LLM exports", async () => {
    const { blobs, restore } = setupDownloadCapture();

    try {
      const { result, nodes } = renderUseFileOperations({
        tabTitle: "Runtime Semantics",
      });
      nodes[0].selected = true;

      act(() => {
        result.current.saveFlow();
      });
      act(() => {
        result.current.saveSimplifiedFlow();
      });
      await act(async () => {
        await result.current.saveLlmExport();
      });

      expect(blobs).toHaveLength(3);

      const [full, simplified, llm] = await Promise.all(
        blobs.map(
          async (blob) =>
            JSON.parse(await readDownloadedBlobText(blob)) as Record<
              string,
              unknown
            >
        )
      );

      const semanticsMatcher = expect.objectContaining({
        version: 1,
        inputResolution: expect.objectContaining({
          precedence: expect.arrayContaining([
            "__FORCE00__",
            "__EMPTY__",
            "__NULL__",
            "edge value",
            "manual text",
          ]),
          sentinels: expect.objectContaining({
            __FORCE00__: expect.any(String),
            __EMPTY__: expect.any(String),
            __NULL__: expect.any(String),
          }),
        }),
        typeCoercion: expect.objectContaining({
          integerParams: expect.any(String),
          numberParams: expect.any(String),
        }),
      });

      expect(full.runtimeSemantics).toEqual(semanticsMatcher);
      expect(simplified.runtimeSemantics).toEqual(semanticsMatcher);
      expect(llm.runtimeSemantics).toEqual(semanticsMatcher);
      expect(full.name).toBe("Runtime Semantics");
      expect(simplified.name).toBe("Runtime Semantics - simplified");
      expect(llm.name).toBe("Runtime Semantics - llm");
      const llmContext = llm.llmContext as { whatIsExported?: string[] } | undefined;
      expect(llmContext?.whatIsExported).toEqual(
        expect.arrayContaining([expect.stringContaining("Runtime semantics:")])
      );
    } finally {
      restore();
    }
  });

  describe("export filenames", () => {
    const setupDownloadSpies = () => {
      const anchors: Array<HTMLAnchorElement> = [];
      const originalCreateElement = document.createElement.bind(document);
      const createElementSpy = vi
        .spyOn(document, "createElement")
        .mockImplementation((tagName: string) => {
          if (tagName.toLowerCase() === "a") {
            const anchor = originalCreateElement("a") as HTMLAnchorElement;
            Object.defineProperty(anchor, "click", {
              configurable: true,
              value: vi.fn(),
            });
            anchors.push(anchor);
            return anchor;
          }
          return originalCreateElement(tagName);
        });

      const mutableURL = URL as typeof URL & {
        createObjectURL?: (blob: Blob) => string;
        revokeObjectURL?: (url: string) => void;
      };
      const originalCreateObjectURL = mutableURL.createObjectURL;
      const createObjectURLSpy = vi.fn(() => "blob:mock");
      Object.defineProperty(mutableURL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: createObjectURLSpy as typeof mutableURL.createObjectURL,
      });

      const originalRevokeObjectURL = mutableURL.revokeObjectURL;
      const revokeObjectURLSpy = vi.fn();
      Object.defineProperty(mutableURL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: revokeObjectURLSpy as typeof mutableURL.revokeObjectURL,
      });

      const restore = () => {
        createElementSpy.mockRestore();
        if (originalCreateObjectURL) {
          Object.defineProperty(mutableURL, "createObjectURL", {
            configurable: true,
            writable: true,
            value: originalCreateObjectURL,
          });
        } else {
          Reflect.deleteProperty(mutableURL, "createObjectURL");
        }
        if (originalRevokeObjectURL) {
          Object.defineProperty(mutableURL, "revokeObjectURL", {
            configurable: true,
            writable: true,
            value: originalRevokeObjectURL,
          });
        } else {
          Reflect.deleteProperty(mutableURL, "revokeObjectURL");
        }
      };

      return {
        anchors,
        restore,
      };
    };

    it("uses the active tab title for full saves and appends indices", () => {
      const { anchors, restore } = setupDownloadSpies();

      const { result } = renderUseFileOperations({ tabTitle: "My / Flow" });

      act(() => {
        result.current.saveFlow();
      });
      expect(anchors[0]?.download).toBe("My Flow.json");

      act(() => {
        result.current.saveFlow();
      });
      expect(anchors[1]?.download).toBe("My Flow (1).json");

      expect(anchors[0]?.click).toHaveBeenCalledTimes(1);
      expect(anchors[1]?.click).toHaveBeenCalledTimes(1);

      restore();
    });

    it("uses the active tab title for LLM exports and tracks indices per suffix", async () => {
      const { anchors, restore } = setupDownloadSpies();

      const { result, nodes } = renderUseFileOperations({
        tabTitle: "Cool:Flow",
      });
      nodes[0].selected = true;

      await act(async () => {
        await result.current.saveLlmExport();
      });
      expect(anchors[0]?.download).toBe(
        "Cool Flow - llm export selection.json"
      );

      await act(async () => {
        await result.current.saveLlmExport();
      });
      expect(anchors[1]?.download).toBe(
        "Cool Flow - llm export selection (1).json"
      );

      expect(anchors[0]?.click).toHaveBeenCalledTimes(1);
      expect(anchors[1]?.click).toHaveBeenCalledTimes(1);

      restore();
    });

    it("uses the active tab title for simplified saves and tracks indices per suffix", () => {
      const { anchors, restore } = setupDownloadSpies();

      const { result, nodes } = renderUseFileOperations({
        tabTitle: "Cool:Flow",
      });
      nodes[0].selected = true;

      act(() => {
        result.current.saveSimplifiedFlow();
      });
      expect(anchors[0]?.download).toBe(
        "Cool Flow - simplified selection.json"
      );

      act(() => {
        result.current.saveSimplifiedFlow();
      });
      expect(anchors[1]?.download).toBe(
        "Cool Flow - simplified selection (1).json"
      );

      expect(anchors[0]?.click).toHaveBeenCalledTimes(1);
      expect(anchors[1]?.click).toHaveBeenCalledTimes(1);

      restore();
    });
  });

  it("renames the active tab when importing into an empty workspace", async () => {
    const { result, onNodesChange, renameActiveTab } = renderUseFileOperations({
      initialNodes: [],
    });

    const payload: FlowData = {
      nodes: [
        {
          id: "imported",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: { functionName: "identity" },
        } as FlowNode,
      ],
      edges: [],
      schemaVersion: 1,
    };

    const json = JSON.stringify(payload);
    const file = {
      name: "Example Flow.json",
      size: json.length,
      text: () => Promise.resolve(json),
    } as unknown as File;

    const event = {
      target: { files: [file] },
    } as unknown as ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleFileSelect(event);
    });

    await waitFor(() => expect(onNodesChange).toHaveBeenCalled());
    expect(renameActiveTab).toHaveBeenCalledWith("Example Flow", {
      onlyIfEmpty: true,
    });
  });

  it("does not rename the tab when importing into a non-empty workspace", async () => {
    const { result, onNodesChange, renameActiveTab } = renderUseFileOperations();

    const payload: FlowData = {
      nodes: [
        {
          id: "imported",
          type: "calculation",
          position: { x: 0, y: 0 },
          data: { functionName: "identity" },
        } as FlowNode,
      ],
      edges: [],
      schemaVersion: 1,
    };

    const json = JSON.stringify(payload);
    const file = {
      name: "Loaded.json",
      size: json.length,
      text: () => Promise.resolve(json),
    } as unknown as File;

    const event = {
      target: { files: [file] },
    } as unknown as ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleFileSelect(event);
    });

    await waitFor(() => expect(onNodesChange).toHaveBeenCalled());
    expect(renameActiveTab).not.toHaveBeenCalled();
  });
});
