import { expect, test } from '@playwright/test';

import { loadFixture } from './utils';

test.describe('Canvas basics', () => {
  test('fits viewport after loading distant nodes', async ({ page }) => {
    await page.goto('/');

    await loadFixture(page, 'offscreen-flow.json');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'fit view' }).click();

    const farNode = page.locator('[data-id="node_far_target"]');
    await expect(farNode).toBeVisible({ timeout: 10_000 });

    const viewportSize = page.viewportSize() ?? { width: 1280, height: 720 };

    await expect.poll(async () => {
      const box = await farNode.boundingBox();
      if (!box) return false;
      const withinHorizontal = box.x >= -30 && box.x + box.width <= viewportSize.width + 30;
      const withinVertical = box.y >= -30 && box.y + box.height <= viewportSize.height + 30;
      return withinHorizontal && withinVertical;
    }, { timeout: 15_000 }).toBe(true);
  });

  test('toggles minimap visibility and resizes with side panels', async ({ page }) => {
    await page.goto('/');

    await loadFixture(page, 'hash-flow.json');

    const ensureMinimapVisible = async () => {
      const showButton = page.getByTitle('Show minimap');
      if (await showButton.count()) {
        await showButton.click();
      }
    };

    await ensureMinimapVisible();

    const minimap = page.locator('.react-flow__minimap');
    await expect(minimap.first()).toBeVisible({ timeout: 10_000 });

    const toggleMinimap = page.getByTitle('Hide minimap');

    const widthBeforeHide = await minimap.evaluate((element) => element.getBoundingClientRect().width);
    expect(widthBeforeHide).toBeGreaterThan(80);

    await toggleMinimap.click();
    await expect(minimap).toHaveCount(0);

    await page.getByTitle('Show minimap').click();
    await expect(minimap).toBeVisible();

    const boxBeforePanel = (await minimap.boundingBox()) ?? { x: 0, width: 0 };
    const widthBeforePanel = boxBeforePanel.width;

    const openSearch = page.getByTitle('Search nodes');
    await openSearch.click();

    const searchPanel = page.getByTestId('search-panel');
    await expect.poll(async () =>
      searchPanel.evaluate((element) => element.getBoundingClientRect().width)
    ).toBeGreaterThan(200);

    const boxWithPanel = (await minimap.boundingBox()) ?? { x: 0, width: widthBeforePanel };
    expect(boxWithPanel.x).toBeLessThan(boxBeforePanel.x);

    await page.getByTitle('Close search').click();
  });
});
