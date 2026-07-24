import { describe, expect, it } from "vitest";
import { buildPorts } from "@/lib/nodes/ports";
import { allSidebarNodes } from "@/components/sidebar-nodes";
import type { FlowNode } from "@/types";

const nodeFromTemplate = (title: string): FlowNode => {
  const template = allSidebarNodes.find((t) => t.nodeData?.title === title);
  if (!template) throw new Error(`sidebar template not found: ${title}`);
  return {
    id: title,
    type: template.type,
    position: { x: 0, y: 0 },
    data: template.nodeData,
  } as FlowNode;
};

describe("buildPorts", () => {
  it("returns handles for numInputs when no structure provided", () => {
    const node = {
      id: "simple",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        title: "Simple",
        numInputs: 2,
      },
    } as FlowNode;

    const ports = buildPorts(node);
    expect(ports.inputs.map((p) => p.handleId)).toEqual(["input-0", "input-1"]);
    expect(ports.outputs).toHaveLength(1);
  });

  it("includes grouped fields and removes duplicates", () => {
    const node = {
      id: "grouped",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "concat_all",
        numInputs: 1,
        customFieldLabels: { 110: "Custom" },
        inputStructure: {
          ungrouped: [
            {
              index: 0,
              label: "Primary",
              allowEmptyBlank: false,
            },
          ],
          groups: [
            {
              title: "Recipients",
              baseIndex: 10,
              fields: [
                { index: 10, label: "Address", allowEmptyBlank: false },
                { index: 20, label: "Amount", allowEmptyBlank: false },
              ],
            },
          ],
          betweenGroups: {
            Recipients: [
              {
                index: 110,
                label: "Memo",
                allowEmptyBlank: false,
              },
            ],
          },
          afterGroups: [
            {
              index: 200,
              label: "Change",
              allowEmptyBlank: false,
            },
          ],
        },
        groupInstanceKeys: {
          Recipients: [0, 100],
        },
      },
    } as FlowNode;

    const ports = buildPorts(node);
    const handles = ports.inputs.map((p) => p.handleId);

    expect(handles).toEqual([
      "input-0",
      "input-10",
      "input-20",
      "input-110",
      "input-120",
      "input-200",
    ]);
    expect(new Set(handles).size).toBe(handles.length);
  });

  it("does not add generic numInputs handles when grouped fields are present", () => {
    const node = {
      id: "prevouts",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "concat_all",
        numInputs: 2,
        inputStructure: {
          groups: [
            {
              title: "PREVOUTS[]",
              baseIndex: 0,
              fields: [
                { index: 0, label: "TXID[32]:" },
                { index: 10, label: "VOUT[4]:" },
              ],
            },
          ],
        },
        groupInstanceKeys: {
          "PREVOUTS[]": [0],
        },
      },
    } as FlowNode;

    const ports = buildPorts(node);
    const handles = ports.inputs.map((p) => p.handleId);

    expect(handles).toEqual(["input-0", "input-10"]);
    expect(handles).not.toContain("input-1");
  });

  it.each([
    [
      "P2WPKH Witness",
      ["input-0", "input-10", "input-20", "input-30", "input-40"],
    ],
    [
      "Preimage Body SegWit (BIP143)",
      [
        "input-0",
        "input-10",
        "input-20",
        "input-30",
        "input-40",
        "input-50",
        "input-60",
        "input-70",
        "input-80",
        "input-90",
      ],
    ],
    [
      "Preimage Body Taproot (BIP341)",
      [
        "input-0",
        "input-10",
        "input-20",
        "input-30",
        "input-40",
        "input-50",
        "input-60",
        "input-70",
        "input-80",
        "input-90",
        "input-100",
      ],
    ],
    ["Taproot Control Block", ["input-0", "input-100", "input-200"]],
    ["Tagged Hash Input (BIP340)", ["input-0", "input-100", "input-200"]],
    ["TapLeaf Preimage (BIP341)", ["input-0", "input-100", "input-200"]],
    ["SCRIPTCODE Builder", ["input-0", "input-10", "input-20", "input-30"]],
    ["OUTPOINT", ["input-0", "input-10"]],
    ["OUTPUTS Builder", ["input-0", "input-10", "input-20"]],
    ["SCRIPTPUBKEYS", ["input-0", "input-10"]],
  ])(
    "does not invent phantom numInputs ports for sparse-index template %s",
    (title, expected) => {
      const handles = buildPorts(nodeFromTemplate(title)).inputs.map(
        (p) => p.handleId
      );
      expect(handles).toEqual(expected);
    }
  );

  it("exposes no input ports for zero-input source templates", () => {
    expect(buildPorts(nodeFromTemplate("Input")).inputs).toEqual([]);
    expect(buildPorts(nodeFromTemplate("Random 32 Bytes")).inputs).toEqual([]);
  });

  it("exposes no input ports for saved single-val nodes with numInputs 0", () => {
    // Legacy saved identity node: field not yet flagged unconnectable and a
    // typed value present — must still expose no connect target.
    const node = {
      id: "legacy-input",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "identity",
        title: "Input",
        numInputs: 0,
        inputs: { val: "deadbeef" },
        inputStructure: {
          ungrouped: [{ index: 0, label: "INPUT VALUE:", rows: 1 }],
        },
      },
    } as FlowNode;

    expect(buildPorts(node).inputs).toEqual([]);
  });

  it("never registers dropdown (options) fields as ports", () => {
    const getAddress = buildPorts(nodeFromTemplate("Trezor Get Address"));
    expect(getAddress.inputs.map((p) => p.handleId)).toEqual([
      "input-0",
      "input-1",
      "input-2",
    ]);

    const signParams = buildPorts(nodeFromTemplate("Trezor Sign Params"));
    const handles = signParams.inputs.map((p) => p.handleId);
    expect(handles).not.toContain("input-1050"); // Input Script Type dropdown
    expect(handles).not.toContain("input-3020"); // Output Script Type dropdown
    expect(handles).toEqual([
      "input-0",
      "input-1",
      "input-2",
      "input-1000",
      "input-1010",
      "input-1020",
      "input-1030",
      "input-1040",
      "input-3000",
      "input-3010",
      "input-5000",
    ]);
  });

  it("honors unconnectable and options on group, betweenGroups and afterGroups fields", () => {
    const node = {
      id: "guarded",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "concat_all",
        paramExtraction: "multi_val",
        numInputs: 4,
        inputStructure: {
          ungrouped: [{ index: 0, label: "Operator:", options: ["+", "-"] }],
          groups: [
            {
              title: "ITEMS[]",
              baseIndex: 100,
              fields: [
                { index: 0, label: "Value:" },
                { index: 10, label: "Mode:", options: ["a", "b"] },
                { index: 20, label: "Locked:", unconnectable: true },
              ],
            },
          ],
          betweenGroups: {
            "ITEMS[]": [{ index: 50, label: "Helper:", unconnectable: true }],
          },
          afterGroups: [
            { index: 200, label: "Tail:", options: ["x"] },
            { index: 210, label: "Free:" },
          ],
        },
        groupInstanceKeys: { "ITEMS[]": [100] },
      },
    } as FlowNode;

    const handles = buildPorts(node).inputs.map((p) => p.handleId);
    expect(handles).toEqual(["input-100", "input-210"]);
  });

  it("omits hidden outputs so connect ports match visible canvas handles", () => {
    const node = {
      id: "taproot-tweak",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "taproot_tweak_xonly_pubkey",
        outputPorts: [
          { label: "Q (x-only)", handleId: "" },
          { label: "parity (c0/c1)", handleId: "output-1" },
          { label: "tweak (32B)", handleId: "output-2", showHandle: false },
        ],
      },
    } as FlowNode;

    const ports = buildPorts(node);
    expect(ports.outputs).toEqual([
      { label: "Q (x-only)", handleId: "" },
      { label: "parity (c0/c1)", handleId: "output-1" },
    ]);
  });

  it("does not synthesize default outputs for canvas-only nodes", () => {
    const groupNode = {
      id: "group",
      type: "shadcnGroup",
      position: { x: 0, y: 0 },
      data: {
        title: "Group Node",
      },
    } as FlowNode;
    const textNode = {
      id: "text",
      type: "shadcnTextInfo",
      position: { x: 0, y: 0 },
      data: {
        title: "Text Info Node",
      },
    } as FlowNode;

    expect(buildPorts(groupNode).outputs).toEqual([]);
    expect(buildPorts(textNode).outputs).toEqual([]);
  });

  it("preserves explicit outputs on non-backend action nodes", () => {
    const node = {
      id: "trezor",
      type: "trezorAction",
      position: { x: 0, y: 0 },
      data: {
        title: "Trezor Get Address",
        outputPorts: [{ label: "address", handleId: "" }],
      },
    } as FlowNode;

    expect(buildPorts(node).outputs).toEqual([
      { label: "address", handleId: "" },
    ]);
  });

  it("falls back to groupInstances count when groupInstanceKeys is absent (NB-03)", () => {
    const node = {
      id: "legacy",
      type: "calculation",
      position: { x: 0, y: 0 },
      data: {
        functionName: "concat_all",
        inputStructure: {
          groups: [
            {
              title: "OUTPUTS[]",
              baseIndex: 3000,
              fields: [
                { index: 0, label: "AMOUNT[8]:" },
                { index: 10, label: "SCRIPT_PUBKEY[]:" },
              ],
            },
          ],
        },
        // legacy node: count present, no groupInstanceKeys
        groupInstances: { "OUTPUTS[]": 2 },
      },
    } as FlowNode;

    const handles = buildPorts(node).inputs.map((p) => p.handleId);
    // first instance (3000/3010) AND second instance (3100/3110) must appear
    expect(handles).toEqual(
      expect.arrayContaining(["input-3000", "input-3010", "input-3100", "input-3110"])
    );
  });
});
