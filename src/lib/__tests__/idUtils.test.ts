import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importWithFreshIds } from "@/lib/idUtils";

type TestNode = { id: string; parentId?: string };
type TestEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

beforeEach(() => {
  vi
    .spyOn(globalThis.crypto, "getRandomValues")
    .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (!array) return array;
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < view.length; i++) {
        view[i] = (i * 17 + 3) % 256;
      }
      return array;
    });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("importWithFreshIds", () => {
  it("generates new ids in default mode", () => {
    const existing: TestNode[] = [{ id: "node_existing" }];
    const imported: TestNode[] = [{ id: "node_existing", parentId: "node_existing" }];

    const { nodes, idMap } = importWithFreshIds<TestNode, TestEdge>({
      currentNodes: existing,
      importNodes: imported,
      importEdges: [],
    });

    expect(nodes[0].id).not.toBe("node_existing");
    expect(idMap.get("node_existing")).toBe(nodes[0].id);
    expect(nodes[0].parentId).toBe(nodes[0].id);
  });

  it("retains ids when using collision mode without conflicts", () => {
    const existing: TestNode[] = [{ id: "node_a" }];
    const imported: TestNode[] = [{ id: "node_b" }];

    const { nodes } = importWithFreshIds<TestNode, TestEdge>({
      currentNodes: existing,
      importNodes: imported,
      importEdges: [],
      renameMode: "collision",
    });

    expect(nodes[0].id).toBe("node_b");
  });

  it("dedupes edges with identical structure", () => {
    const currentNodes: TestNode[] = [{ id: "node_a" }, { id: "node_b" }];
    const importNodes: TestNode[] = [{ id: "node_c" }];

    const currentEdges: TestEdge[] = [
      { id: "edge_1", source: "node_a", target: "node_b", sourceHandle: "a", targetHandle: "b" },
    ];
    const importEdges: TestEdge[] = [
      { id: "edge_2", source: "node_a", target: "node_b", sourceHandle: "a", targetHandle: "b" },
      { id: "edge_3", source: "node_c", target: "node_b", sourceHandle: "c", targetHandle: "b" },
    ];

    const { edges } = importWithFreshIds<TestNode, TestEdge>({
      currentNodes,
      currentEdges,
      importNodes,
      importEdges,
      renameMode: "collision",
    });

    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("node_c");
  });

  it("normalizes handle whitespace before deduping imported edges", () => {
    const currentNodes: TestNode[] = [{ id: "node_a" }, { id: "node_b" }];
    const importNodes: TestNode[] = [];

    const currentEdges: TestEdge[] = [
      {
        id: "edge_1",
        source: "node_a",
        target: "node_b",
        sourceHandle: " output-0 ",
        targetHandle: " input-0 ",
      },
    ];
    const importEdges: TestEdge[] = [
      {
        id: "edge_2",
        source: "node_a",
        target: "node_b",
        sourceHandle: "output-0",
        targetHandle: "input-0",
      },
    ];

    const { edges } = importWithFreshIds<TestNode, TestEdge>({
      currentNodes,
      currentEdges,
      importNodes,
      importEdges,
      renameMode: "collision",
    });

    expect(edges).toHaveLength(0);
  });
});
