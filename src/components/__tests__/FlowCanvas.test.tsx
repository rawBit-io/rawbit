import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Edge } from "@xyflow/react";
import type { ReactNode } from "react";

import { FlowCanvas } from "@/components/FlowCanvas";
import { GROUP_BUNDLE_EDGE_SELECT_EVENT } from "@/components/edges/GroupBundleEdge";
import {
  GROUP_BUNDLE_PORT_NODE_TYPE,
  isGroupBundleSegmentEdgeId,
} from "@/lib/flow/groupEdgeBundling";
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

  it("disables edge selectability while drag-selection mode is active", () => {
    render(
      <FlowCanvas
        {...baseProps}
        isSelectionModeActive
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
    expect(passedEdges).toHaveLength(7);
    expect(
      passedNodes.filter((node) => node.type === GROUP_BUNDLE_PORT_NODE_TYPE)
    ).toHaveLength(2);
    expect(passedEdges.filter((edge) => edge.hidden)).toHaveLength(2);
    expect(passedEdges.filter((edge) => isGroupBundleSegmentEdgeId(edge.id)))
      .toHaveLength(4);
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

    act(() => {
      window.dispatchEvent(
        new CustomEvent(GROUP_BUNDLE_EDGE_SELECT_EVENT, {
          detail: { edgeIds: ["edge-1"] },
        })
      );
    });

    expect(onNodesChange).toHaveBeenCalledWith([
      { id: "a1", type: "select", selected: false },
    ]);
    expect(onEdgesChange).toHaveBeenCalledWith([
      { id: "edge-1", type: "select", selected: true },
      { id: "edge-2", type: "select", selected: false },
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
        edge.id.includes("source:group-a->group-b:edge-1")
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

  it("renders minimap with provided sizing and offset", () => {
    render(<FlowCanvas {...baseProps} />);

    expect(screen.getByTestId("minimap")).toBeInTheDocument();
    expect(minimapSpy.props.style).toBeDefined();
    const { style } = minimapSpy.props;
    expect(style?.right).toBe(baseProps.miniMapOffset);
    expect(style?.width).toBe(baseProps.miniMapSize.w);
    expect(style?.height).toBe(baseProps.miniMapSize.h);
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
