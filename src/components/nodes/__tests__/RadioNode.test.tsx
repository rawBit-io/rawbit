import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RadioNode from "@/components/nodes/RadioNode";
import type { FlowNode } from "@/types";
import { buildFlowNode, buildNodeProps } from "@/test-utils/types";

const reactFlowMock = vi.hoisted(() => ({
  nodes: [] as FlowNode[],
  setNodes: vi.fn(),
  markPendingAfterDirtyChange: vi.fn(),
  scheduleSnapshot: vi.fn(),
}));

vi.mock("@xyflow/react", () => ({
  Handle: (props: Record<string, unknown>) => (
    <div data-testid="handle" data-handle-id={String(props.id ?? "")} />
  ),
  Position: {
    Left: "left",
    Right: "right",
  },
  useReactFlow: () => ({
    setNodes: reactFlowMock.setNodes,
  }),
  useStore: (selector: (state: { nodes: FlowNode[] }) => unknown) =>
    selector({ nodes: reactFlowMock.nodes }),
}));

vi.mock("@/hooks/useSnapshotSchedulerContext", () => ({
  useSnapshotSchedulerContext: () => ({
    markPendingAfterDirtyChange: reactFlowMock.markPendingAfterDirtyChange,
    scheduleSnapshot: reactFlowMock.scheduleSnapshot,
  }),
}));

const radioSend = (id: string, channel: string, extra: Partial<FlowNode> = {}) =>
  buildFlowNode({
    id,
    type: "radioNode",
    data: {
      functionName: "radio_send",
      title: `Radio Send ${channel}`,
      radioChannel: channel,
      outputPorts: [
        { label: channel, handleId: "", showHandle: false, showLabel: false },
      ],
    },
    ...extra,
  });

const radioReceive = (
  id: string,
  channel: string,
  extra: Partial<FlowNode> = {},
) =>
  buildFlowNode({
    id,
    type: "radioNode",
    data: {
      functionName: "radio_receive",
      title: `Radio Receive ${channel}`,
      radioChannel: channel,
      outputPorts: [{ label: channel, handleId: "", showLabel: false }],
    },
    ...extra,
  });

describe("RadioNode", () => {
  beforeEach(() => {
    reactFlowMock.nodes = [];
    reactFlowMock.setNodes.mockReset();
    reactFlowMock.markPendingAfterDirtyChange.mockReset();
    reactFlowMock.scheduleSnapshot.mockReset();
  });

  it("shows backend error state on the radio node", () => {
    const send = radioSend("send", "1");
    const receive = radioReceive("receive", "1", {
      data: {
        functionName: "radio_receive",
        title: "Radio Receive 1",
        radioChannel: "1",
        error: true,
        extendedError: "Cycle detected",
      },
    });
    reactFlowMock.nodes = [send, receive];

    render(<RadioNode {...buildNodeProps(receive)} />);

    expect(screen.getByLabelText("Cycle detected")).toBeInTheDocument();
  });

  it("marks duplicate radio senders on the sender nodes", () => {
    const sendA = radioSend("send-a", "1");
    const sendB = radioSend("send-b", "1");
    reactFlowMock.nodes = [sendA, sendB];

    render(<RadioNode {...buildNodeProps(sendA)} />);

    expect(
      screen.getByLabelText("Radio Send 1 duplicates another Radio Send"),
    ).toBeInTheDocument();
  });

  it("does not snapshot or dirty nodes when committing the same channel", () => {
    const send = radioSend("send", "1");
    reactFlowMock.nodes = [send];

    render(<RadioNode {...buildNodeProps(send)} />);

    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Radio Send channel 1" }),
    );
    fireEvent.blur(screen.getByRole("textbox", { name: "Radio Send channel 1" }));

    expect(reactFlowMock.setNodes).not.toHaveBeenCalled();
    expect(reactFlowMock.markPendingAfterDirtyChange).not.toHaveBeenCalled();
    expect(reactFlowMock.scheduleSnapshot).not.toHaveBeenCalled();
  });

  it("updates radioChannel, title, output port label, and radio dirty state", () => {
    const receive = radioReceive("receive", "1");
    const other = radioSend("send", "1");
    reactFlowMock.nodes = [receive, other];

    render(<RadioNode {...buildNodeProps(receive)} />);

    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Radio Receive channel 1" }),
    );
    const input = screen.getByRole("textbox", {
      name: "Radio Receive channel 1",
    });
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(reactFlowMock.setNodes).toHaveBeenCalledTimes(1);
    const updater = reactFlowMock.setNodes.mock.calls[0][0] as (
      nodes: FlowNode[],
    ) => FlowNode[];
    const nextNodes = updater(reactFlowMock.nodes);
    const nextReceive = nextNodes.find((node) => node.id === "receive");
    const nextOther = nextNodes.find((node) => node.id === "send");

    expect(nextReceive?.data.radioChannel).toBe("4");
    expect(nextReceive?.data.title).toBe("Radio Receive 4");
    expect(nextReceive?.data.outputPorts?.[0]?.label).toBe("4");
    expect(nextReceive?.data.dirty).toBe(true);
    expect(nextOther?.data.dirty).toBe(true);
    expect(reactFlowMock.markPendingAfterDirtyChange).toHaveBeenCalledTimes(1);
    expect(reactFlowMock.scheduleSnapshot).toHaveBeenCalledWith(
      "Change Radio Channel",
      { coalesceFollowingCalc: true },
    );
  });
});
