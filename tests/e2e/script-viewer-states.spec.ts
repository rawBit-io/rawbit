import { test, expect } from '@playwright/test';

import { ensureNodeVisible, loadFixture } from './utils';

test.describe('Script Viewer UI states', () => {
  test('renders invalid, truncated, unbalanced, too-large, and upstream-error states', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    // The fixture deliberately contains a failing upstream node.
    await loadFixture(page, 'script-viewer-states.json', { allowErrors: true });

    // Invalid hex → parse error, raw value echoed.
    const invalid = await ensureNodeVisible(page, 'node_viewer_invalid');
    await expect(invalid.getByText(/Not valid hex/)).toBeVisible({
      timeout: 15_000,
    });

    // Truncated push → best-effort partial disassembly + error.
    const trunc = await ensureNodeVisible(page, 'node_viewer_trunc');
    await expect(trunc.getByText('OP_SHA256', { exact: true })).toBeVisible();
    await expect(trunc.getByText(/Truncated push/)).toBeVisible();

    // Unbalanced IF → amber warning, still ok.
    const unbal = await ensureNodeVisible(page, 'node_viewer_unbal');
    await expect(unbal.getByText('OP_IF', { exact: true })).toBeVisible();
    await expect(unbal.getByText(/missing OP_ENDIF/)).toBeVisible();

    // Over MAX_SCRIPT_SIZE → size-cap error, no freeze.
    const large = await ensureNodeVisible(page, 'node_viewer_large');
    await expect(large.getByText(/Script too large/)).toBeVisible();

    // Upstream node errored → banner instead of silent stale render.
    const uperr = await ensureNodeVisible(page, 'node_viewer_uperr');
    await expect(
      uperr.getByText(/Upstream node has an error/)
    ).toBeVisible();
  });
});
