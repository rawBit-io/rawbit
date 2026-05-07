import { useCallback, useMemo, useState } from "react";
import type { FlowNode } from "@/types";
import type { XYPosition } from "@xyflow/react";

interface UseColorPaletteOptions {
  getNodes: () => FlowNode[];
  setNodes: (updater: (nodes: FlowNode[]) => FlowNode[]) => void;
  scheduleSnapshot: (label: string, options?: { refresh?: boolean }) => void;
  isColorable: (node: FlowNode) => boolean;
}

interface ColorPaletteState {
  isOpen: boolean;
  position: XYPosition;
  canApply: boolean;
}

export function useColorPalette({
  getNodes,
  setNodes,
  scheduleSnapshot,
  isColorable,
}: UseColorPaletteOptions) {
  const [state, setState] = useState<ColorPaletteState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    canApply: false,
  });

  const paletteMetrics = useMemo(
    () => ({
      width: 144,
      height: 62,
      margin: 8,
      topBarHeight: 56,
    }),
    []
  );

  const updateEligibility = useCallback(() => {
    const hasColorableSelection = getNodes().some(
      (node) => node.selected && isColorable(node)
    );
    setState((prev) => ({ ...prev, canApply: hasColorableSelection }));
  }, [getNodes, isColorable]);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const open = useCallback(
    (evt: React.MouseEvent) => {
      setState((prev) => {
        if (!prev.canApply) {
          return prev;
        }

        const { width, height, margin, topBarHeight } = paletteMetrics;

        let x = evt.clientX - width / 2;
        let y = topBarHeight + margin;

        const vw = window.innerWidth;
        const vh = window.innerHeight;

        if (x + width > vw - margin) x = vw - margin - width;
        if (x < margin) x = margin;
        if (y + height > vh - margin) y = vh - margin - height;
        if (y < margin) y = margin;

        return {
          ...prev,
          isOpen: true,
          position: { x, y },
        };
      });
    },
    [paletteMetrics]
  );

  const apply = useCallback(
    (color: string | undefined) => {
      const nodes = getNodes();
      const targets = nodes.filter(
        (node) => node.selected && isColorable(node)
      );
      if (!targets.length) {
        close();
        return;
      }

      setNodes((prev) =>
        prev.map((node) => {
          if (!targets.some((target) => target.id === node.id)) return node;

          if (node.type === "shadcnTextInfo") {
            return {
              ...node,
              data: {
                ...node.data,
                borderColor: color,
                textInfoFill: color === undefined ? "none" : undefined,
              },
            };
          }

          return { ...node, data: { ...node.data, borderColor: color } };
        })
      );

      scheduleSnapshot("Change Node Color");
      close();
      updateEligibility();
    },
    [close, getNodes, isColorable, scheduleSnapshot, setNodes, updateEligibility]
  );

  return {
    isOpen: state.isOpen,
    position: state.position,
    canApply: state.canApply,
    open,
    close,
    apply,
    updateEligibility,
  } as const;
}
