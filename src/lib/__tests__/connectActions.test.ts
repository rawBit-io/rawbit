import { describe, expect, it } from "vitest";

import {
  getDirectionAvailability,
  haveSameInputStructure,
  type EdgeLike,
  type NodePorts,
} from "@/lib/nodes/connectActions";

const source = (id: string, outputs = ["out"]): NodePorts => ({
  id,
  label: id,
  inputs: [],
  outputs: outputs.map((handleId) => ({ label: handleId, handleId })),
});

const target = (id: string, inputs = ["input-0"]): NodePorts => ({
  id,
  label: id,
  inputs: inputs.map((handleId) => ({ label: handleId, handleId })),
  outputs: [],
});

const nodeWithInputs = (
  id: string,
  inputs: { label: string; handleId: string }[],
  outputs: string[] = []
): NodePorts => ({
  id,
  label: id,
  inputs,
  outputs: outputs.map((handleId) => ({ label: handleId, handleId })),
});

describe("connect action availability", () => {
  it("treats same ordered input handles as compatible even when labels differ", () => {
    expect(
      haveSameInputStructure(
        nodeWithInputs("source", [
          { label: "Renamed Private Key", handleId: "input-0" },
          { label: "Renamed TX", handleId: "input-1" },
        ]),
        nodeWithInputs("target", [
          { label: "Private Key", handleId: "input-0" },
          { label: "TX Hex", handleId: "input-1" },
        ])
      )
    ).toBe(true);
  });

  it("treats different input counts or handle order as incompatible", () => {
    expect(
      haveSameInputStructure(
        target("source", ["input-0", "input-1"]),
        target("target", ["input-0"])
      )
    ).toBe(false);

    expect(
      haveSameInputStructure(
        target("source", ["input-0", "input-1"]),
        target("target", ["input-1", "input-0"])
      )
    ).toBe(false);
  });

  it("allows manual connect when the source has outputs and target has a free input", () => {
    const availability = getDirectionAvailability(
      source("source"),
      target("target", ["input-0", "input-1"]),
      [
        {
          id: "existing",
          source: "other",
          sourceHandle: null,
          target: "target",
          targetHandle: "input-0",
        },
      ]
    );

    expect(availability.canConnectEdge).toBe(true);
    expect(availability.availableModes).toEqual(["connect"]);
  });

  it("blocks manual connect when every target input is already occupied", () => {
    const availability = getDirectionAvailability(
      source("source"),
      target("target", ["input-0", "input-1"]),
      [
        {
          id: "existing-0",
          source: "other-0",
          sourceHandle: null,
          target: "target",
          targetHandle: "input-0",
        },
        {
          id: "existing-1",
          source: "other-1",
          sourceHandle: null,
          target: "target",
          targetHandle: "input-1",
        },
      ]
    );

    expect(availability.canConnectEdge).toBe(false);
    expect(availability.canDoAnything).toBe(false);
  });

  it("allows copy inputs even when the source has no outputs", () => {
    const copyOnlySource = target("source", ["input-0"]);
    const edges: EdgeLike[] = [
      {
        id: "incoming",
        source: "upstream",
        sourceHandle: null,
        target: "source",
        targetHandle: "input-0",
      },
    ];

    const availability = getDirectionAvailability(
      copyOnlySource,
      target("target", ["input-0"]),
      edges
    );

    expect(availability.canConnectEdge).toBe(false);
    expect(availability.canCopyInputs).toBe(true);
    expect(availability.availableModes).toEqual(["copy"]);
    expect(availability.copyPlan.rows).toEqual([
      {
        id: "eupstream-target-input-0",
        source: "upstream",
        sourceHandle: null,
        target: "target",
        targetHandle: "input-0",
      },
    ]);
  });

  it("offers both modes when both manual connect and copy inputs can apply", () => {
    const copyAndConnectSource: NodePorts = {
      ...source("source"),
      inputs: [
        { label: "input-0", handleId: "input-0" },
        { label: "input-1", handleId: "input-1" },
      ],
    };
    const edges: EdgeLike[] = [
      {
        id: "incoming",
        source: "upstream",
        sourceHandle: null,
        target: "source",
        targetHandle: "input-0",
      },
    ];

    const availability = getDirectionAvailability(
      copyAndConnectSource,
      target("target", ["input-0", "input-1"]),
      edges
    );

    expect(availability.canConnectEdge).toBe(true);
    expect(availability.canCopyInputs).toBe(true);
    expect(availability.availableModes).toEqual(["connect", "copy"]);
  });

  it("blocks copy inputs for partially overlapping template structures", () => {
    const legacyTemplate = target("legacy-template", [
      "input-0",
      "input-1",
      "input-2",
    ]);
    const generalTemplate = target("general-template", [
      "input-0",
      "input-1",
      "input-10",
      "input-20",
    ]);
    const edges: EdgeLike[] = [
      {
        id: "incoming-0",
        source: "version",
        sourceHandle: null,
        target: "legacy-template",
        targetHandle: "input-0",
      },
      {
        id: "incoming-1",
        source: "locktime",
        sourceHandle: null,
        target: "legacy-template",
        targetHandle: "input-1",
      },
    ];

    const availability = getDirectionAvailability(
      legacyTemplate,
      generalTemplate,
      edges
    );

    expect(availability.canCopyInputs).toBe(false);
    expect(availability.copyPlan.rows).toEqual([]);
    expect(availability.canDoAnything).toBe(false);
  });

  it("does not allow copy when matching target handles are already occupied", () => {
    const copyOnlySource = target("source", ["input-0"]);
    const edges: EdgeLike[] = [
      {
        id: "incoming",
        source: "upstream",
        sourceHandle: null,
        target: "source",
        targetHandle: "input-0",
      },
      {
        id: "occupied",
        source: "other",
        sourceHandle: null,
        target: "target",
        targetHandle: "input-0",
      },
    ];

    const availability = getDirectionAvailability(
      copyOnlySource,
      target("target", ["input-0"]),
      edges
    );

    expect(availability.canCopyInputs).toBe(false);
    expect(availability.copyPlan.skipped).toBe(1);
    expect(availability.canDoAnything).toBe(false);
  });

  it("does not plan duplicate copied rows to the same target handle", () => {
    const copyOnlySource = target("source", ["input-0"]);
    const edges: EdgeLike[] = [
      {
        id: "incoming-0",
        source: "upstream-0",
        sourceHandle: null,
        target: "source",
        targetHandle: "input-0",
      },
      {
        id: "incoming-1",
        source: "upstream-1",
        sourceHandle: null,
        target: "source",
        targetHandle: "input-0",
      },
    ];

    const availability = getDirectionAvailability(
      copyOnlySource,
      target("target", ["input-0"]),
      edges
    );

    expect(availability.canCopyInputs).toBe(true);
    expect(availability.copyPlan.rows).toHaveLength(1);
    expect(availability.copyPlan.rows[0]).toMatchObject({
      source: "upstream-0",
      target: "target",
      targetHandle: "input-0",
    });
    expect(availability.copyPlan.skipped).toBe(1);
  });
});
