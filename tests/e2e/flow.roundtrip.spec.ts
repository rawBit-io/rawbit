import { Buffer } from 'buffer';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

import { expect, test } from '@playwright/test';

import type { CalculationNodeData, FlowNode, RecalcResponse } from '@/types';
import {
  ensureNodeVisible,
  gotoEditor,
  repoRoot,
  setEditableValue,
  stringifySteps,
  toNodeMap,
  waitForSettledBulkResponse,
} from './utils';

type Scenario = {
  name: string;
  relativePath: string;
  nodeChanges: Record<string, string>;
  /** A deterministic downstream result that must change and restore. */
  anchorNode: string;
  scriptNode: string;
  /**
   * Committed-golden coverage (defaults to 'full': node results + script
   * trace). Only narrow this when the committed lesson data has demonstrably
   * drifted from what the current backend computes (document the drift next
   * to the flag) — never to paper over instability. The tweak/restore
   * roundtrip always runs regardless.
   *  - 'results-only': skip the scriptDebugSteps trace comparison but keep
   *    asserting every committed node result.
   *  - 'off': committed node results themselves have drifted.
   */
  goldenCheck?: 'full' | 'results-only' | 'off';
};

type CommittedFlow = {
  nodes?: FlowNode[];
} & Record<string, unknown>;

const API_BASE_URL =
  process.env.PLAYWRIGHT_API_URL ??
  process.env.VITE_API_BASE_URL ??
  'http://localhost:5007';

