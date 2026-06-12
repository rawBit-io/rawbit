import { describe, expect, it } from "vitest";
import { cn, getVal, setVal, isValsDict } from "@/lib/utils";

describe("cn", () => {
  it("merges tailwind classes with precedence", () => {
    expect(cn("p-2", "p-4", undefined)).toBe("p-4");
  });
});

describe("vals helpers", () => {
  it("reads from array and sparse dictionary formats", () => {
    expect(getVal(["a", "b"], 1)).toBe("b");
    expect(getVal({ 1: "c" }, 1)).toBe("c");
    expect(isValsDict({ 0: "x" })).toBe(true);
    expect(isValsDict(["x"])).toBe(false);
  });

  it("creates sparse dictionary and prunes empty strings", () => {
    const dict = setVal(["a", "", "c"], 1, "b");
    expect(dict).toEqual({ 0: "a", 1: "b", 2: "c" });

    const cleared = setVal(dict, 0, "");
    expect(cleared).toEqual({ 1: "b", 2: "c" });
  });

  it("starts from an empty dictionary when the store is missing", () => {
    expect(setVal(undefined, 2, "x")).toEqual({ 2: "x" });
    expect(setVal(null, 0, "")).toEqual({});
  });
});
