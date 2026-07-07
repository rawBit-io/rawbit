import { describe, expect, it } from "vitest";

import { ensureParentsBeforeChildren } from "@/lib/flow/nodeOrdering";

type TestNode = { id: string; parentId?: string };

const n = (id: string, parentId?: string): TestNode => ({ id, parentId });

describe("ensureParentsBeforeChildren", () => {
  it("returns the SAME array reference when already ordered", () => {
    const nodes = [n("group"), n("a", "group"), n("b", "group"), n("loose")];
    expect(ensureParentsBeforeChildren(nodes)).toBe(nodes);
  });

  it("moves a child that precedes its parent to directly after it", () => {
    const nodes = [n("x"), n("child", "group"), n("y"), n("group"), n("z")];
    expect(ensureParentsBeforeChildren(nodes).map((node) => node.id)).toEqual([
      "x",
      "y",
      "group",
      "child",
      "z",
    ]);
  });

  it("keeps the relative order of multiple parked children", () => {
    const nodes = [n("c1", "g"), n("c2", "g"), n("g"), n("c3", "g")];
    expect(ensureParentsBeforeChildren(nodes).map((node) => node.id)).toEqual([
      "g",
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("handles nested group chains in one pass", () => {
    const nodes = [n("leaf", "inner"), n("inner", "outer"), n("outer")];
    expect(ensureParentsBeforeChildren(nodes).map((node) => node.id)).toEqual([
      "outer",
      "inner",
      "leaf",
    ]);
  });

  it("treats a parentId that is not in the array as top-level", () => {
    const nodes = [n("orphan", "missing"), n("a")];
    expect(ensureParentsBeforeChildren(nodes)).toBe(nodes);
  });

  it("never drops nodes on self-referential parent ids", () => {
    const nodes = [n("weird", "weird"), n("a")];
    const result = ensureParentsBeforeChildren(nodes);
    expect(result.map((node) => node.id).sort()).toEqual(["a", "weird"]);
  });
});
