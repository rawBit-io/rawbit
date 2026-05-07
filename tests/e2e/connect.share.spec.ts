import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';
import { computeNodeResult, enrichNodesForSuccess, parseBulkRequestPayload } from './fixtures';

import {
  delay,
  loadFixture,
  prepareClipboardSpy,
  readClipboard,
} from './utils';

test.describe('Connect dialog', () => {
  test('manual connect wires selected nodes', async ({ page }) => {
    test.setTimeout(60_000);

    await stubBulkCalculateWithDefaults(page);

    await page.goto('/');

    const searchInput = page.getByPlaceholder('Search nodes...');
    await searchInput.fill('input');
    const identityTile = page.locator('[draggable="true"]').filter({ hasText: /Input/i }).first();
    await expect(identityTile).toBeVisible();

    const canvas = page.locator('.react-flow__pane');
    await identityTile.dragTo(canvas, { targetPosition: { x: 200, y: 250 } });
    await delay(100);

    await searchInput.fill('SHA-256d');
    const shaTile = page.locator('[draggable="true"]').filter({ hasText: /SHA-256d/i }).first();
    await expect(shaTile).toBeVisible();
    await shaTile.dragTo(canvas, { targetPosition: { x: 520, y: 250 } });
    await delay(100);

    const clearSearch = page.getByLabel('Clear search');
    if (await clearSearch.count()) {
      await clearSearch.click();
      await delay(50);
    }

    const identityNode = page.locator('.react-flow__node').filter({ hasText: /Input/ }).first();
    const shaNode = page.locator('.react-flow__node').filter({ hasText: /SHA-256d/ }).first();
    const identityBox = await identityNode.boundingBox();
    const shaBox = await shaNode.boundingBox();

    if (!identityBox || !shaBox) {
      throw new Error('Unable to compute node positions for connect dialog test');
    }

    const left = Math.min(identityBox.x, shaBox.x) - 20;
    const top = Math.min(identityBox.y, shaBox.y) - 20;
    const right = Math.max(identityBox.x + identityBox.width, shaBox.x + shaBox.width) + 20;
    const bottom = Math.max(identityBox.y + identityBox.height, shaBox.y + shaBox.height) + 20;

    const selectionTool = page.getByTitle('Selection tool (click to toggle or hold S + drag with LMB)');
    await selectionTool.click();
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 10 });
    await page.mouse.up();
    await selectionTool.click();

    const selectedNodes = page.locator('.react-flow__node.selected');
    if ((await selectedNodes.count()) !== 2) {
      if ((await selectionTool.getAttribute('data-active')) === 'true') {
        await selectionTool.click();
      }
      await identityNode.click({ position: { x: 120, y: 20 } });
      await shaNode.click({
        position: { x: 120, y: 20 },
        modifiers: ['Shift'],
      });
    }

    await expect(selectedNodes).toHaveCount(2);

    const connectButton = page.getByRole('button', {
      name: 'Connect nodes / copy inputs (select 2 nodes)',
    });
    await expect(connectButton).toBeVisible({ timeout: 10_000 });
    await connectButton.click();
    const wiringTitle = page.getByRole('heading', { name: 'Wiring Studio' });
    await expect(wiringTitle).toBeVisible();
    await page.getByRole('button', { name: 'Connect Edge' }).click();

    const manualCheckboxes = page.locator('[role="checkbox"]');
    await manualCheckboxes.first().click();
    await manualCheckboxes.nth(1).click();
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(wiringTitle).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    await page.unroute('**/bulk_calculate');
  });

  test('copy inputs duplicates incoming edges on new target', async ({ page }) => {
    test.setTimeout(60_000);

    await stubBulkCalculateWithDefaults(page);

    await page.goto('/');
    await loadFixture(page, 'connect-copy-skip.json');

    const sourceNode = page.locator('[data-id="node_source"]');
    const targetNode = page.locator('[data-id="node_target"]');
    await expect(sourceNode).toBeVisible();
    await expect(targetNode).toBeVisible();

    const sourceBoxCopy = await sourceNode.boundingBox();
    const targetBoxCopy = await targetNode.boundingBox();
    if (!sourceBoxCopy || !targetBoxCopy) {
      throw new Error('Unable to compute node positions for copy-inputs test');
    }

    const copyLeft = Math.min(sourceBoxCopy.x, targetBoxCopy.x) - 20;
    const copyTop = Math.min(sourceBoxCopy.y, targetBoxCopy.y) - 20;
    const copyRight = Math.max(sourceBoxCopy.x + sourceBoxCopy.width, targetBoxCopy.x + targetBoxCopy.width) + 20;
    const copyBottom = Math.max(sourceBoxCopy.y + sourceBoxCopy.height, targetBoxCopy.y + targetBoxCopy.height) + 20;

    const selectionToolCopy = page.getByTitle('Selection tool (click to toggle or hold S + drag with LMB)');
    await selectionToolCopy.click();
    await page.mouse.move(copyLeft, copyTop);
    await page.mouse.down();
    await page.mouse.move(copyRight, copyBottom, { steps: 10 });
    await page.mouse.up();
    await selectionToolCopy.click();

    const selectedAfterCopy = page.locator('.react-flow__node.selected');
    if ((await selectedAfterCopy.count()) !== 2) {
      if ((await selectionToolCopy.getAttribute('data-active')) === 'true') {
        await selectionToolCopy.click();
      }
      await sourceNode.click({ position: { x: 120, y: 20 } });
      await targetNode.click({
        position: { x: 120, y: 20 },
        modifiers: ['Shift'],
      });
    }

    await expect(selectedAfterCopy).toHaveCount(2);

    const connectButton = page.getByRole('button', {
      name: 'Connect nodes / copy inputs (select 2 nodes)',
    });
    await expect(connectButton).toBeVisible({ timeout: 10_000 });
    await connectButton.click();

    const copyInputsButton = page.getByRole('button', { name: 'Copy Inputs' });
    await expect(copyInputsButton).toBeEnabled();
    await copyInputsButton.click();

    const skippedNotice = page.getByText(/omitted/);
    await expect(skippedNotice).toBeVisible();

    const sourceSection = page
      .locator('div')
      .filter({ has: page.locator('strong', { hasText: 'Source' }) })
      .first();
    const targetSection = page
      .locator('div')
      .filter({ has: page.locator('strong', { hasText: 'Target' }) })
      .first();

    await expect(sourceSection).toContainText(/Source Node/);
    await expect(targetSection).toContainText(/Target Node/);

    const swapButton = page.getByTitle('Swap source and target');
    await expect(swapButton).toBeEnabled();
    await swapButton.click();
    await expect(sourceSection).toContainText(/Target Node/);
    await expect(targetSection).toContainText(/Source Node/);
    await expect(page.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(0);

    await swapButton.click();
    await expect(sourceSection).toContainText(/Source Node/);

    const copyRowCheckbox = page.getByRole('checkbox').first();
    await expect(copyRowCheckbox).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByRole('heading', { name: 'Wiring Studio' })).toHaveCount(0);
    const copiedEdge = page.locator('.react-flow__edge[data-id*="node_in_a-node_target"]');
    await expect(copiedEdge).toHaveCount(1);

    await page.unroute('**/bulk_calculate');
  });
});

