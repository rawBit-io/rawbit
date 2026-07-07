import { expect, test } from '@playwright/test';

import { gotoEditor, resolveFixturePath } from './utils';

test.describe('Radio nodes', () => {
  test('renders wireless duplicate warnings without visible radio edges', async ({ page }) => {
    await gotoEditor(page);
    await page
      .locator('input[type="file"][accept=".json"]')
      .setInputFiles(resolveFixturePath('radio-duplicate-flow.json'));

    await expect(page.locator('[data-testid="radio-send-node"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="radio-receive-node"]')).toHaveCount(1);
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);
    await expect(
      page.locator('button[aria-label="Radio Send 1 duplicates another Radio Send"]'),
    ).toHaveCount(2);
    await expect(
      page.locator(
        'button[aria-label="Radio Receive 1 has multiple matching Radio Sends"]',
      ),
    ).toBeVisible();
  });
});
