import { readFileSync } from 'fs';
import path from 'path';
import { Buffer } from 'buffer';

import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';
import type { Edge } from '@xyflow/react';
import type { CalculationNodeData, FlowData, FlowNode, InputStructure } from '@/types';
import { computeNodeResult, enrichNodesForSuccess, parseBulkRequestPayload } from './fixtures';
import { gotoEditor, repoRoot } from './utils';

const NODES = {
  randomPrivateKey: 'node_CWfi6O88',
  signLowR: 'node_b1GSXfdE',
  privateKeyToPubKey: 'node_yf0EwOn6',
  finalRawTransaction: 'node_qMmh8Zrk',
  textInfo: 'node_dgaldLHe',
  addedHash160: 'node_e2e_hash160_experiment',
  addedTxExtract: 'node_e2e_next_tx_extract',
  addedLegacySource: 'node_e2e_legacy_template_source',
  addedLegacyTarget: 'node_e2e_legacy_template_target',
  addedGeneralTemplate: 'node_e2e_general_template',
} as const;

const EDGES = {
  randomToSignPrivateKey: 'edge_v4UKc1K7',
} as const;

type ExportedFlowData = FlowData & Record<string, unknown>;
type NodeKind =
  | 'hash160'
  | 'txFieldExtract'
  | 'legacyTemplate'
  | 'generalTemplate';
type Point = { x: number; y: number };

const TEST_POSITIONS: Partial<Record<string, Point>> = {
  [NODES.signLowR]: { x: 420, y: 180 },
  [NODES.randomPrivateKey]: { x: 780, y: 180 },
  [NODES.privateKeyToPubKey]: { x: 420, y: 520 },
  [NODES.addedHash160]: { x: 780, y: 520 },
  [NODES.finalRawTransaction]: { x: 420, y: 880 },
  [NODES.addedTxExtract]: { x: 780, y: 880 },
  [NODES.textInfo]: { x: 1120, y: 880 },
  [NODES.addedLegacySource]: { x: 420, y: 1500 },
  [NODES.addedLegacyTarget]: { x: 860, y: 1500 },
  [NODES.addedGeneralTemplate]: { x: 1300, y: 1500 },
};

const introFlow = JSON.parse(
  readFileSync(path.join(repoRoot, 'src/my_tx_flows/p0_Intro_P2PKH.json'), 'utf8'),
) as ExportedFlowData;

async function stubBulkCalculateWithDefaults(page: Page) {
  await page.route('**/bulk_calculate', async (route) => {
    let payload: unknown;
    try {
      payload = route.request().postDataJSON();
    } catch {
      payload = undefined;
    }

    const { version, nodes } = parseBulkRequestPayload(payload);
    const enrichedNodes = enrichNodesForSuccess(nodes, computeNodeResult);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nodes: enrichedNodes, errors: [], version }),
    });
  });
}

async function uploadFlowData(page: Page, data: unknown, fileName: string) {
  const fileInput = page.locator('input[type="file"][accept=".json"]');
  await fileInput.waitFor({ state: 'attached' });
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });

  await expect(
    page.getByRole('tab', { name: fileName.replace(/\.json$/u, '') }),
  ).toBeVisible();
  await expect(page.locator(`[data-id="${NODES.addedGeneralTemplate}"]`)).toHaveCount(1);
}

const legacyTemplateInputStructure: InputStructure = {
  ungrouped: [
    { index: 0, label: 'VERSION[4]:', rows: 1 },
    { index: 10, label: 'INPUT_COUNT (VarInt):', rows: 1, small: true },
  ],
  groups: [
    {
      title: 'INPUTS[]',
      baseIndex: 1000,
      expandable: true,
      fieldCountToAdd: 5,
      minInstances: 1,
      maxInstances: 10,
      fields: [
        { index: 0, label: 'TXID[32]:', rows: 2 },
        { index: 10, label: 'VOUT[4]:', rows: 1 },
        { index: 20, label: 'SCRIPT_LENGTH (VarInt):', rows: 1 },
        { index: 30, label: 'SCRIPT_SIG[]:', rows: 3 },
        { index: 40, label: 'SEQUENCE[4]:', rows: 1 },
      ],
    },
    {
      title: 'OUTPUTS[]',
      baseIndex: 3000,
      expandable: true,
      fieldCountToAdd: 3,
      minInstances: 1,
      maxInstances: 10,
      fields: [
        { index: 0, label: 'AMOUNT[8]:', rows: 1 },
        { index: 10, label: 'SCRIPT_PUBKEY_LENGTH:', rows: 1, small: true },
        { index: 20, label: 'SCRIPT_PUBKEY[]:', rows: 3 },
      ],
    },
  ],
  betweenGroups: {
    'INPUTS[]': [
      { index: 2000, label: 'OUTPUT_COUNT (VarInt):', rows: 1, small: true },
    ],
  },
  afterGroups: [{ index: 4000, label: 'LOCKTIME[4]:', rows: 1 }],
};

