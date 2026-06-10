import { expect, test } from '@playwright/test';

test.describe('Bitcoin Core console panel', () => {
  test('opens from the topbar, shows node status and runs a command', async ({ page }) => {
    await page.route('**/bitcoin/status', (route) =>
      route.fulfill({
        json: { connected: true, chain: 'regtest', blocks: 101 },
      }),
    );
    await page.route('**/bitcoin/rpc', async (route) => {
      const payload = route.request().postDataJSON() as {
        method: string;
        params: unknown[];
      };
      if (payload.method === 'getblockcount') {
        await route.fulfill({ json: { result: 101 } });
        return;
      }
      await route.fulfill({
        json: { error: { code: -32601, message: 'Method not found' } },
      });
    });

    await page.goto('/');
    await expect(page.locator('.react-flow')).toBeVisible();

    const panel = page.getByTestId('bitcoin-core-panel');
    await expect
      .poll(async () => (await panel.boundingBox())?.width ?? 0)
      .toBeLessThan(2);

    await page.getByTitle('Bitcoin Core CLI').click();
    await expect
      .poll(async () => (await panel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(300);

    const status = page.getByTestId('bitcoin-status');
    await expect(status).toContainText('regtest');
    await expect(status).toContainText('block 101');

    const input = page.getByTestId('bitcoin-cli-input');
    await input.fill('getblockcount');
    await input.press('Enter');

    const output = page.getByTestId('bitcoin-console-output');
    await expect(output).toContainText('> getblockcount');
    await expect(output).toContainText('101');

    // unknown methods surface bitcoind's error in the console
    await input.fill('definitelynotamethod');
    await input.press('Enter');
    await expect(output).toContainText('error -32601: Method not found');

    // opening the search panel closes the console (sibling behavior)
    await page.getByTitle('Search nodes').click();
    await expect
      .poll(async () => (await panel.boundingBox())?.width ?? 0)
      .toBeLessThan(2);
  });
});
