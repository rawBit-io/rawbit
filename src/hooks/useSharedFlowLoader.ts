import { useEffect, useRef, useState } from "react";
import type {
  Edge,
  EdgeChange,
  NodeChange,
  ReactFlowInstance,
} from "@xyflow/react";
import type { FlowData, FlowNode } from "@/types";
import { getShareJsonUrl, loadShared } from "@/lib/share";
import { importWithFreshIds } from "@/lib/idUtils";
import { validateFlowData } from "@/lib/flow/validate";
import {
  ingestScriptSteps,
  restoreScriptSteps,
} from "@/lib/share/scriptStepsCache";
import {
  FLOW_SCHEMA_VERSION,
  MAX_FLOW_BYTES,
  formatBytes,
  measureFlowBytes,
} from "@/lib/flow/schema";
import type { SnapshotOptions } from "@/hooks/useSnapshotScheduler";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";
import {
  isFlowFileCandidate,
  isRecord,
  isXYPosition,
} from "@/lib/flow/guards";
const SHARE_ALT_LINK_ID = "rawbit-share-json-link";
type LoadedSharedFlow = Awaited<ReturnType<typeof loadShared>>;
const sharedLoadPromises = new Map<string, Promise<LoadedSharedFlow>>();

function loadSharedOnce(sharedId: string): Promise<LoadedSharedFlow> {
  const existing = sharedLoadPromises.get(sharedId);
  if (existing) return existing;

  const promise = loadShared(sharedId).finally(() => {
    if (sharedLoadPromises.get(sharedId) === promise) {
      sharedLoadPromises.delete(sharedId);
    }
  });
  sharedLoadPromises.set(sharedId, promise);
  return promise;
}

function readSharedIdFromLocation() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("s") || params.get("share");
}

function clearSharedIdFromLocation() {
  if (typeof window === "undefined") return;
  if (!window.location.search) return;

  const url = new URL(window.location.href);
  const hadSharedId = url.searchParams.has("s") || url.searchParams.has("share");
  if (!hadSharedId) return;

  url.searchParams.delete("s");
  url.searchParams.delete("share");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, document.title, nextUrl);
}

function formatSharedTabTitle(sharedId: string) {
  const suffix = sharedId
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `share_${suffix || sharedId}`;
}

function setAlternateShareJsonLink(href?: string) {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(
    SHARE_ALT_LINK_ID
  ) as HTMLLinkElement | null;

  if (!href) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  if (existing) {
    existing.href = href;
    return;
  }

  const link = document.createElement("link");
  link.id = SHARE_ALT_LINK_ID;
  link.rel = "alternate";
  link.type = "application/json";
  link.href = href;
  document.head.appendChild(link);
}

interface UseSharedFlowLoaderOptions {
  enabled?: boolean;
  getNodes: () => FlowNode[];
  getEdges: () => Edge[];
  fitView?: () => void;
  replaceGraph?: (graph: {
    nodes: FlowNode[];
    edges: Edge[];
    tabId?: string;
  }) => void;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  scheduleSnapshot: (label: string, options?: SnapshotOptions) => void;
  setTabTooltip: (tabId: string, tooltip: string) => void;
  renameTab: (
    tabId: string,
    title: string,
    options?: { onlyIfEmpty?: boolean }
  ) => void;
  activeTabId: string;
  setInfoDialog: (state: { open: boolean; message: string }) => void;
  flowInstanceRef: React.MutableRefObject<ReactFlowInstance | null>;
  ensureShareImportTab?: () => string | null | Promise<string | null>;
}

