import { useCallback, useState } from "react";
import type { FlowNode } from "@/types";
import { getExpandedExportNodeSelection } from "@/lib/flow/exportSelection";

interface UseSimplifiedSaveOptions {
  nodes: FlowNode[];
  saveSimplifiedFlow: () => void | Promise<void>;
}

export function useSimplifiedSave({
  nodes,
  saveSimplifiedFlow,
}: UseSimplifiedSaveOptions) {
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [message, setMessage] = useState("");

  const promptSave = useCallback(() => {
    const { selectedCount, totalCount, nodesToSave } =
      getExpandedExportNodeSelection(nodes);
    const exportCount = nodesToSave.length;

    if (selectedCount > 0 && exportCount < totalCount) {
      const message =
        exportCount > selectedCount
          ? `Save only the ${exportCount}/${totalCount} nodes from selected groups and nodes?`
          : `Save only the ${selectedCount}/${totalCount} selected nodes?`;
      setMessage(message);
      setShowConfirmation(true);
      return;
    }

    void saveSimplifiedFlow();
  }, [nodes, saveSimplifiedFlow]);

  const confirmSave = useCallback(() => {
    void saveSimplifiedFlow();
    setShowConfirmation(false);
  }, [saveSimplifiedFlow]);

  const cancelSave = useCallback(() => {
    setShowConfirmation(false);
  }, []);

  return {
    showConfirmation,
    confirmationMessage: message,
    promptSave,
    confirmSave,
    cancelSave,
  } as const;
}
