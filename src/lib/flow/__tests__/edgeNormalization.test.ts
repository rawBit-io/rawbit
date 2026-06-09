import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import {
  normalizeAndDedupeEdgeConnections,
  normalizeEdgeHandles,
  normalizeHandle,
} from "@/lib/flow/edgeNormalization";

describe("edgeNormalization", () => {
  it("normalizes blank and padded handles", () => {
    expect(normalizeHandle(" input-0 ")).toBe("input-0");
    expect(normalizeHandle("   ")).toBeUndefined();
    expect(normalizeHandle(null)).toBeUndefined();
  });

  it("removes duplicate connections while preserving order and real conflicting edges", () => {
    const edges: Edge[] = [
      {
        id: "first",
        source: "source-a",
        target: "target",
        sourceHandle: " output-0 ",
        targetHandle: " input-0 ",
      } as Edge,
      {
        id: "duplicate",
        source: "source-a",
        target: "target",
        sourceHandle: "output-0",
        targetHandle: "input-0",
      } as Edge,
      {
        id: "different-source",
        source: "source-b",
        target: "target",
        sourceHandle: "output-0",
        targetHandle: "input-0",
      } as Edge,
      {
        id: "blank-handles",
        source: "source-c",
        target: "target",
        sourceHandle: " ",
        targetHandle: "",
      } as Edge,
    ];

    const normalized = normalizeAndDedupeEdgeConnections(edges);

    expect(normalized.map((edge) => edge.id)).toEqual([
      "first",
      "different-source",
      "blank-handles",
    ]);
    expect(normalized[0]).toMatchObject({
      sourceHandle: "output-0",
      targetHandle: "input-0",
    });
    expect(normalized[2]).not.toHaveProperty("sourceHandle");
    expect(normalized[2]).not.toHaveProperty("targetHandle");
  });

  it("returns the same edge object when handles are already normalized", () => {
    const edge = {
      id: "edge",
      source: "source",
      target: "target",
      sourceHandle: "output-0",
      targetHandle: "input-0",
    } as Edge;

    expect(normalizeEdgeHandles(edge)).toBe(edge);
  });
});
