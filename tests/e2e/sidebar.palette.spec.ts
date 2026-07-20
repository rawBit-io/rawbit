import { expect, test } from '@playwright/test';

import { delay } from './utils';

test.describe('Sidebar palette', () => {
  test('shows Payment Channels directly below SegWit without enabling older flows', async ({ page }) => {
    await page.goto('/');

    const segwitSection = page.getByRole('button', { name: 'SegWit', exact: true });
    const paymentChannelsSection = page.getByRole('button', {
      name: 'Payment Channels',
      exact: true,
    });

    await expect(segwitSection).toBeVisible();
    await expect(paymentChannelsSection).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Show older flow examples' })).not.toBeChecked();

    const segwitBox = await segwitSection.boundingBox();
    const paymentChannelsBox = await paymentChannelsSection.boundingBox();
    expect(segwitBox).not.toBeNull();
    expect(paymentChannelsBox).not.toBeNull();
    expect(paymentChannelsBox!.y).toBeGreaterThan(segwitBox!.y);

    await paymentChannelsSection.click();
    await expect(page.getByText('15. Spilman Channel', { exact: true })).toBeVisible();
  });

  test('drag-and-drop template creates node with undo/redo history', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByPlaceholder('Search nodes...');
    await searchInput.fill('input');

    const templateTile = page
      .locator('[draggable="true"]')
      .filter({ hasText: /Input/i })
      .first();
    await expect(templateTile).toBeVisible();

    const canvas = page.locator('.react-flow__pane');
    await templateTile.dragTo(canvas, { targetPosition: { x: 200, y: 200 } });

    const nodes = page.locator('.react-flow__node');
    await expect(nodes).toHaveCount(1, { timeout: 10_000 });

    await page.waitForTimeout(100);
    const historyButton = page.getByTitle('History');
    await historyButton.click();
    await expect(page.getByRole('heading', { name: 'Undo/Redo Stack' })).toBeVisible();
    const historyEntries = page.getByRole('button', {
      name: /Node\(s\) (dropped|added)/i,
    });
    await expect.poll(async () => historyEntries.count()).toBeGreaterThan(0);
    const historyEntry = historyEntries.first();
    await expect(historyEntry).toBeVisible();
    await page.getByTitle('Close panel').click();

    const undoButton = page.getByTitle('Undo');
    await undoButton.click();
    await expect(nodes).toHaveCount(0);

    const redoButton = page.getByTitle('Redo');
    await redoButton.click();
    await expect(nodes).toHaveCount(1);

    await historyButton.click();
    await expect(historyEntry).toHaveClass(/font-medium/);
    await page.getByTitle('Close panel').click();
  });

  test('filters templates via search and resets after clearing', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.getByPlaceholder('Search nodes...');
    await searchInput.fill('un');

    const resultsBanner = page.getByText(/Found \d+ result/i);
    await expect(resultsBanner).toBeVisible();

    const resultTiles = page.locator('[draggable="true"]');
    await expect(resultTiles.first()).toBeVisible();
    await expect(resultTiles.filter({ hasText: /Uint32/i })).toBeVisible();

    await page.getByLabel('Clear search').click();
    await delay(50);

    await expect(resultsBanner).toHaveCount(0);
    await expect(page.getByText('Canvas & Inputs', { exact: true })).toBeVisible();
  });
});
