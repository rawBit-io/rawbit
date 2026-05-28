import { useCallback, useEffect } from "react";
import type { FlowNode } from "@/types";

interface UseSearchHighlightsOptions {
  showSearchPanel: boolean;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  setNodes: (updater: (nodes: FlowNode[]) => FlowNode[]) => void;
  centerOnNode: (nodeId: string) => void;
  clearHighlights: () => void;
}

export function useSearchHighlights({
  showSearchPanel,
  searchQuery,
  setSearchQuery,
  setNodes,
  centerOnNode,
  clearHighlights,
}: UseSearchHighlightsOptions) {
  const focusSearchHit = useCallback(
    (nodeId: string, term: string) => {
      centerOnNode(nodeId);
      const ts = Date.now();
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, searchMark: { term, ts } } }
            : node.data?.searchMark
            ? { ...node, data: { ...node.data, searchMark: undefined } }
            : node
        )
      );
    },
    [centerOnNode, setNodes]
  );

  const clearAllTextHighlights = useCallback(() => {
    setNodes((nodes) => {
      let changed = false;
      const next = nodes.map((node) => {
        if (!node.data?.searchMark) return node;
        changed = true;
        return { ...node, data: { ...node.data, searchMark: undefined } };
      });
      return changed ? next : nodes;
    });
  }, [setNodes]);

  useEffect(() => {
    if (showSearchPanel && searchQuery) {
      clearAllTextHighlights();
    }
  }, [searchQuery, showSearchPanel, clearAllTextHighlights]);

  useEffect(() => {
    if (!showSearchPanel) {
      setSearchQuery("");
      clearHighlights();
      clearAllTextHighlights();
    }
  }, [
    showSearchPanel,
    clearAllTextHighlights,
    clearHighlights,
    setSearchQuery,
  ]);

  return {
    focusSearchHit,
    clearAllTextHighlights,
  } as const;
}
