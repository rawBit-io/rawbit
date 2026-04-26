import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FlowData } from "@/types";
import { allSidebarNodes } from "@/components/sidebar-nodes";
import { validateFlowData } from "@/lib/flow/validate";

const flowsDir = path.resolve(process.cwd(), "src/my_tx_flows");

const publicFlowFiles = fs
  .readdirSync(flowsDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

const allowedFunctionNames = new Set<string>();

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

describe("public lesson flow data integrity", () => {
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
});
