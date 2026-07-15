import { expect, test } from '@playwright/test';

import { gotoEditor, loadFixture, resolveFixturePath } from './utils';

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

  test('drags a multi-group selection from either selected group body', async ({ page }) => {
    await page.route('**/bulk_calculate', async (route) => {
      const payload = route.request().postDataJSON() as {
        nodes?: unknown[];
        version?: number;
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nodes: payload.nodes ?? [],
          errors: [],
          version: payload.version ?? 1,
        }),
      });
    });

    await gotoEditor(page);
    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await fileInput.setInputFiles(resolveFixturePath('two-groups.json'));

    const firstGroup = page.locator('[data-id="group_first"]');
    const secondGroup = page.locator('[data-id="group_second"]');
    await expect(firstGroup).toBeVisible({ timeout: 10_000 });
    await expect(secondGroup).toBeVisible({ timeout: 10_000 });

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await firstGroup.getByTestId('group-header').click();
    await secondGroup.getByTestId('group-header').click({
      modifiers: [modifier],
    });
    await expect(
      page.locator('.react-flow__node-shadcnGroup.selected'),
    ).toHaveCount(2);

    const firstBody = firstGroup.getByTestId('group-body-content');
    await expect(firstBody).toHaveAttribute('data-drag-handle', 'true');

    const firstBefore = await firstGroup.boundingBox();
    const secondBefore = await secondGroup.boundingBox();
    const bodyBox = await firstBody.boundingBox();
    if (!firstBefore || !secondBefore || !bodyBox) {
      throw new Error('Group bounds unavailable');
    }

    const move = { x: 120, y: 80 };
    const start = {
      x: bodyBox.x + bodyBox.width / 2,
      y: bodyBox.y + bodyBox.height * 0.7,
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + move.x, start.y + move.y, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => {
      const moved = await firstGroup.boundingBox();
      return moved ? moved.x - firstBefore.x : 0;
    }).toBeGreaterThan(80);

    const firstAfter = await firstGroup.boundingBox();
    const secondAfter = await secondGroup.boundingBox();
    if (!firstAfter || !secondAfter) {
      throw new Error('Moved group bounds unavailable');
    }
    const firstDelta = {
      x: firstAfter.x - firstBefore.x,
      y: firstAfter.y - firstBefore.y,
    };
    const secondDelta = {
      x: secondAfter.x - secondBefore.x,
      y: secondAfter.y - secondBefore.y,
    };
    expect(Math.abs(firstDelta.x - secondDelta.x)).toBeLessThan(2);
    expect(Math.abs(firstDelta.y - secondDelta.y)).toBeLessThan(2);

    await page.getByTitle('Undo').click();
    await expect.poll(async () => {
      const restored = await firstGroup.boundingBox();
      if (!restored) return Number.POSITIVE_INFINITY;
      return (
        Math.abs(restored.x - firstBefore.x) +
        Math.abs(restored.y - firstBefore.y)
      );
    }).toBeLessThan(2);
    await expect.poll(async () => {
      const restored = await secondGroup.boundingBox();
      if (!restored) return Number.POSITIVE_INFINITY;
      return (
        Math.abs(restored.x - secondBefore.x) +
        Math.abs(restored.y - secondBefore.y)
      );
    }).toBeLessThan(2);
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
