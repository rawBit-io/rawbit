import { Buffer } from 'buffer';
import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';
import type { FlowData, FlowNode } from '@/types';
import type { Edge } from '@xyflow/react';
import { computeNodeResult, enrichNodesForSuccess, parseBulkRequestPayload } from './fixtures';
import { delay, loadFixture, waitForBulkResponse, setEditableValue } from './utils';

test.describe('Flow file operations', () => {
  test('rejects simplified snapshot and surfaces large file error', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/');

    const fileInput = page.locator('input[type="file"][accept=".json"]');

    const simplified = Buffer.from('{"nodes":[{"id":"n1","data":{}}],"edges":[]}');
    await fileInput.setInputFiles({
      name: 'simplified.json',
      mimeType: 'application/json',
      buffer: simplified,
    });

    await delay(100);
    const simplifiedDialog = page.getByRole('dialog', { name: 'Information' });
    await expect(simplifiedDialog).toBeVisible();
    await expect(simplifiedDialog).toContainText(
      "Simplified snapshots omit layout data and can't be loaded into the editor; export a full flow instead."
    );
    await simplifiedDialog.getByRole('button', { name: 'OK' }).click();
    await expect(simplifiedDialog).toHaveCount(0);

    await expect(page.locator('.react-flow__node')).toHaveCount(0);

    await fileInput.evaluate((node) => {
      (node as HTMLInputElement).value = '';
    });

    const padding = 'a'.repeat(5 * 1024 * 1024 + 1024);
    const largeJson = Buffer.from(`{"nodes":[],"edges":[],"padding":"${padding}"}`);
    await fileInput.setInputFiles({
      name: 'large.json',
      mimeType: 'application/json',
      buffer: largeJson,
    });

    const infoDialog = page.getByRole('dialog', { name: 'Information' });
    await expect(infoDialog).toBeVisible();
    await expect(infoDialog).toContainText('over the 5.00 MiB limit');
    await infoDialog.getByRole('button', { name: 'OK' }).click();
    await expect(infoDialog).toHaveCount(0);
  });

  test('invalid flow import surfaces validation error', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto('/');

    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await fileInput.waitFor({ state: 'attached' });

    const invalid = Buffer.from(
      JSON.stringify({ schemaVersion: 'oops', nodes: [], edges: [] }),
    );

    await fileInput.setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: invalid,
    });

    const infoDialog = page.getByRole('dialog', { name: 'Information' });
    await expect(infoDialog).toBeVisible();
    await expect(infoDialog).toContainText('Flow schema version must be an integer.');
    await infoDialog.getByRole('button', { name: 'OK' }).click();
    await expect(infoDialog).toBeHidden();
  });

  test('saves full flow export with positions', async ({ page }) => {
    test.setTimeout(60_000);

    await stubBulkCalculate(page);

    await page.goto('/');
    await loadFixture(page, 'hash-flow.json');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('hash-flow.json');

    const stream = await download.createReadStream();
    let json = '';
    for await (const chunk of stream) {
      json += chunk.toString();
    }

    const payload = JSON.parse(json) as FlowData;
    expect(Array.isArray(payload.nodes)).toBe(true);
    expect(payload.nodes.length).toBeGreaterThan(0);
    expect(payload.schemaVersion).toBe(1);
    (payload.nodes as FlowNode[]).forEach((node) => {
      expect(node).toHaveProperty('position');
      expect(node.position).toHaveProperty('x');
      expect(node.position).toHaveProperty('y');
      expect(node).not.toHaveProperty('isHighlighted');
      expect(node).not.toHaveProperty('searchMark');
      expect(node).not.toHaveProperty('selected');
    });
    (payload.edges as Edge[]).forEach((edge) => {
      expect(edge).not.toHaveProperty('selected');
    });

    await page.unroute('**/bulk_calculate');
  });
});

