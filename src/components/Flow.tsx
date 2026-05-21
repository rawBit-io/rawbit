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
import { GroupBundlePortNode } from "@/components/nodes/GroupBundlePortNode";

import { TopBar } from "@/components/layout/TopBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { ColorPalette } from "@/components/ui/ColorPalette";
import { Button } from "@/components/ui/button";
import { FlowCanvas } from "@/components/FlowCanvas";
import { FlowDialogLayer } from "@/components/FlowDialogLayer";
import { FlowPanels } from "@/components/FlowPanels";
import { FirstRunDialog } from "@/components/dialog/FirstRunDialog";
import {
  IntroDropOverlay,
  type IntroDropOverlayState,
} from "@/components/IntroDropOverlay";
import { HelpMenu } from "@/help/HelpMenu";
import { HELP_DEMOS } from "@/help/registry";
import type { DemoStepContext, HelpDemo } from "@/help/types";
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
import {
  buildGroupBundledElements,
  GROUP_BUNDLE_PORT_NODE_TYPE,
  sanitizeGroupBundleVisualElementsForState,
  stripGroupBundlePortNodes,
} from "@/lib/flow/groupEdgeBundling";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";
import {
  getFlowTemplateViewport,
  placeFlowDataAtPosition,
} from "@/lib/flow/placeFlowTemplate";

const COLORABLE_NODE_TYPES = new Set([
  "calculation",
  "shadcnGroup",
  "shadcnTextInfo",
  "opCodeNode",
  "trezorAction",
]);
const INFO_NODE_TYPE = "shadcnTextInfo";

const nodeTypes = {
  calculation: CalculationNode,
  trezorAction: CalculationNode,
  shadcnGroup: ShadcnGroupNode,
  shadcnTextInfo: TextInfoNode,
  opCodeNode: OpCodeNode,
  [GROUP_BUNDLE_PORT_NODE_TYPE]: GroupBundlePortNode,
};

function stripTransientInfoNodeVisibility(nodes: FlowNode[]): FlowNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.type !== INFO_NODE_TYPE || node.hidden !== true) return node;
    changed = true;
    const nextNode = { ...node };
    delete nextNode.hidden;
    return nextNode;
  });
  return changed ? nextNodes : nodes;
}

function stripTransientInfoEdgeVisibility(
  edges: Edge[],
  infoNodeIds: Set<string>
): Edge[] {
  if (infoNodeIds.size === 0) return edges;
  let changed = false;
  const nextEdges = edges.map((edge) => {
    if (
      edge.hidden !== true ||
      (!infoNodeIds.has(edge.source) && !infoNodeIds.has(edge.target))
    ) {
      return edge;
    }
    changed = true;
    const nextEdge = { ...edge };
    delete nextEdge.hidden;
    return nextEdge;
  });
  return changed ? nextEdges : edges;
}

function applyInfoNodeVisibility(
  nodes: FlowNode[],
  showInfoNodes: boolean
): FlowNode[] {
  if (showInfoNodes) return stripTransientInfoNodeVisibility(nodes);
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.type !== INFO_NODE_TYPE) return node;
    changed = true;
    return node.hidden === true ? node : { ...node, hidden: true };
  });
  return changed ? nextNodes : nodes;
}

function applyInfoEdgeVisibility(
  edges: Edge[],
  infoNodeIds: Set<string>,
  showInfoNodes: boolean
): Edge[] {
  if (showInfoNodes) {
    return stripTransientInfoEdgeVisibility(edges, infoNodeIds);
  }
  if (infoNodeIds.size === 0) return edges;
  let changed = false;
  const nextEdges = edges.map((edge) => {
    if (!infoNodeIds.has(edge.source) && !infoNodeIds.has(edge.target)) {
      return edge;
    }
    changed = true;
    return edge.hidden === true ? edge : { ...edge, hidden: true };
  });
  return changed ? nextEdges : edges;
}

type TabCalculationState = {
  status: CalcStatus;
  errors: CalcError[];
};

type PendingSharedGraph = {
  tabId: string;
  nodes: FlowNode[];
  edges: Edge[];
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
const INTRO_FLOW_ID = "flow-0";
const TOP_LEVEL_FLOW_SECTION = "top-level";
const INTRO_FLOW_DROP_FLOW_POSITION = { x: 0, y: 0 };
const INTRO_FLOW_DROP_POINT = { x: 112, y: 88 };
const INTRO_FLOW_DROP_ZOOM = 0.27;
const MOBILE_INTRO_OVERVIEW_POINT = { x: 16, y: 150 };
const MOBILE_INTRO_OVERVIEW_ZOOM = 0.2;
const INTRO_FLOW_SOURCE_MOVE_MS = 350;
const INTRO_FLOW_SOURCE_PRESS_MS = 1050;
const INTRO_FLOW_PICKUP_MS = 1250;
const INTRO_FLOW_DRAG_MS = 1500;
const INTRO_FLOW_DROP_MS = 2250;
const INTRO_FLOW_RELEASE_MS = 2850;
const INTRO_SOURCE_FALLBACK = { x: 76, y: 780 };
const INTRO_SOURCE_CARD_SIZE = { width: 196, height: 96 };
const INTRO_VIDEO_TITLE = "rawBit demo";
const INTRO_VIDEO_EMBED_URL =
  "https://www.youtube-nocookie.com/embed/n4YHoKj4Ics?rel=0";
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

function graphIdsMatchCanonicalOrProjection(
  currentNodes: FlowNode[],
  currentEdges: Edge[],
  expectedNodes: FlowNode[],
  expectedEdges: Edge[]
) {
  if (graphIdsMatch(currentNodes, currentEdges, expectedNodes, expectedEdges)) {
    return true;
  }
  const canonical = sanitizeGroupBundleVisualElementsForState({
    nodes: currentNodes,
    edges: currentEdges,
  });
  if (
    graphIdsMatch(canonical.nodes, canonical.edges, expectedNodes, expectedEdges)
  ) {
    return true;
  }
  const projected = buildGroupBundledElements({
    nodes: expectedNodes,
    edges: expectedEdges,
  });
  return graphIdsMatch(
    currentNodes,
    currentEdges,
    projected.nodes,
    projected.edges
  );
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

type ExtendedNavigator = Navigator & {
  userAgentData?: { mobile?: boolean };
};

function getCurrentMobileBlockState() {
  if (typeof window === "undefined") return false;

  const nav: ExtendedNavigator | undefined =
    typeof window.navigator !== "undefined"
      ? (window.navigator as ExtendedNavigator)
      : undefined;
  const coarsePointer =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  return shouldBlockMobile({
    width: window.innerWidth,
    coarsePointer,
    userAgent: nav?.userAgent,
    userAgentDataMobile: nav?.userAgentData?.mobile,
  });
}

function findOverviewNode(nodesToInspect: FlowNode[]) {
  return nodesToInspect.find((node) => {
    const data = node.data as { title?: unknown; content?: unknown } | undefined;
    return (
      node.type === "shadcnTextInfo" &&
      (String(data?.content ?? "").includes("# Overview") ||
        String(data?.title ?? "").toLowerCase() === "overview")
    );
  });
}

function getFlowDisplayTitle(label: string, flowName: unknown) {
  if (typeof flowName === "string") {
    const trimmed = flowName.trim();
    if (trimmed) return trimmed;
  }
  return label;
}

function cloneStructuredData<T>(data: T): T {
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(data) as T;
    }
  } catch {
    /* structuredClone not available; fall back to JSON copy */
  }
  return JSON.parse(JSON.stringify(data)) as T;
}

