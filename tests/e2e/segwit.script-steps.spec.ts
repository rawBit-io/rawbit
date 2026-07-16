import path from 'path';

import { test, expect } from '@playwright/test';

import { ensureNodeVisible, gotoEditor, repoRoot } from './utils';

// The published SegWit lesson: a native P2WPKH spend. The modal walks the
// scriptPubKey opcodes, then the scriptCode-derivation rule, then the
// derived scriptCode opcodes. The pure bookkeeping steps (program match,
// witness item load) stay hidden and are explained by the panes instead.
test.describe('SegWit script execution steps', () => {
  test('walks the p9 P2WPKH trace: opcodes, the derivation rule, then the scriptCode', async ({
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

    // 8 walked steps: OP_0 + PUSH 20 (scriptPubKey), the scriptCode
    // derivation rule, then the 5 scriptCode opcodes. The program-match and
    // item-load bookkeeping is explained in the panes, not stepped.
    await expect(
      dialog.getByText(/Step 1\/8 — Phase 2 \(scriptPubKey\)/i),
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

    // Step 2 (last scriptPubKey step): the old-nodes verdict note.
    await next.click();
    await expect(
      dialog.getByText(/valid under their rules/i),
    ).toBeVisible();

    // Step 3: the scriptCode-derivation rule is now a walkable Rule step.
    await next.click();
    await expect(dialog.getByText('Rule:')).toBeVisible();
    await expect(
      dialog.getByText(/Derive scriptCode from the witness program/i),
    ).toBeVisible();
    await expect(dialog.getByText(/valid under their rules/i)).toHaveCount(0);

    // Step 4: first opcode inside the derived scriptCode — the one-time
    // second-run note explains the fresh-stack jump exactly here.
    await next.click();
    await expect(dialog.getByText('Opcode:')).toBeVisible();
    await expect(
      dialog.getByText(/Step 4\/8 — Phase 4 \(scriptCode\)/i),
    ).toBeVisible();
    await expect(dialog.getByText('OP_DUP')).toBeVisible();
    await expect(
      dialog.getByText(/witness items become the new stack/i),
    ).toBeVisible();

    // ...and only there: gone on the next step.
    await next.click();
    await expect(dialog.getByText(/witness items become the new stack/i)).toHaveCount(0);

    // The trace ends on OP_CHECKSIG.
    for (let i = 0; i < 3; i += 1) {
      await next.click();
    }
    await expect(next).toBeDisabled();
    await expect(dialog.getByText(/Step 8\/8/i)).toBeVisible();
    await expect(dialog.getByText('OP_CHECKSIG')).toBeVisible();
  });
});
