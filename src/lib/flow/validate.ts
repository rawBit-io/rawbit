import type { Edge } from "@xyflow/react";
import type { FlowData, FlowNode } from "@/types";
import { buildPorts } from "@/lib/nodes/ports";
import {
  FLOW_SCHEMA_VERSION,
  SUPPORTED_FLOW_SCHEMA_VERSIONS,
} from "./schema";

export type FlowValidationLevel = "error" | "warning";

export interface FlowValidationIssue {
  level: FlowValidationLevel;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface FlowValidationResult {
  ok: boolean;
  schemaVersion: number;
  issues: FlowValidationIssue[];
  errors: FlowValidationIssue[];
  warnings: FlowValidationIssue[];
}

interface ValidateFlowOptions {
  /**
   * Node types that are considered valid for the current runtime.
   * Any node whose type is not present will trigger an error.
   */
  allowedNodeTypes?: ReadonlySet<string>;
  /**
   * Calculation function names that are supported by the current runtime.
   * Only checked when supplied, so file imports can stay forward-compatible.
   */
  allowedFunctionNames?: ReadonlySet<string>;
  /**
   * Require every node to carry an object data payload. Kept optional because
   * some legacy user exports may rely on runtime defaults during import.
   */
  requireNodeData?: boolean;
}

const DEFAULT_ALLOWED_NODE_TYPES = new Set<string>([
  "calculation",
  "shadcnGroup",
  "shadcnTextInfo",
  "opCodeNode",
  "trezorAction",
]);

const HANDLE_PLACEHOLDER = "__DEFAULT_HANDLE__";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normaliseHandle = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const edgeLabel = (edge: Edge, index: number) =>
  typeof edge.id === "string" && edge.id.trim() !== ""
    ? edge.id
    : `edge#${index}`;

const nodeLabel = (node: FlowNode, index: number) =>
  typeof node.id === "string" && node.id.trim() !== ""
    ? node.id
    : `node#${index}`;

interface HandleMetadata {
  validHandles: Set<string>;
  hasInputs: boolean;
}

function collectHandleMetadata(node: FlowNode): HandleMetadata {
  try {
    const ports = buildPorts(node);
    const handles = new Set<string>();
    ports.inputs.forEach((input) => {
      if (input.handleId) handles.add(input.handleId);
    });
    return { validHandles: handles, hasInputs: handles.size > 0 };
  } catch (err) {
    console.warn("validateFlowData: failed to build ports for node", node.id, err);
    return { validHandles: new Set<string>(), hasInputs: false };
  }
}

export function validateFlowData(
  rawFlow: FlowData & {
    schemaVersion?: unknown;
    meta?: { schemaVersion?: unknown };
  },
  options?: ValidateFlowOptions
): FlowValidationResult {
  const issues: FlowValidationIssue[] = [];

  if (!isPlainObject(rawFlow)) {
    issues.push({
      level: "error",
      code: "FLOW_NOT_OBJECT",
      message: "Flow payload is not an object.",
    });
    return {
      ok: false,
      schemaVersion: FLOW_SCHEMA_VERSION,
      issues,
      errors: issues,
      warnings: [],
    };
  }

  const allowedNodeTypes = options?.allowedNodeTypes ?? DEFAULT_ALLOWED_NODE_TYPES;
  const allowedFunctionNames = options?.allowedFunctionNames;

  const rawVersion =
    rawFlow.schemaVersion ?? rawFlow.meta?.schemaVersion ?? undefined;

  let schemaVersion: number = FLOW_SCHEMA_VERSION;

  if (rawVersion === undefined) {
    issues.push({
      level: "warning",
      code: "SCHEMA_VERSION_MISSING",
      message: "Flow schema version missing; assuming current runtime schema.",
    });
  } else if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion)) {
    issues.push({
      level: "error",
      code: "SCHEMA_VERSION_INVALID",
      message: "Flow schema version must be an integer.",
    });
  } else if (!SUPPORTED_FLOW_SCHEMA_VERSIONS.has(rawVersion)) {
    issues.push({
      level: "error",
      code: "SCHEMA_VERSION_UNSUPPORTED",
      message: `Flow schema version ${rawVersion} is not supported by this runtime.`,
    });
    schemaVersion = rawVersion;
  } else {
    schemaVersion = rawVersion;
  }

  if (!Array.isArray(rawFlow.nodes)) {
    issues.push({
      level: "error",
      code: "NODES_INVALID",
      message: "Flow nodes collection is not an array.",
    });
  }

  if (!Array.isArray(rawFlow.edges)) {
    issues.push({
      level: "error",
      code: "EDGES_INVALID",
      message: "Flow edges collection is not an array.",
    });
  }

  const nodes: FlowNode[] = Array.isArray(rawFlow.nodes) ? rawFlow.nodes : [];
  const edges: Edge[] = Array.isArray(rawFlow.edges) ? rawFlow.edges : [];

  const nodeIds = new Set<string>();
  const nodeTypeById = new Map<string, string>();
  const handleMeta = new Map<string, HandleMetadata>();

  nodes.forEach((node, index) => {
    const label = nodeLabel(node, index);

    if (typeof node.id !== "string" || node.id.trim() === "") {
      issues.push({
        level: "error",
        code: "NODE_ID_INVALID",
        message: `Node ${label} is missing a valid id.`,
      });
    } else if (nodeIds.has(node.id)) {
      issues.push({
        level: "error",
        code: "NODE_ID_DUPLICATE",
        message: `Duplicate node id detected: ${node.id}.`,
        nodeId: node.id,
      });
    } else {
      nodeIds.add(node.id);
    }

    if (typeof node.type !== "string" || node.type.trim() === "") {
      issues.push({
        level: "error",
        code: "NODE_TYPE_INVALID",
        message: `Node ${label} is missing a valid type.`,
        nodeId: node.id,
      });
    } else if (!allowedNodeTypes.has(node.type)) {
      issues.push({
        level: "error",
        code: "NODE_TYPE_UNKNOWN",
        message: `Node ${label} has unknown type "${node.type}".`,
        nodeId: node.id,
      });
    } else if (typeof node.id === "string" && node.id.trim() !== "") {
      nodeTypeById.set(node.id, node.type);
    }

    if (!isPlainObject(node.position)) {
      issues.push({
        level: "error",
        code: "NODE_POSITION_INVALID",
        message: `Node ${label} is missing position data.`,
        nodeId: node.id,
      });
    } else {
      const { x, y } = node.position as { x: unknown; y: unknown };
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
        issues.push({
          level: "error",
          code: "NODE_POSITION_NON_NUMERIC",
          message: `Node ${label} contains non-numeric position values.`,
          nodeId: node.id,
        });
      }
    }

    if (node.data === undefined && options?.requireNodeData) {
      issues.push({
        level: "error",
        code: "NODE_DATA_MISSING",
        message: `Node ${label} is missing data payload.`,
        nodeId: node.id,
      });
    } else if (node.data !== undefined && !isPlainObject(node.data)) {
      issues.push({
        level: "error",
        code: "NODE_DATA_INVALID",
        message: `Node ${label} has invalid data payload (expected object).`,
        nodeId: node.id,
      });
    }

    if (
      allowedFunctionNames &&
      isPlainObject(node.data) &&
      (node.type === "calculation" || node.type === "opCodeNode")
    ) {
      const functionName = node.data.functionName;
      if (typeof functionName !== "string" || functionName.trim() === "") {
        issues.push({
          level: "error",
          code: "NODE_FUNCTION_MISSING",
          message: `Node ${label} is missing a calculation function name.`,
          nodeId: node.id,
        });
      } else if (!allowedFunctionNames.has(functionName)) {
        issues.push({
          level: "error",
          code: "NODE_FUNCTION_UNKNOWN",
          message: `Node ${label} references unknown function "${functionName}".`,
          nodeId: node.id,
        });
      }
    }

    const meta = collectHandleMetadata(node);
    handleMeta.set(node.id, meta);
  });

  nodes.forEach((node, index) => {
    const label = nodeLabel(node, index);
    const parentId = (node as { parentId?: unknown }).parentId;
    if (parentId === undefined || parentId === null || parentId === "") return;

    if (typeof parentId !== "string") {
      issues.push({
        level: "error",
        code: "NODE_PARENT_INVALID",
        message: `Node ${label} has invalid parent id.`,
        nodeId: node.id,
      });
      return;
    }

    if (parentId === node.id) {
      issues.push({
        level: "error",
        code: "NODE_PARENT_SELF",
        message: `Node ${label} cannot be parented to itself.`,
        nodeId: node.id,
      });
      return;
    }

    if (!nodeIds.has(parentId)) {
      issues.push({
        level: "error",
        code: "NODE_PARENT_MISSING",
        message: `Node ${label} references missing parent group ${parentId}.`,
        nodeId: node.id,
      });
      return;
    }

    if (nodeTypeById.get(parentId) !== "shadcnGroup") {
      issues.push({
        level: "error",
        code: "NODE_PARENT_NOT_GROUP",
        message: `Node ${label} is parented to non-group node ${parentId}.`,
        nodeId: node.id,
      });
    }
  });

  const incomingPerNode = new Map<string, Map<string, string>>();
  const edgeIds = new Set<string>();

  edges.forEach((edge, index) => {
    const label = edgeLabel(edge, index);
    const { source, target } = edge;

    if (typeof edge.id !== "string" || edge.id.trim() === "") {
      issues.push({
        level: "error",
        code: "EDGE_ID_INVALID",
        message: `Edge ${label} is missing a valid id.`,
        edgeId: edge.id,
      });
    } else if (edgeIds.has(edge.id)) {
      issues.push({
        level: "error",
        code: "EDGE_ID_DUPLICATE",
        message: `Duplicate edge id detected: ${edge.id}.`,
        edgeId: edge.id,
      });
    } else {
      edgeIds.add(edge.id);
    }

    if (typeof source !== "string" || source.trim() === "") {
      issues.push({
        level: "error",
        code: "EDGE_SOURCE_INVALID",
        message: `Edge ${label} has an invalid source id.`,
        edgeId: edge.id,
      });
    } else if (!nodeIds.has(source)) {
      issues.push({
        level: "error",
        code: "EDGE_SOURCE_MISSING",
        message: `Edge ${label} references missing source node ${source}.`,
        edgeId: edge.id,
      });
    }

    if (typeof target !== "string" || target.trim() === "") {
      issues.push({
        level: "error",
        code: "EDGE_TARGET_INVALID",
        message: `Edge ${label} has an invalid target id.`,
        edgeId: edge.id,
      });
      return;
    }

    if (!nodeIds.has(target)) {
      issues.push({
        level: "error",
        code: "EDGE_TARGET_MISSING",
        message: `Edge ${label} references missing target node ${target}.`,
        edgeId: edge.id,
      });
      return;
    }

    const normalisedHandle = normaliseHandle(edge.targetHandle);
    const handleKey = normalisedHandle ?? HANDLE_PLACEHOLDER;

    let perHandle = incomingPerNode.get(target);
    if (!perHandle) {
      perHandle = new Map<string, string>();
      incomingPerNode.set(target, perHandle);
    }

    const existing = perHandle.get(handleKey);
    if (existing) {
      issues.push({
        level: "error",
        code: "EDGE_HANDLE_DUPLICATE",
        message: `Edges ${existing} and ${label} both connect to handle ${
          normalisedHandle ?? "<default>"
        } on node ${target}.`,
        edgeId: edge.id,
        nodeId: target,
      });
    } else {
      perHandle.set(handleKey, label);
    }

    const meta = handleMeta.get(target);
    if (!meta) return;

    if (!meta.hasInputs) {
      issues.push({
        level: "error",
        code: "EDGE_TARGET_NO_INPUTS",
        message: `Edge ${label} targets node ${target}, which does not accept inputs.`,
        edgeId: edge.id,
        nodeId: target,
      });
      return;
    }

    if (normalisedHandle === undefined) {
      issues.push({
        level: "error",
        code: "EDGE_TARGET_HANDLE_MISSING",
        message: `Edge ${label} is missing a target handle for node ${target}.`,
        edgeId: edge.id,
        nodeId: target,
      });
      return;
    }

    if (!meta.validHandles.has(normalisedHandle)) {
      issues.push({
        level: "error",
        code: "EDGE_TARGET_HANDLE_UNKNOWN",
        message: `Edge ${label} references unknown handle ${normalisedHandle} on node ${target}.`,
        edgeId: edge.id,
        nodeId: target,
      });
    }
  });

  const protocolDiagramLayout = rawFlow.protocolDiagramLayout;
  if (protocolDiagramLayout !== undefined) {
    if (!isPlainObject(protocolDiagramLayout)) {
      issues.push({
        level: "warning",
        code: "PROTOCOL_LAYOUT_INVALID",
        message: "Protocol diagram layout is invalid and will be ignored.",
      });
    } else {
      const groupOffsets = protocolDiagramLayout.groupOffsets;
      if (groupOffsets !== undefined) {
        if (!isPlainObject(groupOffsets)) {
          issues.push({
            level: "warning",
            code: "PROTOCOL_LAYOUT_OFFSETS_INVALID",
            message: "Protocol diagram group offsets are invalid and will be ignored.",
          });
        } else {
          for (const [groupId, offset] of Object.entries(groupOffsets)) {
            if (!nodeIds.has(groupId)) {
              issues.push({
                level: "warning",
                code: "PROTOCOL_LAYOUT_GROUP_MISSING",
                message: `Protocol diagram layout references missing group ${groupId}.`,
                nodeId: groupId,
              });
              continue;
            }
            if (nodeTypeById.get(groupId) !== "shadcnGroup") {
              issues.push({
                level: "warning",
                code: "PROTOCOL_LAYOUT_GROUP_INVALID",
                message: `Protocol diagram layout references non-group node ${groupId}.`,
                nodeId: groupId,
              });
            }
            if (
              !isPlainObject(offset) ||
              !isFiniteNumber(offset.dx) ||
              !isFiniteNumber(offset.dy)
            ) {
              issues.push({
                level: "warning",
                code: "PROTOCOL_LAYOUT_OFFSET_INVALID",
                message: `Protocol diagram layout has invalid offset for group ${groupId}.`,
                nodeId: groupId,
              });
            }
          }
        }
      }
    }
  }

  const scriptSteps = (rawFlow as { scriptSteps?: unknown }).scriptSteps;
  if (scriptSteps !== undefined) {
    if (!Array.isArray(scriptSteps)) {
      issues.push({
        level: "warning",
        code: "SCRIPT_STEPS_INVALID",
        message: "Script-step entries are invalid and will be ignored.",
      });
    } else {
      scriptSteps.forEach((entry, index) => {
        if (!Array.isArray(entry) || typeof entry[0] !== "string") {
          issues.push({
            level: "warning",
            code: "SCRIPT_STEP_ENTRY_INVALID",
            message: `Script-step entry ${index} is invalid and will be ignored.`,
          });
          return;
        }
        if (!nodeIds.has(entry[0])) {
          issues.push({
            level: "warning",
            code: "SCRIPT_STEP_NODE_MISSING",
            message: `Script-step entry references missing node ${entry[0]}.`,
            nodeId: entry[0],
          });
        }
      });
    }
  }

  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");

  return {
    ok: errors.length === 0,
    schemaVersion,
    issues,
    errors,
    warnings,
  };
}
