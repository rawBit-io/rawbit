import { readFileSync } from 'fs';

import { expect, test } from '@playwright/test';

import type { FlowData } from '@/types';
import { enrichNodesForSuccess, parseBulkRequestPayload } from './fixtures';
import { resolveFixturePath } from './utils';

test.describe('Shared flow edge rendering', () => {
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
});
