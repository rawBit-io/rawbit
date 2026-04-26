import { Buffer } from 'buffer';
import { readFileSync } from 'fs';

import type { Page, Route } from '@playwright/test';
import { expect, test } from '@playwright/test';

import type { CalculationNodeData, FlowData, FlowNode, ScriptExecutionResult } from '@/types';
import {
  doubleSha256Hex,
  parseBulkRequestPayload,
} from './fixtures';
import { gotoEditor, loadFixture, resolveFixturePath } from './utils';

const HASH_FLOW_DOWNLOAD_BASE = 'hash-flow';

test.describe('Clipboard and tabs workflows', () => {
  test('tab lifecycle resets viewport and updates tooltip', async ({ page }) => {
    test.setTimeout(60_000);

    await page.route('**/bulk_calculate', async (route) => {
      const { version, nodes } = readBulkPayload(route);
      const enrichedNodes = nodes.map((node) => ({
        ...node,
        data: {
          ...(node.data ?? {}),
          dirty: false,
          error: false,
          extendedError: undefined,
          result: node.data?.result ?? '',
        },
      }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nodes: enrichedNodes, errors: [], version }),
      });
    });

    const readViewport = async () => {
      return page.evaluate(() => {
        const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
        if (!viewport) return null;
        const style = window.getComputedStyle(viewport);
        const transform = style.transform || viewport.style.transform || '';
        if (!transform || transform === 'none') {
          return { x: 0, y: 0, zoom: 1 } as const;
        }
        if (transform.startsWith('matrix')) {
          const parts = transform
            .replace('matrix(', '')
            .replace(')', '')
            .split(',')
            .map((value) => parseFloat(value.trim()));
          const [a, , , d, e, f] = parts;
          return { x: e ?? 0, y: f ?? 0, zoom: a ?? d ?? 1 } as const;
        }
        const match = transform.match(/translate\(([-0-9.]+)px, ([-0-9.]+)px\) scale\(([-0-9.]+)\)/);
        if (match) {
          return {
            x: parseFloat(match[1] ?? '0'),
            y: parseFloat(match[2] ?? '0'),
            zoom: parseFloat(match[3] ?? '1'),
          } as const;
        }
        return { x: 0, y: 0, zoom: 1 } as const;
      });
    };

    await gotoEditor(page);
    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await fileInput.setInputFiles(resolveFixturePath('hash-flow.json'));
    await expect
      .poll(async () => page.locator('.react-flow__node').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const initialViewport = (await readViewport()) ?? { x: 0, y: 0, zoom: 1 };

    const pane = page.locator('.react-flow__pane');
    const box = await pane.boundingBox();
    if (!box) throw new Error('Flow pane not ready for panning');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 80, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const vp = await readViewport();
        if (!vp) return 0;
        return Math.abs(vp.x - initialViewport.x) + Math.abs(vp.y - initialViewport.y);
      })
      .toBeGreaterThan(5);

    const pannedViewport = (await readViewport()) ?? initialViewport;
    const panDistance =
      Math.abs(pannedViewport.x - initialViewport.x) +
      Math.abs(pannedViewport.y - initialViewport.y);

    await page.getByTitle('New tab').click();
    const flow2TabInitial = tabByIndex(page, 1);
    await expect(flow2TabInitial).toHaveAttribute('data-state', 'active');

    await expect.poll(async () => {
      const vp = await readViewport();
      if (!vp) return null;
      return {
        x: Math.round(vp.x),
        y: Math.round(vp.y),
        zoom: Number(vp.zoom.toFixed(2)),
      };
    }).toEqual({ x: 0, y: 0, zoom: 1 });

    const flow1Tab = tabByIndex(page, 0);
    await flow1Tab.click();
    await expect
      .poll(async () => {
        const vp = await readViewport();
        if (!vp) return Number.POSITIVE_INFINITY;
        return Math.abs(vp.x - pannedViewport.x) + Math.abs(vp.y - pannedViewport.y);
      })
      .toBeLessThan(Math.max(10, panDistance / 2));

    const restoredViewport = (await readViewport()) ?? initialViewport;
    const restoredDistance =
      Math.abs(restoredViewport.x - pannedViewport.x) +
      Math.abs(restoredViewport.y - pannedViewport.y);
    expect(restoredDistance).toBeLessThan(Math.max(10, panDistance / 2));

    await flow2TabInitial.click();
    await fileInput.evaluate((node: HTMLInputElement) => {
      node.value = '';
    });
    await fileInput.setInputFiles(resolveFixturePath('hash-flow.json'));
    await expect
      .poll(async () => page.locator('.react-flow__node').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const flow2Tab = tabByIndex(page, 1);
    await expect(flow2Tab).toHaveAttribute('data-state', 'active');
    await expect.poll(async () => (await flow2Tab.getAttribute('title')) ?? '').toMatch(/File:/);

    await page.reload();

    const flow2TabAfterReload = tabByIndex(page, 1);
    await expect(flow2TabAfterReload).toHaveAttribute('data-state', 'active');
    await expect.poll(async () => (await flow2TabAfterReload.getAttribute('title')) ?? '').toMatch(/File:/);

    await expect.poll(async () => {
      const vp = await readViewport();
      if (!vp) return null;
      return {
        x: Math.round(vp.x),
        y: Math.round(vp.y),
        zoom: Number(vp.zoom.toFixed(2)),
      };
    }).toEqual({ x: 0, y: 0, zoom: 1 });

    const closeFlow2 = flow2TabAfterReload.locator('span:has(svg)').first();
    await closeFlow2.click();
    const closeDialog = page.getByRole('dialog', { name: 'Close Tab' });
    await expect(closeDialog).toBeVisible();
    await closeDialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(flow2TabAfterReload).toHaveCount(0);
    await expect(page.locator('[role="tab"]')).toHaveCount(1);
    await expect(tabByIndex(page, 0)).toBeVisible();

    await page.unroute('**/bulk_calculate');
  });

  test('copy & paste retains script steps via toolbar and keyboard', async ({ page }) => {
    test.setTimeout(90_000);

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
        ...node.data,
        dirty: false,
        result: 'Script verification succeeded',
        scriptDebugSteps: scriptSteps,
      },
    }));

    const shareId = 'playwright-script-debug-copy';
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
      const { version, nodes } = readBulkPayload(route);
      const requestNodes = nodes.length ? nodes : sharedNodes;
      const enrichedNodes = requestNodes.map((node) => {
        const data = { ...(node.data ?? {}) } as CalculationNodeData & Record<string, unknown>;
        const isScriptNode = data.functionName === 'script_verification';
        return {
          ...node,
          data: {
            ...data,
            dirty: false,
            error: false,
            extendedError: undefined,
            result: data.result ?? 'Script verification succeeded',
            ...(isScriptNode ? { scriptDebugSteps: scriptSteps } : {}),
          },
        };
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nodes: enrichedNodes, errors: [], version }),
      });
    });

    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    const shareResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/s/${shareId}`) && response.request().method() === 'GET',
      { timeout: 15_000 },
    );

    await page.goto(`/?s=${shareId}`);
    const sharedData = (await shareResponse.then((resp) => resp.json())) as FlowData;
    expect(Array.isArray(sharedData?.nodes)).toBe(true);
    expect(sharedData.nodes.length).toBe(1);

    try {
      await page.waitForSelector('.react-flow__node', {
        state: 'attached',
        timeout: 15_000,
      });
    } catch {
      const fallbackJson = JSON.stringify(sharedData);
      const fileInput = page.locator('input[type="file"][accept=".json"]');
      await fileInput.setInputFiles({
        name: 'fallback-shared.json',
        mimeType: 'application/json',
        buffer: Buffer.from(fallbackJson),
      });
      await page.waitForSelector('.react-flow__node', {
        state: 'attached',
        timeout: 45_000,
      });
    }

    const scriptNode = page.locator('[data-id="node_script_verify"]');
    await expect(scriptNode).toBeVisible({ timeout: 15_000 });
    await clearSelection(page);

    const copyButton = page.getByRole('button', { name: 'Copy nodes (Ctrl/Cmd+C)' });
    const pasteButton = page.getByRole('button', { name: 'Paste nodes (Ctrl/Cmd+V)' });

    await expect(pasteButton).toBeDisabled();

    const node = page.locator('[data-id="node_script_verify"]');
    await expect(node).toBeVisible();
    await node.click({ position: { x: 16, y: 16 }, force: true });

    await expect(copyButton).toBeEnabled();
    await copyButton.click();
    await expect(pasteButton).toBeEnabled();

    const nodes = page.locator('.react-flow__node');
    const initialNodeCount = await nodes.count();
    expect(initialNodeCount).toBeGreaterThan(0);

    await page.mouse.move(450, 350);
    await pasteButton.click();
    await expect(nodes).toHaveCount(initialNodeCount + 1);

    const duplicated = nodes.nth(1);
    await duplicated.getByRole('button', { name: /View Script Steps/i }).click();
    const stepsDialog = page.getByRole('dialog', { name: 'Script Execution Steps' });
    await expect(stepsDialog).toBeVisible();
    await stepsDialog.getByRole('button', { name: /^Close$/ }).first().click();
    await expect(stepsDialog).toBeHidden();

    const isMac = await page.evaluate(() => /Mac|iPad|iPhone/.test(navigator.platform));
    await page.mouse.move(650, 320);
    await page.keyboard.press(`${isMac ? 'Meta' : 'Control'}+v`);
    await expect(nodes).toHaveCount(initialNodeCount + 2);

    await page.unroute('**/s/' + shareId);
    await page.unroute('**/bulk_calculate');
  });

  test('tabs preserve clipboard state and require explicit paste', async ({ page }) => {
    test.setTimeout(60_000);

    const fixture: FlowData = JSON.parse(readFileSync(resolveFixturePath('hash-flow.json'), 'utf8'));
    const initialInputNode = (fixture.nodes ?? []).find((node) => node.id === 'node_input');
    const initialInput = String(
      ((initialInputNode?.data as CalculationNodeData | undefined)?.inputs as { val?: unknown } | undefined)?.val ??
        '',
    );
    const baselineNodes: FlowNode[] = (fixture.nodes ?? []).map((node) => ({
      ...node,
      data: {
        ...(node.data ?? {}),
        dirty: false,
        result:
          node.id === 'node_hash'
            ? doubleSha256Hex(initialInput)
            : node.data?.result ?? '',
      },
    }));

    await page.route('**/bulk_calculate', async (route) => {
      const { version, nodes } = readBulkPayload(route);
      const enrichedNodes = nodes.map((node) => {
        const data = { ...(node.data ?? {}) } as CalculationNodeData & Record<string, unknown>;
        const hashInput = data.inputs?.val ?? initialInput;
        const result =
          data.result ??
          (data.functionName === 'double_sha256_hex'
            ? doubleSha256Hex(String(hashInput ?? ''))
            : data.value ?? data.inputs?.val ?? '');
        return {
          ...node,
          data: {
            ...data,
            dirty: false,
            error: false,
            extendedError: undefined,
            result,
          },
        };
      });

      const payload = enrichedNodes.length ? enrichedNodes : baselineNodes;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nodes: payload, errors: [], version }),
      });
    });

    await gotoEditor(page);
    await loadFixture(page, 'hash-flow.json');
    await clearSelection(page);

    const copyButton = page.getByRole('button', { name: 'Copy nodes (Ctrl/Cmd+C)' });
    const pasteButton = page.getByRole('button', { name: 'Paste nodes (Ctrl/Cmd+V)' });
    await expect(pasteButton).toBeDisabled();

    const inputNode = page.locator('[data-id="node_input"]');
    await inputNode.click();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(inputNode).toHaveClass(/selected/);

    await expect(copyButton).toBeEnabled();
    await copyButton.click();
    await expect(pasteButton).toBeEnabled();

    await page.getByTitle('New tab').click();
    const flow2Tab = tabByIndex(page, 1);
    await expect(flow2Tab).toHaveAttribute('data-state', 'active');

    const tabNodes = page.locator('.react-flow__node');
    await expect(tabNodes).toHaveCount(0);

    const isMac = await page.evaluate(() => /Mac|iPad|iPhone/.test(navigator.platform));
    await page.keyboard.press(`${isMac ? 'Meta' : 'Control'}+v`);
    await expect(tabNodes).toHaveCount(1);

    const activeClose = flow2Tab.locator('span:has(svg)').first();
    await activeClose.click();
    const closeDialog = page.getByRole('dialog', { name: 'Close Tab' });
    await expect(closeDialog).toBeVisible();
    await closeDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(closeDialog).toBeHidden();

    await activeClose.click();
    await closeDialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(flow2Tab).toHaveCount(0);

    const flow1Tab = tabByIndex(page, 0);
    await expect(flow1Tab).toBeVisible();
    const flow1Nodes = page.locator('.react-flow__node');
    await expect(flow1Nodes).toHaveCount(2);

    await flow1Tab.hover();
    const flow1Close = flow1Tab.locator('span:has(svg)').first();
    await expect(flow1Close).toBeVisible();
    await flow1Close.click();

    const infoDialog = page.getByRole('dialog', { name: 'Information' });
    await expect(infoDialog).toBeVisible();
    await expect(infoDialog).toContainText('Cannot close the last tab!');
    await infoDialog.getByRole('button', { name: 'OK' }).click();
    await expect(infoDialog).toBeHidden();
    await expect(flow1Tab).toBeVisible();

    await page.unroute('**/bulk_calculate');
  });

  test('simplified save prompts for selection and downloads subset', async ({ page }) => {
    test.setTimeout(60_000);

    const fixture: FlowData = JSON.parse(readFileSync(resolveFixturePath('hash-flow.json'), 'utf8'));
    const initialInputNode = (fixture.nodes ?? []).find((node) => node.id === 'node_input');
    const initialInput = String(
      ((initialInputNode?.data as CalculationNodeData | undefined)?.inputs as { val?: unknown } | undefined)?.val ??
        '',
    );
    const baselineNodes: FlowNode[] = (fixture.nodes ?? []).map((node) => ({
      ...node,
      data: {
        ...(node.data ?? {}),
        dirty: false,
        result:
          node.id === 'node_hash'
            ? doubleSha256Hex(initialInput)
            : node.data?.result ?? '',
      },
    }));

    await page.route('**/bulk_calculate', async (route) => {
      const { version, nodes } = readBulkPayload(route);
      const payload = nodes.length ? nodes : baselineNodes;

      const enrichedNodes = payload.map((node) => ({
        ...node,
        data: {
          ...(node.data ?? {}),
          dirty: false,
          error: false,
        },
      }));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ nodes: enrichedNodes, errors: [], version }),
      });
    });

    await gotoEditor(page);
    await loadFixture(page, 'hash-flow.json');
    await clearSelection(page);

    const inputNode = page.locator('[data-id="node_input"]');
    await inputNode.click();

    const saveButton = page.getByTitle('Save (hold S for simplified)');
    await expect(saveButton).toBeEnabled();

    await page.keyboard.down('s');
    await saveButton.click();
    await page.keyboard.up('s');

    if ((await page.locator('[role="dialog"]').count()) === 0) {
      await page.keyboard.down('s');
      await saveButton.click();
      await page.keyboard.up('s');
    }

    const saveDialog = page.getByRole('dialog', { name: 'Save Simplified Flow' });
    await expect(saveDialog).toBeVisible({ timeout: 10_000 });
    await expect(saveDialog).toContainText('Save only the 1/2 selected nodes?');

    const downloadPromise = page.waitForEvent('download');
    await saveDialog.getByRole('button', { name: 'Save' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `${HASH_FLOW_DOWNLOAD_BASE} - simplified selection.json`,
    );
    await expect(saveDialog).toBeHidden();

    await page.unroute('**/bulk_calculate');
  });
});

const readBulkPayload = (route: Route) => {
  let payload: unknown;
  try {
    payload = route.request().postDataJSON();
  } catch {
    payload = undefined;
  }
  return parseBulkRequestPayload(payload);
};

async function clearSelection(page: Page) {
  const pane = page.locator('.react-flow__pane');
  if (await pane.count()) {
    const box = await pane.boundingBox();
    if (!box) return;
    const xOffset = box.width > 48 ? box.width - 24 : box.width / 2;
    const yOffset =
      box.height > 104
        ? Math.min(Math.max(80, box.height / 2), box.height - 24)
        : box.height / 2;
    const x = box.x + xOffset;
    const y = box.y + yOffset;
    await page.mouse.click(x, y);
  }
}

function tabByIndex(page: Page, index: number) {
  return page.locator('[role="tab"]').nth(index);
}
