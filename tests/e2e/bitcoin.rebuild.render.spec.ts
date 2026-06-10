import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Real generated flows (tools/generate_e2e_rebuild_fixtures.py): a signing
// rebuild, a 4-input mainnet wire rebuild, and a P2SH-multisig partial-signing
// rebuild. Each must open in a new tab, render every node, and lay out without
// node overlaps.
const FIXTURES = [
  'rebuilt_flow_sign_p2pkh',
  'rebuilt_flow_wire_4in',
  'rebuilt_flow_p2sh_ms_sign',
] as const;

interface RebuiltFlowFixture {
  flow: { nodes: Array<{ id: string }>; edges: unknown[] };
  txid: string;
}

function loadFixture(name: string): RebuiltFlowFixture {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf-8'));
}

test.describe('Rebuilt-flow rendering', () => {
  for (const name of FIXTURES) {
    test(`${name} renders all nodes without overlap`, async ({ page }) => {
      const { flow, txid } = loadFixture(name);

      await page.route('**/bitcoin/status', (route) =>
        route.fulfill({ json: { connected: true, chain: 'regtest', blocks: 101 } }),
      );
      await page.route('**/bitcoin/rebuild', (route) =>
        route.fulfill({ json: { flow, txid } }),
      );

      await page.goto('/');
      await expect(page.locator('.react-flow')).toBeVisible();

      await page.getByTitle('Bitcoin Core CLI').click();
      await page.getByTestId('bitcoin-rebuild-input').fill(txid);
      await page.getByTestId('bitcoin-rebuild-button').click();

      await expect(
        page.locator('.app-tab-title', { hasText: 'Rebuild' }),
      ).toBeVisible();
      // the shipped viewport must land on the info card
      await expect(
        page.locator('.react-flow__node', { hasText: 'Rebuilt transaction' }),
      ).toBeVisible();
      await page.waitForTimeout(900); // let the viewport restore settle

      // Zoom out until the whole flow is in the DOM (the canvas culls
      // off-viewport nodes), then verify the layout.
      const zoomOut = page.locator('.react-flow__controls-zoomout');
      for (let step = 0; step < 30; step++) {
        const count = await page.locator('.react-flow__node').count();
        if (count >= flow.nodes.length) break;
        await zoomOut.click();
      }
      await expect(page.locator('.react-flow__node')).toHaveCount(
        flow.nodes.length,
      );

      // No two nodes may overlap (small tolerance for border rounding).
      const boxes = await page.$$eval('.react-flow__node', (nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, id: n.getAttribute('data-id') };
        }),
      );
      const overlaps: string[] = [];
      const TOL = 2;
      for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
          const A = boxes[a];
          const B = boxes[b];
          const xOverlap =
            Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) - TOL;
          const yOverlap =
            Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) - TOL;
          if (xOverlap > 0 && yOverlap > 0) {
            overlaps.push(
              `${A.id}(${A.x.toFixed(0)},${A.y.toFixed(0)} ${A.w.toFixed(0)}x${A.h.toFixed(0)}) <-> ` +
                `${B.id}(${B.x.toFixed(0)},${B.y.toFixed(0)} ${B.w.toFixed(0)}x${B.h.toFixed(0)})`,
            );
          }
        }
      }
      expect(overlaps, `overlapping nodes: ${overlaps.join(', ')}`).toEqual([]);

      await page.screenshot({
        path: `test-results/rebuild-render-${name}.png`,
        fullPage: false,
      });
    });
  }
});
