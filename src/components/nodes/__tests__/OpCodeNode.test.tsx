import { renderWithProviders } from "@/test-utils/render";
import type { SnapshotScheduler } from "@/hooks/useSnapshotScheduler";
import type { FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";
import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const clipboardHook = vi.fn();

vi.mock("@/hooks/nodes/useClipboardLite", () => ({
  useClipboardLite: (...args: unknown[]) => clipboardHook(...args),
}));

vi.mock("@/components/dialog/NodeCodeDialog", () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="opcode-code-dialog" /> : null),
}));

vi.mock("@/lib/opcodes", () => {
  const dataset = {
    arithmetic: [
      { name: "OP_ADD", hex: "93", description: "Add top two stack items" },
    ],
    flowControl: [
      { name: "OP_RETURN", hex: "6a", description: "Abort script" },
    ],
  } as const;

  const categoryNames = {
    arithmetic: "Arithmetic",
    flowControl: "Flow Control",
  } as const;

  const findOpItemByName = (name: string) => {
    for (const list of Object.values(dataset)) {
      const match = list.find((item) => item.name === name);
      if (match) return match;
    }
    return null;
  };

  return {
    OP_CODES: dataset,
    categoryNames,
    findOpItemByName,
  };
});

let setNodesMock: ReturnType<typeof vi.fn>;
let setEdgesMock: ReturnType<typeof vi.fn>;
let nodesState: FlowNode[];
let edgesState: Edge[];
let scheduler: SnapshotScheduler;

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({
      setNodes: (updater: (nodes: FlowNode[]) => FlowNode[]) => setNodesMock(updater),
      setEdges: (updater: (edges: Edge[]) => Edge[]) => setEdgesMock(updater),
      getNodes: () => nodesState,
      getEdges: () => edgesState,
    }),
    Handle: (props: Record<string, unknown>) => (
      <div data-testid="rf-handle" {...props} />
    ),
  };
});

import OpCodeNode from "../OpCodeNode";

