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
import { Walkthrough } from "@/components/walkthrough/Walkthrough";
import {
  AutoDemoOverlay,
  type AutoDemoOverlayState,
} from "@/components/AutoDemoOverlay";
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
import { allSidebarNodes } from "@/components/sidebar-nodes";
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
const INTRO_FLOW_DROP_POINT = { x: 0, y: 0 };
const INTRO_FLOW_DROP_ZOOM = 0.2;
const MOBILE_INTRO_OVERVIEW_POINT = { x: 16, y: 150 };
const MOBILE_INTRO_OVERVIEW_ZOOM = 0.2;
const INTRO_FLOW_DROP_ANIMATION_MS = 1100;
const INTRO_SOURCE_FALLBACK = { x: 76, y: 780 };
const INTRO_SOURCE_CARD_SIZE = { width: 196, height: 96 };
const SHARED_IMPORT_FIT_MIN_ZOOM = 0.2;
const WALKTHROUGH_STORAGE_KEY = "rawbit.ui.walkthroughSeen";
const WALKTHROUGH_TEMPLATE_LABEL = "TX Template legacy";
const WALKTHROUGH_INPUT_LABEL = "Input";
const WALKTHROUGH_TAB_TITLE = "Walkthrough";
const WALKTHROUGH_INPUT_STEP_INDEX = 1;
const WALKTHROUGH_TX_TEMPLATE_STEP_INDEX = 2;
const WALKTHROUGH_FIELDS_STEP_INDEX = 3;
const WALKTHROUGH_CONNECT_STEP_INDEX = 4;
const WALKTHROUGH_INPUT_NODE_ID = "node_walkthrough_input_version";
const WALKTHROUGH_TEMPLATE_NODE_ID = "node_walkthrough_tx_template_legacy";
const WALKTHROUGH_EDGE_ID = "edge_walkthrough_input_to_tx_version";
const WALKTHROUGH_INPUT_POSITION = { x: 120, y: 120 };
const WALKTHROUGH_TEMPLATE_POSITION = { x: 430, y: 110 };
const WALKTHROUGH_FIELD_VALUES: Record<number, string> = {
  0: "01000000",
  10: "01",
  2000: "01",
  4000: "00000000",
};
const WALKTHROUGH_DROP_ANIMATION_MS = 980;

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

