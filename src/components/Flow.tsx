import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useStoreApi,
  useUpdateNodeInternals,
  type Edge,
  type OnInit,
  type ReactFlowInstance,
  type Viewport,
  type Node,
} from "@xyflow/react";

import CalculationNode from "@/components/nodes/CalculationNode";
import ShadcnGroupNode from "@/components/nodes/GroupNode";
import TextInfoNode from "@/components/nodes/TextInfoNode";
import OpCodeNode from "@/components/nodes/OpCodeNode";

import { TopBar } from "@/components/layout/TopBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { ColorPalette } from "@/components/ui/ColorPalette";
import { Button } from "@/components/ui/button";
import { FlowCanvas } from "@/components/FlowCanvas";
import { FlowDialogLayer } from "@/components/FlowDialogLayer";
import { FlowPanels } from "@/components/FlowPanels";
import { FirstRunDialog } from "@/components/dialog/FirstRunDialog";
import { Sun, Moon, Github } from "lucide-react";

import { useNodeOperations } from "@/hooks/useNodeOperations";
import { useFileOperations } from "@/hooks/useFileOperations";
import { useCopyPaste } from "@/hooks/useCopyPaste";

import { useGlobalCalculationLogic } from "@/hooks/useCalculation";
import { UndoRedoProvider } from "@/contexts/UndoRedoContext";
import { useUndoRedo } from "@/hooks/useUndoRedo";

import { cn } from "@/lib/utils";
import type {
  CalcError,
  CalcStatus,
  FlowData,
  FlowNode,
  ProtocolDiagramLayout,
} from "@/types";
import type { FlowValidationIssue } from "@/lib/flow/validate";
import { isCalculableNode } from "@/lib/flow/nonCalculableNodes";
import {
  ingestScriptSteps,
  restoreScriptSteps,
} from "@/lib/share/scriptStepsCache";

import { useLimitErrorRecovery } from "@/hooks/useLimitErrorRecovery";

import { useTheme } from "@/hooks/useTheme";

import { useTabs } from "@/hooks/useTabs";
import { useSnapshotScheduler } from "@/hooks/useSnapshotScheduler";
import { SnapshotProvider } from "@/contexts/SnapshotContext";
import { useAutoRefreshVersion } from "@/hooks/useAutoRefreshVersion";
import { FlowActionsProvider } from "@/contexts/FlowActionsContext";
import { useHighlight } from "@/hooks/useHighlight";
import { useFlowHotkeys } from "@/hooks/useFlowHotkeys";
import { useMiniMapSize } from "@/hooks/useMiniMapSize";
import { useConnectDialog } from "@/hooks/useConnectPorts";
import { useShareFlow } from "@/hooks/useShareFlow";
import { useColorPalette } from "@/hooks/useColorPalette";
import { customFlows } from "@/my_tx_flows/customFlows";
import { usePanelAutoClose } from "@/hooks/usePanelAutoClose";
import { useFlowInteractions } from "@/hooks/useFlowInteractions";
import { useSearchHighlights } from "@/hooks/useSearchHighlights";
import { useSharedFlowLoader } from "@/hooks/useSharedFlowLoader";
import { useSimplifiedSave } from "@/hooks/useSimplifiedSave";
import { shouldBlockMobile } from "@/lib/device";
import { buildProtocolDiagramModel } from "@/lib/protocolDiagram/buildProtocolDiagramModel";
import { getDefaultProtocolPanelWidth } from "@/lib/protocolDiagram/panelSizing";
import {
  collectGroupNodeIds,
  sanitizeProtocolDiagramLayout,
} from "@/lib/protocolDiagram/layoutPersistence";

const COLORABLE_NODE_TYPES = new Set([
  "calculation",
  "shadcnGroup",
  "shadcnTextInfo",
  "opCodeNode",
  "trezorAction",
]);

const nodeTypes = {
  calculation: CalculationNode,
  trezorAction: CalculationNode,
  shadcnGroup: ShadcnGroupNode,
  shadcnTextInfo: TextInfoNode,
  opCodeNode: OpCodeNode,
};

type TabCalculationState = {
  status: CalcStatus;
  errors: CalcError[];
};

type PendingSharedGraph = {
  tabId: string;
  nodes: FlowNode[];
  edges: Edge[];
  protocolDiagramLayout?: ProtocolDiagramLayout;
  expiresAt: number;
};

const DEFAULT_TAB_CALC_STATE: TabCalculationState = {
  status: "OK",
  errors: [],
};

const LIMIT_ERROR_PATTERNS = [
  /over the server limit/i,
  /timed out/i,
  /calculation requests are limited/i,
];

const FIRST_RUN_STORAGE_KEY = "rawbit.ui.welcomeSeen";
const TABS_STORAGE_KEYS = [
  "rawbit.flow.tabs",
  "rawbit.flow.tabs.archive",
] as const;
const EDGE_OPACITY_TUNER_ENABLED = false;
type EdgeDarkOpacity = {
  default: number;
  paper: number;
  midnight: number;
};
const EDGE_DARK_OPACITY_DEFAULTS = {
  default: 0.35,
  paper: 0.25,
  midnight: 0.25,
};
const EDGE_LIGHT_OPACITY_DEFAULTS = {
  default: 0.55,
  paper: 0.6,
  midnight: 0.6,
};
const SHARED_IMPORT_FIT_MIN_ZOOM = 0.2;

function graphIdsMatch(
  currentNodes: FlowNode[],
  currentEdges: Edge[],
  expectedNodes: FlowNode[],
  expectedEdges: Edge[]
) {
  if (
    currentNodes.length !== expectedNodes.length ||
    currentEdges.length !== expectedEdges.length
  ) {
    return false;
  }

  for (let index = 0; index < expectedNodes.length; index += 1) {
    if (currentNodes[index]?.id !== expectedNodes[index]?.id) return false;
  }
  for (let index = 0; index < expectedEdges.length; index += 1) {
    if (currentEdges[index]?.id !== expectedEdges[index]?.id) return false;
  }
  return true;
}

function edgeIdsMatch(currentEdges: Edge[], expectedEdges: Edge[]) {
  if (currentEdges.length !== expectedEdges.length) return false;
  for (let index = 0; index < expectedEdges.length; index += 1) {
    if (currentEdges[index]?.id !== expectedEdges[index]?.id) return false;
  }
  return true;
}

function nodesNeedMeasurement(nodesToInspect: FlowNode[]) {
  return nodesToInspect.some((node) => {
    const measured = node.measured;
    return (
      typeof measured?.width !== "number" ||
      typeof measured?.height !== "number" ||
      measured.width <= 0 ||
      measured.height <= 0
    );
  });
}

function cloneEdgesForRender(edgesToClone: Edge[]) {
  return edgesToClone.map((edge) => ({
    ...edge,
    ...(edge.data ? { data: { ...edge.data } } : {}),
  }));
}

function isAutomationEnvironment() {
  if (typeof navigator !== "undefined" && navigator.webdriver) {
    return true;
  }
  if (typeof window !== "undefined") {
    const win = window as typeof window & {
      Cypress?: unknown;
      __PW_TESTING__?: unknown;
      __PLAYWRIGHT__?: unknown;
    };
    if (win.Cypress || win.__PW_TESTING__ || win.__PLAYWRIGHT__) {
      return true;
    }
  }
  return false;
}

function cloneFlowData(data: FlowData): FlowData {
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(data) as FlowData;
    }
  } catch {
    /* structuredClone not available; fall back to JSON copy */
  }
  return JSON.parse(JSON.stringify(data)) as FlowData;
}

