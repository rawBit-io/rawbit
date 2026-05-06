import { expect, test } from '@playwright/test';

import { loadFixture, gotoEditor } from './utils';

test.describe('Grouping and color palette', () => {
  test('groups and ungroups selected nodes with undo/redo support', async ({ page }) => {
    await gotoEditor(page);
    await loadFixture(page, 'hash-flow.json');

    const firstNode = page.locator('[data-id="node_input"]');
    const secondNode = page.locator('[data-id="node_hash"]');

    await firstNode.click();
    await page.keyboard.down('Shift');
    await secondNode.click();
    await page.keyboard.up('Shift');

    const selectedNodes = page.locator('.react-flow__node.selected');
    await expect(selectedNodes).toHaveCount(2);

    const groupButton = page.getByRole('button', { name: /^Group$/ });
    await expect(groupButton).toBeEnabled();
    await groupButton.click();

    const groupNode = page.locator('.react-flow__node-shadcnGroup');
    await expect(groupNode).toBeVisible({ timeout: 10_000 });

    await page.getByTitle('Undo').click();
    await expect(groupNode).toHaveCount(0);

    await page.getByTitle('Redo').click();
    await expect(groupNode).toBeVisible();

    await page.getByTitle('Sidebar').click();
    await groupNode.click({ position: { x: 20, y: 20 } });
    await page.getByRole('button', { name: /^Ungroup$/ }).click();

    await expect(groupNode).toHaveCount(0);
    await expect(selectedNodes).toHaveCount(2);
  });

  test('selection mode toggle activates and deactivates marquee selection', async ({ page }) => {
    await gotoEditor(page);
    await loadFixture(page, 'hash-flow.json');
    await page.getByTitle('Sidebar').click();

    const selectionTool = page.getByTitle('Selection tool (click to toggle or hold S + drag with LMB)');
    await selectionTool.click();
    await expect(selectionTool).toHaveAttribute('data-active', 'true');

    const firstBox = await page.locator('[data-id="node_input"]').boundingBox();
    const secondBox = await page.locator('[data-id="node_hash"]').boundingBox();
    if (!firstBox || !secondBox) throw new Error('Flow nodes not ready');

    const start = {
      x: Math.max(20, Math.min(firstBox.x, secondBox.x) - 30),
      y: Math.max(80, Math.min(firstBox.y, secondBox.y) - 30),
    };
    const end = {
      x: Math.max(firstBox.x + firstBox.width, secondBox.x + secondBox.width) + 30,
      y: Math.max(firstBox.y + firstBox.height, secondBox.y + secondBox.height) + 30,
    };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();

    const selectedNodes = page.locator('.react-flow__node.selected');
    await expect(selectedNodes).toHaveCount(2);

    await selectionTool.click();
    await expect(selectionTool).not.toHaveAttribute('data-active', 'true');
  });

  test('applies and resets node color via palette with undo snapshot', async ({ page }) => {
    await gotoEditor(page);
    await loadFixture(page, 'hash-flow.json');
    await page.getByTitle('Sidebar').click();

    const node = page.locator('[data-id="node_input"]');
    await node.click();

    const paletteButton = page.getByTitle('Colour palette');
    await expect(paletteButton).toBeEnabled();

    const card = node.locator('div.rounded-xl.relative.border-2').first();
    const initialBorder = await card.evaluate((el) => getComputedStyle(el).borderColor);
    await paletteButton.click();

    const palette = page.locator('div.nodrag').filter({ has: page.getByRole('button', { name: 'Select blue' }) });
    await expect(palette).toBeVisible();

    await page.getByRole('button', { name: 'Select blue' }).click();

    await expect.poll(async () => card.evaluate((el) => getComputedStyle(el).borderColor)).not.toBe(initialBorder);

    const historyButton = page.getByTitle('History');
    await historyButton.click();
    await expect(page.locator('button', { hasText: 'Change Node Color' })).toBeVisible();
    await page.getByTitle('Close panel').click();

    await paletteButton.click();
    await page.locator('button[title="Remove border color"]').click();

    await expect.poll(async () => card.evaluate((el) => getComputedStyle(el).borderColor)).toBe(initialBorder);
  });
});
