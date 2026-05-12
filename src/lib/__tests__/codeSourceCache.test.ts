import { describe, expect, it, vi } from "vitest";
import {
  buildCodeSourceUrl,
  getCodeSourceCacheBust,
  markCodeSourceCacheBust,
} from "@/lib/codeSourceCache";

function storageStub(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values[key] = value;
    }),
  };
}

describe("code source cache helpers", () => {
  it("builds the normal code URL when no reset token is present", () => {
    const sessionStorage = storageStub();

    expect(
      buildCodeSourceUrl("http://localhost:5007", "hash160_to_p2pkh_address", {
        sessionStorage,
      } as unknown as Window)
    ).toBe(
      "http://localhost:5007/code?functionName=hash160_to_p2pkh_address"
    );
  });

  it("adds the reset cache-bust token when present", () => {
    const sessionStorage = storageStub({
      "rawbit:code-source-cache-bust": "reset-123",
    });

    expect(
      buildCodeSourceUrl("http://localhost:5007", "hash160_to_p2pkh_address", {
        sessionStorage,
      } as unknown as Window)
    ).toBe(
      "http://localhost:5007/code?functionName=hash160_to_p2pkh_address&cacheBust=reset-123"
    );
  });

  it("stores a cache-bust token for the current workspace reset", () => {
    const sessionStorage = storageStub();

    markCodeSourceCacheBust({ sessionStorage } as unknown as Window);

    expect(sessionStorage.setItem).toHaveBeenCalledWith(
      "rawbit:code-source-cache-bust",
      expect.any(String)
    );
    expect(
      getCodeSourceCacheBust({ sessionStorage } as unknown as Window)
    ).toEqual(expect.any(String));
  });
});
