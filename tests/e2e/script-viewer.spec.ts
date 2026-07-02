import { test, expect } from '@playwright/test';

import { loadFixture } from './utils';

test.describe('Script Viewer node', () => {
  test('disassembles a connected script with real bytes; input-only, no output handle', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await loadFixture(page, 'script-viewer.json');

    const viewer = page.locator('[data-id="node_viewer"]').first();
    await viewer.waitFor({ state: 'visible', timeout: 20_000 });
    await viewer.scrollIntoViewIfNeeded();

    // Disassembly renders opcodes with IF/ELSE/ENDIF structure...
    await expect(viewer.getByText('OP_IF', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(viewer.getByText('OP_CHECKLOCKTIMEVERIFY')).toBeVisible();
    await expect(viewer.getByText('OP_ENDIF', { exact: true })).toBeVisible();

    // ...and shows the REAL pushed bytes, not placeholders. Match the exact
    // push values so we hit the disassembly line, not the raw-hex input field.
    await expect(viewer.getByText('a721316a', { exact: true })).toBeVisible();
    await expect(
      viewer.getByText(
        '073715db04e4cc83e479172ae563910c4b03066566bb9fd59d37ccc583738b54',
        { exact: true }
      )
    ).toBeVisible();

    // The push FORM is visible (minimal-push pedagogy)…
    await expect(viewer.getByText('PUSH(4)', { exact: true })).toBeVisible();
    await expect(viewer.getByText('PUSH(32)', { exact: true })).toBeVisible();
    // …and these minimal pushes carry no non-minimal marker.
    await expect(viewer.getByText(/non-minimal/)).toHaveCount(0);

    // No copy button anywhere in the viewer.
    await expect(viewer.getByTitle(/copy/i)).toHaveCount(0);

    // Exactly one handle (the left input); no output handle.
    await expect(viewer.locator('.react-flow__handle')).toHaveCount(1);

    // "Show Code" is available in the node menu.
    await viewer.locator('button').first().click();
    await expect(
      page.getByRole('menuitem', { name: /show code/i })
    ).toBeVisible();
  });
});
