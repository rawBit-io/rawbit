import path from 'path';

import { test, expect } from '@playwright/test';

import { ensureNodeVisible, gotoEditor, repoRoot } from './utils';

// The published SegWit lesson: a native P2WPKH spend. The modal walks the
// trace P2SH-style — opcode steps only — while the panes carry short notes
// about the SegWit mechanics (empty scriptSig, witness as data, derived
// scriptCode). Validator bookkeeping steps in the trace are not walked.
test.describe('SegWit script execution steps', () => {
  test('walks the p9 P2WPKH trace as opcode steps with derivation notes', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    await gotoEditor(page);
    // Published lessons ship with committed results (goldens), so loading
    // them does not trigger a recalculation — set the file directly instead
    // of waiting for a /bulk_calculate roundtrip.
    const fileInput = page.locator('input[type="file"][accept=".json"]');
    await fileInput.waitFor({ state: 'attached' });
    await fileInput.setInputFiles(
      path.resolve(repoRoot, 'src', 'my_tx_flows', 'p9_SegWit.json'),
    );

    const verifyNode = await ensureNodeVisible(page, 'node_o6vul7a');
    const viewSteps = verifyNode.getByRole('button', {
      name: /View Script Steps/i,
    });
    await expect(viewSteps).toBeVisible({ timeout: 30_000 });
    await viewSteps.click({ force: true });

    const dialog = page.getByRole('dialog', { name: 'Script Execution Steps' });
    await expect(dialog).toBeVisible();

    // 7 opcode steps: OP_0 + PUSH 20 (scriptPubKey), then the 5 scriptCode
    // opcodes. Witness bookkeeping is explained in the panes, not stepped.
    await expect(
      dialog.getByText(/Step 1\/7 — Phase 2 \(scriptPubKey\)/i),
    ).toBeVisible();

    // The empty scriptSig stays visible with a short origin note.
    await expect(dialog.getByTestId('scriptSig-empty-pane')).toContainText(
      /unlocking data moved to the witness/i,
    );

    // The stack panels are visible without scrolling.
    await expect(
      dialog.getByText('Stack Before (top → first)'),
    ).toBeInViewport();

    // Serialized witness pane: data, not a script.
    await expect(dialog.getByTestId('witness-pane')).toContainText(
      /not a script/i,
    );

    // scriptCode pane carries its derivation note.
    await expect(dialog.getByTestId('scriptCode-script-pane')).toContainText(
      /never transmitted/i,
    );

    const next = dialog.getByRole('button', { name: 'Next' });

    // Step 2 (last old-rules step): the old-nodes verdict note.
    await next.click();
    await expect(
      dialog.getByText(/valid under their rules/i),
    ).toBeVisible();

    // Step 3: first opcode inside the derived scriptCode — the one-time
    // second-run note explains the fresh-stack jump exactly here.
    await next.click();
    await expect(dialog.getByText('Opcode:')).toBeVisible();
    await expect(
      dialog.getByText(/Step 3\/7 — Phase 4 \(scriptCode\)/i),
    ).toBeVisible();
    await expect(dialog.getByText('OP_DUP')).toBeVisible();
    await expect(
      dialog.getByText(/witness items become the new stack/i),
    ).toBeVisible();
    await expect(dialog.getByText(/valid under their rules/i)).toHaveCount(0);

    // ...and only there: both gone on the next step.
    await next.click();
    await expect(dialog.getByText(/witness items become the new stack/i)).toHaveCount(0);
    await expect(dialog.getByText(/valid under their rules/i)).toHaveCount(0);
    await next.click();

    // The trace ends on OP_CHECKSIG; no rule steps surface in the walk.
    for (let i = 0; i < 2; i += 1) {
      await next.click();
    }
    await expect(next).toBeDisabled();
    await expect(dialog.getByText(/Step 7\/7/i)).toBeVisible();
    await expect(dialog.getByText('OP_CHECKSIG')).toBeVisible();
    await expect(dialog.getByText('Rule:')).toHaveCount(0);
  });
});
