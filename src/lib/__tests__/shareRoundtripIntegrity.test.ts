import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Edge } from "@xyflow/react";
import type { FlowData, FlowNode } from "@/types";
import { FLOW_SCHEMA_VERSION } from "@/lib/flow/schema";
import { validateFlowData } from "@/lib/flow/validate";
import { importWithFreshIds } from "@/lib/idUtils";
import { buildSharePayload } from "@/lib/share/buildSharePayload";
import {
  getScriptSteps,
  ingestScriptSteps,
  restoreScriptSteps,
} from "@/lib/share/scriptStepsCache";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";

/**
 * Export -> import roundtrip regression test (structural, with results).
 *
 * Pins the exporter/importer chain so a published lesson survives a
 * share/save cycle without calc-relevant mutation:
 *   lesson JSON -> file-import pipeline (sender canvas)
 *     -> buildSharePayload (exporter)
 *     -> JSON transport
 *     -> shared-flow import pipeline into an empty canvas with empty caches
 *       (importWithFreshIds renameMode "collision",
 *        remapGroupBundleOffsets: true — mirrors handleFileSelect and
 *        useSharedFlowLoader call sites)
 * and asserts node ids, committed results, scriptDebugSteps, edges and
 * groupInstanceKeys are preserved.
 */

const flowsDir = path.resolve(process.cwd(), "src/my_tx_flows");

const VISIBLE_LESSON_FILES = [
  "p0_Intro_P2PKH.json",
  "p1_P2PK_vs_P2PKH.json",
  "p2_P2PKH_multi_input_signing.json",
  "p3_Bare_MultiSig.json",
] as const;

function loadFlow(fileName: string): FlowData {
  const fullPath = path.join(flowsDir, fileName);
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as FlowData;
}

/**
 * Same normalization order as handleFileSelect (src/hooks/useFileOperations.ts)
 * and useSharedFlowLoader (src/hooks/useSharedFlowLoader.ts) on an empty canvas.
 */
function runImportPipeline(flow: FlowData): {
  nodes: FlowNode[];
  edges: Edge[];
} {
  if (flow.schemaVersion === undefined) {
    flow.schemaVersion = FLOW_SCHEMA_VERSION;
  }

  const validation = validateFlowData(flow);
  expect(validation.errors).toEqual([]);

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

const calcEdgeShape = (edge: Edge) => ({
  id: edge.id,
  source: edge.source,
  sourceHandle: edge.sourceHandle,
  target: edge.target,
  targetHandle: edge.targetHandle,
});

const hasCommittedResult = (node: FlowNode): boolean =>
  node.data?.result !== undefined && node.data?.result !== "";

describe("share export -> import roundtrip preserves calc-relevant graph", () => {
  beforeEach(() => {
    restoreScriptSteps([]);
  });

  afterEach(() => {
    restoreScriptSteps([]);
  });

  it.each(VISIBLE_LESSON_FILES)(
    "%s survives buildSharePayload -> validate -> importWithFreshIds",
    (fileName) => {
      const lesson = loadFlow(fileName);

      const lessonResults = new Map(
        lesson.nodes
          .filter(hasCommittedResult)
          .map((node) => [node.id, node.data.result] as const)
      );
      const lessonGroupInstanceKeys = new Map(
        lesson.nodes
          .filter((node) => node.data?.groupInstanceKeys !== undefined)
          .map((node) => [node.id, node.data.groupInstanceKeys] as const)
      );
      const lessonScriptSteps = new Map(
        lesson.nodes
          .filter((node) => node.data?.scriptDebugSteps !== undefined)
          .map((node) => [node.id, node.data.scriptDebugSteps] as const)
      );

      // Guard against vacuous assertions: every visible lesson persists
      // computed results and at least one script-verification step trace.
      expect(lessonResults.size).toBeGreaterThan(0);
      expect(lessonGroupInstanceKeys.size).toBeGreaterThan(0);
      expect(lessonScriptSteps.size).toBeGreaterThan(0);

      // Sender side: lesson loaded into an empty canvas. Committed results
      // must already survive this normalization unchanged.
      const canvas = runImportPipeline(loadFlow(fileName));
      expect(canvas.nodes.map((node) => node.id)).toEqual(
        lesson.nodes.map((node) => node.id)
      );
      const canvasById = new Map(canvas.nodes.map((node) => [node.id, node]));
      for (const [nodeId, result] of lessonResults) {
        expect(
          canvasById.get(nodeId)?.data?.result,
          `canvas result of ${nodeId}`
        ).toEqual(result);
      }

      // Exporter: build the share payload and require it to pass the same
      // validation gate every import path applies.
      const payload = buildSharePayload(canvas.nodes, canvas.edges);
      const payloadValidation = validateFlowData(
        payload as unknown as FlowData
      );
      expect(payloadValidation.errors).toEqual([]);
      expect(payloadValidation.ok).toBe(true);

      // The payload must carry script debug steps inline; the receiving
      // browser has an empty scriptSteps cache and can only rebuild from it.
      for (const [nodeId, steps] of lessonScriptSteps) {
        const payloadNode = payload.nodes.find((node) => node.id === nodeId);
        expect(
          payloadNode?.data?.scriptDebugSteps,
          `payload scriptDebugSteps of ${nodeId}`
        ).toEqual(steps);
      }

      // Transport + receiving browser (empty canvas, empty caches).
      const wireFlow = JSON.parse(JSON.stringify(payload)) as FlowData;
      restoreScriptSteps([]);
      const roundtrip = runImportPipeline(wireFlow);

      // Node ids: importing into an empty canvas must not rename anything.
      expect(roundtrip.nodes.map((node) => node.id)).toEqual(
        lesson.nodes.map((node) => node.id)
      );

      const roundtripById = new Map(
        roundtrip.nodes.map((node) => [node.id, node])
      );

      // Every committed non-empty result survives byte-for-byte.
      for (const [nodeId, result] of lessonResults) {
        expect(
          roundtripById.get(nodeId)?.data?.result,
          `roundtrip result of ${nodeId}`
        ).toEqual(result);
      }

      // groupInstanceKeys drive grouped-input index resolution; the importer
      // must hand them through unchanged from the sender's canvas state.
      for (const [nodeId, node] of canvasById) {
        expect(
          roundtripById.get(nodeId)?.data?.groupInstanceKeys,
          `roundtrip groupInstanceKeys of ${nodeId}`
        ).toEqual(node.data?.groupInstanceKeys);
      }

      // All edges preserved with ids, endpoints and handles intact.
      expect(roundtrip.edges.map(calcEdgeShape)).toEqual(
        canvas.edges.map(calcEdgeShape)
      );
      expect(roundtrip.edges).toHaveLength(lesson.edges.length);

      // Script debug steps land in the receiving cache via ingestScriptSteps.
      for (const [nodeId, steps] of lessonScriptSteps) {
        expect(
          getScriptSteps(nodeId),
          `receiving scriptSteps cache for ${nodeId}`
        ).toEqual(steps);
      }
    }
  );
});