test.describe('Keyboard navigation & accessibility', () => {
  test('hotkeys operate and top bar is keyboard reachable', async ({ page, browserName }) => {
    test.setTimeout(60_000);

    await stubBulkCalculate(page);

    await page.goto('/');
    await loadFixture(page, 'hash-flow.json');

    const tabKey = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';

    await tabUntilTitle(page, 'Sidebar', { key: tabKey });
    await tabUntilTitle(page, 'Load', { key: tabKey, maxSteps: 3 });

    const nodesLocator = page.locator('.react-flow__node');
    const initialCount = await nodesLocator.count();

    await marqueeSelect(page, ['node_input', 'node_hash']);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await blurActiveElement(page);

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

    await page.keyboard.press(`${modifier}+c`);
    await expect(
      page.getByRole('button', { name: 'Paste nodes (Ctrl/Cmd+V)' }),
    ).toBeEnabled();

    await page.keyboard.press(`${modifier}+v`);
    await expect.poll(async () => nodesLocator.count()).toBeGreaterThan(initialCount);
    await page.locator('.react-flow__pane').click({ position: { x: 50, y: 50 } });
    await page.keyboard.press(`${modifier}+z`);
    await expect.poll(async () => nodesLocator.count()).toBe(initialCount);

    await marqueeSelect(page, ['node_input', 'node_hash']);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await blurActiveElement(page);

    const groupNode = page.locator('.react-flow__node-shadcnGroup');
    await page.keyboard.press(`${modifier}+g`);
    await expect(groupNode).toHaveCount(1, { timeout: 10_000 });
    await groupNode.first().click({ position: { x: 20, y: 20 } });
    await blurActiveElement(page);

    await page.keyboard.press(`${modifier}+u`);
    await expect(groupNode).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(async () => nodesLocator.count()).toBe(initialCount);

    await page.unroute('**/bulk_calculate');
  });

  test('search and error panels expose accessible labels', async ({ page }) => {
    test.setTimeout(60_000);

    await stubBulkCalculateWithError(page);

    await page.goto('/');
    await loadFixture(page, 'hash-flow.json');

    await waitForBulkResponse(
      page,
      () => setEditableValue(page, 'node_input', 'zzzz'),
      { allowErrors: true },
    );

    await page.getByTitle('Search nodes').click();
    const searchPanel = page.getByTestId('search-panel');
    await expect(searchPanel).toBeVisible();
    const searchInput = page.getByPlaceholder('Search node id, name, text');
    await searchInput.fill('hash');
    await expect(searchPanel.getByRole('button', { name: 'Close search' })).toBeVisible();

    await page.getByTitle('Close search').click();

    await page.getByTitle('Show errors').click();
    const errorHeading = page.getByRole('heading', { name: 'Errors' });
    await expect(errorHeading).toBeVisible();
    const errorRow = page.getByRole('button', { name: /Select node/i }).first();
    await expect(errorRow).toHaveAttribute('aria-label', /Select node/);
    await expect(page.getByRole('button', { name: /Copy error info/ })).toHaveAttribute('aria-label', /Copy error info/);

    await page.unroute('**/bulk_calculate');
  });
});

async function activeElementTitle(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute('title') ?? null);
}

type TabUntilTitleOptions = {
  maxSteps?: number;
  key?: string;
};

async function tabUntilTitle(
  page: Page,
  expectedTitle: string,
  { maxSteps = 10, key = 'Tab' }: TabUntilTitleOptions = {},
) {
  for (let step = 0; step < maxSteps; step += 1) {
    await page.keyboard.press(key);
    const title = await activeElementTitle(page);
    if (title === expectedTitle) return;
  }
  throw new Error(
    `Unable to focus element with title "${expectedTitle}" after ${maxSteps} presses of ${key}`,
  );
}

async function blurActiveElement(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

async function marqueeSelect(page: Page, nodeIds: string[]) {
  if (nodeIds.length === 0) return;
  const boxes = await Promise.all(
    nodeIds.map((id) => page.locator(`[data-id="${id}"]`).boundingBox()),
  );
  if (boxes.some((b) => !b)) throw new Error('Unable to compute node bounding boxes');

  const minX = Math.min(...boxes.map((b) => b!.x)) - 30;
  const minY = Math.min(...boxes.map((b) => b!.y)) - 30;
  const maxX = Math.max(...boxes.map((b) => b!.x + b!.width)) + 30;
  const maxY = Math.max(...boxes.map((b) => b!.y + b!.height)) + 30;

  const selectionTool = page.getByTitle('Selection tool (click to toggle or hold S + drag with LMB)');
  await selectionTool.click();
  await page.mouse.move(minX, minY);
  await page.mouse.down();
  await page.mouse.move(maxX, maxY, { steps: 10 });
  await page.mouse.up();
  await selectionTool.click();
}

async function stubBulkCalculate(page: Page) {
  await page.route('**/bulk_calculate', async (route) => {
    let payload: unknown;
    try {
      payload = route.request().postDataJSON();
    } catch {
      payload = undefined;
    }

    const { version, nodes } = parseBulkRequestPayload(payload);
    const enrichedNodes = enrichNodesForSuccess(nodes, computeNodeResult);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nodes: enrichedNodes, errors: [], version }),
    });
  });
}

async function stubBulkCalculateWithError(page: Page) {
  let call = 0;
  const errorMessage = 'Backend explosion: invalid hex input';

  await page.route('**/bulk_calculate', async (route) => {
    let payload: unknown;
    try {
      payload = route.request().postDataJSON();
    } catch {
      payload = undefined;
    }

    const { version, nodes } = parseBulkRequestPayload(payload);
    const baseNodes = enrichNodesForSuccess(nodes, computeNodeResult);
    const enrichedNodes = baseNodes.map((node) => {
      if (call === 0 || node.id !== 'node_hash') {
        return node;
      }

      const data = {
        ...(node.data ?? {}),
        error: true,
        extendedError: errorMessage,
        result: '',
      };

      return {
        ...node,
        data,
      };
    });

    const errors = call === 0 ? [] : [{ nodeId: 'node_hash', error: errorMessage }];
    call += 1;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nodes: enrichedNodes, errors, version }),
    });
  });
}
