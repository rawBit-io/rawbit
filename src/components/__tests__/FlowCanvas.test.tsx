import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Edge } from "@xyflow/react";
import type { ReactNode } from "react";

import { FlowCanvas } from "@/components/FlowCanvas";
import {
  GROUP_BUNDLE_EDGE_ID_PREFIX,
  GROUP_BUNDLE_PORT_NODE_TYPE,
  GROUP_BUNDLE_SEGMENT_EDGE_TYPE,
  isGroupBundleSegmentEdgeId,
} from "@/lib/flow/groupEdgeBundling";
import { DISMISS_NODE_MENUS_EVENT } from "@/lib/flow/nodeMenuEvents";
import type { FlowNode } from "@/types";

type ReactFlowSpyProps = Record<string, unknown>;
type MiniMapSpyProps = {
  style?: {
    right?: number;
    width?: number;
    height?: number;
    bottom?: number;
  };
  maskColor?: string;
  [key: string]: unknown;
};

const reactFlowSpy: { props: ReactFlowSpyProps } = { props: {} };
const minimapSpy: { props: MiniMapSpyProps } = { props: {} };
const controlsSpy: { props: Record<string, unknown> } = { props: {} };

vi.mock("@xyflow/react", () => {
  return {
    ReactFlow: ({
      children,
      ...props
    }: { children: ReactNode } & Record<string, unknown>) => {
      reactFlowSpy.props = props;
      const edgeTypes = props.edgeTypes as
        | Record<string, (edgeProps: Record<string, unknown>) => ReactNode>
        | undefined;
      const renderedEdges = (props.edges as Edge[] | undefined)?.map((edge) => {
        const EdgeComponent = edge.type ? edgeTypes?.[edge.type] : undefined;
        if (!EdgeComponent) return null;
        return (
          <svg key={edge.id} data-testid={`custom-edge-${edge.id}`}>
            <EdgeComponent
              id={edge.id}
              data={edge.data}
              selected={edge.selected}
              source={edge.source}
              target={edge.target}
              sourceX={0}
              sourceY={0}
              targetX={100}
              targetY={0}
              sourcePosition="right"
              targetPosition="left"
            />
          </svg>
        );
      });
      return (
        <div data-testid="reactflow">
          {renderedEdges}
          {children}
        </div>
      );
    },
    MiniMap: (props: MiniMapSpyProps) => {
      minimapSpy.props = props;
      return <div data-testid="minimap" />;
    },
    Background: () => <div data-testid="background" />,
    Controls: (props: Record<string, unknown>) => {
      controlsSpy.props = props;
      return <div data-testid="controls" />;
    },
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
    getBezierPath: () => ["M 0 0 C 10 0, 20 0, 30 0", 15, 0],
    useReactFlow: () => ({
      setEdges: vi.fn(),
      setNodes: vi.fn(),
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    }),
    useStore: (
      selector: (state: { nodeLookup: Map<string, unknown> }) => unknown
    ) => selector({ nodeLookup: new Map() }),
    Position: {
      Left: "left",
      Right: "right",
      Top: "top",
      Bottom: "bottom",
    },
    SelectionMode: { Full: "full" },
  };
});

const nodeClassName = vi.fn();
const nodes: FlowNode[] = [];
const edges: Edge[] = [];

const baseProps = {
  nodeTypes: {},
  nodes,
  edges,
  showMiniMap: true,
  miniMapSize: { w: 100, h: 80 },
  miniMapOffset: 42,
  isDark: true,
  nodeClassName,
};

