import { useEffect } from "react";
import type { CalcStatus } from "@/types";

interface UsePanelAutoCloseArgs {
  activeTabId: string;
  calcStatus: CalcStatus;
  errorCount: number;
  showErrorPanel: boolean;
  setShowErrorPanel: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSearchPanel: React.Dispatch<React.SetStateAction<boolean>>;
}

export function usePanelAutoClose({
  activeTabId,
  calcStatus,
  errorCount,
  showErrorPanel,
  setShowErrorPanel,
  setShowSearchPanel,
}: UsePanelAutoCloseArgs) {
  useEffect(() => {
    setShowErrorPanel(false);
    setShowSearchPanel(false);
  }, [
    activeTabId,
    setShowErrorPanel,
    setShowSearchPanel,
  ]);

  useEffect(() => {
    if (showErrorPanel && calcStatus === "OK" && errorCount === 0) {
      setShowErrorPanel(false);
    }
  }, [calcStatus, errorCount, setShowErrorPanel, showErrorPanel]);
}
