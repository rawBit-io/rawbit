import { expect, test } from '@playwright/test';

// A tiny but valid flow the mocked /bitcoin/rebuild returns; opening it must
// create a new tab and render its node on the canvas.
const REBUILT_FLOW = {
  name: 'Rebuild 5fae7ba96a6c…',
  schemaVersion: 1,
  nodes: [
    {
      id: 'node_rebuild_demo',
      type: 'calculation',
      position: { x: 0, y: 0 },
      data: { functionName: 'identity', title: 'Version', value: '2', result: '2' },
    },
  ],
  edges: [],
};

test.describe('Rebuild a transaction on canvas', () => {
  test('opens the rebuilt flow in a new tab', async ({ page }) => {
    await page.route('**/bitcoin/status', (route) =>
      route.fulfill({ json: { connected: true, chain: 'regtest', blocks: 101 } }),
    );
    await page.route('**/bitcoin/rebuild', (route) =>
      route.fulfill({ json: { flow: REBUILT_FLOW, txid: '5fae7ba96a6cf568' } }),
    );

    await page.goto('/');
    await expect(page.locator('.react-flow')).toBeVisible();

    await page.getByTitle('Bitcoin Core CLI').click();
    const input = page.getByTestId('bitcoin-rebuild-input');
    await input.fill('5fae7ba96a6cf568');
    await page.getByTestId('bitcoin-rebuild-button').click();

    // a new tab named after the rebuild should appear
    await expect(page.locator('.app-tab-title', { hasText: 'Rebuild' })).toBeVisible();
    // and the rebuilt node renders on the canvas
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
  });

  test('incoming transactions surface as one-click rebuilds', async ({ page }) => {
    const freshTx = 'cd'.repeat(32);
    let polls = 0;
    await page.route('**/bitcoin/status', (route) =>
      route.fulfill({ json: { connected: true, chain: 'regtest', blocks: 101 } }),
    );
    await page.route('**/bitcoin/rpc', (route) => {
      const { method } = route.request().postDataJSON() as { method: string };
      if (method === 'listsinceblock') {
        polls += 1;
        // first poll primes the cursor; the second finds a fresh wallet tx
        return route.fulfill({
          json: {
            result: {
              transactions: polls > 1 ? [{ txid: freshTx }] : [],
              lastblock: '00'.repeat(32),
            },
          },
        });
      }
      return route.fulfill({ json: { result: [] } }); // getrawmempool
    });
    await page.route('**/bitcoin/rebuild', (route) =>
      route.fulfill({ json: { flow: REBUILT_FLOW, txid: freshTx } }),
    );

    await page.goto('/');
    await expect(page.locator('.react-flow')).toBeVisible();
    await page.getByTitle('Bitcoin Core CLI').click();

    // the watch polls every 5s — the chip appears after the second poll
    const chip = page.getByTestId('bitcoin-incoming-rebuild');
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.click();

    await expect(page.locator('.app-tab-title', { hasText: 'Rebuild' })).toBeVisible();
  });
});