const generalTemplateInputStructure: InputStructure = {
  ungrouped: [
    { index: 0, label: 'VERSION[4]:', rows: 1 },
    { index: 10, label: 'MARKER[1]:', rows: 1, small: true },
    { index: 20, label: 'FLAG[1]:', rows: 1, small: true },
    { index: 30, label: 'INPUT_COUNT (VarInt):', rows: 1, small: true },
  ],
  groups: [
    {
      title: 'INPUTS[]',
      baseIndex: 1000,
      expandable: true,
      fieldCountToAdd: 5,
      minInstances: 1,
      maxInstances: 10,
      fields: [
        { index: 0, label: 'TXID[32]:', rows: 2 },
        { index: 10, label: 'VOUT[4]:', rows: 1 },
        { index: 20, label: 'SCRIPT_LENGTH (VarInt):', rows: 1 },
        { index: 30, label: 'SCRIPT_SIG[]:', rows: 2 },
        { index: 40, label: 'SEQUENCE[4]:', rows: 1 },
      ],
    },
    {
      title: 'OUTPUTS[]',
      baseIndex: 3000,
      expandable: true,
      fieldCountToAdd: 3,
      minInstances: 1,
      maxInstances: 10,
      fields: [
        { index: 0, label: 'AMOUNT[8]:', rows: 1 },
        { index: 10, label: 'SCRIPT_PUBKEY_LENGTH:', rows: 1, small: true },
        { index: 20, label: 'SCRIPT_PUBKEY[]:', rows: 2 },
      ],
    },
    {
      title: 'WITNESSES[]',
      baseIndex: 5000,
      expandable: true,
      fieldCountToAdd: 1,
      minInstances: 1,
      maxInstances: 10,
      fields: [{ index: 0, label: 'WITNESS_DATA[]:', rows: 3 }],
    },
  ],
  betweenGroups: {
    'INPUTS[]': [
      { index: 2000, label: 'OUTPUT_COUNT (VarInt):', rows: 1, small: true },
    ],
  },
  afterGroups: [{ index: 6000, label: 'LOCKTIME[4]:', rows: 1 }],
};

function nodeData(kind: NodeKind, title: string): CalculationNodeData {
  if (kind === 'hash160') {
    return {
      functionName: 'hash160_hex',
      title,
      paramExtraction: 'single_val',
      numInputs: 1,
      inputs: { val: '' },
      result: '',
      inputStructure: {
        ungrouped: [{ index: 0, label: 'INPUT HEX:', rows: 2 }],
      },
      groupInstances: {},
    };
  }

  if (kind === 'txFieldExtract') {
    return {
      functionName: 'extract_tx_field',
      title,
      paramExtraction: 'multi_val',
      numInputs: 2,
      result: '',
      inputs: { vals: ['', '0'] },
      inputStructure: {
        ungrouped: [
          { index: 0, label: 'Raw TX (hex):', rows: 3 },
          { index: 1, label: 'VIN/VOUT Index:', rows: 1 },
        ],
      },
      groupInstances: {},
    };
  }

  if (kind === 'legacyTemplate') {
    return {
      functionName: 'concat_all',
      title,
      paramExtraction: 'multi_val',
      numInputs: 12,
      inputs: { vals: [] },
      version: 0,
      result: '',
      inputStructure: legacyTemplateInputStructure,
      groupInstances: { 'INPUTS[]': 1, 'OUTPUTS[]': 1 },
      groupInstanceKeys: { 'INPUTS[]': [1000], 'OUTPUTS[]': [3000] },
      baseHeight: 120,
    };
  }

  return {
    functionName: 'concat_all',
    title,
    paramExtraction: 'multi_val',
    numInputs: 15,
    inputs: { vals: [] },
    version: 0,
    result: '',
    inputStructure: generalTemplateInputStructure,
    groupInstances: {
      'INPUTS[]': 1,
      'OUTPUTS[]': 1,
      'WITNESSES[]': 1,
    },
    groupInstanceKeys: {
      'INPUTS[]': [1000],
      'OUTPUTS[]': [3000],
      'WITNESSES[]': [5000],
    },
    baseHeight: 150,
  };
}

