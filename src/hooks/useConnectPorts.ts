import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addEdge, type Connection, type Edge } from "@xyflow/react";
import type { FlowNode } from "@/types";
import { buildPorts } from "@/lib/nodes/ports";
import { isCalculableNode } from "@/lib/flow/nonCalculableNodes";
import { makeEdgeIsLive } from "@/lib/flow/pruneDanglingEdges";
import {
  getDirectionAvailability,
  type ConnectMode,
  type EdgeLike,
  type NodePorts,
} from "@/lib/nodes/connectActions";

interface UseConnectPortsArgs {
  nodes: FlowNode[];
  edges: Edge[];
  connectOpen: boolean;
  selectedSignature: string;
  selectedNodeIds: string[];
  isSwapped: boolean;
}

interface UseConnectPortsResult {
  allPorts: NodePorts[];
  sourcePorts: NodePorts | null;
  targetPorts: NodePorts | null;
  canConnect: boolean;
  existingEdges: {
    source: string;
    sourceHandle: string | null;
    target: string;
    targetHandle: string | null;
  }[];
  canConnectEdge: boolean;
  canCopyInputs: boolean;
  availableModes: ConnectMode[];
}

export function useConnectPorts({
  nodes,
  edges,
  connectOpen,
  selectedSignature,
  selectedNodeIds,
  isSwapped,
}: UseConnectPortsArgs): UseConnectPortsResult {
  const portCacheRef = useRef<Map<string, NodePorts>>(new Map());

  useEffect(() => {
    if (!connectOpen) return;

    const next = new Map(portCacheRef.current);
    const ids = selectedSignature
      ? selectedSignature.split("|").filter(Boolean)
      : [];
    const toCompute = ids.length === 2 ? ids : nodes.map((node) => node.id);

    toCompute.forEach((id) => {
      const target = nodes.find((n) => n.id === id);
      if (target) {
        next.set(id, buildPorts(target));
      }
    });

    portCacheRef.current = next;
  }, [connectOpen, selectedSignature, nodes]);

  const allPorts = useMemo(() => {
    if (!connectOpen) return [];
    const cache = portCacheRef.current;
    const ids = selectedSignature
      ? selectedSignature.split("|").filter(Boolean)
      : [];
    if (ids.length === 2) {
      const relatedIds = new Set(ids);
      edges.forEach((edge) => {
        if (relatedIds.has(edge.target)) {
          relatedIds.add(edge.source);
        }
      });
      const ordered: NodePorts[] = [];
      relatedIds.forEach((id) => {
        const cached = cache.get(id);
        if (cached) {
          ordered.push(cached);
          return;
        }
        const node = nodes.find((candidate) => candidate.id === id);
        if (!node) return;
        const ports = buildPorts(node);
        cache.set(id, ports);
        ordered.push(ports);
      });
      return ordered;
    }
    return nodes.map((node) => cache.get(node.id) ?? buildPorts(node));
  }, [connectOpen, edges, selectedSignature, nodes]);

  // Occupancy must be judged against edges the projection actually draws: a
  // dangling edge (an endpoint handle removed by a group/template shrink) is
  // hidden on canvas yet still parks on a live input. Filter it out here so
  // every downstream check (dialog checkboxes, getDirectionAvailability,
  // getOccupiedTargetHandles) sees the same live set the user sees (DA-11).
  const liveEdges = useMemo(
    () => (connectOpen ? edges.filter(makeEdgeIsLive(nodes)) : []),
    [connectOpen, edges, nodes]
  );

  const existingEdges = useMemo(() => {
    if (!connectOpen) return [];
    return liveEdges.map((e) => ({
      source: e.source,
      sourceHandle: e.sourceHandle ?? null,
      target: e.target,
      targetHandle: e.targetHandle ?? null,
    }));
  }, [connectOpen, liveEdges]);

  const {
    sourcePorts,
    targetPorts,
    canConnect,
    canConnectEdge,
    canCopyInputs,
    availableModes,
  } = useMemo(() => {
    const edgeLikes: EdgeLike[] = liveEdges.map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? null,
      target: edge.target,
      targetHandle: edge.targetHandle ?? null,
      id: edge.id,
    }));

    if (selectedNodeIds.length !== 2) {
      return {
        sourcePorts: null,
        targetPorts: null,
        canConnect: false,
        canConnectEdge: false,
        canCopyInputs: false,
        availableModes: [] as ConnectMode[],
      };
    }

    const [firstId, secondId] = selectedNodeIds;

    const cache = portCacheRef.current;
    const getPorts = (id: string) => {
      let ports = cache.get(id);
      if (connectOpen && ports) return ports;

      const node = nodes.find((n) => n.id === id);
      if (node) {
        ports = buildPorts(node);
        cache.set(id, ports);
      }
      return ports ?? null;
    };

    const first = getPorts(firstId);
    const second = getPorts(secondId);
    const forward = getDirectionAvailability(first, second, edgeLikes);
    const reverse = getDirectionAvailability(second, first, edgeLikes);

    let source = isSwapped ? second : first;
    let target = isSwapped ? first : second;
    let selectedAvailability = isSwapped ? reverse : forward;
    const fallbackAvailability = isSwapped ? forward : reverse;

    if (!selectedAvailability.canDoAnything) {
      if (!isSwapped && reverse.canDoAnything) {
        source = second;
        target = first;
        selectedAvailability = reverse;
      } else if (isSwapped && forward.canDoAnything) {
        source = first;
        target = second;
        selectedAvailability = fallbackAvailability;
      }
    }

    return {
      sourcePorts: source,
      targetPorts: target,
      canConnect: forward.canDoAnything || reverse.canDoAnything,
      canConnectEdge: selectedAvailability.canConnectEdge,
      canCopyInputs: selectedAvailability.canCopyInputs,
      availableModes: selectedAvailability.availableModes,
    };
  }, [connectOpen, liveEdges, isSwapped, nodes, selectedNodeIds]);

  return {
    allPorts,
    sourcePorts,
    targetPorts,
    canConnect,
    existingEdges,
    canConnectEdge,
    canCopyInputs,
    availableModes,
  };
}

