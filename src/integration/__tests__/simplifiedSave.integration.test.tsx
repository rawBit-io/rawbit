import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { useEffect } from "react";

import { useFileOperations } from "@/hooks/useFileOperations";
import { useSimplifiedSave } from "@/hooks/useSimplifiedSave";
import type { Edge } from "@xyflow/react";
import type { FlowNode, SimplifiedEdge, SimplifiedNode } from "@/types";
import { makeEdge, makeFlowNode } from "@/integration/test-helpers/flowFixtures";

type JsonStringify = typeof JSON.stringify;

type SimplifiedSnapshot = {
  schemaVersion?: number;
  nodes: SimplifiedNode[];
  edges: SimplifiedEdge[];
} & Record<string, unknown>;

const isSimplifiedSnapshot = (value: unknown): value is SimplifiedSnapshot => {
  if (!value || typeof value !== "object") return false;
  const maybeSnapshot = value as { nodes?: unknown; edges?: unknown };
  return Array.isArray(maybeSnapshot.nodes) && Array.isArray(maybeSnapshot.edges);
};

interface SimplifiedHandles {
  promptSave: () => void;
  confirmSave: () => void;
  cancelSave: () => void;
}

function SimplifiedSaveHarness({
  nodes,
  edges,
  onReady,
}: {
  nodes: FlowNode[];
  edges: Edge[];
  onReady: (handles: SimplifiedHandles) => void;
}) {
  const onNodesChange = () => undefined;
  const onEdgesChange = () => undefined;
  const { saveSimplifiedFlow } = useFileOperations(
    nodes,
    edges,
    onNodesChange,
    onEdgesChange
  );

  const simplified = useSimplifiedSave({ nodes, saveSimplifiedFlow });

  useEffect(() => {
    onReady({
      promptSave: simplified.promptSave,
      confirmSave: simplified.confirmSave,
      cancelSave: simplified.cancelSave,
    });
  }, [onReady, simplified.cancelSave, simplified.confirmSave, simplified.promptSave]);

  return (
    <>
      <div data-testid="confirmation-open">{String(simplified.showConfirmation)}</div>
      <div data-testid="confirmation-message">
        {simplified.confirmationMessage}
      </div>
    </>
  );
}