function templateNode(
  kind: NodeKind,
  id: string,
  title: string,
  position: { x: number; y: number },
): FlowNode {
  return {
    id,
    type: 'calculation',
    position,
    data: nodeData(kind, title),
    selected: false,
  } as FlowNode;
}

function edge(
  id: string,
  source: string,
  target: string,
  targetHandle: string,
  sourceHandle?: string,
): Edge {
  return {
    id,
    source,
    target,
    targetHandle,
    ...(sourceHandle ? { sourceHandle } : {}),
    selected: false,
  };
}

function buildIntroPlaygroundFlow(): ExportedFlowData {
  const flow = structuredClone(introFlow) as ExportedFlowData;
  const nodes = flow.nodes as FlowNode[];
  const edges = flow.edges as Edge[];
  const addedNodes: FlowNode[] = [
    templateNode(
      'hash160',
      NODES.addedHash160,
      'Added HASH160 Experiment',
      TEST_POSITIONS[NODES.addedHash160]!,
    ),
    templateNode('txFieldExtract', NODES.addedTxExtract, 'Added TX Field Extract', {
      ...TEST_POSITIONS[NODES.addedTxExtract]!,
    }),
    templateNode('legacyTemplate', NODES.addedLegacySource, 'Added Legacy TX Template Source', {
      ...TEST_POSITIONS[NODES.addedLegacySource]!,
    }),
    templateNode('legacyTemplate', NODES.addedLegacyTarget, 'Added Legacy TX Template Target', {
      ...TEST_POSITIONS[NODES.addedLegacyTarget]!,
    }),
    templateNode('generalTemplate', NODES.addedGeneralTemplate, 'Added General TX Template', {
      ...TEST_POSITIONS[NODES.addedGeneralTemplate]!,
    }),
  ];
  const addedEdges: Edge[] = [
    edge(
      'edge_e2e_version_to_legacy_source',
      'node_8QSOHj19',
      NODES.addedLegacySource,
      'input-0',
    ),
    edge(
      'edge_e2e_input_count_to_legacy_source',
      'node_1AL3tCpN',
      NODES.addedLegacySource,
      'input-10',
    ),
  ];

  flow.nodes = [
    ...nodes.map<FlowNode>((node, index) => {
      const position =
        TEST_POSITIONS[node.id] ??
        (node.type === 'shadcnTextInfo' ? { x: -9000, y: index * 180 } : undefined);
      const next: FlowNode = {
        ...node,
        ...(position ? { position } : {}),
        selected: false,
      };

      if (node.id === NODES.textInfo) {
        next.data = {
          ...next.data,
          content: 'Text info node used by connection-action E2E coverage.',
          fontSize: 20,
          width: 260,
          height: 140,
        };
      }

      if (position) {
        delete next.parentId;
        delete next.extent;
      }

      return next;
    }),
    ...addedNodes,
  ];

  flow.edges = [
    ...edges
      .filter((candidate) => candidate.id !== EDGES.randomToSignPrivateKey)
      .map<Edge>((candidate) => ({ ...candidate, selected: false })),
    ...addedEdges,
  ];

  return flow;
}

async function clearSelection(page: Page) {
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__pane').click({
    position: { x: 24, y: 24 },
    force: true,
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
}

