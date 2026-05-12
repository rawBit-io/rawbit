import { markCodeSourceCacheBust } from "@/lib/codeSourceCache";

type IndexedDbDatabaseInfo = {
  name?: string | null;
};

type IndexedDbWithDatabases = IDBFactory & {
  databases?: () => Promise<IndexedDbDatabaseInfo[]>;
};

function deleteIndexedDbDatabase(
  indexedDBApi: IDBFactory,
  name: string
): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDBApi.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export async function resetWorkspaceStorageAndReload(
  targetWindow: Window = window
): Promise<void> {
  try {
    targetWindow.localStorage.clear();
  } catch (error) {
    console.warn("Failed to clear localStorage during workspace reset", error);
  }

  try {
    targetWindow.sessionStorage.clear();
  } catch (error) {
    console.warn("Failed to clear sessionStorage during workspace reset", error);
  }
  markCodeSourceCacheBust(targetWindow);

  const indexedDBApi = targetWindow.indexedDB as IndexedDbWithDatabases | undefined;
  if (indexedDBApi?.databases) {
    try {
      const databases = await indexedDBApi.databases();
      await Promise.allSettled(
        databases.map((database) =>
          database.name
            ? deleteIndexedDbDatabase(indexedDBApi, database.name)
            : Promise.resolve()
        )
      );
    } catch (error) {
      console.warn("Failed to clear IndexedDB during workspace reset", error);
    }
  }

  if (targetWindow.caches?.keys) {
    try {
      const keys = await targetWindow.caches.keys();
      await Promise.allSettled(keys.map((key) => targetWindow.caches.delete(key)));
    } catch (error) {
      console.warn("Failed to clear caches during workspace reset", error);
    }
  }

  targetWindow.location.reload();
}