describe("Simplified save integration", () => {
  const payloads: SimplifiedSnapshot[] = [];
  let stringifySpy: MockInstance<JsonStringify>;
  let originalCreateObjectURL: ((blob: Blob) => string) | undefined;
  let originalRevokeObjectURL: ((url: string) => void) | undefined;
  let createElementSpy: MockInstance<
    (tagName: string, options?: ElementCreationOptions) => HTMLElement
  >;
  let originalCreateElement: Document["createElement"];
  let anchorElement: HTMLAnchorElement;
  let anchorClickSpy: MockInstance<() => void>;

  beforeEach(() => {
    payloads.length = 0;
    const originalStringify: JsonStringify = JSON.stringify;
    stringifySpy = vi.spyOn(JSON, "stringify");
    stringifySpy.mockImplementation((value, replacer, space) => {
      if (isSimplifiedSnapshot(value)) {
        payloads.push(value);
      }
      return originalStringify(value, replacer, space);
    });

    const mutableURL = URL as typeof URL & {
      createObjectURL?: (blob: Blob) => string;
      revokeObjectURL?: (url: string) => void;
    };
    originalCreateObjectURL = mutableURL.createObjectURL;
    mutableURL.createObjectURL = () => "blob:mock";
    originalRevokeObjectURL = mutableURL.revokeObjectURL;
    mutableURL.revokeObjectURL = () => undefined;

    originalCreateElement = document.createElement.bind(document);
    anchorElement = document.createElement("a");
    anchorClickSpy = vi.spyOn(anchorElement, "click").mockImplementation(() => undefined);
    createElementSpy = vi.spyOn(document, "createElement");
    createElementSpy.mockImplementation(
      ((tagName: string, options?: ElementCreationOptions) => {
        if (tagName.toLowerCase() === "a") {
          return anchorElement;
        }
        return originalCreateElement(tagName, options);
      }) as typeof document.createElement
    );
  });

  afterEach(() => {
    stringifySpy.mockRestore();
    const mutableURL = URL as typeof URL & {
      createObjectURL?: (blob: Blob) => string;
      revokeObjectURL?: (url: string) => void;
    };
    if (originalCreateObjectURL) mutableURL.createObjectURL = originalCreateObjectURL;
    else Reflect.deleteProperty(mutableURL, "createObjectURL");
    if (originalRevokeObjectURL) mutableURL.revokeObjectURL = originalRevokeObjectURL;
    else Reflect.deleteProperty(mutableURL, "revokeObjectURL");
    createElementSpy.mockRestore();
    anchorClickSpy?.mockRestore();
  });

  it("exports a minimal snapshot after confirmation", async () => {
    const nodes: FlowNode[] = [
      makeFlowNode({
        id: "node-a",
        position: { x: 0, y: 0 },
        data: {
          functionName: "identity",
          result: "1",
          inputStructure: {
            ungrouped: [{ index: 0, label: "value", allowEmptyBlank: false }],
          },
        },
        selected: true,
      }),
      makeFlowNode({
        id: "node-b",
        position: { x: 200, y: 0 },
        data: { functionName: "identity" },
        selected: false,
      }),
    ];

    const handlesRef: { current: SimplifiedHandles | null } = { current: null };

    render(
      <SimplifiedSaveHarness
        nodes={nodes}
        edges={[]}
        onReady={(handles) => {
          handlesRef.current = handles;
        }}
      />
    );

    await waitFor(() => expect(handlesRef.current).not.toBeNull());

    act(() => {
      handlesRef.current!.promptSave();
    });

    expect(screen.getByTestId("confirmation-open").textContent).toBe("true");

    act(() => {
      handlesRef.current!.confirmSave();
    });

    expect(screen.getByTestId("confirmation-open").textContent).toBe("false");
    await waitFor(() => expect(anchorClickSpy).toHaveBeenCalled());
    await waitFor(() => expect(payloads).toHaveLength(1));
    const parsed = payloads[0];
    expect(parsed.schemaVersion).toBeDefined();
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].id).toBe("node-a");
    expect(parsed.nodes[0].functionName).toBe("identity");
    expect(parsed.nodes[0]).not.toHaveProperty("position");
    expect(parsed.nodes[0]).not.toHaveProperty("selected");
    expect(parsed.edges).toHaveLength(0);
  });

  it("counts grouped children in the selection confirmation", async () => {
    const nodes: FlowNode[] = [
      makeFlowNode({
        id: "group-a",
        type: "shadcnGroup",
        data: { title: "Group A", width: 300, height: 200 },
        selected: true,
      }),
      makeFlowNode({
        id: "child-a",
        parentId: "group-a",
        selected: false,
      }),
      makeFlowNode({
        id: "child-b",
        parentId: "group-a",
        selected: false,
      }),
      makeFlowNode({
        id: "outside",
        selected: false,
      }),
    ];

    const handlesRef: { current: SimplifiedHandles | null } = { current: null };

    render(
      <SimplifiedSaveHarness
        nodes={nodes}
        edges={[]}
        onReady={(handles) => {
          handlesRef.current = handles;
        }}
      />
    );

    await waitFor(() => expect(handlesRef.current).not.toBeNull());

    act(() => {
      handlesRef.current!.promptSave();
    });

    expect(screen.getByTestId("confirmation-open").textContent).toBe("true");
    expect(screen.getByTestId("confirmation-message").textContent).toBe(
      "Save only the 3/4 nodes from selected groups and nodes?"
    );
    expect(anchorClickSpy).not.toHaveBeenCalled();
  });

  it("saves immediately when every node is selected", async () => {
    const nodes: FlowNode[] = [
      makeFlowNode({
        id: "node-a",
        position: { x: 0, y: 0 },
        data: { functionName: "identity", result: "1" },
        selected: true,
      }),
      makeFlowNode({
        id: "node-b",
        position: { x: 200, y: 0 },
        data: { functionName: "identity", result: "2" },
        selected: true,
      }),
    ];

    const handlesRef: { current: SimplifiedHandles | null } = { current: null };

    render(
      <SimplifiedSaveHarness
        nodes={nodes}
        edges={[makeEdge({ id: "edge", source: "node-a", target: "node-b" })]}
        onReady={(handles) => {
          handlesRef.current = handles;
        }}
      />
    );

    await waitFor(() => expect(handlesRef.current).not.toBeNull());

    expect(screen.getByTestId("confirmation-open").textContent).toBe("false");

    act(() => {
      handlesRef.current!.promptSave();
    });

    expect(screen.getByTestId("confirmation-open").textContent).toBe("false");
    await waitFor(() => expect(anchorClickSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(payloads).toHaveLength(1));
    const saved = payloads[0];
    expect(saved.nodes).toHaveLength(2);
    expect(saved.edges).toHaveLength(1);
  });

  it("can dismiss the confirmation without saving", async () => {
    const nodes: FlowNode[] = [
      {
        id: "node-a",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: { functionName: "identity" },
        selected: true,
      } as FlowNode,
      {
        id: "node-b",
        type: "calculation",
        position: { x: 200, y: 0 },
        data: { functionName: "identity" },
        selected: false,
      } as FlowNode,
    ];

    const handlesRef: { current: SimplifiedHandles | null } = { current: null };

    render(
      <SimplifiedSaveHarness
        nodes={nodes}
        edges={[]}
        onReady={(handles) => {
          handlesRef.current = handles;
        }}
      />
    );

    await waitFor(() => expect(handlesRef.current).not.toBeNull());

    act(() => {
      handlesRef.current!.promptSave();
    });

    expect(screen.getByTestId("confirmation-open").textContent).toBe("true");
    expect(anchorClickSpy).not.toHaveBeenCalled();

    act(() => {
      handlesRef.current!.cancelSave();
    });

    expect(screen.getByTestId("confirmation-open").textContent).toBe("false");
    expect(anchorClickSpy).not.toHaveBeenCalled();
    expect(payloads).toHaveLength(0);
  });
});