async function focusNode(page: Page, nodeId: string) {
  const closeSearch = page.getByTitle('Close search');
  if (await closeSearch.isVisible()) {
    await closeSearch.click();
  }

  await page.getByTitle('Search nodes').click();
  const searchInput = page.getByPlaceholder('Search node id, name, text');
  await expect(searchInput).toBeVisible();
  await searchInput.fill(nodeId);

  const resultRow = page
    .getByTestId('search-panel')
    .locator('div[role="button"]')
    .filter({ hasText: nodeId })
    .first();
  await expect(resultRow).toBeVisible();
  await resultRow.click();

  const closeButton = page.getByTitle('Close search');
  if (await closeButton.isVisible()) {
    await closeButton.click();
  }

  const node = page.locator(`[data-id="${nodeId}"]`).first();
  await expect(node).toBeVisible();
  await expect(node).toBeInViewport({ ratio: 0.1 });
  return node;
}

async function clickVisibleNode(
  page: Page,
  nodeId: string,
  modifiers: ('Shift' | 'ControlOrMeta')[] = [],
) {
  const node = page.locator(`[data-id="${nodeId}"]`).first();
  await expect(node).toBeVisible();
  await expect(node).toBeInViewport({ ratio: 0.1 });
  const box = await node.boundingBox();
  if (!box) {
    throw new Error(`Unable to compute node bounds for ${nodeId}`);
  }

  await node.click({
    position: { x: Math.min(120, box.width / 2), y: 20 },
    modifiers: modifiers.includes('ControlOrMeta') ? ['Meta'] : undefined,
    force: true,
  });
}

async function selectPair(page: Page, firstNodeId: string, secondNodeId: string) {
  await clearSelection(page);
  await focusNode(page, firstNodeId);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
  await clickVisibleNode(page, secondNodeId, ['ControlOrMeta']);
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  const selectedIds = await page.locator('.react-flow__node.selected').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-id')).filter(Boolean),
  );
  expect(selectedIds.sort()).toEqual([firstNodeId, secondNodeId].sort());
}

function connectToolbarButton(page: Page) {
  return page.getByRole('button', {
    name: 'Connect nodes / copy inputs (select 2 nodes)',
  });
}

function wiringTitle(page: Page) {
  return page.getByRole('heading', { name: 'Wiring Studio' });
}

function wiringDialog(page: Page) {
  return page.locator('[role="dialog"]').filter({ hasText: 'Wiring Studio' }).last();
}

async function openWiringStudio(page: Page) {
  const button = connectToolbarButton(page);
  await expect(button).toBeEnabled({ timeout: 10_000 });
  await button.click();
  await expect(wiringTitle(page)).toBeVisible();
}

async function expectDirection(page: Page, sourceLabel: string, targetLabel: string) {
  const dialog = wiringDialog(page);
  const sourceBlock = dialog
    .locator('div.text-sm.text-center')
    .filter({ hasText: 'Source' })
    .first();
  const targetBlock = dialog
    .locator('div.text-sm.text-center')
    .filter({ hasText: 'Target' })
    .first();

  await expect(sourceBlock).toContainText(sourceLabel);
  await expect(targetBlock).toContainText(targetLabel);
}

async function expectModes(page: Page, modes: { connect: boolean; copy: boolean }) {
  const dialog = wiringDialog(page);
  const connectMode = dialog.getByRole('button', { name: /^Connect Edge$/ });
  const copyMode = dialog.getByRole('button', { name: /^Copy Inputs$/ });

  if (modes.connect) {
    await expect(connectMode).toBeVisible();
  } else {
    await expect(connectMode).toHaveCount(0);
  }

  if (modes.copy) {
    await expect(copyMode).toBeVisible();
  } else {
    await expect(copyMode).toHaveCount(0);
  }
}

async function applyFirstManualEdge(page: Page) {
  const dialog = wiringDialog(page);
  await dialog.getByRole('button', { name: /^Connect Edge$/ }).click();

  const before = await page.locator('.react-flow__edge').count();
  const checkboxes = dialog.locator('[role="checkbox"]');
  await checkboxes.first().click();

  const checkboxCount = await checkboxes.count();
  let targetSelected = false;
  for (let index = 1; index < checkboxCount; index += 1) {
    const checkbox = checkboxes.nth(index);
    if (await checkbox.isEnabled()) {
      await checkbox.click();
      targetSelected = true;
      break;
    }
  }

  expect(targetSelected).toBe(true);
  await dialog.getByRole('button', { name: /^Apply$/ }).click();
  await expect(wiringTitle(page)).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(before + 1);
}