describe("FlowCanvas", () => {
  beforeEach(() => {
    reactFlowSpy.props = {};
    minimapSpy.props = {};
  });

  it("passes selection behaviour to ReactFlow", () => {
    render(
      <FlowCanvas
        {...baseProps}
        isSelectionModeActive
      />
    );

    expect(reactFlowSpy.props.selectionOnDrag).toBe(true);
    expect(reactFlowSpy.props.panOnDrag).toEqual([1]);
  });

  it("broadcasts node-menu dismissal before canvas pointer downs reach nodes", () => {
    const onDismiss = vi.fn();
    window.addEventListener(DISMISS_NODE_MENUS_EVENT, onDismiss);

    try {
      render(<FlowCanvas {...baseProps} />);

      const handler = reactFlowSpy.props.onPointerDownCapture as
        | (() => void)
        | undefined;
      expect(typeof handler).toBe("function");

      handler?.();

      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(DISMISS_NODE_MENUS_EVENT, onDismiss);
    }
  });

  it("disables edge selectability while drag-selection mode is active", () => {
    render(
      <FlowCanvas
        {...baseProps}
        isSelectionModeActive
        nodes={[
          {
            id: "node-a",
            type: "calculation",
            position: { x: 0, y: 0 },
            data: {},
          } as FlowNode,
          {
            id: "node-b",
            type: "calculation",
            position: { x: 120, y: 0 },
            data: {},
          } as FlowNode,
        ]}
        edges={[
          {
            id: "edge-1",
            source: "node-a",
            target: "node-b",
            selected: true,
          } as Edge,
        ]}
      />
    );

    const passedEdges = reactFlowSpy.props.edges as Edge[];
    expect(passedEdges).toHaveLength(1);
    expect(passedEdges[0]?.selectable).toBe(false);
    expect(passedEdges[0]?.selected).toBe(false);
  });

  it("does not render hidden edges while keeping hidden nodes in the canvas graph", () => {
    render(
      <FlowCanvas
        {...baseProps}
        nodes={[
          {
            id: "info-node",
            type: "shadcnTextInfo",
            position: { x: 0, y: 0 },
            hidden: true,
            data: {},
          } as FlowNode,
          {
            id: "node-b",
            type: "calculation",
            position: { x: 120, y: 0 },
            data: {},
          } as FlowNode,
        ]}
        edges={[
          {
            id: "info-edge",
            source: "info-node",
            target: "node-b",
            hidden: true,
          } as Edge,
        ]}
      />
    );

    const passedEdges = reactFlowSpy.props.edges as Edge[];
    const passedNodes = reactFlowSpy.props.nodes as FlowNode[];
    expect(passedNodes.map((node) => node.id)).toEqual([
      "info-node",
      "node-b",
    ]);
    expect(passedEdges).toEqual([]);
  });

  it("bundles repeated cross-group edges for the canvas render layer", () => {
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "a2",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 120 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "b1" } as Edge,
          { id: "edge-2", source: "a2", target: "b1" } as Edge,
        ]}
      />
    );

    const passedEdges = reactFlowSpy.props.edges as Edge[];
    const passedNodes = reactFlowSpy.props.nodes as FlowNode[];
    expect(() => structuredClone(passedEdges)).not.toThrow();
    expect(passedEdges).toHaveLength(4);
    expect(
      passedNodes.filter((node) => node.type === GROUP_BUNDLE_PORT_NODE_TYPE)
    ).toHaveLength(2);
    expect(passedEdges.filter((edge) => edge.hidden)).toHaveLength(0);
    expect(passedEdges.filter((edge) => isGroupBundleSegmentEdgeId(edge.id)))
      .toHaveLength(3);
    expect(
      passedEdges.find((edge) => edge.id === "__group_bundle__:group-a->group-b")
    ).toMatchObject({
      type: "groupBundle",
      source: "__group_bundle_port__:source:group-a->group-b",
      target: "__group_bundle_port__:target:group-a->group-b",
      selectable: false,
      data: {
        bundledEdgeIds: ["edge-1", "edge-2"],
        count: 2,
        sourceGroupId: "group-a",
        targetGroupId: "group-b",
        sourceLabel: "A",
        targetLabel: "B",
      },
    });
  });

  it("routes single cross-group edges through boundary ports", () => {
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "b1" } as Edge,
        ]}
      />
    );

    const passedEdges = reactFlowSpy.props.edges as Edge[];
    const passedNodes = reactFlowSpy.props.nodes as FlowNode[];

    expect(passedEdges.find((edge) => edge.id === "edge-1")).toBeUndefined();
    expect(
      passedNodes.filter((node) => node.type === GROUP_BUNDLE_PORT_NODE_TYPE)
    ).toHaveLength(2);
    expect(passedEdges.filter((edge) => isGroupBundleSegmentEdgeId(edge.id)))
      .toHaveLength(2);
    expect(
      passedEdges
        .filter((edge) => isGroupBundleSegmentEdgeId(edge.id))
        .every((edge) => edge.type === GROUP_BUNDLE_SEGMENT_EDGE_TYPE)
    ).toBe(true);
    expect(
      passedEdges.find((edge) => edge.id === "__group_bundle__:group-a->group-b")
    ).toMatchObject({
      type: "groupBundle",
      data: {
        bundledEdgeIds: ["edge-1"],
        count: 1,
      },
    });
  });

  it("translates source reconnects from dashed group segments to the canonical edge", () => {
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "a2",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 120 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];
    const canonicalEdge = {
      id: "edge-1",
      source: "a1",
      sourceHandle: "out",
      target: "b1",
      targetHandle: "in",
    } as Edge;
    const onReconnect = vi.fn();

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[canonicalEdge]}
        onReconnect={onReconnect}
      />
    );

    const passedEdges = reactFlowSpy.props.edges as Edge[];
    const sourceSegment = passedEdges.find(
      (edge) =>
        isGroupBundleSegmentEdgeId(edge.id) && edge.data?.side === "source"
    );

    expect(sourceSegment).toMatchObject({
      reconnectable: "source",
      data: { bundledEdgeIds: ["edge-1"], side: "source" },
    });

    act(() => {
      (reactFlowSpy.props.onReconnect as (oldEdge: Edge, connection: unknown) => void)(
        sourceSegment as Edge,
        {
          source: "a2",
          sourceHandle: "out-2",
          target: sourceSegment?.target,
          targetHandle: sourceSegment?.targetHandle,
        }
      );
    });

    expect(onReconnect).toHaveBeenCalledWith(canonicalEdge, {
      source: "a2",
      sourceHandle: "out-2",
      target: "b1",
      targetHandle: "in",
    });
  });

  it("translates target reconnects from dashed group segments to the canonical edge", () => {
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "b2",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 120 },
        data: {},
      } as FlowNode,
    ];
    const canonicalEdge = {
      id: "edge-1",
      source: "a1",
      sourceHandle: "out",
      target: "b1",
      targetHandle: "in",
    } as Edge;
    const onReconnect = vi.fn();

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[canonicalEdge]}
        onReconnect={onReconnect}
      />
    );

    const passedEdges = reactFlowSpy.props.edges as Edge[];
    const targetSegment = passedEdges.find(
      (edge) =>
        isGroupBundleSegmentEdgeId(edge.id) && edge.data?.side === "target"
    );

    expect(targetSegment).toMatchObject({
      reconnectable: "target",
      data: { bundledEdgeIds: ["edge-1"], side: "target" },
    });

    act(() => {
      (reactFlowSpy.props.onReconnect as (oldEdge: Edge, connection: unknown) => void)(
        targetSegment as Edge,
        {
          source: targetSegment?.source,
          sourceHandle: targetSegment?.sourceHandle,
          target: "b2",
          targetHandle: "in-2",
        }
      );
    });

    expect(onReconnect).toHaveBeenCalledWith(canonicalEdge, {
      source: "a1",
      sourceHandle: "out",
      target: "b2",
      targetHandle: "in-2",
    });
  });

  it("deselects canonical edges when a selected dashed group segment is deselected", () => {
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];
    const onEdgesChange = vi.fn();

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "b1", selected: true } as Edge,
        ]}
        onEdgesChange={onEdgesChange}
      />
    );

    const passedEdges = reactFlowSpy.props.edges as Edge[];
    const segment = passedEdges.find((edge) =>
      isGroupBundleSegmentEdgeId(edge.id)
    );

    expect(segment).toBeDefined();

    act(() => {
      (reactFlowSpy.props.onEdgesChange as (changes: unknown[]) => void)([
        {
          id: segment?.id,
          type: "select",
          selected: false,
        },
      ]);
    });

    expect(onEdgesChange).toHaveBeenCalledWith([
      {
        id: "edge-1",
        type: "select",
        selected: false,
      },
    ]);
  });

  it("deselects canonical bundled edges when clicking empty group space selects the group", () => {
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];
    const onEdgesChange = vi.fn();
    const onNodesChange = vi.fn();

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "b1", selected: true } as Edge,
        ]}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
      />
    );

    act(() => {
      (reactFlowSpy.props.onNodesChange as (changes: unknown[]) => void)([
        {
          id: "group-a",
          type: "select",
          selected: true,
        },
      ]);
    });

    expect(onEdgesChange).toHaveBeenCalledWith([
      {
        id: "edge-1",
        type: "select",
        selected: false,
      },
    ]);
    expect(onNodesChange).toHaveBeenCalledWith([
      {
        id: "group-a",
        type: "select",
        selected: true,
      },
    ]);
  });

  it("deselects canonical bundled edges from the group body clear event", () => {
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];
    const onEdgesChange = vi.fn();

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "b1", selected: true } as Edge,
        ]}
        onEdgesChange={onEdgesChange}
      />
    );

    act(() => {
      window.dispatchEvent(new Event("rawbit:clear-bundle-edge-selection"));
    });

    expect(onEdgesChange).toHaveBeenCalledWith([
      {
        id: "edge-1",
        type: "select",
        selected: false,
      },
    ]);
  });

  it("keeps group boundary edges direct when only one endpoint is grouped", () => {
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "outside",
        type: "calculation",
        position: { x: 500, y: 40 },
        data: {},
      } as FlowNode,
    ];

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "outside" } as Edge,
        ]}
      />
    );

    const passedEdges = reactFlowSpy.props.edges as Edge[];
    const passedNodes = reactFlowSpy.props.nodes as FlowNode[];

    expect(passedEdges.find((edge) => edge.id === "edge-1")).toMatchObject({
      source: "a1",
      target: "outside",
    });
    expect(
      passedNodes.filter((node) => node.type === GROUP_BUNDLE_PORT_NODE_TYPE)
    ).toHaveLength(0);
    expect(passedEdges.filter((edge) => isGroupBundleSegmentEdgeId(edge.id)))
      .toHaveLength(0);
    expect(
      passedEdges.some((edge) =>
        edge.id.startsWith(GROUP_BUNDLE_EDGE_ID_PREFIX)
      )
    ).toBe(false);
  });

  it("stores vertical port drags on the owning group node", () => {
    const onNodesChange = vi.fn();
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "b1" } as Edge,
        ]}
        onNodesChange={onNodesChange}
      />
    );

    const passedNodes = reactFlowSpy.props.nodes as FlowNode[];
    const sourcePort = passedNodes.find(
      (node) =>
        node.type === GROUP_BUNDLE_PORT_NODE_TYPE && node.data.role === "source"
    );
    const targetPort = passedNodes.find(
      (node) =>
        node.type === GROUP_BUNDLE_PORT_NODE_TYPE && node.data.role === "target"
    );

    expect(sourcePort).toBeDefined();
    expect(targetPort).toBeDefined();

    act(() => {
      (
        reactFlowSpy.props.onNodesChange as (changes: unknown[]) => void
      )([
        {
          id: sourcePort?.id,
          type: "position",
          position: { x: 999, y: 150 },
          dragging: false,
        },
        {
          id: targetPort?.id,
          type: "position",
          position: { x: -999, y: 20 },
          dragging: false,
        },
      ]);
    });

    expect(onNodesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "group-a",
        type: "replace",
        __rawbitGroupBundlePortDragging: false,
        __rawbitGroupBundlePortDragId: sourcePort?.id,
        item: expect.objectContaining({
          data: expect.objectContaining({
            groupBundlePortOffsets: expect.objectContaining({
              sourceByBundle: { "group-a->group-b": 59 },
            }),
          }),
        }),
      }),
      expect.objectContaining({
        id: "group-b",
        type: "replace",
        __rawbitGroupBundlePortDragging: false,
        __rawbitGroupBundlePortDragId: targetPort?.id,
        item: expect.objectContaining({
          data: expect.objectContaining({
            groupBundlePortOffsets: expect.objectContaining({
              targetByBundle: { "group-a->group-b": -71 },
            }),
          }),
        }),
      }),
    ]);
  });

  it("stores drags independently for each group bundle port", () => {
    const onNodesChange = vi.fn();
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-c",
        type: "shadcnGroup",
        position: { x: 500, y: 300 },
        data: { title: "C", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "a2",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 120 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "c1",
        type: "calculation",
        parentId: "group-c",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "b1" } as Edge,
          { id: "edge-2", source: "a2", target: "c1" } as Edge,
        ]}
        onNodesChange={onNodesChange}
      />
    );

    const passedNodes = reactFlowSpy.props.nodes as FlowNode[];
    const sourcePortToB = passedNodes.find(
      (node) =>
        node.type === GROUP_BUNDLE_PORT_NODE_TYPE &&
        node.data.role === "source" &&
        node.data.bundleId === "group-a->group-b"
    );
    const sourcePortToC = passedNodes.find(
      (node) =>
        node.type === GROUP_BUNDLE_PORT_NODE_TYPE &&
        node.data.role === "source" &&
        node.data.bundleId === "group-a->group-c"
    );

    expect(sourcePortToB).toBeDefined();
    expect(sourcePortToC).toBeDefined();

    act(() => {
      (
        reactFlowSpy.props.onNodesChange as (changes: unknown[]) => void
      )([
        {
          id: sourcePortToB?.id,
          type: "position",
          position: { x: 999, y: 150 },
          dragging: false,
        },
      ]);
    });

    expect(onNodesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "group-a",
        type: "replace",
        item: expect.objectContaining({
          data: expect.objectContaining({
            groupBundlePortOffsets: {
              sourceByBundle: { "group-a->group-b": 59 },
            },
          }),
        }),
      }),
    ]);
  });

  it("keeps the group bundle count label above the curve midpoint", () => {
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "a2",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 120 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          {
            id: "edge-1",
            source: "a1",
            target: "b1",
          } as Edge,
          {
            id: "edge-2",
            source: "a2",
            target: "b1",
          } as Edge,
        ]}
      />
    );

    expect(
      screen.getByTestId("group-bundle-count-label-__group_bundle__:group-a->group-b")
    ).toHaveAttribute("transform", "translate(15 -41.625)");
  });

  it("routes bundle selection through controlled node and edge changes", () => {
    const onEdgesChange = vi.fn();
    const onNodesChange = vi.fn();
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
        selected: true,
      } as FlowNode,
      {
        id: "a2",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 120 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "b1" } as Edge,
          { id: "edge-2", source: "a2", target: "b1", selected: true } as Edge,
        ]}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
      />
    );

    const bundleEdge = screen.getByTestId(
      "custom-edge-__group_bundle__:group-a->group-b"
    );
    const outsideBundleHit = bundleEdge.querySelector(
      '[data-bundle-hit="outside-bundle"]'
    );
    expect(outsideBundleHit).not.toBeNull();

    fireEvent.click(outsideBundleHit as Element);

    expect(onNodesChange).toHaveBeenCalledWith([
      { id: "a1", type: "select", selected: false },
    ]);
    expect(onEdgesChange).toHaveBeenCalledWith([
      { id: "edge-1", type: "select", selected: true },
    ]);
  });

  it("routes synthetic inside segment clicks to the represented edge", () => {
    const onEdgesChange = vi.fn();
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "a2",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 120 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "b1" } as Edge,
          { id: "edge-2", source: "a2", target: "b1" } as Edge,
        ]}
        onEdgesChange={onEdgesChange}
      />
    );

    const passedEdges = reactFlowSpy.props.edges as Edge[];
    const segmentEdge = passedEdges.find(
      (edge) =>
        isGroupBundleSegmentEdgeId(edge.id) &&
        edge.id.includes("source:group-a->group-b:a1")
    );
    expect(segmentEdge).toBeDefined();

    act(() => {
      (
        reactFlowSpy.props.onEdgeClick as (
          event: Pick<MouseEvent, "preventDefault" | "stopPropagation">,
          edge: Edge
        ) => void
      )(
        {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        },
        segmentEdge as Edge
      );
    });

    expect(onEdgesChange).toHaveBeenCalledWith([
      { id: "edge-1", type: "select", selected: true },
    ]);
  });

  it("deletes selected bundled edges that are not rendered as raw edges", () => {
    const onEdgesChange = vi.fn();
    const groupedNodes: FlowNode[] = [
      {
        id: "group-a",
        type: "shadcnGroup",
        position: { x: 0, y: 0 },
        data: { title: "A", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "group-b",
        type: "shadcnGroup",
        position: { x: 500, y: 0 },
        data: { title: "B", width: 300, height: 200 },
      } as FlowNode,
      {
        id: "a1",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
      {
        id: "a2",
        type: "calculation",
        parentId: "group-a",
        position: { x: 40, y: 120 },
        data: {},
      } as FlowNode,
      {
        id: "b1",
        type: "calculation",
        parentId: "group-b",
        position: { x: 40, y: 40 },
        data: {},
      } as FlowNode,
    ];

    render(
      <FlowCanvas
        {...baseProps}
        nodes={groupedNodes}
        edges={[
          { id: "edge-1", source: "a1", target: "b1", selected: true } as Edge,
          { id: "edge-2", source: "a2", target: "b1", selected: true } as Edge,
        ]}
        onEdgesChange={onEdgesChange}
      />
    );

    fireEvent.keyDown(window, { key: "Delete" });

    expect(onEdgesChange).toHaveBeenCalledWith([
      { id: "edge-1", type: "remove" },
      { id: "edge-2", type: "remove" },
    ]);
  });

  it("renders minimap with provided sizing and offset", () => {
    render(<FlowCanvas {...baseProps} />);

    expect(screen.getByTestId("minimap")).toBeInTheDocument();
    expect(minimapSpy.props.style).toBeDefined();
    const { style } = minimapSpy.props;
    expect(style?.right).toBe(baseProps.miniMapOffset);
    expect(style?.width).toBe(baseProps.miniMapSize.w);
    expect(style?.height).toBe(baseProps.miniMapSize.h);
    expect(minimapSpy.props.className).toContain("bg-background");
    expect(minimapSpy.props.bgColor).toBe("hsl(var(--background))");
    expect(minimapSpy.props.maskColor).toBe("rgba(0,0,0,0.35)");
  });

  it("omits minimap when disabled", () => {
    render(<FlowCanvas {...baseProps} showMiniMap={false} />);
    expect(screen.queryByTestId("minimap")).toBeNull();
  });

  it("passes the onMoveEnd handler through to ReactFlow", () => {
    const handleMoveEnd = vi.fn();
    render(<FlowCanvas {...baseProps} onMoveEnd={handleMoveEnd} />);
    expect(reactFlowSpy.props.onMoveEnd).toBe(handleMoveEnd);
  });
});
