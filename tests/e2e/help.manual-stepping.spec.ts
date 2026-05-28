import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';

const CODE_ROUTE = /^http:\/\/(?:localhost|127\.0\.0\.1):5007\/code(?:\?.*)?$/;

test.describe('Help demo manual stepping', () => {
  test.beforeEach(async ({ page }) => {
    await stubHelpDemoApis(page);
    await page.goto('/');
    await page.getByTestId('help-button').click();
    await expect(page.getByTestId('help-menu')).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    await page.unroute('**/bulk_calculate');
    await page.unroute(CODE_ROUTE);
  });

  test('opens help panel without creating a Help tab until a demo starts', async ({ page }) => {
    await expect(page.getByRole('tab', { name: /Help/ })).toHaveCount(0);

    await playDemo(page, 'Drop, type & connect');

    await expect(page.getByRole('tab', { name: /Help/ })).toHaveCount(1);
  });

  test('steps the drop-and-connect demo forward and backward deterministically', async ({ page }) => {
    test.setTimeout(60_000);

    await playDemo(page, 'Drop, type & connect');
    await pauseDemo(page);

    await clickNextAndWait(page, 'Search the sidebar', '2 / 8');
    await expect(page.locator('[data-id="node_help_demo_tx_template"]')).toBeVisible();

    await clickNextAndWait(page, 'Drop the Input', '3 / 8');
    await expect(page.locator('[data-id="node_help_demo_varint"]')).toBeVisible();
    await expect(page.locator('[data-id="node_help_demo_input"]')).toBeVisible();
    await expectHelpDemoNodesNotToOverlap(page);

    await clickNextAndWait(page, 'Rename on the canvas', '4 / 8');
    await expect(page.locator('[data-id="node_help_demo_input"]')).toContainText('Input Count');

    await clickNextAndWait(page, 'Type a value', '5 / 8');
    await expect(page.locator('[data-id="node_help_demo_input"]')).toContainText('1');

    await clickNextAndWait(page, 'Connect ports', '6 / 8');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    await clickNextAndWait(page, 'Build the chain', '7 / 8');
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await expectHelpDemoNodesNotToOverlap(page);

    await clickPrevAndWait(page, 'Connect ports', '6 / 8');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  test('steps the show-code demo through dialog open and close', async ({ page }) => {
    test.setTimeout(60_000);

    await playDemo(page, 'Inspect node code');
    await pauseDemo(page);

    await clickNextAndWait(page, "Open Show Code", '2 / 5');
    await expect(page.locator('[data-id="node_help_demo_code_varint"]')).toBeVisible();
    await expect(page.getByRole('dialog', { name: /Python source/i })).toBeVisible();

    await clickNextAndWait(page, 'Read the source', '3 / 5', 8_000);
    await expect(page.getByRole('dialog', { name: /Python source/i })).toBeVisible();

    await clickNextAndWait(page, 'Close when done', '4 / 5');
    await expect(page.getByRole('dialog', { name: /Python source/i })).toHaveCount(0);

    await clickPrevAndWait(page, 'Read the source', '3 / 5', 8_000);
    await expect(page.getByRole('dialog', { name: /Python source/i })).toBeVisible();
  });

  test('resumes auto-play after pausing', async ({ page }) => {
    await playDemo(page, 'Drop, type & connect');
    await pauseDemo(page);

    await controlButton(page, 'Play').click();

    await expect(overlay(page)).toContainText('Search the sidebar', {
      timeout: 5_000,
    });
    await expect(overlay(page)).toContainText('2 / 8');
    await expect(controlButton(page, 'Pause')).toBeVisible();
  });

  test('searches for VarInt before dropping the inspect-code node', async ({ page }) => {
    await playDemo(page, 'Inspect node code');

    await expect(page.locator('#sidebar-search')).toHaveValue('var', {
      timeout: 3_000,
    });
    await expect(page.locator('[data-node-template-label]').first()).toHaveAttribute(
      'data-node-template-label',
      'Int → VarInt',
    );
    await expect(page.locator('[data-id="node_help_demo_code_varint"]')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('shows the Show Code click cue during autoplay', async ({ page }) => {
    test.setTimeout(60_000);

    await playDemo(page, 'Inspect node code');

    await expect(overlay(page)).toContainText('Open Show Code', {
      timeout: 8_000,
    });
    await expect(page.getByRole('menuitem', { name: 'Show Code' })).toBeVisible();
    await expect(page.locator('.rawbit-intro-click-ring')).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.locator('.rawbit-intro-click-ring')).toHaveCSS(
      'border-top-style',
      'dashed',
    );
    await expect(page.getByRole('dialog', { name: /Python source/i })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /Python source/i })).toBeVisible({
      timeout: 6_000,
    });
  });

  test('builds the P2PKH locking script demo graph', async ({ page }) => {
    test.setTimeout(100_000);

    await playDemo(page, 'Build P2PKH locking script');

    await expect(overlay(page)).toContainText('P2PKH locking script complete', {
      timeout: 90_000,
    });
    await expect(page.locator('[data-id^="node_help_demo_p2pkh_"]')).toHaveCount(7);
    await expect(page.locator('[data-id="node_help_demo_p2pkh_length"]')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(7);
    await expect(page.locator('[data-id="node_help_demo_p2pkh_prefix_ops"]')).toContainText(
      'OP_DUP',
    );
    await expect(page.locator('[data-id="node_help_demo_p2pkh_prefix_ops"]')).toContainText(
      'OP_HASH160',
    );
    await expect(page.locator('[data-id="node_help_demo_p2pkh_suffix_ops"]')).toContainText(
      'OP_EQUALVERIFY',
    );
    await expect(page.locator('[data-id="node_help_demo_p2pkh_suffix_ops"]')).toContainText(
      'OP_CHECKSIG',
    );
    await expect(page.locator('[data-id="node_help_demo_p2pkh_script"]')).toContainText(
      '76a914bfa89be8ec6dc6a06e38a43934fc764f9069ceed88ac',
    );
    await expectNodesNotToOverlap(page, [
      'node_help_demo_p2pkh_random',
      'node_help_demo_p2pkh_pubkey',
      'node_help_demo_p2pkh_hash160',
      'node_help_demo_p2pkh_push',
      'node_help_demo_p2pkh_prefix_ops',
      'node_help_demo_p2pkh_suffix_ops',
      'node_help_demo_p2pkh_script',
    ]);
  });

  test('walks the Verify Script execution steps demo', async ({ page }) => {
    test.setTimeout(120_000);

    await playDemo(page, 'Walk Verify Script steps');

    await expect(overlay(page)).toContainText('Verify Script walkthrough complete', {
      timeout: 60_000,
    });
    await expect(page.locator('[data-id="node_o6vul7a"]')).toContainText(
      'Verify Script',
    );
    const stepsDialog = page.getByRole('dialog', { name: 'Script Execution Steps' });
    await expect(stepsDialog).toHaveCount(0);
  });

  test('closes guided help when the Help button is clicked from help', async ({ page }) => {
    await playDemo(page, 'Drop, type & connect');
    await expect(controlButton(page, 'Pause')).toBeVisible();

    await page.getByTestId('help-button').click();

    await expect(page.getByRole('tab', { name: /Help/ })).toHaveCount(1);
    await expect(page.getByRole('tab', { name: /Help/ })).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByTestId('help-menu')).toHaveAttribute('aria-hidden', 'true');
    await expect(overlay(page)).toHaveCount(0);
    await expect(
      page.getByTestId('help-menu').getByRole('button', { name: 'Stop demo' }),
    ).toHaveCount(0);
  });

  test('closes guided help when another right panel opens', async ({ page }) => {
    await expect(page.getByTestId('help-menu')).toHaveAttribute('aria-hidden', 'false');

    await page.getByRole('button', { name: 'Search nodes' }).click();

    await expect(page.getByTestId('help-menu')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByTestId('search-panel')).toBeVisible();
  });

  test('preserves an edited Help tab by starting demos in a new Help tab', async ({ page }) => {
    test.setTimeout(60_000);

    await playDemo(page, 'Drop, type & connect');
    await pauseDemo(page);
    await dropSidebarNode(page, 'privkey', /PrivKey/i, { x: 520, y: 360 });

    await expect(page.getByTestId('help-menu')).toHaveAttribute('aria-hidden', 'false');
    await playDemo(page, 'Inspect node code');

    await expect(page.getByRole('tab', { name: /Help/ })).toHaveCount(2);
    await expect(page.locator('[data-id="node_help_demo_code_varint"]')).toBeVisible();
  });
});

async function playDemo(page: Page, title: string) {
  const card = page.getByTestId('help-menu').locator('li').filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Play demo' }).click();
  await expect(overlay(page)).toBeVisible();
  const firstStep =
    title === 'Inspect node code'
      ? 'Drop a VarInt node'
      : title === 'Build P2PKH locking script'
        ? 'Place the building blocks'
        : title === 'Walk Verify Script steps'
          ? 'Drop Intro P2PKH flow'
          : 'Drop a transaction template';
  await expect(overlay(page)).toContainText(firstStep);
}

async function pauseDemo(page: Page) {
  await expect(controlButton(page, 'Pause')).toBeVisible();
  await controlButton(page, 'Pause').click();
  await expect(controlButton(page, 'Play')).toBeVisible();
}

async function clickNextAndWait(
  page: Page,
  title: string,
  stepLabel: string,
  timeout = 7_000,
) {
  await controlButton(page, 'Next step').click();
  await expect(overlay(page)).toContainText(title);
  await expect(overlay(page)).toContainText(stepLabel);
  await expect(controlButton(page, 'Play')).toBeVisible({
    timeout,
  });
}

async function clickPrevAndWait(
  page: Page,
  title: string,
  stepLabel: string,
  timeout = 7_000,
) {
  await controlButton(page, 'Previous step').click();
  await expect(overlay(page)).toContainText(title);
  await expect(overlay(page)).toContainText(stepLabel);
  await expect(controlButton(page, 'Play')).toBeVisible({
    timeout,
  });
}

function overlay(page: Page) {
  return page.getByTestId('intro-drop-overlay');
}

function controlButton(page: Page, label: string) {
  return overlay(page).locator(`button[aria-label="${label}"]`);
}

async function expectHelpDemoNodesNotToOverlap(page: Page) {
  await expectNodesNotToOverlap(page, [
    'node_help_demo_tx_template',
    'node_help_demo_varint',
    'node_help_demo_input',
  ]);
}

async function expectNodesNotToOverlap(page: Page, ids: string[]) {
  const overlaps = await page.evaluate((nodeIds) => {
    const rects = nodeIds.map((id) => {
      const el = document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${id}"]`,
      );
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        id,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
    const hits: string[] = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (!a || !b) continue;
        const overlaps =
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top;
        if (overlaps) hits.push(`${a.id} overlaps ${b.id}`);
      }
    }
    return hits;
  }, ids);

  expect(overlaps).toEqual([]);
}

async function dropSidebarNode(
  page: Page,
  searchTerm: string,
  matcher: RegExp,
  position: { x: number; y: number },
) {
  const searchInput = page.getByPlaceholder('Search nodes...');
  await searchInput.fill(searchTerm);
  const tile = page.locator('[draggable="true"]').filter({ hasText: matcher }).first();
  await expect(tile).toBeVisible({ timeout: 10_000 });
  await tile.dragTo(page.locator('.react-flow__pane'), { targetPosition: position });
  await expect(page.locator('.react-flow__node').filter({ hasText: matcher })).toBeVisible();
}

async function stubHelpDemoApis(page: Page) {
  await page.route('**/bulk_calculate', async (route) => {
    let payload: { nodes?: unknown[]; version?: number } = {};
    try {
      payload = route.request().postDataJSON() as typeof payload;
    } catch {
      payload = {};
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
        errors: [],
        version: payload.version ?? 0,
      }),
    });
  });

  await page.route(CODE_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: [
          'def encode_varint(value: str) -> str:',
          '    n = int(value or "0")',
          '',
          '    if n < 0xfd:',
          '        return n.to_bytes(1, "little").hex()',
          '',
          '    if n <= 0xffff:',
          '        return "fd" + n.to_bytes(2, "little").hex()',
          '',
          '    return "fe" + n.to_bytes(4, "little").hex()',
        ].join('\n'),
      }),
    });
  });
}
