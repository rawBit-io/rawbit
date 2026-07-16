import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import type { FlowNode } from "@/types";
import {
  restoreScriptSteps,
  snapshotScriptSteps,
  type ScriptStepsEntry,
} from "@/lib/share/scriptStepsCache";
import {
  decodeStoragePayload,
  encodeStoragePayload,
} from "@/lib/storageCompression";
import type {
  CompressTabRequest,
  CompressTabResponse,
  WorkerFlowTabArchive,
} from "@/workers/tabsCompression.types";
import { sanitizeGroupBundleVisualElementsForState } from "@/lib/flow/groupEdgeBundling";
import { normalizeAndDedupeEdgeConnections } from "@/lib/flow/edgeNormalization";
import { stripLegacyFlowMapNodeData } from "@/lib/flow/legacyCompatibility";
import {
  stripEphemeralEdgeUiState,
  stripEphemeralNodeUiState,
} from "@/lib/flow/ephemeralState";

export interface FlowTab {
  id: string;
  title: string;
  version: number;
  transform?: { x: number; y: number; zoom: number };
  tooltip?: string;
}

const MAX_TAB_TITLE_LENGTH = 40;
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
const IDENTITY_TRANSFORM_EPSILON = 0.0001;
const RESTORE_FIT_MIN_ZOOM = 0.2;
const RESTORE_FIT_RETRIES = [0, 80, 220] as const;

const normalizeTabTitle = (raw: string): string => {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Flow";
  if (collapsed.length <= MAX_TAB_TITLE_LENGTH) return collapsed;
  return collapsed.slice(0, MAX_TAB_TITLE_LENGTH);
};

interface FlowTabArchive {
  nodes: FlowNode[];
  edges: Edge[];
  scriptSteps?: ScriptStepsEntry[];
}

function isIdentityTransform(transform?: FlowTab["transform"]): boolean {
  if (!transform) return false;
  return (
    Math.abs(transform.x) <= IDENTITY_TRANSFORM_EPSILON &&
    Math.abs(transform.y) <= IDENTITY_TRANSFORM_EPSILON &&
    Math.abs(transform.zoom - 1) <= IDENTITY_TRANSFORM_EPSILON
  );
}

function shouldFitArchiveOnRestore(
  tab: FlowTab | undefined,
  archive: FlowTabArchive
): boolean {
  const hasGraph = archive.nodes.length > 0 || archive.edges.length > 0;
  if (!hasGraph) return false;
  if (!tab?.transform) return true;
  if (!isIdentityTransform(tab.transform)) return false;
  if (typeof window === "undefined") return false;

  const viewportWidth = Math.max(window.innerWidth || 0, 1);
  const viewportHeight = Math.max(window.innerHeight || 0, 1);
  const margin = 200;
  const requiredVisibleNodes = Math.min(2, archive.nodes.length);
  let visibleNodes = 0;

  for (const node of archive.nodes) {
    const x = node.position?.x;
    const y = node.position?.y;
    if (
      typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= -margin &&
      y >= -margin &&
      x <= viewportWidth + margin &&
      y <= viewportHeight + margin
    ) {
      visibleNodes += 1;
      if (visibleNodes >= requiredVisibleNodes) return false;
    }
  }

  return visibleNodes === 0 || archive.nodes.length > 1 || archive.edges.length > 0;
}

interface FlowTabArchiveEntry {
  raw?: FlowTabArchive;
  compressed?: string;
  pendingRequestId?: number;
}

function createEmptyArchive(): FlowTabArchive {
  return { nodes: [], edges: [] };
}

function filterEdgesForNodes(nodes: FlowNode[], edges: Edge[]): Edge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
  );
}

const isArchiveNode = (value: unknown): value is FlowNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { id?: unknown }).id === "string";

const isArchiveEdge = (value: unknown): value is Edge =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { id?: unknown }).id === "string" &&
  typeof (value as { source?: unknown }).source === "string" &&
  typeof (value as { target?: unknown }).target === "string";

function normalizeArchive(value: unknown): FlowTabArchive {
  if (!value || typeof value !== "object") return createEmptyArchive();
  const maybe = value as Partial<FlowTabArchive>;
  const rawNodes = stripLegacyFlowMapNodeData(
    Array.isArray(maybe.nodes) ? maybe.nodes.filter(isArchiveNode) : []
  );
  const rawEdges = Array.isArray(maybe.edges)
    ? maybe.edges.filter(isArchiveEdge)
    : [];
  const canonicalGraph = sanitizeGroupBundleVisualElementsForState({
    nodes: rawNodes,
    edges: rawEdges,
  });
  const nodes = stripEphemeralNodeUiState(
    stripLegacyFlowMapNodeData(canonicalGraph.nodes)
  );
  const normalizedEdges = normalizeAndDedupeEdgeConnections(canonicalGraph.edges);
  const edges = stripEphemeralEdgeUiState(
    filterEdgesForNodes(nodes, normalizedEdges)
  );
  const scriptSteps = sanitizeScriptSteps(maybe.scriptSteps);
  return {
    nodes,
    edges,
    scriptSteps,
  };
}

function decodeCompressedArchive(compressed?: string): FlowTabArchive {
  if (!compressed) return createEmptyArchive();
  try {
    const parsed = decodeStoragePayload(compressed);
    return normalizeArchive(parsed);
  } catch (error) {
    console.warn("Failed to decode tab archive payload", error);
    return createEmptyArchive();
  }
}

function encodeArchiveRaw(raw: FlowTabArchive): string | undefined {
  try {
    return encodeStoragePayload(raw);
  } catch (error) {
    console.warn("Failed to encode tab archive payload", error);
    return undefined;
  }
}

const DEFAULT_TAB: FlowTab = {
  id: "tab-1",
  title: "Flow 1",
  version: 0,
};

const AUTO_TAB_TITLE_PATTERN = /^Flow(?:\s+\d+)?$/i;