async function applyCopyInputs(page: Page, expectedNewEdges: number) {
  const dialog = wiringDialog(page);
  await dialog.getByRole('button', { name: /^Copy Inputs$/ }).click();

  const before = await page.locator('.react-flow__edge').count();
  await dialog.getByRole('button', { name: /^Apply$/ }).click();
  await expect(wiringTitle(page)).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(
    before + expectedNewEdges,
  );
}

async function cancelWiringStudio(page: Page) {
  await wiringDialog(page).getByRole('button', { name: /^Cancel$/ }).click();
  await expect(wiringTitle(page)).toHaveCount(0);
}

test.describe('Intro P2PKH connect and copy-input actions', () => {
  test('covers realistic next-step wiring decisions from the intro flow', async ({ page }) => {
    test.setTimeout(120_000);

    await stubBulkCalculateWithDefaults(page);
    await gotoEditor(page);
    await uploadFlowData(
      page,
      buildIntroPlaygroundFlow(),
      'p0-intro-connect-copy-playground.json',
    );

    await test.step('reconnect removed private-key input with reverse auto-orientation', async () => {
      await selectPair(page, NODES.signLowR, NODES.randomPrivateKey);
      await openWiringStudio(page);
      await expectDirection(page, 'Random 32 Bytes', 'Sign TX (Low-R)');
      await expectModes(page, { connect: true, copy: false });
      await expect(wiringDialog(page)).toContainText('Private Key (32 bytes hex):');
      await applyFirstManualEdge(page);
    });

    await test.step('copy a reused private-key source into a new one-input experiment node', async () => {
      await selectPair(page, NODES.privateKeyToPubKey, NODES.addedHash160);
      await openWiringStudio(page);
      await expectDirection(page, 'PrivKey → PubKey', 'Added HASH160 Experiment');
      await expectModes(page, { connect: true, copy: true });
      await expect(wiringDialog(page)).toContainText('Random 32 Bytes');
      await expect(wiringDialog(page)).toContainText('INPUT HEX:');
      await applyCopyInputs(page, 1);
      await expect(
        page.locator(
          `.react-flow__edge[data-id="enode_CWfi6O88-${NODES.addedHash160}-input-0"]`,
        ),
      ).toHaveCount(1);
    });

    await test.step('connect final raw transaction to a new TX Field Extract node', async () => {
      await selectPair(page, NODES.finalRawTransaction, NODES.addedTxExtract);
      await openWiringStudio(page);
      await expectDirection(page, 'Final Raw Transaction', 'Added TX Field Extract');
      await expectModes(page, { connect: true, copy: false });
      await expect(wiringDialog(page)).toContainText('Raw TX (hex):');
      await applyFirstManualEdge(page);
    });

    await test.step('copy inputs between transaction templates with the same ordered handles', async () => {
      await selectPair(page, NODES.addedLegacySource, NODES.addedLegacyTarget);
      await openWiringStudio(page);
      await expectDirection(
        page,
        'Added Legacy TX Template Source',
        'Added Legacy TX Template Target',
      );
      await expectModes(page, { connect: true, copy: true });
      await expect(wiringDialog(page)).toContainText('Version');
      await expect(wiringDialog(page)).toContainText('Input Count');
      await applyCopyInputs(page, 2);
      await expect(
        page.locator(
          `.react-flow__edge[data-id="enode_8QSOHj19-${NODES.addedLegacyTarget}-input-0"]`,
        ),
      ).toHaveCount(1);
      await expect(
        page.locator(
          `.react-flow__edge[data-id="enode_1AL3tCpN-${NODES.addedLegacyTarget}-input-10"]`,
        ),
      ).toHaveCount(1);
    });

    await test.step('hide copy inputs for legacy-to-general templates while keeping connect available', async () => {
      await selectPair(page, NODES.addedLegacySource, NODES.addedGeneralTemplate);
      await openWiringStudio(page);
      await expectDirection(
        page,
        'Added Legacy TX Template Source',
        'Added General TX Template',
      );
      await expectModes(page, { connect: true, copy: false });
      await cancelWiringStudio(page);
    });

    await test.step('disable the toolbar action for non-calculable text info nodes', async () => {
      await selectPair(page, NODES.finalRawTransaction, NODES.textInfo);
      await expect(connectToolbarButton(page)).toBeDisabled();
    });
  });
});