const FLOW_SCENARIOS: Scenario[] = [
  {
    name: 'hash-roundtrip',
    relativePath: path.join('tests', 'e2e', 'fixtures', 'hash-flow.json'),
    nodeChanges: {
      node_input: 'deadbeef',
    },
    anchorNode: 'node_hash',
    scriptNode: 'node_hash',
  },
  {
    // Always-visible lesson flow #0 (sidebar "Intro P2PKH").
    name: 'p0_Intro_P2PKH',
    relativePath: path.join('src', 'my_tx_flows', 'p0_Intro_P2PKH.json'),
    nodeChanges: {
      node_8QSOHj19: '3', // Version (2 → 3)
      node_IRajBmor: '390000', // Output Amount in satoshis (391000 → 390000)
    },
    anchorNode: 'node_24bD1CIj', // TXID → Reversed
    scriptNode: 'node_o6vul7a', // Verify Script (P2PKH spend)
  },
  {
    // Always-visible lesson flow #01 (sidebar "P2PK vs P2PKH"). Tx1 funds a
    // P2PK output that tx2 spends; tweaking the tx1 amount must ripple
    // through tx1's txid into tx2's input and final txid.
    name: 'p01_P2PK_vs_P2PKH',
    relativePath: path.join('src', 'my_tx_flows', 'p1_P2PK_vs_P2PKH.json'),
    nodeChanges: {
      node_Ty4ApQbe: '782000', // Tx1 Output Amount in satoshis (783000 → 782000)
      node_lIMPrHQG: '780000', // Tx2 Output Amount in satoshis (781000 → 780000)
    },
    anchorNode: 'node_1oB0mQPo', // TXID → Reversed of the P2PK-spending tx2
    scriptNode: 'node_NwoZ2skX', // Verify Script (P2PK spend, tx2)
  },
  {
    // Always-visible lesson flow #02 (sidebar "P2PKH Multi-Input Signing").
    // Both outputs feed the shared preimage, so each tweak re-signs both
    // inputs and moves the final txid.
    name: 'p2_P2PKH_multi_input_signing',
    relativePath: path.join('src', 'my_tx_flows', 'p2_P2PKH_multi_input_signing.json'),
    nodeChanges: {
      node_IRajBmor: '14000', // Output Amount out1 in satoshis (15000 → 14000)
      node_2gk6qS6e: '16000', // Output Amount out2 in satoshis (15000 → 16000)
    },
    anchorNode: 'node_24bD1CIj', // TXID → Reversed
    scriptNode: 'node_4fCFUxcV', // Verify Script IN2 (second input's P2PKH spend)
  },
  {
    // Always-visible lesson flow #03 (sidebar "Bare Multisig"). Tx1 funds a
    // bare P2MS output that tx2 spends; tweaking the tx1 amount ripples through
    // tx1's txid into tx2's input and final txid.
    name: 'p3_Bare_MultiSig',
    relativePath: path.join('src', 'my_tx_flows', 'p3_Bare_MultiSig.json'),
    nodeChanges: {
      node_Ty4ApQbe: '239000', // Tx1 Output Amount in satoshis (240000 → 239000)
      node_lIMPrHQG: '238000', // Tx2 Output Amount in satoshis (239000 → 238000)
    },
    anchorNode: 'node_1oB0mQPo', // TXID → Reversed of the multisig-spending tx2
    scriptNode: 'node_NwoZ2skX', // Verify Script (bare multisig spend, tx2)
  },
  {
    // Tx1 creates the P2SH inheritance output and tx2 spends its owner path.
    // Both amount tweaks must propagate through signing and final verification.
    name: 'p4_P2SH_and_Timelocks',
    relativePath: path.join('src', 'my_tx_flows', 'p4_P2SH_and_Timelocks.json'),
    nodeChanges: {
      node_Ty4ApQbe: '269000', // Tx1 P2SH output amount (270000 → 269000)
      node_lIMPrHQG: '268000', // Tx2 output amount (269000 → 268000)
    },
    anchorNode: 'node_1oB0mQPo', // TXID → Reversed of the P2SH-spending tx2
    scriptNode: 'node_3zppbme', // Verify Script (P2SH owner-path spend)
  },
  {
    // Always-visible lesson flow #04 (sidebar "P2SH Recovery with OP_RETURN").
    // Tx1 creates the P2SH inheritance output plus encrypted OP_RETURN data;
    // tx2 recovers the redeemScript and spends the P2SH output. Tweaking both
    // output amounts must ripple through setup txid, recovery preimage,
    // signature, final txid, and P2SH script verification.
    name: 'p5_P2SH_and_OP_Return',
    relativePath: path.join('src', 'my_tx_flows', 'p5_P2SH_and_OP_Return.json'),
    nodeChanges: {
      node_IRajBmor: '243000', // Setup tx P2SH output amount (244000 → 243000)
      node_r8VAbdiM: '239000', // Recovery tx output amount (240000 → 239000)
    },
    anchorNode: 'node_eNCddbzM', // TXID → Reversed of the P2SH recovery spend
    scriptNode: 'node_DL8WMoIO', // Verify Script (P2SH recovery spend)
  },
  {
    // The original and intentionally malleated forms share the same editable
    // transaction fields. Their txids change while both scripts remain valid.
    name: 'p6_TX_Malleability',
    relativePath: path.join('src', 'my_tx_flows', 'misc', 'p6_TX_Malleability.json'),
    nodeChanges: {
      node_8QSOHj19: '3', // Version (2 → 3)
      node_IRajBmor: '390000', // Output amount (391000 → 390000)
    },
    anchorNode: 'node_hHllb8tO', // TXID → Reversed of the malleated transaction
    scriptNode: 'node_nAES8iaN', // Verify Script (malleated transaction)
  },
  {
    // Tx1 locks the encoded payload in P2SH and tx2 spends it. Tweaking both
    // stages exercises the complete BIP110 lesson graph and script trace.
    name: 'p7_BIP110',
    relativePath: path.join('src', 'my_tx_flows', 'misc', 'p7_BIP110.json'),
    nodeChanges: {
      node_IRajBmor: '321000', // Tx1 P2SH output amount (322000 → 321000)
      node_r8VAbdiM: '239000', // Tx2 output amount (240000 → 239000)
    },
    anchorNode: 'node_eNCddbzM', // TXID → Reversed of the BIP110 spend
    scriptNode: 'node_DL8WMoIO', // Verify Script (BIP110 P2SH spend)
  },
  {
    // Alice's lock amount feeds her HTLC funding transaction and the final
    // owner-path spend, so the mutation must propagate across both stages.
    name: 'p8_Atomic_Swap_HTLC',
    relativePath: path.join(
      'src',
      'my_tx_flows',
      'p8_Atomic Swap (HTLC Coinswap).json',
    ),
    nodeChanges: {
      node_6WbInZF7: '329000', // Alice lock amount (330000 → 329000)
    },
    anchorNode: 'node_FyLqH8RG', // TXID → Reversed of Alice's final spend
    scriptNode: 'node_7pH1nqrt', // Verify Script (Alice's final HTLC spend)
  },
  {
    // Native P2WPKH has no final ID node in the lesson, so the fully
    // serialized SegWit transaction is the deterministic roundtrip anchor.
    name: 'p9_SegWit',
    relativePath: path.join('src', 'my_tx_flows', 'p9_SegWit.json'),
    nodeChanges: {
      node_IRajBmor: '202000', // Output amount (203000 → 202000)
    },
    anchorNode: 'node_3n8jjlu', // Final TX Template
    scriptNode: 'node_o6vul7a', // Verify Script (P2WPKH spend)
  },
  {
    // One output mutation re-signs both SegWit inputs. The second verifier is
    // the explicit anchor; the restore loop below compares both input traces.
    name: 'p10_SegWit_multi_input',
    relativePath: path.join('src', 'my_tx_flows', 'p10_SegWit_2in_1out.json'),
    nodeChanges: {
      node_IRajBmor: '16000', // Output amount (17000 → 16000)
    },
    anchorNode: 'node_3n8jjlu', // Final two-input TX Template
    scriptNode: 'node_jalS5Ad8', // Verify Script (input 2)
  },
  {
    // The final owner-path spend executes the P2WSH inheritance witnessScript.
    // Its output tweak changes the BIP143 signature and typed script trace.
    name: 'p11_SegWit_P2WSH',
    relativePath: path.join('src', 'my_tx_flows', 'p11_SegWit_P2SH.json'),
    nodeChanges: {
      node_WeIYSBbO: '328000', // Final output amount (329000 → 328000)
    },
    anchorNode: 'node_uAANwY52', // Final P2WSH-spending TX Template
    scriptNode: 'node_Duafb798', // Verify Script (P2WSH owner path)
  },
  {
    // Changing the final native output re-signs the nested P2SH-P2WPKH input.
    // Restoring it must reproduce the complete wrapped-SegWit validation trace.
    name: 'p12_Wrapped_SegWit_P2SH_P2WPKH',
    relativePath: path.join(
      'src',
      'my_tx_flows',
      'p12_SegWit_wrapped_tx_P2WPKH_in_P2SH.json',
    ),
    nodeChanges: {
      node_xHhk9cwK: '279000', // Final output amount (280000 → 279000)
    },
    anchorNode: 'node_QTnmHvk3', // Final wrapped-SegWit-spending TX Template
    scriptNode: 'node_wmDtkjI0', // Verify Script (P2SH-P2WPKH spend)
  },
  {
    name: 'p1_Intro_P2PKH_and_P2PK',
    relativePath: path.join('src', 'my_tx_flows', 'old', 'p1_Intro_P2PKH_and_P2PK.json'),
    nodeChanges: {
      node_8QSOHj19: '3',
      node_IRajBmor: '144900',
    },
    anchorNode: 'node_Jev5NWr0',
    scriptNode: 'node_xXU31KtR',
    // Drift: the committed scriptDebugSteps trace predates the current
    // backend trace format — it still has "amountUsed", names push opcodes
    // "unknown opcode" (now "PUSH N bytes"), and uses the old single
    // "usesWitness" flag (since split into usesWitness/witnessRulesEnabled).
    // All committed node results still reproduce exactly.
    goldenCheck: 'results-only',
  },
  {
    name: 'p13_Taproot_MultiSig',
    relativePath: path.join('src', 'my_tx_flows', 'old', 'p13_Taproot_MultiSig.json'),
    nodeChanges: {
      node_FZ9oWjOJ: '187000',
    },
    anchorNode: 'node_0d7XluIl',
    scriptNode: 'node_KfX3PTyG',
    // Drift: same legacy trace format as p1_Intro_P2PKH_and_P2PK above
    // (committed trace carries "amountUsed", "unknown opcode" names, and no
    // "witnessRulesEnabled"). Node results still reproduce exactly.
    goldenCheck: 'results-only',
  },
];

