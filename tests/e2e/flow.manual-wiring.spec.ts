import { expect, test, type Locator } from '@playwright/test';

import {
  delay,
  gotoEditor,
  setEditableValue,
  toNodeMap,
  waitForBulkResponse,
} from './utils';

const PRIVATE_KEY_HEX = 'd4936a26f305f830ce949d8234615cacbff5fb4b183cba7537d10e9dd07bae85';
const EXPECTED_PUBKEY = '02b4e2c0fd4fe3fa2bea236e9a10ad063161ad12245d3af933117d6b80d403eb87';
const EXPECTED_HASH160 = '6beaaea6dd873ae81982d48c8d8c15feeb2c77ba';
const EXPECTED_ADDRESS = 'mqMZjb23e9bf9UE5TfoUf5Qq3sMsFpLhvc';

test.describe('Manual wiring flow', () => {
  test('connects nodes via handles and computes expected P2PKH address', async ({ page }) => {
    test.setTimeout(120_000);

    await gotoEditor(page);

    await page.addStyleTag({
      content: `
        .react-flow__handle {
          pointer-events: all !important;
          z-index: 5 !important;
        }
        .react-flow__handle.source {
          top: -32px !important;
          left: 75% !important;
          transform: translate(-50%, 0) !important;
          width: 28px !important;
          height: 28px !important;
        }
        .react-flow__handle.target {
          top: -32px !important;
          left: 25% !important;
          transform: translate(-50%, 0) !important;
          width: 28px !important;
          height: 28px !important;
        }
      `,
    });

    await page.addStyleTag({
      content: `
        .react-flow__node .flex.items-start.justify-between.gap-2.text-sm {
          pointer-events: none !important;
        }
        .react-flow__node .mt-auto.border-t.border-border.pt-2 {
          pointer-events: none !important;
        }
      `,
    });

    const searchInput = page.getByPlaceholder('Search nodes...');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    const canvas = page.locator('.react-flow__pane');

    async function dropNode(searchTerm: string, matcher: RegExp, position: { x: number; y: number }) {
      await searchInput.fill(searchTerm);
      await delay(120);

      const tile = page.locator('[draggable="true"]').filter({ hasText: matcher }).first();
      await expect(tile).toBeVisible({ timeout: 10_000 });
      await canvas.hover();
      await tile.dragTo(canvas, { targetPosition: position });
      await delay(200);

      const clearButton = page.getByLabel('Clear search');
      if ((await clearButton.count()) > 0) {
        await clearButton.click();
        await delay(60);
      } else {
        await searchInput.fill('');
      }
    }

    await dropNode('identity', /Input/i, { x: 220, y: 280 });
    await dropNode('privkey', /PrivKey/i, { x: 440, y: 280 });
    await dropNode('hash160', /Data.*HASH160/i, { x: 660, y: 280 });
    await dropNode('p2pkh', /HASH160.*P2PKH Address/i, { x: 880, y: 280 });

    const identityNode = page.locator('.react-flow__node').filter({ hasText: /Input/i }).first();
    const privKeyNode = page.locator('.react-flow__node').filter({ hasText: /PrivKey/i }).first();
    const hashNode = page
      .locator('.react-flow__node')
      .filter({ hasText: /Data.*HASH160/i })
      .first();
    const addressNode = page
      .locator('.react-flow__node')
      .filter({ hasText: /HASH160.*P2PKH Address/i })
      .first();

    await expect(identityNode).toBeVisible();
    await expect(privKeyNode).toBeVisible();
    await expect(hashNode).toBeVisible();
    await expect(addressNode).toBeVisible();

    const identityId = await identityNode.getAttribute('data-id');
    const privKeyId = await privKeyNode.getAttribute('data-id');
    const hashId = await hashNode.getAttribute('data-id');
    const addressId = await addressNode.getAttribute('data-id');

    if (!identityId || !privKeyId || !hashId || !addressId) {
      throw new Error('Failed to resolve node identifiers after dropping nodes');
    }

    async function connectHandles(sourceNode: Locator, targetNode: Locator) {
      const sourceHandle = sourceNode.locator('.react-flow__handle.source').first();
      const targetHandle = targetNode.locator('.react-flow__handle.target').first();

      await expect(sourceHandle).toBeVisible({ timeout: 10_000 });
      await expect(targetHandle).toBeVisible({ timeout: 10_000 });

      const sourceBox = await sourceHandle.boundingBox();
      const targetBox = await targetHandle.boundingBox();
      if (!sourceBox || !targetBox) {
        throw new Error('Unable to compute handle positions for connection');
      }
      await sourceHandle.hover({ force: true });
      await sourceHandle.dragTo(targetHandle, {
        force: true,
        sourcePosition: { x: sourceBox.width / 2, y: sourceBox.height / 2 },
        targetPosition: { x: targetBox.width / 2, y: targetBox.height / 2 },
      });
      await delay(200);
    }

    await connectHandles(identityNode, privKeyNode);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1, { timeout: 10_000 });

    await connectHandles(privKeyNode, hashNode);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2, { timeout: 10_000 });

    await connectHandles(hashNode, addressNode);
    await expect(page.locator('.react-flow__edge')).toHaveCount(3, { timeout: 10_000 });

    await page.addStyleTag({
      content: `
        .react-flow__node .flex.items-start.justify-between.gap-2.text-sm {
          pointer-events: auto !important;
        }
        .react-flow__node .mt-auto.border-t.border-border.pt-2 {
          pointer-events: auto !important;
        }
      `,
    });

    const { data } = await waitForBulkResponse(page, async () => {
      await setEditableValue(page, identityId, PRIVATE_KEY_HEX);
    });

    const nodeMap = toNodeMap(data?.nodes ?? []);

    expect(String(nodeMap[privKeyId]?.data?.result ?? '')).toBe(EXPECTED_PUBKEY);
    expect(String(nodeMap[hashId]?.data?.result ?? '')).toBe(EXPECTED_HASH160);
    expect(String(nodeMap[addressId]?.data?.result ?? '')).toBe(EXPECTED_ADDRESS);

    const privKeyResult = page
      .locator(`[data-id="${privKeyId}"] [data-testid="node-result"]`)
      .first();
    const hashResult = page
      .locator(`[data-id="${hashId}"] [data-testid="node-result"]`)
      .first();
    const addressResult = page
      .locator(`[data-id="${addressId}"] [data-testid="node-result"]`)
      .first();

    await expect(privKeyResult).toContainText(EXPECTED_PUBKEY);
    await expect(hashResult).toContainText(EXPECTED_HASH160);
    await expect(addressResult).toContainText(EXPECTED_ADDRESS);
  });
});
