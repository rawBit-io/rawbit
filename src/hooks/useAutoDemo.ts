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
import type { Edge, ReactFlowInstance } from "@xyflow/react";

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

type SetNodes = (
  updater: FlowNode[] | ((nodes: FlowNode[]) => FlowNode[])
) => void;
type SetEdges = (updater: Edge[] | ((edges: Edge[]) => Edge[])) => void;

interface UseAutoDemoOptions {
  addTab: () => string;
  renameTab: (tabId: string, title: string) => void;
  setTabTooltip: (tabId: string, tooltip: string) => void;
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

export function useAutoDemo({
  addTab,
  renameTab,
  setTabTooltip,
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

    const titleMoveAt = inputEnd + sp(300);
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

    const demoEndsAt = noteTypeEnd + sp(1600);
    scheduleAutoDemoStep(demoEndsAt, () => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.selected ? { ...node, selected: false } : node
        )
      );
      autoDemoRunningRef.current = false;
      setAutoDemoState(null);
    });
  }, [
    addTab,
    clearAutoDemoTimers,
    flowInstanceRef,
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