function FlowContent() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showUndoRedoPanel, setShowUndoRedoPanel] = useState(false);
  const [showErrorPanel, setShowErrorPanel] = useState(false);

  // 🔍 search-panel state
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [showProtocolDiagramPanel, setShowProtocolDiagramPanel] = useState(false);
  const [protocolDiagramLayout, setProtocolDiagramLayout] = useState<
    ProtocolDiagramLayout | undefined
  >(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);

  const [calcStateByTab, setCalcStateByTab] = useState<
    Record<string, TabCalculationState>
  >({});
  const [connectOpen, setConnectOpen] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [isSelectionLocked, setIsSelectionLocked] = useState(false);
  const [isSelectionHotKeyActive, setIsSelectionHotKeyActive] = useState(false);
  const [isMobileBlocked, setIsMobileBlocked] = useState(false);
  const isMobileReadOnly = isMobileBlocked;
  const isSelectionMode = isSelectionLocked || isSelectionHotKeyActive;
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const loadingUndoRef = useRef(false);
  const isPastingRef = useRef(false);
  const welcomeCompleteRef = useRef(false);
  const pendingExampleFitRef = useRef(false);
  const pendingFitOptionsRef = useRef<{
    minZoom?: number;
    settle?: boolean;
  }>({});
  const exampleFitRetryTimeoutIdsRef = useRef<number[]>([]);
  const graphRev = useRef(0); // monotonically-increasing revision counter
  const [revTick, setRevTick] = useState(0);
  const incrementGraphRev = useCallback(() => {
    graphRev.current += 1;
    setRevTick(graphRev.current);
    return graphRev.current;
  }, []);
  const { theme, setTheme } = useTheme(); // "light" | "dark" | "system"
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [showEdgeOpacityTuner, setShowEdgeOpacityTuner] = useState(true);
  const [edgeDarkOpacity, setEdgeDarkOpacity] = useState<EdgeDarkOpacity>({
    default: EDGE_DARK_OPACITY_DEFAULTS.default,
    paper: EDGE_DARK_OPACITY_DEFAULTS.paper,
    midnight: EDGE_DARK_OPACITY_DEFAULTS.midnight,
  });
  const [edgeLightOpacity, setEdgeLightOpacity] = useState<EdgeDarkOpacity>({
    default: EDGE_LIGHT_OPACITY_DEFAULTS.default,
    paper: EDGE_LIGHT_OPACITY_DEFAULTS.paper,
    midnight: EDGE_LIGHT_OPACITY_DEFAULTS.midnight,
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty(
      "--edge-dark-opacity-default",
      String(edgeDarkOpacity.default)
    );
    root.style.setProperty(
      "--edge-dark-opacity-paper",
      String(edgeDarkOpacity.paper)
    );
    root.style.setProperty(
      "--edge-dark-opacity-midnight",
      String(edgeDarkOpacity.midnight)
    );
    root.style.setProperty(
      "--edge-light-opacity-default",
      String(edgeLightOpacity.default)
    );
    root.style.setProperty(
      "--edge-light-opacity-paper",
      String(edgeLightOpacity.paper)
    );
    root.style.setProperty(
      "--edge-light-opacity-midnight",
      String(edgeLightOpacity.midnight)
    );
  }, [edgeDarkOpacity, edgeLightOpacity]);

  const exampleFlowMap = useMemo(
    () => new Map(customFlows.map((flow) => [flow.id, flow])),
    []
  );
  const exampleFlowOptions = useMemo(
    () => customFlows.map((flow) => ({ id: flow.id, label: flow.label })),
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    type ExtendedNavigator = Navigator & {
      userAgentData?: { mobile?: boolean };
    };
    const nav: ExtendedNavigator | undefined =
      typeof window.navigator !== "undefined"
        ? (window.navigator as ExtendedNavigator)
        : undefined;

    const hasCoarsePointer = () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;

    const updateMobileBlock = () => {
      setIsMobileBlocked(
        shouldBlockMobile({
          width: window.innerWidth,
          coarsePointer: hasCoarsePointer(),
          userAgent: nav?.userAgent,
          userAgentDataMobile: nav?.userAgentData?.mobile,
        })
      );
    };

    updateMobileBlock();
    window.addEventListener("resize", updateMobileBlock);
    return () => window.removeEventListener("resize", updateMobileBlock);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (welcomeCompleteRef.current) return;
    try {
      if (window.localStorage.getItem(FIRST_RUN_STORAGE_KEY)) {
        welcomeCompleteRef.current = true;
        return;
      }

      const hasExistingData = TABS_STORAGE_KEYS.some((key) =>
        Boolean(window.localStorage.getItem(key))
      );
      if (hasExistingData) {
        window.localStorage.setItem(FIRST_RUN_STORAGE_KEY, "1");
        welcomeCompleteRef.current = true;
        return;
      }

      if (isAutomationEnvironment()) {
        window.localStorage.setItem(FIRST_RUN_STORAGE_KEY, "1");
        welcomeCompleteRef.current = true;
        return;
      }
    } catch {
      /* localStorage unavailable; show dialog as fallback */
      if (isAutomationEnvironment()) {
        welcomeCompleteRef.current = true;
        return;
      }
    }

    setShowWelcomeDialog(true);
  }, []);

  const markWelcomeComplete = useCallback(() => {
    if (welcomeCompleteRef.current) return;
    welcomeCompleteRef.current = true;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(FIRST_RUN_STORAGE_KEY, "1");
    } catch {
      /* ignore storage write failures */
    }
  }, []);

  const RHS_PANEL_W = 256; // default right panels (=16rem)
  const MM_GAP = 44.8; // 2.8 rem  (space beside controls)

  // Track dynamic protocol panel width
  const [protocolPanelWidth, setProtocolPanelWidth] = useState(() =>
    getDefaultProtocolPanelWidth()
  );

  const showUndoRedoPanelUI = isMobileReadOnly ? false : showUndoRedoPanel;
  const showErrorPanelUI = isMobileReadOnly ? false : showErrorPanel;
  const showSearchPanelUI = isMobileReadOnly ? false : showSearchPanel;
  const showProtocolDiagramPanelUI = isMobileReadOnly
    ? false
    : showProtocolDiagramPanel;
  let rightPanelWidth = 0;
  if (showProtocolDiagramPanelUI) {
    rightPanelWidth = protocolPanelWidth; // Use dynamic width
  } else if (showUndoRedoPanelUI || showErrorPanelUI || showSearchPanelUI) {
    rightPanelWidth = RHS_PANEL_W;
  }
  const rightPanelOpen = rightPanelWidth > 0;
  const miniMapOffset = rightPanelOpen ? rightPanelWidth + MM_GAP : MM_GAP;

  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const [hasFitOnInitialLoad, setHasFitOnInitialLoad] = useState(false);
  const [isFlowVisible, setIsFlowVisible] = useState(false);

  // MiniMap sizing (keep one side fixed; compute the other from graph AR)
  const MINIMAP_LONG = 170; // longest side of the minimap
  const MINIMAP_SHORT_MIN = 90; // floor so it never gets too skinny
  const {
    nodes,
    setNodes: baseSetNodes,
    edges,
    setEdges: baseSetEdges,
    onNodesChange: rawOnNodesChange,
    onEdgesChange: rawOnEdgesChange,
    onConnect,
    onDragOver,
    onDrop,
    onNodeDragStop,
    onInit: rawOnInit,
    groupSelectedNodes,
    ungroupSelectedNodes,
    canGroupSelectedNodes,
    canUngroupSelectedNodes,
  } = useNodeOperations({
    getProtocolDiagramLayout: () => protocolDiagramLayout,
    setProtocolDiagramLayout,
  });
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const getSavedNodes = useCallback(() => nodesRef.current, []);
  const getSavedEdges = useCallback(() => edgesRef.current, []);

  const protocolDiagramModel = useMemo(
    () => buildProtocolDiagramModel({ nodes, edges }),
    [nodes, edges]
  );
  const hasProtocolDiagram = protocolDiagramModel.hasGroups;

  const handleProtocolDiagramOffsetsChange = useCallback(
    (groupOffsets: NonNullable<ProtocolDiagramLayout["groupOffsets"]>) => {
      const groupIds = collectGroupNodeIds(nodes);
      const nextLayout = sanitizeProtocolDiagramLayout(
        { groupOffsets },
        groupIds
      );
      setProtocolDiagramLayout(nextLayout);
    },
    [nodes]
  );

  const {
    copyNodes,
    pasteNodes,
    handleMouseMove,
    getTopLeftPosition,
    hasCopiedNodes,
  } = useCopyPaste();
  const {
    pushState,
    history,
    pointer,
    undo,
    redo,
    canUndo,
    canRedo,
    setActiveTab,
    initializeTabHistory,
    removeTabHistory,
  } = useUndoRedo();
  const {
    getNodes,
    getEdges,
    setNodes: rfSetNodes,
    setEdges: rfSetEdges,
  } = useReactFlow<FlowNode>();
  const storeApi = useStoreApi<FlowNode>();
  const updateNodeInternals = useUpdateNodeInternals();
  const hasCopiedNodesRef = useRef(hasCopiedNodes);
  useEffect(() => {
    hasCopiedNodesRef.current = hasCopiedNodes;
  }, [hasCopiedNodes]);

  const canUndoRef = useRef(canUndo);
  useEffect(() => {
    canUndoRef.current = canUndo;
  }, [canUndo]);

  const canRedoRef = useRef(canRedo);
  useEffect(() => {
    canRedoRef.current = canRedo;
  }, [canRedo]);

  // keyboard listeners moved below once all escape targets are declared

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.dataset.flowSelectionMode = isSelectionMode
      ? "true"
      : "false";
    return () => {
      delete document.body.dataset.flowSelectionMode;
    };
  }, [isSelectionMode]);

  const canGroupSelectedRef = useRef(canGroupSelectedNodes);
  useEffect(() => {
    canGroupSelectedRef.current = canGroupSelectedNodes;
  }, [canGroupSelectedNodes]);

  const canUngroupSelectedRef = useRef(canUngroupSelectedNodes);
  useEffect(() => {
    canUngroupSelectedRef.current = canUngroupSelectedNodes;
  }, [canUngroupSelectedNodes]);

  const paletteOpenRef = useRef(false);

  const copyNodesRef = useRef(copyNodes);
  useEffect(() => {
    copyNodesRef.current = copyNodes;
  }, [copyNodes]);

  const pasteNodesRef = useRef<((withOffset?: boolean) => void) | null>(null);

  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);

  const redoRef = useRef(redo);
  useEffect(() => {
    redoRef.current = redo;
  }, [redo]);

  const incRev = useCallback(() => incrementGraphRev(), [incrementGraphRev]);

  const setNodes: typeof baseSetNodes = useCallback(
    (updater) =>
      baseSetNodes((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (prev: FlowNode[]) => FlowNode[])(prev)
            : updater;
        if (next !== prev) incRev();
        return next;
      }),
    [baseSetNodes, incRev]
  );

  const setEdges: typeof baseSetEdges = useCallback(
    (updater) =>
      baseSetEdges((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (prev: Edge[]) => Edge[])(prev)
            : updater;
        if (next !== prev) incRev();
        return next;
      }),
    [baseSetEdges, incRev]
  );

  useEffect(() => {
    if (!isSelectionMode) return;
    const store = storeApi.getState();
    const selectedEdges = store.edges.filter((edge) => edge.selected);
    if (!selectedEdges.length) return;

    store.resetSelectedElements?.();
    store.unselectNodesAndEdges?.({ nodes: [], edges: selectedEdges });

    setEdges((currentEdges) => {
      let mutated = false;
      const next = currentEdges.map((edge) => {
        if (!edge.selected) return edge;
        mutated = true;
        return { ...edge, selected: false };
      });
      return mutated ? next : currentEdges;
    });
  }, [isSelectionMode, setEdges, storeApi]);

  const groupWithUndoRef = useRef<(() => void) | null>(null);
  const ungroupWithUndoRef = useRef<(() => void) | null>(null);
  const hasSelection = useStore((s) => s.nodes.some((n) => n.selected));
  const hasSelectionRef = useRef(hasSelection);
  const canvasSelectedEdgeIds = useStore(
    useCallback(
      (s: { edges: Edge[] }) => s.edges.filter((e) => e.selected).map((e) => e.id),
      []
    ),
    (a, b) => a.length === b.length && a.every((id, i) => id === b[i])
  );
  useEffect(() => {
    hasSelectionRef.current = hasSelection;
  }, [hasSelection]);
  const bannerFrameRef = useRef<number | null>(null);
  const pendingBannerNodesRef = useRef<FlowNode[] | null>(null);
  const pendingBannerTabRef = useRef<string | null>(null);
  const pendingSaveFrameRef = useRef<number | null>(null);
  const pendingSaveTimeoutRef = useRef<number | null>(null);
  const pendingSharedGraphRef = useRef<PendingSharedGraph | null>(null);
  const sharedGraphRepairTimeoutsRef = useRef<number[]>([]);

  const clearSharedGraphRepairTimers = useCallback(() => {
    if (typeof window === "undefined") return;
    for (const timeoutId of sharedGraphRepairTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    sharedGraphRepairTimeoutsRef.current = [];
  }, []);

  const applyCalculationState = useCallback(
    (
      status: CalcStatus,
      errors: CalcError[] = [],
      tabId?: string,
      options?: { source?: "banner" | "calculation"; sticky?: boolean }
    ) => {
      const targetTabId = tabId ?? activeTabIdRef.current;
      if (!targetTabId) return;

      setCalcStateByTab((prev) => {
        const prevEntry = prev[targetTabId];
        if (
          options?.source === "banner" &&
          options?.sticky !== false &&
          status === "OK" &&
          errors.length === 0 &&
          prevEntry?.status === "ERROR"
        ) {
          return prev;
        }
        const sameErrors =
          prevEntry?.errors.length === errors.length &&
          prevEntry?.errors.every((prevErr, index) => {
            const nextErr = errors[index];
            return (
              prevErr?.nodeId === nextErr?.nodeId &&
              prevErr?.error === nextErr?.error
            );
          });

        if (prevEntry && prevEntry.status === status && sameErrors) {
          return prev;
        }

        return {
          ...prev,
          [targetTabId]: {
            status,
            errors,
          },
        };
      });
    },
    []
  );

  const refreshBanner = useCallback(
    (
      nodesToInspect: FlowNode[],
      tabId?: string,
      options?: { sticky?: boolean; immediate?: boolean }
    ) => {
      const compute = (snapshot: FlowNode[], targetTab: string | null) => {
        if (!snapshot || !targetTab) return;
        const relevantNodes = snapshot.filter(isCalculableNode);
        const dirty = relevantNodes.some((n) => n.data?.dirty);
        const errorNodes = relevantNodes.filter((n) => n.data?.error);
        const status: CalcStatus = dirty
          ? "CALC"
          : errorNodes.length
          ? "ERROR"
          : "OK";
        const errors = errorNodes.map((n) => ({
          nodeId: n.id,
          error: n.data?.extendedError || "Unknown error",
        }));

        applyCalculationState(status, errors, targetTab, {
          source: "banner",
          sticky: options?.sticky,
        });
      };

      if (options?.immediate) {
        compute(nodesToInspect, tabId ?? activeTabIdRef.current ?? null);
        return;
      }

      pendingBannerNodesRef.current = nodesToInspect;
      pendingBannerTabRef.current = tabId ?? activeTabIdRef.current;
      if (bannerFrameRef.current !== null) return;

      bannerFrameRef.current = requestAnimationFrame(() => {
        bannerFrameRef.current = null;
        const snapshot = pendingBannerNodesRef.current;
        const targetTab = pendingBannerTabRef.current ?? activeTabIdRef.current;
        pendingBannerNodesRef.current = null;
        pendingBannerTabRef.current = null;
        compute(snapshot ?? [], targetTab ?? null);
      });
    },
    [applyCalculationState]
  );

  useEffect(() => {
    return () => {
      if (bannerFrameRef.current !== null) {
        cancelAnimationFrame(bannerFrameRef.current);
      }
    };
  }, []);
  const {
    tabs,
    activeTabId,
    skipLoadRef,
    initialHydrationDone,
    closeDialog,
    selectTab,
    addTab,
    requestCloseTab,
    confirmCloseTab,
    cancelCloseTab,
    closeAllTabs,
    closeOtherTabs,
    setTabTransform,
    setTabTooltip,
    renameTab,
    saveTabData,
  } = useTabs({
    getNodes: getSavedNodes,
    getEdges: getSavedEdges,
    getProtocolDiagramLayout: () => protocolDiagramLayout,
    setProtocolDiagramLayout,
    baseSetNodes,
    baseSetEdges,
    graphRevRef: graphRev,
    refreshBanner,
    getFlowInstance: () => flowInstanceRef.current,
    initializeTabHistory,
    setActiveTabCtx: setActiveTab,
    removeTabHistory,
  });

  const reapplyPendingSharedGraph = useCallback(() => {
    const pending = pendingSharedGraphRef.current;
    if (!pending) return;
    if (Date.now() > pending.expiresAt) {
      pendingSharedGraphRef.current = null;
      return;
    }

    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const parentMatches = graphIdsMatch(
      currentNodes,
      currentEdges,
      pending.nodes,
      pending.edges
    );

    // The React Flow internal store can lag behind parent state — most often
    // when a Safari layout pass splits the ResizeObserver batch and leaves
    // nodes unmeasured, which makes EdgeWrapper render null for every edge.
    // If parent state is correct but the store is missing nodes/edges, force-
    // sync the store and re-trigger node measurement instead of bailing out.
    const storeState = storeApi.getState();
    const storeNodes = storeState.nodes as FlowNode[];
    const storeEdges = storeState.edges;
    const storeNodesStale =
      storeNodes.length !== pending.nodes.length ||
      !storeNodes.every((node, index) => node.id === pending.nodes[index]?.id);
    const storeEdgesStale = !edgeIdsMatch(storeEdges, pending.edges);
    const storeNeedsResync = storeNodesStale || storeEdgesStale;

    if (parentMatches && !storeNeedsResync) {
      pendingSharedGraphRef.current = null;
      return;
    }

    if (!parentMatches) {
      setNodes(() => pending.nodes);
      setEdges(() => cloneEdgesForRender(pending.edges));
      setProtocolDiagramLayout(pending.protocolDiagramLayout);
      saveTabData(pending.tabId, {
        force: true,
        immediate: true,
        data: {
          nodes: pending.nodes,
          edges: pending.edges,
          protocolDiagramLayout: pending.protocolDiagramLayout,
        },
      });
    }

    if (storeNeedsResync) {
      if (storeNodesStale) {
        rfSetNodes(pending.nodes);
      }
      if (storeEdgesStale) {
        rfSetEdges(cloneEdgesForRender(pending.edges));
      }
      const ids = pending.nodes.map((node) => node.id);
      if (ids.length > 0) updateNodeInternals(ids);
    }
  }, [
    rfSetEdges,
    rfSetNodes,
    saveTabData,
    setEdges,
    setNodes,
    setProtocolDiagramLayout,
    storeApi,
    updateNodeInternals,
  ]);

  const saveTabDataGuardingSharedImport = useCallback(
    (tabId: string) => {
      const pending = pendingSharedGraphRef.current;
      if (pending?.tabId === tabId) {
        reapplyPendingSharedGraph();
        if (pendingSharedGraphRef.current?.tabId === tabId) {
          return;
        }
      }
      saveTabData(tabId);
    },
    [reapplyPendingSharedGraph, saveTabData]
  );

  const scheduleSharedEdgeRenderRefresh = useCallback(
    (tabId: string, expectedNodes: FlowNode[], expectedEdges: Edge[]) => {
      if (typeof window === "undefined" || expectedEdges.length === 0) return;

      const refreshEdges = () => {
        if (activeTabIdRef.current !== tabId) return;

        // First, repair the React Flow internal store if it's behind parent
        // state — this is the actual failure mode for the Safari edge bug.
        const storeState = storeApi.getState();
        const storeNodes = storeState.nodes as FlowNode[];
        const storeEdges = storeState.edges;
        const storeNodesStale =
          storeNodes.length !== expectedNodes.length ||
          !storeNodes.every(
            (node, index) => node.id === expectedNodes[index]?.id
          );
        const storeEdgesStale = !edgeIdsMatch(storeEdges, expectedEdges);
        const storeNodesUnmeasured =
          storeNodes.length === expectedNodes.length &&
          nodesNeedMeasurement(storeNodes);
        const storeNeedsRepair =
          storeNodesStale || storeEdgesStale || storeNodesUnmeasured;
        if (!storeNeedsRepair) return;

        if (storeNodesStale) {
          rfSetNodes(expectedNodes);
        }
        if (storeEdgesStale) {
          rfSetEdges(cloneEdgesForRender(expectedEdges));
        }
        if (storeNodesStale || storeNodesUnmeasured) {
          const ids = expectedNodes.map((node) => node.id);
          if (ids.length > 0) updateNodeInternals(ids);
        }

        // Then re-clone parent edges to nudge the controlled prop sync once
        // more (preserves the original render-refresh behaviour).
        setEdges((currentEdges) => {
          if (!edgeIdsMatch(currentEdges, expectedEdges)) {
            return currentEdges;
          }
          return cloneEdgesForRender(currentEdges);
        });
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(refreshEdges);
      });

      for (const delay of [80, 180, 360, 700, 1200, 2000]) {
        const timeoutId = window.setTimeout(refreshEdges, delay);
        sharedGraphRepairTimeoutsRef.current.push(timeoutId);
      }
    },
    [rfSetEdges, rfSetNodes, setEdges, storeApi, updateNodeInternals]
  );

  useAutoRefreshVersion({
    tabs,
    saveTabData: saveTabDataGuardingSharedImport,
    disableVersionPolling: import.meta.env.MODE === "test",
  });

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const ensureShareImportTab = useCallback(async () => {
    const newId = addTab();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    if (activeTabIdRef.current !== newId) {
      selectTab(newId);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
    return newId;
  }, [addTab, selectTab]);

  const activeCalcState = calcStateByTab[activeTabId] ?? DEFAULT_TAB_CALC_STATE;
  const calcStatus = activeCalcState.status;
  const errorInfo = activeCalcState.errors;
  const hasLimitErrors = useMemo(
    () =>
      errorInfo.some((entry) =>
        LIMIT_ERROR_PATTERNS.some((pattern) => pattern.test(entry.error ?? ""))
      ),
    [errorInfo]
  );

  const getCalcSnapshot = useCallback(
    () => ({
      status: calcStatus,
      errors: errorInfo,
    }),
    [calcStatus, errorInfo]
  );

  useEffect(() => {
    const tabId = activeTabIdRef.current ?? activeTabId;
    if (!tabId) return;
    setCalcStateByTab((prev) => {
      const entry = prev[tabId];
      if (!entry || entry.status === "CALC") return prev;

      const existingIds = new Set(nodes.map((node) => node.id));
      const filteredErrors = entry.errors.filter((err) =>
        existingIds.has(err.nodeId)
      );

      if (filteredErrors.length === entry.errors.length) return prev;

      const nextErrors = filteredErrors;
      const hadErrorBefore = entry.status === "ERROR";
      const nextStatus = nextErrors.length
        ? "ERROR"
        : hadErrorBefore
        ? "ERROR"
        : "OK";
      return {
        ...prev,
        [tabId]: {
          status: nextStatus,
          errors: nextErrors,
        },
      };
    });
  }, [nodes, activeTabId, setCalcStateByTab]);

  const snapshotScheduler = useSnapshotScheduler({
    storeApi,
    pushState,
    incrementGraphRev,
    skipLoadRef,
    refreshBanner,
    autoAfterCalc: {
      calcStatus,
      loadingUndoRef,
    },
    getCalcSnapshot,
  });

  const {
    pushCleanState,
    scheduleSnapshot,
    pendingSnapshotRef,
    skipNextEdgeSnapshotRef,
    skipNextNodeRemovalRef,
    markPendingAfterDirtyChange,
    releaseEdgeSnapshotSkip,
    releaseNodeRemovalSnapshotSkip,
  } = snapshotScheduler;

  const clearExampleFitRetryTimers = useCallback(() => {
    if (typeof window === "undefined") return;
    if (exampleFitRetryTimeoutIdsRef.current.length === 0) return;
    for (const timeoutId of exampleFitRetryTimeoutIdsRef.current) {
      window.clearTimeout(timeoutId);
    }
    exampleFitRetryTimeoutIdsRef.current = [];
  }, []);

  const fitCurrentGraphIntoView = useCallback(
    (options?: { allowEmpty?: boolean; minZoom?: number }) => {
      const instance = flowInstanceRef.current;
      if (!instance) return false;
      const hasGraph = getNodes().length > 0 || getEdges().length > 0;
      if (!hasGraph && !options?.allowEmpty) return false;
      instance.fitView({
        padding: 0.2,
        minZoom: options?.minZoom,
        maxZoom: 2,
        duration: 350,
      });
      return hasGraph;
    },
    [getEdges, getNodes]
  );

  const scheduleExampleFlowFit = useCallback(
    (options?: { minZoom?: number; settle?: boolean }) => {
      if (typeof window === "undefined") return;

      clearExampleFitRetryTimers();
      pendingExampleFitRef.current = true;
      pendingFitOptionsRef.current = options ?? {};
      const retryDelays = [0, 24, 72, 140, 240, 380, 560, 800];

      retryDelays.forEach((delay, index) => {
        const timeoutId = window.setTimeout(() => {
          if (!pendingExampleFitRef.current) return;

          const fittedWithGraph = fitCurrentGraphIntoView({
            allowEmpty: index === 0,
            minZoom: options?.minZoom,
          });
          if (fittedWithGraph && !options?.settle) {
            pendingExampleFitRef.current = false;
            pendingFitOptionsRef.current = {};
            clearExampleFitRetryTimers();
            return;
          }

          if (index === retryDelays.length - 1) {
            pendingExampleFitRef.current = false;
            pendingFitOptionsRef.current = {};
            clearExampleFitRetryTimers();
          }
        }, delay);
        exampleFitRetryTimeoutIdsRef.current.push(timeoutId);
      });
    },
    [clearExampleFitRetryTimers, fitCurrentGraphIntoView]
  );

  const resetToEmptyCanvas = useCallback(() => {
    restoreScriptSteps([]);
    setNodes(() => []);
    setEdges(() => []);
    setProtocolDiagramLayout(undefined);

    refreshBanner([], activeTabId, {
      immediate: true,
      sticky: false,
    });

    scheduleSnapshot("Start empty canvas", { refresh: true });
    if (activeTabId) {
      setTabTooltip(activeTabId, "Empty canvas");
    }
  }, [
    activeTabId,
    refreshBanner,
    scheduleSnapshot,
    setEdges,
    setNodes,
    setProtocolDiagramLayout,
    setTabTooltip,
  ]);

  const loadExampleFlow = useCallback(
    (flowId: string) => {
      const entry = exampleFlowMap.get(flowId);
      if (!entry) return false;

      const clonedData = cloneFlowData(entry.data);
      const nodesFromFlow = Array.isArray(clonedData.nodes)
        ? clonedData.nodes
        : [];
      const edgesFromFlow = Array.isArray(clonedData.edges)
        ? clonedData.edges
        : [];

      restoreScriptSteps([]);

      const normalizedNodes = ingestScriptSteps(
        nodesFromFlow.map((node) => {
          const base: FlowNode & { dragHandle?: string } = {
            ...node,
            data: node.data ? { ...node.data } : node.data,
            position: node.position
              ? { x: node.position.x, y: node.position.y }
              : node.position,
            selected: false,
          };
          if (base.type === "shadcnGroup" && !base.dragHandle) {
            base.dragHandle = "[data-drag-handle]";
          }
          return base;
        })
      );

      const normalizedEdges = edgesFromFlow.map((edge) => ({
        ...edge,
      })) as Edge[];
      const groupIds = collectGroupNodeIds(normalizedNodes);
      const normalizedLayout = sanitizeProtocolDiagramLayout(
        clonedData.protocolDiagramLayout,
        groupIds
      );

      setNodes(() => normalizedNodes);
      setEdges(() => normalizedEdges);
      setProtocolDiagramLayout(normalizedLayout);

      refreshBanner(normalizedNodes, activeTabId, {
        immediate: true,
        sticky: false,
      });

      scheduleSnapshot(`Load example: ${entry.label}`, { refresh: true });
      if (activeTabId) {
        setTabTooltip(
          activeTabId,
          entry.label ? `Example: ${entry.label}` : "Example flow"
        );
      }

      scheduleExampleFlowFit();

      return true;
    },
    [
      activeTabId,
      exampleFlowMap,
      refreshBanner,
      scheduleExampleFlowFit,
      scheduleSnapshot,
      setEdges,
      setNodes,
      setProtocolDiagramLayout,
      setTabTooltip,
    ]
  );

  const handleWelcomeStartEmpty = useCallback(() => {
    setShowWelcomeDialog(false);
    resetToEmptyCanvas();
    markWelcomeComplete();
  }, [markWelcomeComplete, resetToEmptyCanvas, setShowWelcomeDialog]);

  const handleWelcomeLoadExample = useCallback(
    (flowId: string) => {
      setShowWelcomeDialog(false);
      const loaded = loadExampleFlow(flowId);
      if (loaded) {
        markWelcomeComplete();
      } else {
        setShowWelcomeDialog(true);
      }
    },
    [loadExampleFlow, markWelcomeComplete, setShowWelcomeDialog]
  );

  const [, { setIsSearchHighlight, clearHighlights }] = useHighlight({
    setNodes,
    baseSetNodes,
    getNodes,
    getFlowInstance: () => flowInstanceRef.current,
    hasNodeSelectionRef: hasSelectionRef,
  });

  const {
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
  } = useShareFlow({
    getNodes: getSavedNodes,
    getEdges: getSavedEdges,
    getProtocolDiagramLayout: () => protocolDiagramLayout,
  });

  const isNodeColorable = useCallback(
    (node: FlowNode) => COLORABLE_NODE_TYPES.has(node.type as string),
    []
  );

  const {
    isOpen: isColorPaletteOpen,
    position: colorPalettePosition,
    canApply: canColorSelection,
    open: openPalette,
    close: closePalette,
    apply: applyPaletteColor,
    updateEligibility: updatePaletteEligibility,
  } = useColorPalette({
    getNodes,
    setNodes,
    scheduleSnapshot,
    isSidebarOpen,
    tabsCount: tabs.length,
    isColorable: isNodeColorable,
  });

  useEffect(() => {
    paletteOpenRef.current = isColorPaletteOpen;
  }, [isColorPaletteOpen]);

  const fitImportedFlow = useCallback(() => {
    const instance = flowInstanceRef.current;
    if (!instance) return;
    const runFit = () => {
      instance.fitView({ padding: 0.2, maxZoom: 2, duration: 350 });
    };
    // Use a double rAF so the React Flow store has applied imported nodes/edges.
    requestAnimationFrame(() => requestAnimationFrame(runFit));
  }, []);

  const fitSharedImportedFlow = useCallback(() => {
    // Shared-flow loading can race tab creation and React Flow/WebKit edge
    // culling. Keep fitting briefly, but avoid subpixel zoom levels where
    // Safari can decide all edge paths are outside the visible set.
    scheduleExampleFlowFit({
      minZoom: SHARED_IMPORT_FIT_MIN_ZOOM,
      settle: true,
    });
  }, [scheduleExampleFlowFit]);

  const replaceSharedGraph = useCallback(
    ({
      nodes: nextNodes,
      edges: nextEdges,
      protocolDiagramLayout: nextLayout,
      tabId,
    }: {
      nodes: FlowNode[];
      edges: Edge[];
      protocolDiagramLayout?: ProtocolDiagramLayout;
      tabId?: string;
    }) => {
      const targetTabId = tabId ?? activeTabIdRef.current ?? activeTabId;

      setNodes(() => nextNodes);
      setEdges(() => cloneEdgesForRender(nextEdges));
      setProtocolDiagramLayout(nextLayout);

      pendingSharedGraphRef.current = {
        tabId: targetTabId,
        nodes: nextNodes,
        edges: nextEdges,
        protocolDiagramLayout: nextLayout,
        expiresAt: Date.now() + 5_000,
      };
      clearSharedGraphRepairTimers();

      saveTabData(targetTabId, {
        force: true,
        immediate: true,
        data: {
          nodes: nextNodes,
          edges: nextEdges,
          protocolDiagramLayout: nextLayout,
        },
      });

      if (typeof window !== "undefined") {
        // Force React Flow to re-measure every imported node on the next
        // frame. Without this, a dropped Safari ResizeObserver batch can
        // leave nodes unmeasured, which causes EdgeWrapper to render null
        // for every edge connected to those nodes.
        const nodeIds = nextNodes.map((node) => node.id);
        if (nodeIds.length > 0) {
          requestAnimationFrame(() => {
            updateNodeInternals(nodeIds);
          });
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(reapplyPendingSharedGraph);
        });
        for (const delay of [120, 360, 900]) {
          const timeoutId = window.setTimeout(
            reapplyPendingSharedGraph,
            delay
          );
          sharedGraphRepairTimeoutsRef.current.push(timeoutId);
        }
        scheduleSharedEdgeRenderRefresh(targetTabId, nextNodes, nextEdges);
      }
    },
    [
      activeTabId,
      clearSharedGraphRepairTimers,
      reapplyPendingSharedGraph,
      saveTabData,
      scheduleSharedEdgeRenderRefresh,
      setEdges,
      setNodes,
      setProtocolDiagramLayout,
      updateNodeInternals,
    ]
  );

  const handleImportTooltip = useCallback(
    (filename?: string) => {
      if (!filename) return;
      setTabTooltip(activeTabId, `File: ${filename}`);
    },
    [activeTabId, setTabTooltip]
  );

  const handleImportError = useCallback(
    (message: string, details?: FlowValidationIssue[]) => {
      if (details?.length) {
        console.error("Flow import validation issues", details);
      }
      setInfoDialog({ open: true, message });
    },
    [setInfoDialog]
  );

  const {
    fileInputRef,
    saveFlow,
    saveLlmExport,
    saveSimplifiedFlow,
    openFileDialog,
    handleFileSelect,
  } = useFileOperations(nodes, edges, rawOnNodesChange, rawOnEdgesChange, {
    getNodes: getSavedNodes,
    getEdges: getSavedEdges,
    scheduleSnapshot,
    fitView: fitImportedFlow,
    onTooltip: handleImportTooltip,
    onError: handleImportError,
    getProtocolDiagramLayout: () => protocolDiagramLayout,
    setProtocolDiagramLayout,
    getActiveTabTitle: () => {
      const tabId = activeTabIdRef.current ?? activeTabId;
      const activeTab = tabs.find((tab) => tab.id === tabId);
      return activeTab?.title;
    },
    renameActiveTab: (title, options) => {
      const tabId = activeTabIdRef.current ?? activeTabId;
      if (tabId) {
        renameTab(tabId, title, options);
      }
    },
  });

  const centerOnNode = useCallback(
    (nodeId: string) => {
      const instance = flowInstanceRef.current;
      if (!instance) return;
      const node = getNodes().find((nd) => nd.id === nodeId);
      if (!node) return;

      setNodes((currentNodes) => {
        let mutated = false;
        const next = currentNodes.map((entry) => {
          const shouldSelect = entry.id === nodeId;
          if (entry.selected === shouldSelect) return entry;
          mutated = true;
          return { ...entry, selected: shouldSelect };
        });
        return mutated ? next : currentNodes;
      });

      setEdges((currentEdges) => {
        let mutated = false;
        const next = currentEdges.map((edge) => {
          if (!edge.selected) return edge;
          mutated = true;
          return { ...edge, selected: false };
        });
        return mutated ? next : currentEdges;
      });

      /* `fitView` automatically computes the bounding-box of the node,
       keeps the user’s current zoom if possible, and respects padding. */
      instance.fitView({
        nodes: [node],
        padding: 0.2, // 20 % viewport margin
        maxZoom: 2, // don’t zoom in too much
        duration: 350, // smooth scroll
      });
    },
    [getNodes, setEdges, setNodes]
  );

  const focusDiagramNode = useCallback(
    (nodeId: string) => {
      const instance = flowInstanceRef.current;
      if (!instance) return;
      const node = getNodes().find((entry) => entry.id === nodeId);
      if (!node) return;

      setNodes((currentNodes) => {
        let mutated = false;
        const next = currentNodes.map((entry) => {
          const shouldSelect = entry.id === nodeId;
          if (entry.selected === shouldSelect) return entry;
          mutated = true;
          return { ...entry, selected: shouldSelect };
        });
        return mutated ? next : currentNodes;
      });

      setEdges((currentEdges) => {
        let mutated = false;
        const next = currentEdges.map((edge) => {
          if (!edge.selected) return edge;
          mutated = true;
          return { ...edge, selected: false };
        });
        return mutated ? next : currentEdges;
      });

      instance.fitView({
        nodes: [node],
        padding: 0.05,
        maxZoom: 2.6,
        duration: 320,
      });
    },
    [getNodes, setEdges, setNodes]
  );

  const centerOnGroup = useCallback(
    (groupId: string) => {
      const instance = flowInstanceRef.current;
      if (!instance) return;

      const allNodes = getNodes();
      const groupNode = allNodes.find((node) => node.id === groupId);
      const groupChildren = allNodes.filter((node) => node.parentId === groupId);
      const targetNodes =
        groupNode ? [groupNode] : groupChildren.length > 0 ? groupChildren : [];
      if (targetNodes.length === 0) return;

      instance.fitView({
        nodes: targetNodes,
        padding: 0.05,
        maxZoom: 2.6,
        duration: 320,
      });
    },
    [getNodes]
  );

  const updateProtocolDiagramGroupComment = useCallback(
    (groupId: string, comment: string) => {
      const normalizedComment = comment.trim();
      const currentGroup = getNodes().find(
        (node) => node.id === groupId && node.type === "shadcnGroup"
      );
      if (!currentGroup) return;
      const currentComment =
        typeof currentGroup?.data?.comment === "string"
          ? currentGroup.data.comment
          : "";
      if (currentComment.trim() === normalizedComment) return;

      setNodes((currentNodes) => {
        const nextNodes = currentNodes.map((node) => {
          if (node.id !== groupId || node.type !== "shadcnGroup") return node;

          const currentComment =
            typeof node.data?.comment === "string" ? node.data.comment : "";
          if (currentComment.trim() === normalizedComment) return node;

          const nextData = { ...(node.data ?? {}) };
          if (normalizedComment) {
            nextData.comment = normalizedComment;
          } else {
            delete nextData.comment;
          }
          return { ...node, data: nextData };
        });
        return nextNodes;
      });

      setTimeout(() => {
        pushState(getNodes(), getEdges(), "Update Group Comment (Flow Map)");
      }, 0);
    },
    [getEdges, getNodes, pushState, setNodes]
  );

  const focusConnectionEndpoints = useCallback(
    (edgeIds: string[], nodeIds: string[]) => {
      const edgeIdSet = new Set(edgeIds);

      // When selecting edges, deselect all nodes first
      if (edgeIds.length > 0) {
        setNodes((currentNodes) => {
          let mutated = false;
          const next = currentNodes.map((entry) => {
            if (!entry.selected) return entry;
            mutated = true;
            return { ...entry, selected: false };
          });
          return mutated ? next : currentNodes;
        });
      }

      // Select/deselect edges
      setEdges((currentEdges) => {
        let mutated = false;
        const next = currentEdges.map((edge) => {
          const shouldSelect = edgeIdSet.has(edge.id);
          if (edge.selected === shouldSelect) return edge;
          mutated = true;
          return { ...edge, selected: shouldSelect };
        });
        return mutated ? next : currentEdges;
      });

      // Fit view to show endpoints when selecting
      if (nodeIds.length > 0) {
        const instance = flowInstanceRef.current;
        if (!instance) return;
        const nodeIdSet = new Set(nodeIds);
        const toFit = getNodes().filter((n) => nodeIdSet.has(n.id));
        if (toFit.length) {
          instance.fitView({
            nodes: toFit,
            padding: 0.2,
            maxZoom: 2,
            duration: 350,
          });
        }
      }
    },
    [getNodes, setEdges, setNodes]
  );

  const miniMapSize = useMiniMapSize(nodes, showMiniMap, {
    longSide: MINIMAP_LONG,
    shortSideMin: MINIMAP_SHORT_MIN,
    defaultHeight: 120,
  });

  const nodeClassName = useCallback(
    (n: Node) => (n.type === "shadcnGroup" ? "minimap-group" : ""),
    []
  );

  usePanelAutoClose({
    activeTabId,
    calcStatus,
    errorCount: errorInfo.length,
    showErrorPanel,
    setShowErrorPanel,
    setShowSearchPanel,
    setShowProtocolDiagramPanel,
  });

  const handleSelectTab = useCallback(
    (tabId: string) => {
      selectTab(tabId);
    },
    [selectTab]
  );

  const handleAddTab = useCallback(() => {
    addTab();
  }, [addTab]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (tabs.length === 1) {
        setInfoDialog({ open: true, message: "Cannot close the last tab!" });
        return;
      }
      requestCloseTab(tabId);
    },
    [requestCloseTab, tabs.length, setInfoDialog]
  );

  const handleConfirmTabClose = useCallback(() => {
    confirmCloseTab();
  }, [confirmCloseTab]);
  useEffect(() => {
    if (!initialHydrationDone) return;

    let cancelled = false;

    const cancelPending = () => {
      if (typeof window !== "undefined") {
        if (pendingSaveFrameRef.current !== null) {
          window.cancelAnimationFrame(pendingSaveFrameRef.current);
          pendingSaveFrameRef.current = null;
        }
        if (pendingSaveTimeoutRef.current !== null) {
          window.clearTimeout(pendingSaveTimeoutRef.current);
          pendingSaveTimeoutRef.current = null;
        }
      }
    };

    const scheduleSave = () => {
      if (cancelled) return;

      if (typeof window === "undefined") {
        if (!skipLoadRef.current && !loadingUndoRef.current) {
          saveTabDataGuardingSharedImport(activeTabId);
        }
        return;
      }

      const rafId = window.requestAnimationFrame(() => {
        pendingSaveFrameRef.current = null;
        if (cancelled) return;

        pendingSaveTimeoutRef.current = window.setTimeout(() => {
          pendingSaveTimeoutRef.current = null;
          if (cancelled) return;

          if (skipLoadRef.current || loadingUndoRef.current) {
            scheduleSave();
            return;
          }

          saveTabDataGuardingSharedImport(activeTabId);
        }, 40);
      });

      pendingSaveFrameRef.current = rafId;
    };

    cancelPending();
    scheduleSave();

    return () => {
      cancelled = true;
      cancelPending();
    };
  }, [
    activeTabId,
    saveTabDataGuardingSharedImport,
    revTick,
    initialHydrationDone,
    skipLoadRef,
    loadingUndoRef,
  ]);

  useEffect(() => {
    if (!initialHydrationDone) return;
    if (skipLoadRef.current || loadingUndoRef.current) return;
    saveTabDataGuardingSharedImport(activeTabId);
  }, [
    activeTabId,
    initialHydrationDone,
    loadingUndoRef,
    protocolDiagramLayout,
    saveTabDataGuardingSharedImport,
    skipLoadRef,
  ]);

  // Build a stable signature that only changes when the set of selected IDs changes
  const selectedNodeIds = useMemo(
    () => nodes.filter((n) => n.selected).map((n) => n.id),
    [nodes]
  );
  const exactlyTwoSelected = selectedNodeIds.length === 2;

  const {
    allPorts,
    sourcePorts,
    targetPorts,
    existingEdges: existingEdgesForConnect,
    handleApply: handleConnectApply,
  } = useConnectDialog({
    nodes,
    edges,
    connectOpen,
    selectedNodeIds,
    setNodes,
    setEdges,
    markPendingAfterDirtyChange,
    skipNextEdgeSnapshotRef,
    setConnectOpen,
  });

  const handleToggleColorPalette = useCallback(
    (evt: React.MouseEvent) => {
      updatePaletteEligibility();
      if (isColorPaletteOpen) {
        closePalette();
      } else if (canColorSelection) {
        openPalette(evt);
      }
    },
    [
      updatePaletteEligibility,
      isColorPaletteOpen,
      closePalette,
      canColorSelection,
      openPalette,
    ]
  );

  const handleColorSelect = useCallback(
    (color: string | undefined) => {
      applyPaletteColor(color);
    },
    [applyPaletteColor]
  );

  const handlePaneClick = useCallback(() => {
    closePalette();
    setIsSearchHighlight(false);
    clearHighlights();

    requestAnimationFrame(() => {
      const store = storeApi.getState();
      const selectedNodes = store.nodes.filter((node) => node.selected);
      const selectedEdges = store.edges.filter((edge) => edge.selected);

      store.resetSelectedElements?.();
      if (selectedNodes.length || selectedEdges.length) {
        store.unselectNodesAndEdges?.({
          nodes: selectedNodes,
          edges: selectedEdges,
        });
      }

      setNodes((existing) => {
        let mutated = false;
        const next = existing.map((node) => {
          if (!node.selected) return node;
          mutated = true;
          return { ...node, selected: false };
        });
        return mutated ? next : existing;
      });

      setEdges((existing) => {
        let mutated = false;
        const next = existing.map((edge) => {
          if (!edge.selected) return edge;
          mutated = true;
          return { ...edge, selected: false };
        });
        return mutated ? next : existing;
      });
    });
  }, [
    clearHighlights,
    closePalette,
    setIsSearchHighlight,
    storeApi,
    setNodes,
    setEdges,
  ]);

  const {
    onNodesChange,
    onEdgesChange,
    onConnectWithUndo,
    onReconnectWithUndo,
    onDropWithUndo,
    groupWithUndo,
    ungroupWithUndo,
    onNodeDragStopWithUndo,
    handlePaste,
  } = useFlowInteractions({
    rawOnNodesChange,
    rawOnEdgesChange,
    onConnect,
    onDrop,
    onNodeDragStop,
    getNodes,
    getEdges,
    setNodes,
    setEdges,
    scheduleSnapshot,
    pendingSnapshotRef,
    skipNextEdgeSnapshotRef,
    skipNextNodeRemovalRef,
    markPendingAfterDirtyChange,
    releaseEdgeSnapshotSkip,
    releaseNodeRemovalSnapshotSkip,
    loadingUndoRef,
    isPastingRef,
    getTopLeftPosition,
    pasteNodes,
    isSidebarOpen,
    setTabTooltip,
    renameTab,
    activeTabId,
    groupSelectedNodes,
    ungroupSelectedNodes,
    clearHighlights,
    setIsSearchHighlight,
    incRev,
    pushCleanState,
    updatePaletteEligibility,
    isSelectionModeActive: isSelectionMode,
  });

  useEffect(() => {
    groupWithUndoRef.current = groupWithUndo;
  }, [groupWithUndo]);

  useEffect(() => {
    ungroupWithUndoRef.current = ungroupWithUndo;
  }, [ungroupWithUndo]);

  const handleShareClick = useCallback(() => {
    openShareDialog();
  }, [openShareDialog]);

  useEffect(() => {
    pasteNodesRef.current = handlePaste;
  }, [handlePaste]);

  useFlowHotkeys({
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
  });

  useSharedFlowLoader({
    enabled: initialHydrationDone,
    getNodes: getSavedNodes,
    getEdges: getSavedEdges,
    fitView: fitSharedImportedFlow,
    getProtocolDiagramLayout: () => protocolDiagramLayout,
    setProtocolDiagramLayout,
    replaceGraph: replaceSharedGraph,
    onNodesChange: rawOnNodesChange,
    onEdgesChange: rawOnEdgesChange,
    scheduleSnapshot,
    setTabTooltip,
    renameTab,
    activeTabId,
    setInfoDialog,
    flowInstanceRef,
    ensureShareImportTab,
  });
  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  const paneDistanceAppliedRef = useRef(false);

  useEffect(() => {
    type PanZoomInstance = ReturnType<typeof storeApi.getState>["panZoom"];

    const ensureDistance = (panZoom: PanZoomInstance) => {
      if (!panZoom || paneDistanceAppliedRef.current) return;
      if (typeof panZoom.setClickDistance === "function") {
        panZoom.setClickDistance(12);
        paneDistanceAppliedRef.current = true;
      }
    };

    ensureDistance(storeApi.getState().panZoom);

    const unsubscribe = storeApi.subscribe((state) => {
      ensureDistance(state.panZoom);
    });

    return () => unsubscribe?.();
  }, [storeApi]);

  useGlobalCalculationLogic({
    nodes,
    edges,
    debounceMs: 500,
    onStatusChange: (status, errors) => {
      applyCalculationState(status, errors || []);
      if (status === "OK" && initialHydrationDone) {
        saveTabDataGuardingSharedImport(activeTabId);
      }
    },
  });

  const handleRetryAll = useLimitErrorRecovery(hasLimitErrors, setNodes);

  // remember which history index we have already mounted
  const lastLoadedPtr = useRef<number>(pointer);

  useEffect(() => {
    if (skipLoadRef.current) {
      skipLoadRef.current = false;
      // CRITICAL: Update lastLoadedPtr even when skipping to keep it in sync
      lastLoadedPtr.current = pointer;
      return;
    }
    if (lastLoadedPtr.current === pointer) return;
    lastLoadedPtr.current = pointer;
    if (pointer < 0 || pointer >= history.length) return;

    const snap = history[pointer];
    loadingUndoRef.current = true;
    restoreScriptSteps(snap.scriptSteps ?? []);

    // Prevent an "After calc" snapshot right after history loads
    pendingSnapshotRef.current = false;
    skipNextEdgeSnapshotRef.current = false;
    clearHighlights();
    const restoredNodes = snap.nodes.map((n: FlowNode) => ({
      ...n,
      data: { ...n.data, dirty: false },
    }));
    const restoredEdges = snap.edges.map((e: Edge) => ({
      ...e,
      ...(e.data ? { data: { ...e.data } } : {}),
    }));

    setNodes(restoredNodes);
    requestAnimationFrame(() => {
      const hasMissingHandle = restoredEdges.some((edge) => {
        const targetNode = restoredNodes.find(
          (node) => node.id === edge.target
        );
        if (!targetNode) return true;
        if (!edge.targetHandle) return false;
        return !edge.targetHandle.startsWith("input-")
          ? false
          : targetNode.data?.totalInputs !== undefined &&
              parseInt(edge.targetHandle.replace("input-", ""), 10) >=
                (targetNode.data?.totalInputs ?? 0);
      });

      if (hasMissingHandle) {
        // Keep the current edges visible while handles remount to avoid a flash.
        requestAnimationFrame(() => {
          setTimeout(() => setEdges(restoredEdges), 0);
        });
      } else {
        setEdges(restoredEdges);
      }
    });
    if (snap.calcState) {
      const stored = snap.calcState;
      applyCalculationState(stored.status, stored.errors, activeTabId, {
        source: "calculation",
        sticky: false,
      });
    } else {
      refreshBanner(restoredNodes, activeTabId, {
        sticky: false,
        immediate: true,
      });
    }
    requestAnimationFrame(() => {
      updatePaletteEligibility();
      loadingUndoRef.current = false;
    });
  }, [
    pointer,
    history,
    setNodes,
    setEdges,
    refreshBanner,
    applyCalculationState,
    skipLoadRef,
    pendingSnapshotRef,
    skipNextEdgeSnapshotRef,
    clearHighlights,
    updatePaletteEligibility,
    activeTabId,
  ]);

  const scheduleIdle = useCallback((fn: () => void) => {
    if (typeof window === "undefined") {
      fn();
      return () => {};
    }
    const globalWin = window as Window & {
      requestIdleCallback?: (
        cb: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof globalWin.requestIdleCallback === "function") {
      const id = globalWin.requestIdleCallback(fn, { timeout: 200 });
      return () => globalWin.cancelIdleCallback?.(id);
    }
    const timeoutId = window.setTimeout(fn, 120);
    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (
      typeof document !== "undefined" &&
      document.body.dataset.largeDrag === "true"
    ) {
      return;
    }
    return scheduleIdle(() => updatePaletteEligibility());
  }, [nodes, updatePaletteEligibility, scheduleIdle]);

  const handleInit = useCallback<OnInit>(
    (instance) => {
      rawOnInit(instance);
      flowInstanceRef.current = instance;
      requestAnimationFrame(() => {
        if (
          !pendingExampleFitRef.current &&
          !hasFitOnInitialLoad &&
          (nodes.length || edges.length) &&
          activeTabId === "tab-1"
        ) {
          instance.fitView({ padding: 0.2 });
          setHasFitOnInitialLoad(true);
        }
        if (pendingExampleFitRef.current) {
          const fitOptions = pendingFitOptionsRef.current;
          const fittedWithGraph = fitCurrentGraphIntoView({
            minZoom: fitOptions.minZoom,
          });
          if (fittedWithGraph && !fitOptions.settle) {
            pendingExampleFitRef.current = false;
            pendingFitOptionsRef.current = {};
            clearExampleFitRetryTimers();
          }
        }
        setIsFlowVisible(true);
      });

      if (history.length === 0) {
        if (!initialHydrationDone) {
          return;
        }
        if (nodes.length === 0 && edges.length === 0 && activeTabId === "tab-1")
          initializeTabHistory("tab-1", [], []);
        else if (nodes.length || edges.length)
          pushCleanState(nodes, edges, "Initial Load");
      }
    },
    [
      rawOnInit,
      pushCleanState,
      nodes,
      edges,
      history.length,
      initializeTabHistory,
      activeTabId,
      hasFitOnInitialLoad,
      initialHydrationDone,
      clearExampleFitRetryTimers,
      fitCurrentGraphIntoView,
    ]
  );

  useEffect(
    () => () => {
      pendingExampleFitRef.current = false;
      pendingFitOptionsRef.current = {};
      clearExampleFitRetryTimers();
      clearSharedGraphRepairTimers();
    },
    [clearExampleFitRetryTimers, clearSharedGraphRepairTimers]
  );

  const onMoveEnd = useCallback(
    (_: MouseEvent | TouchEvent | null, vp: Viewport) => {
      setTabTransform(activeTabId, { x: vp.x, y: vp.y, zoom: vp.zoom });
    },
    [activeTabId, setTabTransform]
  );

  const {
    showConfirmation: showSaveConfirmation,
    confirmationMessage: saveConfirmationMessage,
    promptSave: handleSaveSimplified,
    confirmSave: handleConfirmSimplifiedSave,
    cancelSave: handleCancelSimplifiedSave,
  } = useSimplifiedSave({ nodes, saveSimplifiedFlow });

  const {
    showConfirmation: showLlmSaveConfirmation,
    confirmationMessage: llmSaveConfirmationMessage,
    promptSave: handleSaveLlmWithConfirmation,
    confirmSave: handleConfirmLlmSave,
    cancelSave: handleCancelLlmSave,
  } = useSimplifiedSave({ nodes, saveSimplifiedFlow: saveLlmExport });

  const { focusSearchHit } = useSearchHighlights({
    showSearchPanel,
    searchQuery,
    setSearchQuery,
    setNodes,
    centerOnNode,
    clearHighlights,
  });

  useEffect(() => {
    const selectionKey = "s";

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return (
        target.isContentEditable ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "select"
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== selectionKey &&
        event.key !== selectionKey.toUpperCase()
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      setIsSelectionHotKeyActive(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (
        event.key !== selectionKey &&
        event.key !== selectionKey.toUpperCase()
      )
        return;
      setIsSelectionHotKeyActive(false);
    };

    const handleBlur = () => setIsSelectionHotKeyActive(false);
    const listenerOptions: AddEventListenerOptions = { capture: true };

    window.addEventListener("keydown", handleKeyDown, listenerOptions);
    window.addEventListener("keyup", handleKeyUp, listenerOptions);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, listenerOptions);
      window.removeEventListener("keyup", handleKeyUp, listenerOptions);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleBlur);
    };
  }, [setIsSelectionHotKeyActive]);

  /* =================================================================
   *  JSX render – nothing but UI
   * ================================================================ */
  return (
    <SnapshotProvider scheduler={snapshotScheduler}>
      <FlowActionsProvider value={{ groupWithUndo, ungroupWithUndo }}>
        <div
          ref={reactFlowWrapper}
          className="relative w-screen h-screen bg-background"
          style={{ visibility: isFlowVisible ? "visible" : "hidden" }}
        >
          {/* Top bar */}
          {!isMobileReadOnly && (
            <TopBar
              isSidebarOpen={isSidebarOpen}
              onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
              tabs={tabs}
              activeTabId={activeTabId}
              onTabSelect={handleSelectTab}
              onAddTab={handleAddTab}
              onCloseTab={handleCloseTab}
              onRenameTab={(id, title) => renameTab(id, title)}
              fileInputRef={fileInputRef}
              onSave={saveFlow}
              onSaveSimplified={handleSaveSimplified}
              onSaveLlmExport={handleSaveLlmWithConfirmation}
              onLoad={openFileDialog}
              onFileSelect={handleFileSelect}
              canCopy={nodes.some((n) => n.selected)}
              hasCopiedNodes={hasCopiedNodes}
              onCopy={copyNodes}
              onPaste={() => handlePaste()}
              calcStatus={calcStatus}
              errorInfo={errorInfo}
              errorCount={errorInfo.length}
              showErrorPanel={showErrorPanel}
              setShowErrorPanel={setShowErrorPanel}
              onRetryAll={handleRetryAll}
              hasLimitErrors={hasLimitErrors}
              showUndoRedoPanel={showUndoRedoPanel}
              setShowUndoRedoPanel={setShowUndoRedoPanel}
              showProtocolDiagramPanel={showProtocolDiagramPanel}
              setShowProtocolDiagramPanel={setShowProtocolDiagramPanel}
              hasProtocolDiagram={hasProtocolDiagram}
              protocolDiagramDisabledTooltip="Add groups to enable diagram view"
              onToggleColorPalette={handleToggleColorPalette}
              isColorPaletteOpen={isColorPaletteOpen}
              canColorSelection={canColorSelection}
              canGroupSelectedNodes={canGroupSelectedNodes}
              canUngroupSelectedNodes={canUngroupSelectedNodes}
              connectDisabled={
                !(
                  exactlyTwoSelected &&
                  sourcePorts?.outputs.length &&
                  targetPorts?.inputs.length
                )
              }
              onConnectClick={() => setConnectOpen(true)}
              onGroup={groupWithUndo}
              onUngroup={ungroupWithUndo}
              onSearchClick={() => {
                setShowUndoRedoPanel(false); // never overlap
                setShowErrorPanel(false);
                setShowProtocolDiagramPanel(false);
                setShowSearchPanel((v) => !v); // toggle
              }}
              setShowSearchPanel={setShowSearchPanel}
              showMiniMap={showMiniMap}
              onToggleMiniMap={() => setShowMiniMap((v) => !v)}
              isSelectionModeActive={isSelectionMode}
              onToggleSelectionMode={() => setIsSelectionLocked((v) => !v)}
              onShare={handleShareClick}
              shareDisabled={nodes.length === 0}
              tabBarRightInset={rightPanelWidth}
            />
          )}

          {/* Sidebar */}
          {!isMobileReadOnly && (
            <Sidebar
              isOpen={isSidebarOpen}
              onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
            />
          )}

          {/* Main canvas */}
          <main
            className={cn(
              "absolute bottom-0 left-0 right-0 flex transition-all duration-300",
              isMobileReadOnly ? "top-0" : "top-14",
              !isMobileReadOnly && isSidebarOpen && "md:left-64",
              !isMobileReadOnly && tabs.length > 0 && "pt-10"
            )}
          >
            <div
              className={cn(
                "relative flex-1 min-w-[1px] min-h-[1px] overflow-hidden transition-[margin] duration-300"
              )}
              style={
                isMobileReadOnly
                  ? undefined
                  : {
                      // Keep React Flow's parent non-zero to avoid warning #004
                      // during narrow-width panel layouts/transitions.
                      marginRight: rightPanelOpen
                        ? `min(${rightPanelWidth}px, calc(100% - 1px))`
                        : 0,
                    }
              }
            >
              <FlowCanvas
                nodeTypes={nodeTypes}
                nodes={nodes}
                edges={edges}
                showMiniMap={showMiniMap}
                miniMapSize={miniMapSize}
                miniMapOffset={miniMapOffset}
                isDark={isDark}
                nodeClassName={nodeClassName}
                onInit={handleInit}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnectWithUndo}
                onReconnect={onReconnectWithUndo}
                onDrop={onDropWithUndo}
                onDragOver={onDragOver}
                onNodeDragStop={onNodeDragStopWithUndo}
                onPaneClick={handlePaneClick}
                onMoveEnd={onMoveEnd}
                isSelectionModeActive={isSelectionMode}
                isReadOnly={isMobileReadOnly}
                onlyRenderVisibleElements
              />
              {isMobileReadOnly && (
                <div className="pointer-events-none absolute inset-x-0 top-4 mx-auto w-11/12 max-w-md">
                  <div className="pointer-events-auto rounded-lg border border-border bg-background/90 px-4 py-3 text-center text-sm font-medium shadow-sm backdrop-blur flex flex-col items-center gap-2">
                    <span>
                      raw₿it is optimized for desktop. You’re viewing a read-only
                      mobile layout.
                    </span>
                    <div className="flex w-full items-center gap-2">
                      <div className="flex-1" />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowWelcomeDialog(true)}
                        className="h-8 px-3 text-xs font-medium"
                      >
                        Load example flows
                      </Button>
                      <div className="flex flex-1 items-center justify-end gap-2">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs font-medium"
                          aria-label="GitHub"
                        >
                          <a
                            href="https://github.com/rawBit-io/rawbit"
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Github className="h-5 w-5" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs font-medium"
                          onClick={() =>
                            setTheme(theme === "light" ? "dark" : "light")
                          }
                          aria-label="Toggle theme"
                        >
                          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {EDGE_OPACITY_TUNER_ENABLED && !isMobileReadOnly && (
                <div className="pointer-events-none absolute right-4 top-4 z-30 select-none">
                  <div
                    className="pointer-events-auto w-72 rounded-md border border-border bg-background/95 p-2 shadow-md backdrop-blur"
                    onPointerDownCapture={(event) => event.stopPropagation()}
                    onWheelCapture={(event) => event.stopPropagation()}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Edge Opacity Tuner
                      </span>
                      <button
                        type="button"
                        className="h-6 rounded border border-border px-2 text-[11px] font-medium hover:bg-muted"
                        onClick={() => setShowEdgeOpacityTuner((open) => !open)}
                      >
                        {showEdgeOpacityTuner ? "Hide" : "Show"}
                      </button>
                    </div>
                    {showEdgeOpacityTuner && (
                      <div className="space-y-3">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Dark mode
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span>Default</span>
                            <span className="font-mono">
                              {edgeDarkOpacity.default.toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.25}
                            max={0.9}
                            step={0.01}
                            value={edgeDarkOpacity.default}
                            onChange={(event) =>
                              setEdgeDarkOpacity((prev) => ({
                                ...prev,
                                default: Number(event.target.value),
                              }))
                            }
                            className="w-full accent-primary"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span>Paper</span>
                            <span className="font-mono">
                              {edgeDarkOpacity.paper.toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.25}
                            max={0.9}
                            step={0.01}
                            value={edgeDarkOpacity.paper}
                            onChange={(event) =>
                              setEdgeDarkOpacity((prev) => ({
                                ...prev,
                                paper: Number(event.target.value),
                              }))
                            }
                            className="w-full accent-primary"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span>Midnight</span>
                            <span className="font-mono">
                              {edgeDarkOpacity.midnight.toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.25}
                            max={0.9}
                            step={0.01}
                            value={edgeDarkOpacity.midnight}
                            onChange={(event) =>
                              setEdgeDarkOpacity((prev) => ({
                                ...prev,
                                midnight: Number(event.target.value),
                              }))
                            }
                            className="w-full accent-primary"
                          />
                        </div>

                        <div className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Light mode
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span>Default</span>
                            <span className="font-mono">
                              {edgeLightOpacity.default.toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.4}
                            max={1}
                            step={0.01}
                            value={edgeLightOpacity.default}
                            onChange={(event) =>
                              setEdgeLightOpacity((prev) => ({
                                ...prev,
                                default: Number(event.target.value),
                              }))
                            }
                            className="w-full accent-primary"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span>Paper</span>
                            <span className="font-mono">
                              {edgeLightOpacity.paper.toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.4}
                            max={1}
                            step={0.01}
                            value={edgeLightOpacity.paper}
                            onChange={(event) =>
                              setEdgeLightOpacity((prev) => ({
                                ...prev,
                                paper: Number(event.target.value),
                              }))
                            }
                            className="w-full accent-primary"
                          />
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span>Midnight</span>
                            <span className="font-mono">
                              {edgeLightOpacity.midnight.toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.4}
                            max={1}
                            step={0.01}
                            value={edgeLightOpacity.midnight}
                            onChange={(event) =>
                              setEdgeLightOpacity((prev) => ({
                                ...prev,
                                midnight: Number(event.target.value),
                              }))
                            }
                            className="w-full accent-primary"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className="h-6 rounded border border-border px-2 text-[11px] font-medium hover:bg-muted"
                            onClick={() => {
                              setEdgeDarkOpacity({
                                default: EDGE_DARK_OPACITY_DEFAULTS.default,
                                paper: EDGE_DARK_OPACITY_DEFAULTS.paper,
                                midnight: EDGE_DARK_OPACITY_DEFAULTS.midnight,
                              });
                              setEdgeLightOpacity({
                                default: EDGE_LIGHT_OPACITY_DEFAULTS.default,
                                paper: EDGE_LIGHT_OPACITY_DEFAULTS.paper,
                                midnight: EDGE_LIGHT_OPACITY_DEFAULTS.midnight,
                              });
                            }}
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {!isMobileReadOnly && (
              <FlowPanels
                showUndoRedoPanel={showUndoRedoPanel}
                setShowUndoRedoPanel={setShowUndoRedoPanel}
                showErrorPanel={showErrorPanel}
                setShowErrorPanel={setShowErrorPanel}
                errorInfo={errorInfo}
                nodes={nodes}
                showSearchPanel={showSearchPanel}
                setShowSearchPanel={setShowSearchPanel}
                showProtocolDiagramPanel={showProtocolDiagramPanel}
                setShowProtocolDiagramPanel={setShowProtocolDiagramPanel}
                protocolDiagramModel={protocolDiagramModel}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                edges={edges}
                centerOnNode={centerOnNode}
                focusDiagramNode={focusDiagramNode}
                centerOnGroup={centerOnGroup}
                focusConnectionEndpoints={focusConnectionEndpoints}
                canvasSelectedEdgeIds={canvasSelectedEdgeIds}
                focusSearchHit={focusSearchHit}
                hasMultipleTabs={tabs.length > 0}
                protocolDiagramOffsets={protocolDiagramLayout?.groupOffsets}
                onProtocolDiagramOffsetsChange={
                  handleProtocolDiagramOffsetsChange
                }
                onProtocolPanelWidthChange={setProtocolPanelWidth}
                onUpdateGroupComment={updateProtocolDiagramGroupComment}
              />
            )}
          </main>

          {/* 🎨 ColorPalette - MOVED HERE, outside ReactFlow, with higher z-index */}
          {!isMobileReadOnly && (
            <ColorPalette
              isOpen={isColorPaletteOpen}
              position={colorPalettePosition}
              onColorSelect={handleColorSelect}
              onClose={closePalette}
            />
          )}

          {/* dialogs */}
          <FlowDialogLayer
            closeDialog={closeDialog}
            tabCount={tabs.length}
            onConfirmTabClose={handleConfirmTabClose}
            onCancelTabClose={cancelCloseTab}
            onCloseAllTabs={closeAllTabs}
            onCloseOtherTabs={closeOtherTabs}
            showSaveConfirmation={showSaveConfirmation}
            saveConfirmationMessage={saveConfirmationMessage}
            onConfirmSave={handleConfirmSimplifiedSave}
            onCancelSave={handleCancelSimplifiedSave}
            showLlmSaveConfirmation={showLlmSaveConfirmation}
            llmSaveConfirmationMessage={llmSaveConfirmationMessage}
            onConfirmLlmSave={handleConfirmLlmSave}
            onCancelLlmSave={handleCancelLlmSave}
            infoDialog={infoDialog}
            closeInfoDialog={closeInfoDialog}
            connectOpen={connectOpen}
            setConnectOpen={setConnectOpen}
            allPorts={allPorts}
            sourcePorts={sourcePorts}
            targetPorts={targetPorts}
            existingEdges={existingEdgesForConnect}
            onConnectApply={handleConnectApply}
            shareDialogOpen={shareDialogOpen}
            shareCreatedId={shareCreatedId}
            closeShareDialog={closeShareDialog}
            requestShare={requestShare}
            softGateOpen={softGateOpen}
            closeSoftGate={closeSoftGate}
            verifyTurnstile={verifyTurnstile}
          />
          <FirstRunDialog
            open={showWelcomeDialog}
            flows={exampleFlowOptions}
            onStartEmpty={handleWelcomeStartEmpty}
            onLoadExample={handleWelcomeLoadExample}
            hideStartEmpty={isMobileReadOnly}
            onOpenChange={setShowWelcomeDialog}
          />
        </div>
      </FlowActionsProvider>
    </SnapshotProvider>
  );
}

export default function Flow() {
  return (
    <ReactFlowProvider>
      <UndoRedoProvider>
        <FlowContent />
      </UndoRedoProvider>
    </ReactFlowProvider>
  );
}