function getSidebarNodeSourceRect(label: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (typeof document === "undefined") {
    return { ...INTRO_SOURCE_FALLBACK, ...INTRO_SOURCE_CARD_SIZE };
  }

  const source = Array.from(
    document.querySelectorAll<HTMLElement>("[data-node-template-label]")
  ).find((element) => element.dataset.nodeTemplateLabel === label);

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

function FlowContent() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showUndoRedoPanel, setShowUndoRedoPanel] = useState(false);
  const [showErrorPanel, setShowErrorPanel] = useState(false);

  // 🔍 search-panel state
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showWelcomeDialog, setShowWelcomeDialog] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [isIntroDropAnimating, setIsIntroDropAnimating] = useState(false);
  const [introDropSourceRect, setIntroDropSourceRect] = useState(() =>
    getIntroDropSourceRect()
  );
  const [walkthroughDropNodeLabel, setWalkthroughDropNodeLabel] = useState<
    string | undefined
  >();
  const [walkthroughDropAnimation, setWalkthroughDropAnimation] = useState<{
    label: string;
    title: string;
    detail: string;
    sourceRect: { x: number; y: number; width: number; height: number };
    targetRect: { x: number; y: number };
  } | null>(null);
  const [autoDemoState, setAutoDemoState] =
    useState<AutoDemoOverlayState | null>(null);
  const autoDemoTimeoutIdsRef = useRef<number[]>([]);
  const autoDemoRunningRef = useRef(false);

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
  const walkthroughAutoStartedRef = useRef(false);
  const walkthroughTabCreatedRef = useRef(false);
  const walkthroughLastAppliedStepRef = useRef<number | null>(null);
  const walkthroughAnimatedStepsRef = useRef<Set<number>>(new Set());
  const introDropScheduledRef = useRef(false);
  const introDropTimeoutIdsRef = useRef<number[]>([]);
  const walkthroughDropTimeoutIdsRef = useRef<number[]>([]);
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
  const walkthroughTxTemplate = useMemo(
    () =>
      allSidebarNodes.find(
        (node) => node.label === WALKTHROUGH_TEMPLATE_LABEL
      ),
    []
  );
  const walkthroughInputTemplate = useMemo(
    () => allSidebarNodes.find((node) => node.label === WALKTHROUGH_INPUT_LABEL),
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

  const markWalkthroughComplete = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(WALKTHROUGH_STORAGE_KEY, "1");
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
    if (typeof window === "undefined") return;
    if (introDropTimeoutIdsRef.current.length === 0) return;
    for (const timeoutId of introDropTimeoutIdsRef.current) {
      window.clearTimeout(timeoutId);
    }
    introDropTimeoutIdsRef.current = [];
  }, []);

  const clearWalkthroughDropAnimationTimers = useCallback(() => {
    if (typeof window === "undefined") return;
    if (walkthroughDropTimeoutIdsRef.current.length === 0) return;
    for (const timeoutId of walkthroughDropTimeoutIdsRef.current) {
      window.clearTimeout(timeoutId);
    }
    walkthroughDropTimeoutIdsRef.current = [];
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
      options?: { placement?: "fit" | "top-left-drop" }
    ) => {
      const entry = exampleFlowMap.get(flowId);
      if (!entry) return false;

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

      refreshBanner(normalizedNodes, activeTabId, {
        immediate: true,
        sticky: false,
      });

      scheduleSnapshot(`Load example: ${displayTitle}`, { refresh: true });
      if (activeTabId) {
        setTabTooltip(activeTabId, `Example: ${displayTitle}`);
        renameTab(activeTabId, displayTitle);
      }

      if (dropViewport) {
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

  const closeWalkthrough = useCallback(() => {
    setShowWalkthrough(false);
    setWalkthroughDropNodeLabel(undefined);
    setWalkthroughDropAnimation(null);
    clearWalkthroughDropAnimationTimers();
    markWalkthroughComplete();
  }, [clearWalkthroughDropAnimationTimers, markWalkthroughComplete]);

  const openWalkthrough = useCallback(() => {
    walkthroughTabCreatedRef.current = false;
    walkthroughLastAppliedStepRef.current = null;
    walkthroughAnimatedStepsRef.current = new Set();
    clearWalkthroughDropAnimationTimers();
    setWalkthroughDropNodeLabel(undefined);
    setWalkthroughDropAnimation(null);
    setIsSidebarOpen(true);
    setShowUndoRedoPanel(false);
    setShowErrorPanel(false);
    setShowSearchPanel(false);
    setShowWalkthrough(true);
  }, [clearWalkthroughDropAnimationTimers]);

  const triggerWalkthroughDropAnimation = useCallback(
    (
      stepIndex: number,
      label: string,
      targetPosition: { x: number; y: number },
      title: string,
      detail: string
    ) => {
      if (typeof window === "undefined") return;
      if (walkthroughAnimatedStepsRef.current.has(stepIndex)) return;

      walkthroughAnimatedStepsRef.current.add(stepIndex);
      clearWalkthroughDropAnimationTimers();
      setWalkthroughDropNodeLabel(label);

      const startTimeoutId = window.setTimeout(() => {
        const sourceRect = getSidebarNodeSourceRect(label);
        const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect();
        const targetRect = wrapperRect
          ? {
              x: wrapperRect.left + targetPosition.x,
              y: wrapperRect.top + targetPosition.y,
            }
          : { x: 320, y: 180 };

        setWalkthroughDropAnimation({
          label,
          title,
          detail,
          sourceRect,
          targetRect,
        });
      }, 120);

      const stopTimeoutId = window.setTimeout(() => {
        setWalkthroughDropAnimation(null);
        setWalkthroughDropNodeLabel(undefined);
        walkthroughDropTimeoutIdsRef.current =
          walkthroughDropTimeoutIdsRef.current.filter(
            (id) => id !== startTimeoutId && id !== stopTimeoutId
          );
      }, WALKTHROUGH_DROP_ANIMATION_MS + 260);

      walkthroughDropTimeoutIdsRef.current.push(
        startTimeoutId,
        stopTimeoutId
      );
    },
    [clearWalkthroughDropAnimationTimers]
  );

  const buildWalkthroughDemoGraph = useCallback(
    (stepIndex: number) => {
      const nodesForStep: FlowNode[] = [];
      const edgesForStep: Edge[] = [];

      if (stepIndex >= WALKTHROUGH_INPUT_STEP_INDEX && walkthroughInputTemplate) {
        const inputData = cloneStructuredData(walkthroughInputTemplate.nodeData);
        nodesForStep.push({
          id: WALKTHROUGH_INPUT_NODE_ID,
          type: walkthroughInputTemplate.type,
          position: WALKTHROUGH_INPUT_POSITION,
          selected: stepIndex === WALKTHROUGH_INPUT_STEP_INDEX,
          data: {
            ...inputData,
            value: "01000000",
            inputs: { ...(inputData.inputs ?? {}), val: "01000000" },
            result: "01000000",
            dirty: false,
          },
        });
      }

      if (stepIndex >= WALKTHROUGH_TX_TEMPLATE_STEP_INDEX && walkthroughTxTemplate) {
        const txData = cloneStructuredData(walkthroughTxTemplate.nodeData);
        const filledValues =
          stepIndex >= WALKTHROUGH_FIELDS_STEP_INDEX
            ? WALKTHROUGH_FIELD_VALUES
            : txData.inputs?.vals ?? {};
        nodesForStep.push({
          id: WALKTHROUGH_TEMPLATE_NODE_ID,
          type: walkthroughTxTemplate.type,
          position: WALKTHROUGH_TEMPLATE_POSITION,
          selected: stepIndex >= WALKTHROUGH_TX_TEMPLATE_STEP_INDEX,
          data: {
            ...txData,
            inputs: {
              ...(txData.inputs ?? {}),
              vals: filledValues,
            },
            dirty: stepIndex >= WALKTHROUGH_CONNECT_STEP_INDEX,
          },
        });
      }

      if (stepIndex >= WALKTHROUGH_CONNECT_STEP_INDEX) {
        edgesForStep.push({
          id: WALKTHROUGH_EDGE_ID,
          source: WALKTHROUGH_INPUT_NODE_ID,
          target: WALKTHROUGH_TEMPLATE_NODE_ID,
          targetHandle: "input-0",
        });
      }

      return { nodes: nodesForStep, edges: edgesForStep };
    },
    [walkthroughInputTemplate, walkthroughTxTemplate]
  );

  const applyWalkthroughDemoStep = useCallback(
    (stepIndex: number) => {
      if (stepIndex < WALKTHROUGH_INPUT_STEP_INDEX) return;
      if (!walkthroughInputTemplate || !walkthroughTxTemplate) return;
      if (walkthroughLastAppliedStepRef.current === stepIndex) return;
      walkthroughLastAppliedStepRef.current = stepIndex;

      if (!walkthroughTabCreatedRef.current) {
        walkthroughTabCreatedRef.current = true;
        const tabId = addTab();
        renameTab(tabId, WALKTHROUGH_TAB_TITLE);
        setTabTooltip(tabId, "Walkthrough demo");
      }

      const graph = buildWalkthroughDemoGraph(stepIndex);
      setNodes(() => graph.nodes);
      setEdges(() => graph.edges);
      scheduleSnapshot(`Walkthrough: step ${stepIndex + 1}`, {
        refresh: true,
      });

      if (stepIndex === WALKTHROUGH_INPUT_STEP_INDEX) {
        triggerWalkthroughDropAnimation(
          stepIndex,
          WALKTHROUGH_INPUT_LABEL,
          WALKTHROUGH_INPUT_POSITION,
          "Input",
          "Dropping onto canvas"
        );
      } else if (stepIndex === WALKTHROUGH_TX_TEMPLATE_STEP_INDEX) {
        triggerWalkthroughDropAnimation(
          stepIndex,
          WALKTHROUGH_TEMPLATE_LABEL,
          WALKTHROUGH_TEMPLATE_POSITION,
          "TX Template legacy",
          "Dropping onto canvas"
        );
      }
    },
    [
      addTab,
      buildWalkthroughDemoGraph,
      renameTab,
      scheduleSnapshot,
      setEdges,
      setNodes,
      setTabTooltip,
      triggerWalkthroughDropAnimation,
      walkthroughInputTemplate,
      walkthroughTxTemplate,
    ]
  );

  const handleWalkthroughStepChange = useCallback(
    (stepIndex: number) => {
      applyWalkthroughDemoStep(stepIndex);
    },
    [applyWalkthroughDemoStep]
  );

  /* ---------------------------------------------------------------------- */
  /*  Auto demo — animates a fake cursor that drops a node and types into   */
  /*  its value field, so a first-time user can watch the workflow happen.  */
  /* ---------------------------------------------------------------------- */

  const clearAutoDemoTimers = useCallback(() => {
    if (typeof window === "undefined") return;
    for (const id of autoDemoTimeoutIdsRef.current) {
      window.clearTimeout(id);
    }
    autoDemoTimeoutIdsRef.current = [];
  }, []);

  const scheduleAutoDemoStep = useCallback(
    (delay: number, fn: () => void) => {
      if (typeof window === "undefined") {
        fn();
        return;
      }
      const id = window.setTimeout(() => {
        autoDemoTimeoutIdsRef.current = autoDemoTimeoutIdsRef.current.filter(
          (existing) => existing !== id
        );
        fn();
      }, delay);
      autoDemoTimeoutIdsRef.current.push(id);
    },
    []
  );

  const stopAutoDemo = useCallback(() => {
    clearAutoDemoTimers();
    autoDemoRunningRef.current = false;
    setAutoDemoState(null);
    setWalkthroughDropNodeLabel(undefined);
  }, [clearAutoDemoTimers]);

  const runAutoDemo = useCallback(() => {
    if (autoDemoRunningRef.current) return;
    if (!walkthroughInputTemplate) return;
    if (typeof window === "undefined") return;

    autoDemoRunningRef.current = true;
    clearAutoDemoTimers();

    setIsSidebarOpen(true);
    setShowUndoRedoPanel(false);
    setShowErrorPanel(false);
    setShowSearchPanel(false);
    setShowWalkthrough(false);

    const tabId = addTab();
    renameTab(tabId, "Auto Demo");
    setTabTooltip(tabId, "Auto demo");

    // Highlight the Input sidebar card so the category expands & it scrolls
    // into view before the fake cursor reaches it.
    setWalkthroughDropNodeLabel(WALKTHROUGH_INPUT_LABEL);

    // Resting position (off-screen-ish, lower right) for the cursor to fly
    // in from. Using fixed-coord screen positions everywhere.
    const startX = window.innerWidth * 0.55;
    const startY = window.innerHeight - 80;

    // Show cursor at the starting position immediately. CSS transitions on
    // the overlay handle smooth interpolation to every next waypoint.
    setAutoDemoState({
      cursor: { x: startX, y: startY },
      ghost: null,
    });

    const inputTemplate = walkthroughInputTemplate;
    const dropFlowPosition = { x: 220, y: 180 };
    const demoNodeId = "node_auto_demo_input";
    const typedValue = "01000000";

    // t=350ms: snap to the sidebar Input card. The card may not be in view
    // yet (the category was just expanded), so we read its rect lazily.
    scheduleAutoDemoStep(350, () => {
      const sidebarRect = getSidebarNodeSourceRect(WALKTHROUGH_INPUT_LABEL);
      const sidebarCenter = {
        x: sidebarRect.x + sidebarRect.width / 2 - 4,
        y: sidebarRect.y + sidebarRect.height / 2 - 4,
      };
      setAutoDemoState({ cursor: sidebarCenter, ghost: null });
    });

    // t=1050ms: press down — show the press animation. No ghost yet.
    scheduleAutoDemoStep(1050, () => {
      const sidebarRect = getSidebarNodeSourceRect(WALKTHROUGH_INPUT_LABEL);
      const sidebarCenter = {
        x: sidebarRect.x + sidebarRect.width / 2 - 4,
        y: sidebarRect.y + sidebarRect.height / 2 - 4,
      };
      setAutoDemoState({
        cursor: sidebarCenter,
        ghost: null,
        pressing: true,
      });
    });

    // t=1250ms: pickup — ghost card appears under the cursor.
    scheduleAutoDemoStep(1250, () => {
      const sidebarRect = getSidebarNodeSourceRect(WALKTHROUGH_INPUT_LABEL);
      const sidebarCenter = {
        x: sidebarRect.x + sidebarRect.width / 2 - 4,
        y: sidebarRect.y + sidebarRect.height / 2 - 4,
      };
      setAutoDemoState({
        cursor: sidebarCenter,
        ghost: {
          x: sidebarCenter.x - 20,
          y: sidebarCenter.y - 18,
          label: inputTemplate.label,
        },
      });
    });

    // t=1500ms: drag — cursor + ghost glide to the canvas target.
    scheduleAutoDemoStep(1500, () => {
      const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect();
      const instance = flowInstanceRef.current;
      let targetScreen: { x: number; y: number };
      if (instance && wrapperRect) {
        const projected = instance.flowToScreenPosition(dropFlowPosition);
        targetScreen = { x: projected.x, y: projected.y };
      } else {
        targetScreen = {
          x: (wrapperRect?.left ?? 256) + 380,
          y: (wrapperRect?.top ?? 96) + 160,
        };
      }
      setAutoDemoState({
        cursor: targetScreen,
        ghost: {
          x: targetScreen.x - 20,
          y: targetScreen.y - 18,
          label: inputTemplate.label,
        },
      });
    });

    // t=2250ms: drop — add the real node, hide the ghost, press tick.
    scheduleAutoDemoStep(2250, () => {
      const baseData = cloneStructuredData(inputTemplate.nodeData) as Record<
        string,
        unknown
      >;
      const dropped: FlowNode = {
        id: demoNodeId,
        type: inputTemplate.type,
        position: dropFlowPosition,
        selected: true,
        data: {
          ...baseData,
          value: "",
          inputs: { ...(baseData.inputs as object | undefined ?? {}), val: "" },
          result: "",
          dirty: false,
        } as FlowNode["data"],
      };
      setNodes(() => [dropped]);
      setEdges(() => []);

      const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect();
      const instance = flowInstanceRef.current;
      const projected =
        instance && wrapperRect
          ? instance.flowToScreenPosition(dropFlowPosition)
          : {
              x: (wrapperRect?.left ?? 256) + 380,
              y: (wrapperRect?.top ?? 96) + 160,
            };
      setAutoDemoState({
        cursor: { x: projected.x, y: projected.y },
        ghost: null,
        pressing: true,
      });
      setWalkthroughDropNodeLabel(undefined);
    });

    // t=2700ms: move cursor onto the node's value input field
    scheduleAutoDemoStep(2700, () => {
      const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect();
      const instance = flowInstanceRef.current;
      const projected =
        instance && wrapperRect
          ? instance.flowToScreenPosition({
              x: dropFlowPosition.x + 70,
              y: dropFlowPosition.y + 95,
            })
          : {
              x: (wrapperRect?.left ?? 256) + 450,
              y: (wrapperRect?.top ?? 96) + 255,
            };
      setAutoDemoState({
        cursor: { x: projected.x, y: projected.y },
        ghost: null,
      });
    });

    // t=3200ms+: type characters one at a time (~130ms cadence) by mutating
    // the node's `value` / `inputs.val` / `result` fields. CalculationNode
    // reads from `data` so the typed characters appear progressively.
    const typingStart = 3200;
    const charDelay = 130;
    for (let i = 1; i <= typedValue.length; i += 1) {
      const partial = typedValue.slice(0, i);
      scheduleAutoDemoStep(typingStart + i * charDelay, () => {
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id !== demoNodeId) return n;
            const existing = (n.data ?? {}) as Record<string, unknown>;
            const existingInputs =
              (existing.inputs as Record<string, unknown> | undefined) ?? {};
            return {
              ...n,
              data: {
                ...existing,
                value: partial,
                inputs: { ...existingInputs, val: partial },
                result: partial,
                dirty: false,
              } as FlowNode["data"],
            };
          })
        );
      });
    }

    // Final: clear the overlay after the user has had a moment to see the
    // typed value.
    const finishAt = typingStart + typedValue.length * charDelay + 1100;
    scheduleAutoDemoStep(finishAt, () => {
      autoDemoRunningRef.current = false;
      setAutoDemoState(null);
    });
  }, [
    addTab,
    clearAutoDemoTimers,
    renameTab,
    scheduleAutoDemoStep,
    setEdges,
    setNodes,
    setTabTooltip,
    walkthroughInputTemplate,
  ]);

  // Cancel any pending auto-demo timers when the component unmounts.
  useEffect(() => stopAutoDemo, [stopAutoDemo]);

  useEffect(() => {
    if (!initialHydrationDone) return;
    if (isMobileReadOnly) return;
    if (showWalkthrough) return;
    if (walkthroughAutoStartedRef.current) return;
    if (nodes.length > 0 || edges.length > 0) return;

    try {
      if (
        window.localStorage.getItem(WALKTHROUGH_STORAGE_KEY) ||
        window.localStorage.getItem(FIRST_RUN_STORAGE_KEY)
      ) {
        return;
      }

      const params = new URLSearchParams(window.location.search);
      if (params.get("s") || params.get("share")) {
        return;
      }

      if (isAutomationEnvironment()) {
        window.localStorage.setItem(WALKTHROUGH_STORAGE_KEY, "1");
        return;
      }
    } catch {
      if (isAutomationEnvironment()) {
        return;
      }
    }

    walkthroughAutoStartedRef.current = true;
    markWelcomeComplete();
    walkthroughTabCreatedRef.current = false;
    walkthroughLastAppliedStepRef.current = null;
    walkthroughAnimatedStepsRef.current = new Set();
    setShowWalkthrough(true);
  }, [
    edges.length,
    initialHydrationDone,
    isMobileReadOnly,
    markWelcomeComplete,
    nodes.length,
    showWalkthrough,
  ]);

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
    setIntroDropSourceRect(getIntroDropSourceRect());
    setIsIntroDropAnimating(true);

    if (typeof window === "undefined") {
      const loaded = loadExampleFlow(introFlowId, {
        placement: "top-left-drop",
      });
      if (loaded) markWelcomeComplete();
      setIsIntroDropAnimating(false);
      return;
    }

    const loadTimeoutId = window.setTimeout(() => {
      const loaded = loadExampleFlow(introFlowId, {
        placement: "top-left-drop",
      });
      if (loaded) {
        markWelcomeComplete();
      } else {
        introDropScheduledRef.current = false;
      }
    }, INTRO_FLOW_DROP_ANIMATION_MS);

    const releaseTimeoutId = window.setTimeout(() => {
      setIsIntroDropAnimating(false);
      introDropTimeoutIdsRef.current = introDropTimeoutIdsRef.current.filter(
        (id) => id !== loadTimeoutId && id !== releaseTimeoutId
      );
    }, INTRO_FLOW_DROP_ANIMATION_MS + 220);

    introDropTimeoutIdsRef.current.push(loadTimeoutId, releaseTimeoutId);
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
    replaceGraph: replaceSharedGraph,
    onNodesChange: rawOnNodesChange,
    onEdgesChange: rawOnEdgesChange,
    scheduleSnapshot,
    setTabTooltip,
    renameTab,
    activeTabId,
    setInfoDialog,
    flowInstanceRef,
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
      clearWalkthroughDropAnimationTimers();
      clearSharedGraphRepairTimers();
    },
    [
      clearExampleFitRetryTimers,
      clearIntroDropAnimationTimers,
      clearWalkthroughDropAnimationTimers,
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
              onWalkthroughClick={openWalkthrough}
              onAutoDemoClick={runAutoDemo}
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
              introDropFlowId={isIntroDropAnimating ? INTRO_FLOW_ID : undefined}
              introDropNodeLabel={walkthroughDropNodeLabel}
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
                onDrop={onDropWithUndo}
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

          {isIntroDropAnimating && (
            <div
              className="absolute inset-0 z-[80] cursor-progress bg-background/25 backdrop-blur-[1px]"
              aria-live="polite"
              aria-busy="true"
            >
              <div
                className="rawbit-intro-drop-card pointer-events-none absolute rounded-md border border-primary/50 bg-card px-4 py-3 text-card-foreground shadow-lg"
                style={
                  {
                    "--intro-source-x": `${introDropSourceRect.x}px`,
                    "--intro-source-y": `${introDropSourceRect.y}px`,
                    "--intro-source-width": `${introDropSourceRect.width}px`,
                    "--intro-source-height": `${introDropSourceRect.height}px`,
                    width: `${introDropSourceRect.width}px`,
                    minHeight: `${introDropSourceRect.height}px`,
                  } as React.CSSProperties
                }
              >
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Flow Examples
                </div>
                <div className="mt-1 text-sm font-semibold">Intro P2PKH</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Dropping onto canvas
                </div>
              </div>
            </div>
          )}

          {walkthroughDropAnimation && (
            <div
              className="pointer-events-none absolute inset-0 z-[80]"
              aria-live="polite"
            >
              <div
                className="rawbit-walkthrough-drop-card pointer-events-none absolute rounded-md border border-primary/50 bg-card px-4 py-3 text-card-foreground shadow-lg"
                style={
                  {
                    "--walkthrough-source-x": `${walkthroughDropAnimation.sourceRect.x}px`,
                    "--walkthrough-source-y": `${walkthroughDropAnimation.sourceRect.y}px`,
                    "--walkthrough-source-width": `${walkthroughDropAnimation.sourceRect.width}px`,
                    "--walkthrough-target-x": `${walkthroughDropAnimation.targetRect.x}px`,
                    "--walkthrough-target-y": `${walkthroughDropAnimation.targetRect.y}px`,
                    width: `${walkthroughDropAnimation.sourceRect.width}px`,
                    minHeight: `${walkthroughDropAnimation.sourceRect.height}px`,
                  } as React.CSSProperties
                }
              >
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {walkthroughDropAnimation.label}
                </div>
                <div className="mt-1 text-sm font-semibold">
                  {walkthroughDropAnimation.title}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {walkthroughDropAnimation.detail}
                </div>
              </div>
            </div>
          )}

          <AutoDemoOverlay state={autoDemoState} />

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
          <Walkthrough
            open={showWalkthrough}
            onSkip={closeWalkthrough}
            onFinish={closeWalkthrough}
            onStepChange={handleWalkthroughStepChange}
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