function cloneFlowData(data: FlowData): FlowData {
  return cloneStructuredData(data);
}

function getIntroDropSourceRect(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (typeof document === "undefined") {
    return { ...INTRO_SOURCE_FALLBACK, ...INTRO_SOURCE_CARD_SIZE };
  }

  const source = document.querySelector<HTMLElement>(
    `[data-flow-template-id="${INTRO_FLOW_ID}"]`
  );
  if (!source) {
    return { ...INTRO_SOURCE_FALLBACK, ...INTRO_SOURCE_CARD_SIZE };
  }

  const rect = source.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width || INTRO_SOURCE_CARD_SIZE.width,
    height: rect.height || INTRO_SOURCE_CARD_SIZE.height,
  };
}

function getRectCursorCenter(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: rect.x + rect.width / 2 - 4,
    y: rect.y + rect.height / 2 - 4,
  };
}

function FlowContent() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showUndoRedoPanel, setShowUndoRedoPanel] = useState(false);
  const [showErrorPanel, setShowErrorPanel] = useState(false);

  // 🔍 search-panel state
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);
  const [isIntroDropAnimating, setIsIntroDropAnimating] = useState(false);
  const [introDropState, setIntroDropState] =
    useState<IntroDropOverlayState | null>(null);
  // 📖 help system: tabs marked as help, demo-driven sidebar overrides, the
  // id of the currently running demo, and tracked timer ids for cancellation.
  const [helpTabIds, setHelpTabIds] = useState<Set<string>>(() => new Set());
  const [helpSidebarSearch, setHelpSidebarSearch] = useState<
    string | undefined
  >(undefined);
  const [helpSidebarHighlight, setHelpSidebarHighlight] = useState<
    string | undefined
  >(undefined);
  const [runningHelpDemoId, setRunningHelpDemoId] = useState<string | null>(
    null,
  );
  const [currentHelpDemo, setCurrentHelpDemo] = useState<HelpDemo | null>(null);
  const helpDemoTimersRef = useRef<number[]>([]);
  // Generation counter cancels stale async fast-forward loops when the user
  // clicks a new step (or stops the demo) mid fast-forward.
  const helpDemoPlayGenRef = useRef(0);
  // "auto": auto-advance through the steps. "manual": play one step and stop.
  // Set to "auto" by the side-panel Play button + the caption Restart button;
  // flipped to "manual" by Pause and stays there until auto is re-entered.
  const helpDemoModeRef = useRef<"auto" | "manual">("auto");
  // Refs so caption-card buttons (created once per step) always call the
  // latest stop/play impls even after React rerenders recreate the callbacks.
  const stopHelpDemoRef = useRef<(opts?: { clearOverlay?: boolean }) => void>(
    () => {},
  );
  const playHelpStepRef = useRef<(demo: HelpDemo, stepIdx: number) => void>(
    () => {},
  );

  const [calcStateByTab, setCalcStateByTab] = useState<
    Record<string, TabCalculationState>
  >({});
  const [connectOpen, setConnectOpen] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [isSelectionLocked, setIsSelectionLocked] = useState(false);
  const [isSelectionHotKeyActive, setIsSelectionHotKeyActive] = useState(false);
  const [isMobileBlocked, setIsMobileBlocked] = useState(() =>
    getCurrentMobileBlockState()
  );
  const [mobileCanvasMode, setMobileCanvasMode] = useState<"intro" | "canvas">(
    "intro"
  );
  const isMobileReadOnly = isMobileBlocked;
  const showMobileIntroPreview =
    isMobileReadOnly && mobileCanvasMode === "intro";
  const isSelectionMode = isSelectionLocked || isSelectionHotKeyActive;
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const loadingUndoRef = useRef(false);
  const isPastingRef = useRef(false);
  const welcomeCompleteRef = useRef(false);
  const introDropScheduledRef = useRef(false);
  const introDropTimeoutIdsRef = useRef<number[]>([]);
  const pendingExampleFitRef = useRef(false);
  const pendingFitOptionsRef = useRef<{
    minZoom?: number;
    settle?: boolean;
  }>({});
  const pendingExampleViewportRef = useRef<Viewport | null>(null);
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
  const exampleFlowMap = useMemo(
    () => new Map(customFlows.map((flow) => [flow.id, flow])),
    []
  );
  const exampleFlowOptions = useMemo(
    () => customFlows.map((flow) => ({ id: flow.id, label: flow.label })),
    []
  );
  const visibleExampleFlowOptions = useMemo(
    () =>
      customFlows
        .filter((flow) => flow.section === TOP_LEVEL_FLOW_SECTION)
        .map((flow) => ({ id: flow.id, label: flow.label })),
    []
  );
  const mobileExampleFlowOptions = visibleExampleFlowOptions.length
    ? visibleExampleFlowOptions
    : exampleFlowOptions;
  const mobileIntroGraph = useMemo(() => {
    if (!showMobileIntroPreview) return null;

    const entry = exampleFlowMap.get(INTRO_FLOW_ID) ?? customFlows[0];
    if (!entry) return null;

    const clonedData = cloneFlowData(entry.data);
    const nodesFromFlow = Array.isArray(clonedData.nodes)
      ? clonedData.nodes
      : [];
    const edgesFromFlow = Array.isArray(clonedData.edges)
      ? clonedData.edges
      : [];
    const normalizedNodes = stripLegacyFlowMapNodeData(
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
    const normalizedEdges = edgesFromFlow.map((edge) => ({ ...edge })) as Edge[];

    return {
      nodes: normalizedNodes,
      edges: normalizedEdges,
    };
  }, [exampleFlowMap, showMobileIntroPreview]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateMobileBlock = () => {
      setIsMobileBlocked(getCurrentMobileBlockState());
    };

    updateMobileBlock();
    window.addEventListener("resize", updateMobileBlock);
    return () => window.removeEventListener("resize", updateMobileBlock);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || !isMobileReadOnly) return;

    const root = document.documentElement;
    const previousSkin = root.dataset.skin;
    root.dataset.skin = "paper";

    return () => {
      if (previousSkin) {
        root.dataset.skin = previousSkin;
      } else {
        delete root.dataset.skin;
      }
    };
  }, [isMobileReadOnly]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (welcomeCompleteRef.current) return;
    try {
      if (window.localStorage.getItem(FIRST_RUN_STORAGE_KEY)) {
        welcomeCompleteRef.current = true;
        return;
      }

      // Shared-link URLs take precedence over onboarding: suppress the welcome
      // dialog so the shared-flow loader can import normally. We do NOT write
      // FIRST_RUN_STORAGE_KEY here so that a plain (non-shared) reload later
      // still shows the dialog.
      const params = new URLSearchParams(window.location.search);
      if (params.get("s") || params.get("share")) {
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

  const showUndoRedoPanelUI = isMobileReadOnly ? false : showUndoRedoPanel;
  const showErrorPanelUI = isMobileReadOnly ? false : showErrorPanel;
  const showSearchPanelUI = isMobileReadOnly ? false : showSearchPanel;
  let rightPanelWidth = 0;
  if (showUndoRedoPanelUI || showErrorPanelUI || showSearchPanelUI) {
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
  } = useNodeOperations();
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const [showInfoNodes, setShowInfoNodes] = useState(true);
  const infoNodeIds = useMemo(
    () =>
      new Set(
        nodes
          .filter((node) => node.type === INFO_NODE_TYPE)
          .map((node) => node.id)
      ),
    [nodes]
  );
  const hasInfoNodes = infoNodeIds.size > 0;
  const displayedNodes = useMemo(
    () => applyInfoNodeVisibility(nodes, showInfoNodes),
    [nodes, showInfoNodes]
  );
  const displayedEdges = useMemo(
    () => applyInfoEdgeVisibility(edges, infoNodeIds, showInfoNodes),
    [edges, infoNodeIds, showInfoNodes]
  );
  const canvasNodes = mobileIntroGraph?.nodes ?? displayedNodes;
  const canvasEdges = mobileIntroGraph?.edges ?? displayedEdges;

  const getSavedNodes = useCallback(() => nodesRef.current, []);
  const getSavedEdges = useCallback(() => edgesRef.current, []);

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
        const rawNext =
          typeof updater === "function"
            ? (updater as (prev: FlowNode[]) => FlowNode[])(prev)
            : updater;
        const next = stripTransientInfoNodeVisibility(rawNext);
        if (next !== prev) incRev();
        return next;
      }),
    [baseSetNodes, incRev]
  );

  const setEdges: typeof baseSetEdges = useCallback(
    (updater) =>
      baseSetEdges((prev) => {
        const rawNext =
          typeof updater === "function"
            ? (updater as (prev: Edge[]) => Edge[])(prev)
            : updater;
        const next = stripTransientInfoEdgeVisibility(
          rawNext,
          new Set(
            nodesRef.current
              .filter((node) => node.type === INFO_NODE_TYPE)
              .map((node) => node.id)
          )
        );
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
    const storeGraphMatches = graphIdsMatchCanonicalOrProjection(
      storeNodes,
      storeEdges,
      pending.nodes,
      pending.edges
    );
    const storeNeedsResync = !storeGraphMatches;

    if (parentMatches && !storeNeedsResync) {
      pendingSharedGraphRef.current = null;
      return;
    }

    if (!parentMatches) {
      setNodes(() => pending.nodes);
      setEdges(() => cloneEdgesForRender(pending.edges));
      saveTabData(pending.tabId, {
        force: true,
        immediate: true,
        data: {
          nodes: pending.nodes,
          edges: pending.edges,
        },
      });
    }

    if (storeNeedsResync) {
      rfSetNodes(pending.nodes);
      rfSetEdges(cloneEdgesForRender(pending.edges));
      const ids = pending.nodes.map((node) => node.id);
      if (ids.length > 0) updateNodeInternals(ids);
    }
  }, [
    rfSetEdges,
    rfSetNodes,
    saveTabData,
    setEdges,
    setNodes,
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
        const storeGraphMatches = graphIdsMatchCanonicalOrProjection(
          storeNodes,
          storeState.edges,
          expectedNodes,
          expectedEdges
        );
        const storeNodesUnmeasured =
          stripGroupBundlePortNodes(storeNodes).length === expectedNodes.length &&
          nodesNeedMeasurement(stripGroupBundlePortNodes(storeNodes));
        const storeNeedsRepair =
          !storeGraphMatches || storeNodesUnmeasured;
        if (!storeNeedsRepair) return;

        if (!storeGraphMatches) {
          rfSetNodes(expectedNodes);
          rfSetEdges(cloneEdgesForRender(expectedEdges));
        }
        if (!storeGraphMatches || storeNodesUnmeasured) {
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
    getSnapshotState: () => ({
      nodes: getSavedNodes(),
      edges: getSavedEdges(),
    }),
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
      pendingExampleViewportRef.current = null;
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

  const scheduleExampleFlowViewport = useCallback(
    (viewport: Viewport) => {
      if (typeof window === "undefined") return;

      clearExampleFitRetryTimers();
      pendingExampleFitRef.current = false;
      pendingFitOptionsRef.current = {};
      pendingExampleViewportRef.current = viewport;

      const currentInstance = flowInstanceRef.current;
      if (currentInstance) {
        currentInstance.setViewport(viewport, { duration: 0 });
        setHasFitOnInitialLoad(true);
      }

      const retryDelays = [0, 24, 72, 140, 240, 380, 560, 800];
      retryDelays.forEach((delay, index) => {
        const timeoutId = window.setTimeout(() => {
          const instance = flowInstanceRef.current;
          if (!instance) {
            if (index === retryDelays.length - 1) {
              pendingExampleViewportRef.current = null;
              clearExampleFitRetryTimers();
            }
            return;
          }

          instance.setViewport(viewport, { duration: 0 });
          setHasFitOnInitialLoad(true);
          pendingExampleViewportRef.current = null;
          clearExampleFitRetryTimers();
        }, delay);
        exampleFitRetryTimeoutIdsRef.current.push(timeoutId);
      });
    },
    [clearExampleFitRetryTimers]
  );

  const clearIntroDropAnimationTimers = useCallback(() => {
    if (typeof window !== "undefined") {
      for (const timeoutId of introDropTimeoutIdsRef.current) {
        window.clearTimeout(timeoutId);
      }
    }
    introDropTimeoutIdsRef.current = [];
    setIntroDropState(null);
  }, []);

  const resetToEmptyCanvas = useCallback(() => {
    restoreScriptSteps([]);
    setNodes(() => []);
    setEdges(() => []);

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
    setTabTooltip,
  ]);

  const loadExampleFlow = useCallback(
    (
      flowId: string,
      options?: {
        placement?: "fit" | "top-left-drop";
        targetTabId?: string;
        skipViewport?: boolean;
      }
    ) => {
      const entry = exampleFlowMap.get(flowId);
      if (!entry) return false;
      const targetTabId = options?.targetTabId ?? activeTabId;

      const clonedData = cloneFlowData(entry.data);
      const displayTitle = getFlowDisplayTitle(entry.label, clonedData.name);
      let nodesFromFlow = Array.isArray(clonedData.nodes)
        ? clonedData.nodes
        : [];
      let edgesFromFlow = Array.isArray(clonedData.edges)
        ? clonedData.edges
        : [];
      let dropViewport: Viewport | null = null;

      if (options?.placement === "top-left-drop") {
        const placed = placeFlowDataAtPosition(
          { ...clonedData, nodes: nodesFromFlow, edges: edgesFromFlow },
          INTRO_FLOW_DROP_FLOW_POSITION.x,
          INTRO_FLOW_DROP_FLOW_POSITION.y
        );
        nodesFromFlow = placed.nodes;
        edgesFromFlow = placed.edges;
        if (placed.anchorPosition) {
          dropViewport = getFlowTemplateViewport(
            INTRO_FLOW_DROP_POINT,
            placed.anchorPosition,
            INTRO_FLOW_DROP_ZOOM
          );
        }
      }

      restoreScriptSteps([]);

      const normalizedNodes = stripLegacyFlowMapNodeData(
        ingestScriptSteps(
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
        )
      );

      const normalizedEdges = edgesFromFlow.map((edge) => ({
        ...edge,
      })) as Edge[];
      setMobileCanvasMode("canvas");
      setNodes(() => normalizedNodes);
      setEdges(() => normalizedEdges);

      refreshBanner(normalizedNodes, targetTabId, {
        immediate: true,
        sticky: false,
      });

      scheduleSnapshot(`Load example: ${displayTitle}`, {
        refresh: true,
        immediate: true,
        tabId: targetTabId,
        state: {
          nodes: normalizedNodes,
          edges: normalizedEdges,
        },
      });
      if (targetTabId) {
        setTabTooltip(targetTabId, `Example: ${displayTitle}`);
        renameTab(targetTabId, displayTitle);
      }

      if (options?.skipViewport) {
        setHasFitOnInitialLoad(true);
      } else if (dropViewport) {
        scheduleExampleFlowViewport(dropViewport);
      } else {
        scheduleExampleFlowFit();
      }

      return true;
    },
    [
      activeTabId,
      exampleFlowMap,
      renameTab,
      refreshBanner,
      scheduleExampleFlowFit,
      scheduleExampleFlowViewport,
      scheduleSnapshot,
      setEdges,
      setNodes,
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

  useEffect(() => {
    if (!initialHydrationDone) return;
    if (isMobileReadOnly) return;
    if (welcomeCompleteRef.current) return;
    if (introDropScheduledRef.current) return;
    if (nodes.length > 0 || edges.length > 0) {
      markWelcomeComplete();
      return;
    }

    const introFlowId = exampleFlowMap.has(INTRO_FLOW_ID)
      ? INTRO_FLOW_ID
      : exampleFlowOptions[0]?.id;

    if (!introFlowId) {
      markWelcomeComplete();
      return;
    }

    introDropScheduledRef.current = true;
    setIsIntroDropAnimating(true);

    const introFlowLabel =
      exampleFlowMap.get(introFlowId)?.label ??
      exampleFlowOptions.find((flow) => flow.id === introFlowId)?.label ??
      "Intro P2PKH";

    if (typeof window === "undefined") {
      const loaded = loadExampleFlow(introFlowId, {
        placement: "top-left-drop",
      });
      if (loaded) markWelcomeComplete();
      setIsIntroDropAnimating(false);
      return;
    }

    const getIntroTargetScreenPosition = () => {
      const reactFlowRect =
        document
          .querySelector<HTMLElement>(".react-flow")
          ?.getBoundingClientRect() ??
        reactFlowWrapper.current?.getBoundingClientRect();
      return {
        x: (reactFlowRect?.left ?? 256) + INTRO_FLOW_DROP_POINT.x,
        y: (reactFlowRect?.top ?? 96) + INTRO_FLOW_DROP_POINT.y,
      };
    };

    const scheduleIntroDropStep = (delay: number, fn: () => void) => {
      const timeoutId = window.setTimeout(() => {
        introDropTimeoutIdsRef.current = introDropTimeoutIdsRef.current.filter(
          (existing) => existing !== timeoutId
        );
        fn();
      }, delay);
      introDropTimeoutIdsRef.current.push(timeoutId);
      return timeoutId;
    };

    setIntroDropState({
      cursor: {
        x: window.innerWidth * 0.55,
        y: window.innerHeight - 80,
      },
      ghost: null,
    });

    scheduleIntroDropStep(INTRO_FLOW_SOURCE_MOVE_MS, () => {
      const sourceCenter = getRectCursorCenter(getIntroDropSourceRect());
      setIntroDropState({ cursor: sourceCenter, ghost: null });
    });

    scheduleIntroDropStep(INTRO_FLOW_SOURCE_PRESS_MS, () => {
      const sourceCenter = getRectCursorCenter(getIntroDropSourceRect());
      setIntroDropState({
        cursor: sourceCenter,
        ghost: null,
        pressing: true,
      });
    });

    scheduleIntroDropStep(INTRO_FLOW_PICKUP_MS, () => {
      const sourceCenter = getRectCursorCenter(getIntroDropSourceRect());
      setIntroDropState({
        cursor: sourceCenter,
        ghost: {
          x: sourceCenter.x - 20,
          y: sourceCenter.y - 18,
          eyebrow: "Flow Examples",
          label: introFlowLabel,
          detail: "Dropping onto canvas",
        },
      });
    });

    scheduleIntroDropStep(INTRO_FLOW_DRAG_MS, () => {
      const targetScreen = getIntroTargetScreenPosition();
      setIntroDropState({
        cursor: targetScreen,
        ghost: {
          x: targetScreen.x - 20,
          y: targetScreen.y - 18,
          eyebrow: "Flow Examples",
          label: introFlowLabel,
          detail: "Dropping onto canvas",
        },
      });
    });

    scheduleIntroDropStep(INTRO_FLOW_DROP_MS, () => {
      const targetScreen = getIntroTargetScreenPosition();
      const loaded = loadExampleFlow(introFlowId, {
        placement: "top-left-drop",
      });
      if (loaded) {
        markWelcomeComplete();
        setIntroDropState({
          cursor: targetScreen,
          ghost: null,
          pressing: true,
        });
      } else {
        introDropScheduledRef.current = false;
        setIsIntroDropAnimating(false);
        setIntroDropState(null);
      }
    });

    scheduleIntroDropStep(INTRO_FLOW_RELEASE_MS, () => {
      setIsIntroDropAnimating(false);
      setIntroDropState({
        cursor: null,
        ghost: null,
        caption: {
          title: "rawBit demo",
          video: {
            src: INTRO_VIDEO_EMBED_URL,
            title: INTRO_VIDEO_TITLE,
          },
        },
        controls: {
          closeLabel: "Close rawBit demo",
          onClose: () => setIntroDropState(null),
        },
      });
    });
  }, [
    exampleFlowMap,
    exampleFlowOptions,
    edges.length,
    initialHydrationDone,
    isMobileReadOnly,
    loadExampleFlow,
    markWelcomeComplete,
    nodes.length,
  ]);

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
      tabId,
    }: {
      nodes: FlowNode[];
      edges: Edge[];
      tabId?: string;
    }) => {
      const targetTabId = tabId ?? activeTabIdRef.current ?? activeTabId;

      setMobileCanvasMode("canvas");
      setNodes(() => nextNodes);
      setEdges(() => cloneEdgesForRender(nextEdges));

      pendingSharedGraphRef.current = {
        tabId: targetTabId,
        nodes: nextNodes,
        edges: nextEdges,
        expiresAt: Date.now() + 5_000,
      };
      clearSharedGraphRepairTimers();

      saveTabData(targetTabId, {
        force: true,
        immediate: true,
        data: {
          nodes: nextNodes,
          edges: nextEdges,
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

  const miniMapSize = useMiniMapSize(nodes, showMiniMap, {
    longSide: MINIMAP_LONG,
    shortSideMin: MINIMAP_SHORT_MIN,
    defaultHeight: 120,
  });

  const nodeClassName = useCallback(
    (n: Node) => {
      if (n.type === GROUP_BUNDLE_PORT_NODE_TYPE) return "minimap-hidden";
      return n.type === "shadcnGroup" ? "minimap-group" : "";
    },
    []
  );

  usePanelAutoClose({
    activeTabId,
    calcStatus,
    errorCount: errorInfo.length,
    showErrorPanel,
    setShowErrorPanel,
    setShowSearchPanel,
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

  /* -------------------------------------------------------------------- */
  /*  Help system — open a help tab, play concept demos, stop demos.      */
  /* -------------------------------------------------------------------- */

  const stopHelpDemo = useCallback(
    (opts?: { clearOverlay?: boolean }) => {
      if (typeof window !== "undefined") {
        for (const id of helpDemoTimersRef.current) {
          window.clearTimeout(id);
        }
      }
      helpDemoTimersRef.current = [];
      // Bump the generation so any in-flight async fast-forward bails out.
      helpDemoPlayGenRef.current += 1;
      // Pause = enter manual mode. Subsequent caption-button navigation will
      // play one step at a time instead of auto-advancing.
      helpDemoModeRef.current = "manual";
      setRunningHelpDemoId(null);
      setHelpSidebarSearch(undefined);
      setHelpSidebarHighlight(undefined);
      if (opts?.clearOverlay) {
        setIntroDropState(null);
        setCurrentHelpDemo(null);
        return;
      }
      // Keep the caption + controls card visible so the user can Play / Prev /
      // Next / Replay.
      setIntroDropState((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          cursor: null,
          ghost: null,
          pressing: false,
          connection: null,
          controls: prev.controls
            ? { ...prev.controls, isPlaying: false }
            : prev.controls,
        };
      });
    },
    [],
  );

  const openHelpTab = useCallback(() => {
    const createHelpTab = () => {
      const newId = addTab();
      renameTab(newId, "Help");
      setTabTooltip(newId, "Help — concept demos on canvas");
      selectTab(newId);
      setHelpTabIds((prev) => {
        const next = new Set(prev);
        next.add(newId);
        return next;
      });
    };

    const activeIsHelp =
      activeTabId !== null &&
      activeTabId !== undefined &&
      helpTabIds.has(activeTabId);
    if (activeIsHelp) {
      stopHelpDemo({ clearOverlay: true });
      createHelpTab();
      return;
    }

    const existing = tabs.find((tab) => helpTabIds.has(tab.id));
    if (existing) {
      selectTab(existing.id);
      return;
    }
    createHelpTab();
  }, [
    activeTabId,
    addTab,
    helpTabIds,
    renameTab,
    selectTab,
    setTabTooltip,
    stopHelpDemo,
    tabs,
  ]);

  const flowToScreen = useCallback((point: { x: number; y: number }) => {
    const instance = flowInstanceRef.current;
    if (instance && typeof instance.flowToScreenPosition === "function") {
      return instance.flowToScreenPosition(point);
    }
    const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect();
    return {
      x: (wrapperRect?.left ?? 256) + point.x,
      y: (wrapperRect?.top ?? 96) + point.y,
    };
  }, []);

  const buildHelpControls = useCallback(
    (
      demo: HelpDemo,
      stepIdx: number,
      isPlaying: boolean,
    ): NonNullable<IntroDropOverlayState["controls"]> => {
      const lastIdx = demo.steps.length - 1;
      return {
        onPause: () => stopHelpDemoRef.current(),
        // These controls are explicit step navigation. They always play one
        // step and stop, even if the demo was previously auto-playing.
        onPlay: () => {
          helpDemoModeRef.current = "manual";
          playHelpStepRef.current(demo, stepIdx);
        },
        onPrev: () => {
          helpDemoModeRef.current = "manual";
          playHelpStepRef.current(demo, Math.max(0, stepIdx - 1));
        },
        onNext: () => {
          helpDemoModeRef.current = "manual";
          playHelpStepRef.current(demo, Math.min(lastIdx, stepIdx + 1));
        },
        // Restart explicitly re-enters auto-play so the whole demo runs again.
        onReplay: () => {
          helpDemoModeRef.current = "auto";
          playHelpStepRef.current(demo, 0);
        },
        isPlaying,
        canPrev: stepIdx > 0,
        canNext: stepIdx < lastIdx,
        stepLabel: `${stepIdx + 1} / ${demo.steps.length}`,
      };
    },
    [],
  );

  const buildStepContext = useCallback(
    (
      demo: HelpDemo,
      stepIdx: number,
      mode: "play" | "instant",
      generation: number,
    ): DemoStepContext => {
      const baseCaption = demo.steps[stepIdx]?.caption ?? null;
      let activeCaption: IntroDropOverlayState["caption"] = baseCaption;
      const controls = buildHelpControls(demo, stepIdx, true);
      const isActive = () => generation === helpDemoPlayGenRef.current;

      const setOverlayPlay: DemoStepContext["setOverlay"] = (state) => {
        if (!isActive()) return;
        if (state === null) {
          activeCaption = null;
          setIntroDropState((prev) => (isActive() ? null : prev));
          return;
        }
        if ("caption" in state && state.caption !== undefined) {
          activeCaption = state.caption ?? null;
        }
        const nextState = { ...state, caption: activeCaption, controls };
        setIntroDropState((prev) => (isActive() ? nextState : prev));
      };

      const noopOverlay: DemoStepContext["setOverlay"] = () => {};

      const playScheduler: DemoStepContext["scheduleStep"] = (delayMs, fn) => {
        if (typeof window === "undefined") {
          if (isActive()) fn();
          return;
        }
        const id = window.setTimeout(() => {
          helpDemoTimersRef.current = helpDemoTimersRef.current.filter(
            (existing) => existing !== id,
          );
          if (!isActive()) return;
          fn();
        }, delayMs);
        helpDemoTimersRef.current.push(id);
      };

      const instantScheduler: DemoStepContext["scheduleStep"] = (_d, fn) =>
        isActive() && fn();

      return {
        setOverlay: mode === "play" ? setOverlayPlay : noopOverlay,
        setSidebarSearch: (value) => {
          if (isActive()) {
            setHelpSidebarSearch((prev) => (isActive() ? value : prev));
          }
        },
        setSidebarHighlightLabel: (label) => {
          if (isActive()) {
            setHelpSidebarHighlight((prev) => (isActive() ? label : prev));
          }
        },
        setNodes: (updater) => {
          if (isActive()) {
            setNodes((prev) => (isActive() ? updater(prev) : prev));
          }
        },
        setEdges: (updater) => {
          if (isActive()) {
            setEdges((prev) => (isActive() ? updater(prev) : prev));
          }
        },
        scheduleStep: mode === "play" ? playScheduler : instantScheduler,
        flowToScreen,
        setViewport: (viewport) => {
          if (isActive()) {
            flowInstanceRef.current?.setViewport(viewport, { duration: 0 });
          }
        },
        isRunning: () =>
          isActive() && helpDemoTimersRef.current.length > 0,
      };
    },
    [buildHelpControls, flowToScreen, setEdges, setNodes],
  );

  const playHelpDemoFromStep = useCallback(
    async (demo: HelpDemo, stepIdxRaw: number) => {
      if (demo.steps.length === 0) return;
      const targetIdx = Math.max(
        0,
        Math.min(demo.steps.length - 1, stepIdxRaw),
      );

      // Cancel anything currently in flight (timers + stale async loops).
      if (typeof window !== "undefined") {
        for (const id of helpDemoTimersRef.current) {
          window.clearTimeout(id);
        }
      }
      helpDemoTimersRef.current = [];
      const myGen = ++helpDemoPlayGenRef.current;

      setCurrentHelpDemo(demo);
      setRunningHelpDemoId(demo.id);
      setHelpSidebarSearch(undefined);
      setHelpSidebarHighlight(undefined);

      // 1. Demo init runs in normal-play mode so any state setters work.
      const initCtx = buildStepContext(demo, targetIdx, "play", myGen);
      demo.init?.(initCtx);

      // Wait one frame so init's React state changes commit before we start
      // dispatching DOM events for fast-forward.
      await new Promise<void>((resolve) => {
        if (typeof window === "undefined") {
          resolve();
          return;
        }
        requestAnimationFrame(() => resolve());
      });
      if (myGen !== helpDemoPlayGenRef.current) return;

      // 2. Fast-forward through every prior step.
      for (let i = 0; i < targetIdx; i += 1) {
        const ffCtx = buildStepContext(demo, i, "instant", myGen);
        demo.steps[i].play(ffCtx);
        // Two frames: one for React to commit, one for portals (Radix, Dialog)
        // to mount before the next instant step dispatches against them.
        await new Promise<void>((resolve) => {
          if (typeof window === "undefined") {
            resolve();
            return;
          }
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve()),
          );
        });
        if (myGen !== helpDemoPlayGenRef.current) return;
      }
      if (myGen !== helpDemoPlayGenRef.current) return;

      // 3. Show this step's caption + controls before its animations run.
      const targetControls = buildHelpControls(demo, targetIdx, true);
      setIntroDropState({
        cursor: null,
        ghost: null,
        caption: demo.steps[targetIdx].caption,
        controls: targetControls,
      });

      // 4. Play the target step normally.
      const playCtx = buildStepContext(demo, targetIdx, "play", myGen);
      demo.steps[targetIdx].play(playCtx);

      // 5. After the step's animations finish, either auto-advance (auto mode
      //    and not the last step) or stop (manual mode, or end of demo).
      const isLast = targetIdx === demo.steps.length - 1;
      const advanceDelay = demo.steps[targetIdx].durationMs;
      if (typeof window !== "undefined") {
        const id = window.setTimeout(() => {
          helpDemoTimersRef.current = helpDemoTimersRef.current.filter(
            (existing) => existing !== id,
          );
          if (myGen !== helpDemoPlayGenRef.current) return;
          const shouldAdvance =
            !isLast && helpDemoModeRef.current === "auto";
          if (shouldAdvance) {
            playHelpStepRef.current(demo, targetIdx + 1);
          } else {
            setRunningHelpDemoId(null);
            setIntroDropState((prev) => {
              if (!prev || !prev.controls) return prev;
              return {
                ...prev,
                controls: { ...prev.controls, isPlaying: false },
              };
            });
          }
        }, advanceDelay);
        helpDemoTimersRef.current.push(id);
      }
    },
    [buildHelpControls, buildStepContext],
  );

  // HelpMenu's "Play" button keeps the simpler `(demo) => void` signature.
  // Clicking it (re)enters auto-play mode — the demo runs through every step.
  const runHelpDemo = useCallback(
    (demo: HelpDemo) => {
      helpDemoModeRef.current = "auto";
      void playHelpDemoFromStep(demo, 0);
    },
    [playHelpDemoFromStep],
  );

  // Keep the playback-button refs pointing at the latest impls.
  useEffect(() => {
    stopHelpDemoRef.current = stopHelpDemo;
  }, [stopHelpDemo]);
  useEffect(() => {
    playHelpStepRef.current = (demo, idx) => {
      void playHelpDemoFromStep(demo, idx);
    };
  }, [playHelpDemoFromStep]);

  // Leaving the help tab cancels the demo AND clears its overlay/caption,
  // since the user has moved on. Staying on the help tab keeps the caption
  // card visible after the demo finishes (so Replay still works).
  // Gated on currentHelpDemo so we don't accidentally clear the first-run
  // intro video overlay (which also uses introDropState but isn't a demo).
  useEffect(() => {
    if (currentHelpDemo === null) return;
    const onHelpTab =
      activeTabId !== null &&
      activeTabId !== undefined &&
      helpTabIds.has(activeTabId);
    if (onHelpTab) return;
    if (runningHelpDemoId !== null) {
      stopHelpDemo({ clearOverlay: true });
    } else {
      setIntroDropState(null);
      setCurrentHelpDemo(null);
    }
  }, [
    activeTabId,
    currentHelpDemo,
    helpTabIds,
    runningHelpDemoId,
    stopHelpDemo,
  ]);

  // Drop closed tabs from the help-tab set so it doesn't leak.
  useEffect(() => {
    setHelpTabIds((prev) => {
      const liveIds = new Set(tabs.map((tab) => tab.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (liveIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [tabs]);

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
    canConnect: canConnectSelectedNodes,
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

  const handleBundleEdgesSelect = useCallback(
    (edgeIds: string[]) => {
      const selectedEdgeIds = new Set(edgeIds);

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
          const shouldSelect = selectedEdgeIds.has(edge.id);
          if ((edge.selected === true) === shouldSelect) return edge;
          mutated = true;
          return { ...edge, selected: shouldSelect };
        });
        return mutated ? next : existing;
      });
    },
    [setEdges, setNodes]
  );

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

  const ensureShareImportTab = useCallback(() => addTab(), [addTab]);

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
    const canonicalSnap = sanitizeGroupBundleVisualElementsForState({
      nodes: snap.nodes,
      edges: snap.edges,
    });
    const restoredNodes = canonicalSnap.nodes.map((n: FlowNode) => ({
      ...n,
      data: { ...n.data, dirty: false },
    }));
    const restoredEdges = canonicalSnap.edges.map((e: Edge) => ({
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
        if (pendingExampleViewportRef.current) {
          instance.setViewport(pendingExampleViewportRef.current, {
            duration: 0,
          });
          pendingExampleViewportRef.current = null;
          clearExampleFitRetryTimers();
          setHasFitOnInitialLoad(true);
        } else if (showMobileIntroPreview) {
          const overviewNode = findOverviewNode(canvasNodes);
          if (overviewNode) {
            instance.setViewport(
              getFlowTemplateViewport(
                MOBILE_INTRO_OVERVIEW_POINT,
                overviewNode.position,
                MOBILE_INTRO_OVERVIEW_ZOOM
              ),
              { duration: 0 }
            );
            setHasFitOnInitialLoad(true);
          }
        } else if (
          !pendingExampleFitRef.current &&
          !hasFitOnInitialLoad &&
          (canvasNodes.length || canvasEdges.length) &&
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
      canvasNodes,
      canvasEdges,
      history.length,
      initializeTabHistory,
      activeTabId,
      hasFitOnInitialLoad,
      initialHydrationDone,
      showMobileIntroPreview,
      clearExampleFitRetryTimers,
      fitCurrentGraphIntoView,
    ]
  );

  useEffect(
    () => () => {
      pendingExampleFitRef.current = false;
      pendingFitOptionsRef.current = {};
      pendingExampleViewportRef.current = null;
      introDropScheduledRef.current = false;
      clearExampleFitRetryTimers();
      clearIntroDropAnimationTimers();
      clearSharedGraphRepairTimers();
    },
    [
      clearExampleFitRetryTimers,
      clearIntroDropAnimationTimers,
      clearSharedGraphRepairTimers,
    ]
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

  const isActiveHelpTab =
    activeTabId !== null &&
    activeTabId !== undefined &&
    helpTabIds.has(activeTabId);

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
              onToggleColorPalette={handleToggleColorPalette}
              isColorPaletteOpen={isColorPaletteOpen}
              canColorSelection={canColorSelection}
              canGroupSelectedNodes={canGroupSelectedNodes}
              canUngroupSelectedNodes={canUngroupSelectedNodes}
              connectDisabled={!(exactlyTwoSelected && canConnectSelectedNodes)}
              onConnectClick={() => setConnectOpen(true)}
              onGroup={groupWithUndo}
              onUngroup={ungroupWithUndo}
              onSearchClick={() => {
                setShowUndoRedoPanel(false); // never overlap
                setShowErrorPanel(false);
                setShowSearchPanel((v) => !v); // toggle
              }}
              setShowSearchPanel={setShowSearchPanel}
              showMiniMap={showMiniMap}
              onToggleMiniMap={() => setShowMiniMap((v) => !v)}
              showInfoNodes={showInfoNodes}
              hasInfoNodes={hasInfoNodes}
              onToggleInfoNodes={() => setShowInfoNodes((v) => !v)}
              isSelectionModeActive={isSelectionMode}
              onToggleSelectionMode={() => setIsSelectionLocked((v) => !v)}
              onShare={handleShareClick}
              shareDisabled={nodes.length === 0}
              onHelpClick={openHelpTab}
              tabBarRightInset={rightPanelWidth}
            />
          )}

          {/* Sidebar */}
          {!isMobileReadOnly && (
            <Sidebar
              isOpen={isSidebarOpen}
              onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
              introDropFlowId={isIntroDropAnimating ? INTRO_FLOW_ID : undefined}
              introDropNodeLabel={helpSidebarHighlight}
              searchOverride={helpSidebarSearch}
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
                nodes={canvasNodes}
                edges={canvasEdges}
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
                onDrop={(event) => {
                  const demoId = event.dataTransfer.getData(
                    "application/x-rawbit-help-demo",
                  );
                  if (demoId) {
                    event.preventDefault();
                    const demo = HELP_DEMOS.find((d) => d.id === demoId);
                    if (demo) runHelpDemo(demo);
                    return;
                  }
                  onDropWithUndo(event);
                }}
                onDragOver={onDragOver}
                onNodeDragStop={onNodeDragStopWithUndo}
                onPaneClick={handlePaneClick}
                onBundleEdgesSelect={handleBundleEdgesSelect}
                onMoveEnd={onMoveEnd}
                isSelectionModeActive={isSelectionMode}
                isReadOnly={isMobileReadOnly}
                onlyRenderVisibleElements
              />
              {isMobileReadOnly && (
                <div className="pointer-events-none absolute inset-x-0 top-4 mx-auto w-11/12 max-w-md">
                  <div className="pointer-events-auto rounded-lg border border-border bg-background/90 px-4 py-3 text-center text-sm font-medium shadow-sm backdrop-blur">
                    <div className="leading-snug">
                      raw₿it is optimized for desktop. Mobile opens flows in
                      read-only mode.
                    </div>
                    <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <div aria-hidden="true" />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs font-medium"
                        onClick={() => setShowWelcomeDialog(true)}
                      >
                        Load example flow
                      </Button>
                      <div className="flex shrink-0 items-center justify-end gap-1">
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
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                edges={edges}
                centerOnNode={centerOnNode}
                focusSearchHit={focusSearchHit}
                hasMultipleTabs={tabs.length > 0}
              />
            )}
          </main>

          <IntroDropOverlay
            state={introDropState}
            captionRightInset={
              isActiveHelpTab ? 256 /* HelpMenu width = w-64 */ : 0
            }
          />

          {!isMobileReadOnly && (
            <HelpMenu
              isOpen={isActiveHelpTab}
              runningDemoId={runningHelpDemoId}
              onPlayDemo={runHelpDemo}
              onStopDemo={() => stopHelpDemo()}
              onCloseHelpTab={
                isActiveHelpTab && activeTabId
                  ? () => handleCloseTab(activeTabId)
                  : undefined
              }
            />
          )}

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
            flows={
              isMobileReadOnly ? mobileExampleFlowOptions : exampleFlowOptions
            }
            onStartEmpty={handleWelcomeStartEmpty}
            onLoadExample={handleWelcomeLoadExample}
            hideStartEmpty={isMobileReadOnly}
            onOpenChange={(open) => {
              setShowWelcomeDialog(open);
              if (!open) markWelcomeComplete();
            }}
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
