import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { Edge, ReactFlowInstance, Viewport } from "@xyflow/react";

import type { AutoDemoOverlayState } from "@/components/AutoDemoOverlay";
import { CURSOR_TIP_OFFSET } from "@/components/autoDemoCursor";
import { allSidebarNodes } from "@/components/sidebar-nodes";
import { setVal } from "@/lib/utils";
import type { FlowNode, NodeTemplate } from "@/types";

const AUTO_DEMO_INPUT_LABEL = "Input";
const AUTO_DEMO_INPUT_TITLE = "Input Count";
const AUTO_DEMO_TX_TEMPLATE_LABEL = "TX Template legacy";
const AUTO_DEMO_VARINT_LABEL = "Int → VarInt";
const AUTO_DEMO_VIEWPORT = { x: 0, y: 0, zoom: 0.8 };
const AUTO_DEMO_FIT_VIEW_DURATION = 450;
const AUTO_DEMO_INPUT_POSITION = { x: 80, y: 130 };
const AUTO_DEMO_VARINT_POSITION = { x: 470, y: 225 };
const AUTO_DEMO_TX_TEMPLATE_POSITION = { x: 865, y: 90 };
const AUTO_DEMO_TEXT_INFO_LABEL = "Text Info Node";
const AUTO_DEMO_INPUT_NODE_ID = "node_auto_demo_input_count";
const AUTO_DEMO_VARINT_NODE_ID = "node_auto_demo_input_count_varint";
const AUTO_DEMO_TX_TEMPLATE_NODE_ID = "node_auto_demo_tx_template_legacy";
const AUTO_DEMO_TEXT_INFO_NODE_ID = "node_auto_demo_text_info";
const AUTO_DEMO_TEXT_INFO_POSITION = { x: 60, y: 430 };
const AUTO_DEMO_TEXT_INFO_SIZE = { width: 720, height: 620 };
const AUTO_DEMO_TEXT_INFO_TITLE = "Welcome to rawBit";
const AUTO_DEMO_TEXT_INFO_CONTENT = [
  "# Welcome to rawBit",
  "",
  "Drag predefined nodes onto the canvas and wire them together to build raw Bitcoin transactions.",
  "",
  "- **Build transactions visually**",
  "- **Step through Bitcoin Script**",
  "- **Inspect code behind each node**",
  "- **16 example flows**: P2PKH → SegWit → Taproot",
  "",
  "",
  "rawBit is completely open source:",
  "",
  "",
  "[github.com/rawBit-io/rawbit](https://github.com/rawBit-io/rawbit)",
].join("\n");
const AUTO_DEMO_INPUT_TO_VARINT_EDGE_ID = "edge_auto_demo_input_to_varint";
const AUTO_DEMO_VARINT_TO_TX_EDGE_ID = "edge_auto_demo_varint_to_tx_input_count";
const AUTO_DEMO_COMPLETE_FLOW_VIEW_DURATION = 950;
const AUTO_DEMO_COMPLETE_FLOW_GROUP_IDS = {
  funding: "group_zi8x2qm",
  lockingScript: "group_hegqa99",
  preimage: "group_7w6adu7",
  signature: "group_cd0gkcz",
  final: "group_ixnjwes",
} as const;
const AUTO_DEMO_COMPLETE_FLOW_FALLBACK_BOUNDS: Record<
  keyof typeof AUTO_DEMO_COMPLETE_FLOW_GROUP_IDS | "all",
  { x: number; y: number; width: number; height: number }
> = {
  all: { x: 1456, y: 788, width: 13791, height: 6002 },
  funding: { x: 1660, y: 788, width: 1654, height: 1059 },
  lockingScript: { x: 1456, y: 5698, width: 2478, height: 1092 },
  preimage: { x: 4307, y: 2501, width: 4965, height: 3234 },
  signature: { x: 10055, y: 1657, width: 2770, height: 1168 },
  final: { x: 13671, y: 4566, width: 1576, height: 2090 },
};
const AUTO_DEMO_SCRIPT_STEP_ADVANCE_COUNT = 8;

type SetNodes = (
  updater: FlowNode[] | ((nodes: FlowNode[]) => FlowNode[])
) => void;
type SetEdges = (updater: Edge[] | ((edges: Edge[]) => Edge[])) => void;
type AutoDemoCaption = NonNullable<AutoDemoOverlayState["caption"]>;

type DropExampleFlow = (
  flowId: string,
  screenPosition: { x: number; y: number }
) => boolean;

interface UseAutoDemoOptions {
  addTab: () => string;
  renameTab: (tabId: string, title: string) => void;
  setTabTooltip: (tabId: string, tooltip: string) => void;
  dropExampleFlow: DropExampleFlow;
  introFlowId?: string;
  introFlowLabel?: string;
  getNodes: () => FlowNode[];
  setNodes: SetNodes;
  setEdges: SetEdges;
  setIsSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setShowUndoRedoPanel: Dispatch<SetStateAction<boolean>>;
  setShowErrorPanel: Dispatch<SetStateAction<boolean>>;
  setShowSearchPanel: Dispatch<SetStateAction<boolean>>;
  flowInstanceRef: RefObject<ReactFlowInstance | null>;
  reactFlowWrapper: RefObject<HTMLDivElement | null>;
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

function getSidebarNodeSourceRect(label: string): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (typeof document === "undefined") {
    return { x: 76, y: 780, width: 196, height: 96 };
  }

