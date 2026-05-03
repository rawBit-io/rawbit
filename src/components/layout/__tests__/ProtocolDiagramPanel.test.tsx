import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProtocolDiagramPanel } from "@/components/layout/ProtocolDiagramPanel";
import type { ProtocolDiagramModel } from "@/lib/protocolDiagram/types";

const model: ProtocolDiagramModel = {
  hasGroups: true,
  groups: [
    {
      id: "full-group",
      title: "Round 1",
      comment: "Generates and normalizes participant keys.",
      nodeCount: 3,
      position: { x: 0, y: 0 },
      size: { w: 300, h: 200 },
      nodes: [
        {
          id: "node-a",
          title: "Node A",
          functionName: "identity",
          resultPreview: "0x01",
          localPosition: { x: 0, y: 0 },
        },
        {
          id: "node-b",
          title: "Node Bridge",
          localPosition: { x: 80, y: 0 },
        },
        {
          id: "node-c",
          title: "Node C",
          localPosition: { x: 160, y: 0 },
        },
      ],
      edges: [
        { id: "edge-a-b", sourceNodeId: "node-a", targetNodeId: "node-b" },
        { id: "edge-b-c", sourceNodeId: "node-b", targetNodeId: "node-c" },
      ],
      lanes: [],
      sections: [],
      presentation: "full",
    },
    {
      id: "lane-group",
      title: "Keys",
      nodeCount: 4,
      position: { x: 0, y: 0 },
      size: { w: 300, h: 200 },
      nodes: [
        { id: "alice-1", title: "Alice sk", localPosition: { x: 0, y: 0 }, laneKey: "alice" },
        { id: "alice-2", title: "Alice pk", localPosition: { x: 80, y: 0 }, laneKey: "alice" },
        { id: "bob-1", title: "Bob sk", localPosition: { x: 0, y: 100 }, laneKey: "bob" },
        { id: "bob-2", title: "Bob pk", localPosition: { x: 80, y: 100 }, laneKey: "bob" },
      ],
      edges: [
        { id: "edge-alice", sourceNodeId: "alice-1", targetNodeId: "alice-2" },
        { id: "edge-bob", sourceNodeId: "bob-1", targetNodeId: "bob-2" },
      ],
      lanes: [
        { key: "alice", title: "Alice", nodeIds: ["alice-1", "alice-2"], confidence: 0.95 },
        { key: "bob", title: "Bob", nodeIds: ["bob-1", "bob-2"], confidence: 0.95 },
      ],
      sections: [],
      presentation: "lanes",
    },
    {
      id: "compressed-group",
      title: "SigHash",
      nodeCount: 20,
      position: { x: 0, y: 0 },
      size: { w: 300, h: 200 },
      nodes: [
        { id: "tx", title: "TX Inputs", localPosition: { x: 10, y: 10 } },
        { id: "hash", title: "Hash Pipeline", localPosition: { x: 90, y: 10 } },
        { id: "preimage", title: "Preimage Assembly", localPosition: { x: 50, y: 90 } },
      ],
      edges: [
        { id: "tx-hash", sourceNodeId: "tx", targetNodeId: "hash" },
        { id: "hash-pre", sourceNodeId: "hash", targetNodeId: "preimage" },
      ],
      lanes: [],
      sections: [
        {
          id: "section-1",
          title: "TX Inputs",
          count: 9,
          nodeIds: ["n1"],
        },
        {
          id: "section-2",
          title: "Hash Pipeline",
          count: 10,
          nodeIds: ["n2"],
        },
      ],
      presentation: "compressed",
    },
  ],
  bundles: [
    {
      id: "bundle-0",
      sourceGroupId: "full-group",
      targetGroupId: "lane-group",
      semanticKey: "pair:full-group->lane-group",
      label: "1 edge",
      sensitivity: "public",
      edgeIds: ["e0"],
      sourceNodeIds: ["node-b"],
      targetNodeIds: ["alice-1"],
      count: 1,
      pairs: [{ edgeId: "e0", sourceNodeId: "node-b", targetNodeId: "alice-1" }],
    },
    {
      id: "bundle-1",
      sourceGroupId: "lane-group",
      targetGroupId: "compressed-group",
      semanticKey: "pair:lane-group->compressed-group",
      label: "2 edges",
      sensitivity: "public",
      edgeIds: ["e1", "e2"],
      sourceNodeIds: ["alice-1", "bob-1"],
      targetNodeIds: ["tx", "hash"],
      count: 2,
      pairs: [
        { edgeId: "e1", sourceNodeId: "alice-1", targetNodeId: "tx" },
        { edgeId: "e2", sourceNodeId: "bob-1", targetNodeId: "hash" },
      ],
    },
  ],
};

