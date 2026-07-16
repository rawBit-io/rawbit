// src/lib/share/buildSharePayload.ts
import type {
  FlowNode,
  SharePayload,
  SharedEdge,
  SharedNode,
} from "@/types";
import type { Edge } from "@xyflow/react";
import { FLOW_SCHEMA_VERSION } from "@/lib/flow/schema";
import { hydrateNodesWithScriptSteps } from "@/lib/share/scriptStepsCache";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";
import { normalizeAndDedupeEdgeConnections } from "@/lib/flow/edgeNormalization";
import { pruneDanglingEdges } from "@/lib/flow/pruneDanglingEdges";
import { buildRadioVirtualEdgeMetadata } from "@/lib/graphUtils";

export function buildSharePayload(
  nodes: FlowNode[],
  edges: Edge[]
): SharePayload {
  const nodesWithSteps = hydrateNodesWithScriptSteps(
    stripLegacyFlowMapNodeData(nodes)
  );
  const cleanedNodes = nodesWithSteps.map((n) => {
    const data: Record<string, unknown> = { ...(n.data ?? {}) };

    // Remove only UI-specific fields
    delete data.searchMark;
    delete data.isHighlighted;
    delete data.excludeFromFlowMap;
    // Keep scriptDebugSteps - we want to share the full debug info

    const sharedNode: SharedNode = {
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data,
      parentId: n.parentId,
      extent: n.extent,
      width: n.width,
      height: n.height,
      // keep group drag handle if present
      ...(n.dragHandle ? { dragHandle: n.dragHandle } : {}),
    };
    return sharedNode;
  });

  // Import validation hard-rejects dangling edges, so never share one.
  // pruneDanglingEdges drops provable handle-dangles (e.g. a legacy archive
  // whose handle schema changed) with the same buildPorts truth the import
  // validator uses — without it a sender's silently-dangling edge makes the
  // recipient's link dead (EDGE_*_HANDLE_UNKNOWN hard-fail).
  const sharedNodeIds = new Set(cleanedNodes.map((n) => n.id));
  const { edges: liveEdges } = pruneDanglingEdges(nodesWithSteps, edges);
  const cleanedEdges: SharedEdge[] = normalizeAndDedupeEdgeConnections(
    liveEdges
  )
    .filter(
      (edge) => sharedNodeIds.has(edge.source) && sharedNodeIds.has(edge.target)
    )
    .map((edge) => ({
      ...edge,
    }));
  const { virtualEdges, virtualEdgeIssues } =
    buildRadioVirtualEdgeMetadata(nodesWithSteps);

  return {
    name: "shared",
    schemaVersion: FLOW_SCHEMA_VERSION,
    nodes: cleanedNodes,
    edges: cleanedEdges,
    virtualEdges,
    ...(virtualEdgeIssues.length > 0 ? { virtualEdgeIssues } : {}),
  };
}
