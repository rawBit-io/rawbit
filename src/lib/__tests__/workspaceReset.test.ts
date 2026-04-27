import { describe, expect, it, vi } from "vitest";
import { resetWorkspaceStorageAndReload } from "@/lib/workspaceReset";

describe("resetWorkspaceStorageAndReload", () => {
  it("clears browser storage and reloads", async () => {
    const localStorageClear = vi.fn();
    const sessionStorageClear = vi.fn();
    const reload = vi.fn();
    const deleteDatabase = vi.fn(() => {
      const request: Partial<IDBOpenDBRequest> = {};
      setTimeout(() => {
        const handleSuccess = request.onsuccess as
          | ((this: IDBOpenDBRequest, event: Event) => void)
          | null
          | undefined;
        handleSuccess?.call(request as IDBOpenDBRequest, new Event("success"));
      }, 0);
      return request as IDBOpenDBRequest;
    });
    const cacheDelete = vi.fn().mockResolvedValue(true);

    const targetWindow = {
      localStorage: { clear: localStorageClear },
      sessionStorage: { clear: sessionStorageClear },
      indexedDB: {
        databases: vi.fn().mockResolvedValue([{ name: "rawbit-db" }]),
        deleteDatabase,
      },
      caches: {
        keys: vi.fn().mockResolvedValue(["rawbit-cache"]),
        delete: cacheDelete,
      },
      location: { reload },
    } as unknown as Window;

    await resetWorkspaceStorageAndReload(targetWindow);

    expect(localStorageClear).toHaveBeenCalledTimes(1);
    expect(sessionStorageClear).toHaveBeenCalledTimes(1);
    expect(deleteDatabase).toHaveBeenCalledWith("rawbit-db");
    expect(cacheDelete).toHaveBeenCalledWith("rawbit-cache");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