const isAutoTabTitle = (title: string) => AUTO_TAB_TITLE_PATTERN.test(title.trim());

const TABS_STORAGE_KEY = "rawbit.flow.tabs";
const TABS_ARCHIVE_STORAGE_KEY = "rawbit.flow.tabs.archive";
const ACTIVE_TAB_STORAGE_KEY = "rawbit.flow.activeTab";
const TAB_COUNTER_STORAGE_KEY = "rawbit.flow.tabCounter";

interface TabsPersistState {
  disabled: boolean;
  lastPayloadSize: number;
  lastPayload?: string;
}

function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const maybeDomException =
    typeof window !== "undefined" && window.DOMException
      ? error instanceof DOMException
      : false;

  const name = (error as { name?: string }).name;
  const code = (error as { code?: number }).code;

  if (
    maybeDomException &&
    ((name === "QuotaExceededError" && code === 22) ||
      (name === "NS_ERROR_DOM_QUOTA_REACHED" && code === 1014))
  ) {
    return true;
  }

  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    name === "quota_exceeded"
  );
}

function sanitizeScriptSteps(value: unknown): ScriptStepsEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: ScriptStepsEntry[] = [];
  for (const entry of value) {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string"
    ) {
      entries.push([entry[0], entry[1] ?? null]);
    }
  }
  return entries.length ? entries : undefined;
}

const TAB_ARCHIVE_KEY_PREFIX = "rawbit.flow.tab.";

function getArchiveStorageKey(tabId: string): string {
  return `${TAB_ARCHIVE_KEY_PREFIX}${tabId}`;
}

interface HydratedTabsState {
  tabs: FlowTab[];
  archive: Map<string, FlowTabArchiveEntry>;
}

function hydrateArchiveBackedTabs(): HydratedTabsState | null {
  if (typeof window === "undefined") return null;

  const archive = new Map<string, FlowTabArchiveEntry>();
  const tabs: FlowTab[] = [];

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(TAB_ARCHIVE_KEY_PREFIX)) continue;
      const tabId = key.slice(TAB_ARCHIVE_KEY_PREFIX.length);
      if (!tabId) continue;
      const compressed = window.localStorage.getItem(key);
      if (!compressed) continue;

      tabs.push({
        id: tabId,
        title: normalizeTabTitle(`Recovered ${tabId}`),
        version: 0,
      });
      archive.set(tabId, { compressed });
    }
  } catch (error) {
    console.warn("Failed to enumerate tab archive storage", error);
    return null;
  }

  if (tabs.length === 0) return null;
  tabs.sort((a, b) => a.id.localeCompare(b.id));
  return { tabs, archive };
}

function hydrateTabs(): HydratedTabsState {
  const archive = new Map<string, FlowTabArchiveEntry>();
  const emptyArchive = createEmptyArchive();
  const fallbackCompressed =
    encodeArchiveRaw(emptyArchive) ?? encodeStoragePayload(emptyArchive);
  const fallbackEntry: FlowTabArchiveEntry = {
    compressed: fallbackCompressed,
  };
  const fallback: HydratedTabsState = {
    tabs: [DEFAULT_TAB],
    archive: new Map<string, FlowTabArchiveEntry>().set(
      DEFAULT_TAB.id,
      fallbackEntry
    ),
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const metaRaw = window.localStorage.getItem(TABS_STORAGE_KEY);
    const archiveRaw = window.localStorage.getItem(TABS_ARCHIVE_STORAGE_KEY);
    let tabs: FlowTab[] = [];
    const legacyArchive = new Map<string, FlowTabArchiveEntry>();

    if (archiveRaw) {
      const parsedArchive = decodeStoragePayload(archiveRaw);
      if (parsedArchive && typeof parsedArchive === "object") {
        const nested = (parsedArchive as { archive?: unknown }).archive;
        const source =
          nested && typeof nested === "object"
            ? (nested as Record<string, unknown>)
            : (parsedArchive as Record<string, unknown>);

        for (const [key, value] of Object.entries(source)) {
          if (!value) continue;
          if (typeof value === "string") {
            legacyArchive.set(key, {
              compressed: value,
            });
            continue;
          }
          if (typeof value === "object") {
            const normalized = normalizeArchive(value);
            legacyArchive.set(key, {
              raw: normalized,
              compressed: encodeArchiveRaw(normalized),
            });
          }
        }
      }
    }

    if (metaRaw) {
      const parsedMeta = decodeStoragePayload(metaRaw);
      if (Array.isArray(parsedMeta)) {
        tabs = parsedMeta.map((tab: Partial<FlowTab> & { id?: string }, index) => {
          const title =
            typeof tab.title === "string" ? tab.title : `Flow ${index + 1}`;
          const id = typeof tab.id === "string" ? tab.id : `tab-${index + 1}`;
          const version = typeof tab.version === "number" ? tab.version : 0;
          const transform =
            tab.transform &&
            typeof tab.transform === "object" &&
            typeof tab.transform.x === "number" &&
            typeof tab.transform.y === "number" &&
            typeof tab.transform.zoom === "number"
              ? tab.transform
              : undefined;

          const archived = normalizeArchive(tab);
          legacyArchive.set(id, {
            raw: archived,
            compressed: encodeArchiveRaw(archived),
          });

          return {
            id,
            title,
            version,
            transform,
            tooltip: typeof tab.tooltip === "string" ? tab.tooltip : undefined,
          };
        });
      } else if (
        parsedMeta &&
        typeof parsedMeta === "object" &&
        Array.isArray((parsedMeta as { tabs?: unknown }).tabs)
      ) {
        const next = parsedMeta as {
          tabs: Array<Partial<FlowTab>>;
        };
        tabs = next.tabs.map((tab, index) => {
          const title =
            typeof tab.title === "string" ? tab.title : `Flow ${index + 1}`;
          const id = typeof tab.id === "string" ? tab.id : `tab-${index + 1}`;
          const version = typeof tab.version === "number" ? tab.version : 0;
          const transform =
            tab.transform &&
            typeof tab.transform === "object" &&
            typeof tab.transform.x === "number" &&
            typeof tab.transform.y === "number" &&
            typeof tab.transform.zoom === "number"
              ? tab.transform
              : undefined;

          return {
            id,
            title,
            version,
            transform,
            tooltip: typeof tab.tooltip === "string" ? tab.tooltip : undefined,
          };
        });
      }
    }

    const hasStoredTabs = tabs.length > 0;
    if (!hasStoredTabs) {
      tabs = [DEFAULT_TAB];
    }

    const hydratedTabs: FlowTab[] = [];
    let legacyMigrationFailed = false;
    for (const tab of tabs) {
      const storageKey = getArchiveStorageKey(tab.id);
      let entry: FlowTabArchiveEntry | undefined;
      const storedCompressed = window.localStorage.getItem(storageKey);
      if (storedCompressed) {
        entry = { compressed: storedCompressed };
      } else if (legacyArchive.has(tab.id)) {
        entry = legacyArchive.get(tab.id);
        const compressed =
          entry?.compressed ??
          encodeArchiveRaw(entry?.raw ?? createEmptyArchive());
        if (compressed) {
          try {
            window.localStorage.setItem(storageKey, compressed);
          } catch (error) {
            legacyMigrationFailed = true;
            console.warn(
              "Failed to migrate tab archive to dedicated storage",
              error
            );
          }
          entry = { ...entry, compressed };
        } else {
          legacyMigrationFailed = true;
        }
      }

      if (!entry) {
        const allowEmptyFallback =
          !hasStoredTabs || (tabs.length === 1 && tab.id === DEFAULT_TAB.id);
        if (!allowEmptyFallback) continue;
        entry = fallbackEntry;
      }
      hydratedTabs.push(tab);
      archive.set(tab.id, entry);
    }

    if (hydratedTabs.length === 0) {
      return fallback;
    }

    // Remove the legacy blob only after every per-tab write succeeded —
    // it is the sole durable copy for tabs whose dedicated write failed
    // (e.g. QuotaExceededError while the footprint is transiently doubled).
    if (legacyArchive.size > 0 && !legacyMigrationFailed) {
      try {
        window.localStorage.removeItem(TABS_ARCHIVE_STORAGE_KEY);
      } catch (error) {
        console.warn("Failed to remove legacy tab archive payload", error);
      }
    }

    return { tabs: hydratedTabs, archive };
  } catch (error) {
    console.warn("Failed to hydrate tabs from storage", error);
    const recovered = hydrateArchiveBackedTabs();
    if (recovered) return recovered;
    return fallback;
  }
}