describe("ProtocolDiagramPanel", () => {
  it("renders boundary map in read-only mode", () => {
    render(
      <ProtocolDiagramPanel
        isOpen
        model={model}
        hasVisibleTabs
      />
    );

    expect(screen.getByText("Flow Map")).toBeInTheDocument();
    expect(
      screen.getByText("Generates and normalizes participant keys.")
    ).toBeInTheDocument();
    // Alice sk is an entry (inCross=true, inInt=0), so it appears on the left only.
    expect(screen.getAllByText("Alice sk")).toHaveLength(1);
    expect(screen.getByText("TX Inputs")).toBeInTheDocument();
    expect(screen.getByText("Node Bridge")).toBeInTheDocument();
    expect(screen.queryByText("x2")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Bundle Keys -> SigHash (2 edges)")).not.toBeInTheDocument();
  });

  it("labels flow map node columns as IN and OUT", () => {
    render(<ProtocolDiagramPanel isOpen model={model} />);

    expect(screen.getAllByText("IN").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OUT").length).toBeGreaterThan(0);
  });

  it("renders flow map group titles larger and bolder", () => {
    render(<ProtocolDiagramPanel isOpen model={model} />);

    const groupTitle = screen.getByText("> Round 1");

    expect(groupTitle.className).toContain("font-semibold");
    expect(groupTitle).toHaveStyle({
      fontSize: "16px",
      lineHeight: "20px",
    });
  });

  it("keeps the top-right output as main output at top and styles it bolder", () => {
    render(<ProtocolDiagramPanel isOpen model={model} />);

    const groupCard = document.querySelector(
      '[data-group-id="full-group"]'
    ) as HTMLElement | null;
    expect(groupCard).not.toBeNull();

    const rightButtons = Array.from(
      groupCard!.querySelectorAll('div.flex.justify-end button[data-node-id]')
    );
    expect(rightButtons.length).toBeGreaterThan(0);
    expect(rightButtons[0]).toHaveTextContent("Node C");
    expect(rightButtons[0]).toHaveAttribute("data-main-output", "true");
    expect(rightButtons[0]?.className).toContain("font-semibold");
  });

  it("always shows group comments without collapse controls", () => {
    render(<ProtocolDiagramPanel isOpen model={model} />);

    expect(
      screen.getByText("Generates and normalizes participant keys.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Collapse note|Expand note/i })
    ).not.toBeInTheDocument();
  });

  it("edits and saves group comments when user clicks the comment field", () => {
    const onUpdateGroupComment = vi.fn();
    render(
      <ProtocolDiagramPanel
        isOpen
        model={model}
        onUpdateGroupComment={onUpdateGroupComment}
      />
    );

    fireEvent.click(
      screen.getByText("Generates and normalizes participant keys.")
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "Updated group note from flow map." },
    });
    fireEvent.blur(textarea);

    expect(onUpdateGroupComment).toHaveBeenCalledWith(
      "full-group",
      "Updated group note from flow map."
    );
  });

  it("saves comment edits when clicking outside the comment box", () => {
    const onUpdateGroupComment = vi.fn();
    render(
      <ProtocolDiagramPanel
        isOpen
        model={model}
        onUpdateGroupComment={onUpdateGroupComment}
      />
    );

    fireEvent.click(
      screen.getByText("Generates and normalizes participant keys.")
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, {
      target: { value: "Saved via outside click." },
    });
    fireEvent.focus(textarea);

    const groupHeaderButton = document.querySelector(
      '[data-group-id="full-group"] [data-group-header="true"]'
    );
    expect(groupHeaderButton).not.toBeNull();
    fireEvent.pointerDown(groupHeaderButton as Element);

    expect(onUpdateGroupComment).toHaveBeenCalledWith(
      "full-group",
      "Saved via outside click."
    );
  });

  it("allocates enough height for long expanded comments", () => {
    const longCommentModel: ProtocolDiagramModel = {
      hasGroups: true,
      groups: [
        {
          id: "long-comment-group",
          title: "Long Comment Group",
          comment: [
            "This section explains the full key aggregation context for KEYAGG.",
            "It includes participant ordering assumptions and parity handling details.",
            "It also clarifies why the aggregate key is reused in later taproot checks.",
            "Finally it links the intermediate result to the next nonce generation step.",
          ].join(" "),
          nodeCount: 1,
          position: { x: 0, y: 0 },
          size: { w: 300, h: 200 },
          nodes: [{ id: "n0", title: "N0", localPosition: { x: 0, y: 0 } }],
          edges: [],
          lanes: [],
          sections: [],
          presentation: "full",
        },
      ],
      bundles: [],
    };

    render(<ProtocolDiagramPanel isOpen model={longCommentModel} />);

    const commentBox = document.querySelector(
      '[data-group-id="long-comment-group"] [data-group-comment="true"]'
    ) as HTMLDivElement | null;
    expect(commentBox).not.toBeNull();
    const computedHeight = Number.parseFloat(commentBox!.style.height);
    expect(computedHeight).toBeGreaterThan(136);
  });

  it("keeps boundary nodes on exactly one side based on rule priority", () => {
    const singleSideModel: ProtocolDiagramModel = {
      hasGroups: true,
      groups: [
        {
          id: "g-a",
          title: "Source Group",
          nodeCount: 1,
          position: { x: 0, y: 0 },
          size: { w: 300, h: 200 },
          nodes: [{ id: "src", title: "Src Node", localPosition: { x: 0, y: 0 } }],
          edges: [],
          lanes: [],
          sections: [],
          presentation: "full",
        },
        {
          id: "g-b",
          title: "Middle Group",
          nodeCount: 3,
          position: { x: 400, y: 0 },
          size: { w: 300, h: 200 },
          nodes: [
            { id: "seed", title: "Seed", localPosition: { x: 0, y: -40 } },
            { id: "relay", title: "Relay", localPosition: { x: 0, y: 0 } },
            { id: "other", title: "Other", localPosition: { x: 80, y: 20 } },
          ],
          edges: [
            { id: "e-int-seed-relay", sourceNodeId: "seed", targetNodeId: "relay" },
            { id: "e-int-seed-other", sourceNodeId: "seed", targetNodeId: "other" },
          ],
          lanes: [],
          sections: [],
          presentation: "full",
        },
        {
          id: "g-c",
          title: "Dest Group",
          nodeCount: 1,
          position: { x: 800, y: 0 },
          size: { w: 300, h: 200 },
          nodes: [{ id: "dest", title: "Dest Node", localPosition: { x: 0, y: 0 } }],
          edges: [],
          lanes: [],
          sections: [],
          presentation: "full",
        },
      ],
      bundles: [
        {
          id: "b-ab",
          sourceGroupId: "g-a",
          targetGroupId: "g-b",
          semanticKey: "pair:g-a->g-b",
          label: "1 edge",
          sensitivity: "public",
          edgeIds: ["e-ab"],
          sourceNodeIds: ["src"],
          targetNodeIds: ["relay"],
          count: 1,
          pairs: [{ edgeId: "e-ab", sourceNodeId: "src", targetNodeId: "relay" }],
        },
        {
          id: "b-bc",
          sourceGroupId: "g-b",
          targetGroupId: "g-c",
          semanticKey: "pair:g-b->g-c",
          label: "1 edge",
          sensitivity: "public",
          edgeIds: ["e-bc"],
          sourceNodeIds: ["relay"],
          targetNodeIds: ["dest"],
          count: 1,
          pairs: [{ edgeId: "e-bc", sourceNodeId: "relay", targetNodeId: "dest" }],
        },
      ],
    };

    render(<ProtocolDiagramPanel isOpen model={singleSideModel} />);

    // Relay has inCross=true and outCross=true, so Dual classification keeps it on the left.
    const relayElements = screen.getAllByTitle("Relay");
    expect(relayElements).toHaveLength(1);
    const middleGroup = document.querySelector('[data-group-id="g-b"]') as HTMLElement | null;
    expect(middleGroup).not.toBeNull();
    const rightRelay = middleGroup?.querySelector(
      "div.flex.justify-end button[title='Relay']"
    );
    expect(rightRelay).toBeNull();
  });

  it("promotes the strongest dual node to the right when right side is empty", () => {
    const emptyRightRecoveryModel: ProtocolDiagramModel = {
      hasGroups: true,
      groups: [
        {
          id: "g-a",
          title: "A",
          nodeCount: 1,
          position: { x: 0, y: 0 },
          size: { w: 300, h: 200 },
          nodes: [{ id: "a0", title: "A0", localPosition: { x: 0, y: 0 } }],
          edges: [],
          lanes: [],
          sections: [],
          presentation: "full",
        },
        {
          id: "g-b",
          title: "B",
          nodeCount: 2,
          position: { x: 300, y: 0 },
          size: { w: 300, h: 200 },
          nodes: [
            { id: "dual-1", title: "Dual 1", localPosition: { x: 0, y: 0 } },
            { id: "dual-2", title: "Dual 2", localPosition: { x: 80, y: 0 } },
          ],
          edges: [],
          lanes: [],
          sections: [],
          presentation: "full",
        },
        {
          id: "g-c",
          title: "C",
          nodeCount: 1,
          position: { x: 600, y: 0 },
          size: { w: 300, h: 200 },
          nodes: [{ id: "c0", title: "C0", localPosition: { x: 0, y: 0 } }],
          edges: [],
          lanes: [],
          sections: [],
          presentation: "full",
        },
      ],
      bundles: [
        {
          id: "b-a-b-1",
          sourceGroupId: "g-a",
          targetGroupId: "g-b",
          semanticKey: "pair:g-a->g-b:1",
          label: "1 edge",
          sensitivity: "public",
          edgeIds: ["e-a-b-1"],
          sourceNodeIds: ["a0"],
          targetNodeIds: ["dual-1"],
          count: 1,
          pairs: [{ edgeId: "e-a-b-1", sourceNodeId: "a0", targetNodeId: "dual-1" }],
        },
        {
          id: "b-a-b-2",
          sourceGroupId: "g-a",
          targetGroupId: "g-b",
          semanticKey: "pair:g-a->g-b:2",
          label: "1 edge",
          sensitivity: "public",
          edgeIds: ["e-a-b-2"],
          sourceNodeIds: ["a0"],
          targetNodeIds: ["dual-2"],
          count: 1,
          pairs: [{ edgeId: "e-a-b-2", sourceNodeId: "a0", targetNodeId: "dual-2" }],
        },
        {
          id: "b-b-c",
          sourceGroupId: "g-b",
          targetGroupId: "g-c",
          semanticKey: "pair:g-b->g-c",
          label: "3 edges",
          sensitivity: "public",
          edgeIds: ["e-b-c-1", "e-b-c-2", "e-b-c-3"],
          sourceNodeIds: ["dual-1", "dual-2"],
          targetNodeIds: ["c0"],
          count: 3,
          pairs: [
            { edgeId: "e-b-c-1", sourceNodeId: "dual-1", targetNodeId: "c0" },
            { edgeId: "e-b-c-2", sourceNodeId: "dual-2", targetNodeId: "c0" },
            { edgeId: "e-b-c-3", sourceNodeId: "dual-2", targetNodeId: "c0" },
          ],
        },
      ],
    };

    render(<ProtocolDiagramPanel isOpen model={emptyRightRecoveryModel} />);

    const middleGroup = document.querySelector('[data-group-id="g-b"]') as HTMLElement | null;
    expect(middleGroup).not.toBeNull();

    const promotedRight = middleGroup?.querySelector(
      "div.flex.justify-end button[title='Dual 2']"
    );
    const dual1Right = middleGroup?.querySelector(
      "div.flex.justify-end button[title='Dual 1']"
    );

    expect(screen.getAllByTitle("Dual 1")).toHaveLength(1);
    expect(screen.getAllByTitle("Dual 2")).toHaveLength(1);
    expect(promotedRight).not.toBeNull();
    expect(dual1Right).toBeNull();
  });

  it("caps boundary nodes and shows overflow chips", () => {
    const leftNodes = Array.from({ length: 18 }, (_, index) => ({
      id: `in-${index}`,
      title: `Input ${index + 1}`,
      localPosition: { x: 0, y: index * 10 },
    }));
    const rightNodes = Array.from({ length: 10 }, (_, index) => ({
      id: `out-${index}`,
      title: `Output ${index + 1}`,
      localPosition: { x: 100, y: index * 10 },
    }));
    const edges = rightNodes.map((node, index) => ({
      id: `e-${index}`,
      sourceNodeId: "in-0",
      targetNodeId: node.id,
    }));

    const cappedModel: ProtocolDiagramModel = {
      hasGroups: true,
      groups: [
        {
          id: "g-capped",
          title: "Capped Group",
          nodeCount: leftNodes.length + rightNodes.length,
          position: { x: 0, y: 0 },
          size: { w: 300, h: 200 },
          nodes: [...leftNodes, ...rightNodes],
          edges,
          lanes: [],
          sections: [],
          presentation: "full",
        },
      ],
      bundles: [],
    };

    render(<ProtocolDiagramPanel isOpen model={cappedModel} />);

    expect(screen.getAllByText("+ 2 more")).toHaveLength(2);
    expect(screen.getAllByTitle(/additional .* hidden/)).toHaveLength(2);
  });

  it("fires group and boundary-node focus callbacks", () => {
    const onSelectNode = vi.fn();
    const onSelectGroup = vi.fn();

    render(
      <ProtocolDiagramPanel
        isOpen
        model={model}
        onSelectNode={onSelectNode}
        onSelectGroup={onSelectGroup}
      />
    );

    fireEvent.click(screen.getByTitle(/Focus Round 1 on canvas/i));
    expect(onSelectGroup).toHaveBeenCalledWith("full-group");

    fireEvent.click(screen.getByTitle("Node Bridge"));
    expect(onSelectNode).toHaveBeenCalledWith("node-b");
  });

  it("prevents text selection within the panel surface", () => {
    render(<ProtocolDiagramPanel isOpen model={model} />);
    expect(screen.getByTestId("protocol-diagram-panel").className).toContain(
      "select-none"
    );
  });

  it("restores wheel zoom when model switches from no-groups to groups while open", () => {
    const { rerender } = render(
      <ProtocolDiagramPanel
        isOpen
        model={{ hasGroups: false, groups: [], bundles: [] }}
      />
    );

    expect(screen.getByText("No groups found in this flow.")).toBeInTheDocument();

    rerender(<ProtocolDiagramPanel isOpen model={model} />);

    const viewport = screen.getByTestId("protocol-diagram-viewport");
    const content = screen.getByTestId("protocol-diagram-content");
    const before = content.style.transform;

    fireEvent.wheel(viewport, {
      deltaY: -120,
      clientX: 100,
      clientY: 100,
    });

    const after = content.style.transform;
    expect(after).not.toBe(before);
    expect(after).toContain("scale(");
  });

  it("recovers wheel zoom when a stale pan lock remains without pointerup", () => {
    render(<ProtocolDiagramPanel isOpen model={model} />);

    const viewport = screen.getByTestId("protocol-diagram-viewport");
    const content = screen.getByTestId("protocol-diagram-content");
    const before = content.style.transform;

    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 1,
      clientX: 120,
      clientY: 120,
    });

    fireEvent.wheel(viewport, {
      deltaY: -120,
      clientX: 100,
      clientY: 100,
      buttons: 0,
    });

    const after = content.style.transform;
    expect(after).not.toBe(before);
    expect(after).toContain("scale(");
  });
});
