import { readFileSync } from 'fs';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { FlowData } from '@/types';
import { enrichNodesForSuccess, parseBulkRequestPayload } from './fixtures';
import { resolveFixturePath } from './utils';

test.describe('Shared flow edge rendering', () => {
  test.describe.configure({ mode: 'serial' });

  test('renders shared-link edges reliably after repeated loads', async ({ browserName, page }) => {
    test.setTimeout(120_000);

    const fixture: FlowData = JSON.parse(readFileSync(resolveFixturePath('hash-flow.json'), 'utf8'));
    const sharedPayload: FlowData = {
      schemaVersion: 1,
      name: 'shared-edge-rendering',
      nodes: fixture.nodes ?? [],
      edges: fixture.edges ?? [],
    };

    await page.route('**/s/shared-edge-*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sharedPayload),
      });
    });

    await page.route('**/bulk_calculate', async (route) => {
      let payload: unknown;
      try {
        payload = route.request().postDataJSON();
      } catch {
        payload = undefined;
      }
      const { version, nodes } = parseBulkRequestPayload(payload);
      const responseNodes = enrichNodesForSuccess(
        nodes.length ? nodes : (fixture.nodes ?? [])
      );

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nodes: responseNodes, errors: [], version }),
      });
    });

    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    const attempts = browserName === 'webkit' ? 10 : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const shareId = `shared-edge-${attempt}`;
      const shareResponse = page.waitForResponse(
        (response) =>
          response.url().includes(`/s/${shareId}`) &&
          response.request().method() === 'GET',
        { timeout: 20_000 },
      );

      await page.goto(`/?s=${shareId}`, { waitUntil: 'domcontentloaded' });
      await shareResponse;

      await expect(page.locator('.react-flow__node')).toHaveCount(2, {
        timeout: 20_000,
      });

      const edge = page.locator('.react-flow__edge[data-id="edge_input_hash"]');
      await expect(edge).toHaveCount(1, { timeout: 20_000 });
      await expect(edge).toBeVisible({ timeout: 20_000 });
      await expect(edge.locator('path.react-flow__edge-path')).toBeVisible({
        timeout: 20_000,
      });
      await expect(page).toHaveURL((url) => {
        return !url.searchParams.has('s') && !url.searchParams.has('share');
      });
    }

    await page.unroute('**/s/shared-edge-*');
    await page.unroute('**/bulk_calculate');
  });

  test('reloads large shared-link imports with all edges intact', async ({ page }) => {
    test.setTimeout(90_000);

    const sharedPayload: FlowData = JSON.parse(
      readFileSync('src/my_tx_flows/p18_Taproot_script_path.json', 'utf8')
    );
    const expectedNodes = sharedPayload.nodes?.length ?? 0;
    const expectedEdges = sharedPayload.edges?.length ?? 0;

    await page.route('**/s/large-shared-reload-*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...sharedPayload,
          schemaVersion: sharedPayload.schemaVersion ?? 1,
          name: 'large-shared-reload',
        }),
      });
    });

    await page.route('**/bulk_calculate', async (route) => {
      let payload: unknown;
      try {
        payload = route.request().postDataJSON();
      } catch {
        payload = undefined;
      }
      const { version, nodes } = parseBulkRequestPayload(payload);
      const responseNodes = enrichNodesForSuccess(
        nodes.length ? nodes : (sharedPayload.nodes ?? [])
      );

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nodes: responseNodes, errors: [], version }),
      });
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('rawbit.ui.welcomeSeen', '1');
      });

      const shareId = `large-shared-reload-${attempt}`;
      await page.goto(`/?s=${shareId}`, { waitUntil: 'domcontentloaded' });

      await expect(page).toHaveURL((url) => {
        return !url.searchParams.has('s') && !url.searchParams.has('share');
      });
      await expect(page.locator('.react-flow__node').first()).toBeVisible({
        timeout: 20_000,
      });
      await expectCurrentSharePayloadCounts(page, expectedNodes, expectedEdges);
      await expect(page.locator('.react-flow__edge').first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.locator('.react-flow__edge path.react-flow__edge-path').first()
      ).toBeVisible({ timeout: 20_000 });

      await page.reload({ waitUntil: 'domcontentloaded' });

      await expect(page.locator('.react-flow__node').first()).toBeVisible({
        timeout: 20_000,
      });
      await expectCurrentSharePayloadCounts(page, expectedNodes, expectedEdges);
      await expect(page.locator('.react-flow__edge').first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.locator('.react-flow__edge path.react-flow__edge-path').first()
      ).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () =>
          (await page.locator('.react-flow__viewport').getAttribute('style')) ?? ''
        )
        .not.toContain('translate(0px) scale(1)');
    }

    await page.unroute('**/s/large-shared-reload-*');
    await page.unroute('**/bulk_calculate');
  });
});

async function expectCurrentSharePayloadCounts(
  page: Page,
  expectedNodes: number,
  expectedEdges: number
) {
  let capturedPayload: { nodes?: unknown[]; edges?: unknown[] } | undefined;
  const shareId = `large-shared-check-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  await page.route('**/share', async (route) => {
    capturedPayload = route.request().postDataJSON() as {
      nodes?: unknown[];
      edges?: unknown[];
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: shareId }),
    });
  });

  await page.getByTitle('Share snapshot').click();
  const confirmDialog = page.getByRole('dialog', { name: 'Share Workflow' });
  await expect(confirmDialog).toBeVisible();

  await Promise.all([
    page.waitForResponse('**/share'),
    confirmDialog.getByRole('button', { name: 'Create Share Link' }).click(),
  ]);

  expect(capturedPayload?.nodes).toHaveLength(expectedNodes);
  expect(capturedPayload?.edges).toHaveLength(expectedEdges);

  const createdDialog = page.getByRole('dialog', { name: 'Share link created' });
  await expect(createdDialog).toBeVisible();
  await createdDialog.getByRole('button', { name: /^Close$/ }).first().click();
  await expect(createdDialog).toHaveCount(0);

  await page.unroute('**/share');
}
