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

  test('steps the drop-and-connect demo forward and backward deterministically', async ({ page }) => {
    test.setTimeout(60_000);

    await playDemo(page, 'Drop, type & connect');
    await pauseDemo(page);

    await clickNextAndWait(page, 'Search the sidebar', '2 / 8');
    await expect(page.locator('[data-id="node_help_demo_tx_template"]')).toBeVisible();

    await clickNextAndWait(page, 'Drop the Input', '3 / 8');
    await expect(page.locator('[data-id="node_help_demo_varint"]')).toBeVisible();
    await expect(page.locator('[data-id="node_help_demo_input"]')).toBeVisible();

    await clickNextAndWait(page, 'Rename on the canvas', '4 / 8');
    await expect(page.locator('[data-id="node_help_demo_input"]')).toContainText('Input Count');

    await clickNextAndWait(page, 'Type a value', '5 / 8');
    await expect(page.locator('[data-id="node_help_demo_input"]')).toContainText('1');

    await clickNextAndWait(page, 'Connect ports', '6 / 8');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    await clickNextAndWait(page, 'Build the chain', '7 / 8');
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);

    await clickPrevAndWait(page, 'Connect ports', '6 / 8');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  test('steps the show-code demo through dialog open and close', async ({ page }) => {
    test.setTimeout(60_000);

    await playDemo(page, 'Inspect node code');
    await pauseDemo(page);

    await clickNextAndWait(page, "Open the node's menu", '2 / 6');
    await expect(page.locator('[data-id="node_help_demo_sha256"]')).toBeVisible();

    await clickNextAndWait(page, 'Pick "Show Code"', '3 / 6');
    await expect(page.getByRole('dialog', { name: /Python source/i })).toBeVisible();

    await clickNextAndWait(page, 'Read the source', '4 / 6', 8_000);
    await expect(page.getByRole('dialog', { name: /Python source/i })).toBeVisible();

    await clickNextAndWait(page, 'Close when done', '5 / 6');
    await expect(page.getByRole('dialog', { name: /Python source/i })).toHaveCount(0);

    await clickPrevAndWait(page, 'Read the source', '4 / 6', 8_000);
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
});

async function playDemo(page: Page, title: string) {
  const card = page.getByTestId('help-menu').locator('li').filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Play demo' }).click();
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page)).toContainText(title === 'Inspect node code' ? 'Drop a hash node' : 'Drop a transaction template');
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
          'import hashlib',
          '',
          'def sha256_hex(value: str) -> str:',
          '    data = bytes.fromhex(value) if value else b""',
          '    return hashlib.sha256(data).hexdigest()',
        ].join('\n'),
      }),
    });
  });
}