describe("OpCodeNode", () => {
  beforeEach(() => {
    nodesState = [
      {
        id: "node-1",
        type: "calculation",
        position: { x: 0, y: 0 },
        data: {
          title: "Opcode Sequence",
          borderColor: undefined,
          opSequenceNames: [],
          showComment: false,
          comment: "",
        },
        selected: false,
        dragging: false,
        zIndex: 0,
      } as FlowNode,
    ];

    edgesState = [
      {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
      } as Edge,
    ];

    setNodesMock = vi.fn((updater) => {
      nodesState = updater(nodesState);
      return nodesState;
    });

    setEdgesMock = vi.fn((updater) => {
      edgesState = updater(edgesState);
      return edgesState;
    });

    scheduler = {
      pushCleanState: vi.fn(),
      scheduleSnapshot: vi.fn(),
      pendingSnapshotRef: { current: false },
      skipNextEdgeSnapshotRef: { current: false },
      skipNextNodeRemovalRef: { current: false },
      markPendingAfterDirtyChange: vi.fn(),
      clearPendingAfterCalc: vi.fn(),
      lockEdgeSnapshotSkip: vi.fn(),
      releaseEdgeSnapshotSkip: vi.fn(),
      lockNodeRemovalSnapshotSkip: vi.fn(),
      releaseNodeRemovalSnapshotSkip: vi.fn(),
    };

    clipboardHook.mockReset();
  });

  it("adds opcodes and copies hex output", async () => {
    const clipboardMock = {
      prettyResult: "",
      copyResult: vi.fn(),
      copyError: vi.fn(),
      copyId: vi.fn(),
      resultCopied: false,
      errorCopied: false,
      idCopied: false,
    };
    clipboardHook.mockReturnValue(clipboardMock);

    const user = userEvent.setup();

    const view = renderWithProviders(
      <OpCodeNode
        id="node-1"
        data={nodesState[0].data as FlowNode["data"]}
        selected={false}
        type="calculation"
        dragging={false}
        zIndex={0}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
      { snapshotScheduler: scheduler }
    );

    expect(screen.getByPlaceholderText(/search opcodes/i)).toBeInTheDocument();
    expect(screen.getByText(/sequence empty/i)).toBeInTheDocument();
    expect(screen.getByText(/no opcodes selected/i)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/search opcodes/i), "add");
    await user.click(screen.getByText("OP_ADD"));

    expect(nodesState[0].data.functionName).toBe("op_code_select");
    expect(nodesState[0].data.paramExtraction).toBe("multi_val");
    expect(nodesState[0].data.inputs?.vals).toEqual({ 0: "OP_ADD" });
    expect(nodesState[0].data.opSequenceNames).toBeUndefined();
    expect(nodesState[0].data.value).toBeUndefined();
    expect(nodesState[0].data.dirty).toBe(true);

    nodesState[0].data.result = "93";
    nodesState[0].data.dirty = false;

    view.rerender(
      <OpCodeNode
        id="node-1"
        data={nodesState[0].data as FlowNode["data"]}
        selected={false}
        type="calculation"
        dragging={false}
        zIndex={0}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />
    );

    expect(screen.getByText("93")).toBeInTheDocument();

    await user.click(screen.getByTitle("Copy"));
    expect(clipboardMock.copyResult).toHaveBeenCalledTimes(1);
  });

  it("toggles comment visibility and deletes the node from the menu", async () => {
    const clipboardMock = {
      prettyResult: "",
      copyResult: vi.fn(),
      copyError: vi.fn(),
      copyId: vi.fn(),
      resultCopied: false,
      errorCopied: false,
      idCopied: false,
    };
    clipboardHook.mockReturnValue(clipboardMock);

    const user = userEvent.setup();

    renderWithProviders(
      <OpCodeNode
        id="node-1"
        data={nodesState[0].data as FlowNode["data"]}
        selected={false}
        type="calculation"
        dragging={false}
        zIndex={0}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
      { snapshotScheduler: scheduler }
    );

    const menuTrigger = screen
      .getAllByRole("button")
      .find((btn) => btn.getAttribute("aria-haspopup") === "menu");
    expect(menuTrigger).toBeDefined();

    await user.click(menuTrigger!);
    await user.click(screen.getByRole("menuitem", { name: /show comment/i }));

    expect(nodesState[0].data.showComment).toBe(true);

    await user.click(menuTrigger!);
    await user.click(screen.getByRole("menuitem", { name: /delete node/i }));

    expect(setEdgesMock).toHaveBeenCalled();
    expect(nodesState).toHaveLength(0);
    expect(edgesState).toEqual([]);
    expect(scheduler.lockEdgeSnapshotSkip).toHaveBeenCalledTimes(1);
    expect(scheduler.releaseEdgeSnapshotSkip).not.toHaveBeenCalled();
    expect(scheduler.scheduleSnapshot).toHaveBeenCalledWith(
      "Node(s) removed",
      { refresh: true }
    );
  });

  it("captures a snapshot when comment editing is committed on blur", async () => {
    nodesState[0].data.showComment = true;
    nodesState[0].data.comment = "Old note";

    const clipboardMock = {
      prettyResult: "",
      copyResult: vi.fn(),
      copyError: vi.fn(),
      copyId: vi.fn(),
      resultCopied: false,
      errorCopied: false,
      idCopied: false,
    };
    clipboardHook.mockReturnValue(clipboardMock);

    const user = userEvent.setup();

    const view = renderWithProviders(
      <OpCodeNode
        id="node-1"
        data={nodesState[0].data as FlowNode["data"]}
        selected={false}
        type="calculation"
        dragging={false}
        zIndex={0}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
      { snapshotScheduler: scheduler }
    );

    let commentArea = screen.getByPlaceholderText(/enter your notes here/i);
    await user.click(commentArea);
    await user.clear(commentArea);
    await user.type(commentArea, "New note");

    view.rerender(
      <OpCodeNode
        id="node-1"
        data={nodesState[0].data as FlowNode["data"]}
        selected={false}
        type="calculation"
        dragging={false}
        zIndex={0}
        isConnectable={true}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />
    );

    commentArea = screen.getByPlaceholderText(/enter your notes here/i);
    await user.click(commentArea);
    await user.tab();

    expect(scheduler.scheduleSnapshot).toHaveBeenCalledWith(
      "Update Node Comment"
    );
  });
});