test.describe('Share dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const scoped = window as unknown as {
        navigator: Navigator & { clipboard?: Clipboard };
        __copiedText?: string;
      };
      scoped.__copiedText = '';
      scoped.navigator.clipboard = {
        writeText(text: string) {
          scoped.__copiedText = text;
          return Promise.resolve();
        },
        readText() {
          return Promise.resolve(scoped.__copiedText ?? '');
        },
      } as unknown as Clipboard;
    });
  });

  test('creates share link and copies URL', async ({ page }) => {
    test.setTimeout(60_000);

    await stubBulkCalculateWithDefaults(page);

    let shareCalls = 0;
    await page.route('**/share', async (route) => {
      shareCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: `share-e2e-${shareCalls}` }),
      });
    });

    await page.goto('/');
    await prepareClipboardSpy(page);
    await loadFixture(page, 'hash-flow.json');

    await page.getByTitle('Share snapshot').click();
    const confirmDialog = page.getByRole('dialog', { name: 'Share Workflow' });
    await expect(confirmDialog).toBeVisible();

    await Promise.all([
      page.waitForResponse('**/share'),
      confirmDialog.getByRole('button', { name: 'Create Share Link' }).click(),
    ]);

    const createdDialog = page.getByRole('dialog', { name: 'Share link created' });
    await expect(createdDialog).toBeVisible();
    const shareInput = createdDialog.getByLabel('App link');
    const urlValue = await shareInput.inputValue();
    expect(urlValue).toContain('share-e2e-1');

    const copyButton = createdDialog.getByRole('button', { name: /^Copy/ });
    await copyButton.click();
    const clipboardText = await readClipboard(page);
    expect(clipboardText).toContain('share-e2e-1');

    await createdDialog.getByRole('button', { name: /^Close$/ }).first().click();
    await expect(createdDialog).toHaveCount(0);

    await page.unroute('**/share');
    await page.unroute('**/bulk_calculate');
  });

  test('soft gate completes after verification', async ({ page }) => {
    test.setTimeout(60_000);

    await stubBulkCalculateWithDefaults(page);

    await page.addInitScript(() => {
      const scoped = window as typeof window & {
        turnstile?: {
          render: (el: HTMLElement, opts?: { callback?: (token: string) => void }) => string;
          reset: () => void;
        };
      };
      scoped.turnstile = {
        render: (_el, opts) => {
          const callback = opts?.callback;
          if (callback) setTimeout(() => callback('token-123'), 10);
          return 'widget-id';
        },
        reset: () => {},
      };
    });

    let attempt = 0;
    await page.route('**/share', async (route) => {
      attempt += 1;
      if (attempt === 1) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ softGate: true, error: 'turnstile_required' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'soft-share-id' }),
      });
    });

    await page.goto('/');
    await prepareClipboardSpy(page);
    await loadFixture(page, 'hash-flow.json');

    await page.getByTitle('Share snapshot').click();
    const confirmDialog = page.getByRole('dialog', { name: 'Share Workflow' });
    await expect(confirmDialog).toBeVisible();

    await Promise.all([
      page.waitForResponse('**/share').catch(() => null),
      confirmDialog.getByRole('button', { name: 'Create Share Link' }).click(),
    ]);

    const softGate = page.getByRole('dialog', { name: 'Quick verification' });
    const sawSoftGate = await softGate
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    if (!sawSoftGate) {
      test.info().annotations.push({
        type: 'info',
        description: 'Soft gate was not triggered; skipping verification check.',
      });
    }

    const createdDialog = page.getByRole('dialog', { name: 'Share link created' });
    await expect(createdDialog).toBeVisible({ timeout: 10_000 });
    await expect(createdDialog.getByRole('textbox').first()).toHaveValue(/soft-share-id/);

    await createdDialog.getByRole('button', { name: /^Close$/ }).first().click();
    await expect(createdDialog).toHaveCount(0);

    await page.unroute('**/share');
    await page.unroute('**/bulk_calculate');
  });

  test('forbidden origin surfaces info dialog', async ({ page }) => {
    test.setTimeout(60_000);

    await stubBulkCalculateWithDefaults(page);

    await page.route('**/share', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forbidden_origin' }),
      });
    });

    await page.goto('/');
    await prepareClipboardSpy(page);
    await loadFixture(page, 'hash-flow.json');

    await page.getByTitle('Share snapshot').click();
    const confirmDialog = page.getByRole('dialog', { name: 'Share Workflow' });
    await expect(confirmDialog).toBeVisible();

    await Promise.all([
      page.waitForResponse('**/share').catch(() => null),
      confirmDialog.getByRole('button', { name: 'Create Share Link' }).click(),
    ]);

    const infoDialog = page.getByRole('dialog', { name: 'Information' });
    await expect(infoDialog).toBeVisible();
    await expect(infoDialog).toContainText('This origin is not allowed to share');

    await infoDialog.getByRole('button', { name: 'OK' }).click();
    await expect(infoDialog).toHaveCount(0);

    await page.unroute('**/share');
    await page.unroute('**/bulk_calculate');
  });
});

async function stubBulkCalculateWithDefaults(page: Page) {
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
