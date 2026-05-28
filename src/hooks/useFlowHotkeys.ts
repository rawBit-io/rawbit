import { useEffect } from "react";

interface UseFlowHotkeysArgs {
  paletteOpenRef: React.MutableRefObject<boolean>;
  hasSelectionRef: React.MutableRefObject<boolean>;
  hasCopiedNodesRef: React.MutableRefObject<boolean>;
  copyNodesRef: React.MutableRefObject<(() => void) | null>;
  pasteNodesRef: React.MutableRefObject<((withOffset?: boolean) => void) | null>;
  canUndoRef: React.MutableRefObject<boolean>;
  canRedoRef: React.MutableRefObject<boolean>;
  undoRef: React.MutableRefObject<(() => void) | null>;
  redoRef: React.MutableRefObject<(() => void) | null>;
  canGroupSelectedRef: React.MutableRefObject<(() => boolean) | undefined>;
  canUngroupSelectedRef: React.MutableRefObject<(() => boolean) | undefined>;
  groupWithUndoRef: React.MutableRefObject<(() => void) | null>;
  ungroupWithUndoRef: React.MutableRefObject<(() => void) | null>;
}

export function useFlowHotkeys({
  paletteOpenRef,
  hasSelectionRef,
  hasCopiedNodesRef,
  copyNodesRef,
  pasteNodesRef,
  canUndoRef,
  canRedoRef,
  undoRef,
  redoRef,
  canGroupSelectedRef,
  canUngroupSelectedRef,
  groupWithUndoRef,
  ungroupWithUndoRef,
}: UseFlowHotkeysArgs) {
  useEffect(() => {
    const isTypingContext = () => {
      const active = document.activeElement;
      return (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active && active.getAttribute("contenteditable") === "true")
      );
    };

    const shouldSkipHotkeys = () => isTypingContext() || paletteOpenRef.current;

    const onKey = (evt: KeyboardEvent) => {
      if (shouldSkipHotkeys()) return;
      if (!(evt.ctrlKey || evt.metaKey)) return;

      const key = evt.key.toLowerCase();

      if (key === "c" && hasSelectionRef.current) {
        evt.preventDefault();
        copyNodesRef.current?.();
      } else if (key === "v" && hasCopiedNodesRef.current) {
        evt.preventDefault();
        pasteNodesRef.current?.(false);
      } else if (key === "z" && canUndoRef.current) {
        evt.preventDefault();
        undoRef.current?.();
      } else if (key === "y" && canRedoRef.current) {
        evt.preventDefault();
        redoRef.current?.();
      } else if (key === "g" && canGroupSelectedRef.current?.()) {
        evt.preventDefault();
        groupWithUndoRef.current?.();
      } else if (key === "u" && canUngroupSelectedRef.current?.()) {
        evt.preventDefault();
        ungroupWithUndoRef.current?.();
      }
    };

    window.addEventListener("keydown", onKey);
    const onCopy = () => {
      if (shouldSkipHotkeys()) return;
      if (!hasSelectionRef.current) return;
      copyNodesRef.current?.();
    };

    const onPaste = (evt: ClipboardEvent) => {
      if (shouldSkipHotkeys()) return;
      if (!hasCopiedNodesRef.current) return;
      evt.preventDefault();
      pasteNodesRef.current?.(false);
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [
    paletteOpenRef,
    hasSelectionRef,
    hasCopiedNodesRef,
    copyNodesRef,
    pasteNodesRef,
    canUndoRef,
    canRedoRef,
    undoRef,
    redoRef,
    canGroupSelectedRef,
    canUngroupSelectedRef,
    groupWithUndoRef,
    ungroupWithUndoRef,
  ]);
}
