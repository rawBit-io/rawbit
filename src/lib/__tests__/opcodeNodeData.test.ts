import { describe, expect, it } from "vitest";
import type { FlowNode } from "@/types";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";

describe("opcode node data compatibility", () => {
  it("normalizes legacy opcode sequence nodes into backend-calculated inputs", () => {
    const [node] = stripLegacyFlowMapNodeData([
      {
        id: "op-1",
        type: "opCodeNode",
        position: { x: 0, y: 0 },
        data: {
          functionName: "op_code_select",
          paramExtraction: "single_val",
          title: "Opcode Sequence",
          value: "76a9",
          result: "76a9",
          opSequenceNames: ["OP_DUP", "OP_HASH160"],
        },
      } as FlowNode,
    ]);

    expect(node.data.functionName).toBe("op_code_select");
    expect(node.data.paramExtraction).toBe("multi_val");
    expect(node.data.inputs?.vals).toEqual({
      0: "OP_DUP",
      100: "OP_HASH160",
    });
    expect(node.data.inputStructure?.ungrouped).toEqual([
      expect.objectContaining({ index: 0, label: "Opcode:" }),
      expect.objectContaining({ index: 100, label: "Opcode:" }),
    ]);
    expect(node.data.value).toBeUndefined();
    expect(node.data.opSequenceNames).toBeUndefined();
  });
});
