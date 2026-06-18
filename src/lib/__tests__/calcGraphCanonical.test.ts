import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Edge } from "@xyflow/react";
import type { FlowData, FlowNode } from "@/types";
import { FLOW_SCHEMA_VERSION } from "@/lib/flow/schema";
import { validateFlowData } from "@/lib/flow/validate";
import { importWithFreshIds } from "@/lib/idUtils";
import {
  ingestScriptSteps,
  restoreScriptSteps,
} from "@/lib/share/scriptStepsCache";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";

/**
 * Canonical-graph golden test for the calculation pipeline.
 *
 * The backend computes from the raw nodes/edges the frontend posts to
 * /bulk_calculate, so the frontend's "calculation rules" live in the
 * import/normalization pipeline below. This test runs the exact pipeline
 * handleFileSelect (src/hooks/useFileOperations.ts) applies when a lesson
 * JSON is loaded into an empty canvas and snapshots only the calc-relevant
 * projection of the resulting graph. A diff here means the data sent to the
 * backend for these always-visible lessons has changed.
 */

const flowsDir = path.resolve(process.cwd(), "src/my_tx_flows");

const VISIBLE_LESSON_FILES = [
  "p0_Intro_P2PKH.json",
  "p1_P2PK_vs_P2PKH.json",
  "p2_P2PKH_multi_input_signing.json",
  "p3_Bare_MultiSig.json",
  "p5_P2SH_and_OP_Return.json",
] as const;

function loadFlow(fileName: string): FlowData {
  const fullPath = path.join(flowsDir, fileName);
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as FlowData;
}

/**
 * Mirrors handleFileSelect's normalization order on an empty canvas:
 *   1. default schemaVersion, then validateFlowData gate
 *   2. importWithFreshIds with stripLegacyFlowMapNodeData(nodes) as input,
 *      dedupeEdges, renameMode "collision", remapGroupBundleOffsets
 *   3. stripLegacyFlowMapNodeData(ingestScriptSteps(mergedNodes))
 *   4. orphan-edge filter against the sanitized node ids
 * (useSharedFlowLoader applies the same function order for shared links.)
 */
function runFileImportPipeline(flow: FlowData): {
  nodes: FlowNode[];
  edges: Edge[];
} {
  if (flow.schemaVersion === undefined) {
    flow.schemaVersion = FLOW_SCHEMA_VERSION;
  }

  const validation = validateFlowData(flow);
  expect(validation.errors).toEqual([]);
  expect(validation.ok).toBe(true);

  const { nodes: mergedNodes, edges: mergedEdges } = importWithFreshIds<
    FlowNode,
    Edge
  >({
    currentNodes: [],
    currentEdges: [],
    importNodes: stripLegacyFlowMapNodeData(flow.nodes),
    importEdges: flow.edges,
    dedupeEdges: true,
    renameMode: "collision",
    remapGroupBundleOffsets: true,
  });

  const sanitizedNodes = stripLegacyFlowMapNodeData(
    ingestScriptSteps(mergedNodes)
  );
  const importedNodeIds = new Set(sanitizedNodes.map((node) => node.id));
  const safeEdges = mergedEdges.filter(
    (edge) =>
      importedNodeIds.has(edge.source) && importedNodeIds.has(edge.target)
  );

  return { nodes: sanitizedNodes, edges: safeEdges };
}

/**
 * Calc-relevant projection only: purely visual fields (positions, dimensions,
 * styles, colors, drag handles, selection) are excluded so the snapshot fails
 * only when calculation-relevant data changes. JSON.stringify drops keys that
 * are undefined for a given node (e.g. functionName on groups/text nodes).
 */
function projectCalcGraph(graph: { nodes: FlowNode[]; edges: Edge[] }) {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      parentId: node.parentId,
      functionName: node.data?.functionName,
      numInputs: node.data?.numInputs,
      inputs: node.data?.inputs,
      value: node.data?.value,
      inputStructure: node.data?.inputStructure,
      groupInstanceKeys: node.data?.groupInstanceKeys,
      // Every remaining field graph_logic.py / function_specs.py actually
      // reads from node["data"] — omitting any of these would let a frontend
      // pipeline change silently alter what the backend computes with.
      paramExtraction: node.data?.paramExtraction,
      selectedNetwork: node.data?.selectedNetwork,
      showField: node.data?.showField,
      groupInstances: node.data?.groupInstances,
      hasRegenerate: node.data?.hasRegenerate,
      forceRegenerate: node.data?.forceRegenerate,
      opSequenceNames: node.data?.opSequenceNames,
      outputValues: node.data?.outputValues,
      outputPorts: node.data?.outputPorts,
      txFieldExtractMode: node.data?.txFieldExtractMode,
      txExtractFields: node.data?.txExtractFields,
      taprootLeafIndex: node.data?.taprootLeafIndex,
      dirty: node.data?.dirty,
      // result is calc OUTPUT for normal nodes (pinned by the golden corpus),
      // but calc INPUT for hasRegenerate nodes: the backend keeps the
      // committed value instead of regenerating, so it must survive import.
      result: node.data?.hasRegenerate ? node.data?.result : undefined,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
    })),
  };
}

describe("canonical calc graph for always-visible lessons", () => {
  beforeEach(() => {
    restoreScriptSteps([]);
  });

  afterEach(() => {
    restoreScriptSteps([]);
  });

  it.each(VISIBLE_LESSON_FILES)(
    "%s import pipeline produces a stable calc-relevant graph",
    async (fileName) => {
      const lesson = loadFlow(fileName);
      const lessonNodeCount = lesson.nodes.length;
      const lessonEdgeCount = lesson.edges.length;

      const graph = runFileImportPipeline(lesson);

      // Empty canvas: collision mode must keep every node/edge, no drops.
      expect(graph.nodes).toHaveLength(lessonNodeCount);
      expect(graph.edges).toHaveLength(lessonEdgeCount);

      const projection = projectCalcGraph(graph);
      await expect(
        JSON.stringify(projection, null, 2)
      ).toMatchFileSnapshot(
        `__snapshots__/${fileName.replace(/\.json$/, "")}.calc-graph.snap.json`
      );
    }
  );
});
