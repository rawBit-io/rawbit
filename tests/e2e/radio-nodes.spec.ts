import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { gotoEditor, resolveFixturePath, waitForBulkResponse } from './utils';

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

  test('receiver recovers when the sender channel is changed away and back', async ({
    page,
  }) => {
    await gotoEditor(page);
    await page
      .locator('input[type="file"][accept=".json"]')
      .setInputFiles(resolveFixturePath('radio-pair-flow.json'));

    const sendNode = page.getByTestId('radio-send-node');
    const recvNode = page.getByTestId('radio-receive-node');
    await expect(sendNode).toBeVisible();
    await expect(recvNode.locator('.node-error-icon')).toHaveCount(0);

    // 2 → 21: the receiver is orphaned and must warn. The recalc reply carries
    // the pairing error, so it is expected here.
    await editSenderChannel(page, '2', '21', { allowErrors: true });
    await expect(recvNode.locator('.node-error-icon')).toBeVisible();

    // 21 → 2: the restored bare pair transmits "" and must calculate clean —
    // no stale error may survive on either node (regression: the receiver used
    // to keep an error after the channel was restored).
    await editSenderChannel(page, '21', '2');
    await expect(recvNode.locator('.node-error-icon')).toHaveCount(0);
    await expect(sendNode.locator('.node-error-icon')).toHaveCount(0);
  });
});

async function editSenderChannel(
  page: Page,
  fromChannel: string,
  toChannel: string,
  options: { allowErrors?: boolean } = {},
) {
  const sendNode = page.getByTestId('radio-send-node');
  await sendNode
    .getByRole('button', { name: `Radio Send channel ${fromChannel}` })
    .dblclick();
  const input = sendNode.getByRole('textbox', {
    name: `Radio Send channel ${fromChannel}`,
  });
  await input.fill(toChannel);
  await waitForBulkResponse(page, () => input.press('Enter'), {
    allowErrors: options.allowErrors,
  });
}