function hydrateActiveTab(tabs: FlowTab[]): string {
  if (typeof window === "undefined") return tabs[0]?.id ?? DEFAULT_TAB.id;
  try {
    const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (stored && tabs.some((t) => t.id === stored)) {
      return stored;
    }
  } catch (error) {
    console.warn("Failed to hydrate active tab from storage", error);
  }
  return tabs[0]?.id ?? DEFAULT_TAB.id;
}

function hydrateCounter(tabs: FlowTab[]): number {
  // The counter must never sit below the highest existing tab-id suffix:
  // closed tabs leave gaps (e.g. [tab-1, tab-3]), so a count-based floor
  // would let addTab re-mint an existing id and wipe that tab's archive.
  const maxSuffix = tabs.reduce((max, tab) => {
    const match = /^tab-(\d+)$/.exec(tab.id);
    if (!match) return max;
    const suffix = Number.parseInt(match[1], 10);
    return Number.isFinite(suffix) && suffix > max ? suffix : max;
  }, 0);
  const floor = Math.max(maxSuffix, tabs.length) || 1;
  if (typeof window === "undefined") return floor;
  try {
    const stored = window.localStorage.getItem(TAB_COUNTER_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= floor) {
      return parsed;
    }
  } catch (error) {
    console.warn("Failed to hydrate tab counter from storage", error);
  }
  return floor;
}

