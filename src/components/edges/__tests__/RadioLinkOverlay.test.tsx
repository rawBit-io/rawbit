import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RadioLinkOverlay from "@/components/edges/RadioLinkOverlay";
import type { FlowNode } from "@/types";
import { buildFlowNode } from "@/test-utils/types";

type MockInternalNode = {
  measured?: { width?: number; height?: number };
  internals: { positionAbsolute: { x: number; y: number } };
};

const reactFlowMock = vi.hoisted(() => ({
  nodes: [] as FlowNode[],
  nodeLookup: new Map<string, MockInternalNode>(),
}));

vi.mock("@xyflow/react", () => ({
  Position: { Left: "left", Right: "right" },
  ViewportPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  getBezierPath: ({
    sourceX,
    sourceY,
    targetX,
    targetY,
  }: {
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
  }) => [`M${sourceX} ${sourceY} L${targetX} ${targetY}`, 0, 0],
  useStore: (
    selector: (state: {
      nodes: FlowNode[];
      nodeLookup: Map<string, MockInternalNode>;
    }) => unknown,
  ) =>
    selector({ nodes: reactFlowMock.nodes, nodeLookup: reactFlowMock.nodeLookup }),
}));

const radioNode = (
  id: string,
  functionName: "radio_send" | "radio_receive",
  channel: string,
  options: { selected?: boolean; x?: number; y?: number } = {},
) => {
  const node = buildFlowNode({
    id,
    type: "radioNode",
    selected: options.selected ?? false,
    data: { functionName, radioChannel: channel },
  });
  reactFlowMock.nodeLookup.set(id, {
    measured: { width: 132, height: 64 },
    internals: { positionAbsolute: { x: options.x ?? 0, y: options.y ?? 0 } },
  });
  return node;
};

describe("RadioLinkOverlay", () => {
  beforeEach(() => {
    reactFlowMock.nodes = [];
    reactFlowMock.nodeLookup = new Map();
  });

  it("renders nothing when no radio node is selected", () => {
    reactFlowMock.nodes = [
      radioNode("send", "radio_send", "1"),
      radioNode("recv", "radio_receive", "1"),
    ];

    render(<RadioLinkOverlay />);

    expect(screen.queryByTestId("radio-link-overlay")).not.toBeInTheDocument();
  });

  it("draws a pair line from sender right edge to receiver left edge on selection", () => {
    reactFlowMock.nodes = [
      radioNode("send", "radio_send", "1", { selected: true, x: 0, y: 0 }),
      radioNode("recv", "radio_receive", "1", { x: 400, y: 100 }),
    ];

    render(<RadioLinkOverlay />);

    const paths = screen.getAllByTestId("radio-link-overlay-path");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveAttribute("d", "M132 32 L400 132");
  });

  it("draws the same line when the receiver is the selected side", () => {
    reactFlowMock.nodes = [
      radioNode("send", "radio_send", "1", { x: 0, y: 0 }),
      radioNode("recv", "radio_receive", "1", { selected: true, x: 400, y: 100 }),
    ];

    render(<RadioLinkOverlay />);

    expect(screen.getAllByTestId("radio-link-overlay-path")).toHaveLength(1);
  });

  it("links a selected sender to all of its receivers, deduped against a selected receiver", () => {
    reactFlowMock.nodes = [
      radioNode("send", "radio_send", "2", { selected: true }),
      radioNode("recv-a", "radio_receive", "2", { selected: true, x: 300 }),
      radioNode("recv-b", "radio_receive", "2", { x: 300, y: 200 }),
      radioNode("recv-other", "radio_receive", "9", { x: 600 }),
    ];

    render(<RadioLinkOverlay />);

    expect(screen.getAllByTestId("radio-link-overlay-path")).toHaveLength(2);
  });

  it("draws nothing for broken links (duplicate or missing senders)", () => {
    reactFlowMock.nodes = [
      radioNode("send-a", "radio_send", "1", { selected: true }),
      radioNode("send-b", "radio_send", "1", { x: 100 }),
      radioNode("recv", "radio_receive", "1", { selected: true, x: 300 }),
      radioNode("recv-orphan", "radio_receive", "7", { selected: true, x: 500 }),
    ];

    render(<RadioLinkOverlay />);

    expect(screen.queryByTestId("radio-link-overlay")).not.toBeInTheDocument();
  });

  it("ignores selection on non-radio nodes", () => {
    reactFlowMock.nodes = [
      buildFlowNode({
        id: "calc",
        type: "calculation",
        selected: true,
        data: { functionName: "identity" },
      }),
      radioNode("send", "radio_send", "1"),
      radioNode("recv", "radio_receive", "1", { x: 300 }),
    ];

    render(<RadioLinkOverlay />);

    expect(screen.queryByTestId("radio-link-overlay")).not.toBeInTheDocument();
  });
});
