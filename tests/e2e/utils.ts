import path from 'path';
import { fileURLToPath } from 'url';

import { expect } from '@playwright/test';
import type { Locator, Page, Request, Response } from '@playwright/test';

import type { FlowNode, RecalcResponse } from '@/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '..', '..');
export const fixturesDir = path.resolve(__dirname, 'fixtures');

export function resolveFixturePath(...segments: string[]) {
  return path.resolve(fixturesDir, ...segments);
}

type GotoWaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export async function gotoEditor(
  page: Page,
  {
    timeoutMs = 120_000,
    waitUntil = 'domcontentloaded',
  }: { timeoutMs?: number; waitUntil?: GotoWaitUntil } = {},
) {
  await page.goto('/', { timeout: timeoutMs, waitUntil });
}

export type WaitForBulkResponseResult = {
  data: RecalcResponse | null;
  response: Response;
  request: Request;
  requestBody: unknown;
};

export type WaitForBulkResponseOptions = {
  timeoutMs?: number;
  allowErrors?: boolean;
  onResponse?: (payload: WaitForBulkResponseResult) => Promise<void> | void;
};

export async function waitForBulkResponse(
  page: Page,
  action: () => Promise<void>,
  options: WaitForBulkResponseOptions = {},
): Promise<WaitForBulkResponseResult> {
  const { timeoutMs = 60_000, allowErrors = false, onResponse } = options;

  const responsePromise = page.waitForResponse(
    (res) =>
      res.url().includes('/bulk_calculate') && res.request().method() === 'POST',
    { timeout: timeoutMs },
  );

  await action();
  const response = await responsePromise;
  const request = response.request();

  let data: RecalcResponse | null = null;
  try {
    data = (await response.json()) as RecalcResponse;
  } catch {
    data = null;
  }

  let requestBody: unknown = null;
  try {
    requestBody = request.postDataJSON();
  } catch {
    try {
      requestBody = request.postData();
    } catch {
      requestBody = null;
    }
  }

  if (!allowErrors) {
    if (!response.ok()) {
      const statusText = await response.text().catch(() => '');
      throw new Error(
        `/bulk_calculate failed (${response.status()}): ${statusText || '[no body]'}`,
      );
    }

    const errors = Array.isArray(data?.errors) ? data.errors : [];
    if (errors.length) {
      throw new Error(`/bulk_calculate returned errors: ${JSON.stringify(errors)}`);
    }
  }

  const payload: WaitForBulkResponseResult = { data, response, request, requestBody };
  if (onResponse) {
    await onResponse(payload);
  }
  return payload;
}

/**
 * Like waitForBulkResponse, but skips intermediate /bulk_calculate responses
 * (partial recalc batches, transient missing-input errors while a large
 * import settles) and resolves on the first response whose parsed payload
 * satisfies `isSettled`. Use for heavy imports where the FIRST response is
 * not guaranteed to be the final state (WebKit/Firefox fire intermediate
 * calculations more often than Chromium).
 */
export async function waitForSettledBulkResponse(
  page: Page,
  action: () => Promise<void>,
  options: {
    timeoutMs?: number;
    isSettled: (data: RecalcResponse) => boolean;
    onResponse?: (payload: WaitForBulkResponseResult) => Promise<void> | void;
  },
): Promise<WaitForBulkResponseResult> {
  const { timeoutMs = 60_000, isSettled, onResponse } = options;

  const responsePromise = page.waitForResponse(
    async (res) => {
      if (!res.url().includes('/bulk_calculate')) return false;
      if (res.request().method() !== 'POST') return false;
      let parsed: RecalcResponse | null = null;
      try {
        parsed = (await res.json()) as RecalcResponse;
      } catch {
        return false;
      }
      if (!parsed) return false;
      try {
        return isSettled(parsed);
      } catch {
        return false;
      }
    },
    { timeout: timeoutMs },
  );

  await action();
  const response = await responsePromise;
  const request = response.request();

  const data = (await response.json()) as RecalcResponse;

  let requestBody: unknown = null;
  try {
    requestBody = request.postDataJSON();
  } catch {
    try {
      requestBody = request.postData();
    } catch {
      requestBody = null;
    }
  }

  const payload: WaitForBulkResponseResult = { data, response, request, requestBody };
  if (onResponse) {
    await onResponse(payload);
  }
  return payload;
}

export type LoadFixtureOptions = WaitForBulkResponseOptions & {
  inputSelector?: string;
};

export async function loadFixture(
  page: Page,
  fixtureName: string,
  options: LoadFixtureOptions = {},
): Promise<WaitForBulkResponseResult & { fixturePath: string }>
{
  const { inputSelector = 'input[type="file"][accept=".json"]', ...waitOptions } = options;
  const fileInput = page.locator(inputSelector);
  await fileInput.waitFor({ state: 'attached' });

  const fixturePath = path.isAbsolute(fixtureName)
    ? fixtureName
    : resolveFixturePath(fixtureName);

  const result = await waitForBulkResponse(
    page,
    () => fileInput.setInputFiles(fixturePath),
    waitOptions,
  );

  return { ...result, fixturePath };
}

export function toNodeMap(nodes: FlowNode[] = []): Record<string, FlowNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]));
}

export function getNodeResult(data: RecalcResponse | null | undefined, nodeId: string): string {
  const map = toNodeMap(data?.nodes ?? []);
  const node = map[nodeId];
  return String(node?.data?.result ?? '');
}

export function stringifySteps(steps: unknown): string {
  if (steps === undefined) return 'undefined';
  return JSON.stringify(steps);
}

