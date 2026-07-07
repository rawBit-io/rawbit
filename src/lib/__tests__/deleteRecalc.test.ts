import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import type { FlowNode } from "@/types";

import { survivingCalculableConsumersOnDelete } from "@/lib/flow/deleteRecalc";

const calcNode = (id: string): FlowNode =>
  ({
    id,
    type: "calculation",
    position: { x: 0, y: 0 },
    data: { functionName: "identity" },
  }) as FlowNode;

const radioNode = (
  id: string,
  functionName: "radio_send" | "radio_receive",
): FlowNode =>
  ({
    id,
    type: "radioNode",
    position: { x: 0, y: 0 },
    data: { functionName, radioChannel: "1" },
  }) as FlowNode;

const groupNode = (id: string): FlowNode =>
  ({ id, type: "shadcnGroup", position: { x: 0, y: 0 }, data: {} }) as FlowNode;

const edge = (source: string, target: string): Edge =>
  ({ id: `${source}->${target}`, source, target }) as Edge;

describe("survivingCalculableConsumersOnDelete", () => {
  it("dirties the surviving calculable consumer of a deleted feeder", () => {
    const nodes = [calcNode("feeder"), calcNode("consumer")];
    const result = survivingCalculableConsumersOnDelete(
      [calcNode("feeder")],
      [edge("feeder", "consumer")],
      nodes
    );
    expect([...result]).toEqual(["consumer"]);
  });

  it("ignores endpoints that are themselves deleted", () => {
    const nodes = [calcNode("a"), calcNode("b")];
    // Both endpoints deleted (e.g. deleting a 2-node selection): nothing survives.
    const result = survivingCalculableConsumersOnDelete(
      [calcNode("a"), calcNode("b")],
      [edge("a", "b")],
      nodes
    );
    expect(result.size).toBe(0);
  });

  it("excludes non-calculable survivors so they cannot be left stuck dirty", () => {
    const nodes = [calcNode("feeder"), groupNode("group")];
    const result = survivingCalculableConsumersOnDelete(
      [calcNode("feeder")],
      [edge("feeder", "group")],
      nodes
    );
    expect(result.size).toBe(0);
  });

  it("dirties the surviving source when a consumer is deleted", () => {
    const nodes = [calcNode("source"), calcNode("sink")];
    const result = survivingCalculableConsumersOnDelete(
      [calcNode("sink")],
      [edge("source", "sink")],
      nodes
    );
    expect([...result]).toEqual(["source"]);
  });

  it("returns empty when no edges were deleted", () => {
    const result = survivingCalculableConsumersOnDelete(
      [calcNode("isolated")],
      [],
      [calcNode("isolated")]
    );
    expect(result.size).toBe(0);
  });

  it("dirties surviving radio nodes when a radio node is deleted without visible edges", () => {
    const result = survivingCalculableConsumersOnDelete(
      [radioNode("send", "radio_send")],
      [],
      [
        radioNode("send", "radio_send"),
        radioNode("recv", "radio_receive"),
        calcNode("plain"),
      ]
    );

    expect([...result]).toEqual(["recv"]);
  });
});