interface UseTabsArgs {
  getNodes: () => FlowNode[];
  getEdges: () => Edge[];
  baseSetNodes: (next: FlowNode[] | ((prev: FlowNode[]) => FlowNode[])) => void;
  baseSetEdges: (next: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  graphRevRef: React.MutableRefObject<number>;
  refreshBanner: (
    nodes: FlowNode[],
    tabId?: string,
    options?: { sticky?: boolean; immediate?: boolean }
  ) => void;
  getFlowInstance: () => ReactFlowInstance | null;
  initializeTabHistory: (tabId: string, nodes: FlowNode[], edges: Edge[]) => void;
  setActiveTabCtx: (tabId: string) => void;
  removeTabHistory: (tabId: string) => void;
  /** Drop a closed tab's queued frames + pending after-calc entry (DA-20). */
  discardTabSnapshots: (tabIds?: string[]) => void;
}

interface CloseDialogState {
  tabId: string | null;
  open: boolean;
}

interface SaveTabDataOptions {
  force?: boolean;
  immediate?: boolean;
  data?: {
    nodes: FlowNode[];
    edges: Edge[];
  };
}

export interface UseTabsResult {
  tabs: FlowTab[];
  activeTabId: string;
  tabCounter: number;
  skipLoadRef: React.MutableRefObject<boolean>;
  initialHydrationDone: boolean;
  closeDialog: CloseDialogState;
  selectTab: (tabId: string) => void;
  addTab: () => string;
  requestCloseTab: (tabId: string) => void;
  confirmCloseTab: () => void;
  cancelCloseTab: () => void;
  closeAllTabs: () => void;
  closeOtherTabs: () => void;
  setTabTransform: (tabId: string, transform: FlowTab["transform"]) => void;
  setTabTooltip: (tabId: string, tooltip: string) => void;
  renameTab: (
    tabId: string,
    title: string,
    options?: { onlyIfEmpty?: boolean }
  ) => void;
  saveTabData: (tabId: string, options?: SaveTabDataOptions) => void;
  setTabsExternal: Dispatch<SetStateAction<FlowTab[]>>;
  setActiveTabId: Dispatch<SetStateAction<string>>;
  bumpTabCounter: () => void;
}

export function useTabs({
  getNodes,
  getEdges,
  baseSetNodes,
  baseSetEdges,
  graphRevRef,
  refreshBanner,
  getFlowInstance,
  initializeTabHistory,
  setActiveTabCtx,
  removeTabHistory,
  discardTabSnapshots,
}: UseTabsArgs): UseTabsResult {
  const initialTabsRef = useRef(hydrateTabs());
  const [tabs, setTabs] = useState<FlowTab[]>([
    ...initialTabsRef.current.tabs,
  ]);
  const archiveRef = useRef<Map<string, FlowTabArchiveEntry>>(
    initialTabsRef.current.archive
  );
  const [activeTabId, setActiveTabId] = useState(() =>
    hydrateActiveTab(initialTabsRef.current.tabs)
  );
  const [tabCounter, setTabCounter] = useState(() =>
    hydrateCounter(initialTabsRef.current.tabs)
  );
  const skipLoadRef = useRef(false);
  const initialHydrationDoneRef = useRef(false);
  const [initialHydrationDone, setInitialHydrationDone] = useState(false);
  const [closeDialog, setCloseDialog] = useState<CloseDialogState>({
    tabId: null,
    open: false,
  });

  const getTabIndex = useCallback(
    (tabId: string) => tabs.findIndex((t) => t.id === tabId),
    [tabs]
  );

  const clone = useCallback(<T,>(value: T): T => {
    if (typeof structuredClone === "function") {
      return structuredClone(value) as T;
    }
    return JSON.parse(JSON.stringify(value));
  }, []);

  // After a QuotaExceededError, archive writes are skipped only while the
  // payload is at least as large as the one that failed; any smaller payload
  // (or freed storage via removeTabArchive) re-enables persistence.
  const archivePersistStateRef = useRef({
    disabled: false,
    lastFailedSize: Number.POSITIVE_INFINITY,
  });
  const metaPersistStateRef = useRef<TabsPersistState>({
    disabled: false,
    lastPayloadSize: 0,
  });

  const persistTabsMetadata = useCallback((nextTabs: FlowTab[]) => {
    if (typeof window === "undefined") return;
    const payload = encodeStoragePayload({
      version: 2,
      tabs: nextTabs,
    });
    const payloadSize = payload.length;
    const { disabled, lastPayload, lastPayloadSize } =
      metaPersistStateRef.current;
    if (payload === lastPayload) {
      return;
    }
    if (disabled && payloadSize >= lastPayloadSize) {
      return;
    }
    try {
      window.localStorage.setItem(TABS_STORAGE_KEY, payload);
      metaPersistStateRef.current = {
        disabled: false,
        lastPayload: payload,
        lastPayloadSize: payloadSize,
      };
    } catch (error) {
      console.warn("Failed to persist tabs", error);
      const quotaExceeded = isQuotaExceededError(error);
      metaPersistStateRef.current = {
        disabled: quotaExceeded,
        lastPayload,
        lastPayloadSize: payloadSize,
      };
    }
  }, []);

  const persistTabCompressed = useCallback(
    (tabId: string, compressed?: string) => {
      if (typeof window === "undefined") return;
      if (!compressed) return;
      const persistState = archivePersistStateRef.current;
      if (
        persistState.disabled &&
        compressed.length >= persistState.lastFailedSize
      ) {
        return;
      }
      try {
        window.localStorage.setItem(
          getArchiveStorageKey(tabId),
          compressed
        );
        archivePersistStateRef.current = {
          disabled: false,
          lastFailedSize: Number.POSITIVE_INFINITY,
        };
      } catch (error) {
        console.warn("Failed to persist tab archive", error);
        if (isQuotaExceededError(error)) {
          archivePersistStateRef.current = {
            disabled: true,
            lastFailedSize: compressed.length,
          };
        }
      }
    },
    []
  );

  const removeTabArchive = useCallback((tabId: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(getArchiveStorageKey(tabId));
      // Storage was freed — give archive persistence another chance.
      archivePersistStateRef.current = {
        disabled: false,
        lastFailedSize: Number.POSITIVE_INFINITY,
      };
    } catch (error) {
      console.warn("Failed to remove tab archive", error);
    }
  }, []);

  const ensureArchiveEntry = useCallback((tabId: string): FlowTabArchiveEntry => {
    let entry = archiveRef.current.get(tabId);
    if (!entry) {
      const raw = createEmptyArchive();
      const compressed =
        encodeArchiveRaw(raw) ?? encodeStoragePayload(raw);
      persistTabCompressed(tabId, compressed);
      entry = {
        raw,
        compressed,
      };
      archiveRef.current.set(tabId, entry);
    }
    return entry;
  }, [persistTabCompressed]);

  const ensureArchiveRaw = useCallback(
    (tabId: string): FlowTabArchive => {
      const entry = ensureArchiveEntry(tabId);
      if (!entry.raw) {
        entry.raw = decodeCompressedArchive(entry.compressed);
      }
      return entry.raw ?? createEmptyArchive();
    },
    [ensureArchiveEntry]
  );

  const applyCompressedResult = useCallback(
    (tabId: string, requestId: number | null, compressed?: string) => {
      const entry = archiveRef.current.get(tabId);
      if (!entry) return;
      if (requestId !== null && entry.pendingRequestId !== requestId) {
        return;
      }
      entry.pendingRequestId = undefined;
      if (!compressed) return;
      if (entry.compressed === compressed) return;
      entry.compressed = compressed;
      archiveRef.current.set(tabId, entry);
      persistTabCompressed(tabId, compressed);
    },
    [persistTabCompressed]
  );

