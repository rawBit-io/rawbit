import { test, expect } from '@playwright/test';

import { loadFixture } from './utils';

test.describe('TX Parser node (parse_tx_field)', () => {
  test('extracts witness fields from a SegWit transaction', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    const { data } = await loadFixture(page, 'tx-parser.json');

    // Backend populated the dynamic outputs.
    const node = data?.nodes?.find((n) => n.id === 'node_parser');
    const values = (node?.data?.outputValues ?? {}) as Record<string, string>;
    expect(values['output-0']).toMatch(/^[0-9a-f]{64}$/); // txid
    expect(values['output-1']).toMatch(/^[0-9a-f]{64}$/); // wtxid
    expect(values['output-1']).not.toBe(values['output-0']); // segwit: differ
    expect(values['output-2']).toMatch(/^[0-9a-f]+$/); // witness wire hex
    // positional item addressing: item0 is contained in the wire hex
    expect(values['output-3'].length).toBeGreaterThan(0);
    expect(values['output-2']).toContain(values['output-3']);

    const parser = page.locator('[data-id="node_parser"]').first();
    await parser.waitFor({ state: 'visible', timeout: 20_000 });
    await parser.scrollIntoViewIfNeeded();

    // The EXTRACTED FIELDS panel renders the selected fields...
    await expect(parser.getByText('EXTRACTED FIELDS')).toBeVisible({
      timeout: 15_000,
    });
    await expect(parser.getByText('wtxid', { exact: true })).toBeVisible();
    await expect(
      parser.getByText('vin.witness', { exact: true })
    ).toBeVisible();
    await expect(
      parser.getByText('vin.witness.item0', { exact: true })
    ).toBeVisible();

    // ...with 2 input handles + 4 output handles.
    await expect(parser.locator('.react-flow__handle')).toHaveCount(6);
  });

  test('supports a manual custom field via the advanced dropdown', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await loadFixture(page, 'tx-parser.json');

    const parser = page.locator('[data-id="node_parser"]').first();
    await parser.waitFor({ state: 'visible', timeout: 20_000 });
    await expect(parser.getByText('EXTRACTED FIELDS')).toBeVisible({
      timeout: 15_000,
    });

    // Open the last field row's dropdown and switch it to "Custom…".
    await parser.getByRole('combobox').last().click();
    await page.getByRole('option', { name: /^Custom/ }).click();

    // A free-text input (no handle) appears; type a field the dropdown
    // doesn't enumerate.
    const custom = parser.locator(
      'input[placeholder="e.g. vin.scriptSig.item1"]'
    );
    await expect(custom).toBeVisible();
    await custom.fill('vin.witness_count');
    await custom.blur();

    // Backend resolves the manually-typed field.
    await expect(
      parser.getByText(/^\d+$/, { exact: true }).last()
    ).toBeVisible({ timeout: 15_000 });
  });
});