export function useSharedFlowLoader({
  enabled = true,
  getNodes,
  getEdges,
  fitView,
  replaceGraph,
  onNodesChange,
  onEdgesChange,
  scheduleSnapshot,
  setTabTooltip,
  renameTab,
  activeTabId,
  setInfoDialog,
  flowInstanceRef,
  ensureShareImportTab,
}: UseSharedFlowLoaderOptions) {
  const loadedSharedIdRef = useRef<string | null>(null);
  const loadingSharedIdRef = useRef<string | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  const latestOptionsRef = useRef({
    getNodes,
    getEdges,
    fitView,
    replaceGraph,
    onNodesChange,
    onEdgesChange,
    scheduleSnapshot,
    setTabTooltip,
    renameTab,
    setInfoDialog,
    flowInstanceRef,
    ensureShareImportTab,
  });
  const [sharedId, setSharedId] = useState(readSharedIdFromLocation);

  activeTabIdRef.current = activeTabId;
  latestOptionsRef.current = {
    getNodes,
    getEdges,
    fitView,
    replaceGraph,
    onNodesChange,
    onEdgesChange,
    scheduleSnapshot,
    setTabTooltip,
    renameTab,
    setInfoDialog,
    flowInstanceRef,
    ensureShareImportTab,
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncSharedId = () => {
      setSharedId(readSharedIdFromLocation());
    };

    window.addEventListener("popstate", syncSharedId);
    return () => {
      window.removeEventListener("popstate", syncSharedId);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    if (!sharedId) {
      setAlternateShareJsonLink();
      return;
    }

    const shareJsonUrl = getShareJsonUrl(sharedId);
    if (shareJsonUrl) {
      setAlternateShareJsonLink(shareJsonUrl);
    } else {
      setAlternateShareJsonLink();
    }

    if (loadedSharedIdRef.current === sharedId) return;
    if (loadingSharedIdRef.current === sharedId) return;

    loadingSharedIdRef.current = sharedId;
    let cancelled = false;

    (async () => {
      try {
        const data = await loadSharedOnce(sharedId);
        let options = latestOptionsRef.current;

        if (cancelled) return;

        try {
          const rawBytes = measureFlowBytes(JSON.stringify(data));
          if (rawBytes > MAX_FLOW_BYTES) {
            const message = `Shared flow is ${formatBytes(rawBytes)}, over the ${formatBytes(MAX_FLOW_BYTES)} limit.`;
            console.error(message);
            options.setInfoDialog({ open: true, message });
            return;
          }
        } catch (sizeErr) {
          console.warn("Failed to measure shared flow size", sizeErr);
        }

        if (!isFlowFileCandidate(data)) {
          options.setInfoDialog({
            open: true,
            message: "Shared flow payload is empty or unreadable.",
          });
          return;
        }

        const rawNodes = data.nodes;
        const rawEdges = data.edges;

        const looksSimplified =
          rawNodes.length > 0 &&
          rawNodes.every(
            (node) => !isRecord(node) || !isXYPosition(node.position)
          );
        if (looksSimplified) {
          options.setInfoDialog({
            open: true,
            message:
              "Shared flow is a simplified snapshot that omits layout data and can't be loaded; request a full export instead.",
          });
          return;
        }

        const parsedData: FlowData = {
          ...(data as FlowData),
          nodes: rawNodes as FlowNode[],
          edges: rawEdges as Edge[],
        };

        if (parsedData.schemaVersion === undefined) {
          parsedData.schemaVersion = FLOW_SCHEMA_VERSION;
        }

        const validation = validateFlowData(parsedData);
        if (!validation.ok) {
          const [firstError, ...restErrors] = validation.errors;
          const suffix =
            restErrors.length > 0
              ? ` (and ${restErrors.length} more issue${
                  restErrors.length === 1 ? "" : "s"
                })`
              : "";
          const message = firstError
            ? `${firstError.message}${suffix}`
            : "Shared flow failed validation.";
          console.error("Shared flow validation failed", validation.errors);
          options.setInfoDialog({
            open: true,
            message,
          });
          return;
        }

        if (validation.warnings.length) {
          console.warn("Shared flow validation warnings", validation.warnings);
        }

        const sharedNodes = stripLegacyFlowMapNodeData(parsedData.nodes);
        const sharedEdges = parsedData.edges;
        const shouldReplaceGraph = Boolean(options.replaceGraph);

        let targetTabId = activeTabIdRef.current;
        const initialNodes = options.getNodes();
        const initialEdges = options.getEdges();
        const hadContent = initialNodes.length > 0 || initialEdges.length > 0;

        if (hadContent && options.ensureShareImportTab) {
          const ensuredId = await options.ensureShareImportTab();
          if (!ensuredId) {
            options.setInfoDialog({
              open: true,
              message:
                "Could not open a new tab for the shared flow. Your current tab was left unchanged.",
            });
            return;
          }
          targetTabId = ensuredId;
          options = latestOptionsRef.current;
        }

        if (cancelled) return;

        const currentNodes = shouldReplaceGraph ? [] : options.getNodes();
        const currentEdges = shouldReplaceGraph ? [] : options.getEdges();
        const targetWasEmpty = shouldReplaceGraph
          ? true
          : currentNodes.length === 0 && currentEdges.length === 0;

        const {
          nodes: mergedNodes,
          edges: mergedEdges,
        } = importWithFreshIds<
          FlowNode,
          Edge
        >({
          currentNodes,
          currentEdges,
          importNodes: sharedNodes,
          importEdges: sharedEdges,
          dedupeEdges: true,
          renameMode: "collision",
        });

        if (shouldReplaceGraph) {
          restoreScriptSteps([]);
        }

        const sanitizedNodes = stripLegacyFlowMapNodeData(
          ingestScriptSteps(mergedNodes)
        );
        const importedNodeIds = new Set(sanitizedNodes.map((node) => node.id));
        const safeEdges = mergedEdges.filter(
          (edge) => importedNodeIds.has(edge.source) && importedNodeIds.has(edge.target)
        );

        const nextNodes = sanitizedNodes.map((node) => {
          const dragHandle =
            node.type === "shadcnGroup"
              ? node.dragHandle ?? "[data-drag-handle]"
              : node.dragHandle;

          return {
            ...node,
            selected: shouldReplaceGraph ? false : true,
            position: node.position ?? { x: 0, y: 0 },
            data: node.data ?? {},
            type: node.type ?? "calculation",
            ...(dragHandle && { dragHandle }),
          } as FlowNode;
        });

        const deselect = shouldReplaceGraph
          ? []
          : options.getNodes()
              .filter((node) => node.selected)
              .map((node) => ({
                type: "select" as const,
                id: node.id,
                selected: false,
              }));

        const addNodes = nextNodes.map((node) => {
          return {
            type: "add" as const,
            item: node,
          };
        });

        const nextEdges = safeEdges.map((edge) => ({ ...edge }));
        const addEdges = nextEdges.map((edge) => ({
          type: "add" as const,
          item: edge,
        }));

        if (cancelled) return;

        if (options.replaceGraph) {
          options.replaceGraph({
            nodes: nextNodes,
            edges: nextEdges,
            tabId: targetTabId ?? undefined,
          });
        } else {
          options.onNodesChange([...deselect, ...addNodes]);
          options.onEdgesChange(addEdges);
        }

        if (cancelled) return;

        options.scheduleSnapshot(`Imported shared flow ${sharedId}`, {
          refresh: true,
          tabId: targetTabId,
          state: {
            nodes: nextNodes,
            edges: nextEdges,
          },
        });

        if (cancelled) return;

        if (targetTabId) {
          options.setTabTooltip(targetTabId, `Shared: ${sharedId}`);
        }
        if (targetWasEmpty && targetTabId) {
          const desiredTitle = formatSharedTabTitle(sharedId);
          options.renameTab(targetTabId, desiredTitle, { onlyIfEmpty: true });
        }

        loadedSharedIdRef.current = sharedId;
        clearSharedIdFromLocation();
        setSharedId(null);
        setAlternateShareJsonLink();

        if (options.fitView) {
          options.fitView();
        } else {
          const instance = options.flowInstanceRef.current;
          if (instance) {
            requestAnimationFrame(() => {
              if (cancelled) return;
              instance.fitView({ padding: 0.2, maxZoom: 2, duration: 350 });
            });
          }
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          typeof err === "object" && err !== null && "message" in err &&
          typeof (err as { message?: unknown }).message === "string"
            ? (err as { message: string }).message
            : "unknown error";
        latestOptionsRef.current.setInfoDialog({
          open: true,
          message: `Could not load shared flow: ${message}`,
        });
      } finally {
        if (loadingSharedIdRef.current === sharedId) {
          loadingSharedIdRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
      if (loadingSharedIdRef.current === sharedId) {
        loadingSharedIdRef.current = null;
      }
      if (shareJsonUrl) {
        const existing = document.getElementById(
          SHARE_ALT_LINK_ID
        ) as HTMLLinkElement | null;
        if (existing && existing.href === shareJsonUrl) {
          existing.remove();
        }
      }
    };
  }, [
    enabled,
    sharedId,
  ]);
}
