import { expect, test } from '@playwright/test';

import type { Locator, Page } from '@playwright/test';

import { computeNodeResult, enrichNodesForSuccess, parseBulkRequestPayload } from './fixtures';
import { loadFixture, waitForBulkResponse } from './utils';

const MOVE_OFFSET = { x: 140, y: 120 };

// These tests focus on flows interacting with undo snapshots when nodes move or edges reconnect.
test.describe('Undo snapshots for interactions', () => {
  test.beforeEach(async ({ page }) => {
    await stubBulkCalculate(page);
    await page.goto('/');
    await loadFixture(page, 'reconnect-flow.json');
  });

  test.afterEach(async ({ page }) => {
    await page.unroute('**/bulk_calculate');
  });

  test('node drag records undo snapshot and restores position', async ({ page }) => {
    const node = page.locator('[data-id="node_hash"]');
    await expect(node).toBeVisible();

    const initialBox = await node.boundingBox();
    if (!initialBox) throw new Error('Node bounding box unavailable');

    await page.mouse.move(initialBox.x + initialBox.width / 2, initialBox.y + initialBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      initialBox.x + initialBox.width / 2 + MOVE_OFFSET.x,
      initialBox.y + initialBox.height / 2 + MOVE_OFFSET.y,
      { steps: 12 },
    );
    await page.mouse.up();

    await expect.poll(async () => {
      const moved = await node.boundingBox();
      if (!moved) return 0;
      const dx = Math.abs(moved.x - initialBox.x);
      const dy = Math.abs(moved.y - initialBox.y);
      return dx + dy;
    }).toBeGreaterThan(10);

    await page.getByTitle('Undo').click();

    await expect.poll(async () => {
      const restored = await node.boundingBox();
      if (!restored) return Infinity;
      const dx = Math.abs(restored.x - initialBox.x);
      const dy = Math.abs(restored.y - initialBox.y);
      return dx + dy;
    }).toBeLessThan(2);
  });

  test('deleting a feeding node is a single undo step', async ({ page }) => {
    // node_input feeds node_hash: deleting it dirties node_hash (via onDelete),
    // which recalculates. Regression — that recalc's "After calc" snapshot must
    // coalesce into the "Node(s) removed" entry so one deletion is one undo,
    // capturing the recalculated downstream (not a stale result, not two steps).
    const inputNode = page.locator('[data-id="node_input"]');
    const inputEdge = page.locator(
      '.react-flow__edge[data-id="edge_input_hash"]',
    );
    await expect(inputNode).toBeVisible();
    await expect(inputEdge).toBeVisible();

    // Select exactly node_input (clicking a node after import does not deselect
    // the others, and Delete would then remove the whole flow).
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
    await inputNode.click();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);

    // Delete and wait for the deletion-triggered recalc to settle so the
    // after-calc snapshot (the entry that used to be a separate undo step) has
    // fired.
    await waitForBulkResponse(
      page,
      async () => {
        await page.keyboard.press('Delete');
      },
      { timeoutMs: 12_000 },
    );

    await expect(inputNode).toHaveCount(0);
    await expect(inputEdge).toHaveCount(0);

    // ONE undo fully restores the pre-delete state. Under the old
    // double-snapshot bug the first undo only reached the intermediate
    // "Node(s) removed" entry where node_input was already gone.
    const undoButton = page.getByTitle('Undo');
    await expect(undoButton).toBeEnabled({ timeout: 10_000 });
    await undoButton.click();

    await expect(inputNode).toBeVisible();
    await expect(inputEdge).toBeVisible();
  });

  test('edge reconnect can be undone', async ({ page }) => {
    const edgeLocator = page.locator('.react-flow__edge[data-id="edge_input_hash"]');
    await expect(edgeLocator).toBeVisible();

    const originalEdgeButton = page.getByRole('button', {
      name: 'Edge from node_input to node_hash',
    });
    await expect(originalEdgeButton).toBeVisible();

    const reconnectedEdgeButton = page.getByRole('button', {
      name: 'Edge from node_input to node_passthrough',
    });

    await reconnectEdgeToPassthrough(page, reconnectedEdgeButton);

    await expect(reconnectedEdgeButton).toBeVisible();
    await expect(originalEdgeButton).toHaveCount(0);

    const undoButton = page.getByTitle('Undo');
    await expect(undoButton).toBeEnabled({ timeout: 10_000 });
    await undoButton.click();
    await expect(originalEdgeButton).toBeVisible();
    await expect(reconnectedEdgeButton).toHaveCount(0);
  });
});

async function reconnectEdgeToPassthrough(
  page: Page,
  reconnectedEdgeButton: Locator
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const edgeLocator = page.locator('.react-flow__edge[data-id="edge_input_hash"]');
    await expect(edgeLocator).toBeVisible();
    await edgeLocator.hover();

    const targetUpdater = page
      .locator('circle.react-flow__edgeupdater-target')
      .first();
    await expect(targetUpdater).toBeVisible();

    const newTargetHandle = page
      .locator('[data-id="node_passthrough"] .react-flow__handle.target')
      .first();
    await expect(newTargetHandle).toBeVisible();

    const updaterBox = await targetUpdater.boundingBox();
    const newHandleBox = await newTargetHandle.boundingBox();
    if (!updaterBox || !newHandleBox) {
      throw new Error('Unable to compute edge or handle position for reconnect test');
    }

    const startX = updaterBox.x + updaterBox.width / 2;
    const startY = updaterBox.y + updaterBox.height / 2;
    const endX = newHandleBox.x + newHandleBox.width / 2;
    const endY = newHandleBox.y + newHandleBox.height / 2;

    try {
      await waitForBulkResponse(
        page,
        async () => {
          await page.mouse.move(startX, startY);
          await page.mouse.down();
          await page.mouse.move(endX, endY, { steps: 12 });
          await page.mouse.up();
        },
        { timeoutMs: 12_000 }
      );
      return;
    } catch (error) {
      lastError = error;
      await page.mouse.up().catch(() => undefined);
      if ((await reconnectedEdgeButton.count()) > 0) return;
      await page.waitForTimeout(200);
    }
  }

  throw lastError ?? new Error('Edge reconnect did not trigger a backend refresh');
}

async function stubBulkCalculate(page: Page) {
  await page.route('**/bulk_calculate', async (route) => {
    let payload: unknown;
    try {
      payload = route.request().postDataJSON();
    } catch {
      payload = undefined;
    }

    const { version, nodes } = parseBulkRequestPayload(payload);
    const enrichedNodes = enrichNodesForSuccess(nodes, computeNodeResult);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nodes: enrichedNodes, errors: [], version }),
    });
  });
}