test.describe.configure({ mode: 'serial' });

// Chromium-only by design: these scenarios pin BACKEND calculation results,
// which browser engines cannot influence (cross-browser UI behavior is
// covered by the other specs). Running them per-engine triples the calc load
// against the shared backend, whose per-IP computation budget (10s of calc
// time per 60s window) makes concurrent full-graph recalcs starve each other
// and flake. See docu/flow-calc-regression-tests.md.
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'calc-regression goldens run on chromium only (engine-independent, budget-bound)',
);

test.describe('Flow roundtrip regression (E2E)', () => {
  let backendAvailable = false;

  test.beforeAll(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/healthz`, {
        signal: AbortSignal.timeout(3_000),
      });
      backendAvailable = res.ok;
    } catch {
      backendAvailable = false;
    }
  });

  test.beforeEach(() => {
    test.skip(
      !backendAvailable,
      `Real backend unreachable at ${API_BASE_URL}/healthz — calculation regression scenarios need it (start it with .myenv/bin/python backend/routes.py).`,
    );
  });

  for (const scenario of FLOW_SCENARIOS) {
    test(scenario.name, async ({ page }) => {
      test.setTimeout(120_000);

      await gotoEditor(page);

      const fileInput = page.locator('input[type="file"][accept=".json"]');
      await fileInput.waitFor({ state: 'attached' });

      const absolutePath = path.resolve(repoRoot, scenario.relativePath);
      const committedFlow = JSON.parse(readFileSync(absolutePath, 'utf8')) as CommittedFlow;

      // The committed lesson files persist dirty:false, so importing them
      // verbatim would not trigger any calculation. Import a copy with every
      // calc node marked dirty to force a FIRST FULL calculation of the whole
      // graph against the real backend.
      const dirtyFlow = markAllCalcNodesDirty(committedFlow);

      // The import can fire several /bulk_calculate rounds before the graph
      // settles (WebKit/Firefox especially); wait for the response that has
      // the full node set, no errors, and the anchor results computed.
      const committedCalcNodeCount = (committedFlow.nodes ?? []).filter(
        (node) => node?.data?.functionName,
      ).length;
      const requiredNodeIds = [
        scenario.anchorNode,
        scenario.scriptNode,
        ...Object.keys(scenario.nodeChanges),
      ];
      const isSettledFullGraph = (data: RecalcResponse) => {
        if (Array.isArray(data.errors) && data.errors.length > 0) return false;
        const nodes = data.nodes ?? [];
        if (nodes.length < committedCalcNodeCount) return false;
        const byId = toNodeMap(nodes);
        return requiredNodeIds.every((id) => byId[id] !== undefined) &&
          String(byId[scenario.anchorNode]?.data?.result ?? '') !== '';
      };

      const baselineResult = await waitForSettledBulkResponse(
        page,
        () =>
          fileInput.setInputFiles({
            name: path.basename(absolutePath),
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(dirtyFlow)),
          }),
        { timeoutMs: 120_000, isSettled: isSettledFullGraph },
      );
      const baseline = baselineResult.data;

      // Committed-golden gate: the published lesson results must be
      // reproducible by the current code before we start tweaking anything.
      assertCommittedGolden(scenario, committedFlow, baseline);

      const baselineMap = toNodeMap(baseline?.nodes);
      const originalAnchor = String(
        baselineMap[scenario.anchorNode]?.data?.result ?? '',
      );
      const originalScriptData = baselineMap[scenario.scriptNode]?.data ?? {};
      const originalScriptResult = String(originalScriptData.result ?? '');
      const originalScriptSteps = stringifySteps(originalScriptData.scriptDebugSteps);

      if (scenario.name === 'hash-roundtrip') {
        expect(originalAnchor).toBe(doubleSha256Hex('68656c6c6f'));
      }

      const originalInputs = new Map<string, string>();
      for (const [nodeId] of Object.entries(scenario.nodeChanges)) {
        originalInputs.set(nodeId, getInputValue(baselineMap[nodeId]?.data));
      }

      await ensureNodeVisible(page, scenario.anchorNode);
      const resultLocator = page
        .locator(`[data-id="${scenario.anchorNode}"] [data-testid="node-result"]`)
        .first();
      await expect(resultLocator).toBeVisible({ timeout: 10_000 });

      const isSettledForInput = (nodeId: string, expectedValue: string) =>
        (data: RecalcResponse) => {
          if (Array.isArray(data.errors) && data.errors.length > 0) return false;
          const byId = toNodeMap(data.nodes ?? []);
          if (getInputValue(byId[nodeId]?.data) !== expectedValue) return false;
          return String(byId[scenario.anchorNode]?.data?.result ?? '') !== '';
        };

      let latestResponse = baseline;
      for (const [nodeId, newValue] of Object.entries(scenario.nodeChanges)) {
        const result = await waitForSettledBulkResponse(
          page,
          () => setEditableValue(page, nodeId, newValue),
          { timeoutMs: 120_000, isSettled: isSettledForInput(nodeId, newValue) },
        );
        latestResponse = result.data;
      }

      const modifiedMap = toNodeMap(latestResponse?.nodes);
      const modifiedAnchor = String(
        modifiedMap[scenario.anchorNode]?.data?.result ?? '',
      );
      expect(modifiedAnchor).not.toBe(originalAnchor);

      const modifiedScriptData = modifiedMap[scenario.scriptNode]?.data ?? {};
      const modifiedScriptResult = String(modifiedScriptData.result ?? '');
      const modifiedScriptSteps = stringifySteps(modifiedScriptData.scriptDebugSteps);
      expect(
        modifiedScriptResult !== originalScriptResult ||
          modifiedScriptSteps !== originalScriptSteps,
      ).toBe(true);

      let finalResponse = latestResponse;
      for (const [nodeId, originalValue] of originalInputs) {
        const result = await waitForSettledBulkResponse(
          page,
          () => setEditableValue(page, nodeId, originalValue),
          { timeoutMs: 120_000, isSettled: isSettledForInput(nodeId, originalValue) },
        );
        finalResponse = result.data;
      }

      const finalMap = toNodeMap(finalResponse?.nodes);
      expect(String(finalMap[scenario.anchorNode]?.data?.result ?? '')).toBe(
        originalAnchor,
      );

      const finalScriptData = finalMap[scenario.scriptNode]?.data ?? {};
      expect(String(finalScriptData.result ?? '')).toBe(originalScriptResult);
      expect(stringifySteps(finalScriptData.scriptDebugSteps)).toBe(originalScriptSteps);

      // Every script_verification node's complete trace (steps incl. stack
      // states) must return to the baseline, not just the scenario's anchor.
      // Baseline and final both come from the current backend, so this holds
      // even for old lessons whose committed traces are stale.
      for (const [nodeId, node] of Object.entries(finalMap)) {
        if (node?.data?.functionName !== 'script_verification') continue;
        expect
          .soft(
            stringifySteps(node.data.scriptDebugSteps),
            `script trace for ${nodeId} did not return to baseline after restore`,
          )
          .toBe(stringifySteps(baselineMap[nodeId]?.data?.scriptDebugSteps));
      }
    });
  }
});

/**
 * Return a copy of the committed flow with every calc node (anything that
 * carries a functionName, i.e. calculation/opCode nodes) marked dirty so the
 * import triggers a full recalculation. Nodes with hasRegenerate (random
 * private keys) are intentionally included: the backend keeps their committed
 * result instead of regenerating, which keeps the lesson deterministic.
 */
function markAllCalcNodesDirty(flow: CommittedFlow): CommittedFlow {
  return {
    ...flow,
    nodes: (flow.nodes ?? []).map((node) =>
      node?.data?.functionName
        ? { ...node, data: { ...node.data, dirty: true } }
        : node,
    ),
  };
}

/**
 * Committed-golden assertion: after the first FULL calculation, every calc
 * node whose committed data.result in the lesson JSON is a non-empty string
 * must be reproduced exactly by the backend, and the committed
 * scriptDebugSteps trace (complete steps incl. stack states) of the
 * scenario's script node must match where the JSON carries one. This makes
 * the test fail when current code stops reproducing the published lesson,
 * not merely when a recalc is unstable.
 */
function assertCommittedGolden(
  scenario: Scenario,
  committedFlow: CommittedFlow,
  firstFullCalc: RecalcResponse | null,
) {
  const goldenCheck = scenario.goldenCheck ?? 'full';
  if (goldenCheck === 'off') return;

  const responseNodes = firstFullCalc?.nodes ?? [];
  expect(responseNodes.length, 'first full calculation returned no nodes').toBeGreaterThan(0);
  const responseMap = toNodeMap(responseNodes);

  const mismatches: Array<{ nodeId: string; committed: string; computed: string }> = [];
  let comparedCount = 0;

  for (const committedNode of committedFlow.nodes ?? []) {
    const committedData = committedNode?.data as Record<string, unknown> | undefined;
    if (!committedData?.functionName) continue;
    const committedResult = committedData.result;
    if (typeof committedResult !== 'string' || committedResult === '') continue;

    comparedCount += 1;
    const responseNode = responseMap[committedNode.id];
    if (!responseNode) {
      mismatches.push({
        nodeId: committedNode.id,
        committed: committedResult,
        computed: '<node missing from /bulk_calculate response>',
      });
      continue;
    }

    const computed = String(responseNode.data?.result ?? '');
    if (computed !== committedResult) {
      mismatches.push({ nodeId: committedNode.id, committed: committedResult, computed });
    }
  }

  expect(
    mismatches,
    `Recomputed results drifted from committed lesson goldens in ${scenario.relativePath} (${comparedCount} nodes compared)`,
  ).toEqual([]);

  if (goldenCheck === 'results-only') return;

  const committedSteps = (
    toNodeMap(committedFlow.nodes)[scenario.scriptNode]?.data as
      | Record<string, unknown>
      | undefined
  )?.scriptDebugSteps;
  if (committedSteps != null) {
    const responseSteps = responseMap[scenario.scriptNode]?.data?.scriptDebugSteps;
    expect(
      responseSteps,
      `script_verification debug trace for ${scenario.scriptNode} drifted from the committed lesson golden in ${scenario.relativePath}`,
    ).toEqual(committedSteps);
  }
}

function getInputValue(
  nodeData: CalculationNodeData | Record<string, unknown> | undefined
): string {
  if (!nodeData) return '';
  const inputs = nodeData.inputs as { val?: unknown; vals?: Record<string, string> } | undefined;
  if (typeof inputs?.val === 'string') return inputs.val;
  if (inputs?.vals && typeof inputs.vals === 'object') {
    const firstKey = Object.keys(inputs.vals)[0];
    if (firstKey !== undefined) return inputs.vals[firstKey];
  }
  return String(nodeData.value ?? '');
}

function doubleSha256Hex(hex: string) {
  const first = createHash('sha256').update(Buffer.from(hex, 'hex')).digest();
  return createHash('sha256').update(first).digest('hex');
}