  const source = Array.from(
    document.querySelectorAll<HTMLElement>("[data-node-template-label]")
  ).find((element) => element.dataset.nodeTemplateLabel === label);

  if (!source) {
    return { x: 76, y: 780, width: 196, height: 96 };
  }

  const rect = source.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width || 196,
    height: rect.height || 96,
  };
}

function getSidebarSearchInputRect(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (typeof document === "undefined") {
    return { x: 96, y: 150, width: 220, height: 32 };
  }
  const input = document.getElementById("sidebar-search");
  if (!input) {
    return { x: 96, y: 150, width: 220, height: 32 };
  }
  const rect = input.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width || 220,
    height: rect.height || 32,
  };
}

function getFlowTemplateSourceRect(flowId: string | undefined): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (typeof document === "undefined") {
    return { x: 76, y: 780, width: 196, height: 72 };
  }

  const source = Array.from(
    document.querySelectorAll<HTMLElement>("[data-flow-template-id]")
  ).find((element) => element.dataset.flowTemplateId === flowId);

  if (!source) {
    return { x: 76, y: 780, width: 196, height: 72 };
  }

  const rect = source.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width || 196,
    height: rect.height || 72,
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

function withCursorTipAt(point: { x: number; y: number }) {
  return {
    x: point.x - CURSOR_TIP_OFFSET.x,
    y: point.y - CURSOR_TIP_OFFSET.y,
  };
}

function getHandleScreenPosition(
  nodeId: string,
  type: "source" | "target",
  handleId?: string | null
): { x: number; y: number } | null {
  if (typeof document === "undefined") return null;
  const nodeEl = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${nodeId}"]`
  );
  if (!nodeEl) return null;

  let handleEl: HTMLElement | null = null;
  if (handleId) {
    handleEl = nodeEl.querySelector<HTMLElement>(
      `.react-flow__handle[data-handleid="${handleId}"]`
    );
  }
  if (!handleEl) {
    handleEl = nodeEl.querySelector<HTMLElement>(
      `.react-flow__handle.${type}`
    );
  }
  if (!handleEl) return null;

  const rect = handleEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getFlowNodeBounds(node: FlowNode):
  | { x: number; y: number; width: number; height: number }
  | null {
  const x = node.position?.x;
  const y = node.position?.y;
  if (typeof x !== "number" || typeof y !== "number") return null;

  const data = (node.data ?? {}) as Record<string, unknown>;
  const measured = (node as { measured?: { width?: number; height?: number } })
    .measured;
  const width =
    typeof data.width === "number"
      ? data.width
      : typeof measured?.width === "number"
        ? measured.width
        : typeof (node as { width?: number }).width === "number"
          ? (node as { width?: number }).width ?? 0
          : 260;
  const height =
    typeof data.height === "number"
      ? data.height
      : typeof measured?.height === "number"
        ? measured.height
        : typeof (node as { height?: number }).height === "number"
          ? (node as { height?: number }).height ?? 0
          : 220;

  return { x, y, width, height };
}