interface UseConnectDialogArgs {
  nodes: FlowNode[];
  edges: Edge[];
  connectOpen: boolean;
  selectedNodeIds: string[];
  setNodes: (updater: (nodes: FlowNode[]) => FlowNode[]) => void;
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void;
  markPendingAfterDirtyChange: () => void;
  skipNextEdgeSnapshotRef: React.MutableRefObject<boolean>;
  setConnectOpen: (open: boolean) => void;
}

export function useConnectDialog({
  nodes,
  edges,
  connectOpen,
  selectedNodeIds,
  setNodes,
  setEdges,
  markPendingAfterDirtyChange,
  skipNextEdgeSnapshotRef,
  setConnectOpen,
}: UseConnectDialogArgs) {
  const [isSwapped, setIsSwapped] = useState(false);

  const selectedSignature = useMemo(() => {
    if (selectedNodeIds.length === 0) return "";
    const sorted = [...selectedNodeIds].sort();
    return sorted.join("|");
  }, [selectedNodeIds]);

  useEffect(() => {
    setIsSwapped(false);
  }, [selectedSignature]);

  useEffect(() => {
    if (!connectOpen) setIsSwapped(false);
  }, [connectOpen]);

  const portData = useConnectPorts({
    nodes,
    edges,
    connectOpen,
    selectedSignature,
    selectedNodeIds,
    isSwapped,
  });

  const handleApply = useCallback(
    (
      edgesToAdd: {
        source: string;
        sourceHandle: string | null;
        target: string;
        targetHandle: string | null;
      }[]
    ) => {
      if (edgesToAdd.length === 0) {
        setIsSwapped((prev) => !prev);
        return;
      }

      setEdges((previous) =>
        edgesToAdd.reduce(
          (acc, edge) =>
            addEdge(
              {
                ...edge,
                targetHandle: edge.targetHandle ?? undefined,
              } as Connection,
              acc
            ),
          previous
        )
      );

      setNodes((previous) =>
        previous.map((node) =>
          edgesToAdd.some((edge) => edge.target === node.id) &&
          isCalculableNode(node)
            ? { ...node, data: { ...node.data, dirty: true } }
            : node
        )
      );

      skipNextEdgeSnapshotRef.current = true;
      markPendingAfterDirtyChange();
      setConnectOpen(false);
    },
    [
      markPendingAfterDirtyChange,
      setConnectOpen,
      setEdges,
      setNodes,
      skipNextEdgeSnapshotRef,
    ]
  );

  return {
    ...portData,
    handleApply,
  } as const;
}
