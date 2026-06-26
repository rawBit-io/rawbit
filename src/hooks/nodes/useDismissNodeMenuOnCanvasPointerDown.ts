import { useEffect } from "react";
import { DISMISS_NODE_MENUS_EVENT } from "@/lib/flow/nodeMenuEvents";

export function useDismissNodeMenuOnCanvasPointerDown(
  isOpen: boolean,
  onDismiss: () => void
) {
  useEffect(() => {
    if (!isOpen) return;

    window.addEventListener(DISMISS_NODE_MENUS_EVENT, onDismiss);
    return () => {
      window.removeEventListener(DISMISS_NODE_MENUS_EVENT, onDismiss);
    };
  }, [isOpen, onDismiss]);
}
