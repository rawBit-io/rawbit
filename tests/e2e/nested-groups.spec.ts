import { expect, test } from '@playwright/test';
import { loadFixture, gotoEditor } from './utils';

// Nested groups regression: outer ⊃ inner ⊃ x, y in outer,
// separate group "other" ⊃ z. Edge x→z must bundle at the OUTER boundary;
// edge y→x (inside the outer tree) must stay direct.
test('nested groups: load, bundle at outer boundary, group and ungroup groups', async ({ page }) => {
  test.setTimeout(90_000);
  await gotoEditor(page);
  await loadFixture(page, 'nested-groups.json');

  // All three groups + nested calc nodes render (parents-first ordering ok)
  const groups = page.locator('.react-flow__node-shadcnGroup');
  await expect(groups).toHaveCount(3);
  await expect(page.locator('[data-id="node_x"]')).toBeVisible();

  // Cross-tree edge bundles OUTER→OTHER (not inner→other)
  const bundle = page.locator(
    '.react-flow__edge[data-id="__group_bundle__:grp_outer->grp_other"]'
  );
  await expect(bundle).toHaveCount(1);
  // No bundle anchored at the inner group
  await expect(
    page.locator('.react-flow__edge[data-id*="grp_inner"]')
  ).toHaveCount(0);
  // In-tree edge stays direct
  await expect(
    page.locator('.react-flow__edge[data-id="e_up"]')
  ).toHaveCount(1);


  // --- Group two top-level groups into a new wrapper group -------------
  await page.getByTitle('Sidebar').click(); // collapse sidebar for clicks
  const outerHeader = page.locator('[data-id="grp_outer"] [data-testid="group-header"]');
  const otherHeader = page.locator('[data-id="grp_other"] [data-testid="group-header"]');
  // Group headers use Ctrl/Meta (not Shift) for additive selection
  await outerHeader.click();
  await otherHeader.click({ modifiers: ['ControlOrMeta'] });

  const groupButton = page.getByRole('button', { name: /^Group$/ });
  await expect(groupButton).toBeEnabled(); // was impossible before nesting
  await groupButton.click();

  await expect(groups).toHaveCount(4);
  // Outer and Other are now children of the wrapper — the outer→other bundle
  // is unchanged (same resolved endpoints).
  await expect(
    page.locator('.react-flow__edge[data-id="__group_bundle__:grp_outer->grp_other"]')
  ).toHaveCount(1);

  // Select the wrapper (title "Group Node") and ungroup → back to 3 groups,
  // children lift one level and survive.
  const wrapperHeader = page
    .locator('.react-flow__node-shadcnGroup [data-testid="group-header"]')
    .filter({ hasText: 'Group Node' });
  await wrapperHeader.click();
  await page.getByRole('button', { name: /^Ungroup$/ }).click();
  await expect(groups).toHaveCount(3);
  await expect(page.locator('[data-id="node_x"]')).toHaveCount(1);
});
