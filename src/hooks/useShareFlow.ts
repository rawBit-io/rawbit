import { useCallback, useRef, useState } from "react";
import type { Edge } from "@xyflow/react";
import type { FlowNode } from "@/types";
import { shareFlow } from "@/lib/share";
import { buildSharePayload } from "@/lib/share/buildSharePayload";
import { sanitizeGroupBundleVisualElementsForState } from "@/lib/flow/groupEdgeBundling";

interface UseShareFlowOptions {
  getNodes: () => FlowNode[];
  getEdges: () => Edge[];
}

interface InfoDialogState {
  open: boolean;
  message: string;
}

export function useShareFlow({
  getNodes,
  getEdges,
}: UseShareFlowOptions) {
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareCreatedId, setShareCreatedId] = useState<string | null>(null);
  const [softGateOpen, setSoftGateOpen] = useState(false);
  const [infoDialog, setInfoDialog] = useState<InfoDialogState>({
    open: false,
    message: "",
  });

  const pendingShareRef = useRef<ReturnType<typeof buildSharePayload> | null>(
    null
  );

  const openShareDialog = useCallback(() => {
    setShareCreatedId(null);
    setShareDialogOpen(true);
  }, []);

  const closeShareDialog = useCallback(() => {
    setShareDialogOpen(false);
    setShareCreatedId(null);
  }, []);

  const closeInfoDialog = useCallback(() => {
    setInfoDialog({ open: false, message: "" });
  }, []);

  const closeSoftGate = useCallback(() => {
    setSoftGateOpen(false);
    pendingShareRef.current = null;
  }, []);

  const requestShare = useCallback(async () => {
    const canonicalGraph = sanitizeGroupBundleVisualElementsForState({
      nodes: getNodes(),
      edges: getEdges(),
    });
    const payload = buildSharePayload(canonicalGraph.nodes, canonicalGraph.edges);

    try {
      const { id } = await shareFlow(payload);
      setShareDialogOpen(true);
      setShareCreatedId(id);
      return { id };
    } catch (err) {
      const error =
        typeof err === "object" && err !== null
          ? (err as { softGate?: boolean; message?: unknown })
          : undefined;

      if (error?.softGate || error?.message === "turnstile_required") {
        pendingShareRef.current = payload;
        setSoftGateOpen(true);
        throw err;
      }

      const message =
        typeof error?.message === "string" ? error.message : "Share failed";
      setInfoDialog({ open: true, message });
      throw err;
    }
  }, [getEdges, getNodes]);

  const verifyTurnstile = useCallback(
    async (token?: string) => {
      const payload = pendingShareRef.current;
      if (!payload) return;

      try {
        const { id } = await shareFlow(payload, token ? { turnstileToken: token } : undefined);
        pendingShareRef.current = null;
        setSoftGateOpen(false);
        setShareDialogOpen(true);
        setShareCreatedId(id);
        return { id };
      } catch (err) {
        const error =
          typeof err === "object" && err !== null
            ? (err as { softGate?: boolean; message?: unknown })
            : undefined;

        if (error?.softGate || error?.message === "turnstile_required") {
          setSoftGateOpen(true);
          return;
        }

        const message =
          typeof error?.message === "string" ? error.message : "Share failed";
        setInfoDialog({ open: true, message });
      }
    },
    []
  );

  return {
    shareDialogOpen,
    openShareDialog,
    closeShareDialog,
    shareCreatedId,
    requestShare,
    softGateOpen,
    closeSoftGate,
    verifyTurnstile,
    infoDialog,
    setInfoDialog,
    closeInfoDialog,
  } as const;
}
