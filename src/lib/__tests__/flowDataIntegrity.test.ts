import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FlowData } from "@/types";
import { allSidebarNodes } from "@/components/sidebar-nodes";
import { validateFlowData } from "@/lib/flow/validate";
import { customFlows } from "@/my_tx_flows/customFlows";

const flowsDir = path.resolve(process.cwd(), "src/my_tx_flows");

const publicFlowFiles = fs
  .readdirSync(flowsDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

const allowedFunctionNames = new Set<string>();
const allowedNodeTaxonomy = new Map<string, Set<string>>([
  [
    "Canvas & Inputs",
    new Set(["General"]),
  ],
  [
    "Encoding & Script Data",
    new Set([
      "Script Opcodes",
      "Bytes, Integers & Pushdata",
      "Locktime & Sequence Encoding",
    ]),
  ],
  [
    "Transactions",
    new Set([
      "Transaction Templates",
      "Witnesses & Control Blocks",
      "Preimages",
      "Builders",
      "Parsing & Inspection",
    ]),
  ],
  [
    "Keys & Addresses",
    new Set([
      "Entropy & HD Wallets",
      "Key Conversion & Tweaks",
      "Address & ScriptPubKey",
      "Multisig Keys",
    ]),
  ],
  [
    "Hashes",
    new Set(["General"]),
  ],
  [
    "Signing & Verification",
    new Set([
      "ECDSA",
      "Schnorr",
      "Script Verification",
      "MuSig2",
      "Trezor",
    ]),
  ],
  [
    "Logic & Checks",
    new Set(["Comparisons", "Math", "Assertions"]),
  ],
]);
const allowedFlowSections = new Set([
  "legacy-foundations",
  "scripts-timelocks-commitments",
  "channels",
  "segwit",
  "taproot-schnorr-musig",
  "wallet-signing-labs",
  "contributor-challenges",
]);

for (const template of allSidebarNodes) {
  if (typeof template.functionName === "string") {
    allowedFunctionNames.add(template.functionName);
  }
  const nodeFunctionName = template.nodeData?.functionName;
  if (typeof nodeFunctionName === "string") {
    allowedFunctionNames.add(nodeFunctionName);
  }
}

function loadFlow(fileName: string): FlowData {
  const fullPath = path.join(flowsDir, fileName);
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as FlowData;
}

function readInputVal(vals: unknown, index: number): unknown {
  if (Array.isArray(vals)) return vals[index];
  if (vals && typeof vals === "object") {
    return (vals as Record<string, unknown>)[String(index)];
  }
  return undefined;
}

describe("public lesson flow data integrity", () => {
  it("sidebar nodes use the supported category taxonomy", () => {
    const unknown = allSidebarNodes
      .map((node) => {
        const allowedSubcategories = allowedNodeTaxonomy.get(node.category);
        if (!allowedSubcategories?.has(node.subcategory)) {
          return {
            label: node.label,
            category: node.category,
            subcategory: node.subcategory,
          };
        }
        return null;
      })
      .filter(Boolean);

    expect(unknown).toEqual([]);
  });

  it("custom flows use the supported lesson sections", () => {
    const unknown = customFlows
      .filter((flow) => !allowedFlowSections.has(flow.section))
      .map((flow) => ({
        id: flow.id,
        label: flow.label,
        section: flow.section,
      }));

    expect(unknown).toEqual([]);
  });

  it.each(publicFlowFiles)("%s has valid graph data and runtime metadata", (fileName) => {
    const flow = loadFlow(fileName);
    const result = validateFlowData(flow, {
      allowedFunctionNames,
      requireNodeData: true,
    });

    const issues = [...result.errors, ...result.warnings].map((issue) => ({
      code: issue.code,
      message: issue.message,
      nodeId: issue.nodeId,
      edgeId: issue.edgeId,
    }));

    expect(issues).toEqual([]);
  });

  it("p15 Trezor address nodes do not keep fallbacks for wired inputs", () => {
    const flow = loadFlow("p15_Trezor_signing_flow.json");
    const mismatches: Array<{
      nodeId: string;
      inputIndex: number;
      editableValue: unknown;
      snapshotValue: unknown;
      reason: string;
    }> = [];
    const wiredInputs = new Map<string, Set<number>>();

    for (const edge of flow.edges) {
      if (!edge.targetHandle?.startsWith("input-")) continue;
      const inputIndex = Number(edge.targetHandle.replace("input-", ""));
      if (!Number.isFinite(inputIndex)) continue;
      const existing = wiredInputs.get(edge.target) ?? new Set<number>();
      existing.add(inputIndex);
      wiredInputs.set(edge.target, existing);
    }

    for (const node of flow.nodes) {
      const data = node.data as Record<string, unknown>;
      if (data.hardwareAction !== "trezor_get_address") continue;
      if (typeof data.hardwareInputSnapshot !== "string") continue;

      const snapshot = JSON.parse(data.hardwareInputSnapshot) as Array<
        [number, unknown]
      >;
      const vals = (data.inputs as { vals?: unknown } | undefined)?.vals;

      for (const [inputIndex, snapshotValue] of snapshot) {
        const editableValue = readInputVal(vals, inputIndex);
        const isWired = wiredInputs.get(node.id)?.has(inputIndex) ?? false;

        if (isWired) {
          if (editableValue !== undefined && editableValue !== "") {
            mismatches.push({
              nodeId: node.id,
              inputIndex,
              editableValue,
              snapshotValue,
              reason: "wired input has editable fallback",
            });
          }
          continue;
        }

        if (editableValue !== snapshotValue) {
          mismatches.push({
            nodeId: node.id,
            inputIndex,
            editableValue,
            snapshotValue,
            reason: "unwired input does not match saved hardware snapshot",
          });
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
