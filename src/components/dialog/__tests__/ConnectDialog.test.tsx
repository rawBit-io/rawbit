import { renderWithProviders } from "@/test-utils/render";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import ConnectDialog, {
  type ConnectDialogProps,
  type EdgeLike,
  type NodePorts,
} from "../ConnectDialog";

const baseSource: NodePorts = {
  id: "node-a",
  label: "Node A",
  functionName: "sha256",
  outputs: [
    { label: "Hash", handleId: "hash" },
    { label: "PubKey", handleId: "pub" },
  ],
  inputs: [
    { label: "Hash", handleId: "hash" },
    { label: "PubKey", handleId: "pub" },
  ],
};

const baseTarget: NodePorts = {
  id: "node-b",
  label: "Node B",
  functionName: "checker",
  outputs: [],
  inputs: [
    { label: "Hash", handleId: "hash" },
    { label: "PubKey", handleId: "pub" },
  ],
};

const incomingToSource: EdgeLike[] = [
  {
    id: "edge-1",
    source: "node-x",
    sourceHandle: "out",
    target: "node-a",
    targetHandle: "hash",
  },
  {
    id: "edge-2",
    source: "node-y",
    sourceHandle: "pub",
    target: "node-a",
    targetHandle: "pub",
  },
];

const allPorts: NodePorts[] = [
  baseSource,
  baseTarget,
  {
    id: "node-x",
    label: "Node X",
    outputs: [{ label: "Hash", handleId: "out" }],
    inputs: [],
  },
  {
    id: "node-y",
    label: "Node Y",
    outputs: [{ label: "PubKey", handleId: "pub" }],
    inputs: [],
  },
];

function setup(props: Partial<ConnectDialogProps> = {}) {
  const onClose = vi.fn();
  const onApply = vi.fn();
  const utils = renderWithProviders(
    <ConnectDialog
      open
      onClose={onClose}
      onApply={onApply}
      source={baseSource}
      target={baseTarget}
      existingEdges={incomingToSource}
      allPorts={allPorts}
      {...props}
    />
  );
  return { onClose, onApply, user: userEvent.setup(), rerender: utils.rerender };
}

describe("ConnectDialog", () => {
  it("defaults to copy mode and retains previous selections when new rows appear", async () => {
    const { onApply, user, rerender } = setup();

    const rows = screen.getAllByRole("row").slice(1);
    await user.click(within(rows[0]).getByRole("checkbox"));

    const extendedEdges = [
      ...incomingToSource,
      {
        id: "edge-extra",
        source: "node-new",
        sourceHandle: "extra",
        target: "node-a",
        targetHandle: "extra",
      },
    ];
    const extendedSource: NodePorts = {
      ...baseSource,
      inputs: [
        ...baseSource.inputs,
        { label: "Extra", handleId: "extra" },
      ],
    };
    const extendedTarget: NodePorts = {
      ...baseTarget,
      inputs: [
        ...baseTarget.inputs,
        { label: "Extra", handleId: "extra" },
      ],
    };
    rerender(
      <ConnectDialog
        open
        onClose={vi.fn()}
        onApply={onApply}
        source={extendedSource}
        target={extendedTarget}
        existingEdges={extendedEdges}
        allPorts={[
          extendedSource,
          extendedTarget,
          ...allPorts.slice(2),
          { id: "node-new", label: "Node New", inputs: [], outputs: [{ label: "Extra", handleId: "extra" }] },
        ]}
      />
    );

    const updatedRows = screen.getAllByRole("row").slice(1);
    expect(within(updatedRows[0]).getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(within(updatedRows[2]).getByRole("checkbox")).toHaveAttribute(
      "aria-checked",
      "true"
    );

    await user.click(within(updatedRows[0]).getByRole("checkbox"));
    const apply = screen.getByRole("button", { name: /Apply/i });
    await user.click(apply);

    expect(onApply).toHaveBeenCalled();
  });

  it("wires selected outputs to inputs in connect mode", async () => {
    const { onApply, user } = setup({ existingEdges: [] });

    expect(screen.getByRole("button", { name: /Connect Edge/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy Inputs/i })).not.toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);
    await user.click(checkboxes[2]);

    const apply = screen.getByRole("button", { name: /Apply/i });
    expect(apply).toBeEnabled();
    await user.click(apply);

    expect(onApply).toHaveBeenCalledWith([
      {
        source: "node-a",
        sourceHandle: "hash",
        target: "node-b",
        targetHandle: "hash",
      },
    ]);
  });

  it("shows only copy inputs when manual connect cannot apply", async () => {
    const copyOnlySource: NodePorts = {
      ...baseSource,
      outputs: [],
    };
    const { onApply, user } = setup({ source: copyOnlySource });

    expect(screen.getByRole("button", { name: /Copy Inputs/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connect Edge/i })).not.toBeInTheDocument();

    const apply = screen.getByRole("button", { name: /Apply/i });
    expect(apply).toBeEnabled();
    await user.click(apply);

    expect(onApply).toHaveBeenCalledWith([
      {
        id: "enode-x-node-b-hash",
        source: "node-x",
        sourceHandle: "out",
        target: "node-b",
        targetHandle: "hash",
      },
      {
        id: "enode-y-node-b-pub",
        source: "node-y",
        sourceHandle: "pub",
        target: "node-b",
        targetHandle: "pub",
      },
    ]);
  });

  it("uses friendly labels for copied upstream source nodes", () => {
    const copyOnlySource: NodePorts = {
      ...baseSource,
      outputs: [],
    };

    setup({ source: copyOnlySource });

    expect(screen.getByText("Node X")).toBeInTheDocument();
    expect(screen.getByText("Node Y")).toBeInTheDocument();
    expect(screen.queryByText("node-x")).not.toBeInTheDocument();
    expect(screen.queryByText("node-y")).not.toBeInTheDocument();
  });

  it("disables swap when the reverse direction has no actions and enables it otherwise", async () => {
    const { onApply, user, rerender } = setup();
    expect(
      screen.getByRole("button", { name: /Swap source and target/i })
    ).toBeDisabled();

    const reverseConnectTarget: NodePorts = {
      ...baseTarget,
      inputs: [],
      outputs: [{ label: "out", handleId: "" }],
    };

    rerender(
      <ConnectDialog
        open
        onClose={vi.fn()}
        onApply={onApply}
        source={baseSource}
        target={reverseConnectTarget}
        existingEdges={[]}
        allPorts={allPorts}
      />
    );

    const swapButton = screen.getByRole("button", { name: /Swap source and target/i });
    expect(swapButton).toBeEnabled();
    await user.click(swapButton);
    expect(onApply).toHaveBeenCalledWith([]);
  });
});