function unionBounds(
  bounds: Array<{ x: number; y: number; width: number; height: number }>
) {
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const maxY = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getTourBounds(
  nodes: FlowNode[],
  groupKeys: Array<keyof typeof AUTO_DEMO_COMPLETE_FLOW_GROUP_IDS>
) {
  const ids = groupKeys.map((key) => AUTO_DEMO_COMPLETE_FLOW_GROUP_IDS[key]);
  const bounds = ids
    .map((id) => nodes.find((node) => node.id === id))
    .map((node) => (node ? getFlowNodeBounds(node) : null))
    .filter(
      (bound): bound is { x: number; y: number; width: number; height: number } =>
        Boolean(bound)
    );

  if (bounds.length > 0) {
    return unionBounds(bounds);
  }
  if (groupKeys.length === 1) {
    return AUTO_DEMO_COMPLETE_FLOW_FALLBACK_BOUNDS[groupKeys[0]];
  }
  return AUTO_DEMO_COMPLETE_FLOW_FALLBACK_BOUNDS.all;
}

function viewportForBounds(
  bounds: { x: number; y: number; width: number; height: number },
  wrapper: HTMLDivElement | null,
  options?: { padding?: number; minZoom?: number; maxZoom?: number }
): Viewport {
  const wrapperRect = wrapper?.getBoundingClientRect();
  const width = Math.max(wrapperRect?.width ?? window.innerWidth ?? 1200, 1);
  const height = Math.max(
    wrapperRect?.height ?? Math.max((window.innerHeight ?? 900) - 120, 1),
    1
  );
  const padding = options?.padding ?? 0.22;
  const maxZoom = options?.maxZoom ?? 0.72;
  const minZoom = options?.minZoom ?? 0.08;
  const zoom = clamp(
    Math.min(
      (width * (1 - padding)) / Math.max(bounds.width, 1),
      (height * (1 - padding)) / Math.max(bounds.height, 1)
    ),
    minZoom,
    maxZoom
  );

  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}

function getElementCenter(element: Element | null) {
  if (!(element instanceof HTMLElement)) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function findVisibleElementByText(selector: string, text: string) {
  if (typeof document === "undefined") return null;
  return (
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
      (element) =>
        element.offsetParent !== null && element.textContent?.includes(text)
    ) ?? null
  );
}

export function useAutoDemo({
  addTab,
  renameTab,
  setTabTooltip,
  dropExampleFlow,
  introFlowId,
  introFlowLabel,
  getNodes,
  setNodes,
  setEdges,
  setIsSidebarOpen,
  setShowUndoRedoPanel,
  setShowErrorPanel,
  setShowSearchPanel,
  flowInstanceRef,
  reactFlowWrapper,
}: UseAutoDemoOptions) {
  const [autoDemoDropNodeLabel, setAutoDemoDropNodeLabel] = useState<
    string | undefined
  >();
  const [autoDemoSidebarSearch, setAutoDemoSidebarSearch] = useState<
    string | undefined
  >();
  const [autoDemoState, setAutoDemoState] =
    useState<AutoDemoOverlayState | null>(null);
  const autoDemoTimeoutIdsRef = useRef<number[]>([]);
  const autoDemoRunningRef = useRef(false);

  const autoDemoInputTemplate = useMemo(
    () => allSidebarNodes.find((node) => node.label === AUTO_DEMO_INPUT_LABEL),
    []
  );
  const autoDemoTxTemplate = useMemo(
    () =>
      allSidebarNodes.find(
        (node) => node.label === AUTO_DEMO_TX_TEMPLATE_LABEL
      ),
    []
  );
  const autoDemoVarIntTemplate = useMemo(
    () =>
      allSidebarNodes.find((node) => node.label === AUTO_DEMO_VARINT_LABEL),
    []
  );
  const autoDemoTextInfoTemplate = useMemo(
    () =>
      allSidebarNodes.find(
        (node) => node.label === AUTO_DEMO_TEXT_INFO_LABEL
      ),
    []
  );
  const latestActionsRef = useRef({
    dropExampleFlow,
  });

  useEffect(() => {
    latestActionsRef.current = {
      dropExampleFlow,
    };
  }, [dropExampleFlow]);

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
    setAutoDemoDropNodeLabel(undefined);
    setAutoDemoSidebarSearch(undefined);
  }, [clearAutoDemoTimers]);

  const runAutoDemo = useCallback(() => {
    if (autoDemoRunningRef.current) return;
    if (
      !autoDemoInputTemplate ||
      !autoDemoTxTemplate ||
      !autoDemoVarIntTemplate ||
      !autoDemoTextInfoTemplate
    ) {
      return;
    }
    if (typeof window === "undefined") return;

    autoDemoRunningRef.current = true;
    clearAutoDemoTimers();

    setIsSidebarOpen(true);
    setShowUndoRedoPanel(false);
    setShowErrorPanel(false);
    setShowSearchPanel(false);

    const tabId = addTab();
    renameTab(tabId, "Auto Demo");
    setTabTooltip(tabId, "Auto demo");

    const applyAutoDemoViewport = () => {
      flowInstanceRef.current?.setViewport(AUTO_DEMO_VIEWPORT, { duration: 0 });
    };
    applyAutoDemoViewport();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(applyAutoDemoViewport);
    });

    setAutoDemoState({
      cursor: { x: window.innerWidth * 0.55, y: window.innerHeight - 80 },
      ghost: null,
    });

    const sp = (ms: number) => Math.round(ms / 1.5);
    let activeCaption: AutoDemoCaption | null = null;

    const setCaption = (caption: AutoDemoCaption | null) => {
      activeCaption = caption;
      setAutoDemoState({
        cursor: null,
        ghost: null,
        caption,
      });
    };

    const setCursorWithCaption = (
      cursor: { x: number; y: number } | null,
      extras?: Partial<AutoDemoOverlayState>
    ) => {
      setAutoDemoState({
        cursor,
        ghost: null,
        caption: activeCaption,
        ...extras,
      });
    };

    const flowToScreen = (
      position: { x: number; y: number },
      fallbackOffset = position
    ) => {
      const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect();
      const instance = flowInstanceRef.current;
      if (
        instance &&
        typeof instance.flowToScreenPosition === "function" &&
        wrapperRect
      ) {
        const projected = instance.flowToScreenPosition(position);
        return { x: projected.x, y: projected.y };
      }
      return {
        x: (wrapperRect?.left ?? 256) + fallbackOffset.x,
        y: (wrapperRect?.top ?? 96) + fallbackOffset.y,
      };
    };

    const dropNode = (
      nodeId: string,
      template: NodeTemplate,
      position: { x: number; y: number },
      dataOverride?: (data: Record<string, unknown>) => Record<string, unknown>
    ) => {
      const baseData = cloneStructuredData(template.nodeData) as Record<
        string,
        unknown
      >;
      const nextData = dataOverride ? dataOverride(baseData) : baseData;
      const dropped: FlowNode = {
        id: nodeId,
        type: template.type,
        position,
        selected: true,
        data: nextData as FlowNode["data"],
      };
      setNodes((currentNodes) => [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        dropped,
      ]);
    };

    const scheduleDropNode = (
      startAt: number,
      nodeId: string,
      label: string,
      eyebrow: string,
      template: NodeTemplate,
      position: { x: number; y: number },
      dataOverride?: (data: Record<string, unknown>) => Record<string, unknown>
    ) => {
      scheduleAutoDemoStep(startAt, () => {
        setAutoDemoDropNodeLabel(label);
      });

      scheduleAutoDemoStep(startAt + sp(350), () => {
        const sourceCenter = getRectCursorCenter(getSidebarNodeSourceRect(label));
        setAutoDemoState({ cursor: sourceCenter, ghost: null });
      });

      scheduleAutoDemoStep(startAt + sp(1050), () => {
        const sourceCenter = getRectCursorCenter(getSidebarNodeSourceRect(label));
        setAutoDemoState({ cursor: sourceCenter, ghost: null, pressing: true });
      });

      scheduleAutoDemoStep(startAt + sp(1250), () => {
        const sourceCenter = getRectCursorCenter(getSidebarNodeSourceRect(label));
        setAutoDemoState({
          cursor: sourceCenter,
          ghost: {
            x: sourceCenter.x - 20,
            y: sourceCenter.y - 18,
            eyebrow,
            label,
          },
        });
      });

      scheduleAutoDemoStep(startAt + sp(1500), () => {
        const targetScreen = flowToScreen(position);
        setAutoDemoState({
          cursor: targetScreen,
          ghost: {
            x: targetScreen.x - 20,
            y: targetScreen.y - 18,
            eyebrow,
            label,
          },
        });
      });

      scheduleAutoDemoStep(startAt + sp(2250), () => {
        const targetScreen = flowToScreen(position);
        dropNode(nodeId, template, position, dataOverride);
        setAutoDemoState({
          cursor: targetScreen,
          ghost: null,
          pressing: true,
        });
        setAutoDemoDropNodeLabel(undefined);
      });
    };

    const scheduleSearchDropNode = (
      startAt: number,
      nodeId: string,
      label: string,
      eyebrow: string,
      query: string,
      template: NodeTemplate,
      position: { x: number; y: number },
      dataOverride?: (data: Record<string, unknown>) => Record<string, unknown>
    ) => {
      const SEARCH_TYPE_DELAY = 150;

      scheduleAutoDemoStep(startAt, () => {
        setAutoDemoSidebarSearch("");
        const center = getRectCursorCenter(getSidebarSearchInputRect());
        setAutoDemoState({ cursor: center, ghost: null });
      });

      const focusAt = startAt + sp(750);
      scheduleAutoDemoStep(focusAt, () => {
        const center = getRectCursorCenter(getSidebarSearchInputRect());
        setAutoDemoState({ cursor: center, ghost: null, pressing: true });
      });

      const typeStart = focusAt + sp(250);
      for (let i = 1; i <= query.length; i += 1) {
        const partial = query.slice(0, i);
        scheduleAutoDemoStep(typeStart + i * SEARCH_TYPE_DELAY, () => {
          setAutoDemoSidebarSearch(partial);
          const center = getRectCursorCenter(getSidebarSearchInputRect());
          setAutoDemoState({ cursor: center, ghost: null });
        });
      }
      const typeEnd = typeStart + query.length * SEARCH_TYPE_DELAY;

      const moveToCardAt = typeEnd + sp(450);
      scheduleAutoDemoStep(moveToCardAt, () => {
        const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
        setAutoDemoState({ cursor: center, ghost: null });
      });

      scheduleAutoDemoStep(moveToCardAt + sp(700), () => {
        const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
        setAutoDemoState({ cursor: center, ghost: null, pressing: true });
      });

      scheduleAutoDemoStep(moveToCardAt + sp(900), () => {
        const center = getRectCursorCenter(getSidebarNodeSourceRect(label));
        setAutoDemoState({
          cursor: center,
          ghost: { x: center.x - 20, y: center.y - 18, eyebrow, label },
        });
      });

      scheduleAutoDemoStep(moveToCardAt + sp(1150), () => {
        const targetScreen = flowToScreen(position);
        setAutoDemoState({
          cursor: targetScreen,
          ghost: {
            x: targetScreen.x - 20,
            y: targetScreen.y - 18,
            eyebrow,
            label,
          },
        });
      });

      const dropAt = moveToCardAt + sp(1900);
      scheduleAutoDemoStep(dropAt, () => {
        const targetScreen = flowToScreen(position);
        dropNode(nodeId, template, position, dataOverride);
        setAutoDemoState({
          cursor: targetScreen,
          ghost: null,
          pressing: true,
        });
        setAutoDemoSidebarSearch("");
      });

      return dropAt - startAt;
    };

    setNodes(() => []);
    setEdges(() => []);

    const DROP_DURATION = sp(2250);
    const fitAutoDemoViewport = () => {
      const instance = flowInstanceRef.current;
      if (!instance || typeof instance.fitView !== "function") {
        applyAutoDemoViewport();
        return;
      }
      instance.fitView({
        padding: 0.16,
        minZoom: 0.3,
        maxZoom: AUTO_DEMO_VIEWPORT.zoom,
        duration: AUTO_DEMO_FIT_VIEW_DURATION,
      });
    };

    scheduleDropNode(
      0,
      AUTO_DEMO_TX_TEMPLATE_NODE_ID,
      AUTO_DEMO_TX_TEMPLATE_LABEL,
      "Transactions",
      autoDemoTxTemplate,
      AUTO_DEMO_TX_TEMPLATE_POSITION,
      (data) => ({
        ...data,
        inputs: { ...(data.inputs as object | undefined), vals: {} },
        result: "",
        dirty: false,
      })
    );
    const txEnd = DROP_DURATION;
    const txFitAt = txEnd + sp(300);
    scheduleAutoDemoStep(txFitAt, fitAutoDemoViewport);
    const txFitEnd = txFitAt + AUTO_DEMO_FIT_VIEW_DURATION;

    const varIntStart = txFitEnd + sp(300);
    const varIntDuration = scheduleSearchDropNode(
      varIntStart,
      AUTO_DEMO_VARINT_NODE_ID,
      AUTO_DEMO_VARINT_LABEL,
      "Encoding & Script Data",
      "varint",
      autoDemoVarIntTemplate,
      AUTO_DEMO_VARINT_POSITION,
      (data) => ({
        ...data,
        inputs: { ...(data.inputs as object | undefined), val: "" },
        result: "",
        dirty: false,
      })
    );
    const varIntEnd = varIntStart + varIntDuration;

    const inputStart = varIntEnd + sp(450);
    scheduleDropNode(
      inputStart,
      AUTO_DEMO_INPUT_NODE_ID,
      AUTO_DEMO_INPUT_LABEL,
      "Canvas & Inputs",
      autoDemoInputTemplate,
      AUTO_DEMO_INPUT_POSITION,
      (data) => ({
        ...data,
        value: "",
        inputs: { ...(data.inputs as object | undefined), val: "" },
        result: "",
        dirty: false,
      })
    );
    const inputEnd = inputStart + DROP_DURATION;

    const inputFitAt = inputEnd + sp(300);
    scheduleAutoDemoStep(inputFitAt, fitAutoDemoViewport);
    const inputFitEnd = inputFitAt + AUTO_DEMO_FIT_VIEW_DURATION;

    const titleMoveAt = inputFitEnd + sp(300);
    scheduleAutoDemoStep(titleMoveAt, () => {
      setAutoDemoState({
        cursor: flowToScreen({
          x: AUTO_DEMO_INPUT_POSITION.x + 50,
          y: AUTO_DEMO_INPUT_POSITION.y + 24,
        }),
        ghost: null,
      });
    });

    const titleFocusAt = titleMoveAt + sp(450);
    scheduleAutoDemoStep(titleFocusAt, () => {
      setAutoDemoState({
        cursor: flowToScreen({
          x: AUTO_DEMO_INPUT_POSITION.x + 50,
          y: AUTO_DEMO_INPUT_POSITION.y + 24,
        }),
        ghost: null,
        pressing: true,
      });
    });

    const TITLE_TYPE_DELAY = 85;
    const titleBaseLen = AUTO_DEMO_INPUT_LABEL.length;
    const titleTypeStart = titleFocusAt + sp(250);
    for (let i = titleBaseLen + 1; i <= AUTO_DEMO_INPUT_TITLE.length; i += 1) {
      const partial = AUTO_DEMO_INPUT_TITLE.slice(0, i);
      scheduleAutoDemoStep(
        titleTypeStart + (i - titleBaseLen) * TITLE_TYPE_DELAY,
        () => {
          setNodes((currentNodes) =>
            currentNodes.map((node) => {
              if (node.id !== AUTO_DEMO_INPUT_NODE_ID) return node;
              const existing = (node.data ?? {}) as Record<string, unknown>;
              return {
                ...node,
                data: { ...existing, title: partial } as FlowNode["data"],
              };
            })
          );
        }
      );
    }
    const titleTypeEnd =
      titleTypeStart +
      (AUTO_DEMO_INPUT_TITLE.length - titleBaseLen) * TITLE_TYPE_DELAY;

    const fieldMoveAt = titleTypeEnd + sp(350);
    scheduleAutoDemoStep(fieldMoveAt, () => {
      setAutoDemoState({
        cursor: flowToScreen({
          x: AUTO_DEMO_INPUT_POSITION.x + 72,
          y: AUTO_DEMO_INPUT_POSITION.y + 96,
        }),
        ghost: null,
      });
    });

    const typeValueAt = fieldMoveAt + sp(500);
    scheduleAutoDemoStep(typeValueAt, () => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== AUTO_DEMO_INPUT_NODE_ID) return node;
          const existing = (node.data ?? {}) as Record<string, unknown>;
          const existingInputs =
            (existing.inputs as Record<string, unknown> | undefined) ?? {};
          return {
            ...node,
            data: {
              ...existing,
              value: "1",
              inputs: { ...existingInputs, val: "1" },
              result: "1",
              dirty: false,
            } as FlowNode["data"],
          };
        })
      );
    });

    const CONN_MOVE = sp(620);
    const CONN_GRAB = sp(300);
    const CONN_DRAG = sp(880);
    const CONN_SETTLE = sp(260);
    const CONN_TOTAL = CONN_MOVE + CONN_GRAB + CONN_DRAG + CONN_SETTLE;

    const scheduleConnect = (
      startAt: number,
      sourceNodeId: string,
      sourceHandleId: string | null,
      sourceFallback: { x: number; y: number },
      targetNodeId: string,
      targetHandleId: string,
      targetFallback: { x: number; y: number },
      onRelease: () => void
    ) => {
      const resolveSource = () =>
        getHandleScreenPosition(sourceNodeId, "source", sourceHandleId) ??
        flowToScreen(sourceFallback);
      const resolveTarget = () =>
        getHandleScreenPosition(targetNodeId, "target", targetHandleId) ??
        flowToScreen(targetFallback);

      scheduleAutoDemoStep(startAt, () => {
        setAutoDemoState({
          cursor: withCursorTipAt(resolveSource()),
          ghost: null,
        });
      });

      scheduleAutoDemoStep(startAt + CONN_MOVE, () => {
        const src = resolveSource();
        setAutoDemoState({
          cursor: withCursorTipAt(src),
          ghost: null,
          pressing: true,
          connection: src,
        });
      });

      scheduleAutoDemoStep(startAt + CONN_MOVE + CONN_GRAB, () => {
        const src = resolveSource();
        setAutoDemoState({
          cursor: withCursorTipAt(resolveTarget()),
          ghost: null,
          pressing: true,
          connection: src,
        });
      });

      scheduleAutoDemoStep(startAt + CONN_TOTAL, () => {
        onRelease();
        setAutoDemoState({
          cursor: withCursorTipAt(resolveTarget()),
          ghost: null,
          connection: null,
        });
      });

      return CONN_TOTAL;
    };

    const scheduleCompleteFlowDrop = (startAt: number) => {
      const flowLabel = introFlowLabel ?? "Intro P2PKH";
      const targetScreen = () => {
        return flowToScreen({
          x: AUTO_DEMO_TX_TEMPLATE_POSITION.x + 760,
          y: AUTO_DEMO_TX_TEMPLATE_POSITION.y + 70,
        });
      };

      scheduleAutoDemoStep(startAt, () => {
        setIsSidebarOpen(true);
        setAutoDemoSidebarSearch("");
        setCaption({
          title: "Explore a complete transaction",
          body: "Drop the Intro P2PKH example, then step through Bitcoin Script execution.",
        });
      });

      const sourceAt = startAt + sp(600);
      scheduleAutoDemoStep(sourceAt, () => {
        const sourceCenter = getRectCursorCenter(
          getFlowTemplateSourceRect(introFlowId)
        );
        setCursorWithCaption(sourceCenter);
      });

      scheduleAutoDemoStep(sourceAt + sp(650), () => {
        const sourceCenter = getRectCursorCenter(
          getFlowTemplateSourceRect(introFlowId)
        );
        setCursorWithCaption(sourceCenter, { pressing: true });
      });

      scheduleAutoDemoStep(sourceAt + sp(850), () => {
        const sourceCenter = getRectCursorCenter(
          getFlowTemplateSourceRect(introFlowId)
        );
        setCursorWithCaption(sourceCenter, {
          ghost: {
            x: sourceCenter.x - 20,
            y: sourceCenter.y - 18,
            eyebrow: "Flow Examples",
            label: flowLabel,
            detail: "Dropping complete flow",
          },
        });
      });

      scheduleAutoDemoStep(sourceAt + sp(1150), () => {
        const target = targetScreen();
        setCursorWithCaption(target, {
          ghost: {
            x: target.x - 20,
            y: target.y - 18,
            eyebrow: "Flow Examples",
            label: flowLabel,
            detail: "Dropping complete flow",
          },
        });
      });

      const dropAt = sourceAt + sp(1900);
      scheduleAutoDemoStep(dropAt, () => {
        const target = targetScreen();
        if (introFlowId) {
          latestActionsRef.current.dropExampleFlow(introFlowId, target);
        }
        setCursorWithCaption(target, {
          ghost: null,
          pressing: true,
        });
      });

      const unselectAt = dropAt + sp(650);
      scheduleAutoDemoStep(unselectAt, () => {
        const target = targetScreen();
        const clickPoint = {
          x: target.x - 120,
          y: target.y + 90,
        };
        setCursorWithCaption(clickPoint, { pressing: true });
        setNodes((currentNodes) =>
          currentNodes.map((node) =>
            node.selected ? { ...node, selected: false } : node
          )
        );
        setEdges((currentEdges) =>
          currentEdges.map((edge) =>
            edge.selected ? { ...edge, selected: false } : edge
          )
        );
      });

      scheduleAutoDemoStep(unselectAt + sp(300), () => {
        const target = targetScreen();
        setCursorWithCaption({
          x: target.x - 120,
          y: target.y + 90,
        });
      });

      return unselectAt + sp(700);
    };

    const focusCompleteFlowGroups = (
      groupKeys: Array<keyof typeof AUTO_DEMO_COMPLETE_FLOW_GROUP_IDS>,
      options?: { padding?: number; minZoom?: number; maxZoom?: number }
    ) => {
      const bounds = getTourBounds(getNodes(), groupKeys);
      const viewport = viewportForBounds(
        bounds,
        reactFlowWrapper.current,
        options
      );
      flowInstanceRef.current?.setViewport(viewport, {
        duration: AUTO_DEMO_COMPLETE_FLOW_VIEW_DURATION,
      });
    };

    const scheduleClickElement = (
      startAt: number,
      getElement: () => HTMLElement | null,
      fallback: { x: number; y: number },
      afterClick?: () => void
    ) => {
      const resolveCenter = () => getElementCenter(getElement()) ?? fallback;

      scheduleAutoDemoStep(startAt, () => {
        setCursorWithCaption(resolveCenter());
      });
      scheduleAutoDemoStep(startAt + sp(520), () => {
        setCursorWithCaption(resolveCenter(), { pressing: true });
        getElement()?.click();
        afterClick?.();
      });
      scheduleAutoDemoStep(startAt + sp(820), () => {
        setCursorWithCaption(resolveCenter());
      });

      return startAt + sp(1000);
    };

    const scheduleScriptStepsTour = (startAt: number) => {
      scheduleAutoDemoStep(startAt, () => {
        setCaption({
          title: "Step through Script execution",
          body: "Open the verifier and watch every opcode change the stack.",
        });
      });

      const openAt = startAt + sp(500);
      const afterOpen = scheduleClickElement(
        openAt,
        () => findVisibleElementByText("button", "View Script Steps"),
        flowToScreen({ x: 13671 + 1022 + 120, y: 4566 + 309 + 360 })
      );

      let nextAt = afterOpen + sp(900);
      for (let i = 0; i < AUTO_DEMO_SCRIPT_STEP_ADVANCE_COUNT; i += 1) {
        scheduleAutoDemoStep(nextAt - sp(220), () => {
          setCaption({
            title: "Watch the stack change",
            body: "Each click advances one opcode and highlights the stack before and after.",
          });
        });
        nextAt = scheduleClickElement(
          nextAt,
          () => {
            const nextButton = findVisibleElementByText("button", "Next");
            if (
              nextButton instanceof HTMLButtonElement &&
              nextButton.disabled
            ) {
              return null;
            }
            return nextButton;
          },
          { x: 205, y: 210 }
        ) + sp(420);
      }

      const closeAt = nextAt + sp(700);
      const afterClose = scheduleClickElement(
        closeAt,
        () => findVisibleElementByText("button", "Close"),
        { x: window.innerWidth - 110, y: window.innerHeight - 70 }
      );

      scheduleAutoDemoStep(afterClose + sp(250), () => {
        setNodes((currentNodes) =>
          currentNodes.map((node) =>
            node.selected ? { ...node, selected: false } : node
          )
        );
        setEdges((currentEdges) =>
          currentEdges.map((edge) =>
            edge.selected ? { ...edge, selected: false } : edge
          )
        );
      });

      return afterClose + sp(500);
    };

    const conn1Start = typeValueAt + sp(700);
    scheduleConnect(
      conn1Start,
      AUTO_DEMO_INPUT_NODE_ID,
      null,
      {
        x: AUTO_DEMO_INPUT_POSITION.x + 250,
        y: AUTO_DEMO_INPUT_POSITION.y + 78,
      },
      AUTO_DEMO_VARINT_NODE_ID,
      "input-0",
      { x: AUTO_DEMO_VARINT_POSITION.x, y: AUTO_DEMO_VARINT_POSITION.y + 72 },
      () => {
        setEdges((currentEdges) => [
          ...currentEdges,
          {
            id: AUTO_DEMO_INPUT_TO_VARINT_EDGE_ID,
            source: AUTO_DEMO_INPUT_NODE_ID,
            target: AUTO_DEMO_VARINT_NODE_ID,
            targetHandle: "input-0",
            selected: false,
          },
        ]);
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            if (node.id !== AUTO_DEMO_VARINT_NODE_ID) return node;
            const existing = (node.data ?? {}) as Record<string, unknown>;
            const existingInputs =
              (existing.inputs as Record<string, unknown> | undefined) ?? {};
            return {
              ...node,
              selected: false,
              data: {
                ...existing,
                inputs: { ...existingInputs, val: "1" },
                result: "01",
                dirty: false,
              } as FlowNode["data"],
            };
          })
        );
      }
    );

    const conn2Start = conn1Start + CONN_TOTAL + sp(240);
    scheduleConnect(
      conn2Start,
      AUTO_DEMO_VARINT_NODE_ID,
      null,
      {
        x: AUTO_DEMO_VARINT_POSITION.x + 250,
        y: AUTO_DEMO_VARINT_POSITION.y + 72,
      },
      AUTO_DEMO_TX_TEMPLATE_NODE_ID,
      "input-10",
      {
        x: AUTO_DEMO_TX_TEMPLATE_POSITION.x,
        y: AUTO_DEMO_TX_TEMPLATE_POSITION.y + 265,
      },
      () => {
        setEdges((currentEdges) => [
          ...currentEdges,
          {
            id: AUTO_DEMO_VARINT_TO_TX_EDGE_ID,
            source: AUTO_DEMO_VARINT_NODE_ID,
            target: AUTO_DEMO_TX_TEMPLATE_NODE_ID,
            targetHandle: "input-10",
            selected: false,
          },
        ]);
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            if (node.id !== AUTO_DEMO_TX_TEMPLATE_NODE_ID) {
              return { ...node, selected: false };
            }
            const existing = (node.data ?? {}) as Record<string, unknown>;
            const existingInputs =
              (existing.inputs as Record<string, unknown> | undefined) ?? {};
            return {
              ...node,
              selected: false,
              data: {
                ...existing,
                inputs: {
                  ...existingInputs,
                  vals: setVal(existingInputs.vals, 10, "01"),
                },
                result: "01",
                dirty: false,
              } as FlowNode["data"],
            };
          })
        );
      }
    );

    const conn2End = conn2Start + CONN_TOTAL;

    const textInfoStart = conn2End + sp(500);
    scheduleDropNode(
      textInfoStart,
      AUTO_DEMO_TEXT_INFO_NODE_ID,
      AUTO_DEMO_TEXT_INFO_LABEL,
      "Canvas & Inputs",
      autoDemoTextInfoTemplate,
      AUTO_DEMO_TEXT_INFO_POSITION,
      (data) => ({
        ...data,
        content: "",
        title: AUTO_DEMO_TEXT_INFO_TITLE,
        fontSize: 28,
        width: AUTO_DEMO_TEXT_INFO_SIZE.width,
        height: AUTO_DEMO_TEXT_INFO_SIZE.height,
      })
    );
    const textInfoEnd = textInfoStart + DROP_DURATION;

    const noteFocusAt = textInfoEnd + sp(350);
    scheduleAutoDemoStep(noteFocusAt, () => {
      setAutoDemoState({
        cursor: flowToScreen({
          x: AUTO_DEMO_TEXT_INFO_POSITION.x + 70,
          y: AUTO_DEMO_TEXT_INFO_POSITION.y + 90,
        }),
        ghost: null,
        pressing: true,
      });
    });

    const TYPE_WORD_DELAY = 95;
    const noteWords = AUTO_DEMO_TEXT_INFO_CONTENT.split(" ");
    const noteTypeStart = noteFocusAt + sp(400);
    for (let i = 1; i <= noteWords.length; i += 1) {
      const partial = noteWords.slice(0, i).join(" ");
      scheduleAutoDemoStep(noteTypeStart + i * TYPE_WORD_DELAY, () => {
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            if (node.id !== AUTO_DEMO_TEXT_INFO_NODE_ID) return node;
            const existing = (node.data ?? {}) as Record<string, unknown>;
            return {
              ...node,
              data: { ...existing, content: partial } as FlowNode["data"],
            };
          })
        );
      });
    }
    const noteTypeEnd = noteTypeStart + noteWords.length * TYPE_WORD_DELAY;

    const completeFlowStartAt = noteTypeEnd + sp(1600);
    scheduleAutoDemoStep(completeFlowStartAt, () => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.selected ? { ...node, selected: false } : node
        )
      );
    });

    let completeFlowAt = scheduleCompleteFlowDrop(completeFlowStartAt);
    scheduleAutoDemoStep(completeFlowAt, () => {
      setCaption({
        title: "Explore the complete transaction",
        body: "The full P2PKH example is now on the canvas. Follow the connected nodes, then inspect Script execution.",
      });
      focusCompleteFlowGroups(
        ["funding", "lockingScript", "preimage", "signature", "final"],
        { padding: 0.14, minZoom: 0.055, maxZoom: 0.16 }
      );
    });
    completeFlowAt += AUTO_DEMO_COMPLETE_FLOW_VIEW_DURATION + 2400;

    scheduleAutoDemoStep(completeFlowAt, () => {
      setCaption({
        title: "Open the verifier",
        body: "The Verify Script node lets you step through scriptSig and scriptPubKey opcode by opcode.",
      });
      focusCompleteFlowGroups(["final"], {
        padding: 0.18,
        maxZoom: 0.5,
      });
    });
    completeFlowAt += AUTO_DEMO_COMPLETE_FLOW_VIEW_DURATION + 1400;
    completeFlowAt = scheduleScriptStepsTour(completeFlowAt);

    scheduleAutoDemoStep(completeFlowAt, () => {
      autoDemoRunningRef.current = false;
      setAutoDemoState(null);
    });
  }, [
    addTab,
    clearAutoDemoTimers,
    flowInstanceRef,
    getNodes,
    introFlowId,
    introFlowLabel,
    reactFlowWrapper,
    renameTab,
    scheduleAutoDemoStep,
    setEdges,
    setIsSidebarOpen,
    setNodes,
    setShowErrorPanel,
    setShowSearchPanel,
    setShowUndoRedoPanel,
    setTabTooltip,
    autoDemoInputTemplate,
    autoDemoTxTemplate,
    autoDemoVarIntTemplate,
    autoDemoTextInfoTemplate,
  ]);

  useEffect(() => stopAutoDemo, [stopAutoDemo]);

  return {
    autoDemoDisabled: autoDemoState !== null,
    autoDemoDropNodeLabel,
    autoDemoSidebarSearch,
    autoDemoState,
    runAutoDemo,
    stopAutoDemo,
  };
}
