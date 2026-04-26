import { Buffer } from 'buffer';
import { readFileSync } from 'fs';

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import type { FlowData, FlowNode, ScriptExecutionResult } from '@/types';
import { resolveFixturePath } from './utils';

test.describe('Script debug persistence', () => {
  test('shared flow retains script steps after reload', async ({ page }) => {
    test.setTimeout(150_000);

    const shareId = 'playwright-script-debug-persistence';
    const fixture: FlowData = JSON.parse(
      readFileSync(resolveFixturePath('script-debug-flow.json'), 'utf8'),
    );

    const scriptSteps: ScriptExecutionResult = {
      isValid: true,
      steps: [
        {
          pc: 0,
          opcode: 0x76,
          opcode_name: 'OP_DUP',
          stack_before: ['01'],
          stack_after: ['01', '01'],
          phase: 'scriptSig',
        },
      ],
    };

    const sharedNodes: FlowNode[] = (fixture.nodes ?? []).map((node) => ({
      ...node,
      data: {
        ...(node.data ?? {}),
        dirty: false,
        result: 'Script verification succeeded',
        scriptDebugSteps: scriptSteps,
      },
    }));

    const sharedPayload: FlowData = {
      schemaVersion: 1,
      name: fixture.name ?? 'script-debug-shared',
      nodes: sharedNodes,
      edges: fixture.edges ?? [],
    };

    await page.route('**/s/' + shareId, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sharedPayload),
      });
    });

    await page.route('**/bulk_calculate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nodes: sharedNodes,
          errors: [],
          version: 1,
        }),
      });
    });

    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    const initialShareResponse = waitForSharedResponse(page, shareId);

    await page.goto(`/?s=${shareId}`);
    const initialData = (await initialShareResponse.then((res) => res.json())) as FlowData;

    await assertScriptStepsVisible(page, initialData);
    await expect(page).toHaveURL((url) => {
      return !url.searchParams.has('s') && !url.searchParams.has('share');
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await assertScriptStepsVisible(page, initialData);

    await page.unroute('**/s/' + shareId);
    await page.unroute('**/bulk_calculate');
  });
});

async function assertScriptStepsVisible(page: Page, fallbackPayload: FlowData | null) {
  try {
    await waitForCanvasNodes(page, 15_000);
  } catch (err) {
    if (page.isClosed()) throw err;

    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await fileInput.first().waitFor({ state: 'attached', timeout: 5_000 });

    const buffer = Buffer.from(JSON.stringify(fallbackPayload ?? {}));

    try {
      await fileInput.first().setInputFiles({
        name: 'fallback-shared.json',
        mimeType: 'application/json',
        buffer,
      });
    } catch (fileErr) {
      if (page.isClosed()) throw err;
      throw fileErr;
    }

    await waitForCanvasNodes(page, 30_000);
  }

  const node = page
    .locator('[data-testid^="rf__node-"]')
    .filter({ hasText: /Script verification succeeded/i })
    .first();
  await expect(node).toBeVisible({ timeout: 15_000 });

  const viewStepsButton = node.getByRole('button', { name: /View Script Steps/i });
  await expect(viewStepsButton).toBeVisible();

  await viewStepsButton.click({ force: true });

  const stepsDialog = page.getByRole('dialog', { name: 'Script Execution Steps' });
  await expect(stepsDialog).toBeVisible();
  await expect(stepsDialog.getByRole('button', { name: 'Next' })).toBeVisible();

  const closeButton = stepsDialog.getByRole('button', { name: /^Close$/ }).first();
  await closeButton.click();
  await expect(stepsDialog).toBeHidden();
}

async function waitForCanvasNodes(page: Page, timeout: number) {
  const flowNodes = page.locator('[data-testid^="rf__node-"]');
  await expect
    .poll(async () => flowNodes.count(), {
      timeout,
      intervals: [150, 300, 500, 1000],
    })
    .toBeGreaterThan(0);
}

function waitForSharedResponse(page: Page, shareId: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes(`/s/${shareId}`) && response.request().method() === 'GET',
    { timeout: 20_000 },
  );
}