  const archiveWorkerRequestIdRef = useRef(0);
  const archiveWorkerPendingRef = useRef<Map<number, { tabId: string }>>(
    new Map()
  );

  const compressTabArchive = useCallback(
    (tabId: string, data: FlowTabArchive) => {
      const worker = archiveWorkerRef.current;
      if (worker) {
        const requestId = archiveWorkerRequestIdRef.current + 1;
        archiveWorkerRequestIdRef.current = requestId;
        const entry = ensureArchiveEntry(tabId);
        entry.pendingRequestId = requestId;
        archiveRef.current.set(tabId, entry);
        archiveWorkerPendingRef.current.set(requestId, { tabId });
        const message: CompressTabRequest = {
          type: "compress-tab",
          requestId,
          tabId,
          payload: data as WorkerFlowTabArchive,
        };
        try {
          worker.postMessage(message);
          return;
        } catch (error) {
          console.warn("Failed to offload tab compression", error);
          archiveWorkerPendingRef.current.delete(requestId);
          entry.pendingRequestId = undefined;
        }
      }

      const compressed =
        encodeArchiveRaw(data) ?? encodeStoragePayload(data);
      if (compressed) {
        applyCompressedResult(tabId, null, compressed);
      }
    },
    [applyCompressedResult, ensureArchiveEntry]
  );

  const saveTabData = useCallback(
    (tabId: string, options?: SaveTabDataOptions) => {
      if (!initialHydrationDoneRef.current) return;
      const idx = getTabIndex(tabId);
      const hasExplicitData = Boolean(options?.data);
      if (idx < 0 && !hasExplicitData) return;
      // The live canvas (getNodes/getEdges) always holds the ACTIVE tab's
      // graph. Snapshotting it under another tab's key would overwrite that
      // tab's archive with this one's content — callers saving an inactive
      // tab must pass options.data explicitly.
      if (!hasExplicitData && tabId !== activeTabId) return;
      const force = options?.force === true;

      const rawCurrentNodes = options?.data?.nodes ?? getNodes();
      const rawCurrentEdges = options?.data?.edges ?? getEdges();
      const canonicalGraph = sanitizeGroupBundleVisualElementsForState({
        nodes: rawCurrentNodes,
        edges: rawCurrentEdges,
      });
      const currentNodes = stripEphemeralNodeUiState(
        stripLegacyFlowMapNodeData(canonicalGraph.nodes)
      );
      const canonicalCurrentEdges = normalizeAndDedupeEdgeConnections(
        canonicalGraph.edges
      );
      const currentEdges = stripEphemeralEdgeUiState(
        filterEdgesForNodes(currentNodes, canonicalCurrentEdges)
      );
      if (currentEdges.length !== canonicalCurrentEdges.length) {
        console.warn(
          "Skipped dangling edges while persisting tab archive",
          {
            tabId,
            skippedEdges: canonicalCurrentEdges.length - currentEdges.length,
          }
        );
      }
      const entry = ensureArchiveEntry(tabId);
      const tabVersion = idx >= 0 ? tabs[idx].version : undefined;
      if (!force && tabVersion === graphRevRef.current) {
        return;
      }

      const nodeIds = new Set(currentNodes.map((node) => node.id));
      const tabScriptSteps = snapshotScriptSteps().filter(([id]) =>
        nodeIds.has(id)
      );

      entry.raw = {
        nodes: clone(currentNodes),
        edges: clone(currentEdges),
        scriptSteps: tabScriptSteps.length ? tabScriptSteps : undefined,
      };
      archiveRef.current.set(tabId, entry);
      if (options?.immediate) {
        const compressed =
          encodeArchiveRaw(entry.raw) ?? encodeStoragePayload(entry.raw);
        entry.pendingRequestId = undefined;
        entry.compressed = compressed;
        archiveRef.current.set(tabId, entry);
        persistTabCompressed(tabId, compressed);
      } else {
        compressTabArchive(tabId, entry.raw);
      }

      setTabs((prev) => {
        const currentIndex = prev.findIndex((tab) => tab.id === tabId);
        if (currentIndex < 0) return prev;
        if (prev[currentIndex].version === graphRevRef.current) return prev;
        const copy = [...prev];
        copy[currentIndex] = {
          ...copy[currentIndex],
          version: graphRevRef.current,
        };
        return copy;
      });
    },
    [
      activeTabId,
      clone,
      compressTabArchive,
      ensureArchiveEntry,
      getEdges,
      getNodes,
      getTabIndex,
      graphRevRef,
      persistTabCompressed,
      tabs,
    ]
  );

  // Generation counter: every restore invalidates the scheduled callbacks
  // (rAF retries, fitView retry timers) of all previous restores, so a stale
  // timer can never clobber the viewport of a tab switched to later.
  const restoreGenRef = useRef(0);

  const runViewportRestore = useCallback(
    (tab?: FlowTab, archive?: FlowTabArchive) => {
      restoreGenRef.current += 1;
      const gen = restoreGenRef.current;
      const shouldFit = archive
        ? shouldFitArchiveOnRestore(tab, archive)
        : false;

      const apply = (attempt = 0) => {
        if (restoreGenRef.current !== gen) return;
        const instance = getFlowInstance();
        if (!instance) {
          if (typeof window !== "undefined" && attempt < 8) {
            window.requestAnimationFrame(() => apply(attempt + 1));
          }
          return;
        }

        if (shouldFit) {
          const fitView = (instance as Partial<ReactFlowInstance>).fitView;
          if (typeof fitView === "function") {
            const runFit = () => {
              if (restoreGenRef.current !== gen) return;
              fitView.call(instance, {
                padding: 0.2,
                minZoom: RESTORE_FIT_MIN_ZOOM,
                maxZoom: 2,
                duration: 0,
              });
            };

            runFit();
            if (typeof window !== "undefined") {
              RESTORE_FIT_RETRIES.forEach((delay) => {
                window.setTimeout(runFit, delay);
              });
            }
            return;
          }
        }

        instance.setViewport(tab?.transform ?? DEFAULT_VIEWPORT, {
          duration: 0,
        });
      };

      if (typeof window === "undefined") {
        apply();
        return;
      }

      window.requestAnimationFrame(() => apply());
    },
    [getFlowInstance]
  );