export async function ensureNodeVisible(page: Page, nodeId: string): Promise<Locator> {
  const nodeLocator = () => page.locator(`[data-id="${nodeId}"]`).first();

  let node = nodeLocator();
  if ((await node.count()) > 0 && (await node.isVisible())) {
    await node.scrollIntoViewIfNeeded();
    return node;
  }

  // onlyRenderVisibleElements culls offscreen nodes from the DOM entirely,
  // so the only way to materialize one is to jump the canvas to it via the
  // search panel. Search results render debounced and the jump is animated,
  // so wait on real conditions (row visible, node attached) with retries
  // instead of fixed sleeps — Firefox/WebKit need noticeably longer than
  // Chromium here.
  const searchInput = page.getByPlaceholder('Search node id, name, text');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await searchInput.isVisible().catch(() => false))) {
      await page.getByTitle('Search nodes').click();
      await expect(searchInput).toBeVisible();
    }
    await searchInput.fill(nodeId);

    const resultRow = page
      .locator(`div[role="button"]:has(span[title="${nodeId}"])`)
      .first();
    try {
      await resultRow.waitFor({ state: 'visible', timeout: 5_000 });
      await resultRow.click();
    } catch {
      continue; // results not ready yet — refill and retry
    }

    try {
      await nodeLocator().waitFor({ state: 'attached', timeout: 5_000 });
      break;
    } catch {
      // jump did not land — retry
    }
  }

  // Close the panel so it cannot overlap the node we are about to use.
  if (await searchInput.isVisible().catch(() => false)) {
    const closeButton = page.getByTitle('Close search');
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click();
    } else {
      await page.getByTitle('Search nodes').click();
    }
  }

  node = nodeLocator();
  await node.waitFor({ state: 'attached', timeout: 10_000 });
  await node.scrollIntoViewIfNeeded();
  await expect(node).toBeVisible();
  return node;
}

export async function getEditableField(page: Page, nodeId: string): Promise<Locator> {
  const node = await ensureNodeVisible(page, nodeId);

  const textareas = node.locator('textarea');
  if (await textareas.count()) {
    const first = textareas.first();
    await expect(first).toBeVisible();
    return first;
  }

  const inputs = node.locator('input[type="text"], input:not([type]), input[type="number"]');
  if (await inputs.count()) {
    const first = inputs.first();
    await expect(first).toBeVisible();
    return first;
  }

  throw new Error(`Editable field not found for node ${nodeId}`);
}

export async function setEditableValue(page: Page, nodeId: string, newValue: string) {
  const field = await getEditableField(page, nodeId);
  await field.click({ timeout: 10_000, force: true });
  await field.fill(newValue ?? '');
  await field.evaluate((element) => {
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  });
}

export type ShareStubResponse = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
  onRequest?: (request: Request) => Promise<void> | void;
};

export async function stubShareFlow(
  page: Page,
  responses: ShareStubResponse | ShareStubResponse[],
  pattern = '**/share',
) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  await page.route(pattern, async (route) => {
    const config = queue.length > 1 ? queue.shift()! : queue[0] ?? {};
    if (config.onRequest) {
      await config.onRequest(route.request());
    }
    if (config.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    }

    const body = config.body ?? {
      id: 'share-e2e-id',
      url: 'https://share.local/s/share-e2e-id',
      bytes: 0,
    };

    await route.fulfill({
      status: config.status ?? 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        ...config.headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  });
}

export async function readClipboard(page: Page) {
  return page.evaluate(async () => {
    const win = window as unknown as { __rawbitClipboard?: string };
    const fallback = () => (typeof win.__rawbitClipboard === 'string' ? win.__rawbitClipboard : '');

    try {
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        const text = await navigator.clipboard.readText();
        if (typeof text === 'string') return text;
      }
    } catch {
      /* ignore and use fallback */
    }

    return fallback();
  });
}

export async function writeClipboard(page: Page, text: string) {
  await page.evaluate(async (value) => {
    const win = window as unknown as { __rawbitClipboard?: string };
    win.__rawbitClipboard = value;

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        /* swallow permission errors; fallback buffer already updated */
      }
    }
  }, text);
}

export async function prepareClipboardSpy(page: Page) {
  await page.evaluate(() => {
    const win = window as unknown as { __rawbitClipboard?: string };
    win.__rawbitClipboard = '';

    const record = (value: unknown) => {
      win.__rawbitClipboard = typeof value === 'string' ? value : String(value ?? '');
    };

    const clipboard = navigator.clipboard as (Clipboard & { __rawbitWrapped?: boolean }) | undefined;

    if (clipboard && !clipboard.__rawbitWrapped) {
      const originalWrite = clipboard.writeText?.bind(clipboard);
      const originalRead = clipboard.readText?.bind(clipboard);

      clipboard.writeText = async (value: string) => {
        record(value);
        if (originalWrite) {
          try {
            await originalWrite(value);
          } catch {
            /* ignore permission denials */
          }
        }
      };

      clipboard.readText = async () => {
        if (originalRead) {
          try {
            const text = await originalRead();
            record(text);
            return typeof text === 'string' ? text : fallbackValue();
          } catch {
            /* fall through */
          }
        }
        return fallbackValue();
      };

      clipboard.__rawbitWrapped = true;
      return;
    }

    if (!clipboard) {
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value: string) => record(value),
            readText: async () => fallbackValue(),
          },
        });
      } catch {
        /* ignore - clipboard API not shimmed */
      }
    }

    function fallbackValue() {
      return typeof win.__rawbitClipboard === 'string' ? win.__rawbitClipboard : '';
    }
  });
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
