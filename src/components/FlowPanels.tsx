import { UndoRedoPanel } from "@/components/layout/UndoRedoPanel";
import { ErrorPanel } from "@/components/layout/ErrorPanel";
import { SearchPanel } from "@/components/layout/SearchPanel";
import type { CalcError, FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";

interface FlowPanelsProps {
  showUndoRedoPanel: boolean;
  setShowUndoRedoPanel: (open: boolean) => void;
  showErrorPanel: boolean;
  setShowErrorPanel: (open: boolean) => void;
  errorInfo: CalcError[];
  nodes: FlowNode[];
  showSearchPanel: boolean;
  setShowSearchPanel: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  edges: Edge[];
  centerOnNode: (id: string) => void;
  focusSearchHit: (id: string, term: string) => void;
  hasMultipleTabs: boolean;
}

export function FlowPanels({
  showUndoRedoPanel,
  setShowUndoRedoPanel,
  showErrorPanel,
  setShowErrorPanel,
  errorInfo,
  nodes,
  showSearchPanel,
  setShowSearchPanel,
  searchQuery,
  setSearchQuery,
  edges,
  centerOnNode,
  focusSearchHit,
  hasMultipleTabs,
}: FlowPanelsProps) {
  return (
    <>
      <UndoRedoPanel
        isOpen={showUndoRedoPanel}
        hasVisibleTabs={hasMultipleTabs}
        onClose={() => setShowUndoRedoPanel(false)}
      />
      <ErrorPanel
        isOpen={showErrorPanel}
        errors={errorInfo}
        nodes={nodes}
        hasVisibleTabs={hasMultipleTabs}
        onSelect={centerOnNode}
        onClose={() => setShowErrorPanel(false)}
      />
      <SearchPanel
        isOpen={showSearchPanel}
        nodes={nodes}
        edges={edges}
        query={searchQuery}
        setQuery={setSearchQuery}
        hasVisibleTabs={hasMultipleTabs}
        onSelect={centerOnNode}
        onLocateMatch={focusSearchHit}
        onClose={() => setShowSearchPanel(false)}
      />
    </>
  );
}
