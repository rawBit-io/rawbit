import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FlowNode } from "@/types";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";

describe("text info node data compatibility", () => {
  it("copies saved React Flow geometry into stale template text info data", () => {
    const [node] = stripLegacyFlowMapNodeData([
      {
        id: "text-1",
        type: "shadcnTextInfo",
        position: { x: 0, y: 0 },
        width: 1255,
        height: 2141,
        data: {
          title: "SegWit: what changed and why",
          content: "## SegWit",
          width: 300,
          height: 200,
        },
      } as FlowNode,
    ]);

    expect(node.data.width).toBe(1255);
    expect(node.data.height).toBe(2141);
  });

  it("keeps saved text info data dimensions when React Flow geometry is stale", () => {
    const [node] = stripLegacyFlowMapNodeData([
      {
        id: "text-1",
        type: "shadcnTextInfo",
        position: { x: 0, y: 0 },
        width: 300,
        height: 200,
        data: {
          title: "Overview",
          content: "## Overview",
          width: 620,
          height: 460,
        },
      } as FlowNode,
    ]);

    expect(node.data.width).toBe(620);
    expect(node.data.height).toBe(460);
  });

  it("normalizes stale text info dimensions in a bundled flow", () => {
    const flow = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "src/my_tx_flows/p16_Taproot_intro.json"),
        "utf8"
      )
    ) as { nodes: FlowNode[] };
    const nodes = stripLegacyFlowMapNodeData(flow.nodes);
    const textNodesWithCustomGeometry = nodes.filter(
      (node) =>
        node.type === "shadcnTextInfo" &&
        typeof node.width === "number" &&
        typeof node.height === "number" &&
        (node.width !== 300 || node.height !== 200)
    );

    expect(textNodesWithCustomGeometry.length).toBeGreaterThan(0);
    for (const node of textNodesWithCustomGeometry) {
      expect(node.data.width).toBe(node.width);
      expect(node.data.height).toBe(node.height);
    }
  });
});