  const captureCurrentViewport = useCallback(
    (tabId: string) => {
      const instance = getFlowInstance();
      if (!instance) return;
      const viewport = instance.getViewport();
      if (
        !viewport ||
        typeof viewport.x !== "number" ||
        typeof viewport.y !== "number" ||
        typeof viewport.zoom !== "number"
      ) {
        return;
      }

      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                transform: {
                  x: viewport.x,
                  y: viewport.y,
                  zoom: viewport.zoom,
                },
              }
            : tab
        )
      );
    },
    [getFlowInstance]
  );

  const selectTab = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId) return;
      skipLoadRef.current = true;
      const previousTabId = activeTabId;
      captureCurrentViewport(previousTabId);
      saveTabData(previousTabId, { force: true });
      if (previousTabId !== tabId) {
        const previousEntry = archiveRef.current.get(previousTabId);
        // Keep raw while a compression is still in flight: entry.compressed
        // holds the PREVIOUS payload until the worker responds, so dropping
        // raw now would restore stale data on a quick switch back.
        if (
          previousEntry?.compressed &&
          previousEntry.pendingRequestId === undefined
        ) {
          previousEntry.raw = undefined;
        }
      }

      const nextTab = tabs.find((t) => t.id === tabId);
      const nextArchive = ensureArchiveRaw(tabId);
      setActiveTabId(tabId);
      setActiveTabCtx(tabId);

      if (nextTab) {
        restoreScriptSteps(nextArchive.scriptSteps ?? []);
        baseSetNodes(clone(nextArchive.nodes));
        baseSetEdges(clone(nextArchive.edges));
        graphRevRef.current = nextTab.version;
        refreshBanner(nextArchive.nodes, tabId);
      } else {
        restoreScriptSteps([]);
        baseSetNodes([]);
        baseSetEdges([]);
        graphRevRef.current = 0;
        initializeTabHistory(tabId, [], []);
      }

      runViewportRestore(nextTab, nextArchive);
    },
    [
      activeTabId,
      baseSetEdges,
      baseSetNodes,
      captureCurrentViewport,
      clone,
      ensureArchiveRaw,
      graphRevRef,
      initializeTabHistory,
      refreshBanner,
      runViewportRestore,
      saveTabData,
      setActiveTabCtx,
      tabs,
    ]
  );

  const addTab = useCallback((): string => {
    skipLoadRef.current = true;
    captureCurrentViewport(activeTabId);
    saveTabData(activeTabId, { force: true });

    // Skip ids that are already taken (open tab, in-memory archive, or a
    // persisted archive key written by another window) — re-minting one
    // would overwrite that tab's stored flow with an empty archive.
    const isTabIdTaken = (id: string): boolean => {
      if (tabs.some((tab) => tab.id === id)) return true;
      if (archiveRef.current.has(id)) return true;
      if (typeof window !== "undefined") {
        try {
          if (window.localStorage.getItem(getArchiveStorageKey(id)) !== null) {
            return true;
          }
        } catch {
          // Storage unavailable — fall through to the in-memory checks above.
        }
      }
      return false;
    };
    let newIndex = tabCounter + 1;
    while (isTabIdTaken(`tab-${newIndex}`)) {
      newIndex += 1;
    }
    setTabCounter(newIndex);
    const newId = `tab-${newIndex}`;
    const newTab: FlowTab = {
      id: newId,
      title: `Flow ${newIndex}`,
      version: 0,
      transform: { x: 0, y: 0, zoom: 1 },
    };

    const emptyRaw = createEmptyArchive();
    const emptyCompressed = encodeArchiveRaw(emptyRaw);
    archiveRef.current.set(newId, {
      raw: emptyRaw,
      compressed: emptyCompressed,
    });
    persistTabCompressed(newId, emptyCompressed);

    setTabs((prev) => [...prev, newTab]);

    restoreScriptSteps([]);
    baseSetNodes([]);
    baseSetEdges([]);
    graphRevRef.current = 0;
    initializeTabHistory(newId, [], []);
    refreshBanner([], newId);
    setActiveTabId(newId);
    setActiveTabCtx(newId);

    runViewportRestore(newTab, emptyRaw);
    return newId;
  }, [
    activeTabId,
    baseSetEdges,
    baseSetNodes,
    captureCurrentViewport,
    graphRevRef,
    initializeTabHistory,
    refreshBanner,
    runViewportRestore,
    saveTabData,
    setActiveTabCtx,
    persistTabCompressed,
    tabCounter,
    tabs,
  ]);

  const discardTabData = useCallback(
    (tabIds: string[]) => {
      const ids = new Set(tabIds);
      archiveWorkerPendingRef.current.forEach((value, requestId) => {
        if (ids.has(value.tabId)) {
          archiveWorkerPendingRef.current.delete(requestId);
        }
      });

      ids.forEach((tabId) => {
        archiveRef.current.delete(tabId);
        removeTabArchive(tabId);
        removeTabHistory(tabId);
      });
      // Cancel any queued snapshot frames and drop the pending after-calc
      // entry for the closed tab(s) so nothing fires (or is inherited by a
      // recycled tab id) after close (DA-20).
      discardTabSnapshots(tabIds);
    },
    [discardTabSnapshots, removeTabArchive, removeTabHistory]
  );

  const requestCloseTab = useCallback(
    (tabId: string) => {
      setCloseDialog({ tabId, open: true });
    },
    []
  );

  const cancelCloseTab = useCallback(() => {
    setCloseDialog({ tabId: null, open: false });
  }, []);

  const closeAllTabs = useCallback(() => {
    const tabIds = tabs.map((tab) => tab.id);
    const nextTab: FlowTab = {
      ...DEFAULT_TAB,
      transform: DEFAULT_VIEWPORT,
    };
    const emptyRaw = createEmptyArchive();
    const emptyCompressed =
      encodeArchiveRaw(emptyRaw) ?? encodeStoragePayload(emptyRaw);

    setCloseDialog({ tabId: null, open: false });
    discardTabData(tabIds);
    archiveRef.current.clear();
    archiveRef.current.set(nextTab.id, {
      raw: emptyRaw,
      compressed: emptyCompressed,
    });
    persistTabCompressed(nextTab.id, emptyCompressed);

    skipLoadRef.current = true;
    restoreScriptSteps([]);
    baseSetNodes([]);
    baseSetEdges([]);
    graphRevRef.current = 0;
    initializeTabHistory(nextTab.id, [], []);
    refreshBanner([], nextTab.id);
    setActiveTabId(nextTab.id);
    setActiveTabCtx(nextTab.id);
    setTabCounter(1);
    setTabs([nextTab]);
    persistTabsMetadata([nextTab]);
    runViewportRestore(nextTab, emptyRaw);
  }, [
    baseSetEdges,
    baseSetNodes,
    discardTabData,
    graphRevRef,
    initializeTabHistory,
    persistTabCompressed,
    persistTabsMetadata,
    refreshBanner,
    runViewportRestore,
    setActiveTabCtx,
    tabs,
  ]);

  const closeOtherTabs = useCallback(() => {
    const keepTabId = closeDialog.tabId ?? activeTabId;
    const keepTab = tabs.find((tab) => tab.id === keepTabId);
    if (!keepTab) {
      setCloseDialog({ tabId: null, open: false });
      return;
    }

    const removedTabIds = tabs
      .filter((tab) => tab.id !== keepTabId)
      .map((tab) => tab.id);

    setCloseDialog({ tabId: null, open: false });
    if (removedTabIds.length === 0) {
      return;
    }

    if (keepTabId === activeTabId) {
      saveTabData(keepTabId, { force: true, immediate: true });
    }

    const keepArchive = ensureArchiveRaw(keepTabId);
    const nextTab =
      keepTabId === activeTabId
        ? { ...keepTab, version: graphRevRef.current }
        : keepTab;

    discardTabData(removedTabIds);

    if (keepTabId !== activeTabId) {
      skipLoadRef.current = true;
      setActiveTabId(keepTabId);
      setActiveTabCtx(keepTabId);
      restoreScriptSteps(keepArchive.scriptSteps ?? []);
      baseSetNodes(clone(keepArchive.nodes));
      baseSetEdges(clone(keepArchive.edges));
      graphRevRef.current = nextTab.version;
      refreshBanner(keepArchive.nodes, keepTabId);
      runViewportRestore(nextTab, keepArchive);
    }

    setTabs([nextTab]);
    persistTabsMetadata([nextTab]);
  }, [
    activeTabId,
    baseSetEdges,
    baseSetNodes,
    clone,
    closeDialog.tabId,
    discardTabData,
    ensureArchiveRaw,
    graphRevRef,
    persistTabsMetadata,
    refreshBanner,
    runViewportRestore,
    saveTabData,
    setActiveTabCtx,
    tabs,
  ]);

  const confirmCloseTab = useCallback(() => {
    const tabId = closeDialog.tabId;
    if (!tabId) {
      setCloseDialog({ tabId: null, open: false });
      return;
    }

    setCloseDialog({ tabId: null, open: false });
    const remaining = tabs.filter((t) => t.id !== tabId);

    discardTabData([tabId]);

    if (tabId === activeTabId) {
      const next = remaining[0];
      if (next) {
        skipLoadRef.current = true;
        setActiveTabId(next.id);
        setActiveTabCtx(next.id);
        const nextArchive = ensureArchiveRaw(next.id);
        restoreScriptSteps(nextArchive.scriptSteps ?? []);
        baseSetNodes(clone(nextArchive.nodes));
        baseSetEdges(clone(nextArchive.edges));
        graphRevRef.current = next.version;
        refreshBanner(nextArchive.nodes, next.id);
        runViewportRestore(next, nextArchive);
      } else {
        restoreScriptSteps([]);
      }
    }

    setTabs(remaining);
    persistTabsMetadata(remaining);
  }, [
    activeTabId,
    baseSetEdges,
    baseSetNodes,
    clone,
    ensureArchiveRaw,
    closeDialog.tabId,
    graphRevRef,
    refreshBanner,
    discardTabData,
    persistTabsMetadata,
    runViewportRestore,
    setActiveTabCtx,
    tabs,
  ]);

  const setTabTransform = useCallback(
    (tabId: string, transform: FlowTab["transform"]) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? {
                ...t,
                transform: transform ?? undefined,
              }
            : t
        )
      );
    },
    []
  );

  const setTabTooltip = useCallback((tabId: string, tooltip: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, tooltip } : t))
    );
  }, []);

  const renameTab = useCallback(
    (tabId: string, nextTitle: string, options?: { onlyIfEmpty?: boolean }) => {
      setTabs((prev) => {
        const index = prev.findIndex((t) => t.id === tabId);
        if (index === -1) return prev;
        const currentTitle = prev[index].title;

        if (options?.onlyIfEmpty) {
          const archive = ensureArchiveRaw(tabId);
          const hasContent =
            (archive.nodes?.length ?? 0) > 0 ||
            (archive.edges?.length ?? 0) > 0;
          const isAutoTitle = isAutoTabTitle(currentTitle);
          if (hasContent && !isAutoTitle) {
            return prev;
          }
        }

        const normalized = normalizeTabTitle(nextTitle);
        if (!normalized) {
          return prev;
        }
        if (currentTitle === normalized) {
          return prev;
        }

        const next = [...prev];
        next[index] = { ...next[index], title: normalized };
        return next;
      });
    },
    [ensureArchiveRaw]
  );

  const bumpTabCounter = useCallback(() => {
    setTabCounter((prev) => prev + 1);
  }, []);

  const hasHydratedInitialTab = useRef(false);
  const archiveWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof Worker === "undefined") return;

    try {
      const worker = new Worker(
        new URL("../workers/tabsCompression.worker.ts", import.meta.url),
        { type: "module" }
      );
      archiveWorkerRef.current = worker;

      const handleMessage = (event: MessageEvent<CompressTabResponse>) => {
        const message = event.data;
        if (!message || message.type !== "compress-tab-result") return;
        const pending = archiveWorkerPendingRef.current.get(message.requestId);
        if (!pending || pending.tabId !== message.tabId) return;
        archiveWorkerPendingRef.current.delete(message.requestId);

        if (typeof message.data === "string") {
          applyCompressedResult(message.tabId, message.requestId, message.data);
          return;
        }

        if (message.error) {
          console.warn("Tabs archive compression worker failed", message.error);
          const entry = archiveRef.current.get(message.tabId);
          const raw = entry?.raw;
          if (!raw) {
            // Keep the last known-good compressed payload — never synthesize
            // an empty archive over real tab data.
            if (entry && entry.pendingRequestId === message.requestId) {
              entry.pendingRequestId = undefined;
            }
            return;
          }
          const fallback = encodeArchiveRaw(raw) ?? encodeStoragePayload(raw);
          if (fallback) {
            applyCompressedResult(message.tabId, message.requestId, fallback);
          } else if (entry.pendingRequestId === message.requestId) {
            entry.pendingRequestId = undefined;
          }
        }
      };

      const handleError = (event: ErrorEvent | MessageEvent) => {
        console.warn(
          "Tabs archive worker encountered an error",
          "message" in event ? event.message : event
        );
        archiveWorkerPendingRef.current.forEach(({ tabId }, requestId) => {
          const entry = archiveRef.current.get(tabId);
          const raw = entry?.raw;
          if (!raw) {
            // Keep the last known-good compressed payload — never synthesize
            // an empty archive over real tab data.
            if (entry && entry.pendingRequestId === requestId) {
              entry.pendingRequestId = undefined;
            }
            return;
          }
          const fallback = encodeArchiveRaw(raw) ?? encodeStoragePayload(raw);
          if (fallback) {
            applyCompressedResult(tabId, requestId, fallback);
          } else if (entry.pendingRequestId === requestId) {
            entry.pendingRequestId = undefined;
          }
        });
        archiveWorkerPendingRef.current = new Map();
      };

      worker.addEventListener("message", handleMessage as EventListener);
      worker.addEventListener("error", handleError as EventListener);
      worker.addEventListener("messageerror", handleError as EventListener);

      return () => {
        worker.removeEventListener("message", handleMessage as EventListener);
        worker.removeEventListener("error", handleError as EventListener);
        worker.removeEventListener("messageerror", handleError as EventListener);
        worker.terminate();
        archiveWorkerRef.current = null;
        archiveWorkerPendingRef.current.clear();
      };
    } catch (error) {
      console.warn("Failed to initialize tabs archive worker", error);
    }
  }, [applyCompressedResult]);
  useEffect(() => {
    if (hasHydratedInitialTab.current) return;
    hasHydratedInitialTab.current = true;

    const active = tabs.find((t) => t.id === activeTabId) ?? DEFAULT_TAB;
    const archiveData = ensureArchiveRaw(active.id);
    restoreScriptSteps(archiveData.scriptSteps ?? []);
    baseSetNodes(clone(archiveData.nodes));
    baseSetEdges(clone(archiveData.edges));
    graphRevRef.current = active.version;
    refreshBanner(archiveData.nodes, active.id);
    initializeTabHistory(
      active.id,
      clone(archiveData.nodes),
      clone(archiveData.edges)
    );
    runViewportRestore(active, archiveData);

    const finalizeHydration = () => {
      initialHydrationDoneRef.current = true;
      setInitialHydrationDone(true);
    };

    if (typeof window === "undefined") {
      finalizeHydration();
    } else {
      requestAnimationFrame(() => {
        finalizeHydration();
      });
    }
  }, [
    activeTabId,
    baseSetEdges,
    baseSetNodes,
    clone,
    ensureArchiveRaw,
    graphRevRef,
    initializeTabHistory,
    refreshBanner,
    runViewportRestore,
    tabs,
  ]);

  useEffect(() => {
    persistTabsMetadata(tabs);
  }, [persistTabsMetadata, tabs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
    } catch (error) {
      console.warn("Failed to persist active tab", error);
    }
  }, [activeTabId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        TAB_COUNTER_STORAGE_KEY,
        String(tabCounter)
      );
    } catch (error) {
      console.warn("Failed to persist tab counter", error);
    }
  }, [tabCounter]);

  return useMemo(
    () => ({
      tabs,
      activeTabId,
      tabCounter,
      skipLoadRef,
      closeDialog,
      selectTab,
      addTab,
      requestCloseTab,
      confirmCloseTab,
      cancelCloseTab,
      closeAllTabs,
      closeOtherTabs,
      setTabTransform,
      setTabTooltip,
      renameTab,
      saveTabData,
      setTabsExternal: setTabs,
      setActiveTabId,
      bumpTabCounter,
      initialHydrationDone,
    }),
    [
      tabs,
      activeTabId,
      tabCounter,
      closeDialog,
      selectTab,
      addTab,
      requestCloseTab,
      confirmCloseTab,
      cancelCloseTab,
      closeAllTabs,
      closeOtherTabs,
      setTabTransform,
      setTabTooltip,
      renameTab,
      saveTabData,
      bumpTabCounter,
      initialHydrationDone,
    ]
  );
}
